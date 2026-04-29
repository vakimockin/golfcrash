import {
  Assets,
  FillGradient,
  Graphics,
  Sprite,
  type Container,
  type Texture,
} from "pixi.js";
import type { VisualTimeMode } from "../../stores/game.svelte.js";

export type VisualWorldTheme = {
  id: "sunny" | "golden" | "night";
  skyAlias: string;
  celestialAlias: "sun" | "moon";
  celestialX: number;
  celestialY: number;
  celestialScale: number;
  celestialAlpha: number;
  starsAlpha: number;
  flyerAlpha: number;
  terrainTint: number;
};

export type LayeredBackgroundRefs = {
  darkSpace: Sprite;
  /** Night-only gradient sky (replaces lower sky bitmap when visible). */
  skyNightGradient: Graphics;
  /** Night-only star field drawn above gradient sky. */
  starsNight: Graphics;
  lowerSky: Sprite;
  celestial: Sprite;
};

export const getMobileScale = (canvasW: number, _canvasH: number): number =>
  canvasW < 600 ? 0.75 : 1;

const setSpriteVisualWidth = (sprite: Sprite, width: number): void => {
  const ratio = width / Math.max(1, sprite.texture.width);
  sprite.scale.set(ratio);
};

export const buildLayeredBackground = (
  parent: Container,
  mode: VisualTimeMode,
  theme: VisualWorldTheme,
  canvasW: number,
  canvasH: number,
  worldW: number,
  worldH: number,
  groundY: number,
  refs: LayeredBackgroundRefs | null = null,
): LayeredBackgroundRefs | null => {
  if (worldW <= 0 || worldH <= 0) return refs;

  const bgW = worldW;
  const bgX = 0;
  const bgH = worldH;
  // Boundary between deep-space and the unified sky. Placed between the
  // high-air (planes, Layer 3 ~ 0.7 of FLIGHT_SPAN) and atmosphere (UFOs/
  // meteors, Layer 4 ~ 0.85) bands so the entire atmospheric region — birds
  // (L1), helicopters (L2), and planes (L3) — falls under ONE stretched sky
  // texture. Layers 4 and 5 sit above this line, in dark space.
  const skyBoundaryY = groundY * 0.28;
  // Overlap zone where the two textures meet. The sky is drawn after space
  // so it covers the seam; the textures' natural gradients blend across it.
  const overlapY = groundY * 0.02;
  const spaceTop = 0;
  const spaceHeight = skyBoundaryY + overlapY * 0.5;
  const skyTop = Math.max(0, skyBoundaryY - overlapY * 0.5);
  const skyHeight = bgH - skyTop;

  const lowerAlias: "skyDay" | "skyEvening" | "skyNight" =
    mode === "evening" ? "skyEvening" : mode === "night" ? "skyNight" : "skyDay";

  const nextRefs =
    refs ??
    (() => {
      const darkSpace = new Sprite(Assets.get("darkSpaceSky"));
      darkSpace.anchor.set(0, 0);
      parent.addChild(darkSpace);
      const skyNightGradient = new Graphics();
      skyNightGradient.visible = false;
      parent.addChild(skyNightGradient);
      const starsNight = new Graphics();
      starsNight.visible = false;
      parent.addChild(starsNight);
      const lowerSky = new Sprite(Assets.get(lowerAlias));
      lowerSky.anchor.set(0, 0);
      parent.addChild(lowerSky);
      const celestial = new Sprite(
        theme.celestialAlias === "moon" ? Assets.get("moon") : Assets.get("sun"),
      );
      celestial.anchor.set(0.5);
      parent.addChild(celestial);
      return { darkSpace, skyNightGradient, starsNight, lowerSky, celestial };
    })();

  const isNight = mode === "night";

  nextRefs.darkSpace.texture = Assets.get("darkSpaceSky") as Texture;
  nextRefs.darkSpace.x = bgX;
  nextRefs.darkSpace.y = spaceTop;
  nextRefs.darkSpace.width = bgW;
  nextRefs.darkSpace.height = Math.max(1, spaceHeight);
  nextRefs.darkSpace.alpha = 1;

  if (isNight) {
    const skyGrad = new FillGradient({
      type: "linear",
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      textureSpace: "local",
      colorStops: [
        { offset: 0, color: 0x06080f },
        { offset: 0.35, color: 0x142438 },
        { offset: 0.72, color: 0x355a82 },
        { offset: 1, color: 0x7eb8e8 },
      ],
    });
    nextRefs.skyNightGradient.clear();
    nextRefs.skyNightGradient
      .rect(bgX, skyTop, bgW, Math.max(1, skyHeight))
      .fill(skyGrad);
    nextRefs.skyNightGradient.visible = true;

    nextRefs.starsNight.clear();
    const starsBandH = Math.max(1, skyHeight * 0.62);
    const starCount = 520;
    for (let i = 0; i < starCount; i += 1) {
      const sx = Math.random() * bgW;
      const sy = skyTop + Math.random() * starsBandH;
      const depth = (sy - skyTop) / starsBandH;
      const a = 0.28 + (1 - depth) * 0.62;
      const r = 0.35 + Math.random() * 1.35;
      nextRefs.starsNight.circle(sx, sy, r).fill({ color: 0xffffff, alpha: a });
    }
    nextRefs.starsNight.visible = true;
  } else {
    nextRefs.skyNightGradient.visible = false;
    nextRefs.starsNight.visible = false;
  }

  nextRefs.lowerSky.texture = Assets.get(lowerAlias) as Texture;
  nextRefs.lowerSky.x = bgX;
  nextRefs.lowerSky.y = skyTop;
  nextRefs.lowerSky.width = bgW;
  nextRefs.lowerSky.height = Math.max(1, skyHeight);
  nextRefs.lowerSky.alpha = 1;
  nextRefs.lowerSky.visible = !isNight;

  nextRefs.celestial.texture = (theme.celestialAlias === "moon"
    ? Assets.get("moon")
    : Assets.get("sun")) as Texture;
  nextRefs.celestial.x = theme.celestialX;
  nextRefs.celestial.y = theme.celestialY;
  const baseCelestialWidth = theme.celestialAlias === "moon" ? 210 : 300;
  const responsiveWidth = baseCelestialWidth * getMobileScale(canvasW, canvasH);
  setSpriteVisualWidth(nextRefs.celestial, responsiveWidth);
  nextRefs.celestial.alpha = theme.celestialAlpha;
  return nextRefs;
};
