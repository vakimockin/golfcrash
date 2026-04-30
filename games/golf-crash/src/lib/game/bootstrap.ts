import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Text,
  type Texture,
  type Ticker,
} from "pixi.js";
import { assets } from "$app/paths";
import { game, type VisualTimeMode } from "../stores/game.svelte.js";
import {
  onCrashCause,
  onDecorativeEvent,
  onHoleLanding,
  onPreShotFail,
  onRoundPlanReady,
  prerollNextRound,
  teardownRound,
} from "./components/round/round.js";
import type {
  CrashCause,
  DecorativeEvent,
  PreShotFail,
  RoundPlan,
} from "./components/math/math.js";
import {
  getMapLayout,
  hillSurfaceY,
  rebuildLayouts,
  setSurfaceFn,
  type MapFeature,
  type MapLayout,
} from "./components/map/map.js";
import type {
  ObjectLayerId,
  ObjectLayers,
  TerrainLayers,
} from "./components/core/world-types.js";
import {
  createObjectLayers,
  altitudeBandForLayer as computeAltitudeBandForLayer,
} from "./components/layers/layer-math.js";
import {
  getMobileScale,
  type LayeredBackgroundRefs,
} from "./components/background/background-builder.js";
import type { AmbientMobSpawn } from "./components/ambient/ambient-builder.js";
import { buildCloudBackdrop } from "./components/background/cloud-backdrop.js";
import { updateCamera as updateCameraController } from "./components/camera/camera-controller.js";
import {
  BALL_APEX_Y,
  BALL_START_X,
  BALL_START_Y,
  CAMERA_LERP,
  CHAR_X,
  FLAG_X,
  FLIGHT_CAMERA_FOCUS_X,
  FLIGHT_CAMERA_FOCUS_Y,
  GROUND_Y,
  HOLE_X,
  IDLE_CAMERA_FOCUS_X,
  NEAR_HOLE_DISTANCE,
  PLANNED_HAZARD_WIDTH,
  PLAY_END_X,
  SCREENS_TO_SPACE,
  WORLD_H,
  WORLD_W,
} from "./components/constants/world-metrics.js";
import { GAME_ASSET_MANIFEST } from "./components/assets/asset-manifest.js";
import { CRASH_LAYER } from "./components/labels/crash-layers.js";
import {
  CRASH_CAUSE_LABEL,
  PRE_SHOT_FAIL_LABEL,
} from "./components/labels/crash-labels.js";
import {
  WORLD_THEMES,
  visualWorldFromMode,
  type VisualWorldTheme,
} from "./components/themes/visual-world-theme.js";
import { sampleFairwaySurfaceFromAssets } from "./components/terrain/fairway-surface-sampler.js";
import {
  directionalSpriteKind,
  effectiveAmbientPatrolVx,
  faceSpriteDirection,
  isSpriteAlias,
  PATROL_X_WOBBLE_MS,
  place,
  setSpriteVisualWidth,
} from "./components/sprites/sprite-placement.js";
import type { AmbientMotion, Effect, Flipbook } from "./components/sprites/ambient-decor-types.js";
import {
  hazardAliasFor,
  hazardVelocity,
  layerForKind,
  plannedHazardImpactPosition as impactPositionForPlan,
} from "./components/hazards/planned-hazard-rules.js";
import {
  buildLayeredBackground,
  buildObjectLayerSystem,
  buildProceduralFrontTerrain,
} from "./components/terrain/pixi-terrain-wrappers.js";

// Where the ball appears on screen (0..1, fraction of canvas).
const flagY = (): number => hillSurfaceY(FLAG_X) - 130;
const holeY = (): number => hillSurfaceY(HOLE_X) + 8;

export type BootstrapHooks = {
  onProgress?: (fraction: number) => void;
  onReady?: () => void;
};

export const bootstrapGame = (
  canvas: HTMLCanvasElement,
  hooks: BootstrapHooks = {},
): (() => void) => {
  const app = new Application();
  const world = new Container();
  const backgroundLayer = new Container();
  const worldLayer = new Container();
  const worldObjectLayer = new Container();
  const playerLayer = new Container();
  const foregroundLayer = new Container();
  const hazardLayer = new Container();
  const fxLayer = new Container();
  const ballFxLayer = new Graphics();
  let mapLayout = getMapLayout(visualWorldFromMode(game.visualTimeMode));
  let resizeObserver: ResizeObserver | null = null;
  let resizeDebounceId: number | null = null;
  let canvasW = 0;
  let canvasH = 0;
  const ambientMotions: AmbientMotion[] = [];
  const flipbooks: Flipbook[] = [];
  const effects: Effect[] = [];
  let terrainLayer: TerrainLayers | null = null;
  let backgroundRefs: LayeredBackgroundRefs | null = null;
  let activeVisualMode: VisualTimeMode | null = null;
  let ballSprite: Sprite | null = null;
  let fireBallSprite: Sprite | null = null;
  let characterSprite: Sprite | null = null;
  let multiplierLabel: Text | null = null;
  let messageLabel: Text | null = null;
  let crashFlash: Graphics | null = null;
  let goldFlash: Graphics | null = null;
  let flightStartedAt = 0;
  let lastPhase: typeof game.phase = "idle";
  let displayScale = -1;
  let crashedSettled = false;
  let nextFakeBoostSparkleAt = 0;
  let nextFakeBoostTeaseAt = 0;
  let crashFlashUntil = 0;
  let goldFlashUntil = 0;
  let landedStartedAt = 0;
  let landedFromX = BALL_START_X;
  let landedFromY = BALL_START_Y;
  let landedBallX = BALL_START_X;
  let landedBallY = BALL_START_Y;
  let runStartedAt = 0;
  let characterRunFromX = CHAR_X;
  let characterRunFromY = GROUND_Y - 140;
  let currentTeeX = mapLayout.start.ballX;
  let currentTeeY = mapLayout.start.ballY;
  let currentCharacterX = mapLayout.start.characterX;
  let currentCharacterY = mapLayout.start.characterY;
  let currentPlan: RoundPlan | null = null;
  let hazardsDrawnForFlight = false;
  let nearHoleCelebrated = false;

  type PlannedHazard = {
    kind: DecorativeEvent["kind"] | CrashCause;
    node: Sprite | Text;
    startX: number;
    startY: number;
    impactX: number;
    impactY: number;
    impactAtSec: number;
    vx: number;
    baseY: number;
    amplitude: number;
    phase: number;
    impactOffsetY: number;
    primary: boolean;
    highlightUntil: number;
  };
  const plannedHazards: PlannedHazard[] = [];
  let plannedCrashTarget: PlannedHazard | null = null;
  let messageUntil = 0;
  let messageText = "";

  const getReferenceScale = (): number => {
    if (displayScale > 0) return displayScale;
    const aspect = canvasW > 0 && canvasH > 0 ? canvasW / canvasH : 1;
    const visibleGroundHeight = aspect < 1 ? 1100 : 1500;
    return canvasH > 0 ? canvasH / visibleGroundHeight : 1;
  };

  const objectLayersForScale = (scale = getReferenceScale()): ObjectLayers => {
    return createObjectLayers(GROUND_Y, canvasH, scale, SCREENS_TO_SPACE);
  };

  const altitudeBandForLayer = (
    layerId: ObjectLayerId,
    scale = getReferenceScale(),
  ): { minY: number; maxY: number } => {
    return computeAltitudeBandForLayer(objectLayersForScale(scale), layerId);
  };

  type CollisionAnim = {
    cause: CrashCause;
    startedAt: number;
    impactAt: number;
    endsAt: number;
    hazard: Sprite | Text | null;
    hazardFromX: number;
    hazardFromY: number;
    hazardImpactX: number;
    hazardImpactY: number;
    hazardExitVx: number;
    hazardExitVy: number;
    ballImpactX: number;
    ballImpactY: number;
    ballKnockVx: number;
    ballKnockVy: number;
    impacted: boolean;
  };
  let collision: CollisionAnim | null = null;
  const COLLISION_END_MS = 2400;
  const KNOCK_GRAVITY = 1400;

  let unsubDecorative: (() => void) | null = null;
  let unsubCrash: (() => void) | null = null;
  let unsubLanding: (() => void) | null = null;
  let unsubPreShot: (() => void) | null = null;
  let unsubRoundPlan: (() => void) | null = null;

  const registerAmbientMotion = (
    node: Container,
    layerId: ObjectLayerId,
    index: number,
  ): void => {
    const band = altitudeBandForLayer(layerId, getReferenceScale());
    const directionalKind = directionalSpriteKind(node);
    const isCloud =
      node instanceof Sprite &&
      isSpriteAlias(node, [
        "cloud1",
        "cloud2",
        "cloud3",
        "cloud4",
        "cloud5",
        "cloud6",
        "cloud7",
        "cloud8",
        "cloud9",
        "cloud10",
      ]);
    const aiType: AmbientMotion["aiType"] = isCloud
      ? "cloud"
      : directionalKind === "plane"
        ? "plane"
        : "patrol";
    const isGroundCart = layerId === 0 || directionalKind === "cart";
    const direction = directionalKind
      ? node.x < WORLD_W / 2
        ? 1
        : -1
      : index % 2 === 0
        ? 1
        : -1;
    const speedByLayer =
      aiType === "cloud" ? 2 + (index % 4) : [18, 42, 54, 96, 38, 48][layerId]!;
    const finalVx =
      directionalKind === "plane"
        ? -Math.abs(speedByLayer)
        : direction * speedByLayer;
    if (node instanceof Sprite && directionalKind) {
      if (directionalKind === "plane") {
        node.scale.x = Math.abs(node.scale.y);
      } else {
        faceSpriteDirection(
          node,
          direction,
          1,
          directionalKind === "helicopter" ||
            directionalKind === "bird" ||
            directionalKind === "duck",
        );
      }
    }
    const groundedY = isGroundCart ? hillSurfaceY(node.x) : node.y;
    if (isGroundCart) node.y = groundedY;
    ambientMotions.push({
      node,
      layerId,
      kind: directionalKind,
      aiType,
      originX: node.x,
      baseX: node.x,
      baseY: isGroundCart
        ? groundedY
        : Math.min(Math.max(node.y, band.minY), band.maxY),
      vx: finalVx,
      // Vertical velocity kept at 0; positive vy used to accumulate downward drift each frame (Y grows down).
      vy: 0,
      phase: index * 0.9 + layerId * 0.7,
      amplitudeX: aiType === "cloud" ? 0 : isGroundCart ? 0 : 18 + layerId * 4,
      amplitudeY:
        aiType === "plane" || aiType === "cloud"
          ? 0
          : isGroundCart
            ? 2
            : 6 + layerId * 2,
      patrolRadius: aiType === "patrol" ? 1200 + (index % 4) * 420 : 0,
      wrapMinX: aiType === "plane" ? -1000 : -500,
      wrapMaxX: aiType === "plane" ? WORLD_W + 1000 : WORLD_W + 500,
      facing: directionalKind === "plane" ? -1 : direction,
      clampYMin: band.minY,
      clampYMax: band.maxY,
    });
  };

  const registerWingFlap = (
    sprite: Sprite,
    alias: string,
    index: number,
  ): void => {
    const frames =
      alias === "bird"
        ? [Assets.get("bird"), Assets.get("bird2")]
        : alias === "duck" || alias === "duck2"
          ? [Assets.get("duck"), Assets.get("duck2")]
          : null;
    if (!frames) return;
    flipbooks.push({
      sprite,
      frames,
      frameMs: alias === "bird" ? 120 : 150,
      phase: index * 57,
      visualWidth: alias === "bird" ? 150 : 155,
    });
  };

  const updateFlipbooks = (now: number): void => {
    for (let i = flipbooks.length - 1; i >= 0; i -= 1) {
      const flipbook = flipbooks[i]!;
      if (!flipbook.sprite.parent || !flipbook.sprite.scale) {
        flipbooks.splice(i, 1);
        continue;
      }
      const frameIndex =
        Math.floor((now + flipbook.phase) / flipbook.frameMs) %
        flipbook.frames.length;
      flipbook.sprite.texture = flipbook.frames[frameIndex]!;
      const facing = Math.sign(flipbook.sprite.scale.x) >= 0 ? 1 : -1;
      setSpriteVisualWidth(flipbook.sprite, flipbook.visualWidth, facing < 0);
    }
  };

  const setTeePosition = (x: number): void => {
    const nextX = Math.min(Math.max(mapLayout.start.ballX, x), PLAY_END_X);
    const nextY = hillSurfaceY(nextX);
    currentTeeX = nextX;
    currentTeeY = nextY;
    landedBallX = nextX;
    landedBallY = nextY;
    currentCharacterX = Math.max(mapLayout.start.characterX, nextX - 95);
    currentCharacterY = hillSurfaceY(currentCharacterX) - 72;

    if (ballSprite) {
      ballSprite.x = currentTeeX;
      ballSprite.y = currentTeeY;
    }
    if (fireBallSprite) {
      fireBallSprite.x = currentTeeX;
      fireBallSprite.y = currentTeeY;
    }
    if (characterSprite) {
      characterSprite.x = currentCharacterX;
      characterSprite.y = currentCharacterY;
    }
  };

  const renderMapFeature = (feature: MapFeature): void => {
    const scaleMul = getMobileScale(canvasW, canvasH);
    if (feature.type === "hole") {
      // Hole is drawn purely as the flag sprite. Anchor (0.5, 1) puts the
      // bottom of the flagpole exactly at the hole's terrain coordinate so
      // the pole appears planted in the ground at (feature.x, feature.y).
      const flag = new Sprite(Assets.get("holeFlag"));
      flag.anchor.set(0.5, 1);
      flag.scale.set(0.4 * scaleMul);
      flag.x = feature.x;
      flag.y = feature.y;
      flag.alpha = feature.alpha ?? 1;
      worldObjectLayer.addChild(flag);
      return;
    }

    // Water and sand hazards are NOT drawn here — they're rendered
    // procedurally inside the front terrain by analyzeTerrainForHazards
    // (see components/terrain/terrain-builder.ts), which masks them to the actual
    // surface curve so they sit embedded in the ground.
    if (feature.type === "water" || feature.type === "sand") return;
    if (!feature.asset) return;

    const sprite = new Sprite(Assets.get(feature.asset));
    if (feature.type === "cart") {
      // Keep cart wheels on route line despite oversized transparent SVG bounds.
      sprite.anchor.set(0.5, 0.36);
      sprite.x = feature.x;
      sprite.y = hillSurfaceY(feature.x);
      sprite.scale.set(feature.scale * scaleMul);
    } else {
      place(sprite, feature.x, feature.y, feature.scale * scaleMul, 0.5);
    }
    sprite.alpha = feature.alpha ?? 1;
    if (feature.flip) sprite.scale.x = -sprite.scale.x;
    worldObjectLayer.addChild(sprite);
  };

  const renderMapLayout = (layout: MapLayout): void => {
    for (const feature of layout.features) renderMapFeature(feature);
  };

  const isCurrentPlanZeroCrash = (): boolean =>
    currentPlan?.landingZone === "water" ||
    currentPlan?.crashCause === "timeout" ||
    currentPlan?.crashCause === "fakeBoost";

  const primaryImpactProgress = (): number => {
    if (!currentPlan || isCurrentPlanZeroCrash()) return 1;
    return 0.68;
  };

  const impactCauseForPlan = (plan: RoundPlan | null): CrashCause | null =>
    plan?.crashCause ?? (plan?.landingZone === "cart" ? "cart" : null);

  const updateCamera = (): void => {
    const updated = updateCameraController({
      world,
      terrainLayer,
      canvasW,
      canvasH,
      worldW: WORLD_W,
      worldH: WORLD_H,
      groundY: GROUND_Y,
      ballStartX: BALL_START_X,
      ballStartY: BALL_START_Y,
      flightFocusX: FLIGHT_CAMERA_FOCUS_X,
      flightFocusY: FLIGHT_CAMERA_FOCUS_Y,
      idleFocusX: IDLE_CAMERA_FOCUS_X,
      cameraLerp: CAMERA_LERP,
      multiplier: game.multiplier,
      phase: String(game.phase),
      isJackpot: game.isJackpot,
      currentTeeX,
      currentTeeY,
      characterSprite,
      fireBallSprite,
      displayScale,
    });
    displayScale = updated.displayScale;
  };

  const trajectoryPoint = (
    progress: number,
    outcome: RoundPlan["outcome"] = "crash",
  ): { x: number; y: number } => {
    const arcT = Math.min(1, Math.max(0, progress));
    const desiredZoneType =
      outcome === "holeInOne" ? "hole" : currentPlan?.landingZone;
    const zoneType = desiredZoneType === "cart" ? "fairway" : desiredZoneType;
    const nextLandingZone = (minX: number): { x: number; y: number } => {
      const searchMinX = Math.min(minX, PLAY_END_X - 240);
      const nextZone = mapLayout.landingZones
        .filter(
          (zone) =>
            zone.type === zoneType &&
            zone.x > searchMinX &&
            zone.x <= PLAY_END_X,
        )
        .sort((a, b) => a.x - b.x)[0];
      if (nextZone) return { x: nextZone.x, y: nextZone.y };
      const nearestZone = mapLayout.landingZones
        .filter(
          (zone) =>
            zone.type === zoneType &&
            zone.x > currentTeeX + 80 &&
            zone.x <= PLAY_END_X,
        )
        .sort(
          (a, b) => Math.abs(a.x - searchMinX) - Math.abs(b.x - searchMinX),
        )[0];
      if (nearestZone) return { x: nearestZone.x, y: nearestZone.y };
      const candidateX = searchMinX + 680;
      const x = Math.min(PLAY_END_X, candidateX);
      return { x, y: x >= PLAY_END_X - 24 ? holeY() : hillSurfaceY(x) };
    };
    const cause = impactCauseForPlan(currentPlan);
    const crashLayer = cause ? CRASH_LAYER[cause] : null;
    const plannedTarget =
      outcome === "crash" && cause && plannedCrashTarget?.kind === cause
        ? plannedCrashTarget
        : null;
    const initialLanding = nextLandingZone(currentTeeX + 220);
    const landingX = initialLanding.x;
    const landingY = initialLanding.y;
    const isSafeImpact =
      outcome === "crash" &&
      plannedTarget !== null &&
      currentPlan !== null &&
      !isCurrentPlanZeroCrash();
    const impactProgress = primaryImpactProgress();
    const lerpQuadratic = (
      t: number,
      from: { x: number; y: number },
      control: { x: number; y: number },
      to: { x: number; y: number },
    ): { x: number; y: number } => {
      const inv = 1 - t;
      return {
        x: inv * inv * from.x + 2 * inv * t * control.x + t * t * to.x,
        y: inv * inv * from.y + 2 * inv * t * control.y + t * t * to.y,
      };
    };

    if (isSafeImpact) {
      const impact = {
        x: plannedTarget.impactX,
        y: plannedTarget.impactY,
      };
      const safeLanding = nextLandingZone(
        impact.x + (cause === "cart" ? 360 : 180),
      );
      if (arcT <= impactProgress) {
        const localT = Math.min(1, arcT / impactProgress);
        const layers = objectLayersForScale();
        const dynamicFlightSpan = GROUND_Y - layers[5].centerY;
        const layerBoost =
          crashLayer !== null && crashLayer > 0
            ? dynamicFlightSpan * (0.12 + crashLayer * 0.025)
            : dynamicFlightSpan * 0.11;
        return lerpQuadratic(
          localT,
          { x: currentTeeX, y: currentTeeY },
          {
            x: (currentTeeX + impact.x) / 2,
            y: Math.min(currentTeeY, impact.y) - layerBoost,
          },
          impact,
        );
      }
      const localT = Math.min(
        1,
        (arcT - impactProgress) / Math.max(0.01, 1 - impactProgress),
      );
      return lerpQuadratic(
        localT,
        impact,
        {
          x: (impact.x + safeLanding.x) / 2,
          y:
            Math.min(impact.y, safeLanding.y) -
            (cause === "cart"
              ? (GROUND_Y - objectLayersForScale()[5].centerY) * 0.14
              : (GROUND_Y - objectLayersForScale()[5].centerY) * 0.08),
        },
        safeLanding,
      );
    }

    const layers = objectLayersForScale();
    const dynamicFlightSpan = GROUND_Y - layers[5].centerY;
    const targetX = Math.min(PLAY_END_X, plannedTarget?.impactX ?? landingX);
    const targetY =
      plannedTarget?.impactY ??
      (outcome === "crash" && crashLayer !== null && crashLayer > 0
        ? layers[crashLayer].centerY
        : landingY);
    const arcHeight =
      crashLayer === 5
        ? dynamicFlightSpan * 0.38
        : crashLayer === 3
          ? dynamicFlightSpan * 0.28
          : crashLayer === 2
            ? dynamicFlightSpan * 0.22
            : crashLayer === 1
              ? dynamicFlightSpan * 0.18
              : cause === "cart"
                ? dynamicFlightSpan * 0.14
                : Math.max(dynamicFlightSpan * 0.18, currentTeeY - BALL_APEX_Y);
    const control = {
      x: (currentTeeX + targetX) / 2,
      y: Math.min(currentTeeY, targetY) - arcHeight,
    };
    return lerpQuadratic(arcT, { x: currentTeeX, y: currentTeeY }, control, {
      x: targetX,
      y: targetY,
    });
  };

  const clearPlannedHazards = (): void => {
    for (let i = flipbooks.length - 1; i >= 0; i -= 1) {
      if (flipbooks[i]!.sprite.parent === hazardLayer) flipbooks.splice(i, 1);
    }
    hazardLayer
      .removeChildren()
      .forEach((node) => node.destroy({ children: true }));
    plannedHazards.length = 0;
    plannedCrashTarget = null;
  };

  const registerPlannedHazard = (
    kind: DecorativeEvent["kind"] | CrashCause,
    node: Sprite | Text,
    primary: boolean,
    impactOffsetY: number,
    impact: { x: number; y: number },
    impactAtSec: number,
  ): PlannedHazard => {
    const vx = hazardVelocity(kind, primary);
    const startX = impact.x - vx * impactAtSec;
    const startY =
      kind === "cart"
        ? hillSurfaceY(startX) - impactOffsetY
        : impact.y - impactOffsetY;
    node.x = startX;
    node.y = startY;
    const planned: PlannedHazard = {
      kind,
      node,
      startX,
      startY,
      impactX: impact.x,
      impactY: impact.y,
      impactAtSec,
      vx,
      baseY: startY,
      amplitude: kind === "cart" || primary ? 0 : 18,
      phase: Math.random() * Math.PI * 2,
      impactOffsetY,
      primary,
      highlightUntil: 0,
    };
    plannedHazards.push(planned);
    return planned;
  };

  const addPlannedHazard = (
    kind: DecorativeEvent["kind"] | CrashCause,
    impact: { x: number; y: number },
    impactAtSec: number,
    primary = false,
  ): PlannedHazard | null => {
    if (kind === "wind") {
      const label = new Text({
        text: "GUST",
        style: {
          fontFamily: "system-ui",
          fontSize: primary ? 72 : 48,
          fontWeight: "900",
          fill: 0xffffff,
          stroke: { color: 0x336699, width: 5 },
        },
      });
      label.anchor.set(0.5);
      label.x = impact.x;
      label.y = impact.y - 80;
      label.alpha = primary ? 0.95 : 0.55;
      hazardLayer.addChild(label);
      return registerPlannedHazard(
        kind,
        label,
        primary,
        80,
        impact,
        impactAtSec,
      );
    }

    const alias = hazardAliasFor(kind);
    if (!alias) return null;
    const sprite = new Sprite(Assets.get(alias));
    const impactOffsetY =
      kind === "cart" ? 2 : kind === "timeout" || kind === "fakeBoost" ? 0 : 36;
    place(sprite, impact.x, impact.y - impactOffsetY, 1, 0.5);
    const hazardWidth = kind === "cart" ? 420 : PLANNED_HAZARD_WIDTH;
    setSpriteVisualWidth(sprite, hazardWidth);
    sprite.alpha = primary ? 1 : kind === "cart" ? 0.92 : 0.62;
    hazardLayer.addChild(sprite);
    if (kind === "bird")
      registerWingFlap(sprite, "bird", plannedHazards.length);
    const planned = registerPlannedHazard(
      kind,
      sprite,
      primary,
      impactOffsetY,
      impact,
      impactAtSec,
    );
    faceSpriteDirection(sprite, planned.vx, 1);
    return planned;
  };

  const drawPlannedHazards = (plan: RoundPlan, force = false): void => {
    if (!force && (game.phase === "flight" || game.phase === "runToBall"))
      return;
    clearPlannedHazards();
    currentPlan = plan;
    hazardsDrawnForFlight = game.phase === "flight";
    plan.decorativeEvents.forEach((event) => {
      addPlannedHazard(
        event.kind,
        impactPositionForPlan(
          event.kind,
          event.atSec,
          currentTeeX,
          objectLayersForScale(),
          hillSurfaceY,
        ),
        event.atSec,
        false,
      );
    });
    const impactCause = impactCauseForPlan(plan);
    if (impactCause) {
      const impactAtSec = isCurrentPlanZeroCrash()
        ? plan.crashAtSec
        : plan.crashAtSec * primaryImpactProgress();
      plannedCrashTarget = addPlannedHazard(
        impactCause,
        impactPositionForPlan(
          impactCause,
          impactAtSec,
          currentTeeX,
          objectLayersForScale(),
          hillSurfaceY,
        ),
        impactAtSec,
        true,
      );
    }
  };

  const updatePlannedHazards = (now: number): void => {
    const flightElapsed =
      game.phase === "flight" || game.phase === "crashed"
        ? Math.max(0, (now - flightStartedAt) / 1000)
        : 0;
    for (const hazard of plannedHazards) {
      const patrol =
        game.phase === "flight" || game.phase === "crashed"
          ? 0
          : Math.sin(now / 900 + hazard.phase) * (hazard.primary ? 70 : 120);
      hazard.node.x = hazard.startX + hazard.vx * flightElapsed + patrol;

      if (hazard.kind === "cart") {
        hazard.node.y = hillSurfaceY(hazard.node.x) - hazard.impactOffsetY;
      } else {
        hazard.node.y =
          hazard.baseY + Math.sin(now / 620 + hazard.phase) * hazard.amplitude;
      }

      hazard.node.alpha =
        now < hazard.highlightUntil ? 1 : hazard.primary ? 0.95 : 0.62;
      if (hazard.node instanceof Sprite) {
        faceSpriteDirection(hazard.node, hazard.vx);
      }
    }
  };

  const updateAmbientDecor = (dt: number, now: number): void => {
    for (const motion of ambientMotions) {
      motion.baseX += motion.vx * dt;
      if (motion.aiType === "plane") {
        if (motion.baseX > motion.wrapMaxX) motion.baseX = motion.wrapMinX;
        if (motion.baseX < motion.wrapMinX) motion.baseX = motion.wrapMaxX;
        // Keep altitude stable; random baseY each frame caused jitter — baseY stays at spawn/register value.
      } else if (motion.aiType === "patrol") {
        const minX = Math.max(
          motion.wrapMinX,
          motion.originX - motion.patrolRadius,
        );
        const maxX = Math.min(
          motion.wrapMaxX,
          motion.originX + motion.patrolRadius,
        );
        if (motion.baseX > maxX) {
          motion.baseX = maxX;
          motion.vx = -Math.abs(motion.vx);
        }
        if (motion.baseX < minX) {
          motion.baseX = minX;
          motion.vx = Math.abs(motion.vx);
        }
      }

      if (motion.layerId === 0 || motion.kind === "cart") {
        motion.baseY = hillSurfaceY(motion.baseX);
      } else if (motion.aiType !== "cloud") {
        motion.baseY = Math.min(
          motion.clampYMax,
          Math.max(motion.clampYMin, motion.baseY),
        );
      }

      if (motion.layerId === 0 || motion.kind === "cart") {
        // Ground carts should follow the gameplay route line exactly.
        motion.node.x = motion.baseX;
        motion.node.y = hillSurfaceY(motion.node.x);
      } else {
        motion.node.x =
          motion.baseX +
          (motion.aiType === "patrol"
            ? Math.sin(now / PATROL_X_WOBBLE_MS + motion.phase) *
              motion.amplitudeX
            : 0);
        motion.node.y =
          motion.baseY +
          (motion.aiType === "patrol"
            ? Math.sin(
                now / (motion.kind === "helicopter" ? 720 : 980) + motion.phase,
              ) * motion.amplitudeY
            : 0);
        motion.node.y = Math.min(
          motion.clampYMax,
          Math.max(motion.clampYMin, motion.node.y),
        );
      }
      if (
        motion.node instanceof Sprite &&
        (motion.layerId === 0 || motion.kind === "cart")
      ) {
        faceSpriteDirection(motion.node, motion.vx);
      } else if (motion.node instanceof Sprite && motion.aiType !== "cloud") {
        const vxForFacing =
          motion.aiType === "patrol"
            ? effectiveAmbientPatrolVx(
                motion.vx,
                motion.amplitudeX,
                now,
                motion.phase,
              )
            : motion.vx;

        if (motion.kind === "plane") {
          const originalDirection = 1;
          motion.node.scale.x =
            Math.abs(motion.node.scale.y) * originalDirection;
        } else {
          const invertFacing =
            motion.kind === "helicopter" ||
            motion.kind === "bird" ||
            motion.kind === "duck";
          faceSpriteDirection(motion.node, vxForFacing, 1, invertFacing);
        }
      }
    }
  };

  const updateBall = (now: number): void => {
    if (!ballSprite || !fireBallSprite) return;
    const phase = game.phase;
    if (phase === "flight" && lastPhase !== "flight") {
      flightStartedAt = now;
      collision = null;
      nearHoleCelebrated = false;
      fireBallSprite.tint = 0xffffff;
      fireBallSprite.alpha = 1;
      nextFakeBoostSparkleAt = 0;
      nextFakeBoostTeaseAt = 0;
      if (currentPlan && !hazardsDrawnForFlight)
        drawPlannedHazards(currentPlan, true);
    }
    if (phase === "runToBall" && lastPhase !== "runToBall") {
      runStartedAt = now;
      const landingPoint = trajectoryPoint(
        1,
        game.isJackpot ? "holeInOne" : "crash",
      );
      setTeePosition(landingPoint.x);
      if (
        !nearHoleCelebrated &&
        Math.abs(landedBallX - HOLE_X) <= NEAR_HOLE_DISTANCE
      ) {
        nearHoleCelebrated = true;
        spawnNearHoleLanding(now);
      }
      if (currentPlan?.landingZone === "sand")
        triggerSandDust(landingPoint.x, landingPoint.y, now);
      if (characterSprite) {
        characterRunFromX = characterSprite.x;
        characterRunFromY = characterSprite.y;
      }
    }
    if (phase === "crashed" && lastPhase !== "crashed") {
      crashFlashUntil = now + 700;
      crashedSettled = false;
    }
    if (phase === "idle" && lastPhase !== "idle") {
      if (game.resetToStart) {
        setTeePosition(mapLayout.start.ballX);
        game.resetToStart = false;
      } else {
        setTeePosition(currentTeeX);
      }
      landedFromX = currentTeeX;
      landedFromY = currentTeeY;
      characterRunFromX = currentCharacterX;
      characterRunFromY = currentCharacterY;
      fireBallSprite.alpha = 1;
      fireBallSprite.tint = 0xffffff;
      fireBallSprite.visible = false;
      collision = null;
      crashedSettled = false;
    }
    if (phase === "landed" && lastPhase !== "landed") {
      goldFlashUntil = now + 900;
      landedStartedAt = now;
      landedFromX = fireBallSprite.x;
      landedFromY = fireBallSprite.y;
    }
    lastPhase = phase;

    if (phase === "flight") {
      ballSprite.visible = false;
      fireBallSprite.visible = true;
      if (collision && now >= collision.impactAt && isCurrentPlanZeroCrash()) {
        const dt = (now - collision.impactAt) / 1000;
        fireBallSprite.x = collision.ballImpactX + collision.ballKnockVx * dt;
        fireBallSprite.y =
          collision.ballImpactY +
          collision.ballKnockVy * dt +
          0.5 * KNOCK_GRAVITY * dt * dt;
        fireBallSprite.rotation += 0.3;
        return;
      }
      const elapsed = (now - flightStartedAt) / 1000;
      const duration = Math.min(7, Math.max(5, currentPlan?.crashAtSec ?? 5));
      // Multiplier-driven progress so ball accelerates with X. A small linear
      // baseline keeps it from looking frozen at low X.
      const linearT = Math.min(1, Math.max(0, elapsed / duration));
      const multSpan = Math.max(0.01, game.crashAt - 1);
      const multT = Math.min(1, Math.max(0, (game.multiplier - 1) / multSpan));
      const progress = Math.max(linearT * 0.18, multT);
      const wobble = Math.sin(elapsed * 5) * 8 * (1 - progress);
      const pos = trajectoryPoint(
        progress,
        game.isJackpot ? "holeInOne" : "crash",
      );
      fireBallSprite.x = pos.x + wobble;
      fireBallSprite.y = pos.y;
      const speedFactor = 1 + Math.log(Math.max(1, game.multiplier)) * 0.55;
      fireBallSprite.rotation += 0.14 * speedFactor;
      return;
    }

    if (phase === "runToBall") {
      ballSprite.visible = false;
      fireBallSprite.visible = true;
      fireBallSprite.x = landedBallX;
      fireBallSprite.y = landedBallY;
      fireBallSprite.rotation += 0.04;
      return;
    }

    if (phase === "landed") {
      if (!game.isJackpot) {
        ballSprite.visible = false;
        fireBallSprite.visible = true;
        fireBallSprite.x = landedBallX;
        fireBallSprite.y = landedBallY;
        fireBallSprite.alpha = 1;
        return;
      }
      // Ball lands into the hole area, then briefly sinks.
      ballSprite.visible = false;
      fireBallSprite.visible = true;
      const arrival = Math.min(1, (now - landedStartedAt) / 700);
      const sink = Math.max(0, (now - landedStartedAt - 700) / 250);
      fireBallSprite.x = landedFromX + (HOLE_X - landedFromX) * arrival;
      fireBallSprite.y =
        landedFromY +
        (holeY() - landedFromY) * arrival -
        Math.sin(arrival * Math.PI) * 68 +
        sink * 8;
      fireBallSprite.alpha = 1 - Math.min(0.45, sink * 0.45);
      fireBallSprite.rotation += 0.1;
      return;
    }

    if (phase === "crashed") {
      fireBallSprite.visible = true;
      ballSprite.visible = false;
      if (collision && collision.impacted) {
        const dt = (now - collision.impactAt) / 1000;
        const x = collision.ballImpactX + collision.ballKnockVx * dt;
        const rawY =
          collision.ballImpactY +
          collision.ballKnockVy * dt +
          0.5 * KNOCK_GRAVITY * dt * dt;
        const groundY = hillSurfaceY(x) - 8;
        if (rawY >= groundY) {
          fireBallSprite.x = x;
          fireBallSprite.y = groundY;
          if (!crashedSettled) {
            crashedSettled = true;
            triggerSandDust(x, groundY, now);
          }
          fireBallSprite.rotation += 0.05;
        } else {
          fireBallSprite.x = x;
          fireBallSprite.y = rawY;
          fireBallSprite.rotation += 0.18;
        }
      } else {
        const x = fireBallSprite.x;
        const groundY = hillSurfaceY(x) - 8;
        const fallStep = Math.min(14, (now - (crashFlashUntil - 700)) / 60);
        const nextY = fireBallSprite.y + fallStep;
        if (nextY >= groundY) {
          fireBallSprite.y = groundY;
          if (!crashedSettled) {
            crashedSettled = true;
            triggerSandDust(x, groundY, now);
          }
          fireBallSprite.rotation += 0.04;
        } else {
          fireBallSprite.y = nextY;
          fireBallSprite.rotation += 0.12;
        }
      }
      return;
    }

    if (collision) {
      // Round reset before collision finished — drop the lingering animation.
      if (collision.hazard?.parent) {
        collision.hazard.parent.removeChild(collision.hazard);
        collision.hazard.destroy();
      }
      collision = null;
    }

    fireBallSprite.visible = false;
    fireBallSprite.alpha = 1;
    ballSprite.visible = true;
    ballSprite.x = currentTeeX;
    ballSprite.y = currentTeeY;
  };

  const updateCharacter = (now: number): void => {
    if (!characterSprite) return;
    characterSprite.visible = true;
    characterSprite.alpha = 1;
    if (game.phase === "runToBall") {
      const t = Math.min(1, (now - runStartedAt) / 2000);
      const eased = 1 - Math.pow(1 - t, 3);
      const targetX = Math.max(mapLayout.start.characterX, landedBallX - 95);
      characterSprite.x =
        characterRunFromX + (targetX - characterRunFromX) * eased;
      characterSprite.y =
        hillSurfaceY(characterSprite.x) - 72 - Math.sin(t * Math.PI * 6) * 10;
      return;
    }
    if (
      game.phase === "idle" ||
      game.phase === "landed" ||
      game.phase === "flight" ||
      game.phase === "cashOut" ||
      game.phase === "crashed" ||
      game.phase === "lose"
    ) {
      characterSprite.x = currentCharacterX;
      characterSprite.y = currentCharacterY;
    }
  };

  const ballPos = (): { x: number; y: number } => {
    if (
      (game.phase === "flight" ||
        game.phase === "landed" ||
        game.phase === "crashed") &&
      fireBallSprite
    ) {
      return { x: fireBallSprite.x, y: fireBallSprite.y };
    }
    return { x: BALL_START_X, y: BALL_START_Y };
  };

  const canSpawnEventAtBall = (event: DecorativeEvent): boolean => {
    const pos = ballPos();
    const layerY = objectLayersForScale()[layerForKind(event.kind)].centerY;
    const tolerance = event.kind === "cart" ? 260 : 360;
    switch (event.kind) {
      case "bird":
      case "wind":
      case "helicopter":
      case "plane":
        return Math.abs(pos.y - layerY) <= tolerance;
      case "cart":
        return pos.y > GROUND_Y - 420;
      default:
        return true;
    }
  };

  const spawnEffect = (event: DecorativeEvent, now: number): void => {
    if (!canSpawnEventAtBall(event)) return;
    const planned =
      plannedHazards.find(
        (hazard) => hazard.kind === event.kind && !hazard.primary,
      ) ?? plannedHazards.find((hazard) => hazard.kind === event.kind);
    if (!planned) return;
    planned.highlightUntil = now + 700;
    const pos = {
      x: planned.node.x,
      y: planned.node.y + planned.impactOffsetY,
    };
    const ping = new Graphics();
    ping.circle(0, 0, 28).stroke({
      color: 0xffffff,
      width: 4,
      alpha: 0.55,
    });
    ping.x = pos.x;
    ping.y = pos.y;
    fxLayer.addChild(ping);
    effects.push({ node: ping, vx: 0, vy: -25, expiresAt: now + 650 });
  };

  const addImpactRing = (
    x: number,
    y: number,
    now: number,
    color = 0xfff0a0,
  ): void => {
    const impact = new Graphics();
    impact.circle(0, 0, 46).stroke({ color, width: 8, alpha: 0.95 });
    impact.circle(0, 0, 22).fill({ color: 0xff6040, alpha: 0.45 });
    impact.x = x;
    impact.y = y;
    fxLayer.addChild(impact);
    effects.push({ node: impact, vx: 0, vy: -40, expiresAt: now + 900 });
  };

  const triggerCartHit = (x: number, y: number, now: number): void => {
    addImpactRing(x, y, now, 0xffd36a);
    const label = new Text({
      text: "!",
      style: {
        fontFamily: "system-ui",
        fontSize: 96,
        fontWeight: "900",
        fill: 0xfff3a0,
        stroke: { color: 0x743500, width: 7 },
      },
    });
    label.anchor.set(0.5);
    label.x = x + 36;
    label.y = y - 130;
    fxLayer.addChild(label);
    effects.push({ node: label, vx: 0, vy: -70, expiresAt: now + 1000 });

    for (let i = 0; i < 4; i++) {
      const smoke = new Graphics();
      smoke.circle(0, 0, 18 + i * 5).fill({ color: 0x5f6670, alpha: 0.28 });
      smoke.x = x - 20 + i * 18;
      smoke.y = y - 28 - i * 6;
      fxLayer.addChild(smoke);
      effects.push({
        node: smoke,
        vx: -40 + i * 16,
        vy: -60 - i * 12,
        expiresAt: now + 1200,
      });
    }
  };

  const triggerWaterSplash = (x: number, y: number, now: number): void => {
    const splash = new Graphics();
    splash.ellipse(0, 0, 74, 18).fill({ color: 0x6ddcff, alpha: 0.65 });
    splash.ellipse(0, -8, 42, 11).fill({ color: 0xd8fbff, alpha: 0.55 });
    splash.x = x;
    splash.y = y + 14;
    fxLayer.addChild(splash);
    effects.push({ node: splash, vx: 0, vy: -20, expiresAt: now + 1100 });
  };

  const triggerSandDust = (x: number, y: number, now: number): void => {
    const dust = new Graphics();
    dust.ellipse(0, 0, 78, 20).fill({ color: 0xe8cf7a, alpha: 0.58 });
    dust.ellipse(-28, -10, 34, 12).fill({ color: 0xffe9a6, alpha: 0.45 });
    dust.ellipse(30, -8, 38, 13).fill({ color: 0xc89d48, alpha: 0.34 });
    dust.x = x;
    dust.y = y + 12;
    fxLayer.addChild(dust);
    effects.push({ node: dust, vx: 0, vy: -26, expiresAt: now + 1000 });
  };

  const spawnCrashCause = (cause: CrashCause, now: number): void => {
    const fallbackTarget = trajectoryPoint(1, currentPlan?.outcome ?? "crash");
    const ballX = plannedCrashTarget?.impactX ?? fallbackTarget.x;
    const ballY = plannedCrashTarget?.impactY ?? fallbackTarget.y;
    if (fireBallSprite) {
      fireBallSprite.x = ballX;
      fireBallSprite.y = ballY;
    }
    const sideMul = ballX > currentTeeX ? 1 : -1;
    const ballKnockVx =
      cause === "timeout" || cause === "fakeBoost"
        ? (Math.random() - 0.5) * 100
        : sideMul * (cause === "cart" ? 380 : 260);
    const ballKnockVy =
      cause === "cart"
        ? -200
        : cause === "timeout" || cause === "fakeBoost"
          ? 260
          : 320;

    collision = {
      cause,
      startedAt: now,
      impactAt: now,
      endsAt: now + COLLISION_END_MS,
      hazard: null,
      hazardFromX: ballX,
      hazardFromY: ballY,
      hazardImpactX: ballX,
      hazardImpactY: ballY,
      hazardExitVx: 0,
      hazardExitVy: 0,
      ballImpactX: ballX,
      ballImpactY: ballY,
      ballKnockVx,
      ballKnockVy,
      impacted: false,
    };

    messageText = CRASH_CAUSE_LABEL[cause];
    messageUntil = now + 1400;
  };

  const onCollisionImpact = (now: number): void => {
    if (!collision) return;
    const { cause, ballImpactX: x, ballImpactY: y } = collision;
    if (cause === "cart") {
      triggerCartHit(x, y, now);
      messageText = "CART BOUNCE!";
      messageUntil = now + 1400;
    } else if (cause === "wind") {
      addImpactRing(x, y, now, 0x9fd6ff);
    } else if (cause === "timeout") {
      // No ring — ball just falls quietly.
    } else if (cause === "fakeBoost") {
      // Massive flare-out, then dark smoke as the "bonus" fizzles.
      const flare = new Graphics();
      flare.circle(0, 0, 110).fill({ color: 0xff5a00, alpha: 0.55 });
      flare.circle(0, 0, 72).fill({ color: 0xffd060, alpha: 0.7 });
      flare.circle(0, 0, 36).fill({ color: 0xfff8c0, alpha: 0.85 });
      flare.x = x;
      flare.y = y;
      fxLayer.addChild(flare);
      effects.push({ node: flare, vx: 0, vy: -30, expiresAt: now + 700 });

      for (let i = 0; i < 8; i++) {
        const ember = new Graphics();
        ember.circle(0, 0, 4 + Math.random() * 4).fill({
          color: Math.random() < 0.5 ? 0xff7a00 : 0xffd060,
          alpha: 0.95,
        });
        ember.x = x;
        ember.y = y;
        fxLayer.addChild(ember);
        const ang = Math.random() * Math.PI * 2;
        const speed = 220 + Math.random() * 220;
        effects.push({
          node: ember,
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          expiresAt: now + 900,
        });
      }

      for (let i = 0; i < 6; i++) {
        const smoke = new Graphics();
        smoke.circle(0, 0, 22 + i * 4).fill({
          color: i % 2 === 0 ? 0x3a2a26 : 0x5a4a44,
          alpha: 0.45,
        });
        smoke.x = x + (Math.random() - 0.5) * 30;
        smoke.y = y - 10;
        fxLayer.addChild(smoke);
        effects.push({
          node: smoke,
          vx: (Math.random() - 0.5) * 50,
          vy: -90 - i * 18,
          expiresAt: now + 1700,
        });
      }

      // Char the ball — it stays dark through the crashed phase.
      if (fireBallSprite) {
        fireBallSprite.tint = 0x553a30;
        fireBallSprite.alpha = 0.85;
      }
    } else {
      addImpactRing(x, y, now, 0xfff0a0);
    }
    if (isCurrentPlanZeroCrash()) {
      if (currentPlan?.landingZone === "water")
        triggerWaterSplash(x, y + 40, now);
      else if (currentPlan?.landingZone === "sand")
        triggerSandDust(x, y + 40, now);
    }
    crashFlashUntil = Math.max(crashFlashUntil, now + 360);
  };

  const updateCollision = (now: number): void => {
    if (!collision) return;

    // Advance hazard sprite/label.
    if (collision.hazard) {
      if (now < collision.impactAt) {
        const t =
          (now - collision.startedAt) /
          Math.max(1, collision.impactAt - collision.startedAt);
        const eased = Math.min(1, Math.max(0, t));
        collision.hazard.x =
          collision.hazardFromX +
          (collision.hazardImpactX - collision.hazardFromX) * eased;
        collision.hazard.y =
          collision.hazardFromY +
          (collision.hazardImpactY - collision.hazardFromY) * eased;
      } else {
        const exitT = (now - collision.impactAt) / 1000;
        collision.hazard.x =
          collision.hazardImpactX + collision.hazardExitVx * exitT;
        collision.hazard.y =
          collision.hazardImpactY + collision.hazardExitVy * exitT;
        collision.hazard.alpha = Math.max(0, 1 - exitT * 1.4);
      }
    }

    if (!collision.impacted && now >= collision.impactAt) {
      collision.impacted = true;
      onCollisionImpact(now);
    }

    if (now >= collision.endsAt) {
      if (collision.hazard?.parent) {
        collision.hazard.parent.removeChild(collision.hazard);
        collision.hazard.destroy();
      }
      collision = null;
    }
  };

  const updateBallFx = (now: number): void => {
    ballFxLayer.clear();
    if (!fireBallSprite?.visible || game.phase !== "flight") return;
    const cause = currentPlan?.crashCause;
    ballFxLayer.x = fireBallSprite.x;
    ballFxLayer.y = fireBallSprite.y;

    if (cause === "fakeBoost") {
      const pulse = 0.5 + Math.sin(now / 70) * 0.5;
      // Outer halo — golden glow that imitates a bonus-round build-up.
      ballFxLayer
        .circle(0, 0, 56 + pulse * 8)
        .fill({ color: 0xffc000, alpha: 0.18 + pulse * 0.18 });
      ballFxLayer
        .circle(0, 0, 38 + pulse * 6)
        .fill({ color: 0xffe066, alpha: 0.28 + pulse * 0.2 });
      // Trailing flame: layered orange + yellow + white core.
      ballFxLayer
        .circle(-24, 6, 28 + pulse * 4)
        .fill({ color: 0xff5a00, alpha: 0.55 + pulse * 0.2 });
      ballFxLayer.circle(-12, 0, 20).fill({ color: 0xffaa20, alpha: 0.62 });
      ballFxLayer.circle(-6, -4, 12).fill({ color: 0xfff8c0, alpha: 0.7 });
      // Streamers behind the ball.
      for (let i = 0; i < 3; i++) {
        const off = i * 14;
        ballFxLayer
          .moveTo(-38 - off, 12 + i * 3)
          .lineTo(-92 - off, 30 + i * 6)
          .stroke({
            color: i === 0 ? 0xff7a00 : i === 1 ? 0xffd060 : 0xff3000,
            width: 7 - i,
            alpha: 0.6 - i * 0.12,
          });
      }

      // Periodic golden sparkles to sell the fake bonus.
      if (now >= nextFakeBoostSparkleAt) {
        nextFakeBoostSparkleAt = now + 90;
        for (let i = 0; i < 2; i++) {
          const sparkle = new Graphics();
          sparkle.circle(0, 0, 3 + Math.random() * 3).fill({
            color: Math.random() < 0.5 ? 0xffe070 : 0xfff8c0,
            alpha: 1,
          });
          sparkle.x = fireBallSprite.x + (Math.random() - 0.5) * 36;
          sparkle.y = fireBallSprite.y + (Math.random() - 0.5) * 22;
          fxLayer.addChild(sparkle);
          const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8;
          const speed = 80 + Math.random() * 120;
          effects.push({
            node: sparkle,
            vx: Math.cos(ang) * speed,
            vy: Math.sin(ang) * speed - 40,
            expiresAt: now + 600,
          });
        }
      }

      // Tease the bonus periodically — but never deliver.
      if (now >= nextFakeBoostTeaseAt) {
        nextFakeBoostTeaseAt = now + 1100;
        const tease = new Text({
          text: ["BONUS?!", "JACKPOT?", "HOT!"][Math.floor(Math.random() * 3)]!,
          style: {
            fontFamily: "system-ui",
            fontSize: 38,
            fontWeight: "900",
            fill: 0xffe070,
            stroke: { color: 0xb04000, width: 5 },
          },
        });
        tease.anchor.set(0.5);
        tease.x = fireBallSprite.x + (Math.random() - 0.5) * 40;
        tease.y = fireBallSprite.y - 64;
        fxLayer.addChild(tease);
        effects.push({
          node: tease,
          vx: 0,
          vy: -110,
          expiresAt: now + 700,
        });
      }
      return;
    }

    if (cause === "wind") {
      for (let i = 0; i < 3; i++) {
        const y = -18 + i * 18 + Math.sin(now / 180 + i) * 4;
        ballFxLayer
          .moveTo(-64, y)
          .lineTo(-22, y - 4)
          .stroke({ color: 0xdff7ff, width: 5, alpha: 0.55 });
      }
      return;
    }

    ballFxLayer
      .circle(0, 0, 18)
      .stroke({ color: 0xffffff, width: 3, alpha: 0.22 });
  };

  const spawnNearHoleLanding = (now: number): void => {
    messageText = "NEAR THE HOLE!";
    messageUntil = now + 1600;
    const ring = new Graphics();
    ring.circle(0, 0, 46).stroke({
      color: 0xffffff,
      width: 5,
      alpha: 0.75,
    });
    ring.circle(0, 0, 72).stroke({ color: 0x88ff88, width: 4, alpha: 0.4 });
    ring.x = HOLE_X;
    ring.y = holeY();
    fxLayer.addChild(ring);
    effects.push({ node: ring, vx: 0, vy: -10, expiresAt: now + 1200 });
  };

  const spawnHoleLanding = (now: number): void => {
    messageText = "HOLE IN ONE!";
    messageUntil = now + 2200;
    // sparkle ring
    const ring = new Graphics();
    ring.circle(0, 0, 60).stroke({ color: 0xffd700, width: 8, alpha: 0.9 });
    ring.x = FLAG_X;
    ring.y = flagY();
    fxLayer.addChild(ring);
    effects.push({ node: ring, vx: 0, vy: 0, expiresAt: now + 1400 });
  };

  const spawnPreShotFail = (kind: PreShotFail, now: number): void => {
    messageText = PRE_SHOT_FAIL_LABEL[kind];
    messageUntil = now + 1600;

    const ballX = ballSprite?.x ?? currentTeeX;
    const ballY = ballSprite?.y ?? currentTeeY;
    const charX = characterSprite?.x ?? currentCharacterX;
    const charY = characterSprite?.y ?? currentCharacterY;

    if (kind === "mole") {
      const hole = new Graphics();
      hole.ellipse(0, 0, 36, 12).fill({ color: 0x1a0e06, alpha: 0.95 });
      hole.ellipse(0, -3, 28, 8).fill({ color: 0x3a230f, alpha: 0.8 });
      hole.x = ballX;
      hole.y = ballY + 14;
      world.addChild(hole);
      effects.push({ node: hole, vx: 0, vy: 0, expiresAt: now + 1800 });

      const mole = new Graphics();
      mole.ellipse(0, 0, 22, 18).fill({ color: 0x6b4423, alpha: 1 });
      mole.ellipse(-8, -6, 4, 4).fill({ color: 0x000000, alpha: 1 });
      mole.ellipse(8, -6, 4, 4).fill({ color: 0x000000, alpha: 1 });
      mole.ellipse(0, 4, 6, 4).fill({ color: 0xffb0a0, alpha: 1 });
      mole.rect(-2, 6, 4, 8).fill({ color: 0xffffff, alpha: 1 });
      mole.x = ballX;
      mole.y = ballY + 4;
      world.addChild(mole);
      effects.push({
        node: mole,
        vx: -60,
        vy: -120,
        expiresAt: now + 1600,
      });

      for (let i = 0; i < 8; i++) {
        const dirt = new Graphics();
        const r = 4 + Math.random() * 4;
        dirt.circle(0, 0, r).fill({ color: 0x5a3818, alpha: 0.85 });
        dirt.x = ballX + (Math.random() - 0.5) * 20;
        dirt.y = ballY;
        fxLayer.addChild(dirt);
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI;
        const speed = 180 + Math.random() * 220;
        effects.push({
          node: dirt,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          expiresAt: now + 1100,
        });
      }
      return;
    }

    if (kind === "clubBreak") {
      for (let i = 0; i < 2; i++) {
        const half = new Graphics();
        const dir = i === 0 ? -1 : 1;
        half.rect(-3, -42, 6, 42).fill({ color: 0xb0b0b8, alpha: 1 });
        if (i === 0) {
          half.rect(-12, -52, 18, 14).fill({
            color: 0x303038,
            alpha: 1,
          });
        }
        half.x = charX + dir * 30;
        half.y = charY - 40;
        half.rotation = dir * 0.4;
        fxLayer.addChild(half);
        effects.push({
          node: half,
          vx: dir * 320,
          vy: -180 + Math.random() * 60,
          expiresAt: now + 1400,
        });
      }

      for (let i = 0; i < 4; i++) {
        const shard = new Graphics();
        shard.rect(0, 0, 4, 4).fill({ color: 0xe0e0e8, alpha: 0.9 });
        shard.x = charX;
        shard.y = charY - 60;
        fxLayer.addChild(shard);
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.2;
        const speed = 240 + Math.random() * 200;
        effects.push({
          node: shard,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          expiresAt: now + 1000,
        });
      }
      return;
    }

    if (kind === "selfHit") {
      const orbit = new Container();
      orbit.x = charX;
      orbit.y = charY - 110;
      fxLayer.addChild(orbit);

      for (let i = 0; i < 5; i++) {
        const star = new Graphics();
        const a = (i / 5) * Math.PI * 2;
        const points = 5;
        const outer = 10;
        const inner = 4;
        for (let p = 0; p < points * 2; p++) {
          const angle = (p / (points * 2)) * Math.PI * 2 - Math.PI / 2;
          const r = p % 2 === 0 ? outer : inner;
          const x = Math.cos(angle) * r;
          const y = Math.sin(angle) * r;
          if (p === 0) star.moveTo(x, y);
          else star.lineTo(x, y);
        }
        star.closePath();
        star.fill({ color: 0xffd700, alpha: 1 });
        star.x = Math.cos(a) * 36;
        star.y = Math.sin(a) * 14;
        orbit.addChild(star);
      }

      effects.push({
        node: orbit,
        vx: 0,
        vy: -40,
        expiresAt: now + 1500,
      });

      const bonk = new Text({
        text: "OUCH!",
        style: {
          fontFamily: "system-ui",
          fontSize: 56,
          fontWeight: "900",
          fill: 0xffe070,
          stroke: { color: 0x802000, width: 5 },
        },
      });
      bonk.anchor.set(0.5);
      bonk.x = charX + 50;
      bonk.y = charY - 130;
      fxLayer.addChild(bonk);
      effects.push({
        node: bonk,
        vx: 60,
        vy: -90,
        expiresAt: now + 1200,
      });
      return;
    }
  };

  const updateEffects = (dt: number, now: number): void => {
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i]!;
      e.node.x += e.vx * dt;
      e.node.y += e.vy * dt;
      const lifeMs = 4000;
      const age = 1 - Math.max(0, (e.expiresAt - now) / lifeMs);
      if (e.node instanceof Text) e.node.alpha = Math.max(0, 1 - age * 1.5);
      if (e.node instanceof Graphics)
        e.node.alpha = Math.max(0, (e.expiresAt - now) / 1400);
      if (now >= e.expiresAt) {
        e.node.parent?.removeChild(e.node);
        e.node.destroy();
        effects.splice(i, 1);
      }
    }
  };

  const updateOverlay = (now: number): void => {
    if (multiplierLabel) {
      const phase = game.phase;
      const showMult =
        phase === "flight" ||
        phase === "cashOut" ||
        phase === "crashed" ||
        phase === "landed";
      multiplierLabel.visible = showMult;
      if (showMult) {
        multiplierLabel.text = `x${game.multiplier.toFixed(2)}`;
        multiplierLabel.style.fill =
          phase === "crashed"
            ? 0xff5555
            : phase === "cashOut"
              ? 0xffd060
              : phase === "landed"
                ? 0xffd700
                : 0xffffff;
        const safePadX = canvasW < 600 ? Math.max(16, canvasW * 0.06) : 24;
        multiplierLabel.x = Math.max(
          safePadX,
          Math.min(canvasW - safePadX, canvasW / 2),
        );
        multiplierLabel.y =
          canvasW < 600
            ? Math.max(54, canvasH * 0.1)
            : Math.max(40, canvasH * 0.08);
        multiplierLabel.style.fontSize = Math.max(
          30,
          Math.min(canvasW * 0.22, Math.min(96, canvasH * 0.09)),
        );
      }
    }
    if (messageLabel) {
      const visible = now < messageUntil;
      messageLabel.visible = visible;
      if (visible) {
        messageLabel.text = messageText;
        const safePadX = canvasW < 600 ? Math.max(16, canvasW * 0.06) : 24;
        messageLabel.x = Math.max(
          safePadX,
          Math.min(canvasW - safePadX, canvasW / 2),
        );
        messageLabel.y = canvasH / 2;
        messageLabel.style.fontSize = Math.max(
          28,
          Math.min(72, canvasH * 0.07),
        );
        const remaining = (messageUntil - now) / 600;
        messageLabel.alpha = Math.min(1, remaining);
      }
    }
    if (crashFlash) {
      const visible = now < crashFlashUntil;
      crashFlash.visible = visible;
      if (visible) {
        const remaining = (crashFlashUntil - now) / 700;
        crashFlash.alpha = remaining * 0.45;
        crashFlash.clear();
        crashFlash.rect(0, 0, canvasW, canvasH).fill(0xff3030);
      }
    }
    if (goldFlash) {
      const visible = now < goldFlashUntil;
      goldFlash.visible = visible;
      if (visible) {
        const remaining = (goldFlashUntil - now) / 900;
        goldFlash.alpha = remaining * 0.5;
        goldFlash.clear();
        goldFlash.rect(0, 0, canvasW, canvasH).fill(0xffd700);
      }
    }
  };

  const animate = (ticker: Ticker): void => {
    const dt = ticker.deltaMS / 1000;
    const now = performance.now();
    updateAmbientDecor(dt, now);
    updateFlipbooks(now);
    updatePlannedHazards(now);
    updateCollision(now);
    updateBall(now);
    updateBallFx(now);
    refreshVisualMode();
    updateCharacter(now);
    updateEffects(dt, now);
    updateCamera();
    updateOverlay(now);
  };

  const fit = (): void => {
    const parent = canvas.parentElement;
    if (!parent) return;
    const nextW = parent.clientWidth;
    const nextH = parent.clientHeight;
    const sizeChanged = nextW !== canvasW || nextH !== canvasH;
    canvasW = nextW;
    canvasH = nextH;
    // Background sprites are sized in canvas units (not world units), so any
    // viewport change must rebuild them — otherwise the sky tiles would stay
    // at the previous canvas size and stretch/clip on the new one.
    if (sizeChanged) {
      rebuildBackgroundForCanvas();
      const scale = getReferenceScale();
      for (const motion of ambientMotions) {
        const band = altitudeBandForLayer(motion.layerId, scale);
        motion.clampYMin = band.minY;
        motion.clampYMax = band.maxY;
        motion.baseY = Math.min(
          motion.clampYMax,
          Math.max(motion.clampYMin, motion.baseY),
        );
      }
    }
    updateCamera();
  };

  const refreshVisualMode = (): void => {
    if (activeVisualMode === game.visualTimeMode) return;
    const worldId = visualWorldFromMode(game.visualTimeMode);
    const theme = WORLD_THEMES[worldId];
    backgroundRefs = buildLayeredBackground(
      backgroundLayer,
      game.visualTimeMode,
      theme,
      canvasW,
      canvasH,
      backgroundRefs,
    );
    if (terrainLayer) terrainLayer.frontTerrain.tint = theme.terrainTint;
    activeVisualMode = game.visualTimeMode;
  };

  const rebuildBackgroundForCanvas = (): void => {
    if (canvasW <= 0 || canvasH <= 0) return;
    const worldId = visualWorldFromMode(game.visualTimeMode);
    const theme = WORLD_THEMES[worldId];
    backgroundRefs = buildLayeredBackground(
      backgroundLayer,
      game.visualTimeMode,
      theme,
      canvasW,
      canvasH,
      backgroundRefs,
    );
  };

  const buildScene = (): void => {
    ambientMotions.length = 0;
    flipbooks.length = 0;
    const worldId = visualWorldFromMode(game.visualTimeMode);
    const theme = WORLD_THEMES[worldId];
    activeVisualMode = game.visualTimeMode;
    // Sky belongs to physical world and is rendered behind terrain.
    world.addChild(backgroundLayer);
    world.addChild(worldLayer);
    world.addChild(worldObjectLayer);
    world.addChild(playerLayer);
    world.addChild(foregroundLayer);
    world.addChild(fxLayer);

    backgroundRefs = buildLayeredBackground(
      backgroundLayer,
      game.visualTimeMode,
      theme,
      canvasW,
      canvasH,
      backgroundRefs,
    );
    terrainLayer = buildProceduralFrontTerrain(theme.terrainTint);
    worldLayer.addChild(buildCloudBackdrop(WORLD_W, GROUND_Y));
    worldLayer.addChild(terrainLayer.root);

    renderMapLayout(mapLayout);
    worldObjectLayer.addChild(hazardLayer);

    const ambientPack = buildObjectLayerSystem(
      getMobileScale(canvasW, canvasH),
      objectLayersForScale(getReferenceScale()),
    );
    worldObjectLayer.addChild(ambientPack.container);
    let ambientIdx = 0;
    for (const s of ambientPack.spawns) {
      registerAmbientMotion(s.node, s.layerId, ambientIdx);
      if (s.flipbookAlias)
        registerWingFlap(s.node, s.flipbookAlias, ambientIdx);
      ambientIdx += 1;
    }

    characterSprite = new Sprite(Assets.get("sheikh"));
    place(
      characterSprite,
      mapLayout.start.characterX,
      mapLayout.start.characterY,
      0.42,
      0.5,
    );
    playerLayer.addChild(characterSprite);

    ballSprite = new Sprite(Assets.get("ball"));
    place(ballSprite, mapLayout.start.ballX, mapLayout.start.ballY, 0.1, 0.5);
    playerLayer.addChild(ballSprite);

    fireBallSprite = new Sprite(Assets.get("ball"));
    place(
      fireBallSprite,
      mapLayout.start.ballX,
      mapLayout.start.ballY,
      0.1,
      0.5,
    );
    fireBallSprite.visible = false;
    playerLayer.addChild(fireBallSprite);
    playerLayer.addChild(ballFxLayer);

    // Ensure first frame spawns exactly on the sampled road curve.
    setTeePosition(mapLayout.start.ballX);
  };

  const buildOverlay = (): void => {
    crashFlash = new Graphics();
    crashFlash.visible = false;
    app.stage.addChild(crashFlash);

    goldFlash = new Graphics();
    goldFlash.visible = false;
    app.stage.addChild(goldFlash);

    multiplierLabel = new Text({
      text: "x1.00",
      style: {
        fontFamily: "system-ui",
        fontSize: 72,
        fontWeight: "900",
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 5 },
      },
    });
    multiplierLabel.anchor.set(0.5, 0);
    multiplierLabel.visible = false;
    app.stage.addChild(multiplierLabel);

    messageLabel = new Text({
      text: "",
      style: {
        fontFamily: "system-ui",
        fontSize: 48,
        fontWeight: "900",
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 6 },
        align: "center",
      },
    });
    messageLabel.anchor.set(0.5);
    messageLabel.visible = false;
    app.stage.addChild(messageLabel);
  };

  const init = async (): Promise<void> => {
    const parent = canvas.parentElement;
    if (!parent) return;

    await app.init({
      canvas,
      resizeTo: parent,
      backgroundColor: 0x0b1230,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });

    hooks.onProgress?.(0.05);
    await Assets.load(
      GAME_ASSET_MANIFEST.map((asset) => ({
        ...asset,
        src: `${assets}${asset.src}`,
      })),
      (p) => hooks.onProgress?.(0.05 + p * 0.8),
    );
    hooks.onProgress?.(0.88);

    // Sample the visible front layer once and rebuild map layouts on it.
    try {
      const surfaceFn = await sampleFairwaySurfaceFromAssets("");
      setSurfaceFn(surfaceFn);
      rebuildLayouts();
      mapLayout = getMapLayout(visualWorldFromMode(game.visualTimeMode));
    } catch (error) {
      console.warn("[surface] front-layer sampling failed", error);
    }
    hooks.onProgress?.(0.93);

    // Seed canvas dimensions before buildScene so the canvas-relative
    // background sizes correctly on the first frame.
    canvasW = parent.clientWidth;
    canvasH = parent.clientHeight;

    buildScene();
    app.stage.addChild(world);
    buildOverlay();

    fit();
    resizeObserver = new ResizeObserver(() => {
      if (resizeDebounceId !== null) window.clearTimeout(resizeDebounceId);
      resizeDebounceId = window.setTimeout(() => {
        resizeDebounceId = null;
        fit();
      }, 140);
    });
    resizeObserver.observe(parent);

    unsubDecorative = onDecorativeEvent((ev) =>
      spawnEffect(ev, performance.now()),
    );
    unsubCrash = onCrashCause((cause) =>
      spawnCrashCause(cause, performance.now()),
    );
    unsubLanding = onHoleLanding(() => spawnHoleLanding(performance.now()));
    unsubPreShot = onPreShotFail((kind) =>
      spawnPreShotFail(kind, performance.now()),
    );
    unsubRoundPlan = onRoundPlanReady(drawPlannedHazards);
    void prerollNextRound();

    app.ticker.add(animate);
    hooks.onProgress?.(1);
    hooks.onReady?.();
  };

  void init();

  return () => {
    teardownRound();
    if (unsubDecorative) unsubDecorative();
    if (unsubCrash) unsubCrash();
    if (unsubLanding) unsubLanding();
    if (unsubPreShot) unsubPreShot();
    if (unsubRoundPlan) unsubRoundPlan();
    if (resizeObserver) resizeObserver.disconnect();
    if (resizeDebounceId !== null) window.clearTimeout(resizeDebounceId);
    app.ticker.remove(animate);
    // Do not pass texture:true: sprites use Textures from Assets; destroying them here
    // triggers Pixi warnings — release via Assets.unload after the stage is torn down.
    app.destroy(true, { children: true, texture: false });
    void Assets.unload([
      ...new Set(GAME_ASSET_MANIFEST.map((entry) => entry.alias)),
    ]).catch(() => undefined);
  };
};
