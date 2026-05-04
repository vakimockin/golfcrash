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
  /** Base scale smoothing ~exp; higher = snappier (see `CAMERA_SCALE_SMOOTH_RATE`). */
  cameraScaleSmoothRate: number;
  /** Seconds since last frame (capped) for dt-correct smoothing. */
  dt: number;
  /** Optional smoothed/leading aim point during flight (world px). */
  flightLookAt: { x: number; y: number } | null;
  multiplier: number;
  phase: string;
  isJackpot: boolean;
  currentTeeX: number;
  currentTeeY: number;
  characterSprite: Container | null;
  fireBallSprite: Sprite | null;
  displayScale: number;
  /** Temporary punch-in after obstacle hits (1 = off). Lerped in bootstrap before call. */
  impactZoomMul?: number;
  /** Dev-only: fit entire world in the canvas, bottom-aligned (sky above the playfield). */
  devFitWholeWorld?: boolean;
  /** Dev-only: extra vertical pan (screen px) added to `world.y` in fullWorld (mouse wheel). */
  devExtraWorldPanY?: number;
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
  /** Wider FOV so the course reads as a large world, not a tight band (~+20%). */
  const visibleGroundHeight = aspect > 1 ? 1680 : 1920;
  /** Slightly wider base FOV in flight; zoom mul from bootstrap sells the punch-in. */
  const visibleFlightHeight = aspect > 1 ? 1760 : 1700;
  const visibleCrashedHeight = aspect > 1 ? 2160 : 2880;
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
  cameraScaleSmoothRate,
  dt,
  flightLookAt,
  multiplier,
  phase,
  isJackpot,
  currentTeeX,
  currentTeeY,
  characterSprite,
  fireBallSprite,
  displayScale,
  impactZoomMul = 1,
  devFitWholeWorld = false,
  devExtraWorldPanY = 0,
}: CameraStateArgs): { displayScale: number } => {
  if (
    devFitWholeWorld &&
    canvasW > 0 &&
    canvasH > 0 &&
    worldW > 0 &&
    worldH > 0
  ) {
    const margin = 0.97;
    const scale = Math.min(
      (canvasW * margin) / worldW,
      (canvasH * margin) / worldH,
    );
    world.scale.set(scale);
    world.x = (canvasW - worldW * scale) / 2;
    /** Bottom-align: fairway at the bottom edge, sky / layers fill upward (max vertical headroom above). */
    world.y = canvasH - worldH * scale + devExtraWorldPanY;
    if (terrainLayer) {
      terrainLayer.backTerrain.x = 0;
      terrainLayer.midTerrain.x = 0;
      terrainLayer.frontTerrain.x = 0;
    }
    return { displayScale: scale };
  }

  const t = computeCameraT(multiplier);
  /** Keep world at least as wide as the canvas so we do not pillarbox inside the playfield. */
  const scaleMinWidth = canvasW > 0 && worldW > 0 ? canvasW / worldW : 0;
  const targetScale = Math.max(
    computeScale(t, canvasW, canvasH, phase, isJackpot),
    scaleMinWidth,
  );
  const dtSec = Math.min(0.05, Math.max(0, dt));
  const scaleAlpha = 1 - Math.exp(-cameraScaleSmoothRate * dtSec);
  const nextDisplayScale =
    displayScale < 0
      ? targetScale
      : displayScale + (targetScale - displayScale) * scaleAlpha;
  const baseScale = Math.max(nextDisplayScale, scaleMinWidth);
  const scale = baseScale * impactZoomMul;

  const followFlight = phase === "flight" && fireBallSprite !== null;
  const followRun = phase === "runToBall" && characterSprite !== null;
  const followLanded = phase === "landed" && !isJackpot;
  const followCrashed = phase === "crashed" && fireBallSprite !== null;
  const followRest =
    phase === "idle" ||
    phase === "preShot" ||
    phase === "cashOut" ||
    phase === "lose";
  const shouldFollow =
    followFlight || followRun || followLanded || followCrashed || followRest;
  const ballFx = followFlight || followCrashed;
  const aim = followFlight && flightLookAt ? flightLookAt : null;

  const targetX = followFlight
    ? (aim?.x ?? fireBallSprite!.x)
    : followCrashed
      ? fireBallSprite!.x
      : followRun
        ? characterSprite!.x
        : followLanded || followRest
          ? currentTeeX
          : ballStartX;
  const targetY = followFlight
    ? (aim?.y ?? fireBallSprite!.y)
    : followCrashed
      ? fireBallSprite!.y
      : followRun
        ? characterSprite!.y
        : followLanded || followRest
          ? currentTeeY
          : ballStartY;

  const aspect = canvasW / canvasH;
  const idleFocusXValue = aspect > 1 ? idleFocusX : 0.5;
  const idleFocusY = aspect > 1 ? 0.78 : 0.7;
  const bottomUiPaddingPx = aspect < 1 ? canvasH * 0.2 : canvasH * 0.08;

  const groundCamY = canvasH - groundY * scale;
  const dynamicFlightFocusY = aspect < 1 ? 0.72 : flightFocusY;
  const focusY = ballFx ? canvasH * dynamicFlightFocusY : canvasH * idleFocusY;
  const centeredCamY =
    focusY - targetY * scale - (ballFx ? bottomUiPaddingPx : 0);

  world.scale.set(scale);
  const cameraFocusX = ballFx
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

  const rawY = ballFx ? Math.max(groundCamY, centeredCamY) : groundCamY;
  const minY = canvasH - worldH * scale;
  world.y = Math.max(minY, rawY);

  if (terrainLayer) {
    /**
     * Parallax only when the level is wider than the viewport. When it is
     * letterboxed (world centered with side margins), `world.x` is the centering
     * offset, not camera scroll — using it here used to shear back/mid layers and
     * expose black strips beside the sky/terrain.
     */
    const panX = worldW * scale > canvasW + 0.5 ? world.x : 0;
    const inv = scale > 1e-6 ? 1 / scale : 0;
    terrainLayer.backTerrain.x = -panX * 0.65 * inv;
    terrainLayer.midTerrain.x = -panX * 0.35 * inv;
    terrainLayer.frontTerrain.x = 0;
  }

  return { displayScale: baseScale };
};
