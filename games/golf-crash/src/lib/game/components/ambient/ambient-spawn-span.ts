import { BALL_START_X, PLAY_END_X } from "../constants/world-metrics.js";

/** Horizontal interval where ambient mobs sample X (fairway corridor, not full map overscan). */
export const getAmbientSpawnXSpan = (
  worldW: number,
  viewportW?: number,
): { x0: number; x1: number } => {
  const safeWorldW = Math.max(1, worldW);
  const safeViewportW = Math.max(1, viewportW ?? safeWorldW);
  const viewportRatio = Math.min(1, Math.max(0.25, safeViewportW / safeWorldW));
  const padRaw = safeWorldW * (0.07 + 0.18 * viewportRatio);
  const pad = Math.min(560, Math.max(180, padRaw));
  const x0 = Math.max(100, BALL_START_X - pad);
  const x1 = Math.min(worldW - 100, PLAY_END_X + pad);
  const minSpan = Math.min(
    safeWorldW * 0.9,
    Math.max(420, safeViewportW * 1.2),
  );
  if (x1 - x0 < minSpan) return { x0: 0, x1: worldW };
  return { x0, x1 };
};
