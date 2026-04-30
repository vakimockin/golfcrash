import type { Container } from "pixi.js";
import type { VisualTimeMode } from "../../../stores/game.svelte.js";
import type { ObjectLayers, TerrainLayers } from "../core/world-types.js";
import {
  buildLayeredBackground as buildLayeredBackgroundComponent,
  type LayeredBackgroundRefs,
  type VisualWorldTheme as BackgroundVisualWorldTheme,
} from "../background/background-builder.js";
import {
  buildObjectLayerSystem as buildObjectLayerSystemComponent,
  type AmbientMobSpawn,
} from "../ambient/ambient-builder.js";
import { buildProceduralFrontTerrain as buildProceduralFrontTerrainComponent } from "./terrain-builder.js";
import {
  FRONT_TILE_HEIGHT,
  GROUND_Y,
  SURFACE_STEP_PX,
  WORLD_H,
  WORLD_W,
} from "../constants/world-metrics.js";
import {
  readRoadProfileFromTexture,
  sampledSurfaceBands,
} from "./road-profile-texture.js";
import { proceduralWaterForbiddenInterval } from "../gameplay/tee-water-interval.js";
import { hillSurfaceY } from "../map/map.js";
import type { VisualWorldTheme } from "../themes/visual-world-theme.js";
import { setSpriteVisualWidth } from "../sprites/sprite-placement.js";

/** Canvas/UI-layer background (sky, stripes) — sizing is viewport-relative. */
export const buildLayeredBackground = (
  parent: Container,
  mode: VisualTimeMode,
  theme: VisualWorldTheme,
  canvasW: number,
  canvasH: number,
  refs: LayeredBackgroundRefs | null = null,
): LayeredBackgroundRefs | null =>
  buildLayeredBackgroundComponent(
    parent,
    mode,
    theme as BackgroundVisualWorldTheme,
    canvasW,
    canvasH,
    WORLD_W,
    WORLD_H,
    GROUND_Y,
    refs,
  );

/** Ground strip with fairway masking and hazard carve-outs. */
export const buildProceduralFrontTerrain = (tint = 0xffffff): TerrainLayers =>
  buildProceduralFrontTerrainComponent({
    tint,
    worldW: WORLD_W,
    groundY: GROUND_Y,
    frontTileHeight: FRONT_TILE_HEIGHT,
    surfaceStepPx: SURFACE_STEP_PX,
    sampledSurfaceTop: sampledSurfaceBands.top,
    sampledSurfaceBottom: sampledSurfaceBands.bottom,
    hillSurfaceY,
    readRoadProfileFromTexture,
    setSpriteVisualWidth,
    waterForbiddenInterval: proceduralWaterForbiddenInterval(),
  });

/** Decorative air/ground mob container + spawn list registration. */
export const buildObjectLayerSystem = (
  mobileScale: number,
  layers: ObjectLayers,
): {
  container: Container;
  spawns: AmbientMobSpawn[];
} =>
  buildObjectLayerSystemComponent(
    mobileScale,
    layers,
    WORLD_W,
    hillSurfaceY,
  );
