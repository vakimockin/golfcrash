#!/usr/bin/env python3
"""Simulate millions of deterministic `generate_round` samples and print distribution.

Runs with:
  PYTHONPATH=src python scripts/simulate_distribution_20m.py
  PYTHONPATH=src python scripts/simulate_distribution_20m.py --rounds 50000

Не в pytest — занадто довго для CI.
"""

from __future__ import annotations

import argparse
import math
import sys
import time
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

_SDK_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SDK_ROOT / "src"))

from golf_crash_math.events import DEFAULT_EVENTS, EventTable  # noqa: E402
from golf_crash_math.rng import Seed  # noqa: E402
from golf_crash_math.round import (  # noqa: E402
    HOUSE_EDGE,
    JACKPOT_MULT,
    JACKPOT_PROB,
    RoundResult,
    generate_round,
)

# Українські пояснювачі до полів книги (`RoundResult`).
UA_ZONE = {
    "fairway": "фейрвей («земля», грай зона викону)",
    "sand": "бункер / пісок",
    "water": "вода",
    "cart": "удар / зіткнення з гольф-картом",
    "hole": "лунка (hole-in-one)",
}

UA_CAUSE = {
    "bird": "пташка на траєкторії крашу (причинний тег крашу)",
    "wind": "вітер",
    "helicopter": "гелікоптер",
    "plane": "літак",
    "cart": "карт (як первинна причина крашу; landing_zone також може стати cart)",
    "landed": "приземлення м'яча (без перешкоди) — множник обривається при контакті з поверхнею",
    "fakeBoost": "псевдо-бонус / НЛО-тизеер → приземлення у воду (див. код)",
}


def print_model_capabilities(table: EventTable = DEFAULT_EVENTS) -> None:
    """Що рахує генератор книги й чого окремими подіями НЕМАЄ."""
    print("=== У МОДЕЛІ Є / НЕМАЄ (контракт `generate_round`) ===")
    print()
    print("  Є в кожному раунді або більшість фінішів:")
    print("    • outcome: pre_shot_fail | hole_in_one | crash")
    print("    • landing_zone: fairway | sand | water | cart | hole")
    print("      (для pre_shot_fail зараз зафіксовано water у коді).")
    print("    • crash_cause (лише коли outcome=crash): landed / fakeBoost / або іменна причина з events.py")
    print("    • near_miss (bool на crash): візуал «крутиться на краю лунки» — rolls[7] < ")
    print(f"      {table.near_miss_target} (~{100 * table.near_miss_target:g}% серед crash-ів).")
    print("    • bonus_round_triggered (bool на crash): прапор «космічного» бонусу — ")
    print(f"      rolls[6] < {table.bonus_trigger} (~{100 * table.bonus_trigger:g}% серед crash).")
    print("      Це лише ознака для клієнта; окремої виплати «украв прибульця» нема.")
    print("    • decorative_events[]: лише декор під час польоту (птах/kарт/вітер тощо),")
    print("      не окремий економічний результат.")
    print()
    print("  НЕ реалізовано як окрема категорія ймовірності в книжці:")
    print("    • «птаха вкрав м'яч» — нема окремого ісходу; птах може з'явитися як")
    print("      crash_cause=='bird' (формальний тег крашу) або в decorative_events.")
    print("    • «прибулець забрав м’яч під час польоту» — лише умовний кінематограф:")
    print("      bonus_round_triggered + образ НЛО на клієнті; фінансово це той самий crash.")
    print("    • «м'яко приземлився біля лунки» як окрема зона — замість цього є near_miss")
    print("      + landing_zone (fairway/sand/water), без окремого «rim distance» у JSON.")
    print()


def _probabilities(table=DEFAULT_EVENTS) -> dict[str, float]:
    p_mole = table.pre_shot_mole
    p_club = table.pre_shot_club_break
    p_self = table.pre_shot_self_hit
    p_pre = p_mole + p_club + p_self
    p_survive = 1.0 - p_pre
    p_hole_one = p_survive * JACKPOT_PROB
    p_crash = p_survive * (1.0 - JACKPOT_PROB)

    assert math.isfinite(p_crash + p_pre + p_hole_one)
    sums = p_pre + p_hole_one + p_crash
    if abs(sums - 1.0) > 1e-9:
        raise RuntimeError(f"probabilities sum to {sums}, expected 1")

    return {
        "p_mole": p_mole,
        "p_club": p_club,
        "p_self": p_self,
        "p_pre_fail": p_pre,
        "p_survive_pre_shot": p_survive,
        "p_hole_one_given_survive": JACKPOT_PROB,
        "p_hole_one_total": p_hole_one,
        "p_crash_total": p_crash,
    }


def _print_formulas(p: dict[str, float]) -> None:
    print("=== ФОРМУЛИ ЙМОВІРНОСТІ ТРЬОХ ОСНОВНИХ OUTCOME ===")
    print()
    print("  Припущення:")
    print("    rolls = floats(seed, 32), як у generate_round(seed).")
    print()
    print("  Крок 1 — pre_shot rolls[0]:")
    print("    P(pre_shot_fail) = p_mole + p_club + p_self =", p["p_pre_fail"])
    print()
    print("  Крок 2 — hole vs crash rolls[1] (якщо не pre):")
    print("    P(hole_in_one | survive) = JACKPOT_PROB =", JACKPOT_PROB)
    print("    P(hole глобально) =", p["p_hole_one_total"])
    print("    P(crash глобально) =", p["p_crash_total"])
    print()
    print("  Константи round.py:")
    print(f"    HOUSE_EDGE = {HOUSE_EDGE} ; JACKPOT_MULT = {JACKPOT_MULT}")
    print()


def _print_landing_and_cause_formulas(table: EventTable) -> None:
    print("=== ФОРМУЛИ ПІСЛЯ ТОГО, ЯК ВИПАВ CRASH (умовно на crash-раунд) ===")
    print()
    print("  crash_cause = _pick_crash_cause(rolls[3]) — сумарна вага подій із events.py:")
    w_bird = table.in_flight_bird
    w_wind = table.in_flight_wind
    w_heli = table.in_flight_helicopter
    w_plane = table.in_flight_plane
    w_cart_evt = table.in_flight_cart
    w_fake = table.fake_boost
    w_sum = w_bird + w_wind + w_heli + w_plane + w_cart_evt + w_fake
    print(f"    P(bird)= {w_bird}, wind={w_wind}, helicopter={w_heli}, plane={w_plane},")
    print(f"       cart_evt={w_cart_evt}, fakeBoost={w_fake}  ⇒ сума «іменних» причин={w_sum}")
    print(f"    P(landed) = 1 − {w_sum} = {1.0 - w_sum:.12g}")
    print()
    print("  landing_zone = _pick_landing_zone(rolls[4], cause):")
    print("    • якщо cause == cart ⇒ landing_zone = cart (гарантовано карт)")
    print("    • якщо cause == fakeBoost ⇒ landing_zone = water")
    print("    • інакше: fairway якщо u<0.55; sand якщо u<0.78; інакше water")
    print()
    print("  Після розподілу crash (глобально):")
    p_surv_after = _probabilities()["p_survive_pre_shot"]
    p_crash_global = _probabilities()["p_crash_total"]
    p_near = p_crash_global * table.near_miss_target
    p_bonus = p_crash_global * table.bonus_trigger
    print(f"    E[near_miss=True у всієї вибірки] ≈ N × P(crash) × {table.near_miss_target}")
    print(f"                                 = N × {p_near:.12g}")
    print(f"    E[bonus_round_triggered=True]≈ N × P(crash) × {table.bonus_trigger}")
    print(f"                                 = N × {p_bonus:.12g}")
    print()


def _print_counter_table(title: str, ctr: Counter, total_ref: int) -> None:
    print(title)
    w = max(len(str(k)) for k in ctr) if ctr else 10
    w = max(w, 20)
    print(f"{ 'ключ':<{w}} {'count':>14} {'% від ref':>12}")
    for k in sorted(ctr.keys(), key=lambda x: (-ctr[x], str(x))):
        pct = 100.0 * ctr[k] / total_ref if total_ref else 0.0
        print(f"{str(k):<{w}} {ctr[k]:>14,} {pct:>11.6f}%")
    print()


@dataclass
class SimulationStats:
    rounds: int
    outcome: Counter[str] = field(default_factory=Counter)
    prefail_subtype: Counter[str | None] = field(default_factory=Counter)
    landing_zone_all: Counter[str] = field(default_factory=Counter)
    landing_given_outcome: Counter[tuple[str, str]] = field(default_factory=Counter)
    crash_cause_only: Counter[str] = field(default_factory=Counter)
    near_miss_on_crash: Counter[str] = field(default_factory=Counter)
    bonus_on_crash: Counter[str] = field(default_factory=Counter)
    decor_kind_occurrences: Counter[str] = field(default_factory=Counter)
    crash_finale_line: Counter[str] = field(default_factory=Counter)
    cause_x_zone_on_crash: Counter[tuple[str, str]] = field(default_factory=Counter)


def run_simulation(
    rounds: int,
    server_seed: str = "bulk-sim",
    client_seed: str = "20m-dist",
    progress_every: int = 500_000,
    table: EventTable = DEFAULT_EVENTS,
) -> SimulationStats:
    s = SimulationStats(rounds=rounds)
    t0 = time.monotonic()

    for nonce in range(rounds):
        seed = Seed(server_seed=server_seed, client_seed=client_seed, nonce=nonce)
        r = generate_round(seed, table)

        s.outcome[r.outcome] += 1
        s.prefail_subtype[r.pre_shot_fail] += 1
        z = str(r.landing_zone)
        s.landing_zone_all[z] += 1
        s.landing_given_outcome[(r.outcome, z)] += 1

        for ev in r.decorative_events:
            s.decor_kind_occurrences[ev.kind] += 1

        if r.outcome == "crash" and r.crash_cause is not None:
            cc = r.crash_cause
            s.crash_cause_only[cc] += 1
            s.near_miss_on_crash["так" if r.near_miss else "ні"] += 1
            s.bonus_on_crash["так" if r.bonus_round_triggered else "ні"] += 1

            ua_z = UA_ZONE.get(z, z)
            ua_c = UA_CAUSE.get(cc, cc)
            line = f"зона={z} [{ua_z}] | причина={cc} [{ua_c}] | біля_лунки={r.near_miss}"
            s.crash_finale_line[line] += 1
            s.cause_x_zone_on_crash[(cc, z)] += 1

        if progress_every > 0 and (nonce + 1) % progress_every == 0:
            elapsed = time.monotonic() - t0
            rate = (nonce + 1) / elapsed
            print(f"… {nonce + 1:,} / {rounds:,} (~{rate:,.0f} ок/с, {elapsed:.1f}s)", flush=True)

    return s


def main() -> None:
    parser = argparse.ArgumentParser(description="Повний розподіл generate_round.")
    parser.add_argument("--rounds", type=int, default=20_000_000)
    parser.add_argument("--quiet-formulas", action="store_true")
    parser.add_argument("--skip-model-explainer", action="store_true", help="без блоку «що є в моделі»")
    args = parser.parse_args()
    rounds = args.rounds
    if rounds < 1:
        raise SystemExit("--rounds must be >= 1")

    table = DEFAULT_EVENTS
    p = _probabilities()

    print(f"simulate_distribution — {rounds:,} раундів (nonce 0 … {rounds - 1:,}).")
    print()
    if not args.skip_model_explainer:
        print_model_capabilities(table)

    if not args.quiet_formulas:
        _print_formulas(p)
        _print_landing_and_cause_formulas(table)

    crash_n_expected = rounds * p["p_crash_total"]

    print("=== ОЧІКУВАНІ (N × p) TOP-LEVEL ===")
    print(f"  E[pre_shot_fail]={rounds * p['p_pre_fail']:,.4f}, E[hole]={rounds * p['p_hole_one_total']:,.4f}, E[crash]={crash_n_expected:,.4f}")
    print()

    print("=== СИМУЛЯЦІЯ ===")
    t0 = time.monotonic()
    s = run_simulation(rounds)
    elapsed = time.monotonic() - t0
    print(f"Готово за {elapsed:.2f}s ({rounds / elapsed:,.0f} ок/с).\n")

    print("=== ТРИ ОСНОВНІ OUTCOME ===")
    for key in ["pre_shot_fail", "hole_in_one", "crash"]:
        c = s.outcome.get(key, 0)
        exp = rounds * {"pre_shot_fail": p["p_pre_fail"], "hole_in_one": p["p_hole_one_total"], "crash": p["p_crash_total"]}[key]
        print(f"  {key:<16} count={c:>12,}  E≈{exp:,.2f}  Δ{c - exp:+,.2f}  ({100 * c / rounds:.6f}%)")

    crash_count = s.outcome["crash"]

    print()
    _print_counter_table("=== landing_zone (усі раунди) + UA опис ===", s.landing_zone_all, rounds)
    for lz, pct in UA_ZONE.items():
        print(f"    {lz}: {pct}")

    print("=== landing_zone розбиття за outcome ===")
    for out in sorted({k[0] for k in s.landing_given_outcome}):
        sub = Counter({k[1]: s.landing_given_outcome[(out, k[1])] for k in s.landing_given_outcome if k[0] == out})
        print(f"  -- {out} (всього {s.outcome[out]:,}) --")
        for lz, cnt in sorted(sub.items(), key=lambda x: -x[1]):
            print(f"       {lz:>10} : {cnt:>12,} ({100 * cnt / s.outcome[out]:.4f}% від цього outcome)")
        print()

    print("=== crash_cause (лише коли outcome=crash) ; count / % від усієї вибірки / % від crash ===")
    w = 14
    for cause, cnt in sorted(s.crash_cause_only.items(), key=lambda x: -x[1]):
        pct_all = 100.0 * cnt / rounds
        pct_cr = 100.0 * cnt / crash_count if crash_count else 0.0
        ua = UA_CAUSE.get(cause, "")
        print(f"  {cause:<{w}} {cnt:>12,}  {pct_all:>8.4f}% всієї  | {pct_cr:>8.4f}% лише crash  | {ua}")

    exp_near_yes = rounds * p["p_crash_total"] * table.near_miss_target
    exp_bonus_yes = rounds * p["p_crash_total"] * table.bonus_trigger
    print()
    print("=== near_miss на crash-раундах (візуал «біля лунки») ===")
    for k in sorted(s.near_miss_on_crash.keys()):
        c = s.near_miss_on_crash[k]
        print(f"  {k}: {c:,} ({100 * c / crash_count:.4f}% від crash)" if crash_count else f"  {k}: {c:,}")
    print(f"  очікувано «так» ≈ {exp_near_yes:,.2f} (N×P(crash)×{table.near_miss_target})")

    print()
    print("=== bonus_round_triggered на crash (прапор для «космосу» на клієнті) ===")
    for k in sorted(s.bonus_on_crash.keys()):
        c = s.bonus_on_crash[k]
        print(f"  {k}: {c:,} ({100 * c / crash_count:.4f}% від crash)" if crash_count else f"  {k}: {c:,}")
    print(f"  очікувано «так» ≈ {exp_bonus_yes:,.2f} (N×P(crash)×{table.bonus_trigger})")

    print()
    _print_counter_table(
        "=== decorative_events: скільки разів з'явився кожний kind (лише шоу, не payout) ===",
        s.decor_kind_occurrences,
        rounds,
    )

    print("=== cause × landing_zone (лише crash) — топ-20 пар ===")
    pairs = sorted(s.cause_x_zone_on_crash.items(), key=lambda x: -x[1])[:20]
    for (cause, lz), cnt in pairs:
        print(f"  {cause:>12} + {lz:>8} : {cnt:>10,} ({100 * cnt / crash_count:.4f}% від crash)")

    print()
    print("=== Повні рядки фінішу crash (топ-15 за частотою) ===")
    for line, cnt in s.crash_finale_line.most_common(15):
        print(f"  {cnt:>10,}×  {line}")

    print()
    print("=== pre_shot_fail підтипи ===")
    for kind, pk in (
        ("mole", table.pre_shot_mole),
        ("club_break", table.pre_shot_club_break),
        ("self_hit", table.pre_shot_self_hit),
    ):
        cnt = s.prefail_subtype.get(kind, 0)
        exp = rounds * pk
        print(f"  {kind:<14} {cnt:>12,}  E≈{exp:,.2f}  Δ{cnt - exp:+,.2f}")
    print(f"  (без pre)      {s.prefail_subtype.get(None, 0):>12,}")

    print()
    print("Готово.")


if __name__ == "__main__":
    main()
