import {
	Application,
	Assets,
	Container,
	Graphics,
	Sprite,
	Text,
	type Ticker,
} from "pixi.js";
import "@esotericsoftware/spine-pixi-v8";
import { Spine } from "@esotericsoftware/spine-pixi-v8";
import { assets } from "$app/paths";
import { game, type VisualTimeMode } from "../stores/game.svelte.js";
import {
	onCrashCause,
	onDecorativeEvent,
	onHoleLanding,
	onPreShotFail,
	onRoundPlanReady,
	onWaterSurfaceLoss,
	prerollNextRound,
	teardownRound,
} from "./components/round/round.js";
import type {
	CrashCause,
	DecorativeEvent,
	PreShotFail,
	RoundPlan,
} from "./components/math/math.js";
import { JACKPOT_MULT } from "./components/math/math.js";
import {
	getMapLayout,
	hillSurfaceY,
	rebuildLayouts,
	resolveWaterTouchdown,
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
	createStackedObjectLayers,
	altitudeBandForLayer as computeAltitudeBandForLayer,
} from "./components/layers/layer-math.js";
import {
	getMobileScale,
	type LayeredBackgroundRefs,
} from "./components/background/background-builder.js";
import { updateCamera as updateCameraController } from "./components/camera/camera-controller.js";
import {
	BALL_START_X,
	BALL_START_Y,
	CAMERA_SCALE_SMOOTH_RATE,
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
	WORLD_H,
	WORLD_W,
} from "./components/constants/world-metrics.js";
import {
	GAME_ASSET_MANIFEST,
	GAME_CORE_ASSET_MANIFEST,
	GAME_LAZY_ASSET_MANIFEST,
} from "./components/assets/asset-manifest.js";
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
import {
	attachSheikhSwingComplete,
	placeSheikhOnTee,
	setSheikhLocomotion,
	spawnPlannedHazardSpine,
} from "./components/sprites/spine-ambient.js";
import {
	GOLF_CART_ALPHA_PLANNED_PRIMARY,
	GOLF_CART_ALPHA_PLANNED_SECONDARY,
	GOLF_CART_IMPACT_OFFSET_Y_PX,
	spawnGolfCartSprite,
} from "./components/sprites/golf-cart-sprite.js";
import type {
	AmbientMotion,
	Effect,
} from "./components/sprites/ambient-decor-types.js";
import {
	hazardAliasFor,
	hazardVelocity,
	layerForKind,
	plannedHazardImpactPosition as impactPositionForPlan,
} from "./components/hazards/planned-hazard-rules.js";
import {
	arcHeightDampedBySpan,
	flightArcHeightFromMultiplier,
	flightReachFromMultiplier,
	getFlightDurationSec,
	PRIMARY_IMPACT_PROGRESS,
} from "./flight-physics.js";
import {
	buildLayeredBackground,
	buildObjectLayerSystem,
	buildProceduralFrontTerrain,
} from "./components/terrain/pixi-terrain-wrappers.js";
import { redrawMobSpawnSectorDebug, syncMobSectorDebugLabelLayer } from "./components/ambient/mob-sector-debug.js";
import { getAmbientSpawnXSpan } from "./components/ambient/ambient-spawn-span.js";
import {
	collectFlightTrajectoryCells,
	flightRevealCellKey,
	resolveFlightGridCell,
	spawnFlightRevealMob,
	type ResolvedFlightCell,
} from "./components/ambient/flight-cell-reveal.js";

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
	/** Dev only: `?fullWorld=1` — zoom out to fit WORLD_W×WORLD_H in the canvas. */
	const devFitWholeWorld =
		import.meta.env.DEV &&
		typeof window !== "undefined" &&
		new URL(window.location.href).searchParams.get("fullWorld") === "1";

	/**
	 * Dev only: red outlines for ambient X sectors + Y altitude bands.
	 * - `?mobSectors=1` | `true` | empty value, or
	 * - `?fullWorld=1` (fit whole map — lines need compensated width; see `mob-sector-debug`).
	 * Use `?mobSectors=0` to hide when using fullWorld.
	 */
	const devMobSectorDebug = ((): boolean => {
		if (!import.meta.env.DEV || typeof window === "undefined") return false;
		const qs = new URL(window.location.href).searchParams;
		const v = qs.get("mobSectors");
		if (v === "0" || v === "false") return false;
		const explicit =
			v === "1" ||
			v === "true" ||
			v === "" ||
			(v !== null && v !== "0" && v !== "false");
		return Boolean(explicit) || devFitWholeWorld;
	})();

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
	const effects: Effect[] = [];
	let terrainLayer: TerrainLayers | null = null;
	let backgroundRefs: LayeredBackgroundRefs | null = null;
	let stageBackdrop: Sprite | null = null;
	let activeVisualMode: VisualTimeMode | null = null;
	let ballSprite: Sprite | null = null;
	let fireBallSprite: Sprite | null = null;
	let characterSprite: Spine | null = null;
	let multiplierLabel: Text | null = null;
	let messageLabel: Text | null = null;
	let crashFlash: Graphics | null = null;
	let goldFlash: Graphics | null = null;
	let mobSectorDebugG: Graphics | null = null;
	let mobSectorDebugLabelRoot: Container | null = null;
	/** Mobs spawned when the ball first enters a sector × altitude cell during flight. */
	let flightRevealLayer: Container | null = null;
	const flightRevealedCells = new Set<string>();
	let flightRevealMobCount = 0;
	/** Hard cap — trajectory can visit many (sector × layer) cells; without this, flight looks crowded. */
	const FLIGHT_REVEAL_MAX_MOBS = 10;
	let flightRevealMotionSerial = 0;
	let lastPhase: typeof game.phase = "idle";
	let displayScale = -1;
	/** After `impactZoomCurrent`: <1 = camera pulls back in flight, >1 = push-in toward strike. */
	let flightZoomCurrent = 1;
	const FLIGHT_CAM_WIDE_MUL = 0.58;
	const FLIGHT_CAM_TIGHT_MUL = 1.2;
	const FLIGHT_CAM_APPROACH_START = 0.7;
	const IMPACT_ZOOM_PEAK = 1.22;
	/** Impact punch ~1/s; dt-correct in `animate`. */
	const IMPACT_ZOOM_SMOOTH_RATE = 16;
	const IMPACT_ZOOM_HOLD_MS = 600;
	let impactZoomTarget = 1;
	let impactZoomCurrent = 1;
	let impactZoomResetAt = 0;
	let crashedSettled = false;
	/** Smoothed camera aim in flight (world px). */
	let flightCamSmX = 0;
	let flightCamSmY = 0;
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
	/** Smooth roll after touchdown (runToBall). */
	let runBallFromX = BALL_START_X;
	let runBallFromY = BALL_START_Y;
	let runBallToX = BALL_START_X;
	let runBallToY = BALL_START_Y;
	const RUN_BALL_ROLL_MS = 520;
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
		node: Sprite | Text | Spine | Graphics;
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
		const visibleGroundHeight = aspect < 1 ? 1320 : 1800;
		return canvasH > 0 ? canvasH / visibleGroundHeight : 1;
	};

	const backdropAliasForMode = (
		mode: VisualTimeMode,
	): "basicMapDay" | "basicMapEvening" | "basicMapNight" =>
		mode === "evening"
			? "basicMapEvening"
			: mode === "night"
				? "basicMapNight"
				: "basicMapDay";

	const fitBackdropToCanvas = (sprite: Sprite): void => {
		if (canvasW <= 0 || canvasH <= 0) return;
		const texture = sprite.texture;
		const scale = Math.max(
			canvasW / Math.max(1, texture.width),
			canvasH / Math.max(1, texture.height),
		);
		sprite.anchor.set(0.5);
		sprite.scale.set(scale);
		sprite.x = canvasW / 2;
		sprite.y = canvasH / 2;
	};

	const syncBackdropToModeAndCanvas = (): void => {
		if (!stageBackdrop) return;
		stageBackdrop.texture = Assets.get(
			backdropAliasForMode(game.visualTimeMode),
		) as Sprite["texture"];
		fitBackdropToCanvas(stageBackdrop);
	};

	const objectLayersForScale = (
		_scale = getReferenceScale(),
	): ObjectLayers => {
		return createStackedObjectLayers(GROUND_Y);
	};

	const altitudeBandForLayer = (
		layerId: ObjectLayerId,
		scale = getReferenceScale(),
	): { minY: number; maxY: number } => {
		return computeAltitudeBandForLayer(
			objectLayersForScale(scale),
			layerId,
		);
	};

	type CollisionAnim = {
		cause: CrashCause;
		startedAt: number;
		impactAt: number;
		endsAt: number;
		hazard: Sprite | Text | Spine | null;
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
	/** Below fairway contact when `landingZone === "water"` (loss), px down. */
	const WATER_LOSS_SINK_PX = 52;

	let unsubDecorative: (() => void) | null = null;
	let unsubCrash: (() => void) | null = null;
	let unsubWaterSurfaceLoss: (() => void) | null = null;
	let unsubLanding: (() => void) | null = null;
	let unsubPreShot: (() => void) | null = null;
	let unsubRoundPlan: (() => void) | null = null;

	/** Tear-down raced ahead of async `init`; bail after awaits — never touch a destroyed renderer. */
	let bootCancelled = false;
	let tickerAttached = false;
	let shutdownComplete = false;

	let devWorldPanYPx = 0;
	let devFullWorldWheelHandler: ((ev: WheelEvent) => void) | null = null;

	/** Idempotent Pixi shutdown (handles HMR / unmount while `await` chains are pending). */
	const disposePixiAndTicker = (): void => {
		if (shutdownComplete) return;
		shutdownComplete = true;
		if (tickerAttached) {
			try {
				app.ticker.remove(animate);
			} catch {
				/* ticker already detached */
			}
			tickerAttached = false;
		}
		if (devFullWorldWheelHandler) {
			canvas.removeEventListener("wheel", devFullWorldWheelHandler);
			devFullWorldWheelHandler = null;
		}
		try {
			app.destroy(true, { children: true, texture: false });
		} catch {
			/* init never finished or already destroyed */
		}
		void Assets.unload([
			...new Set(GAME_ASSET_MANIFEST.map((entry) => entry.alias)),
		]).catch(() => undefined);
	};

	/** Extra lateral motion on sky props while ball is airborne (idle feels calmer). */
	const FLIGHT_AMBIENT_MOTION_BOOST = 4.5;

	const registerAmbientMotion = (
		node: Container,
		layerId: ObjectLayerId,
		index: number,
		fixedGround = false,
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
			aiType === "cloud"
				? 2 + (index % 4)
				: [18, 42, 54, 96, 38, 48][layerId]!;
		let finalVx =
			directionalKind === "plane"
				? -Math.abs(speedByLayer)
				: direction * speedByLayer;
		if (directionalKind === "cart" && fixedGround) finalVx = 0;
		if (node instanceof Sprite && directionalKind === "plane") {
			node.scale.x = Math.abs(node.scale.y);
		} else if (
			directionalKind &&
			directionalKind !== "plane" &&
			(node instanceof Sprite ||
				directionalKind === "bird" ||
				directionalKind === "duck")
		) {
			faceSpriteDirection(
				node,
				direction,
				1,
				directionalKind === "helicopter" ||
					directionalKind === "bird" ||
					directionalKind === "duck",
			);
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
			amplitudeX:
				aiType === "cloud" ? 0 : isGroundCart ? 0 : 18 + layerId * 4,
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

	const clearFlightRevealSpawns = (): void => {
		if (!flightRevealLayer) return;
		for (let i = ambientMotions.length - 1; i >= 0; i -= 1) {
			const m = ambientMotions[i]!;
			if (m.node.parent === flightRevealLayer) ambientMotions.splice(i, 1);
		}
		const removed = flightRevealLayer.removeChildren();
		for (const c of removed) c.destroy({ children: true });
		flightRevealedCells.clear();
		flightRevealMobCount = 0;
	};

	const spawnFlightRevealForCell = (
		cell: ResolvedFlightCell,
		layers: ObjectLayers,
	): void => {
		if (!flightRevealLayer) return;
		const key = flightRevealCellKey(cell.col, cell.layerId);
		if (flightRevealedCells.has(key)) return;
		flightRevealedCells.add(key);
		if (flightRevealMobCount >= FLIGHT_REVEAL_MAX_MOBS) return;
		flightRevealMobCount += 1;
		const mob = spawnFlightRevealMob(
			flightRevealLayer,
			cell.layerId,
			cell.sector,
			layers,
			getMobileScale(canvasW, canvasH),
		);
		registerAmbientMotion(
			mob.node,
			mob.layerId,
			2000 + flightRevealMotionSerial,
			false,
		);
		flightRevealMotionSerial += 1;
	};

	const revealFlightGridCell = (ballX: number, ballY: number): void => {
		const layers = objectLayersForScale(getReferenceScale());
		const cell = resolveFlightGridCell(ballX, ballY, WORLD_W, layers);
		if (!cell) return;
		spawnFlightRevealForCell(cell, layers);
	};

	const setTeePosition = (
		x: number,
		opts?: { moveFireBall?: boolean; moveCharacter?: boolean },
	): void => {
		const moveFireBall = opts?.moveFireBall ?? true;
		const moveCharacter = opts?.moveCharacter ?? true;
		const nextX = Math.min(Math.max(mapLayout.start.ballX, x), PLAY_END_X);
		const nextY = hillSurfaceY(nextX);
		currentTeeX = nextX;
		currentTeeY = nextY;
		landedBallX = nextX;
		landedBallY = nextY;
		if (moveCharacter) {
			currentCharacterX = Math.max(mapLayout.start.characterX, nextX - 95);
			currentCharacterY = hillSurfaceY(currentCharacterX) - 72;
		}

		if (ballSprite) {
			ballSprite.x = currentTeeX;
			ballSprite.y = currentTeeY;
		}
		if (fireBallSprite && moveFireBall) {
			fireBallSprite.x = currentTeeX;
			fireBallSprite.y = currentTeeY;
		}
		if (characterSprite && moveCharacter) {
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

		if (feature.type === "cart") {
			spawnGolfCartSprite({
				parent: worldObjectLayer,
				x: feature.x,
				surfaceY: hillSurfaceY(feature.x),
				widthScaleMul: scaleMul,
				flip: !!feature.flip,
				alpha: feature.alpha ?? 1,
			});
			return;
		}

		if (!feature.asset) return;

		const sprite = new Sprite(Assets.get(feature.asset));
		place(sprite, feature.x, feature.y, feature.scale * scaleMul, 0.5);
		sprite.alpha = feature.alpha ?? 1;
		if (feature.flip) sprite.scale.x = -sprite.scale.x;
		worldObjectLayer.addChild(sprite);
	};

	const renderMapLayout = (layout: MapLayout): void => {
		for (const feature of layout.features) renderMapFeature(feature);
	};

	const isCurrentPlanZeroCrash = (): boolean =>
		currentPlan?.landingZone === "water" ||
		currentPlan?.crashCause === "landed" ||
		currentPlan?.crashCause === "fakeBoost";

	const primaryImpactProgress = (): number => {
		if (!currentPlan || isCurrentPlanZeroCrash()) return 1;
		return PRIMARY_IMPACT_PROGRESS;
	};

	const impactCauseForPlan = (plan: RoundPlan | null): CrashCause | null =>
		plan?.crashCause ?? (plan?.landingZone === "cart" ? "cart" : null);

	const updateCamera = (dt: number, nowMs: number): void => {
		const dtCap = Math.min(0.05, Math.max(0, dt));
		const zoomAlpha = 1 - Math.exp(-(game.phase === "flight" ? 5 : 6.5) * dtCap);

		let flightZoomGoal = 1;
		if (game.phase === "flight") {
			const duration = getFlightDurationSec(currentPlan?.crashAtSec ?? 2);
			const t0 =
				game.flightStartedAtMs > 0 ? game.flightStartedAtMs : nowMs;
			const elapsed = Math.max(0, (nowMs - t0) / 1000);
			const p = Math.min(1, duration > 1e-6 ? elapsed / duration : 0);
			const k = Math.max(
				0,
				Math.min(
					1,
					(p - FLIGHT_CAM_APPROACH_START) /
						(1 - FLIGHT_CAM_APPROACH_START),
				),
			);
			const smooth = k * k * (3 - 2 * k);
			flightZoomGoal =
				FLIGHT_CAM_WIDE_MUL +
				(FLIGHT_CAM_TIGHT_MUL - FLIGHT_CAM_WIDE_MUL) * smooth;
		}
		flightZoomCurrent += (flightZoomGoal - flightZoomCurrent) * zoomAlpha;

		let flightLookAt: { x: number; y: number } | null = null;
		if (game.phase === "flight" && fireBallSprite) {
			const trackAlpha = 1 - Math.exp(-18 * dtCap);
			flightCamSmX += (fireBallSprite.x - flightCamSmX) * trackAlpha;
			flightCamSmY += (fireBallSprite.y - flightCamSmY) * trackAlpha;
			const flown = Math.max(0, fireBallSprite.x - currentTeeX);
			const lead = flown * 0.17 + Math.max(0, game.multiplier - 1) * 2.4;
			flightLookAt = {
				x: flightCamSmX + lead,
				y: flightCamSmY - flown * 0.02,
			};
		}

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
			cameraScaleSmoothRate: CAMERA_SCALE_SMOOTH_RATE,
			dt,
			flightLookAt,
			multiplier: game.multiplier,
			phase: String(game.phase),
			isJackpot: game.isJackpot,
			currentTeeX,
			currentTeeY,
			characterSprite,
			fireBallSprite,
			displayScale,
			impactZoomMul: impactZoomCurrent * flightZoomCurrent,
			devFitWholeWorld,
			devExtraWorldPanY: devFitWholeWorld ? devWorldPanYPx : 0,
		});
		displayScale = updated.displayScale;
	};

	const triggerImpactZoom = (now: number): void => {
		impactZoomTarget = IMPACT_ZOOM_PEAK;
		impactZoomResetAt = now + IMPACT_ZOOM_HOLD_MS;
	};

	const trajectoryPoint = (
		progress: number,
		outcome: RoundPlan["outcome"] = "crash",
	): { x: number; y: number } => {
		const plan = currentPlan;
		const mult =
			outcome === "holeInOne"
				? (plan?.crashMultiplier ?? JACKPOT_MULT)
				: (plan?.crashMultiplier ?? 1);
		const distance = flightReachFromMultiplier(mult);
		const arcHeightBase = flightArcHeightFromMultiplier(mult);

		const p = Math.min(1, Math.max(0, progress));
		// Strictly linear in wall-clock time: no ease-out, or |dy/dt| collapses near the end and feels stuck.
		const u = p;

		let targetX = Math.min(PLAY_END_X, currentTeeX + distance);
		let targetY = hillSurfaceY(targetX);

		if (outcome === "holeInOne") {
			targetX = Math.min(PLAY_END_X, HOLE_X);
			targetY = holeY();
		} else if (outcome === "crash" && plannedCrashTarget) {
			targetX = plannedCrashTarget.impactX;
			targetY = plannedCrashTarget.impactY;
		}

		const horizontalSpan = Math.abs(targetX - currentTeeX);
		const arcHeight = arcHeightDampedBySpan(arcHeightBase, horizontalSpan);

		const currentX = currentTeeX + (targetX - currentTeeX) * u;
		const baseLineY = currentTeeY + (targetY - currentTeeY) * u;
		const arcY = Math.sin(u * Math.PI) * arcHeight;

		return { x: currentX, y: baseLineY - arcY };
	};

	const prewarmFlightRevealAlongArc = (
		outcome: "holeInOne" | "crash",
	): void => {
		if (!flightRevealLayer) return;
		const layers = objectLayersForScale(getReferenceScale());
		const cells = collectFlightTrajectoryCells(
			(p) => trajectoryPoint(p, outcome),
			WORLD_W,
			layers,
			{ steps: 28, wobblePx: 5 },
		);
		const list = [...cells.values()];
		if (list.length === 0) return;
		const cap = FLIGHT_REVEAL_MAX_MOBS;
		if (list.length <= cap) {
			for (const cell of list) spawnFlightRevealForCell(cell, layers);
			return;
		}
		for (let n = 0; n < cap; n += 1) {
			const idx = Math.min(
				list.length - 1,
				Math.floor((n / Math.max(1, cap - 1)) * (list.length - 1)),
			);
			spawnFlightRevealForCell(list[idx]!, layers);
		}
	};

	const clearPlannedHazards = (): void => {
		hazardLayer
			.removeChildren()
			.forEach((node) => node.destroy({ children: true }));
		plannedHazards.length = 0;
		plannedCrashTarget = null;
	};

	const registerPlannedHazard = (
		kind: DecorativeEvent["kind"] | CrashCause,
		node: Sprite | Text | Spine | Graphics,
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

	/** Invisible anchor so `plannedCrashTarget` exists when `landingZone === "water"` but `crashCause` has no hazard sprite (e.g. `"landed"`). */
	const registerImplicitWaterCrashTarget = (
		impact: { x: number; y: number },
		impactAtSec: number,
	): PlannedHazard => {
		const marker = new Graphics();
		marker.alpha = 0;
		marker.rect(-1, -1, 2, 2).fill({ color: 0x000000, alpha: 1 });
		hazardLayer.addChild(marker);
		return registerPlannedHazard("landed", marker, true, 0, impact, impactAtSec);
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
			label.alpha = 1;
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
		const impactOffsetY =
			kind === "cart"
				? GOLF_CART_IMPACT_OFFSET_Y_PX
				: kind === "fakeBoost"
					? 0
					: 36;

		if (kind === "cart") {
			const sprite = spawnGolfCartSprite({
				parent: hazardLayer,
				x: impact.x,
				surfaceY: hillSurfaceY(impact.x),
				widthScaleMul: 1,
				flip: false,
				alpha: primary
					? GOLF_CART_ALPHA_PLANNED_PRIMARY
					: GOLF_CART_ALPHA_PLANNED_SECONDARY,
				impactOffsetY,
			});
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
		}

		if (kind === "bird" || kind === "fakeBoost") {
			const vxPreview = hazardVelocity(kind, primary);
			const spine = spawnPlannedHazardSpine(hazardLayer, {
				kind: kind === "bird" ? "bird" : "fakeBoost",
				goldenBird:
					kind === "bird" &&
					visualWorldFromMode(game.visualTimeMode) === "golden",
				x: impact.x,
				y: impact.y - impactOffsetY,
				alpha: 1,
				flip: vxPreview < 0,
				targetWidth: PLANNED_HAZARD_WIDTH,
			});
			const planned = registerPlannedHazard(
				kind,
				spine,
				primary,
				impactOffsetY,
				impact,
				impactAtSec,
			);
			faceSpriteDirection(spine, planned.vx, 1);
			return planned;
		}

		const sprite = new Sprite(Assets.get(alias));
		place(sprite, impact.x, impact.y - impactOffsetY, 1, 0.5);
		setSpriteVisualWidth(sprite, PLANNED_HAZARD_WIDTH);
		sprite.alpha = 1;
		hazardLayer.addChild(sprite);
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
		const planDur = plan.crashAtSec > 0 ? plan.crashAtSec : 5;
		const visualDur = getFlightDurationSec(planDur);
		const timeScale =
			plan.crashAtSec > 0 ? visualDur / plan.crashAtSec : visualDur / 5;
		const hazardTrack = {
			crashMultiplier: Math.max(1, plan.crashMultiplier),
			crashAtSec: planDur,
		};
		plan.decorativeEvents
			.filter((event) => event.kind !== "cart")
			.forEach((event) => {
				const t = event.atSec * timeScale;
				addPlannedHazard(
					event.kind,
					impactPositionForPlan(
						event.kind,
						t,
						currentTeeX,
						objectLayersForScale(),
						hillSurfaceY,
						hazardTrack,
					),
					t,
					false,
				);
			});
		const impactCause = impactCauseForPlan(plan);
		if (impactCause) {
			const impactAtSec =
				(isCurrentPlanZeroCrash()
					? plan.crashAtSec
					: plan.crashAtSec * primaryImpactProgress()) * timeScale;
			plannedCrashTarget = addPlannedHazard(
				impactCause,
				impactPositionForPlan(
					impactCause,
					impactAtSec,
					currentTeeX,
					objectLayersForScale(),
					hillSurfaceY,
					hazardTrack,
				),
				impactAtSec,
				true,
			);
		}
		if (!plannedCrashTarget && plan.landingZone === "water") {
			const impactAtSec =
				(isCurrentPlanZeroCrash()
					? plan.crashAtSec
					: plan.crashAtSec * primaryImpactProgress()) * timeScale;
			const posKind: CrashCause = plan.crashCause ?? "landed";
			const baseImp = impactPositionForPlan(
				posKind,
				impactAtSec,
				currentTeeX,
				objectLayersForScale(),
				hillSurfaceY,
				hazardTrack,
			);
			const waterImp = resolveWaterTouchdown(mapLayout, baseImp.x);
			if (waterImp) {
				plannedCrashTarget = registerImplicitWaterCrashTarget(
					waterImp,
					impactAtSec,
				);
			}
		}
	};

	const updatePlannedHazards = (now: number): void => {
		const flightStart =
			game.flightStartedAtMs > 0 ? game.flightStartedAtMs : now;
		const flightElapsed =
			game.phase === "flight" || game.phase === "crashed"
				? Math.max(0, (now - flightStart) / 1000)
				: 0;
		for (const hazard of plannedHazards) {
			const patrol =
				hazard.kind === "cart"
					? 0
					: game.phase === "flight" || game.phase === "crashed"
						? 0
						: Math.sin(now / 900 + hazard.phase) *
							(hazard.primary ? 70 : 120);
			hazard.node.x = hazard.startX + hazard.vx * flightElapsed + patrol;

			if (hazard.kind === "cart") {
				hazard.node.y =
					hillSurfaceY(hazard.node.x) - hazard.impactOffsetY;
			} else {
				hazard.node.y =
					hazard.baseY +
					Math.sin(now / 620 + hazard.phase) * hazard.amplitude;
			}

			hazard.node.alpha = 1;
			if (hazard.node instanceof Sprite || hazard.node instanceof Spine) {
				faceSpriteDirection(hazard.node, hazard.vx);
			}
		}
	};

	const updateAmbientDecor = (dt: number, now: number): void => {
		const ambientMotionBoost =
			game.phase === "flight" || game.phase === "crashed"
				? FLIGHT_AMBIENT_MOTION_BOOST
				: 1;
		for (const motion of ambientMotions) {
			motion.baseX += motion.vx * ambientMotionBoost * dt;
			if (motion.aiType === "plane") {
				if (motion.baseX > motion.wrapMaxX)
					motion.baseX = motion.wrapMinX;
				if (motion.baseX < motion.wrapMinX)
					motion.baseX = motion.wrapMaxX;
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
								now /
									(motion.kind === "helicopter" ? 720 : 980) +
									motion.phase,
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
			} else if (motion.aiType !== "cloud") {
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
				} else if (
					motion.node instanceof Sprite ||
					motion.kind === "bird" ||
					motion.kind === "duck"
				) {
					const invertFacing =
						motion.kind === "helicopter" ||
						motion.kind === "bird" ||
						motion.kind === "duck";
					faceSpriteDirection(
						motion.node,
						vxForFacing,
						1,
						invertFacing,
					);
				}
			}
		}
	};

	const updateBall = (now: number): void => {
		if (!ballSprite || !fireBallSprite) return;
		const phase = game.phase;
		if (phase === "preShot" && lastPhase !== "preShot") {
			characterSprite?.state.setAnimation(0, "swing", false);
		}
		if (phase === "flight" && lastPhase !== "flight") {
			impactZoomTarget = 1;
			impactZoomCurrent = 1;
			flightZoomCurrent = FLIGHT_CAM_WIDE_MUL;
			flightCamSmX = currentTeeX;
			flightCamSmY = currentTeeY;
			impactZoomResetAt = 0;
			collision = null;
			nearHoleCelebrated = false;
			fireBallSprite.tint = 0xffffff;
			fireBallSprite.alpha = 1;
			fireBallSprite.x = currentTeeX;
			fireBallSprite.y = currentTeeY;
			fireBallSprite.rotation = 0;
			nextFakeBoostSparkleAt = 0;
			nextFakeBoostTeaseAt = 0;
			if (currentPlan && !hazardsDrawnForFlight)
				drawPlannedHazards(currentPlan, true);
			clearFlightRevealSpawns();
			prewarmFlightRevealAlongArc(
				game.isJackpot ? "holeInOne" : "crash",
			);
		}
		if (phase === "runToBall" && lastPhase !== "runToBall") {
			runStartedAt = now;
			const landingPoint = trajectoryPoint(
				1,
				game.isJackpot ? "holeInOne" : "crash",
			);
			runBallFromX = fireBallSprite?.x ?? landingPoint.x;
			runBallFromY = fireBallSprite?.y ?? landingPoint.y;
			if (characterSprite) {
				characterRunFromX = characterSprite.x;
				characterRunFromY = characterSprite.y;
			}
			setTeePosition(landingPoint.x, {
				moveFireBall: false,
				moveCharacter: false,
			});
			runBallToX = landedBallX;
			runBallToY = landedBallY;
			if (
				!nearHoleCelebrated &&
				Math.abs(landedBallX - HOLE_X) <= NEAR_HOLE_DISTANCE
			) {
				nearHoleCelebrated = true;
				spawnNearHoleLanding(now);
			}
			if (currentPlan?.landingZone === "sand")
				triggerSandDust(landingPoint.x, landingPoint.y, now);
			if (characterSprite) setSheikhLocomotion(characterSprite, "run", true);
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
			impactZoomTarget = 1;
			impactZoomCurrent = 1;
			flightZoomCurrent = 1;
			impactZoomResetAt = 0;
			characterSprite?.state.setAnimation(0, "idle", true);
		}
		if (phase === "landed" && lastPhase !== "landed") {
			goldFlashUntil = now + 900;
			landedStartedAt = now;
			landedFromX = fireBallSprite.x;
			landedFromY = fireBallSprite.y;
			if (!game.isJackpot && lastPhase === "runToBall" && characterSprite) {
				currentCharacterX = characterSprite.x;
				currentCharacterY = characterSprite.y;
				setSheikhLocomotion(characterSprite, "idle", true);
			}
		}
		lastPhase = phase;

		if (phase === "flight") {
			ballSprite.visible = false;
			fireBallSprite.visible = true;
			if (
				collision &&
				now >= collision.impactAt &&
				isCurrentPlanZeroCrash()
			) {
				const dt = (now - collision.impactAt) / 1000;
				fireBallSprite.x =
					collision.ballImpactX + collision.ballKnockVx * dt;
				fireBallSprite.y =
					collision.ballImpactY +
					collision.ballKnockVy * dt +
					0.5 * KNOCK_GRAVITY * dt * dt;
				fireBallSprite.rotation += 0.3;
			} else {
				const duration = getFlightDurationSec(
					currentPlan?.crashAtSec ?? 2,
				);
				const flightT0 =
					game.flightStartedAtMs > 0 ? game.flightStartedAtMs : now;
				const elapsed = Math.max(0, (now - flightT0) / 1000);
				const progress = Math.min(1, Math.max(0, elapsed / duration));
				const pos = trajectoryPoint(
					progress,
					game.isJackpot ? "holeInOne" : "crash",
				);
				fireBallSprite.x = pos.x;
				fireBallSprite.y = pos.y;
				const speedFactor =
					1 + Math.log(Math.max(1, game.multiplier)) * 0.55;
				const spinEase = 0.45 + 0.55 * progress ** 1.15;
				fireBallSprite.rotation += 0.2 * speedFactor * spinEase;
			}
			revealFlightGridCell(fireBallSprite.x, fireBallSprite.y);
			return;
		}

		if (phase === "runToBall") {
			ballSprite.visible = false;
			fireBallSprite.visible = true;
			const t = Math.min(1, (now - runStartedAt) / RUN_BALL_ROLL_MS);
			const e = t * t * (3 - 2 * t);
			const bounce = Math.sin(t * Math.PI) * 16;
			fireBallSprite.x = runBallFromX + (runBallToX - runBallFromX) * e;
			fireBallSprite.y =
				runBallFromY + (runBallToY - runBallFromY) * e - bounce;
			fireBallSprite.rotation += 0.05 + t * 0.1;
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
			const waterLoss = currentPlan?.landingZone === "water";
			const fairwayContactY = (worldX: number) => hillSurfaceY(worldX) - 8;
			const settleTargetY = (worldX: number) => {
				if (!waterLoss) return fairwayContactY(worldX);
				if (plannedCrashTarget)
					return plannedCrashTarget.impactY + WATER_LOSS_SINK_PX;
				const pond = resolveWaterTouchdown(mapLayout, worldX);
				if (pond) return pond.y + WATER_LOSS_SINK_PX;
				return fairwayContactY(worldX) + WATER_LOSS_SINK_PX;
			};
			if (collision && collision.impacted) {
				const dt = (now - collision.impactAt) / 1000;
				const x = collision.ballImpactX + collision.ballKnockVx * dt;
				const rawY =
					collision.ballImpactY +
					collision.ballKnockVy * dt +
					0.5 * KNOCK_GRAVITY * dt * dt;
				const groundY = settleTargetY(x);
				if (rawY >= groundY) {
					fireBallSprite.x = x;
					fireBallSprite.y = groundY;
					if (!crashedSettled) {
						crashedSettled = true;
						if (!waterLoss) triggerSandDust(x, groundY, now);
					}
					fireBallSprite.rotation += 0.05;
				} else {
					fireBallSprite.x = x;
					fireBallSprite.y = rawY;
					fireBallSprite.rotation += 0.18;
				}
			} else {
				const x = fireBallSprite.x;
				const groundY = settleTargetY(x);
				const fallStep = Math.min(
					14,
					(now - (crashFlashUntil - 700)) / 60,
				);
				const nextY = fireBallSprite.y + fallStep;
				if (nextY >= groundY) {
					fireBallSprite.y = groundY;
					if (!crashedSettled) {
						crashedSettled = true;
						if (!waterLoss) triggerSandDust(x, groundY, now);
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
			const targetX = Math.max(
				mapLayout.start.characterX,
				landedBallX - 95,
			);
			characterSprite.x =
				characterRunFromX + (targetX - characterRunFromX) * eased;
			characterSprite.y =
				hillSurfaceY(characterSprite.x) -
				72 -
				Math.sin(t * Math.PI * 6) * 10;
			const toTarget = targetX - characterSprite.x;
			faceSpriteDirection(characterSprite, toTarget, 0.55);
			return;
		}
		if (
			game.phase === "idle" ||
			game.phase === "landed" ||
			game.phase === "preShot" ||
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
		if (
			event.kind === "bird" ||
			event.kind === "helicopter" ||
			event.kind === "plane" ||
			event.kind === "wind" ||
			event.kind === "cart"
		) {
			triggerImpactZoom(now);
		}
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
			smoke
				.circle(0, 0, 18 + i * 5)
				.fill({ color: 0x5f6670, alpha: 0.28 });
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
		const fallbackTarget = trajectoryPoint(
			1,
			currentPlan?.outcome ?? "crash",
		);
		const ballX = plannedCrashTarget?.impactX ?? fallbackTarget.x;
		const ballY = plannedCrashTarget?.impactY ?? fallbackTarget.y;
		const sideMul = ballX > currentTeeX ? 1 : -1;
		const ballKnockVx =
			cause === "landed" || cause === "fakeBoost"
				? (Math.random() - 0.5) * 100
				: sideMul * (cause === "cart" ? 380 : 260);
		const ballKnockVy =
			cause === "cart"
				? -200
				: cause === "landed" || cause === "fakeBoost"
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

		if (cause !== "landed") {
			messageText = CRASH_CAUSE_LABEL[cause];
			messageUntil = now + 1400;
		}
	};

	const onCollisionImpact = (now: number): void => {
		if (!collision) return;
		const { cause, ballImpactX: x, ballImpactY: y } = collision;
		if (cause !== "landed" && cause !== "fakeBoost") {
			triggerImpactZoom(now);
		}
		if (cause === "cart") {
			triggerCartHit(x, y, now);
			messageText = "CART BOUNCE!";
			messageUntil = now + 1400;
		} else if (cause === "wind") {
			addImpactRing(x, y, now, 0x9fd6ff);
		} else if (cause === "landed") {
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
			ballFxLayer
				.circle(-12, 0, 20)
				.fill({ color: 0xffaa20, alpha: 0.62 });
			ballFxLayer
				.circle(-6, -4, 12)
				.fill({ color: 0xfff8c0, alpha: 0.7 });
			// Streamers behind the ball.
			for (let i = 0; i < 3; i++) {
				const off = i * 14;
				ballFxLayer
					.moveTo(-38 - off, 12 + i * 3)
					.lineTo(-92 - off, 30 + i * 6)
					.stroke({
						color:
							i === 0 ? 0xff7a00 : i === 1 ? 0xffd060 : 0xff3000,
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
					const ang =
						-Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8;
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
					text: ["BONUS?!", "JACKPOT?", "HOT!"][
						Math.floor(Math.random() * 3)
					]!,
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
				const angle =
					-Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.2;
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
					const angle =
						(p / (points * 2)) * Math.PI * 2 - Math.PI / 2;
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
			if (e.node instanceof Text)
				e.node.alpha = Math.max(0, 1 - age * 1.5);
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
				const safePadX =
					canvasW < 600 ? Math.max(16, canvasW * 0.06) : 24;
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
				const safePadX =
					canvasW < 600 ? Math.max(16, canvasW * 0.06) : 24;
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
		if (shutdownComplete) return;
		const { w, h } = readPlayfieldSize();
		applyCanvasDimensions(w, h);
		const dt = ticker.deltaMS / 1000;
		const dtCap = Math.min(0.05, Math.max(0, dt));
		const now = performance.now();
		updateAmbientDecor(dt, now);
		updatePlannedHazards(now);
		updateCollision(now);
		updateBall(now);
		updateBallFx(now);
		refreshVisualMode();
		updateCharacter(now);
		updateEffects(dt, now);
		if (now >= impactZoomResetAt) impactZoomTarget = 1;
		if (game.phase === "crashed" && crashedSettled) impactZoomTarget = 1;
		const impactAlpha = 1 - Math.exp(-IMPACT_ZOOM_SMOOTH_RATE * dtCap);
		impactZoomCurrent +=
			(impactZoomTarget - impactZoomCurrent) * impactAlpha;
		updateCamera(dt, now);
		updateOverlay(now);
		if (devMobSectorDebug && mobSectorDebugG && mobSectorDebugLabelRoot) {
			const lyr = objectLayersForScale(getReferenceScale());
			const span = getAmbientSpawnXSpan(WORLD_W);
			redrawMobSpawnSectorDebug(
				mobSectorDebugG,
				WORLD_W,
				WORLD_H,
				GROUND_Y,
				lyr,
				world.scale.x,
			);
			syncMobSectorDebugLabelLayer(
				mobSectorDebugLabelRoot,
				world.scale.x,
				span.x0,
				WORLD_W,
				lyr,
			);
		}
	};

	/** Pixel size of the Pixi render viewport (must match `app.screen`, not only CSS layout). */
	const readPlayfieldSize = (): { w: number; h: number } => {
		if (app.renderer?.screen) {
			const { width, height } = app.screen;
			if (width > 0 && height > 0) {
				return {
					w: Math.max(1, Math.round(width)),
					h: Math.max(1, Math.round(height)),
				};
			}
		}
		const el = canvas.parentElement;
		const r = canvas.getBoundingClientRect();
		const w = r.width || canvas.clientWidth || el?.clientWidth || 0;
		const h = r.height || canvas.clientHeight || el?.clientHeight || 0;
		return {
			w: Math.max(1, Math.round(w)),
			h: Math.max(1, Math.round(h)),
		};
	};

	const applyCanvasDimensions = (nextW: number, nextH: number): void => {
		const sizeChanged = nextW !== canvasW || nextH !== canvasH;
		canvasW = nextW;
		canvasH = nextH;
		if (!sizeChanged) return;
		syncBackdropToModeAndCanvas();
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
	};

	const fit = (): void => {
		if (shutdownComplete) return;
		if (!canvas.parentElement) return;
		const { w, h } = readPlayfieldSize();
		applyCanvasDimensions(w, h);
		syncBackdropToModeAndCanvas();
		updateCamera(1 / 60, performance.now());
	};

	const refreshVisualMode = (): void => {
		if (activeVisualMode === game.visualTimeMode) return;
		const worldId = visualWorldFromMode(game.visualTimeMode);
		const theme = WORLD_THEMES[worldId];
		syncBackdropToModeAndCanvas();
		backgroundRefs = buildLayeredBackground(
			backgroundLayer,
			game.visualTimeMode,
			theme,
			canvasW,
			canvasH,
			backgroundRefs,
			devFitWholeWorld,
		);
		if (terrainLayer) terrainLayer.frontTerrain.tint = theme.terrainTint;
		activeVisualMode = game.visualTimeMode;
	};

	const rebuildBackgroundForCanvas = (): void => {
		if (canvasW <= 0 || canvasH <= 0) return;
		const worldId = visualWorldFromMode(game.visualTimeMode);
		const theme = WORLD_THEMES[worldId];
		syncBackdropToModeAndCanvas();
		backgroundRefs = buildLayeredBackground(
			backgroundLayer,
			game.visualTimeMode,
			theme,
			canvasW,
			canvasH,
			backgroundRefs,
			devFitWholeWorld,
		);
	};

	const buildScene = (): void => {
		ambientMotions.length = 0;
		flightRevealMotionSerial = 0;
		const worldId = visualWorldFromMode(game.visualTimeMode);
		const theme = WORLD_THEMES[worldId];
		activeVisualMode = game.visualTimeMode;
		stageBackdrop = new Sprite(
			Assets.get(backdropAliasForMode(game.visualTimeMode)),
		);
		stageBackdrop.eventMode = "none";
		fitBackdropToCanvas(stageBackdrop);
		app.stage.addChild(stageBackdrop);
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
			devFitWholeWorld,
		);
		terrainLayer = buildProceduralFrontTerrain(theme.terrainTint);
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
			registerAmbientMotion(
				s.node,
				s.layerId,
				ambientIdx,
				s.fixedGround ?? false,
			);
			ambientIdx += 1;
		}

		flightRevealLayer = new Container();
		flightRevealLayer.eventMode = "none";
		worldObjectLayer.addChild(flightRevealLayer);

		characterSprite = Spine.from({
			skeleton: "spineSheikhJson",
			atlas: "spineSheikhAtlas",
		});
		placeSheikhOnTee(
			characterSprite,
			mapLayout.start.characterX,
			mapLayout.start.characterY,
			0.42,
		);
		attachSheikhSwingComplete(characterSprite);
		playerLayer.addChild(characterSprite);

		ballSprite = new Sprite(Assets.get("ball"));
		place(
			ballSprite,
			mapLayout.start.ballX,
			mapLayout.start.ballY,
			0.1,
			0.5,
		);
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

		if (devMobSectorDebug) {
			mobSectorDebugG?.destroy();
			mobSectorDebugLabelRoot?.destroy();
			mobSectorDebugG = new Graphics();
			mobSectorDebugG.eventMode = "none";
			mobSectorDebugLabelRoot = new Container();
			mobSectorDebugLabelRoot.eventMode = "none";
			world.addChild(mobSectorDebugG);
			world.addChild(mobSectorDebugLabelRoot);
		}
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
			backgroundColor: 0x000000,
			antialias: true,
			autoDensity: true,
			resolution: window.devicePixelRatio || 1,
		});
		if (bootCancelled || shutdownComplete) {
			disposePixiAndTicker();
			return;
		}

		hooks.onProgress?.(0.05);
		const resolveAssetSrc = (asset: { alias: string; src: string }) => ({
			...asset,
			src: `${assets}${asset.src}`,
		});
		await Assets.load(
			GAME_CORE_ASSET_MANIFEST.map(resolveAssetSrc),
			(p) => hooks.onProgress?.(0.05 + p * 0.78),
		);

		void Assets.load(GAME_LAZY_ASSET_MANIFEST.map(resolveAssetSrc)).catch(
			(err) => console.warn("[assets] lazy bundle", err),
		);
		if (bootCancelled || shutdownComplete) {
			disposePixiAndTicker();
			return;
		}
		hooks.onProgress?.(0.88);

		// Sample the visible front layer once and rebuild map layouts on it.
		try {
			const surfaceFn = await sampleFairwaySurfaceFromAssets("");
			if (bootCancelled || shutdownComplete) {
				disposePixiAndTicker();
				return;
			}
			setSurfaceFn(surfaceFn);
			rebuildLayouts();
			mapLayout = getMapLayout(visualWorldFromMode(game.visualTimeMode));
		} catch (error) {
			console.warn("[surface] front-layer sampling failed", error);
		}
		if (bootCancelled || shutdownComplete) {
			disposePixiAndTicker();
			return;
		}
		hooks.onProgress?.(0.93);

		// Seed canvas dimensions before buildScene so the canvas-relative
		// background sizes correctly on the first frame.
		// Match `renderer.screen` so camera/backdrop use the same space as stage transforms
		// (`parent.clientWidth` can disagree with Pixi when `resizeTo` + `autoDensity` are set).
		const { w, h } = readPlayfieldSize();
		canvasW = w;
		canvasH = h;

		buildScene();
		if (bootCancelled || shutdownComplete || app.stage === null) {
			disposePixiAndTicker();
			return;
		}
		app.stage.addChild(world);
		buildOverlay();

		fit();
		if (devFitWholeWorld) {
			console.info(
				"[golf-crash dev] fullWorld: map bottom-aligned; wheel — vertical pan. Layer heights: `layer-stack-config.ts` (add ?fullWorld=1).",
			);
		}
		if (devMobSectorDebug) {
			console.info(
				"[golf-crash dev] mob overlay: red verticals = X sectors (to ~fairway+360px); cyan horizontal = GROUND_Y; red boxes = overlapping altitude lanes for layers 0–5.",
			);
		}
		resizeObserver = new ResizeObserver(() => {
			if (resizeDebounceId !== null)
				window.clearTimeout(resizeDebounceId);
			resizeDebounceId = window.setTimeout(() => {
				resizeDebounceId = null;
				fit();
			}, 140);
		});
		resizeObserver.observe(parent);

		if (devFitWholeWorld) {
			devFullWorldWheelHandler = (ev: WheelEvent) => {
				ev.preventDefault();
				const lim = Math.max(canvasH, 1600) * 2.5;
				devWorldPanYPx -= ev.deltaY * 0.55;
				devWorldPanYPx = Math.max(-lim, Math.min(lim, devWorldPanYPx));
			};
			canvas.addEventListener("wheel", devFullWorldWheelHandler, {
				passive: false,
			});
		}

		unsubDecorative = onDecorativeEvent((ev) =>
			spawnEffect(ev, performance.now()),
		);
		unsubCrash = onCrashCause((cause) =>
			spawnCrashCause(cause, performance.now()),
		);
		unsubWaterSurfaceLoss = onWaterSurfaceLoss(() => {
			const t = performance.now();
			if (!fireBallSprite) return;
			const pos = trajectoryPoint(
				1,
				game.isJackpot ? "holeInOne" : "crash",
			);
			fireBallSprite.x = pos.x;
			fireBallSprite.y = pos.y;
			triggerWaterSplash(pos.x, pos.y + 14, t);
		});
		unsubLanding = onHoleLanding(() => spawnHoleLanding(performance.now()));
		unsubPreShot = onPreShotFail((kind) =>
			spawnPreShotFail(kind, performance.now()),
		);
		unsubRoundPlan = onRoundPlanReady(drawPlannedHazards);
		void prerollNextRound();

		app.ticker.add(animate);
		tickerAttached = true;
		hooks.onProgress?.(1);
		hooks.onReady?.();
	};

	void init().catch(() => undefined);

	return () => {
		bootCancelled = true;
		teardownRound();
		if (devFullWorldWheelHandler) {
			canvas.removeEventListener("wheel", devFullWorldWheelHandler);
			devFullWorldWheelHandler = null;
		}
		if (unsubDecorative) unsubDecorative();
		if (unsubCrash) unsubCrash();
		if (unsubWaterSurfaceLoss) unsubWaterSurfaceLoss();
		if (unsubLanding) unsubLanding();
		if (unsubPreShot) unsubPreShot();
		if (unsubRoundPlan) unsubRoundPlan();
		if (resizeObserver) resizeObserver.disconnect();
		if (resizeDebounceId !== null) window.clearTimeout(resizeDebounceId);
		disposePixiAndTicker();
	};
};
