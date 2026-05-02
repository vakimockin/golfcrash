"""Command-line entry: `python -m golf_crash_math.cli simulate`."""

from __future__ import annotations

import argparse
import json

from .rng import Seed
from .round import generate_stake_engine_state
from .rtp import simulate, simulate_table


def main() -> None:
    parser = argparse.ArgumentParser(prog="golf-crash-math")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sim = sub.add_parser("simulate", help="Run RTP simulation")
    sim.add_argument("--rounds", type=int, default=100_000)
    sim.add_argument("--target", type=float, default=1.5, help="Fixed cashout target")

    table = sub.add_parser(
        "rtp-table",
        help="Run RTP simulation across multiple cashout targets (sertification helper)",
    )
    table.add_argument("--rounds", type=int, default=200_000)
    table.add_argument(
        "--targets",
        type=str,
        default="1.20,1.50,2.00",
        help="Comma-separated cashout targets (default: three reference strategies)",
    )

    state = sub.add_parser("state", help="Print a Stake Engine-compatible round.state JSON")
    state.add_argument("--server-seed", required=True)
    state.add_argument("--client-seed", required=True)
    state.add_argument("--nonce", type=int, required=True)

    args = parser.parse_args()
    if args.cmd == "simulate":
        out = simulate(rounds=args.rounds, cashout_target=args.target)
        print(
            f"Rounds: {int(out['rounds']):,}  target: x{out['cashout_target']:.2f}  "
            f"RTP: {out['rtp'] * 100:.4f}%  "
            f"cashouts: {int(out['cashout_wins'])}  "
            f"crashes: {int(out['crash_losses'])}  "
            f"jackpots: {int(out['jackpots'])}  "
            f"pre-shot fails: {int(out['pre_shot_fails'])}  "
            f"bonus: {int(out['bonus_triggers'])}  "
            f"near-miss: {int(out['near_misses'])}"
        )
    elif args.cmd == "rtp-table":
        targets = tuple(float(t) for t in args.targets.split(","))
        rows = simulate_table(rounds=args.rounds, targets=targets)
        header = (
            f"{'target':>8}  {'RTP':>8}  {'cashouts':>10}  {'crashes':>10}  "
            f"{'jackpots':>9}  {'pre-fail':>9}  {'bonus':>7}  {'near-miss':>10}"
        )
        print(header)
        print("-" * len(header))
        for row in rows:
            print(
                f"x{row['cashout_target']:>6.2f}  "
                f"{row['rtp'] * 100:>7.4f}%  "
                f"{int(row['cashout_wins']):>10,}  "
                f"{int(row['crash_losses']):>10,}  "
                f"{int(row['jackpots']):>9,}  "
                f"{int(row['pre_shot_fails']):>9,}  "
                f"{int(row['bonus_triggers']):>7,}  "
                f"{int(row['near_misses']):>10,}"
            )
    elif args.cmd == "state":
        seed = Seed(
            server_seed=args.server_seed,
            client_seed=args.client_seed,
            nonce=args.nonce,
        )
        print(json.dumps(generate_stake_engine_state(seed), separators=(",", ":")))


if __name__ == "__main__":
    main()
