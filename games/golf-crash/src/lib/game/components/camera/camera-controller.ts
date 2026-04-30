import type { Container, Sprite } from "pixi.js";
import type { TerrainLayers } from "../core/world-types.js";

type CameraStateArgs = {
  world: Container;
  terrainLayer: TerrainLayers | null;
  canvasW: number;
  canvasH: number;
  worldW: number;
  worldH: number;
  groundY: number;
  ballStartX: number;
  ballStartY: number;
  flightFocusX: number;
  flightFocusY: number;
  idleFocusX: number;
  cameraLerp: number;
  multiplier: number;
  phase: string;
  isJackpot: boolean;
  currentTeeX: number;
  currentTeeY: number;
  characterSprite: Sprite | null;
  fireBallSprite: Sprite | null;
  displayScale: number;
};

export const computeCameraT = (mult: number): number =>
  Math.min(1, Math.log(Math.max(1, mult)) / Math.log(10));

export const computeScale = (
  t: number,
  canvasW: number,
  canvasH: number,
  phase: string,
  isJackpot: boolean,
): number => {
  const aspect = canvasW / canvasH;
  const visibleGroundHeight = aspect > 1 ? 2800 : 1100;
  const visibleFlightHeight = aspect > 1 ? 800 : 1000;
  const visibleCrashedHeight = aspect > 1 ? 1800 : 2400;
  const zoomIn = canvasH / visibleGroundHeight;
  const zoomOut = canvasH / visibleFlightHeight;
  if (phase === "flight" || (phase === "landed" && isJackpot)) return zoomOut;
  if (phase === "crashed") return canvasH / visibleCrashedHeight;
  return zoomIn - t * (zoomIn - zoomOut);
};

export const updateCamera = ({
  world,
  terrainLayer,
  canvasW,
  canvasH,
  worldW,
  worldH,
  groundY,
  ballStartX,
  ballStartY,
  flightFocusX,
  flightFocusY,
  idleFocusX,
  cameraLerp,
  multiplier,
  phase,
  isJackpot,
  currentTeeX,
  currentTeeY,
  characterSprite,
  fireBallSprite,
  displayScale,
}: CameraStateArgs): { displayScale: number } => {
  const t = computeCameraT(multiplier);
  const targetScale = computeScale(t, canvasW, canvasH, phase, isJackpot);
  const nextDisplayScale =
    displayScale < 0
      ? targetScale
      : displayScale + (targetScale - displayScale) * cameraLerp;
  const scale = nextDisplayScale;

  const followFlight = phase === "flight" && fireBallSprite !== null;
  const followRun = phase === "runToBall" && characterSprite !== null;
  const followLanded = phase === "landed" && !isJackpot;
  const followCrashed = phase === "crashed" && fireBallSprite !== null;
  const followRest =
    phase === "idle" || phase === "cashOut" || phase === "lose";
  const shouldFollow =
    followFlight || followRun || followLanded || followCrashed || followRest;
  const ballFollow = followFlight || followCrashed;

  const aspect = canvasW / canvasH;
  const idleFocusXValue = aspect > 1 ? idleFocusX : 0.5;
  const idleFocusY = aspect > 1 ? 0.78 : 0.7;
  const bottomUiPaddingPx = aspect < 1 ? canvasH * 0.2 : canvasH * 0.08;

  const targetX = followFlight
    ? fireBallSprite!.x
    : followCrashed
      ? fireBallSprite!.x
      : followRun
        ? characterSprite!.x
        : followLanded || followRest
          ? currentTeeX
          : ballStartX;
  const targetY = followFlight
    ? fireBallSprite!.y
    : followCrashed
      ? fireBallSprite!.y
      : followRun
        ? characterSprite!.y
        : followLanded || followRest
          ? currentTeeY
          : ballStartY;

  const groundCamY = canvasH - groundY * scale;
  const dynamicFlightFocusY = aspect < 1 ? 0.75 : flightFocusY;
  const focusY = ballFollow
    ? canvasH * dynamicFlightFocusY
    : canvasH * idleFocusY;
  const centeredCamY =
    focusY - targetY * scale - (ballFollow ? bottomUiPaddingPx : 0);

  world.scale.set(scale);
  const cameraFocusX = ballFollow
    ? canvasW * flightFocusX
    : shouldFollow
      ? canvasW * idleFocusXValue
      : canvasW * 0.5;
  const rawX = cameraFocusX - targetX * scale;
  const minX = canvasW - worldW * scale;
  world.x =
    worldW * scale <= canvasW
      ? (canvasW - worldW * scale) / 2
      : Math.max(minX, Math.min(0, rawX));

  const rawY = ballFollow ? Math.max(groundCamY, centeredCamY) : groundCamY;
  const minY = canvasH - worldH * scale;
  world.y = Math.max(minY, rawY);

  if (terrainLayer) {
    terrainLayer.backTerrain.x = world.x * 0.65;
    terrainLayer.midTerrain.x = world.x * 0.35;
    terrainLayer.frontTerrain.x = 0;
  }

  return { displayScale: nextDisplayScale };
};
