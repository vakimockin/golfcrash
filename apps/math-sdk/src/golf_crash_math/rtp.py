"""RTP simulation harness.

`simulate` measures the realised RTP at a single cashout target by playing
N deterministic rounds with the Provably Fair RNG. `simulate_table` sweeps
multiple targets so a tester can confirm the §1.2 "RTP 95-97%" band holds
across the strategies players actually use (low-target safety play vs.
high-target risk play).

The Bustabit-style payout invariant means EV is independent of the cashout
target in the no-jackpot, no-pre-shot-fail case. So the per-target RTP
table really only varies because of the rare jackpot (always pays 2000X)
and the pre-shot fail rate. The table is still useful: it confirms the
math holds across targets and surfaces variance bands.
"""

from __future__ import annotations

from .rng import Seed
from .round import JACKPOT_MULT, generate_round


def simulate(
    rounds: int = 100_000,
    cashout_target: float = 1.5,
    server_seed: str = "dev-server",
    client_seed: str = "dev-client",
) -> dict[str, float]:
    total_bet = 0.0
    total_payout = 0.0
    pre_shot_fails = 0
    jackpots = 0
    crash_losses = 0
    cashout_wins = 0
    bonus_triggers = 0
    near_misses = 0

    for nonce in range(rounds):
        seed = Seed(server_seed=server_seed, client_seed=client_seed, nonce=nonce)
        result = generate_round(seed)
        total_bet += 1.0

        if result.outcome == "pre_shot_fail":
            pre_shot_fails += 1
            continue

        if result.outcome == "hole_in_one":
            # Player gets the larger of their cashout target or the jackpot
            # multiplier. With JACKPOT_MULT > realistic targets, this is
            # always JACKPOT_MULT.
            payout = max(cashout_target, JACKPOT_MULT)
            total_payout += payout
            jackpots += 1
            continue

        if result.bonus_round_triggered:
            bonus_triggers += 1
        if result.near_miss:
            near_misses += 1

        if result.crash_multiplier >= cashout_target:
            total_payout += cashout_target
            cashout_wins += 1
        else:
            crash_losses += 1

    rtp = total_payout / total_bet if total_bet else 0.0
    return {
        "rounds": float(rounds),
        "rtp": rtp,
        "cashout_target": cashout_target,
        "pre_shot_fails": float(pre_shot_fails),
        "jackpots": float(jackpots),
        "crash_losses": float(crash_losses),
        "cashout_wins": float(cashout_wins),
        "bonus_triggers": float(bonus_triggers),
        "near_misses": float(near_misses),
    }


def simulate_table(
    rounds: int = 200_000,
    targets: tuple[float, ...] = (1.20, 1.50, 2.00, 5.00, 10.00),
    server_seed: str = "dev-server",
    client_seed: str = "dev-client",
) -> list[dict[str, float]]:
    """Run `simulate` for each target and return a list of result dicts.

    The simulator is deterministic per (server_seed, client_seed, nonce),
    so each target sees the same set of underlying rounds. That makes the
    rows directly comparable: differences in RTP come from the cashout
    strategy, not from RNG variance.
    """
    return [
        simulate(
            rounds=rounds,
            cashout_target=t,
            server_seed=server_seed,
            client_seed=client_seed,
        )
        for t in targets
    ]
