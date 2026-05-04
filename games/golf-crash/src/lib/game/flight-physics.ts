/** Target on-screen flight duration (wall-clock) — 5–7 s, Aviator-style. */
export const FLIGHT_DURATION_WALL_SEC_MIN = 5;
export const FLIGHT_DURATION_WALL_SEC_MAX = 7;

/** Wall-clock flight length; plan `crashAtSec` is clamped into this band. */
export const getFlightDurationSec = (crashAtSec: number): number => {
  if (!Number.isFinite(crashAtSec) || crashAtSec <= 0) {
    return FLIGHT_DURATION_WALL_SEC_MIN;
  }
  return Math.min(
    FLIGHT_DURATION_WALL_SEC_MAX,
    Math.max(FLIGHT_DURATION_WALL_SEC_MIN, crashAtSec),
  );
};

/**
 * Longer arc and reach in the same seconds → higher mean ball speed.
 * Hazard track (`plannedHazardImpactPosition`) uses the same helpers — stays in sync.
 */
export const FLIGHT_PATH_SPEED_MUL = 3;

/**
 * Floor on horizontal reach (world px): for small crashMultiplier the log term is ~0,
 * and with the same 5–7 s the ball would barely move — this removes the “snail” near low X.
 */
export const FLIGHT_REACH_FLOOR_PX = 3000;

/** Minimum arc apex height so a low multiplier does not look like sliding on the ground. */
export const FLIGHT_ARC_HEIGHT_FLOOR_PX = 360;

/** Horizontal reach (px) from tee: log growth vs crash multiplier — matches hazard track + arc. */
export const flightReachFromMultiplier = (crashMultiplier: number): number => {
  const m = Math.max(1, crashMultiplier);
  const raw = (Math.log(m) * 1200 + 300) * FLIGHT_PATH_SPEED_MUL;
  return Math.max(raw, FLIGHT_REACH_FLOOR_PX);
};

/** Parabola height (px) at arc apex — higher X → higher flight. */
export const flightArcHeightFromMultiplier = (
  crashMultiplier: number,
): number => {
  const m = Math.max(1.2, crashMultiplier);
  const raw = Math.log(m) * 400 * FLIGHT_PATH_SPEED_MUL;
  return Math.max(raw, FLIGHT_ARC_HEIGHT_FLOOR_PX);
};

/**
 * Tee already near target (chip by the green): full arc height reads as only flying up.
 * Scale apex by horizontal span — same formula as hazards use via shared multiplier curve.
 */
export const FLIGHT_ARC_HORIZONTAL_REF_PX = 1400;

export const arcHeightDampedBySpan = (
  baseArcHeightPx: number,
  horizontalSpanPx: number,
): number => {
  if (baseArcHeightPx <= 0 || horizontalSpanPx <= 0) return 0;
  const t = Math.min(1, horizontalSpanPx / FLIGHT_ARC_HORIZONTAL_REF_PX);
  return baseArcHeightPx * t;
};

/** Flight fraction where the hazard impact happens (late on the arc — avoids early ball teleport). */
export const PRIMARY_IMPACT_PROGRESS = 0.93;
