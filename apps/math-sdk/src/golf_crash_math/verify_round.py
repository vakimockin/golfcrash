"""Round verification helpers for fairness/audit workflows."""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from .rng import Seed, server_seed_hash
from .round import RoundResult, generate_round


def cashout_wins(*, crash_multiplier: float, cashout_target: float) -> bool:
    """Canonical settlement boundary: cashout at or below crash wins."""
    return cashout_target <= crash_multiplier


def verify_round(
    *,
    server_seed: str,
    client_seed: str,
    nonce: int,
    expected_server_seed_hash: str | None = None,
) -> dict[str, Any]:
    """Recompute a round and return verification metadata.

    The verifier is deterministic: same seed tuple always yields the same result.
    """
    seed = Seed(server_seed=server_seed, client_seed=client_seed, nonce=nonce)
    result = generate_round(seed)
    computed_hash = server_seed_hash(server_seed)
    hash_matches = (
        True
        if expected_server_seed_hash is None
        else computed_hash == expected_server_seed_hash.lower()
    )
    return {
        "seed": {"serverSeed": server_seed, "clientSeed": client_seed, "nonce": nonce},
        "serverSeedHash": computed_hash,
        "expectedServerSeedHash": expected_server_seed_hash,
        "serverSeedHashMatches": hash_matches,
        "roundId": result.round_id,
        "state": result.to_stake_engine_state(),
    }


def build_audit_log_entry(
    *,
    result: RoundResult,
    cashout_target: float | None = None,
    cashout_request_ts_ms: int | None = None,
    server_decision_ts_ms: int | None = None,
    decision: str | None = None,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    """Build a structured audit-log payload for append-only round logging."""
    return {
        "roundId": result.round_id,
        "seed": asdict(result.seed),
        "serverSeedHash": server_seed_hash(result.seed.server_seed),
        "outcome": result.outcome,
        "finalMultiplier": result.final_multiplier,
        "crashMultiplier": result.crash_multiplier,
        "crashAtSec": result.crash_at_sec,
        "preShotFail": result.pre_shot_fail,
        "crashCause": result.crash_cause,
        "landingZone": result.landing_zone,
        "bonusRoundTriggered": result.bonus_round_triggered,
        "nearMiss": result.near_miss,
        "cashoutTarget": cashout_target,
        "cashoutRequestTsMs": cashout_request_ts_ms,
        "serverDecisionTsMs": server_decision_ts_ms,
        "decision": decision,
        "idempotencyKey": idempotency_key,
    }


AUDIT_LOG_TEMPLATE: dict[str, Any] = {
    "roundId": "round-<16-hex>",
    "seed": {
        "server_seed": "<revealed-server-seed>",
        "client_seed": "<client-seed>",
        "nonce": 0,
    },
    "serverSeedHash": "<sha256(server_seed)>",
    "outcome": "crash|pre_shot_fail|hole_in_one",
    "finalMultiplier": 1.0,
    "crashMultiplier": 1.0,
    "crashAtSec": 0.0,
    "preShotFail": "mole|club_break|self_hit|null",
    "crashCause": "bird|wind|helicopter|plane|cart|landed|fakeBoost|null",
    "landingZone": "fairway|sand|water|cart|hole",
    "bonusRoundTriggered": False,
    "nearMiss": False,
    "cashoutTarget": 2.0,
    "cashoutRequestTsMs": 0,
    "serverDecisionTsMs": 0,
    "decision": "cashout_win|cashout_loss|pre_shot_fail",
    "idempotencyKey": "<unique-request-key>",
}
