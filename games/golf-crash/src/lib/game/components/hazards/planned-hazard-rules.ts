import type { CrashCause, DecorativeEvent } from "../math/math.js";
import type { ObjectLayerId, ObjectLayers } from "../core/world-types.js";
import { PLAY_END_X } from "../constants/world-metrics.js";
import { GOLF_CART_ASSET_ALIAS } from "../sprites/golf-cart-sprite.js";
import { flightReachFromMultiplier } from "../../flight-physics.js";

export const hazardAliasFor = (
  kind: DecorativeEvent["kind"] | CrashCause,
): string | null => {
  switch (kind) {
    case "bird":
      return "bird";
    case "plane":
      return "plane2";
    case "helicopter":
      return "helicopter2";
    case "cart":
      return GOLF_CART_ASSET_ALIAS;
    case "fakeBoost":
      return "ufo";
    default:
      return null;
  }
};

export const layerForKind = (
  kind: DecorativeEvent["kind"] | CrashCause,
): ObjectLayerId =>
  kind === "cart"
    ? 0
    : kind === "bird" || kind === "wind"
      ? 1
      : kind === "helicopter"
        ? 2
        : kind === "plane"
          ? 3
          : kind === "fakeBoost"
            ? 5
            : 4;

/** Along-flight position: same log reach as the ball, fraction `atSec / crashAtSec`. */
export const plannedHazardImpactPosition = (
  kind: DecorativeEvent["kind"] | CrashCause,
  atSec: number,
  currentTeeX: number,
  layers: ObjectLayers,
  hillSurfaceY: (x: number) => number,
  track: { crashMultiplier: number; crashAtSec: number },
): { x: number; y: number } => {
  const layerId = layerForKind(kind);
  const crashT = Math.max(0.05, track.crashAtSec);
  const mult = Math.max(1, track.crashMultiplier);
  const totalDist = flightReachFromMultiplier(mult);
  const frac = Math.min(1, Math.max(0, atSec / crashT));
  const along = totalDist * frac;
  const x = Math.min(PLAY_END_X, currentTeeX + Math.max(120, along));
  const y = layerId === 0 ? hillSurfaceY(x) : layers[layerId].centerY;
  return { x, y };
};

export const hazardVelocity = (
  kind: DecorativeEvent["kind"] | CrashCause,
  primary: boolean,
): number => {
  const speedMul = primary ? 0.55 : 1;
  switch (kind) {
    case "cart":
      return 0;
    case "bird":
      return -90 * speedMul;
    case "helicopter":
      return -55 * speedMul;
    case "plane":
      return -120 * speedMul;
    case "fakeBoost":
      return -35 * speedMul;
    case "wind":
      return -45 * speedMul;
    default:
      return 0;
  }
};
