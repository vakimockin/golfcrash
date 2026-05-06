import type { Container, Sprite } from "pixi.js";
import type { TerrainLayers } from "../core/world-types.js";
import {
  CAMERA_PAN_RATE_CRASHED,
  CAMERA_PAN_RATE_DEFAULT,
  CAMERA_PAN_RATE_FLIGHT_X,
  CAMERA_PAN_RATE_FLIGHT_Y,
} from "../constants/world-metrics.js";

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

/**
 * Scale = canvasH / visibleWorldHeightPx. Smaller visibleHeight ⇒ bigger
 * scale ⇒ tighter zoom-IN; larger visibleHeight ⇒ wider zoom-OUT.
 *
 * § ТЗ: Zoom-IN during `flight`; zoom-OUT to panorama once the ball is on the
 *   ground — `landed` (including jackpot near-miss), `runToBall`, `crashed`,
 *   `idle`, etc.
 *
 * Returned value is the TARGET; bootstrap separately lerps `displayScale`
 * toward it via `CAMERA_SCALE_SMOOTH_RATE`, so phase changes ramp smoothly.
 */
export const computeScale = (
  t: number,
  canvasW: number,
  canvasH: number,
  phase: string,
  _isJackpot: boolean,
): number => {
  const aspect = canvasW / canvasH;
  // Wide field-of-view: visible vertical span when zoomed OUT (idle, run,
  // landed, …). The course reads as a big landscape; ball + flag both fit.
  const visibleHeightZoomedOut = aspect > 1 ? 1600 : 2300;
  // Tight FOV during flight: ~1.3× closer than zoomed-out, so the ball
  // dominates while still leaving room for camera-lag (ball escapes right).
  const visibleHeightZoomedIn = aspect > 1 ? 1200 : 1500;
  // Loss-tight FOV for crashed / lose: a hair tighter than flight-end so the
  // camera does not "ease back out" after the ball is dead — the player just
  // lost, the impact lingers under a held-in framing for tension.
  const visibleHeightLossHold = aspect > 1 ? 1500 : 1800;

  const zoomedOut = canvasH / visibleHeightZoomedOut;
  const zoomedIn = canvasH / visibleHeightZoomedIn;

  if (phase === "flight") return zoomedIn;
  if (phase === "crashed" || phase === "lose")
    return canvasH / visibleHeightLossHold;
  // Idle / preShot / runToBall / landed (non-jackpot) / cashOut:
  // start zoomed OUT, gradually punch in as the multiplier grows for the
  // (rare) case we want a tease before flight.
  return zoomedOut + t * (zoomedIn - zoomedOut);
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
  const followJackpotLanded =
    phase === "landed" && isJackpot && fireBallSprite !== null;
  const followCrashed = phase === "crashed" && fireBallSprite !== null;
  // `lose` follows the dead-ball position when we still have a sprite — keeps
  // the held-tight loss framing (see `computeScale`) anchored at the impact
  // instead of snapping back to the tee.
  const followLose = phase === "lose" && fireBallSprite !== null;
  const followRest =
    phase === "idle" ||
    phase === "preShot" ||
    phase === "cashOut" ||
    (phase === "lose" && fireBallSprite === null);
  const shouldFollow =
    followFlight ||
    followRun ||
    followLanded ||
    followJackpotLanded ||
    followCrashed ||
    followLose ||
    followRest;
  const ballFx = followFlight || followCrashed || followLose;
  const aim = followFlight && flightLookAt ? flightLookAt : null;

  const targetX = followFlight
    ? (aim?.x ?? fireBallSprite!.x)
    : followCrashed
      ? fireBallSprite!.x
      : followLose
        ? fireBallSprite!.x
        : followJackpotLanded
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
      : followLose
        ? fireBallSprite!.y
        : followJackpotLanded
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

  // Capture LAST frame's transform BEFORE we overwrite scale — these are
  // the basis for both the lerp anchor AND the scale-change compensation.
  const prevScaleX = world.scale.x;
  const prevScaleY = world.scale.y;
  const prevWorldX = world.x;
  const prevWorldY = world.y;

  // Where is the focus point CURRENTLY visible on canvas? (under prev scale
  // and prev pan). We use this to keep that exact canvas position stable
  // when `scale` changes — which is what kills the "impact-zoom flick"
  // where a sudden 1.22× punch-in used to teleport the ball vertically.
  const focusCanvasX = targetX * prevScaleX + prevWorldX;
  const focusCanvasY = targetY * prevScaleY + prevWorldY;

  world.scale.set(scale);

  // Anchor = where world.x/y would be IF the focus stayed put under the new
  // scale. Lerping from this anchor (instead of plain `prevWorldX/Y`) means
  // a scale change alone produces zero canvas displacement of the ball;
  // the only motion comes from the actual target offset. With the lerp on
  // top, scale changes are smooth and ball-relative.
  const anchorWorldX = focusCanvasX - targetX * scale;
  const anchorWorldY = focusCanvasY - targetY * scale;

  const cameraFocusX = ballFx
    ? canvasW * flightFocusX
    : shouldFollow
      ? canvasW * idleFocusXValue
      : canvasW * 0.5;
  const rawX = cameraFocusX - targetX * scale;
  const minX = canvasW - worldW * scale;
  // World narrower than canvas → pillarbox-center horizontally.
  const targetWorldX =
    worldW * scale <= canvasW
      ? (canvasW - worldW * scale) / 2
      : Math.max(minX, Math.min(0, rawX));

  const rawY =
    ballFx || followJackpotLanded
      ? Math.max(groundCamY, centeredCamY)
      : groundCamY;
  const minY = canvasH - worldH * scale;
  const targetWorldY = Math.max(minY, rawY);

  /**
   * Pan-smoothing rate (1/s exponential). Phase-specific so the same lerp
   * code creates two distinct feels:
   *   - `flight`: low X-rate → ball outruns the camera (Aviator-style
   *     "bullet shooting away" illusion); moderate Y-rate so the parabola
   *     reads smoothly without trailing the apex.
   *   - `crashed`: medium → impact lingers without snapping.
   *   - everything else (idle / preShot / runToBall / landed / cashOut /
   *     lose): snappy default → camera is glued to the player.
   */
  const isFlight = phase === "flight";
  const isCrashed = phase === "crashed" || (phase === "lose" && followLose);
  const isJackpotLanded = phase === "landed" && isJackpot;
  const panRateX = isFlight
    ? CAMERA_PAN_RATE_FLIGHT_X
    : isCrashed
      ? CAMERA_PAN_RATE_CRASHED
      : isJackpotLanded
        ? CAMERA_PAN_RATE_CRASHED
        : CAMERA_PAN_RATE_DEFAULT;
  const panRateY = isFlight
    ? CAMERA_PAN_RATE_FLIGHT_Y
    : isCrashed
      ? CAMERA_PAN_RATE_CRASHED
      : isJackpotLanded
        ? CAMERA_PAN_RATE_CRASHED
        : CAMERA_PAN_RATE_DEFAULT;
  const panAlphaX = 1 - Math.exp(-panRateX * dtSec);
  const panAlphaY = 1 - Math.exp(-panRateY * dtSec);

  // First-frame: snap to target so we don't lerp from `(0, 0)` (Pixi's
  // initial container transform) for half a second. `displayScale < 0`
  // is the same sentinel bootstrap uses for the scale lerp.
  //
  // Lerp basis is the SCALE-COMPENSATED anchor, not the raw `prevWorldX/Y`:
  // when scale changes between frames the anchor exactly preserves the
  // focus point's previous canvas position, so a sudden zoom (e.g. the
  // 1.22× impact punch-in) produces zero lateral / vertical jerk on the
  // ball — only the actual difference between anchor and target gets
  // animated, which is what we want from the lerp.
  const isFirstFrame = displayScale < 0;
  const lerpedX = isFirstFrame
    ? targetWorldX
    : anchorWorldX + (targetWorldX - anchorWorldX) * panAlphaX;
  const lerpedY = isFirstFrame
    ? targetWorldY
    : anchorWorldY + (targetWorldY - anchorWorldY) * panAlphaY;

  // Re-clamp the LERPED value to current bounds. The anchor inherits clamps
  // from last frame's bounds, but `scale` (and therefore `minX`/`minY`) can
  // change frame-to-frame; an unclamped lerp could briefly leave the
  // valid range and expose black bars at the edges.
  world.x =
    worldW * scale <= canvasW
      ? targetWorldX // pillarbox case is already centered, no smoothing needed
      : Math.max(minX, Math.min(0, lerpedX));
  world.y = Math.max(minY, lerpedY);

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
