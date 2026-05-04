import { Assets, type Texture } from "pixi.js";
import {
  WORLD_W,
  GROUND_Y,
  FRONT_TILE_HEIGHT,
  HORIZON_Y_VAL,
  SURFACE_STEP_PX,
} from "../constants/world-metrics.js";
import {
  readRoadProfileFromTexture,
  sampledSurfaceBands,
} from "./road-profile-texture.js";
import { TERRAIN_ROAD_WORLD_PADDING_PX } from "./terrain-builder-constants.js";

const FRONT_CHUNK_ALIASES = [
  "front1",
  "front2",
  "front3",
  "front4",
  "front5",
  "front6",
] as const;

/**
 * Build `hillSurfaceY` from stitched front-parallax silhouettes (`front_*.svg`).
 * Writes global sampled-band arrays for procedural terrain shaders.
 */
export const sampleFairwaySurfaceFromAssets = async (
  _assetsBase: string,
): Promise<(x: number) => number> => {
  const seamOverlap = 1;
  const baseTex = Assets.get(FRONT_CHUNK_ALIASES[0]!) as Texture;
  const uniformScale = FRONT_TILE_HEIGHT / baseTex.height;

  const cells = Math.ceil(WORLD_W / SURFACE_STEP_PX) + 1;
  const accTop = new Float32Array(cells);
  const accBottom = new Float32Array(cells);
  const counts = new Uint16Array(cells);

  let currentX = -TERRAIN_ROAD_WORLD_PADDING_PX;
  let index = 0;
  while (currentX < WORLD_W + TERRAIN_ROAD_WORLD_PADDING_PX * 2) {
    const alias = FRONT_CHUNK_ALIASES[index % FRONT_CHUNK_ALIASES.length]!;
    const profile = readRoadProfileFromTexture(alias);
    const actualRenderedWidth = profile.width * uniformScale;
    const chunkVisualWidth = actualRenderedWidth + 1.5;
    const spriteX = Math.floor(currentX);

    for (let col = 0; col < profile.width; col += 1) {
      const localNx = col / Math.max(1, profile.width - 1);
      const worldX = spriteX + localNx * chunkVisualWidth;
      const topY = profile.top[col]!;
      const bottomY = profile.bottom[col]!;
      const worldTop = HORIZON_Y_VAL - (profile.height - topY) * uniformScale;
      const worldBottom =
        HORIZON_Y_VAL - (profile.height - bottomY) * uniformScale;
      const cell = Math.floor(worldX / SURFACE_STEP_PX);
      if (cell >= 0 && cell < cells) {
        accTop[cell] += worldTop;
        accBottom[cell] += worldBottom;
        counts[cell]! += 1;
      }
    }
    currentX += actualRenderedWidth - seamOverlap;
    index += 1;
  }

  const topTable = new Float32Array(cells);
  const bottomTable = new Float32Array(cells);
  for (let i = 0; i < cells; i++) {
    if (counts[i]! > 0) {
      topTable[i] = accTop[i]! / counts[i]!;
      bottomTable[i] = accBottom[i]! / counts[i]!;
    } else {
      topTable[i] = Number.NaN;
      bottomTable[i] = Number.NaN;
    }
  }
  let lastValidTop = GROUND_Y - 250;
  let lastValidBottom = lastValidTop + 120;
  for (let i = 0; i < cells; i += 1) {
    if (Number.isNaN(topTable[i]) || Number.isNaN(bottomTable[i])) {
      topTable[i] = lastValidTop;
      bottomTable[i] = lastValidBottom;
    } else {
      lastValidTop = topTable[i]!;
      lastValidBottom = bottomTable[i]!;
    }
  }
  for (let i = cells - 1; i >= 0; i -= 1) {
    if (Number.isNaN(topTable[i])) topTable[i] = lastValidTop;
    else lastValidTop = topTable[i]!;
    if (Number.isNaN(bottomTable[i])) bottomTable[i] = lastValidBottom;
    else lastValidBottom = bottomTable[i]!;
  }

  const smoothedTop = new Float32Array(cells);
  const smoothedBottom = new Float32Array(cells);
  for (let i = 0; i < cells; i += 1) {
    const aTop = topTable[Math.max(0, i - 1)]!;
    const bTop = topTable[i]!;
    const cTop = topTable[Math.min(cells - 1, i + 1)]!;
    const aBottom = bottomTable[Math.max(0, i - 1)]!;
    const bBottom = bottomTable[i]!;
    const cBottom = bottomTable[Math.min(cells - 1, i + 1)]!;
    smoothedTop[i] = (aTop + bTop + cTop) / 3;
    smoothedBottom[i] = Math.max(
      smoothedTop[i]! + 40,
      (aBottom + bBottom + cBottom) / 3,
    );
  }
  sampledSurfaceBands.top = smoothedTop;
  sampledSurfaceBands.bottom = smoothedBottom;

  return (x: number): number => {
    const idxF = x / SURFACE_STEP_PX;
    const i0 = Math.max(0, Math.min(cells - 1, Math.floor(idxF)));
    const i1 = Math.max(0, Math.min(cells - 1, Math.ceil(idxF)));
    const t = idxF - Math.floor(idxF);
    return smoothedTop[i0]! * (1 - t) + smoothedTop[i1]! * t;
  };
};
