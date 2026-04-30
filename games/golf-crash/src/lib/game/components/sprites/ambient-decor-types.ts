import type { Container, Sprite, Texture } from "pixi.js";
import type { ObjectLayerId } from "../core/world-types.js";

export type AmbientMotion = {
  node: Container;
  layerId: ObjectLayerId;
  kind: "plane" | "helicopter" | "bird" | "duck" | "cart" | null;
  aiType: "plane" | "patrol" | "cloud";
  originX: number;
  baseX: number;
  baseY: number;
  vx: number;
  vy: number;
  phase: number;
  amplitudeX: number;
  amplitudeY: number;
  patrolRadius: number;
  wrapMinX: number;
  wrapMaxX: number;
  facing: 1 | -1;
  clampYMin: number;
  clampYMax: number;
};

export type Flipbook = {
  sprite: Sprite;
  frames: Texture[];
  frameMs: number;
  phase: number;
  visualWidth: number;
};

export type Effect = {
  node: Container | Sprite;
  vx: number;
  vy: number;
  expiresAt: number;
};
