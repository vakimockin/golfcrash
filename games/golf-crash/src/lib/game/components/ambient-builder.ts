import { Assets, Container, Graphics, Sprite } from "pixi.js";
import { buildSectors, randomInSector } from "./sectors.js";
import type { ObjectLayerId, ObjectLayers } from "./world-types.js";

export type AmbientMobSpawn = {
  node: Sprite;
  layerId: ObjectLayerId;
  flipbookAlias?: string;
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
    sprite: Sprite,
    layerId: ObjectLayerId,
    flipbookAlias?: string,
  ) => spawns.push({ node: sprite, layerId, flipbookAlias });
  const rand = (min: number, max: number): number =>
    min + Math.random() * (max - min);
  const sectors = buildSectors(worldW, 6);

  const cloudAliases = [
    "cloud1",
    "cloud2",
    "cloud3",
    "cloud4",
    "cloud5",
    "cloud6",
  ] as const;
  for (let i = 0; i < 6; i += 1) {
    const y =
      i % 2 === 0
        ? layers[1].centerY + rand(40, 180)
        : layers[2].centerY + rand(-80, 120);
    push(
      makeWorldSprite(
        layer,
        cloudAliases[i % cloudAliases.length]!,
        randomInSector(sectors[i % sectors.length]!, 20),
        y,
        rand(0.15, 0.34),
        Math.random() < 0.4,
        150 * mobileScale,
      ),
      i % 2 === 0 ? 1 : 2,
    );
  }

  const planeAliases = ["plane", "plane2", "plane3"] as const;
  for (let i = 0; i < 3; i += 1) {
    push(
      makeWorldSprite(
        layer,
        planeAliases[i % planeAliases.length]!,
        randomInSector(sectors[(i * 2) % sectors.length]!, 40),
        layers[3].centerY + rand(-130, 90),
        rand(0.62, 0.82),
        Math.random() < 0.5,
        150 * mobileScale,
      ),
      3,
    );
  }

  const heliAliases = ["helicopter", "helicopter2"] as const;
  for (let i = 0; i < 2; i += 1) {
    push(
      makeWorldSprite(
        layer,
        heliAliases[i % heliAliases.length]!,
        randomInSector(sectors[(i * 3) % sectors.length]!, 40),
        layers[2].centerY + rand(-140, 120),
        rand(0.66, 0.82),
        Math.random() < 0.5,
        150 * mobileScale,
      ),
      2,
    );
  }

  for (let i = 0; i < 5; i += 1) {
    const isDuck = Math.random() < 0.35;
    const alias = isDuck ? (Math.random() < 0.5 ? "duck" : "duck2") : "bird";
    push(
      makeWorldSprite(
        layer,
        alias,
        randomInSector(sectors[(i * 4) % sectors.length]!, 40),
        layers[1].centerY + rand(-110, 110),
        rand(0.64, 0.84),
        Math.random() < 0.5,
        150 * mobileScale,
      ),
      1,
      alias === "bird" ? "bird" : "duck",
    );
  }

  for (let i = 0; i < 4; i += 1) {
    const rock = new Sprite(Assets.get(`asteroid${(i % 9) + 1}`));
    rock.anchor.set(0.5);
    rock.x = randomInSector(sectors[(i * 5) % sectors.length]!, 10);
    rock.y = layers[5].centerY + rand(-440, -120);
    const s = rand(0.08, 0.18);
    rock.scale.set(s);
    rock.alpha = rand(0.78, 0.95);
    rock.rotation = rand(-0.8, 0.8);
    layer.addChild(rock);
    push(rock, 5);
  }

  for (let i = 0; i < 3; i += 1) {
    const cart = makeWorldSprite(
      layer,
      "golfCar",
      rand(120, worldW - 120),
      layers[0].centerY,
      0.9,
      Math.random() < 0.5,
      2300 * mobileScale,
    );
    // golf_car.svg has a tall canvas with visual content above the bottom edge.
    // Use a tuned anchor so wheels sit on the gameplay surface.
    cart.anchor.set(0.5, 0.36);
    push(cart, 0);
  }

  const mole = new Graphics();
  mole.ellipse(0, 0, 28, 10).fill({ color: 0x1a0e06, alpha: 0.58 });
  mole.ellipse(0, -9, 14, 12).fill({ color: 0x6b4423, alpha: 0.72 });
  mole.x = 1420;
  mole.y = layers[0].centerY + 18;
  layer.addChild(mole);

  return { container: layer, spawns };
};
