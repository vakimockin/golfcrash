import { BALL_START_X, PLAY_END_X } from "../constants/world-metrics.js";

/** Horizontal interval where ambient mobs sample X (fairway corridor, not full map overscan). */
export const getAmbientSpawnXSpan = (
  worldW: number,
): { x0: number; x1: number } => {
  const pad = 300;
  const x0 = Math.max(100, BALL_START_X - pad);
  const x1 = Math.min(worldW - 100, PLAY_END_X + pad);
  if (x1 - x0 < 400) return { x0: 0, x1: worldW };
  return { x0, x1 };
};
