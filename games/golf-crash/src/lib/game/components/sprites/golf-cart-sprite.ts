/**
 * Единая точка для гольф-карты: размеры, якорь, альфы, алиас ассета.
 * Ambient (#buildObjectLayerSystem), превью плановых хазардов и map features
 * должны использовать только `spawnGolfCartSprite` + константы ниже.
 */
import { Assets, Container, Sprite } from "pixi.js";
import { setSpriteVisualWidth } from "./sprite-placement.js";

export const GOLF_CART_ASSET_ALIAS = "golfCar" as const;

/** Целевая ширина на экране (world px при scale 1) — общая для всех сценариев. */
export const GOLF_CART_VISUAL_WIDTH_PX = 150;

/** Точка на SVG, которую ставим на `surfaceY` (колёса / контакт с fairway). */
export const GOLF_CART_SURFACE_ANCHOR_X = 0.5;
export const GOLF_CART_SURFACE_ANCHOR_Y = 0.6;

/** Сдвиг вдоль Y от линии контакта для planned impact. */
export const GOLF_CART_IMPACT_OFFSET_Y_PX = 1;

export const GOLF_CART_ALPHA_AMBIENT = 1;

export const GOLF_CART_ALPHA_PLANNED_PRIMARY = 1;
export const GOLF_CART_ALPHA_PLANNED_SECONDARY = 0.95;

/** После окна подсветки в `updatePlannedHazards` (secondary cart vs остальные 0.62). */
export const GOLF_CART_ALPHA_PLANNED_SECONDARY_STEADY = 0.9;

export type SpawnGolfCartSpriteArgs = {
  parent: Container;
  x: number;
  /** Значение `hillSurfaceY(x)` (или эквивалент — линия дороги). */
  surfaceY: number;
  /** Множитель ширины: для ambient передайте `getMobileScale`. */
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
