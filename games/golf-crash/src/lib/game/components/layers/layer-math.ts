import type { ObjectLayerId, ObjectLayers } from "../core/world-types.js";

export const createObjectLayers = (
  groundY: number,
  canvasH: number,
  scale: number,
  screensToSpace: number,
): ObjectLayers => {
  const safeScale = Math.max(0.0001, scale);
  const dynamicFlightSpan = (canvasH / safeScale) * screensToSpace;
  return {
    0: { name: "ground", centerY: groundY - 110 },
    1: { name: "low-air", centerY: groundY - dynamicFlightSpan * 0.06 },
    2: { name: "mid-air", centerY: groundY - dynamicFlightSpan * 0.15 },
    3: { name: "high-air", centerY: groundY - dynamicFlightSpan * 0.28 },
    4: { name: "atmosphere", centerY: groundY - dynamicFlightSpan * 0.48 },
    5: { name: "space", centerY: groundY - dynamicFlightSpan * 0.58 },
  };
};

export const altitudeBandForLayer = (
  layers: ObjectLayers,
  layerId: ObjectLayerId,
): { minY: number; maxY: number } => {
  const c = layers[layerId].centerY;
  const half =
    layerId === 0 ? 130 : layerId === 5 ? 520 : layerId === 4 ? 380 : 340;
  return { minY: c - half, maxY: c + half };
};
