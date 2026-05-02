import { Assets, Container, Graphics, Sprite } from "pixi.js";
import { hillSurfaceY } from "../map/map.js";
import { spawnGolfCartSprite } from "../sprites/golf-cart-sprite.js";
import {
  AMBIENT_SPINE_BIRD_LABEL,
  spawnSpineAmbient,
  spawnSpineIdleAmbient,
} from "../sprites/spine-ambient.js";
import { buildSectors, randomInSector } from "./sectors.js";
import type { ObjectLayerId, ObjectLayers } from "../core/world-types.js";

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
 *   Layer 1 (low-air)   — sparse birds + low cloud band
 *   Layer 2 (mid-air)   — heavier upper clouds + helicopters BELOW the cloud line
 *   Layer 3 (high-air)  — planes ABOVE the cloud line
 *   Layer 4 (atmosphere)— UFO with alien + an atmospheric meteor streak
 *   Layer 5 (space)     — satellites, asteroid clusters, comets
 *
 * Density adapts to the viewport. When `mobileScale < 1` (narrow phone screen,
 * see getMobileScale) we drop sprite COUNT — not just size — so the scene
 * stays readable. Ambient golf carts stay parked (`fixedGround`): 1–2 total.
 *
 * Idle sky life: Layer 1 has a sparse row of Spine birds (≈2 on phones);
 * Layer 2 (helicopter band) holds a tighter flock (~5 mobile / ~6 desktop)
 * visibly higher above the horizon. Fewer clouds / planes / space rocks than
 * the reference fill — flight phase boosts lateral motion elsewhere in bootstrap.
 *
 * Distribution is sector-based across the horizontal span.
 */
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

  // 8 sectors gives birds/clouds/asteroids enough horizontal granularity
  // without forcing two flocks on top of each other.
  const SECTOR_COUNT = 8;
  const sectors = buildSectors(worldW, SECTOR_COUNT);

  // Distribute `count` X positions across all sectors as evenly as possible.
  // Sector order is shuffled per call so flocks don't always stack on the
  // same side of the map across rebuilds.
  const distributeX = (count: number, pad = 60): number[] => {
    const order = sectors.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    const xs: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const sec = sectors[order[i % sectors.length]!]!;
      xs.push(randomInSector(sec, pad));
    }
    return xs;
  };

  // Centre Y of a layer plus a jitter so the sprites scatter inside the band.
  const yIn = (
    layerId: ObjectLayerId,
    jitterMin: number,
    jitterMax: number,
  ): number => layers[layerId].centerY + rand(jitterMin, jitterMax);

  // ─── Layer 1 — low cloud band (drifts above horizon) ────────────────
  const lowCloudAliases = ["cloud1", "cloud2", "cloud3", "cloud4"] as const;
  const lowCloudCount = cnt(2);
  const lowCloudXs = distributeX(lowCloudCount, 120);
  for (let i = 0; i < lowCloudCount; i += 1) {
    push(
      makeWorldSprite(
        layer,
        lowCloudAliases[i % lowCloudAliases.length]!,
        lowCloudXs[i]!,
        yIn(1, 60, 200),
        rand(0.55, 0.85),
        pickFlip(),
        220 * mobileScale,
      ),
      1,
    );
  }

  // ─── Layer 2 — upper cloud band (heavier, sits below the planes) ────
  const upperCloudAliases = ["cloud5", "cloud6", "cloud7", "cloud8"] as const;
  const upperCloudCount = cnt(2);
  const upperCloudXs = distributeX(upperCloudCount, 120);
  for (let i = 0; i < upperCloudCount; i += 1) {
    push(
      makeWorldSprite(
        layer,
        upperCloudAliases[i % upperCloudAliases.length]!,
        upperCloudXs[i]!,
        yIn(2, 30, 180),
        rand(0.5, 0.8),
        pickFlip(),
        260 * mobileScale,
      ),
      2,
    );
  }

  // ─── Layer 1 — few low-air Spine birds (phones: typically 2) ────────
  const lowAirBirdCount = isMobile ? 2 : 3;
  const lowBirdXs = distributeX(lowAirBirdCount, 220);
  for (let b = 0; b < lowAirBirdCount; b += 1) {
    const flip = pickFlip();
    push(
      spawnSpineAmbient(layer, {
        skeleton: "spineBirdJson",
        atlas: "spineBirdAtlas",
        animation: "loop",
        x: lowBirdXs[b]! + rand(-40, 40),
        y: yIn(1, -220, -100),
        alpha: rand(0.88, 1),
        flip,
        targetWidth: (isMobile ? 82 : 90) * mobileScale,
        label: AMBIENT_SPINE_BIRD_LABEL,
      }),
      1,
    );
  }

  // ─── Layer 2 — helicopter band flock: more birds, higher above horizon
  const heliBandBirdCount = isMobile ? 5 : 6;
  const heliBirdXs = distributeX(heliBandBirdCount, 140);
  for (let b = 0; b < heliBandBirdCount; b += 1) {
    const flip = pickFlip();
    push(
      spawnSpineAmbient(layer, {
        skeleton: "spineBirdJson",
        atlas: "spineBirdAtlas",
        animation: "loop",
        x: heliBirdXs[b]! + rand(-50, 50),
        y: yIn(2, -360, -200),
        alpha: rand(0.85, 1),
        flip,
        targetWidth: (isMobile ? 78 : 86) * mobileScale,
        label: AMBIENT_SPINE_BIRD_LABEL,
      }),
      2,
    );
  }

  // ─── Layer 2 — helicopters (sit BELOW the cloud line per §3.3) ──────
  const heliAliases = ["helicopter", "helicopter2"] as const;
  const heliCount = isMobile ? 1 : 2;
  const heliXs = distributeX(heliCount, 200);
  for (let i = 0; i < heliCount; i += 1) {
    push(
      makeWorldSprite(
        layer,
        heliAliases[i % heliAliases.length]!,
        heliXs[i]!,
        // negative jitter shifts the heli slightly upward of band centre
        // so it cleanly sits below the upper-cloud band drawn above.
        yIn(2, -240, -100),
        rand(0.85, 1),
        pickFlip(),
        220 * mobileScale,
      ),
      2,
    );
  }

  // ─── Layer 3 — planes (ABOVE the upper-cloud line) ──────────────────
  const planeAliases = ["plane", "plane2", "plane3"] as const;
  const planeCount = cnt(2);
  const planeXs = distributeX(planeCount, 200);
  for (let i = 0; i < planeCount; i += 1) {
    push(
      makeWorldSprite(
        layer,
        planeAliases[i % planeAliases.length]!,
        planeXs[i]!,
        yIn(3, -80, 100),
        rand(0.85, 1),
        pickFlip(),
        260 * mobileScale,
      ),
      3,
    );
  }

  // ─── Layer 4 — UFO (one prominent alien) + atmospheric meteor ───────
  push(
    spawnSpineIdleAmbient(layer, {
      skeleton: "spineUfoJson",
      atlas: "spineUfoAtlas",
      animation: "idle",
      x: sectors[Math.floor(sectors.length * 0.3)]!.centerX,
      y: yIn(4, -40, 40),
      alpha: 0.95,
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
        sectors[Math.floor(sectors.length * 0.65)]!.centerX,
        yIn(4, 40, 120),
        0.9,
        pickFlip(),
        180 * mobileScale,
      ),
      4,
    );
  }

  // ─── Layer 5 — satellites (sparse, slow drift) ──────────────────────
  const satCount = cnt(2);
  const satXs = distributeX(satCount, 250);
  for (let i = 0; i < satCount; i += 1) {
    push(
      spawnSpineIdleAmbient(layer, {
        skeleton: "spineSatelliteJson",
        atlas: "spineSatelliteAtlas",
        animation: "idle",
        x: satXs[i]!,
        y: yIn(5, -120, 80),
        alpha: rand(0.85, 1),
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
  const clusterXs = distributeX(clusterCount, 200);
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
      rock.alpha = rand(0.78, 0.95);
      rock.rotation = rand(-0.8, 0.8);
      layer.addChild(rock);
      push(rock, 5);
    }
  }

  // ─── Layer 5 — comets (meteor streaks high up in deep space) ────────
  const cometCount = cnt(1);
  const cometXs = distributeX(cometCount, 250);
  for (let i = 0; i < cometCount; i += 1) {
    push(
      makeWorldSprite(
        layer,
        "meteors",
        cometXs[i]!,
        yIn(5, -360, -180),
        rand(0.7, 0.9),
        pickFlip(),
        180 * mobileScale,
      ),
      5,
    );
  }

  // ─── Layer 0 — parked golf carts (no fairway creep; see `fixedGround`) ─
  const cartCount = isMobile ? 1 : 2;
  const cartXs = distributeX(cartCount, 300);
  for (let i = 0; i < cartCount; i += 1) {
    const x = cartXs[i]!;
    const cart = spawnGolfCartSprite({
      parent: layer,
      x,
      surfaceY: hillSurfaceY(x),
      widthScaleMul: mobileScale,
      flip: pickFlip(),
    });
    push(cart, 0, { fixedGround: true });
  }

  // ─── Layer 0 — mole peeking out of the ground (decorative) ──────────
  const mole = new Graphics();
  mole.ellipse(0, 0, 28, 10).fill({ color: 0x1a0e06, alpha: 0.58 });
  mole.ellipse(0, -9, 14, 12).fill({ color: 0x6b4423, alpha: 0.72 });
  mole.x = 1420;
  mole.y = layers[0].centerY + 18;
  layer.addChild(mole);

  return { container: layer, spawns };
};
