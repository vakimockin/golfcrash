import { Container, Graphics, Text } from "pixi.js";
import { altitudeBandForLayer } from "../layers/layer-math.js";
import type { ObjectLayerId, ObjectLayers } from "../core/world-types.js";
import { AMBIENT_MOB_SECTOR_COUNT, buildSectorsInSpan } from "./sectors.js";
import { getAmbientSpawnXSpan } from "./ambient-spawn-span.js";

/** Stroke / label hues so overlapping bands do not read as one sector. */
export const LAYER_DEBUG_COLORS: readonly number[] = [
  0xff3355, // 0 ground
  0xffaa22, // 1 low-air
  0xe6ee44, // 2 mid-air / helis
  0x44ff99, // 3 high-air / planes
  0x44bbff, // 4 atmosphere / UFO
  0xcc77ff, // 5 space
];

/** Dev overlay captions (aligned with `buildObjectLayerSystem`). */
const LAYER_HELP: readonly string[] = [
  "L0 · ground — carts on fairway, roadside decor",
  "L1 · low sky — lower clouds, sparse birds near horizon",
  "L2 · upper tier — helicopters under cloud line only",
  "L3 · high — planes above cloud line",
  "L4 · atmosphere — UFO, atmospheric meteor if needed",
  "L5 · space — satellites, asteroid clusters, comets/meteors",
];

const LABEL_FONT = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: 17,
  fontWeight: "700" as const,
  stroke: { color: 0x000000, width: 4 },
  align: "left" as const,
};

/**
 * Red outlines for **ambient mob placement** (not a regular screen grid):
 * - **Vertical** — equal columns along **fairway spawn span** (`getAmbientSpawnXSpan`), same idea as
 *   lane splits in `buildObjectLayerSystem` (each mob lane uses its own sector count in code).
 * - **Horizontal boxes** — stacked bands L0…L5 (`createStackedObjectLayers` + `layer-stack-config.ts`).
 *
 * Vertical cuts are clipped just below the fairway so they do not run through that void.
 *
 * `worldScale`: `world.scale.x` after the camera — stroke widths compensate for zoom.
 */
export const redrawMobSpawnSectorDebug = (
  g: Graphics,
  worldW: number,
  worldH: number,
  groundY: number,
  layers: ObjectLayers,
  worldScale: number,
  targetStrokePx = 3,
): void => {
  g.clear();
  if (worldW <= 0 || worldH <= 0) return;

  const safeScale = Math.max(1e-4, worldScale);
  const vW = Math.max(2, targetStrokePx / safeScale);
  const hW = Math.max(1.5, (targetStrokePx * 0.85) / safeScale);
  const vStroke = {
    width: vW,
    color: 0xff2222,
    alpha: 0.95,
  } as const;

  /** Below fairway the world is mostly padding; keep sector lines in the play column only. */
  const sectorY1 = Math.min(worldH, groundY + 360);

  const span = getAmbientSpawnXSpan(worldW);
  const dbgSectors = buildSectorsInSpan(
    span.x0,
    span.x1,
    AMBIENT_MOB_SECTOR_COUNT,
  );
  for (const s of dbgSectors) {
    g.moveTo(s.startX, 0).lineTo(s.startX, sectorY1).stroke(vStroke);
  }
  g.moveTo(span.x1, 0).lineTo(span.x1, sectorY1).stroke(vStroke);

  g.moveTo(span.x0, 0).lineTo(span.x1, 0).stroke({
    width: Math.max(1.2, (targetStrokePx * 0.4) / safeScale),
    color: 0xffaa00,
    alpha: 0.5,
  });

  g.moveTo(span.x0, sectorY1).lineTo(span.x1, sectorY1).stroke({
    width: Math.max(1.2, (targetStrokePx * 0.4) / safeScale),
    color: 0xffaa00,
    alpha: 0.35,
  });

  g.moveTo(0, groundY).lineTo(worldW, groundY).stroke({
    width: Math.max(1.5, (targetStrokePx * 0.5) / safeScale),
    color: 0x88ffcc,
    alpha: 0.75,
  });

  const layerIds = [0, 1, 2, 3, 4, 5] as const;
  for (const id of layerIds) {
    const { minY, maxY } = altitudeBandForLayer(layers, id);
    const h = Math.max(1, maxY - minY);
    const color = LAYER_DEBUG_COLORS[id] ?? 0xffffff;
    g.rect(0, minY, worldW, h).stroke({
      width: hW,
      color,
      alpha: 0.72,
    });
    const cy = layers[id].centerY;
    g.moveTo(0, cy)
      .lineTo(worldW, cy)
      .stroke({
        width: Math.max(1.2, (targetStrokePx * 0.55) / safeScale),
        color,
        alpha: 0.9,
      });
  }
};

/** World-space labels; `scale` compensates `world.scale` so letters stay ~readable on screen. */
export const syncMobSectorDebugLabelLayer = (
  labelRoot: Container,
  worldScale: number,
  spanX0: number,
  worldW: number,
  layers: ObjectLayers,
): void => {
  while (labelRoot.children.length < 6) {
    labelRoot.addChild(
      new Text({
        text: "",
        style: { ...LABEL_FONT, fill: 0xffffff, wordWrap: true, wordWrapWidth: 640 },
      }),
    );
  }
  const inv = 1 / Math.max(1e-4, worldScale);
  const wrap = Math.min(720, Math.max(280, worldW * 0.38));
  for (let i = 0; i < 6; i += 1) {
    const t = labelRoot.children[i] as Text;
    t.text = LAYER_HELP[i] ?? "";
    t.style.fill = LAYER_DEBUG_COLORS[i] ?? 0xffffff;
    t.style.wordWrapWidth = wrap;
    t.anchor.set(0, 0.5);
    t.x = spanX0 + 12;
    t.y = layers[i as ObjectLayerId].centerY;
    t.scale.set(inv);
    t.eventMode = "none";
  }
};
