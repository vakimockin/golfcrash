from collections import Counter
from unittest.mock import patch

from golf_crash_math.events import DEFAULT_EVENTS
from golf_crash_math.rng import Seed
import golf_crash_math.round as round_mod
from golf_crash_math.round import (
    HOUSE_EDGE,
    JACKPOT_MULT,
    NORMAL_CRASH_MULTIPLIER_CAP,
    crash_from_uniform,
    generate_round,
    generate_stake_engine_state,
)
from golf_crash_math.rtp import simulate, simulate_table


def test_crash_from_uniform_house_edge_returns_one() -> None:
    assert crash_from_uniform(0.0) == 1.0
    assert crash_from_uniform(HOUSE_EDGE - 1e-9) == 1.0


def test_crash_from_uniform_post_edge_at_least_one() -> None:
    for u in [HOUSE_EDGE, 0.5, 0.9, 0.999]:
        assert crash_from_uniform(u) >= 1.0


def test_generate_round_deterministic() -> None:
    s = Seed(server_seed="abc", client_seed="xyz", nonce=42)
    r1 = generate_round(s)
    r2 = generate_round(s)
    assert r1.outcome == r2.outcome
    assert r1.crash_multiplier == r2.crash_multiplier
    assert r1.pre_shot_fail == r2.pre_shot_fail
    assert r1.crash_cause == r2.crash_cause


def test_outcome_distribution_over_many_rounds() -> None:
    counter: Counter[str] = Counter()
    rounds = 20_000
    for nonce in range(rounds):
        r = generate_round(Seed("dev", "dev", nonce))
        counter[r.outcome] += 1

    pre_shot_total = (
        DEFAULT_EVENTS.pre_shot_mole
        + DEFAULT_EVENTS.pre_shot_club_break
        + DEFAULT_EVENTS.pre_shot_self_hit
    )
    expected_pre_shot = rounds * pre_shot_total
    assert abs(counter["pre_shot_fail"] - expected_pre_shot) < expected_pre_shot * 0.5
    assert counter["crash"] > rounds * 0.95
    # JACKPOT_PROB is microscopic (~1 in 1e6 after pre-shot); 20k rounds
    # will almost never see hole_in_one. Dedicated test uses a RNG stub.
    assert counter["hole_in_one"] >= 0


def test_hole_in_one_payout_is_jackpot() -> None:
    """Hole-in-one pays JACKPOT_MULT; probability is far too low for brute sweep."""

    def fixed_floats_below_hole_threshold(_seed: Seed, count: int = 32) -> list[float]:
        rolls = [0.5] * count
        rolls[1] = 0.0  # < JACKPOT_PROB ⇒ hole-in-one path
        return rolls

    with patch.object(round_mod, "floats", fixed_floats_below_hole_threshold):
        r = generate_round(Seed("dev", "dev", 0))
    assert r.outcome == "hole_in_one"
    assert r.crash_multiplier == JACKPOT_MULT
    assert r.crash_multiplier == 2000.0
    assert r.pre_shot_fail is None
    assert r.near_miss is True


def test_decorative_events_within_flight_window() -> None:
    seed = Seed("dev", "dev", 7)
    r = generate_round(seed)
    if r.outcome == "crash":
        for ev in r.decorative_events:
            assert 0 <= ev.at_sec
            assert ev.kind in {"bird", "wind", "helicopter", "plane", "cart"}


def test_stake_engine_state_matches_frontend_contract() -> None:
    state = generate_stake_engine_state(Seed("dev", "dev", 3))

    assert state["roundId"].startswith("round-")
    assert state["serverSeedHash"]
    assert state["seed"] == {"serverSeed": "dev", "clientSeed": "dev", "nonce": 3}
    assert state["outcome"] in {"preShotFail", "holeInOne", "crash"}
    assert state["landingZone"] in {"fairway", "sand", "water", "cart", "hole"}
    assert isinstance(state["finalMultiplier"], float | int)
    assert isinstance(state["crashMultiplier"], float | int)
    assert isinstance(state["crashAtSec"], float | int)
    assert isinstance(state["decorativeEvents"], list)
    assert isinstance(state["bonusRoundTriggered"], bool)
    assert isinstance(state["nearMiss"], bool)


def test_simulate_rtp_in_target_band() -> None:
    """Crash cashouts x1.2 / x1.5 / x2 — таргетна смуга RTP ~96–97 % (довга границя книги).

    Одна пара PF-seed дає статистичний розкид навіть на сотнях тисяч nonce;
    тримуємо м'який коридор, щоб CI не смикався від рідкісних джекпот-хітів.
    """

    out = simulate(rounds=250_000, cashout_target=1.5)
    assert 0.952 < out["rtp"] < 0.982, f"RTP out of band: {out['rtp']:.4f}"

    rows = simulate_table(rounds=200_000, targets=(1.2, 1.5, 2.0))
    for row in rows:
        r = row["rtp"]
        assert 0.952 < r < 0.982, f"RTP out of band at target {row['cashout_target']}: {r:.4f}"


def test_regular_crash_multiplier_capped_below_jackpot() -> None:
    """Ordinary crashes must not inflate into hundreds X — jackpot stays singular."""
    for nonce in range(100_000):
        r = generate_round(Seed("cap", "cap", nonce))
        if r.outcome == "crash":
            assert r.crash_multiplier <= NORMAL_CRASH_MULTIPLIER_CAP


def test_crash_multiplier_capped_at_max_crash() -> None:
    """No round should exceed §1.1 Max Win = 100 000X via the crash path."""
    from golf_crash_math.round import MAX_CRASH

    for nonce in range(50_000):
        r = generate_round(Seed("dev", "dev", nonce))
        if r.outcome == "crash":
            assert r.crash_multiplier <= MAX_CRASH


def test_bonus_and_near_miss_flags_present() -> None:
    """bonus_round_triggered + near_miss should both fire at least once
    across a sweep, since their probabilities (1% and 30%) are non-trivial."""
    bonus_seen = False
    near_miss_seen = False
    for nonce in range(2_000):
        r = generate_round(Seed("dev", "dev", nonce))
        if r.bonus_round_triggered:
            bonus_seen = True
        if r.near_miss:
            near_miss_seen = True
        if bonus_seen and near_miss_seen:
            break
    assert bonus_seen, "expected at least one bonus trigger in 2k rounds"
    assert near_miss_seen, "expected at least one near-miss in 2k rounds"
