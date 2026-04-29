import { Assets, Container, Graphics, Sprite, type Texture } from "pixi.js";
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
}: TerrainBuilderArgs): TerrainLayers => {
  const root = new Container();
  const backTerrain = new Container();
  const midTerrain = new Container();
  const frontTerrain = new Container();
  const seamOverlap = 2;
  const worldSampleStep = 2;

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
  const middleTargetH = frontTargetH * 0.6;
  const backTargetH = frontTargetH * 0.6;
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
  const routeLine = new Graphics();
  routeLine.moveTo(0, hillSurfaceY(0) - frontTerrain.y);
  for (let x = 4; x <= worldW; x += 4) {
    routeLine.lineTo(x, hillSurfaceY(x) - frontTerrain.y);
  }
  routeLine.stroke({ color: 0xff2a2a, width: 4, alpha: 0.96 });
  frontTerrain.addChild(routeLine);

  // Bush/hole generation removed by request.

  const groundFill = new Graphics();
  groundFill.rect(-1000, frontTargetH - 20, worldW + 2000, 4200).fill(0x182028);
  frontTerrain.addChildAt(groundFill, 0);
  frontTerrain.tint = tint;
  midTerrain.tint = 0xd0d8e0;
  backTerrain.tint = 0xa0b0c0;
  midTerrain.alpha = 0.9;
  backTerrain.alpha = 0.78;

  root.addChild(backTerrain);
  root.addChild(midTerrain);
  root.addChild(frontTerrain);
  return { root, backTerrain, midTerrain, frontTerrain };
};
