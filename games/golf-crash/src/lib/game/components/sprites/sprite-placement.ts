import { Assets, Container, Sprite } from "pixi.js";
import {
  AMBIENT_SPINE_BIRD_LABEL,
  AMBIENT_SPINE_DUCK_LABEL,
  HAZARD_SPINE_BIRD_LABEL,
} from "./spine-ambient.js";

/** Horizontal speed component for patrol ambient: X = baseX + ax*sin(now/ms/1300 + phase). */
export const PATROL_X_WOBBLE_MS = 1300;

export const effectiveAmbientPatrolVx = (
  vx: number,
  amplitudeX: number,
  nowMs: number,
  phase: number,
): number =>
  vx +
  (amplitudeX * Math.cos(nowMs / PATROL_X_WOBBLE_MS + phase) * 1000) /
    PATROL_X_WOBBLE_MS;
 
/** Movement vs mirror: set `invert` when PNG nose points left (+vx needs flip relative to baseline). */
export const faceSpriteDirection = (
  sprite: Container,
  vx: number,
  smoothing = 0.5,
  invert = false,
): void => {
  if (!sprite.scale || Math.abs(vx) < 0.5) return;
  const toward = vx >= 0 ? 1 : -1;
  const targetFacing = invert ? -toward : toward;
  const currentWidthScale = Math.max(Math.abs(sprite.scale.y), 0.001);
  const targetScaleX = targetFacing * currentWidthScale;
  sprite.scale.x += (targetScaleX - sprite.scale.x) * smoothing;
  if (Math.abs(targetScaleX - sprite.scale.x) < 0.001)
    sprite.scale.x = targetScaleX;
};

export const place = (
  sprite: Sprite,
  x: number,
  y: number,
  scale: number,
  anchor = 0.5,
): void => {
  sprite.anchor.set(anchor);
  sprite.scale.set(scale);
  sprite.x = x;
  sprite.y = y;
};

export const setSpriteVisualWidth = (
  sprite: Sprite,
  width: number,
  flip = false,
): void => {
  const ratio = width / Math.max(1, sprite.texture.width);
  sprite.scale.set(ratio);
  if (flip) sprite.scale.x = -Math.abs(sprite.scale.x);
};

export const isSpriteAlias = (sprite: Sprite, aliases: string[]): boolean =>
  aliases.some((alias) => sprite.texture === Assets.get(alias));

export const directionalSpriteKind = (
  node: Container,
): "plane" | "helicopter" | "bird" | "duck" | "cart" | null => {
  if (node.label === AMBIENT_SPINE_BIRD_LABEL) return "bird";
  if (node.label === HAZARD_SPINE_BIRD_LABEL) return "bird";
  if (node.label === AMBIENT_SPINE_DUCK_LABEL) return "duck";
  if (!(node instanceof Sprite)) return null;
  if (isSpriteAlias(node, ["plane", "plane2", "plane3"])) return "plane";
  if (isSpriteAlias(node, ["helicopter", "helicopter2"])) return "helicopter";
  if (isSpriteAlias(node, ["bird", "bird2"])) return "bird";
  if (isSpriteAlias(node, ["duck", "duck2"])) return "duck";
  if (isSpriteAlias(node, ["golfCar"])) return "cart";
  return null;
};
