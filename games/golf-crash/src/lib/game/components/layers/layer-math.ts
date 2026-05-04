import type { ObjectLayerId, ObjectLayers } from "../core/world-types.js";
import {
  AMBIENT_LAYER_BAND_HEIGHTS,
  AMBIENT_LAYER_STACK_GAPS_PX,
  LAYER_STACK_L0_BOTTOM_OFFSET_PX,
} from "./layer-stack-config.js";

const layerNames: Record<ObjectLayerId, string> = {
  0: "ground",
  1: "low-air",
  2: "mid-air",
  3: "high-air",
  4: "atmosphere",
  5: "space",
};

/**
 * Layers stacked upward from `groundY + l0Bottom`: L0 is the lowest band, L5 the highest.
 * Each band gets height from `heights[id]`; optional `gapsPx[i]` inserts space between L{i} and L{i+1}.
 */
export const createStackedObjectLayers = (
  groundY: number,
  heights: Record<ObjectLayerId, number> = AMBIENT_LAYER_BAND_HEIGHTS,
  l0BottomOffset = LAYER_STACK_L0_BOTTOM_OFFSET_PX,
  gapsPx: readonly number[] = AMBIENT_LAYER_STACK_GAPS_PX,
): ObjectLayers => {
  let layerBottom = groundY + l0BottomOffset;
  const out = {} as ObjectLayers;
  for (let id = 0 as ObjectLayerId; id <= 5; id = (id + 1) as ObjectLayerId) {
    if (id > 0) {
      const gap = Math.max(0, gapsPx[id - 1] ?? 0);
      layerBottom -= gap;
    }
    const h = Math.max(40, heights[id] ?? 200);
    const top = layerBottom - h;
    const centerY = (top + layerBottom) / 2;
    out[id] = {
      name: layerNames[id]!,
      centerY,
      bandHeight: h,
    };
    layerBottom = top;
  }
  /** L4 ↔ L5: atmosphere band and space band swap vertical order (ids / spawn logic unchanged). */
  const g4 = out[4]!;
  const g5 = out[5]!;
  out[4] = {
    name: layerNames[4]!,
    centerY: g5.centerY,
    bandHeight: g5.bandHeight,
  };
  out[5] = {
    name: layerNames[5]!,
    centerY: g4.centerY,
    bandHeight: g4.bandHeight,
  };
  return out;
};

/** Legacy flight-span layout (viewport-linked). Kept for reference / tooling; gameplay uses `createStackedObjectLayers`. */
export const createObjectLayers = (
  groundY: number,
  canvasH: number,
  scale: number,
  screensToSpace: number,
): ObjectLayers => {
  const safeScale = Math.max(0.0001, scale);
  const dynamicFlightSpan = (canvasH / safeScale) * screensToSpace;
  const half = (id: ObjectLayerId): number =>
    id === 0 ? 130 : id === 5 ? 520 : id === 4 ? 380 : 340;
  const layer = (
    id: ObjectLayerId,
    centerY: number,
  ): ObjectLayers[ObjectLayerId] => ({
    name: layerNames[id]!,
    centerY,
    bandHeight: half(id) * 2,
  });
  return {
    0: layer(0, groundY - 110),
    1: layer(1, groundY - dynamicFlightSpan * 0.06),
    2: layer(2, groundY - dynamicFlightSpan * 0.15),
    3: layer(3, groundY - dynamicFlightSpan * 0.28),
    4: layer(4, groundY - dynamicFlightSpan * 0.58),
    5: layer(5, groundY - dynamicFlightSpan * 0.48),
  };
};

export const altitudeBandForLayer = (
  layers: ObjectLayers,
  layerId: ObjectLayerId,
): { minY: number; maxY: number } => {
  const L = layers[layerId];
  const half = L.bandHeight / 2;
  const c = L.centerY;
  return { minY: c - half, maxY: c + half };
};
