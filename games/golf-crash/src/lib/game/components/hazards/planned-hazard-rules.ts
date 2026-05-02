import type { CrashCause, DecorativeEvent } from "../math/math.js";
import type { ObjectLayerId, ObjectLayers } from "../core/world-types.js";
import { PLAY_END_X, BALL_SPEED_X } from "../constants/world-metrics.js";
import { GOLF_CART_ASSET_ALIAS } from "../sprites/golf-cart-sprite.js";

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

export const plannedHazardImpactPosition = (
  kind: DecorativeEvent["kind"] | CrashCause,
  atSec: number,
  currentTeeX: number,
  layers: ObjectLayers,
  hillSurfaceY: (x: number) => number,
): { x: number; y: number } => {
  const layerId = layerForKind(kind);
  const x = Math.min(
    PLAY_END_X,
    currentTeeX + Math.max(420, BALL_SPEED_X * atSec),
  );
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
      return 70 * speedMul;
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
