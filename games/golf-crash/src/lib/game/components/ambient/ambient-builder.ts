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

export type AmbientPerfTier = "high" | "medium" | "low";

type AmbientLaneSpawnConfig = {
  sectors: number;
  countDesktop: number;
  countMobile: number;
  minSpacingPx: number;
  jitterX: number;
  jitterY: readonly [number, number];
  spawnWeight?: readonly number[];
};

export type AmbientSpawnConfig = {
  groundCartDriftEnabled: boolean;
  lanes: {
    ground: AmbientLaneSpawnConfig;
    lowAirBirds: AmbientLaneSpawnConfig;
    heliCraft: AmbientLaneSpawnConfig;
    highAirPlanes: AmbientLaneSpawnConfig;
    atmosphereUfo: AmbientLaneSpawnConfig;
    atmosphereMeteor: AmbientLaneSpawnConfig;
    spaceSatellites: AmbientLaneSpawnConfig;
    spaceAsteroidClusters: AmbientLaneSpawnConfig;
    spaceComets: AmbientLaneSpawnConfig;
  };
};

export const AMBIENT_SPAWN_CONFIG: AmbientSpawnConfig = {
  groundCartDriftEnabled: false,
  lanes: {
    ground: {
      sectors: 6,
      countDesktop: 3,
      countMobile: 2,
      minSpacingPx: 360,
      jitterX: 22,
      jitterY: [0, 0],
    },
    lowAirBirds: {
      sectors: 8,
      countDesktop: 3,
      countMobile: 2,
      minSpacingPx: 210,
      jitterX: 40,
      jitterY: [-220, -100],
    },
    heliCraft: {
      sectors: 6,
      countDesktop: 2,
      countMobile: 1,
      minSpacingPx: 220,
      jitterX: 28,
      jitterY: [-240, -100],
      spawnWeight: [0.55, 0.45],
    },
    highAirPlanes: {
      sectors: 8,
      countDesktop: 2,
      countMobile: 1,
      minSpacingPx: 220,
      jitterX: 24,
      jitterY: [-80, 100],
      spawnWeight: [0.34, 0.33, 0.33],
    },
    atmosphereUfo: {
      sectors: 6,
      countDesktop: 1,
      countMobile: 1,
      minSpacingPx: 230,
      jitterX: 18,
      jitterY: [-40, 40],
    },
    atmosphereMeteor: {
      sectors: 6,
      countDesktop: 1,
      countMobile: 0,
      minSpacingPx: 220,
      jitterX: 18,
      jitterY: [40, 120],
    },
    spaceSatellites: {
      sectors: 8,
      countDesktop: 2,
      countMobile: 1,
      minSpacingPx: 260,
      jitterX: 20,
      jitterY: [-120, 80],
    },
    spaceAsteroidClusters: {
      sectors: 8,
      countDesktop: 2,
      countMobile: 1,
      minSpacingPx: 120,
      jitterX: 10,
      jitterY: [-200, -50],
    },
    spaceComets: {
      sectors: 8,
      countDesktop: 1,
      countMobile: 1,
      minSpacingPx: 240,
      jitterX: 20,
      jitterY: [-360, -180],
    },
  },
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

export const buildObjectLayerSystem = (
  mobileScale: number,
  layers: ObjectLayers,
  worldW: number,
  opts: {
    viewportW?: number;
    perfTier?: AmbientPerfTier;
    spawnConfig?: AmbientSpawnConfig;
    /** Inclusive X intervals where ground carts must NOT spawn (water/sand hazards). */
    cartForbiddenIntervals?: ReadonlyArray<readonly [number, number]>;
    /** Carts must be at least this far right of the world origin (keeps them away from the tee/character). */
    cartMinX?: number;
    /** Carts must be at most this far right (keeps them away from the hole). */
    cartMaxX?: number;
  } = {},
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
  const pickWeightedIndex = (weights: readonly number[]): number => {
    const sum = weights.reduce((acc, w) => acc + Math.max(0, w), 0);
    if (!(sum > 0)) return 0;
    let r = Math.random() * sum;
    for (let i = 0; i < weights.length; i += 1) {
      r -= Math.max(0, weights[i] ?? 0);
      if (r <= 0) return i;
    }
    return Math.max(0, weights.length - 1);
  };

  const spawnConfig = opts.spawnConfig ?? AMBIENT_SPAWN_CONFIG;
  const perfTier = opts.perfTier ?? "high";

  // Mobile gets fewer visuals to protect frame budget.
  const isMobile = mobileScale < 1;
  const perfCountMulByTier: Record<AmbientPerfTier, number> = {
    high: 1,
    medium: 0.8,
    low: 0.55,
  };
  const countFor = (
    cfg: AmbientLaneSpawnConfig,
    opts: { expensive?: boolean; min?: number } = {},
  ): number => {
    const base = isMobile ? cfg.countMobile : cfg.countDesktop;
    if (base <= 0) return 0;
    const perfMul = opts.expensive ? perfCountMulByTier[perfTier] : 1;
    return Math.max(opts.min ?? 0, Math.round(base * perfMul));
  };

  const span = getAmbientSpawnXSpan(worldW, opts.viewportW);
  const laneCfg = spawnConfig.lanes;
  const sectorsGround = buildSectorsInSpan(
    span.x0,
    span.x1,
    laneCfg.ground.sectors,
  );
  const sectorsLowAir = buildSectorsInSpan(
    span.x0,
    span.x1,
    laneCfg.lowAirBirds.sectors,
  );
  const sectorsHeliCraft = buildSectorsInSpan(
    span.x0,
    span.x1,
    laneCfg.heliCraft.sectors,
  );
  const sectorsHighAir = buildSectorsInSpan(
    span.x0,
    span.x1,
    laneCfg.highAirPlanes.sectors,
  );
  const sectorsAtmosphere = buildSectorsInSpan(
    span.x0,
    span.x1,
    laneCfg.atmosphereUfo.sectors,
  );
  const sectorsSpace = buildSectorsInSpan(
    span.x0,
    span.x1,
    laneCfg.spaceSatellites.sectors,
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

  type LanePlacement = {
    layerId: ObjectLayerId;
    sectors: Sector[];
    pad: number;
    minSpacingPx: number;
    xs: number[];
    skipCrossLaneSpacing?: boolean;
  };
  const lanePlacements: LanePlacement[] = [];
  const registerPlacement = (
    _laneId: string,
    layerId: ObjectLayerId,
    sectors: Sector[],
    count: number,
    pad: number,
    minSpacingPx: number,
    opts: { skipCrossLaneSpacing?: boolean } = {},
  ): number[] => {
    const xs = distributeX(sectors, count, pad);
    lanePlacements.push({
      layerId,
      sectors,
      pad,
      minSpacingPx,
      xs,
      skipCrossLaneSpacing: opts.skipCrossLaneSpacing,
    });
    return xs;
  };
  const hasNearbyConflict = (
    lane: LanePlacement,
    candidateX: number,
    laneIdx: number,
  ): boolean => {
    const candidateMinSpacing = lane.minSpacingPx;
    for (let i = 0; i < lanePlacements.length; i += 1) {
      if (i === laneIdx) continue;
      const other = lanePlacements[i]!;
      if (other.skipCrossLaneSpacing || lane.skipCrossLaneSpacing) continue;
      if (Math.abs(other.layerId - lane.layerId) > 1) continue;
      const spacing = Math.max(candidateMinSpacing, other.minSpacingPx);
      for (const ox of other.xs) {
        if (Math.abs(candidateX - ox) < spacing) return true;
      }
    }
    return false;
  };
  const runCrossLaneSpacingPass = (): void => {
    for (let laneIdx = 0; laneIdx < lanePlacements.length; laneIdx += 1) {
      const lane = lanePlacements[laneIdx]!;
      if (lane.skipCrossLaneSpacing) continue;
      for (let i = 0; i < lane.xs.length; i += 1) {
        let x = lane.xs[i]!;
        if (!hasNearbyConflict(lane, x, laneIdx)) continue;
        let moved = false;
        const start = (i + 1) % Math.max(1, lane.sectors.length);
        for (let j = 0; j < lane.sectors.length; j += 1) {
          const sector = lane.sectors[(start + j) % lane.sectors.length]!;
          const candidateX = randomInSector(sector, lane.pad);
          if (hasNearbyConflict(lane, candidateX, laneIdx)) continue;
          lane.xs[i] = candidateX;
          moved = true;
          break;
        }
        if (!moved) lane.xs[i] = x;
      }
    }
  };

  // ─── Layer 1 — few low-air Spine birds (phones: typically 2) ────────
  const lowAirBirdCount = countFor(laneCfg.lowAirBirds, {
    expensive: true,
    min: 1,
  });
  const lowBirdXs = registerPlacement(
    "lowAirBirds",
    1,
    sectorsLowAir,
    lowAirBirdCount,
    220,
    laneCfg.lowAirBirds.minSpacingPx,
  );
  // ─── Layer 2 — helicopters (sit BELOW the painted cloud line per §3.3) ──────
  const heliAliases = ["helicopter", "helicopter2"] as const;
  const heliCount = countFor(laneCfg.heliCraft, { expensive: true, min: 1 });
  const heliXs = registerPlacement(
    "heliCraft",
    2,
    sectorsHeliCraft,
    heliCount,
    200,
    laneCfg.heliCraft.minSpacingPx,
  );
  // ─── Layer 3 — planes (ABOVE the upper-cloud line) ──────────────────
  const planeAliases = ["plane", "plane2", "plane3"] as const;
  const planeCount = countFor(laneCfg.highAirPlanes, {
    expensive: true,
    min: 1,
  });
  const planeXs = registerPlacement(
    "highAirPlanes",
    3,
    sectorsHighAir,
    planeCount,
    200,
    laneCfg.highAirPlanes.minSpacingPx,
  );
  const atmoUfoCount = countFor(laneCfg.atmosphereUfo, { expensive: true, min: 1 });
  const atmoMeteorCount = countFor(laneCfg.atmosphereMeteor, {
    expensive: true,
    min: 0,
  });
  const atmoUfoXs = registerPlacement(
    "atmosphereUfo",
    4,
    sectorsAtmosphere,
    atmoUfoCount,
    80,
    laneCfg.atmosphereUfo.minSpacingPx,
  );
  const atmoMeteorXs = registerPlacement(
    "atmosphereMeteor",
    4,
    sectorsAtmosphere,
    atmoMeteorCount,
    80,
    laneCfg.atmosphereMeteor.minSpacingPx,
  );
  const satCount = countFor(laneCfg.spaceSatellites, {
    expensive: true,
    min: 1,
  });
  const satXs = registerPlacement(
    "spaceSatellites",
    5,
    sectorsSpace,
    satCount,
    250,
    laneCfg.spaceSatellites.minSpacingPx,
  );
  const clusterCount = countFor(laneCfg.spaceAsteroidClusters, { min: 1 });
  const clusterXs = registerPlacement(
    "spaceAsteroidClusters",
    5,
    sectorsSpace,
    clusterCount,
    200,
    laneCfg.spaceAsteroidClusters.minSpacingPx,
    { skipCrossLaneSpacing: true },
  );
  const cometCount = countFor(laneCfg.spaceComets, { min: 1 });
  const cometXs = registerPlacement(
    "spaceComets",
    5,
    sectorsSpace,
    cometCount,
    250,
    laneCfg.spaceComets.minSpacingPx,
  );
  // Carts only on fairway: drop sectors that intersect water/sand intervals
  // or sit near the tee/character / past the hole.
  const cartForbiddenRaw = opts.cartForbiddenIntervals ?? [];
  const cartMinX = opts.cartMinX ?? -Infinity;
  const cartMaxX = opts.cartMaxX ?? Infinity;
  const isXOnFairway = (x: number): boolean => {
    if (x < cartMinX || x > cartMaxX) return false;
    for (const [a, b] of cartForbiddenRaw) {
      if (x >= a && x <= b) return false;
    }
    return true;
  };
  const sectorsGroundFairway = sectorsGround.filter((sec) => {
    // Reject the sector if its centre OR either edge lies in a forbidden span;
    // a partial overlap means a random pick inside could still land on hazard.
    if (!isXOnFairway(sec.centerX)) return false;
    if (!isXOnFairway(sec.startX + 60)) return false;
    if (!isXOnFairway(sec.endX - 60)) return false;
    return true;
  });
  const cartCountRaw = countFor(laneCfg.ground, { min: 0 });
  const cartCount = Math.min(cartCountRaw, 3, sectorsGroundFairway.length);
  const cartXs = cartCount > 0
    ? registerPlacement(
        "ground",
        0,
        sectorsGroundFairway,
        cartCount,
        300,
        laneCfg.ground.minSpacingPx,
      )
    : [];
  runCrossLaneSpacingPass();

  for (let b = 0; b < lowAirBirdCount; b += 1) {
    const flip = pickFlip();
    push(
      spawnSpineAmbient(layer, {
        skeleton: "spineBirdJson",
        atlas: "spineBirdAtlas",
        animation: "loop",
        x:
          lowBirdXs[b]! +
          rand(-laneCfg.lowAirBirds.jitterX, laneCfg.lowAirBirds.jitterX),
        y: yIn(1, laneCfg.lowAirBirds.jitterY[0], laneCfg.lowAirBirds.jitterY[1]),
        alpha: 1,
        flip,
        targetWidth: (isMobile ? 82 : 90) * mobileScale,
        label: AMBIENT_SPINE_BIRD_LABEL,
      }),
      1,
    );
  }

  for (let i = 0; i < heliCount; i += 1) {
    push(
      makeWorldSprite(
        layer,
        heliAliases[
          laneCfg.heliCraft.spawnWeight
            ? pickWeightedIndex(laneCfg.heliCraft.spawnWeight)
            : i % heliAliases.length
        ]!,
        heliXs[i]!,
        yIn(2, laneCfg.heliCraft.jitterY[0], laneCfg.heliCraft.jitterY[1]),
        1,
        pickFlip(),
        220 * mobileScale,
      ),
      2,
    );
  }

  for (let i = 0; i < planeCount; i += 1) {
    push(
      makeWorldSprite(
        layer,
        planeAliases[
          laneCfg.highAirPlanes.spawnWeight
            ? pickWeightedIndex(laneCfg.highAirPlanes.spawnWeight)
            : i % planeAliases.length
        ]!,
        planeXs[i]!,
        yIn(
          3,
          laneCfg.highAirPlanes.jitterY[0],
          laneCfg.highAirPlanes.jitterY[1],
        ),
        1,
        pickFlip(),
        260 * mobileScale,
      ),
      3,
    );
  }

  // ─── Layer 4 — UFO (one prominent alien) + atmospheric meteor ───────
  if (atmoUfoCount > 0) {
    const atmoPair = pickDistinctSectors(sectorsAtmosphere, 2);
    const ufoSec = atmoPair[0] ?? sectorsAtmosphere[0]!;
    push(
      spawnSpineIdleAmbient(layer, {
        skeleton: "spineUfoJson",
        atlas: "spineUfoAtlas",
        animation: "idle",
        x: atmoUfoXs[0] ?? randomInSector(ufoSec, 80),
        y: yIn(4, laneCfg.atmosphereUfo.jitterY[0], laneCfg.atmosphereUfo.jitterY[1]),
        alpha: 1,
        flip: pickFlip(),
        targetWidth: 200 * mobileScale,
      }),
      4,
    );
  }
  // Atmospheric meteor streak — desktop only, mobile has it in space layer.
  if (atmoMeteorCount > 0) {
    push(
      makeWorldSprite(
        layer,
        "meteors",
        atmoMeteorXs[0] ?? randomInSector(sectorsAtmosphere[0]!, 80),
        yIn(
          4,
          laneCfg.atmosphereMeteor.jitterY[0],
          laneCfg.atmosphereMeteor.jitterY[1],
        ),
        1,
        pickFlip(),
        180 * mobileScale,
      ),
      4,
    );
  }

  // ─── Layer 5 — satellites (sparse, slow drift) ──────────────────────
  for (let i = 0; i < satCount; i += 1) {
    push(
      spawnSpineIdleAmbient(layer, {
        skeleton: "spineSatelliteJson",
        atlas: "spineSatelliteAtlas",
        animation: "idle",
        x: satXs[i]!,
        y: yIn(
          5,
          laneCfg.spaceSatellites.jitterY[0],
          laneCfg.spaceSatellites.jitterY[1],
        ),
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
  for (let c = 0; c < clusterCount; c += 1) {
    const rocksPerCluster = 2 + Math.floor(Math.random() * 2); // 2..3
    const baseX = clusterXs[c]!;
    const baseY = yIn(
      5,
      laneCfg.spaceAsteroidClusters.jitterY[0],
      laneCfg.spaceAsteroidClusters.jitterY[1],
    );
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
  for (let i = 0; i < cometCount; i += 1) {
    push(
      makeWorldSprite(
        layer,
        "meteors",
        cometXs[i]!,
        yIn(5, laneCfg.spaceComets.jitterY[0], laneCfg.spaceComets.jitterY[1]),
        1,
        pickFlip(),
        180 * mobileScale,
      ),
      5,
    );
  }

  // ─── Layer 0 — parked golf carts: static sprites only (not `ambientMotions`). ─
  for (let i = 0; i < cartCount; i += 1) {
    let x = cartXs[i]!;
    // Cross-lane pass may have nudged X back onto a hazard; resample inside
    // the fairway-only sectors and skip the cart if no spot survives.
    if (!isXOnFairway(x)) {
      let recovered = false;
      for (let attempt = 0; attempt < 6 && sectorsGroundFairway.length > 0; attempt += 1) {
        const sec = sectorsGroundFairway[(i + attempt) % sectorsGroundFairway.length]!;
        const candidate = randomInSector(sec, 60);
        if (isXOnFairway(candidate)) {
          x = candidate;
          recovered = true;
          break;
        }
      }
      if (!recovered) continue;
    }
    const cart = spawnGolfCartSprite({
      parent: layer,
      x,
      surfaceY: hillSurfaceY(x),
      widthScaleMul: mobileScale,
      flip: pickFlip(),
      alpha: 1,
    });
    push(cart, 0, {
      fixedGround: !spawnConfig.groundCartDriftEnabled,
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
