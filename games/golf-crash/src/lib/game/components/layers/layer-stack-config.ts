import type { ObjectLayerId } from "../core/world-types.js";

/**
 * Tunable vertical stack (world Y grows downward). L0 sits lowest; each next layer
 * stacks **above** (smaller Y). Bottom edge of L0 = `groundY + l0BottomOffsetPx`.
 *
 * Edit these values to reposition ambient bands; `createStackedObjectLayers` reads them.
 */
export const LAYER_STACK_L0_BOTTOM_OFFSET_PX = 80;

/** Band thickness per layer (world px). Sum sets total stack height above the anchor. */
export const AMBIENT_LAYER_BAND_HEIGHTS: Record<ObjectLayerId, number> = {
  0: 400,
  1: 700,
  2: 900,
  3: 1100,
  4: 1300,
  5: 1500,
};

/**
 * Extra vertical gap between stacked bands (world px). Pure spacing — no ambient spawn there.
 * `gapsPx[i]` = distance between **top** of L{i} and **bottom** of L{i+1} (i = 0…4).
 */
export const AMBIENT_LAYER_STACK_GAPS_PX: readonly [
  number,
  number,
  number,
  number,
  number,
] = [250, 0, 0, 0, 0];
