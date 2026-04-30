import { pickWorldByHour } from "../../../config/worlds.js";
import type { VisualTimeMode } from "../../../stores/game.svelte.js";
import type { WorldId } from "../../entities/Background.js";

export type VisualWorld = Extract<WorldId, "sunny" | "golden" | "night">;

export type VisualWorldTheme = {
  id: VisualWorld;
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

export const WORLD_THEMES: Record<VisualWorld, VisualWorldTheme> = {
  sunny: {
    id: "sunny",
    skyAlias: "skyDay",
    celestialAlias: "sun",
    celestialX: 3820,
    celestialY: 1180,
    celestialScale: 0.16,
    celestialAlpha: 0.7,
    starsAlpha: 0,
    flyerAlpha: 0.82,
    terrainTint: 0xffffff,
  },
  golden: {
    id: "golden",
    skyAlias: "skyEvening",
    celestialAlias: "sun",
    celestialX: 2550,
    celestialY: 3180,
    celestialScale: 0.18,
    celestialAlpha: 0.82,
    starsAlpha: 0.32,
    flyerAlpha: 0.75,
    terrainTint: 0xfff0c8,
  },
  night: {
    id: "night",
    skyAlias: "skyNight",
    celestialAlias: "moon",
    celestialX: 3680,
    celestialY: 920,
    celestialScale: 0.2,
    celestialAlpha: 0.78,
    starsAlpha: 0.58,
    flyerAlpha: 0.58,
    terrainTint: 0x8fa8d8,
  },
};

export const currentVisualWorld = (): VisualWorld => {
  const id = pickWorldByHour(new Date().getHours());
  return id === "golden" || id === "night" ? id : "sunny";
};

export const visualWorldFromMode = (mode: VisualTimeMode): VisualWorld =>
  mode === "evening" ? "golden" : mode === "night" ? "night" : "sunny";
