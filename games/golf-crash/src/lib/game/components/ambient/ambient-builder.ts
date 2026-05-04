import { Assets, Container, Graphics, Sprite } from "pixi.js";
import { hillSurfaceY } from "../map/map.js";
import { spawnGolfCartSprite } from "../sprites/golf-cart-sprite.js";
import {
  AMBIENT_SPINE_BIRD_LABEL,
  spawnSpineAmbient,
  spawnSpineIdleAmbient,
} from "../sprites/spine-ambient.js";
import {
  buildSectorsInSpan,
  distributeAcrossSectors,
  pickDistinctSectors,
  randomInSector,
  type Sector,
} from "./sectors.js";
import type { ObjectLayerId, ObjectLayers } from "../core/world-types.js";
import { getAmbientSpawnXSpan } from "./ambient-spawn-span.js";

export { getAmbientSpawnXSpan } from "./ambient-spawn-span.js";

export type AmbientMobSpawn = {
  node: Container;
  layerId: ObjectLayerId;
  /** Ground-layer props (ambient golf carts) stay parked instead of creeping along fairway X. */
  fixedGround?: boolean;
};

const makeWorldSprite = (
  parent: Container,
  alias: string,
  x: number,
  y: number,
  alpha = 1,
  flip = false,
  width = 150,
): Sprite => {
  const sprite = new Sprite(Assets.get(alias));
  sprite.anchor.set(0.5);
  sprite.x = x;
  sprite.y = y;
  const ratio = width / Math.max(1, sprite.texture.width);
  sprite.scale.set(ratio);
  if (flip) sprite.scale.x = -Math.abs(sprite.scale.x);
  sprite.alpha = alpha;
  parent.addChild(sprite);
  return sprite;
};

/**
 * Mob distribution follows the layered reference (basic_map_*) and §3.3 of the
 * TZ:
 *   Layer 1 (low-air)   — sparse birds (cloud decks are `clouds_strip_*.svg` on the background)
 *   Layer 2 (mid-air)   — helicopters only (birds are layer 1)
 *   Layer 3 (high-air)  — planes ABOVE the cloud line
 *   Layer 4 (atmosphere)— UFO with alien + an atmospheric meteor streak
 *   Layer 5 (space)     — satellites, asteroid clusters, comets
 *
 * Density adapts to the viewport. When `mobileScale < 1` (narrow phone screen,
 * see getMobileScale) we drop sprite COUNT — not just size — so the scene
 * stays readable. Static parked golf carts (1–2) are sprites only — not mob AI.
 *
 * Idle sky life: Layer 1 has a sparse row of Spine birds (≈2 on phones);
 * layer 2 only helicopters. Fewer planes / space rocks than the reference
 * fill — flight phase boosts lateral motion elsewhere in bootstrap.
 *
 * Distribution is **vertical columns inside the fairway X-span** (`getAmbientSpawnXSpan`):
 * each mob lane gets its own sector split + independent shuffle so birds / helis / planes /
 * atmosphere / space do not share the same X lottery on every load.
 */

/** How many vertical columns each lane uses inside the spawn span (tweak for density). */
const AMBIENT_LANE_SECTOR_SPLITS = {
  ground: 6,
  lowAir: 8,
  heliCraft: 6,
  highAir: 8,
  atmosphere: 6,
  space: 8,
} as const;
export const buildObjectLayerSystem = (
  mobileScale: number,
  layers: ObjectLayers,
  worldW: number,
): {
  container: Container;
  spawns: AmbientMobSpawn[];
} => {
  const layer = new Container();
  const spawns: AmbientMobSpawn[] = [];
  const push = (
    sprite: Container,
    layerId: ObjectLayerId,
    opts?: { fixedGround?: boolean },
  ): void => {
    spawns.push({
      node: sprite,
      layerId,
      fixedGround: opts?.fixedGround,
    });
  };

  const rand = (min: number, max: number): number =>
    min + Math.random() * (max - min);
  const pickFlip = (): boolean => Math.random() < 0.5;

  // Mobile gets ~70% of desktop sprite count to protect the frame budget.
  const isMobile = mobileScale < 1;
  const densityMul = isMobile ? 0.7 : 1.0;
  const cnt = (n: number): number => Math.max(1, Math.round(n * densityMul));

  const span = getAmbientSpawnXSpan(worldW);
  const sectorsGround = buildSectorsInSpan(
    span.x0,
    span.x1,
    AMBIENT_LANE_SECTOR_SPLITS.ground,
  );
  const sectorsLowAir = buildSectorsInSpan(
    span.x0,
    span.x1,
    AMBIENT_LANE_SECTOR_SPLITS.lowAir,
  );
  const sectorsHeliCraft = buildSectorsInSpan(
    span.x0,
    span.x1,
    AMBIENT_LANE_SECTOR_SPLITS.heliCraft,
  );
  const sectorsHighAir = buildSectorsInSpan(
    span.x0,
    span.x1,
    AMBIENT_LANE_SECTOR_SPLITS.highAir,
  );
  const sectorsAtmosphere = buildSectorsInSpan(
    span.x0,
    span.x1,
    AMBIENT_LANE_SECTOR_SPLITS.atmosphere,
  );
  const sectorsSpace = buildSectorsInSpan(
    span.x0,
    span.x1,
    AMBIENT_LANE_SECTOR_SPLITS.space,
  );

  // Distribute `count` X positions across `sectors`; each call shuffles independently.
  const distributeX = (sectors: Sector[], count: number, pad = 60): number[] =>
    distributeAcrossSectors(sectors, count, pad);

  // Centre Y of a layer plus a jitter so the sprites scatter inside the band.
  const yIn = (
    layerId: ObjectLayerId,
    jitterMin: number,
    jitterMax: number,
  ): number => layers[layerId].centerY + rand(jitterMin, jitterMax);

  // ─── Layer 1 — few low-air Spine birds (phones: typically 2) ────────
  const lowAirBirdCount = isMobile ? 2 : 3;
  const lowBirdXs = distributeX(sectorsLowAir, lowAirBirdCount, 220);
  for (let b = 0; b < lowAirBirdCount; b += 1) {
    const flip = pickFlip();
    push(
      spawnSpineAmbient(layer, {
        skeleton: "spineBirdJson",
        atlas: "spineBirdAtlas",
        animation: "loop",
        x: lowBirdXs[b]! + rand(-40, 40),
        y: yIn(1, -220, -100),
        alpha: 1,
        flip,
        targetWidth: (isMobile ? 82 : 90) * mobileScale,
        label: AMBIENT_SPINE_BIRD_LABEL,
      }),
      1,
    );
  }

  // ─── Layer 2 — helicopters (sit BELOW the painted cloud line per §3.3) ──────
  const heliAliases = ["helicopter", "helicopter2"] as const;
  const heliCount = isMobile ? 1 : 2;
  const heliXs = distributeX(sectorsHeliCraft, heliCount, 200);
  for (let i = 0; i < heliCount; i += 1) {
    push(
      makeWorldSprite(
        layer,
        heliAliases[i % heliAliases.length]!,
        heliXs[i]!,
        // negative jitter shifts the heli slightly upward of band centre
        // so it cleanly sits below the upper-cloud band drawn above.
        yIn(2, -240, -100),
        1,
        pickFlip(),
        220 * mobileScale,
      ),
      2,
    );
  }

  // ─── Layer 3 — planes (ABOVE the upper-cloud line) ──────────────────
  const planeAliases = ["plane", "plane2", "plane3"] as const;
  const planeCount = cnt(2);
  const planeXs = distributeX(sectorsHighAir, planeCount, 200);
  for (let i = 0; i < planeCount; i += 1) {
    push(
      makeWorldSprite(
        layer,
        planeAliases[i % planeAliases.length]!,
        planeXs[i]!,
        yIn(3, -80, 100),
        1,
        pickFlip(),
        260 * mobileScale,
      ),
      3,
    );
  }

  // ─── Layer 4 — UFO (one prominent alien) + atmospheric meteor ───────
  const atmoPair = pickDistinctSectors(sectorsAtmosphere, 2);
  const ufoSec = atmoPair[0] ?? sectorsAtmosphere[0]!;
  const metSec = atmoPair[1] ?? ufoSec;

  push(
    spawnSpineIdleAmbient(layer, {
      skeleton: "spineUfoJson",
      atlas: "spineUfoAtlas",
      animation: "idle",
      x: randomInSector(ufoSec, 80),
      y: yIn(4, -40, 40),
      alpha: 1,
      flip: pickFlip(),
      targetWidth: 200 * mobileScale,
    }),
    4,
  );
  // Atmospheric meteor streak — desktop only, mobile has it in space layer.
  if (!isMobile) {
    push(
      makeWorldSprite(
        layer,
        "meteors",
        randomInSector(metSec, 80),
        yIn(4, 40, 120),
        1,
        pickFlip(),
        180 * mobileScale,
      ),
      4,
    );
  }

  // ─── Layer 5 — satellites (sparse, slow drift) ──────────────────────
  const satCount = cnt(2);
  const satXs = distributeX(sectorsSpace, satCount, 250);
  for (let i = 0; i < satCount; i += 1) {
    push(
      spawnSpineIdleAmbient(layer, {
        skeleton: "spineSatelliteJson",
        atlas: "spineSatelliteAtlas",
        animation: "idle",
        x: satXs[i]!,
        y: yIn(5, -120, 80),
        alpha: 1,
        flip: pickFlip(),
        targetWidth: 160 * mobileScale,
      }),
      5,
    );
  }

  // ─── Layer 5 — asteroid clusters (3-5 rocks per cluster) ────────────
  // Asteroids on the reference are NOT individual stones spread evenly —
  // they form tight clusters / belts. Each cluster picks one X/Y anchor and
  // scatters several asteroids around it with small offsets and random
  // rotation. Asteroids are pure decoration (no flipbook).
  const clusterCount = cnt(2);
  const clusterXs = distributeX(sectorsSpace, clusterCount, 200);
  for (let c = 0; c < clusterCount; c += 1) {
    const rocksPerCluster = 2 + Math.floor(Math.random() * 2); // 2..3
    const baseX = clusterXs[c]!;
    const baseY = yIn(5, -200, -50);
    for (let r = 0; r < rocksPerCluster; r += 1) {
      const aliasIdx = ((c * 3 + r) % 9) + 1;
      const rock = new Sprite(Assets.get(`asteroid${aliasIdx}`));
      rock.anchor.set(0.5);
      rock.x = baseX + rand(-90, 90);
      rock.y = baseY + rand(-50, 50);
      const s = rand(0.06, 0.14) * mobileScale;
      rock.scale.set(s);
      rock.alpha = 1;
      rock.rotation = rand(-0.8, 0.8);
      layer.addChild(rock);
      push(rock, 5);
    }
  }

  // ─── Layer 5 — comets (meteor streaks high up in deep space) ────────
  const cometCount = cnt(1);
  const cometXs = distributeX(sectorsSpace, cometCount, 250);
  for (let i = 0; i < cometCount; i += 1) {
    push(
      makeWorldSprite(
        layer,
        "meteors",
        cometXs[i]!,
        yIn(5, -360, -180),
        1,
        pickFlip(),
        180 * mobileScale,
      ),
      5,
    );
  }

  // ─── Layer 0 — parked golf carts: static sprites only (not `ambientMotions`). ─
  const cartCount = isMobile ? 1 : 2;
  const cartXs = distributeX(sectorsGround, cartCount, 300);
  for (let i = 0; i < cartCount; i += 1) {
    const x = cartXs[i]!;
    spawnGolfCartSprite({
      parent: layer,
      x,
      surfaceY: hillSurfaceY(x),
      widthScaleMul: mobileScale,
      flip: pickFlip(),
      alpha: 1,
    });
  }

  // ─── Layer 0 — mole peeking out of the ground (decorative) ──────────
  const mole = new Graphics();
  mole.ellipse(0, 0, 28, 10).fill({ color: 0x1a0e06, alpha: 1 });
  mole.ellipse(0, -9, 14, 12).fill({ color: 0x6b4423, alpha: 1 });
  mole.x = 1420;
  mole.y = layers[0].centerY + 18;
  layer.addChild(mole);

  return { container: layer, spawns };
};
