import { Assets, Sprite, type Container, type Texture } from "pixi.js";
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
  const spaceTop = 0;
  const spaceHeight = groundY * 0.38;
  const skyTop = Math.max(0, spaceHeight - 4);
  const skyHeight = bgH - skyTop;

  const lowerAlias: "skyDay" | "skyEvening" | "skyNight" =
    mode === "evening" ? "skyEvening" : mode === "night" ? "skyNight" : "skyDay";

  const nextRefs =
    refs ??
    (() => {
      const darkSpace = new Sprite(Assets.get("darkSpaceSky"));
      darkSpace.anchor.set(0, 0);
      parent.addChild(darkSpace);
      const lowerSky = new Sprite(Assets.get(lowerAlias));
      lowerSky.anchor.set(0, 0);
      parent.addChild(lowerSky);
      const celestial = new Sprite(
        theme.celestialAlias === "moon" ? Assets.get("moon") : Assets.get("sun"),
      );
      celestial.anchor.set(0.5);
      parent.addChild(celestial);
      return { darkSpace, lowerSky, celestial };
    })();

  nextRefs.darkSpace.texture = Assets.get("darkSpaceSky") as Texture;
  nextRefs.darkSpace.x = bgX;
  nextRefs.darkSpace.y = spaceTop;
  nextRefs.darkSpace.width = bgW;
  nextRefs.darkSpace.height = Math.max(1, spaceHeight);
  nextRefs.darkSpace.alpha = 1;

  nextRefs.lowerSky.texture = Assets.get(lowerAlias) as Texture;
  nextRefs.lowerSky.x = bgX;
  nextRefs.lowerSky.y = skyTop;
  nextRefs.lowerSky.width = bgW;
  nextRefs.lowerSky.height = Math.max(1, skyHeight);
  nextRefs.lowerSky.alpha = 1;

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
