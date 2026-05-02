#!/usr/bin/env python3
"""Повний звіт: N ставок по фіксованій сумі (за замовчуванням $1), українською.

Один прохід по nonce 0..N-1: для кожного раунду рахує виплати під кілька
стратегій кешауту (як `golf_crash_math.rtp.simulate`) та окремо стратегію
«долітати до кінця» за правилами клієнта Golf Crash (див. `is_zero_crash`).

Запуск:
  cd apps/math-sdk && PYTHONPATH=src python3 scripts/casino_profit_report_uk_20m.py
  PYTHONPATH=src python3 scripts/casino_profit_report_uk_20m.py --rounds 500000
"""

from __future__ import annotations

import argparse
import sys
import time
from collections import Counter
from pathlib import Path

_SDK_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SDK_ROOT / "src"))

from golf_crash_math.events import DEFAULT_EVENTS, EventTable  # noqa: E402
from golf_crash_math.rng import Seed  # noqa: E402
from golf_crash_math.round import (  # noqa: E402
    JACKPOT_MULT,
    JACKPOT_PROB,
    HOUSE_EDGE,
    RoundResult,
    generate_round,
)


def _client_is_zero_crash(r: RoundResult) -> bool:
    """Відповідає `isZeroCrash` у `games/golf-crash/.../round.ts` (воді/landed/fakeBoost)."""
    if r.outcome != "crash" or r.crash_cause is None:
        return False
    return (
        r.landing_zone == "water"
        or r.crash_cause == "landed"
        or r.crash_cause == "fakeBoost"
    )


def _payout_ride_to_end(r: RoundResult, bet: float) -> float:
    if r.outcome == "pre_shot_fail":
        return 0.0
    if r.outcome == "hole_in_one":
        return bet * JACKPOT_MULT
    if r.outcome == "crash":
        if _client_is_zero_crash(r):
            return 0.0
        if r.landing_zone in ("fairway", "sand", "cart"):
            return bet * r.crash_multiplier
        return 0.0
    return 0.0


def _payout_cashout_model(r: RoundResult, bet: float, cashout_target: float) -> float:
    """Як `rtp.simulate`: джекпот = max(target, JACKPOT); на краші — target або 0."""
    if r.outcome == "pre_shot_fail":
        return 0.0
    if r.outcome == "hole_in_one":
        return bet * max(cashout_target, JACKPOT_MULT)
    if r.outcome == "crash":
        if r.crash_multiplier >= cashout_target:
            return bet * cashout_target
        return 0.0
    return 0.0


def _money(x: float) -> str:
    return f"${x:,.2f}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rounds", type=int, default=20_000_000)
    parser.add_argument("--bet", type=float, default=1.0, help="Ставка за раунд у доларах")
    parser.add_argument(
        "--targets",
        type=str,
        default="1.20,1.50,2.00,5.00,10.00",
        help="Таргети кешауту через кому (множник)",
    )
    parser.add_argument("--progress-every", type=int, default=500_000)
    parser.add_argument("--server-seed", default="bulk-uk-report")
    parser.add_argument("--client-seed", default="20m-profit")
    args = parser.parse_args()

    rounds = args.rounds
    bet = args.bet
    if rounds < 1 or bet <= 0:
        raise SystemExit("--rounds >= 1 and --bet > 0")
    targets = tuple(float(x.strip()) for x in args.targets.split(",") if x.strip())
    table: EventTable = DEFAULT_EVENTS

    total_stake = bet * rounds

    payout_by_target: dict[float, float] = {t: 0.0 for t in targets}
    jackpot_pay_by_target: dict[float, float] = {t: 0.0 for t in targets}
    crash_cash_pay_by_target: dict[float, float] = {t: 0.0 for t in targets}
    stats: dict[float, dict[str, int]] = {
        t: {"jackpot_rounds": 0, "crash_cashouts": 0, "crash_busts": 0}
        for t in targets
    }

    payout_ride_total = 0.0

    c_pre = 0
    c_hole = 0
    c_crash = 0

    crash_by_land = Counter[str]()
    crash_cause_ct = Counter[str]()
    crash_zero_client = 0
    crash_without_zero_tags = 0

    ride_loss_rounds = 0
    ride_win_rounds = 0

    t0 = time.monotonic()
    for nonce in range(rounds):
        seed = Seed(
            server_seed=args.server_seed,
            client_seed=args.client_seed,
            nonce=nonce,
        )
        r = generate_round(seed, table)

        if r.outcome == "pre_shot_fail":
            c_pre += 1
            ride_loss_rounds += 1
            continue
        if r.outcome == "hole_in_one":
            c_hole += 1
            ride_win_rounds += 1
            pr = bet * JACKPOT_MULT
            payout_ride_total += pr
            for t in targets:
                jp = bet * max(t, JACKPOT_MULT)
                payout_by_target[t] += jp
                jackpot_pay_by_target[t] += jp
                stats[t]["jackpot_rounds"] += 1
            continue

        c_crash += 1
        crash_by_land[r.landing_zone] += 1
        if r.crash_cause:
            crash_cause_ct[r.crash_cause] += 1

        prt = _payout_ride_to_end(r, bet)
        payout_ride_total += prt
        if prt > 0:
            ride_win_rounds += 1
        else:
            ride_loss_rounds += 1

        if _client_is_zero_crash(r):
            crash_zero_client += 1
        elif r.outcome == "crash" and r.crash_multiplier > 0:
            crash_without_zero_tags += 1

        for t in targets:
            pc = _payout_cashout_model(r, bet, t)
            payout_by_target[t] += pc
            if r.crash_multiplier >= t:
                crash_cash_pay_by_target[t] += bet * t
                stats[t]["crash_cashouts"] += 1
            else:
                stats[t]["crash_busts"] += 1

        pe = args.progress_every
        if pe > 0 and (nonce + 1) % pe == 0:
            elapsed = time.monotonic() - t0
            rate = (nonce + 1) / elapsed
            print(
                f"… {nonce + 1:,} / {rounds:,} (~{rate:,.0f} ок/с, {elapsed:.1f}s)",
                flush=True,
            )

    elapsed = time.monotonic() - t0
    rate = rounds / elapsed

    print()
    print("=" * 72)
    print("  ЗВІТ ПРИБУТКУ КАЗИНО / ПОВОРТ ГРАВЦЯМ (математична книга Golf Crash)")
    print("=" * 72)
    print()
    print("  Припущення:")
    print("    • Кожен раунд — одна ставка в доларах США; результат незалежний.")
    print("    • RNG: детермінований той самий набір книг, що `generate_round` (PF seed у заголовку).")
    print()
    print("  Параметри симуляції")
    print(f"    • Раундів: {rounds:,}")
    print(f"    • Ставка за раунд: {_money(bet)}")
    print(f"    • Усього поставлено (оборот гравця): {_money(total_stake)}")
    print(f"    • server_seed={args.server_seed!r}, client_seed={args.client_seed!r}, nonce=0…{rounds - 1:,}")
    print(f"    • Час: {elapsed:.2f}s (~{rate:,.0f} раундів/с)")
    print()
    print("  Константи `round.py` (поточна книга)")
    print(f"    • HOUSE_EDGE (краш-мультиплікатор): {HOUSE_EDGE}")
    print(f"    • JACKPOT_MULT (hole-in-one): {JACKPOT_MULT:g}× ставки")
    print(f"    • JACKPOT_PROB (після успішного перед-удару): {JACKPOT_PROB:g}")
    p_pre = table.pre_shot_mole + table.pre_shot_club_break + table.pre_shot_self_hit
    print(f"    • P(pre_shot_fail): {p_pre:g}")
    print(
        "    • Примітка: модель RTP у `rtp.simulate` — гравець **завжди** кешаутить на фіксованому"
    )
    print("      множнику, коли множник крашу з книги досягнув цього рівня; інакше — втрата ставки.")
    print()

    print("-" * 72)
    print("  ЧАСТКИЙ РОЗБІЛ ПО ІСХОДАХ (лише книга, без стратегії виплат)")
    print("-" * 72)
    print(f"    pre_shot_fail:     {c_pre:>12,}  ({100 * c_pre / rounds:.4f}%)")
    print(f"    hole_in_one:       {c_hole:>12,}  ({100 * c_hole / rounds:.6f}%)")
    print(f"    crash:             {c_crash:>12,}  ({100 * c_crash / rounds:.4f}%)")

    print()
    print("  crash landing_zone:")
    for lz, ct in sorted(crash_by_land.items(), key=lambda x: -x[1]):
        print(f"    {lz:<10} {ct:>12,}  ({100 * ct / max(1, c_crash):.4f}% від crash)")

    print()
    print("  crash_cause (crash-раунди):")
    for c, ct in sorted(crash_cause_ct.items(), key=lambda x: -x[1]):
        print(f"    {c:<12} {ct:>12,}")

    print()
    print(f"    isZeroCrash (вода або причини landed/fakeBoost): {crash_zero_client:,}")
    print(
        f"    Crash-раунди без цього тегу (потрібне для можливості «до кінця»): "
        f"{crash_without_zero_tags:,}"
    )

    print()
    print("=" * 72)
    print("  СТРАТЕГІЯ A — Crash + фіксований кешаут (як `golf_crash_math.rtp.simulate`)")
    print("=" * 72)
    print()

    reference = 1.50
    ref_payout = payout_by_target.get(reference, None)
    for t in sorted(targets):
        paid = payout_by_target[t]
        rtp = paid / total_stake if total_stake else 0.0
        house = total_stake - paid
        st = stats[t]
        jc = st["jackpot_rounds"]
        cc = st["crash_cashouts"]
        bust = st["crash_busts"]
        jp_sum = jackpot_pay_by_target[t]
        cc_sum = crash_cash_pay_by_target[t]
        print(f"  Таргет кешауту x{t:g}")
        print(f"    Усього виплачено гравцям: {_money(paid)}")
        print(f"      з них hole-in-one:      {_money(jp_sum)}  ({jc:,} разів)")
        print(f"      з них кешаут на краші:  {_money(cc_sum)}  ({cc:,} разів)")
        print(f"    Реалізований RTP:        {rtp * 100:.4f}% від обороту")
        print(f"    Прибуток казино (валовий до витрат): {_money(house)}")
        print(f"    Чистий результат гравців сукупно:     {_money(paid - total_stake)}")
        print(f"    Без повернення (pre_shot або краш нижче таргету): раундів {c_pre + bust:,}")
        print(f"       — pre_shot_fail:                      {c_pre:,}")
        print(f"       — краш упав нижче x{t:g}:            {bust:,}")
        print()

    print(
        "  Орієнтир тестів math-sdk (`test_simulate_rtp_in_target_band`): таргет x1.5, "
        f"очікуваний RTP у широкій смузі (~88–99% на 200k)."
    )
    if ref_payout is not None:
        ref_rtp = ref_payout / total_stake
        print(f"  Тут для x{reference:g} та {rounds:,} раундів RTP = {ref_rtp * 100:.4f}%.")

    print()
    print("=" * 72)
    print("  СТРАТЕГІЯ B — Летіти до кінця без кешауту (логіка `round.ts` клієнта)")
    print("=" * 72)
    print("    Виграш, якщо не pre_shot, не hole, і немає `isZeroCrash`, і зона fairway/sand/cart.")
    print("    Виграш = ставка × crash_multiplier на кінець польоту.")
    print()
    print("  УВАГА: при таких правилах RTP може перевищувати 100 %, бо при посадці")
    print("          на fairway/sand/cart виплачається ставка × crash_multiplier з книги,")
    print("          з важким правим хвостом. Для «прибутку казино» орієнтуйтесь на секцію A.")
    print()

    pr = payout_ride_total
    ride_from_jackpot = c_hole * bet * JACKPOT_MULT
    ride_from_crash_land = max(0.0, pr - ride_from_jackpot)
    rtp_r = pr / total_stake if total_stake else 0.0
    house_r = total_stake - pr
    print(f"    Усього виплачено гравцям: {_money(pr)}")
    print(f"      з них hole-in-one: {_money(ride_from_jackpot)}  ({c_hole:,} разів)")
    print(f"      з них краш із безпечною посадкою (fairway/sand/cart без isZeroCrash): {_money(ride_from_crash_land)}")
    print(f"    Реалізований RTP:        {rtp_r * 100:.4f}%")
    print(f"    Прибуток казино:         {_money(house_r)}")
    print(f"    Чистий результат гравців: {_money(pr - total_stake)}")
    print(f"    Раундів із виплатою > 0:  {ride_win_rounds:,}")
    print(f"    Раундів із виплатою 0:    {ride_loss_rounds:,}")
    print()

    print("=" * 72)
    print("  ПІДСУМОК")
    print("=" * 72)
    print(
        "  «Поточний RTP» у документації math-sdk традиційно міряють через стратегію "
        "**кешаут до краш-множника** (секція A), а не через «до кінця» (секція B)."
    )
    print(
        f"  Для ставки {_money(bet)} та {rounds:,} ітерацій: оборот казино {_money(total_stake)}; "
        "прибуток казино = оборот мінус сума повернень гравцю."
    )

    foot = """
  Застереження: реальний GGR оператора знижують промо, податки, джекпот-резерв, мережа.
  Джекпот у моделі кешаута записаний як max(таргет, JACKPOT); при таргеті > {}
  це було б нереалістично порівнювати з продуктом — усі стандартні таргети нижчі.
"""
    print(foot.format(int(JACKPOT_MULT)))
    print()


if __name__ == "__main__":
    main()
