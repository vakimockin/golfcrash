import { Assets, Container, Sprite } from "pixi.js";
import { setSpriteVisualWidth } from "./sprite-placement.js";

export const GOLF_CART_ASSET_ALIAS = "golfCar" as const;

/** Target width on screen (world px at scale 1) — shared across all spawn paths. */
export const GOLF_CART_VISUAL_WIDTH_PX = 150;

/** SVG anchor placed on `surfaceY` (wheels / fairway contact). */
export const GOLF_CART_SURFACE_ANCHOR_X = 0.5;
export const GOLF_CART_SURFACE_ANCHOR_Y = 0.6;

/** Y offset from the contact line for planned impact. */
export const GOLF_CART_IMPACT_OFFSET_Y_PX = 1;

export const GOLF_CART_ALPHA_AMBIENT = 1;

export const GOLF_CART_ALPHA_PLANNED_PRIMARY = 1;
export const GOLF_CART_ALPHA_PLANNED_SECONDARY = 1;

/** After the highlight window in `updatePlannedHazards` (secondary cart vs others at 0.62). */
export const GOLF_CART_ALPHA_PLANNED_SECONDARY_STEADY = 1;

export type SpawnGolfCartSpriteArgs = {
  parent: Container;
  x: number;
  /** `hillSurfaceY(x)` (or equivalent road baseline). */
  surfaceY: number;
  /** Width multiplier: pass `getMobileScale` for ambient carts. */
  widthScaleMul?: number;
  flip?: boolean;
  alpha?: number;
  impactOffsetY?: number;
};

export function spawnGolfCartSprite({
  parent,
  x,
  surfaceY,
  widthScaleMul = 1,
  flip = false,
  alpha = GOLF_CART_ALPHA_AMBIENT,
  impactOffsetY = 0,
}: SpawnGolfCartSpriteArgs): Sprite {
  const sprite = new Sprite(Assets.get(GOLF_CART_ASSET_ALIAS));
  sprite.anchor.set(GOLF_CART_SURFACE_ANCHOR_X, GOLF_CART_SURFACE_ANCHOR_Y);
  sprite.x = x;
  sprite.y = surfaceY - impactOffsetY;
  setSpriteVisualWidth(sprite, GOLF_CART_VISUAL_WIDTH_PX * widthScaleMul, flip);
  sprite.alpha = alpha;
  parent.addChild(sprite);
  return sprite;
}
