import { Assets, Container, Sprite } from "pixi.js";
import type { ObjectLayerId, ObjectLayers } from "../core/world-types.js";
import { altitudeBandForLayer } from "../layers/layer-math.js";
import {
  AMBIENT_SPINE_BIRD_LABEL,
  spawnSpineAmbient,
  spawnSpineIdleAmbient,
} from "../sprites/spine-ambient.js";
import { getAmbientSpawnXSpan } from "./ambient-spawn-span.js";
import {
  AMBIENT_MOB_SECTOR_COUNT,
  buildSectorsInSpan,
  randomInSector,
  type Sector,
} from "./sectors.js";

type SkyLayerId = Exclude<ObjectLayerId, 0>;

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const pickFlip = (): boolean => Math.random() < 0.5;

const makeSprite = (
  parent: Container,
  alias: string,
  x: number,
  y: number,
  alpha: number,
  flip: boolean,
  width: number,
): Sprite => {
  const sprite = new Sprite(Assets.get(alias));
  sprite.anchor.set(0.5);
  sprite.x = x;
  sprite.y = y;
  const ratio = width / Math.max(1, sprite.texture.width);
  sprite.scale.set(flip ? -ratio : ratio, ratio);
  sprite.alpha = alpha;
  parent.addChild(sprite);
  return sprite;
};

export type FlightRevealSpawn = {
  node: Container;
  layerId: SkyLayerId;
};

export const flightRevealCellKey = (
  col: number,
  layerId: SkyLayerId,
): string => `${col}-${layerId}`;

/**
 * Map ball position to one **column × altitude band** cell (same X span and sector
 * count as dev overlay / idle ambient). Returns null outside the fairway span, in a
 * vertical gap between bands, or in layer 0 (ground).
 */
export const resolveFlightGridCell = (
  ballX: number,
  ballY: number,
  worldW: number,
  layers: ObjectLayers,
): { col: number; layerId: SkyLayerId; sector: Sector } | null => {
  const span = getAmbientSpawnXSpan(worldW);
  if (ballX < span.x0 || ballX > span.x1) return null;

  const sectors = buildSectorsInSpan(
    span.x0,
    span.x1,
    AMBIENT_MOB_SECTOR_COUNT,
  );
  let col = -1;
  let sector: Sector | null = null;
  for (let i = 0; i < sectors.length; i += 1) {
    const s = sectors[i]!;
    const endOk = i === sectors.length - 1 ? ballX <= s.endX : ballX < s.endX;
    if (ballX >= s.startX && endOk) {
      col = i;
      sector = s;
      break;
    }
  }
  if (col < 0 || !sector) return null;

  let layerId: ObjectLayerId | null = null;
  for (let id = 0 as ObjectLayerId; id <= 5; id = (id + 1) as ObjectLayerId) {
    const { minY, maxY } = altitudeBandForLayer(layers, id);
    if (ballY >= minY && ballY <= maxY) {
      layerId = id;
      break;
    }
  }
  if (layerId === null || layerId === 0) return null;

  return { col, layerId, sector };
};

export type ResolvedFlightCell = NonNullable<
  ReturnType<typeof resolveFlightGridCell>
>;

/**
 * Sample `progress → samplePoint(progress)` along the shot arc and merge all grid
 * cells the ball can cross (plus ±wobble) so flight-reveal mobs can spawn once at
 * flight start instead of popping in frame-by-frame.
 */
export const collectFlightTrajectoryCells = (
  samplePoint: (progress: number) => { x: number; y: number },
  worldW: number,
  layers: ObjectLayers,
  options?: { steps?: number; wobblePx?: number },
): Map<string, ResolvedFlightCell> => {
  /** Fewer samples + lateral wobble only — fewer redundant layer crossings. */
  const steps = Math.max(12, options?.steps ?? 32);
  const wobblePx = options?.wobblePx ?? 6;
  const out = new Map<string, ResolvedFlightCell>();
  const consider = (x: number, y: number): void => {
    const cell = resolveFlightGridCell(x, y, worldW, layers);
    if (!cell) return;
    out.set(flightRevealCellKey(cell.col, cell.layerId), cell);
  };
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const p = samplePoint(t);
    consider(p.x, p.y);
    if (wobblePx > 0) {
      consider(p.x - wobblePx, p.y);
      consider(p.x + wobblePx, p.y);
    }
  }
  return out;
};

/** One mob per cell, matching idle ambient themes (§3.3). */
export const spawnFlightRevealMob = (
  parent: Container,
  layerId: SkyLayerId,
  sector: Sector,
  layers: ObjectLayers,
  mobileScale: number,
): FlightRevealSpawn => {
  const isMobile = mobileScale < 1;
  const x = randomInSector(sector, 40);
  const yIn = (lid: ObjectLayerId, j0: number, j1: number): number =>
    layers[lid].centerY + rand(j0, j1);

  switch (layerId) {
    case 1: {
      const spine = spawnSpineAmbient(parent, {
        skeleton: "spineBirdJson",
        atlas: "spineBirdAtlas",
        animation: "loop",
        x: x + rand(-30, 30),
        y: yIn(1, -220, -100),
        alpha: 1,
        flip: pickFlip(),
        targetWidth: (isMobile ? 82 : 90) * mobileScale,
        label: AMBIENT_SPINE_BIRD_LABEL,
      });
      return { node: spine, layerId: 1 };
    }
    case 2: {
      const heliAliases = ["helicopter", "helicopter2"] as const;
      const node = makeSprite(
        parent,
        heliAliases[Math.floor(Math.random() * heliAliases.length)]!,
        x,
        yIn(2, -240, -100),
        1,
        pickFlip(),
        220 * mobileScale,
      );
      return { node, layerId: 2 };
    }
    case 3: {
      const planeAliases = ["plane", "plane2", "plane3"] as const;
      const node = makeSprite(
        parent,
        planeAliases[Math.floor(Math.random() * planeAliases.length)]!,
        x,
        yIn(3, -80, 100),
        1,
        pickFlip(),
        260 * mobileScale,
      );
      return { node, layerId: 3 };
    }
    case 4: {
      if (Math.random() < 0.65) {
        const spine = spawnSpineIdleAmbient(parent, {
          skeleton: "spineUfoJson",
          atlas: "spineUfoAtlas",
          animation: "idle",
          x,
          y: yIn(4, -40, 40),
          alpha: 1,
          flip: pickFlip(),
          targetWidth: 200 * mobileScale,
        });
        return { node: spine, layerId: 4 };
      }
      const node = makeSprite(
        parent,
        "meteors",
        x,
        yIn(4, 40, 120),
        1,
        pickFlip(),
        180 * mobileScale,
      );
      return { node, layerId: 4 };
    }
    case 5: {
      const r = Math.random();
      if (r < 0.38) {
        const spine = spawnSpineIdleAmbient(parent, {
          skeleton: "spineSatelliteJson",
          atlas: "spineSatelliteAtlas",
          animation: "idle",
          x,
          y: yIn(5, -120, 80),
          alpha: 1,
          flip: pickFlip(),
          targetWidth: 160 * mobileScale,
        });
        return { node: spine, layerId: 5 };
      }
      if (r < 0.72) {
        const node = makeSprite(
          parent,
          "meteors",
          x,
          yIn(5, -360, -180),
          1,
          pickFlip(),
          180 * mobileScale,
        );
        return { node, layerId: 5 };
      }
      const aliasIdx = 1 + Math.floor(Math.random() * 9);
      const rock = new Sprite(Assets.get(`asteroid${aliasIdx}`));
      rock.anchor.set(0.5);
      rock.x = x + rand(-40, 40);
      rock.y = yIn(5, -200, -50) + rand(-40, 40);
      const s = rand(0.06, 0.14) * mobileScale;
      rock.scale.set(s);
      rock.alpha = 1;
      rock.rotation = rand(-0.8, 0.8);
      parent.addChild(rock);
      return { node: rock, layerId: 5 };
    }
    default: {
      const _exhaustive: never = layerId;
      void _exhaustive;
      throw new Error("flight-cell-reveal: unreachable layer");
    }
  }
};
