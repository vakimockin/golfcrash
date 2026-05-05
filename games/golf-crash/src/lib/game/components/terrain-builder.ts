import {
  Assets,
  Container,
  FillGradient,
  Graphics,
  Sprite,
  type Texture,
} from "pixi.js";
import type { TerrainLayers } from "./world-types.js";

type RoadProfile = {
  width: number;
  height: number;
  top: number[];
  bottom: number[];
};

type TerrainBuilderArgs = {
  tint: number;
  worldW: number;
  groundY: number;
  frontTileHeight: number;
  surfaceStepPx: number;
  sampledSurfaceTop: Float32Array | null;
  sampledSurfaceBottom: Float32Array | null;
  hillSurfaceY: (x: number) => number;
  readRoadProfileFromTexture: (alias: string) => RoadProfile;
  setSpriteVisualWidth: (sprite: Sprite, width: number, flip?: boolean) => void;
  /** No procedural water sprites / physics hollow in this world-X span (tee + player). */
  waterForbiddenInterval?: { minX: number; maxX: number };
};

export type HazardZone = {
  type: "water" | "sand";
  startX: number;
  endX: number;
  topY: number;
};

/**
 * Scan the terrain curve and pick out two kinds of hazard zones:
 *   - water: a local depression bounded by two lips of similar height. The
 *            water level is set just below the LOWER lip so it can never
 *            overflow either edge. Depth between lip and valley floor must
 *            exceed `MIN_VALLEY_DEPTH`.
 *   - sand:  stretches where the surface is nearly flat (max − min <
 *            `FLAT_TOLERANCE`). Only segments at least `SAND_FLAT_MIN_PX`
 *            wide (and up to FLAT_MAX_WIDTH). Does not overlap water claims.
 *
 * The function is purely deterministic and uses only `hillSurfaceY` so the
 * zones it returns line up exactly with the red physics route line.
 */
const rangesOverlapWorldX = (
  aMin: number,
  aMax: number,
  bMin: number,
  bMax: number,
): boolean => !(aMax < bMin || aMin > bMax);

export const analyzeTerrainForHazards = (
  worldW: number,
  hillSurfaceY: (x: number) => number,
  waterForbidden?: { minX: number; maxX: number } | undefined,
): HazardZone[] => {
  const waterForbiddenOverlap = (startX: number, endX: number): boolean =>
    waterForbidden !== undefined &&
    rangesOverlapWorldX(startX, endX, waterForbidden.minX, waterForbidden.maxX);

  const STEP = 8;
  const sampleCount = Math.floor(worldW / STEP) + 1;
  const samples: number[] = new Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    samples[i] = hillSurfaceY(i * STEP);
  }

  const zones: HazardZone[] = [];
  const claimed: Array<{ start: number; end: number }> = [];
  const overlapsClaimed = (a: number, b: number): boolean =>
    claimed.some((c) => !(b < c.start || a > c.end));

  const VALLEY_MIN_WIDTH = 220;
  const VALLEY_MAX_WIDTH = 320;
  const VALLEY_MIN_DEPTH = 14;
  const VALLEY_LIP_TOLERANCE = 32;
  const minIdxStep = Math.max(1, Math.floor(VALLEY_MIN_WIDTH / STEP));
  const maxIdxStep = Math.max(
    minIdxStep + 1,
    Math.floor(VALLEY_MAX_WIDTH / STEP),
  );

  for (let leftIdx = 0; leftIdx < sampleCount; leftIdx += 2) {
    const leftY = samples[leftIdx]!;
    let bestRight = -1;
    let bestDepth = 0;
    for (let widthIdx = minIdxStep; widthIdx <= maxIdxStep; widthIdx += 2) {
      const rightIdx = leftIdx + widthIdx;
      if (rightIdx >= sampleCount) break;
      const rightY = samples[rightIdx]!;
      if (Math.abs(leftY - rightY) > VALLEY_LIP_TOLERANCE) continue;
      const waterLevel = Math.max(leftY, rightY) + 4;
      let hasHill = false;
      let valleyMaxY = -Infinity;
      for (let k = leftIdx + 1; k < rightIdx; k += 1) {
        const v = samples[k]!;
        // Y grows downward, so smaller Y means higher elevation.
        // If any inner point rises above water level, this is not a
        // clean bowl and should not become a water hazard.
        if (v < waterLevel - 5) {
          hasHill = true;
          break;
        }
        if (v > valleyMaxY) valleyMaxY = v;
      }
      if (hasHill) continue;
      const lipY = Math.min(leftY, rightY);
      const depth = valleyMaxY - lipY;
      if (depth >= VALLEY_MIN_DEPTH && depth > bestDepth) {
        bestDepth = depth;
        bestRight = rightIdx;
      }
    }
    if (bestRight >= 0) {
      let refinedLeft = leftIdx;
      let refinedRight = bestRight;
      // Snap hazard lips to the actual slope transitions so trap edges
      // start where the terrain begins descending and end where it climbs
      // back up, instead of using raw index bounds.
      while (
        refinedLeft + 2 < refinedRight &&
        samples[refinedLeft + 1]! <= samples[refinedLeft]!
      ) {
        refinedLeft += 1;
      }
      while (
        refinedRight - 2 > refinedLeft &&
        samples[refinedRight - 1]! <= samples[refinedRight]!
      ) {
        refinedRight -= 1;
      }
      const startX = refinedLeft * STEP;
      const endX = refinedRight * STEP;
      const lowerLipY = Math.max(leftY, samples[bestRight]!);
      if (!waterForbiddenOverlap(startX, endX)) {
        zones.push({
          type: "water",
          startX,
          endX,
          topY: lowerLipY + 15,
        });
        claimed.push({ start: startX, end: endX });
      }
      // Вода тільки в заглибинах; у забороненій ділянці (tee) — жодного хазарду.
      // Пісок тільки з окремого проходу по рівних ділянках нижче.
      leftIdx = bestRight; // skip past this valley
    }
  }
  if (!zones.some((z) => z.type === "water")) {
    let bestFallback: {
      startX: number;
      endX: number;
      topY: number;
      depth: number;
    } | null = null;
    for (let leftIdx = 0; leftIdx < sampleCount; leftIdx += 2) {
      const leftY = samples[leftIdx]!;
      for (let widthIdx = minIdxStep; widthIdx <= maxIdxStep; widthIdx += 2) {
        const rightIdx = leftIdx + widthIdx;
        if (rightIdx >= sampleCount) break;
        const rightY = samples[rightIdx]!;
        if (Math.abs(leftY - rightY) > VALLEY_LIP_TOLERANCE) continue;
        let valleyMaxY = -Infinity;
        for (let k = leftIdx + 1; k < rightIdx; k += 1) {
          const v = samples[k]!;
          if (v > valleyMaxY) valleyMaxY = v;
        }
        const lipY = Math.min(leftY, rightY);
        const depth = valleyMaxY - lipY;
        if (depth < VALLEY_MIN_DEPTH) continue;
        const startX = leftIdx * STEP;
        const endX = rightIdx * STEP;
        if (overlapsClaimed(startX, endX)) continue;
        if (
          (!bestFallback || depth > bestFallback.depth) &&
          !waterForbiddenOverlap(startX, endX)
        ) {
          bestFallback = {
            startX,
            endX,
            topY: Math.max(leftY, rightY) + 4,
            depth,
          };
        }
      }
    }
    if (
      bestFallback &&
      !waterForbiddenOverlap(bestFallback.startX, bestFallback.endX)
    ) {
      zones.push({
        type: "water",
        startX: bestFallback.startX,
        endX: bestFallback.endX,
        topY: bestFallback.topY,
      });
      claimed.push({
        start: bestFallback.startX,
        end: bestFallback.endX,
      });
    }
  }

  const FLAT_MIN_WIDTH = 100;
  const FLAT_MAX_WIDTH = 400;
  const FLAT_TOLERANCE = 3;
  const flatMinIdx = Math.max(1, Math.floor(FLAT_MIN_WIDTH / STEP));
  const flatMaxIdx = Math.max(
    flatMinIdx + 1,
    Math.floor(FLAT_MAX_WIDTH / STEP),
  );

  let i = 0;
  while (i + flatMinIdx < sampleCount) {
    let minY = Infinity;
    let maxY = -Infinity;
    let endIdx = i + flatMinIdx;
    for (let k = i; k <= endIdx; k += 1) {
      const v = samples[k]!;
      if (v < minY) minY = v;
      if (v > maxY) maxY = v;
    }
    if (maxY - minY < FLAT_TOLERANCE) {
      while (endIdx + 1 < sampleCount && endIdx - i < flatMaxIdx) {
        const next = samples[endIdx + 1]!;
        const nextMin = Math.min(minY, next);
        const nextMax = Math.max(maxY, next);
        if (nextMax - nextMin >= FLAT_TOLERANCE) break;
        minY = nextMin;
        maxY = nextMax;
        endIdx += 1;
      }
      const startX = i * STEP;
      const endX = endIdx * STEP;
      if (!overlapsClaimed(startX, endX)) {
        zones.push({
          type: "sand",
          startX,
          endX,
          topY: samples[i]!,
        });
        claimed.push({ start: startX, end: endX });
      }
      i = endIdx + flatMinIdx; // skip ahead so flats don't crowd
    } else {
      i += 2;
    }
  }

  zones.sort((a, b) => a.startX - b.startX);
  return zones;
};

export const buildProceduralFrontTerrain = ({
  tint,
  worldW,
  groundY,
  frontTileHeight,
  surfaceStepPx,
  sampledSurfaceTop,
  sampledSurfaceBottom,
  hillSurfaceY,
  readRoadProfileFromTexture,
  setSpriteVisualWidth,
  waterForbiddenInterval,
}: TerrainBuilderArgs): TerrainLayers => {
  const root = new Container();
  const backTerrain = new Container();
  const midTerrain = new Container();
  const frontTerrain = new Container();
  frontTerrain.sortableChildren = true;
  const seamOverlap = 2;
  const worldSampleStep = 2;
  // Striped fairway uses tiled sprites along X; bending grass with the hill curve would need Mesh/Rope UV deformation — future improvement.

  const buildRoadLayer = (
    aliases: readonly string[],
    targetH: number,
    alpha = 1,
  ): {
    layer: Container;
    segments: Array<{ alias: string; x: number; width: number }>;
  } => {
    const layer = new Container();
    const segments: Array<{ alias: string; x: number; width: number }> = [];
    let index = 0;
    const baseTex = Assets.get(aliases[0]!);
    const uniformScale = targetH / baseTex.height;
    let currentX = -1000;
    while (currentX < worldW + 2000) {
      const alias = aliases[index % aliases.length]!;
      const tex = Assets.get(alias);
      const sprite = new Sprite(tex);
      sprite.anchor.set(0, 1);
      sprite.scale.set(uniformScale);
      sprite.x = Math.floor(currentX);
      sprite.y = 0;
      sprite.alpha = alpha;
      const actualRenderedWidth = sprite.width;
      sprite.width = actualRenderedWidth + 1.5;
      layer.addChild(sprite);
      segments.push({ alias, x: sprite.x, width: sprite.width });
      currentX += actualRenderedWidth - seamOverlap;
      index += 1;
    }
    return { layer, segments };
  };

  const buildRoadSamples = (
    segments: Array<{ alias: string; x: number; width: number }>,
    layerY: number,
    targetH: number,
  ): { top: number[]; bottom: number[] } => {
    const top = new Array<number>(worldW + 1).fill(Number.POSITIVE_INFINITY);
    const bottom = new Array<number>(worldW + 1).fill(Number.NEGATIVE_INFINITY);
    const baseTex = Assets.get(segments[0]!.alias) as Texture;
    const uniformScale = targetH / Math.max(1, baseTex.height);
    for (const segment of segments) {
      const profile = readRoadProfileFromTexture(segment.alias);
      const fromX = Math.max(0, Math.round(segment.x));
      const toX = Math.min(worldW, Math.round(segment.x + segment.width));
      for (let x = fromX; x <= toX; x += worldSampleStep) {
        const local = (x - segment.x) / Math.max(1, segment.width);
        const sampleX = Math.max(
          0,
          Math.min(profile.width - 1, Math.round(local * (profile.width - 1))),
        );
        const topY = profile.top[sampleX]!;
        const bottomY = profile.bottom[sampleX]!;
        const worldTop = layerY - (profile.height - topY) * uniformScale;
        const worldBottom = layerY - (profile.height - bottomY) * uniformScale;
        top[x] = Math.min(top[x]!, worldTop);
        bottom[x] = Math.max(bottom[x]!, worldBottom);
      }
    }
    let lastTop = layerY - targetH * 0.72;
    let lastBottom = layerY - targetH * 0.13;
    for (let x = 0; x <= worldW; x += 1) {
      if (Number.isFinite(top[x]!)) lastTop = top[x]!;
      else top[x] = lastTop;
      if (Number.isFinite(bottom[x]!)) lastBottom = bottom[x]!;
      else bottom[x] = lastBottom;
    }
    return { top, bottom };
  };

  const HORIZON_Y = groundY + 110;
  const MID_LAYER_Y = HORIZON_Y - 130;
  const BACK_LAYER_Y = HORIZON_Y - 180;

  const frontTargetH = frontTileHeight;
  const middleTargetH = frontTargetH * 0.8;
  const backTargetH = frontTargetH * 0.9;
  const frontBuilt = buildRoadLayer(
    ["front1", "front2", "front3", "front4", "front5", "front6"],
    frontTargetH,
    1,
  );
  const middleBuilt = buildRoadLayer(
    ["middle1", "middle2", "middle3", "middle4", "middle5", "middle6"],
    middleTargetH,
    0.98,
  );
  const backBuilt = buildRoadLayer(
    ["back1", "back2", "back3", "back4", "back5", "back6"],
    backTargetH,
    0.98,
  );

  backTerrain.y = BACK_LAYER_Y;
  backTerrain.scale.set(0.7);
  midTerrain.y = MID_LAYER_Y;
  midTerrain.scale.set(0.85);
  frontTerrain.y = HORIZON_Y;
  backTerrain.addChild(backBuilt.layer);
  midTerrain.addChild(middleBuilt.layer);
  frontTerrain.addChild(frontBuilt.layer);

  const sampled =
    sampledSurfaceTop && sampledSurfaceBottom
      ? (() => {
          const top = new Array<number>(worldW + 1);
          const bottom = new Array<number>(worldW + 1);
          for (let x = 0; x <= worldW; x += 1) {
            const idxF = x / surfaceStepPx;
            const i0 = Math.max(
              0,
              Math.min(sampledSurfaceTop.length - 1, Math.floor(idxF)),
            );
            const i1 = Math.max(
              0,
              Math.min(sampledSurfaceTop.length - 1, Math.ceil(idxF)),
            );
            const t = idxF - Math.floor(idxF);
            top[x] =
              sampledSurfaceTop[i0]! * (1 - t) + sampledSurfaceTop[i1]! * t;
            bottom[x] =
              sampledSurfaceBottom[i0]! * (1 - t) +
              sampledSurfaceBottom[i1]! * t;
          }
          return { top, bottom };
        })()
      : null;
  const samples =
    sampled ??
    buildRoadSamples(frontBuilt.segments, frontTerrain.y, frontTargetH);
  // Bush/hole generation removed by request.
  // ─── Procedural hazards + route integration ──────────────────────────
  const hazardLayer = new Container();
  hazardLayer.sortableChildren = true;
  hazardLayer.zIndex = 5;
  const hazardZones = analyzeTerrainForHazards(
    worldW,
    hillSurfaceY,
    waterForbiddenInterval,
  );
  const localY = (worldY: number): number => worldY - frontTerrain.y;
  // const routeLine = new Graphics();
  // const SHOW_ROUTE_DEBUG = true;
  // if (SHOW_ROUTE_DEBUG) {
  //   routeLine.moveTo(0, hillSurfaceY(0) - frontTerrain.y);
  //   for (let x = 1; x <= worldW; x += 1) {
  //     routeLine.lineTo(x, hillSurfaceY(x) - frontTerrain.y);
  //   }
  //   routeLine.stroke({ color: 0xff2a2a, width: 4, alpha: 0.96 });
  // }
  // frontTerrain.addChild(routeLine);

  const waterAssets = [
    "water_trap_1",
    "water_trap_2",
    "water_trap_3",
    "water_trap_4",
  ];
  const sandAssets = ["sand_trap_1", "sand_trap_2"];

  for (const [index, zone] of hazardZones.entries()) {
    const { startX, endX } = zone;
    const width = Math.max(1, endX - startX);
    const centerX = (startX + endX) / 2;

    const isWater = zone.type === "water";
    const assets = isWater ? waterAssets : sandAssets;
    const alias = assets[index % assets.length]!;

    const sprite = new Sprite(Assets.get(alias));
    sprite.x = centerX;

    if (isWater) {
      sprite.anchor.set(0.5, 0.2);
      sprite.y = localY(zone.topY);
      sprite.width = width + 15;
      const depth = Math.abs(localY(hillSurfaceY(centerX)) - sprite.y);
      sprite.height = depth + 70;
      sprite.zIndex = 5;
    } else {
      // Bottom-center: base of the sand SVG sits on the fairway surface.
      sprite.anchor.set(0.5, 0);
      sprite.y = localY(hillSurfaceY(centerX));
      sprite.width = width;
      sprite.height = Math.min(50, width * 0.25);
      sprite.zIndex = 4;
    }

    hazardLayer.addChild(sprite);
  }
  hazardLayer.sortChildren();
  frontTerrain.addChild(hazardLayer);

  const waterBandBackdropGradient = new FillGradient({
    type: "linear",
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    textureSpace: "local",
    colorStops: [
      { offset: 0, color: 0xaee5fc },
      { offset: 0.45, color: 0x5699c9 },
      { offset: 1, color: 0x0d253f },
    ],
  });
  const waterBackdrop = new Graphics();
  waterBackdrop
    .rect(-1000, localY(groundY + 88), worldW + 2000, 5200)
    .fill(waterBandBackdropGradient);

  const groundFill = new Graphics();
  groundFill.rect(-1000, frontTargetH - 20, worldW + 2000, 4200).fill(0x182028);
  frontTerrain.addChildAt(groundFill, 0);
  frontTerrain.addChildAt(waterBackdrop, 1);

  frontTerrain.setChildIndex(groundFill, 0);
  frontTerrain.setChildIndex(waterBackdrop, 1);
  frontTerrain.setChildIndex(frontBuilt.layer, 2);
  frontTerrain.setChildIndex(hazardLayer, 3);
  // frontTerrain.setChildIndex(routeLine, 4);
  frontTerrain.sortChildren();
  frontTerrain.tint = tint;
  // Atmospheric perspective: distant ridge cooler / bluer than mid-ground.
  midTerrain.tint = 0xc8dcc8;
  backTerrain.tint = 0x4a6d94;
  midTerrain.alpha = 0.88;
  backTerrain.alpha = 0.76;

  root.addChild(backTerrain);
  root.addChild(midTerrain);
  root.addChild(frontTerrain);
  return { root, backTerrain, midTerrain, frontTerrain };
};
