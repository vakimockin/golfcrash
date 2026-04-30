import type { Container } from "pixi.js";

export type ObjectLayerId = 0 | 1 | 2 | 3 | 4 | 5;

export type ObjectLayers = Record<ObjectLayerId, { name: string; centerY: number }>;

export type TerrainLayers = {
  root: Container;
  backTerrain: Container;
  midTerrain: Container;
  frontTerrain: Container;
};
