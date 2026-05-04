import {
  Assets,
  Graphics,
  Sprite,
  type Container,
  type Texture,
} from "pixi.js";
import type { VisualTimeMode } from "../../../stores/game.svelte.js";
import { BACKGROUND_OVERSCAN_X } from "../constants/world-metrics.js";

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
  /** Reserved (no procedural fills — only bitmap skies). */
  skyNightGradient: Graphics;
  /** Reserved (no procedural stars — use texture artwork only). */
  starsNight: Graphics;
  /** `stars.svg` over the cosmic strip (not world-layer cloud sprites). */
  cosmicStars: Sprite;
  /** `clouds_strip_*.svg` at the space ↔ sky handoff. */
  cloudStrip: Sprite;
  lowerSky: Sprite;
  /** Alpha mask so the top of the lower sky fades into `dark_space`. */
  daySkyMask: Graphics;
  celestial: Sprite;
};

export const getMobileScale = (canvasW: number, _canvasH: number): number =>
  canvasW < 600 ? 0.75 : 1;

const setSpriteVisualWidth = (sprite: Sprite, width: number): void => {
  const ratio = width / Math.max(1, sprite.texture.width);
  sprite.scale.set(ratio);
};

const LOWER_SKY_MASK_BANDS = 72;

/** World Y where the bottom of `sky_day` / `sky_*` bitmap should sit (fairway horizon). */
const skyBitmapBottomY = (groundY: number): number => groundY + 88;

/**
 * Camera can shift the world so the top of the canvas maps to large negative Y.
 */
const skyPadTopPx = (groundY: number, canvasH: number): number =>
  Math.max(Math.round(groundY * 0.7), Math.round(canvasH * 3.8));

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
  /**
   * When `?fullWorld=1`, the world is centered and narrower than the canvas on
   * landscape aspect — widen sky sprites by the same horizontal margin (world px).
   */
  fullWorldPillarBleed = false,
): LayeredBackgroundRefs | null => {
  if (worldW <= 0 || worldH <= 0) return refs;

  const isDay = mode === "day";
  const padTop = skyPadTopPx(groundY, canvasH);
  const spaceTop = -padTop;
  const horizonY = skyBitmapBottomY(groundY);
  const overscan = BACKGROUND_OVERSCAN_X;

  let bleedWorld = 0;
  if (
    fullWorldPillarBleed &&
    canvasW > 0 &&
    canvasH > 0 &&
    worldW > 0 &&
    worldH > 0
  ) {
    const margin = 0.97;
    const s = Math.min(
      (canvasW * margin) / worldW,
      (canvasH * margin) / worldH,
    );
    const worldScreenW = worldW * s;
    if (canvasW > worldScreenW + 0.5) {
      bleedWorld = (canvasW - worldScreenW) / (2 * s);
    }
  }

  /** Horizontal padding each side — aligned with terrain tiling when bleed is 0. */
  const skyHorizPad = overscan + bleedWorld;
  const bgW = worldW + skyHorizPad * 2;
  const bgX = -skyHorizPad;
  /** Cosmic strip uses extra world padding on each side + pillar bleed. */
  const spaceEachSide = overscan * 2 + bleedWorld;
  const spaceBgW = worldW + spaceEachSide * 2;
  const spaceBgX = -spaceEachSide;

  /**
   * Upper cosmic strip (`dark_space_skyes`), then overlap into lower sky.
   * Lower sky MUST end near `horizonY`, not `worldH` — otherwise the bitmap
   * “horizon” paints at the bottom of the world and looks like sky under the course.
   *
   * Use a generous world-space overlap: a tight blend lets the stage black show
   * through at the cosmic ↔ daytime sky seam (especially zoomed out in fullWorld).
   */
  const cosmicBandH = groundY * 0.62 + padTop * 1.05;
  const blendOverlap = groundY * 0.3;
  const skyTop = spaceTop + cosmicBandH - blendOverlap;
  const skyHeight = Math.max(160, Math.ceil(horizonY - skyTop));

  const lowerAlias: "skyDay" | "skyEvening" | "skyNight" =
    mode === "evening"
      ? "skyEvening"
      : mode === "night"
        ? "skyNight"
        : "skyDay";

  const cloudStripAlias: "cloudsStripDay" | "cloudsStripEvening" | "cloudsStripNight" =
    mode === "evening"
      ? "cloudsStripEvening"
      : mode === "night"
        ? "cloudsStripNight"
        : "cloudsStripDay";

  const nextRefs =
    refs ??
    (() => {
      const darkSpace = new Sprite(Assets.get("darkSpaceSky"));
      darkSpace.anchor.set(0, 0);
      parent.addChild(darkSpace);
      const cosmicStars = new Sprite(Assets.get("starsSvg"));
      cosmicStars.anchor.set(0, 0);
      parent.addChild(cosmicStars);
      const skyNightGradient = new Graphics();
      skyNightGradient.visible = false;
      parent.addChild(skyNightGradient);
      const starsNight = new Graphics();
      starsNight.visible = false;
      parent.addChild(starsNight);
      const cloudStrip = new Sprite(Assets.get(cloudStripAlias));
      cloudStrip.anchor.set(0, 0);
      parent.addChild(cloudStrip);
      const lowerSky = new Sprite(Assets.get(lowerAlias));
      lowerSky.anchor.set(0, 0);
      parent.addChild(lowerSky);
      const daySkyMask = new Graphics();
      parent.addChild(daySkyMask);
      const celestial = new Sprite(
        theme.celestialAlias === "moon"
          ? Assets.get("moon")
          : Assets.get("sun"),
      );
      celestial.anchor.set(0.5);
      parent.addChild(celestial);
      return {
        darkSpace,
        skyNightGradient,
        starsNight,
        cosmicStars,
        cloudStrip,
        lowerSky,
        daySkyMask,
        celestial,
      };
    })();

  nextRefs.skyNightGradient.clear();
  nextRefs.skyNightGradient.visible = false;
  nextRefs.starsNight.clear();
  nextRefs.starsNight.visible = false;

  nextRefs.darkSpace.texture = Assets.get("darkSpaceSky") as Texture;
  nextRefs.darkSpace.visible = true;
  nextRefs.darkSpace.alpha = 1;
  nextRefs.darkSpace.x = spaceBgX;
  nextRefs.darkSpace.y = spaceTop;
  nextRefs.darkSpace.width = spaceBgW;
  nextRefs.darkSpace.height = Math.max(
    1,
    Math.ceil(cosmicBandH + blendOverlap),
  );

  nextRefs.cosmicStars.texture = Assets.get("starsSvg") as Texture;
  nextRefs.cosmicStars.x = spaceBgX;
  nextRefs.cosmicStars.y = spaceTop;
  nextRefs.cosmicStars.width = spaceBgW;
  nextRefs.cosmicStars.height = Math.max(
    1,
    Math.ceil(cosmicBandH + blendOverlap),
  );
  nextRefs.cosmicStars.visible = theme.starsAlpha > 0.015;
  nextRefs.cosmicStars.alpha = theme.starsAlpha;

  const ctStrip = Assets.get(cloudStripAlias) as Texture;
  nextRefs.cloudStrip.texture = ctStrip;
  const stripAspect = ctStrip.height / Math.max(1, ctStrip.width);
  const stripW = bgW;
  const stripH = stripW * stripAspect;
  nextRefs.cloudStrip.x = bgX;
  nextRefs.cloudStrip.width = stripW;
  nextRefs.cloudStrip.height = stripH;
  // Bottom of the vertical strip meets the lower-sky bitmap top.
  nextRefs.cloudStrip.y = skyTop + blendOverlap * 0.55 - stripH;
  nextRefs.cloudStrip.alpha = 0.94;
  nextRefs.cloudStrip.visible = true;

  nextRefs.lowerSky.texture = Assets.get(lowerAlias) as Texture;
  nextRefs.lowerSky.visible = true;
  nextRefs.lowerSky.alpha = 1;
  nextRefs.lowerSky.x = bgX;
  nextRefs.lowerSky.y = skyTop;
  nextRefs.lowerSky.width = bgW;
  nextRefs.lowerSky.height = Math.max(1, skyHeight);

  const mask = nextRefs.daySkyMask;
  mask.clear();
  const bandH = skyHeight / LOWER_SKY_MASK_BANDS;
  for (let i = 0; i < LOWER_SKY_MASK_BANDS; i += 1) {
    const t = (i + 0.5) / LOWER_SKY_MASK_BANDS;
    /** Slightly softer at the top so the hand-off to `darkSpace` is less harsh. */
    const a = Math.pow(t, 0.62);
    mask
      .rect(bgX, skyTop + i * bandH, bgW, Math.max(1, bandH))
      .fill({ color: 0xffffff, alpha: a });
  }
  nextRefs.lowerSky.mask = mask;

  nextRefs.celestial.texture = (
    theme.celestialAlias === "moon" ? Assets.get("moon") : Assets.get("sun")
  ) as Texture;
  nextRefs.celestial.x = theme.celestialX;
  nextRefs.celestial.y = theme.celestialY;
  const baseCelestialWidth = theme.celestialAlias === "moon" ? 650 : 800;
  const responsiveWidth = baseCelestialWidth * getMobileScale(canvasW, canvasH);
  setSpriteVisualWidth(nextRefs.celestial, responsiveWidth);
  nextRefs.celestial.alpha = theme.celestialAlpha;
  nextRefs.celestial.visible = !isDay;
  return nextRefs;
};
