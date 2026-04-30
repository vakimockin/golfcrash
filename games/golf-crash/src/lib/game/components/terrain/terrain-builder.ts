import {
	Assets,
	Container,
	FillGradient,
	Graphics,
	Sprite,
	type Texture,
} from "pixi.js";
import type { TerrainLayers } from "../core/world-types.js";
import {
	TERRAIN_BACK_LAYER_ALPHA,
	TERRAIN_BACK_LAYER_BELOW_HORIZON_PX,
	TERRAIN_BACK_LAYER_TINT,
	TERRAIN_BACK_PARALLAX_SCALE,
	TERRAIN_BACK_ROAD_ALIASES,
	TERRAIN_BACK_ROAD_HEIGHT_FACTOR,
	TERRAIN_DISTANT_ROAD_SPRITE_ALPHA,
	TERRAIN_FLAT_MAX_WIDTH_PX,
	TERRAIN_FLAT_MIN_WIDTH_PX,
	TERRAIN_FLAT_TOLERANCE_PX,
	TERRAIN_FRONT_CHILD_INDEX_GROUND_FILL,
	TERRAIN_FRONT_CHILD_INDEX_HAZARD_LAYER,
	TERRAIN_FRONT_CHILD_INDEX_ROAD_LAYER,
	TERRAIN_FRONT_CHILD_INDEX_WATER_BACKDROP,
	TERRAIN_FRONT_GROUND_FILL_COLOR,
	TERRAIN_FRONT_GROUND_FILL_HEIGHT_PX,
	TERRAIN_FRONT_GROUND_FILL_TOP_OFFSET_PX,
	TERRAIN_FRONT_PARALLAX_SCALE,
	TERRAIN_FRONT_ROAD_ALIASES,
	TERRAIN_FRONT_ROAD_SPRITE_ALPHA,
	TERRAIN_HAZARD_LAYER_Z_INDEX,
	TERRAIN_HAZARD_SAMPLE_STEP_PX,
	TERRAIN_HORIZON_ABOVE_GROUND_PX,
	TERRAIN_MIDDLE_ROAD_ALIASES,
	TERRAIN_MIDDLE_ROAD_HEIGHT_FACTOR,
	TERRAIN_MID_LAYER_ALPHA,
	TERRAIN_MID_LAYER_BELOW_HORIZON_PX,
	TERRAIN_MID_LAYER_TINT,
	TERRAIN_MID_PARALLAX_SCALE,
	TERRAIN_MID_SEAM_ACCENT_ALIASES,
	TERRAIN_MID_SEAM_ACCENT_ALPHA,
	TERRAIN_MID_SEAM_ACCENT_ANCHOR_X,
	TERRAIN_MID_SEAM_ACCENT_ANCHOR_Y,
	TERRAIN_MID_SEAM_ACCENT_AXIS_SCALE_X,
	TERRAIN_MID_SEAM_ACCENT_AXIS_SCALE_Y,
	TERRAIN_MID_SEAM_ACCENT_EVERY_N,
	TERRAIN_MID_SEAM_ACCENT_OFFSET_X_PX,
	TERRAIN_MID_SEAM_ACCENT_OFFSET_Y_PX,
	TERRAIN_MID_SEAM_ACCENT_SCALE_MULTIPLIER,
	TERRAIN_MID_SEAM_ACCENT_WORLD_PADDING_PX,
	TERRAIN_ROAD_PROFILE_GAP_BOTTOM_RATIO,
	TERRAIN_ROAD_PROFILE_GAP_TOP_RATIO,
	TERRAIN_ROAD_PROFILE_WORLD_STEP_PX,
	TERRAIN_ROAD_SEAM_OVERLAP_PX,
	TERRAIN_ROAD_SPRITE_WIDTH_FUDGE_PX,
	TERRAIN_ROAD_WORLD_PADDING_PX,
	TERRAIN_SAND_TRAP_ALIASES,
	TERRAIN_SAND_TRAP_HEIGHT_TO_WIDTH_RATIO,
	TERRAIN_SAND_TRAP_MAX_HEIGHT_PX,
	TERRAIN_SAND_TRAP_Z_INDEX,
	TERRAIN_VALLEY_INTERIOR_WATER_CLEARANCE_PX,
	TERRAIN_VALLEY_MAX_WIDTH_PX,
	TERRAIN_VALLEY_MIN_DEPTH_PX,
	TERRAIN_VALLEY_MIN_WIDTH_PX,
	TERRAIN_VALLEY_LIP_TOLERANCE_PX,
	TERRAIN_VALLEY_WATER_LEVEL_BELOW_MAX_LIP_PX,
	TERRAIN_WATER_BACKDROP_GRADIENT_STOPS,
	TERRAIN_WATER_BACKDROP_HEIGHT_PX,
	TERRAIN_WATER_BACKDROP_WORLD_Y_ABOVE_GROUND_PX,
	TERRAIN_WATER_HAZARD_TOP_Y_OFFSET_PX,
	TERRAIN_WATER_SPRITE_ANCHOR_Y,
	TERRAIN_WATER_TRAP_ALIASES,
	TERRAIN_WATER_TRAP_EXTRA_DEPTH_PX,
	TERRAIN_WATER_TRAP_WIDTH_PADDING_PX,
	TERRAIN_WATER_TRAP_Z_INDEX,
} from "./terrain-builder-constants.js";

type RoadProfile = {
	width: number;
	height: number;
	top: number[];
	bottom: number[];
};

type TerrainBuilderArgs = {
	tint: number;
	worldW: number;
	groundY: number;
	frontTileHeight: number;
	surfaceStepPx: number;
	sampledSurfaceTop: Float32Array | null;
	sampledSurfaceBottom: Float32Array | null;
	hillSurfaceY: (x: number) => number;
	readRoadProfileFromTexture: (alias: string) => RoadProfile;
	setSpriteVisualWidth: (
		sprite: Sprite,
		width: number,
		flip?: boolean,
	) => void;
	waterForbiddenInterval?: { minX: number; maxX: number };
};

export type HazardZone = {
	type: "water" | "sand";
	startX: number;
	endX: number;
	topY: number;
};

const rangesOverlapWorldX = (
	aMin: number,
	aMax: number,
	bMin: number,
	bMax: number,
): boolean => !(aMax < bMin || aMin > bMax);

export const analyzeTerrainForHazards = (
	worldW: number,
	hillSurfaceY: (x: number) => number,
	waterForbidden?: { minX: number; maxX: number } | undefined,
): HazardZone[] => {
	const waterForbiddenOverlap = (startX: number, endX: number): boolean =>
		waterForbidden !== undefined &&
		rangesOverlapWorldX(
			startX,
			endX,
			waterForbidden.minX,
			waterForbidden.maxX,
		);

	const step = TERRAIN_HAZARD_SAMPLE_STEP_PX;
	const sampleCount = Math.floor(worldW / step) + 1;
	const samples: number[] = new Array(sampleCount);
	for (let i = 0; i < sampleCount; i += 1) {
		samples[i] = hillSurfaceY(i * step);
	}

	const zones: HazardZone[] = [];
	const claimed: Array<{ start: number; end: number }> = [];
	const overlapsClaimed = (a: number, b: number): boolean =>
		claimed.some((c) => !(b < c.start || a > c.end));

	const minIdxStep = Math.max(
		1,
		Math.floor(TERRAIN_VALLEY_MIN_WIDTH_PX / step),
	);
	const maxIdxStep = Math.max(
		minIdxStep + 1,
		Math.floor(TERRAIN_VALLEY_MAX_WIDTH_PX / step),
	);

	for (let leftIdx = 0; leftIdx < sampleCount; leftIdx += 2) {
		const leftY = samples[leftIdx]!;
		let bestRight = -1;
		let bestDepth = 0;
		for (let widthIdx = minIdxStep; widthIdx <= maxIdxStep; widthIdx += 2) {
			const rightIdx = leftIdx + widthIdx;
			if (rightIdx >= sampleCount) break;
			const rightY = samples[rightIdx]!;
			if (Math.abs(leftY - rightY) > TERRAIN_VALLEY_LIP_TOLERANCE_PX) continue;
			const waterLevel =
				Math.max(leftY, rightY) +
				TERRAIN_VALLEY_WATER_LEVEL_BELOW_MAX_LIP_PX;
			let hasHill = false;
			let valleyMaxY = -Infinity;
			for (let k = leftIdx + 1; k < rightIdx; k += 1) {
				const v = samples[k]!;
				if (v < waterLevel - TERRAIN_VALLEY_INTERIOR_WATER_CLEARANCE_PX) {
					hasHill = true;
					break;
				}
				if (v > valleyMaxY) valleyMaxY = v;
			}
			if (hasHill) continue;
			const lipY = Math.min(leftY, rightY);
			const depth = valleyMaxY - lipY;
			if (depth >= TERRAIN_VALLEY_MIN_DEPTH_PX && depth > bestDepth) {
				bestDepth = depth;
				bestRight = rightIdx;
			}
		}
		if (bestRight >= 0) {
			let refinedLeft = leftIdx;
			let refinedRight = bestRight;
			while (
				refinedLeft + 2 < refinedRight &&
				samples[refinedLeft + 1]! <= samples[refinedLeft]!
			) {
				refinedLeft += 1;
			}
			while (
				refinedRight - 2 > refinedLeft &&
				samples[refinedRight - 1]! <= samples[refinedRight]!
			) {
				refinedRight -= 1;
			}
			const startX = refinedLeft * step;
			const endX = refinedRight * step;
			const lowerLipY = Math.max(leftY, samples[bestRight]!);
			if (!waterForbiddenOverlap(startX, endX)) {
				zones.push({
					type: "water",
					startX,
					endX,
					topY: lowerLipY + TERRAIN_WATER_HAZARD_TOP_Y_OFFSET_PX,
				});
				claimed.push({ start: startX, end: endX });
			}
			// Вода тільки в заглибинах; у забороненій ділянці (tee) — жодного хазарду.
			// Пісок тільки з окремого проходу по рівних ділянках нижче.
			leftIdx = bestRight; // skip past this valley
		}
	}
	if (!zones.some((z) => z.type === "water")) {
		let bestFallback: {
			startX: number;
			endX: number;
			topY: number;
			depth: number;
		} | null = null;
		for (let leftIdx = 0; leftIdx < sampleCount; leftIdx += 2) {
			const leftY = samples[leftIdx]!;
			for (
				let widthIdx = minIdxStep;
				widthIdx <= maxIdxStep;
				widthIdx += 2
			) {
				const rightIdx = leftIdx + widthIdx;
				if (rightIdx >= sampleCount) break;
				const rightY = samples[rightIdx]!;
				if (Math.abs(leftY - rightY) > TERRAIN_VALLEY_LIP_TOLERANCE_PX)
					continue;
				let valleyMaxY = -Infinity;
				for (let k = leftIdx + 1; k < rightIdx; k += 1) {
					const v = samples[k]!;
					if (v > valleyMaxY) valleyMaxY = v;
				}
				const lipY = Math.min(leftY, rightY);
				const depth = valleyMaxY - lipY;
				if (depth < TERRAIN_VALLEY_MIN_DEPTH_PX) continue;
				const startX = leftIdx * step;
				const endX = rightIdx * step;
				if (overlapsClaimed(startX, endX)) continue;
				if (
					(!bestFallback || depth > bestFallback.depth) &&
					!waterForbiddenOverlap(startX, endX)
				) {
					bestFallback = {
						startX,
						endX,
						topY:
							Math.max(leftY, rightY) +
							TERRAIN_VALLEY_WATER_LEVEL_BELOW_MAX_LIP_PX,
						depth,
					};
				}
			}
		}
		if (
			bestFallback &&
			!waterForbiddenOverlap(bestFallback.startX, bestFallback.endX)
		) {
			zones.push({
				type: "water",
				startX: bestFallback.startX,
				endX: bestFallback.endX,
				topY: bestFallback.topY,
			});
			claimed.push({
				start: bestFallback.startX,
				end: bestFallback.endX,
			});
		}
	}

	const flatMinIdx = Math.max(
		1,
		Math.floor(TERRAIN_FLAT_MIN_WIDTH_PX / step),
	);
	const flatMaxIdx = Math.max(
		flatMinIdx + 1,
		Math.floor(TERRAIN_FLAT_MAX_WIDTH_PX / step),
	);

	let i = 0;
	while (i + flatMinIdx < sampleCount) {
		let minY = Infinity;
		let maxY = -Infinity;
		let endIdx = i + flatMinIdx;
		for (let k = i; k <= endIdx; k += 1) {
			const v = samples[k]!;
			if (v < minY) minY = v;
			if (v > maxY) maxY = v;
		}
		if (maxY - minY < TERRAIN_FLAT_TOLERANCE_PX) {
			while (endIdx + 1 < sampleCount && endIdx - i < flatMaxIdx) {
				const next = samples[endIdx + 1]!;
				const nextMin = Math.min(minY, next);
				const nextMax = Math.max(maxY, next);
				if (nextMax - nextMin >= TERRAIN_FLAT_TOLERANCE_PX) break;
				minY = nextMin;
				maxY = nextMax;
				endIdx += 1;
			}
			const startX = i * step;
			const endX = endIdx * step;
			if (!overlapsClaimed(startX, endX)) {
				zones.push({
					type: "sand",
					startX,
					endX,
					topY: samples[i]!,
				});
				claimed.push({ start: startX, end: endX });
			}
			i = endIdx + flatMinIdx; // skip ahead so flats don't crowd
		} else {
			i += 2;
		}
	}

	zones.sort((a, b) => a.startX - b.startX);
	return zones;
};

export const buildProceduralFrontTerrain = ({
	tint,
	worldW,
	groundY,
	frontTileHeight,
	surfaceStepPx,
	sampledSurfaceTop,
	sampledSurfaceBottom,
	hillSurfaceY,
	readRoadProfileFromTexture,
	setSpriteVisualWidth,
	waterForbiddenInterval,
}: TerrainBuilderArgs): TerrainLayers => {
	const root = new Container();
	const backTerrain = new Container();
	const midTerrain = new Container();
	const frontTerrain = new Container();
	frontTerrain.sortableChildren = true;
	const seamOverlap = TERRAIN_ROAD_SEAM_OVERLAP_PX;
	const worldSampleStep = TERRAIN_ROAD_PROFILE_WORLD_STEP_PX;
	// Striped fairway uses tiled sprites along X; bending grass with the hill curve would need Mesh/Rope UV deformation — future improvement.

	const buildRoadLayer = (
		aliases: readonly string[],
		targetH: number,
		alpha = 1,
	): {
		layer: Container;
		segments: Array<{ alias: string; x: number; width: number }>;
	} => {
		const layer = new Container();
		const segments: Array<{ alias: string; x: number; width: number }> = [];
		let index = 0;
		const baseTex = Assets.get(aliases[0]!);
		const uniformScale = targetH / baseTex.height;
		let currentX = -TERRAIN_ROAD_WORLD_PADDING_PX;
		while (currentX < worldW + TERRAIN_ROAD_WORLD_PADDING_PX * 2) {
			const alias = aliases[index % aliases.length]!;
			const tex = Assets.get(alias);
			const sprite = new Sprite(tex);
			sprite.anchor.set(0, 1);
			sprite.scale.set(uniformScale);
			sprite.x = Math.floor(currentX);
			sprite.y = 0;
			sprite.alpha = alpha;
			const actualRenderedWidth = sprite.width;
			sprite.width = actualRenderedWidth + TERRAIN_ROAD_SPRITE_WIDTH_FUDGE_PX;
			layer.addChild(sprite);
			segments.push({ alias, x: sprite.x, width: sprite.width });
			currentX += actualRenderedWidth - seamOverlap;
			index += 1;
		}
		return { layer, segments };
	};

	const buildRoadSamples = (
		segments: Array<{ alias: string; x: number; width: number }>,
		layerY: number,
		targetH: number,
	): { top: number[]; bottom: number[] } => {
		const top = new Array<number>(worldW + 1).fill(
			Number.POSITIVE_INFINITY,
		);
		const bottom = new Array<number>(worldW + 1).fill(
			Number.NEGATIVE_INFINITY,
		);
		const baseTex = Assets.get(segments[0]!.alias) as Texture;
		const uniformScale = targetH / Math.max(1, baseTex.height);
		for (const segment of segments) {
			const profile = readRoadProfileFromTexture(segment.alias);
			const fromX = Math.max(0, Math.round(segment.x));
			const toX = Math.min(worldW, Math.round(segment.x + segment.width));
			for (let x = fromX; x <= toX; x += worldSampleStep) {
				const local = (x - segment.x) / Math.max(1, segment.width);
				const sampleX = Math.max(
					0,
					Math.min(
						profile.width - 1,
						Math.round(local * (profile.width - 1)),
					),
				);
				const topY = profile.top[sampleX]!;
				const bottomY = profile.bottom[sampleX]!;
				const worldTop =
					layerY - (profile.height - topY) * uniformScale;
				const worldBottom =
					layerY - (profile.height - bottomY) * uniformScale;
				top[x] = Math.min(top[x]!, worldTop);
				bottom[x] = Math.max(bottom[x]!, worldBottom);
			}
		}
		let lastTop = layerY - targetH * TERRAIN_ROAD_PROFILE_GAP_TOP_RATIO;
		let lastBottom = layerY - targetH * TERRAIN_ROAD_PROFILE_GAP_BOTTOM_RATIO;
		for (let x = 0; x <= worldW; x += 1) {
			if (Number.isFinite(top[x]!)) lastTop = top[x]!;
			else top[x] = lastTop;
			if (Number.isFinite(bottom[x]!)) lastBottom = bottom[x]!;
			else bottom[x] = lastBottom;
		}
		return { top, bottom };
	};

	const HORIZON_Y = groundY + TERRAIN_HORIZON_ABOVE_GROUND_PX;
	const MID_LAYER_Y = HORIZON_Y - TERRAIN_MID_LAYER_BELOW_HORIZON_PX;
	const BACK_LAYER_Y = HORIZON_Y - TERRAIN_BACK_LAYER_BELOW_HORIZON_PX;

	const frontTargetH = frontTileHeight;
	const middleTargetH = frontTargetH * TERRAIN_MIDDLE_ROAD_HEIGHT_FACTOR;
	const backTargetH = frontTargetH * TERRAIN_BACK_ROAD_HEIGHT_FACTOR;
	const frontBuilt = buildRoadLayer(
		[...TERRAIN_FRONT_ROAD_ALIASES],
		frontTargetH,
		TERRAIN_FRONT_ROAD_SPRITE_ALPHA,
	);
	const middleBuilt = buildRoadLayer(
		[...TERRAIN_MIDDLE_ROAD_ALIASES],
		middleTargetH,
		TERRAIN_DISTANT_ROAD_SPRITE_ALPHA,
	);
	const backBuilt = buildRoadLayer(
		[...TERRAIN_BACK_ROAD_ALIASES],
		backTargetH,
		TERRAIN_DISTANT_ROAD_SPRITE_ALPHA,
	);

	backTerrain.y = BACK_LAYER_Y;
	backTerrain.scale.set(TERRAIN_BACK_PARALLAX_SCALE);
	midTerrain.y = MID_LAYER_Y;
	midTerrain.scale.set(TERRAIN_MID_PARALLAX_SCALE);
	frontTerrain.y = HORIZON_Y;
	frontTerrain.scale.set(TERRAIN_FRONT_PARALLAX_SCALE);
	backTerrain.addChild(backBuilt.layer);
	midTerrain.addChild(middleBuilt.layer);
	frontTerrain.addChild(frontBuilt.layer);

	// ─── Middle-layer route line (debug overlay) — disabled ─────────────
	// const middleSamples = buildRoadSamples(
	// 	middleBuilt.segments,
	// 	0,
	// 	middleTargetH,
	// );
	// const midRouteLine = new Graphics();
	// midRouteLine.moveTo(
	// 	0,
	// 	middleSamples.top[0]! - TERRAIN_MID_ROUTE_LINE_LIFT_PX,
	// );
	// for (
	// 	let x = TERRAIN_MID_ROUTE_LINE_STEP_PX;
	// 	x <= worldW;
	// 	x += TERRAIN_MID_ROUTE_LINE_STEP_PX
	// ) {
	// 	midRouteLine.lineTo(
	// 		x,
	// 		middleSamples.top[x]! - TERRAIN_MID_ROUTE_LINE_LIFT_PX,
	// 	);
	// }
	// midRouteLine.stroke({
	// 	color: TERRAIN_MID_ROUTE_LINE_COLOR,
	// 	width: TERRAIN_MID_ROUTE_LINE_WIDTH_PX,
	// 	alpha: TERRAIN_MID_ROUTE_LINE_ALPHA,
	// });
	// midTerrain.addChild(midRouteLine);

	// ─── Middle-layer seam accents ───────────────────────────────────────
	// Same canvas + grass silhouette as middle road tiles (drop-in SVGs).
	// Base scale = middleUniformScale (see TERRAIN_MIDDLE_ROAD_HEIGHT_FACTOR +
	// front tile height); tune size/anchors/offsets in terrain-builder-constants.
	const middleBaseTex = Assets.get(TERRAIN_MIDDLE_ROAD_ALIASES[0]!);
	const middleUniformScale =
		middleTargetH / Math.max(1, middleBaseTex.height);
	let placedSeamAccents = 0;
	for (let i = 1; i < middleBuilt.segments.length; i += 1) {
		// Seam = where segment i starts (== where segment i-1 ends).
		const seamX = Math.round(middleBuilt.segments[i]!.x);
		if (
			seamX < -TERRAIN_MID_SEAM_ACCENT_WORLD_PADDING_PX ||
			seamX > worldW + TERRAIN_MID_SEAM_ACCENT_WORLD_PADDING_PX
		)
			continue;
		// Optional density throttle — every Nth seam gets a character.
		if ((i - 1) % TERRAIN_MID_SEAM_ACCENT_EVERY_N !== 0) continue;
		const aliasIndex =
			placedSeamAccents % TERRAIN_MID_SEAM_ACCENT_ALIASES.length;
		const alias = TERRAIN_MID_SEAM_ACCENT_ALIASES[aliasIndex]!;
		const accent = new Sprite(Assets.get(alias));
		const sx =
			middleUniformScale *
			TERRAIN_MID_SEAM_ACCENT_SCALE_MULTIPLIER *
			TERRAIN_MID_SEAM_ACCENT_AXIS_SCALE_X;
		const sy =
			middleUniformScale *
			TERRAIN_MID_SEAM_ACCENT_SCALE_MULTIPLIER *
			TERRAIN_MID_SEAM_ACCENT_AXIS_SCALE_Y;
		accent.anchor.set(
			TERRAIN_MID_SEAM_ACCENT_ANCHOR_X,
			TERRAIN_MID_SEAM_ACCENT_ANCHOR_Y,
		);
		accent.scale.set(sx, sy);
		accent.x = seamX + TERRAIN_MID_SEAM_ACCENT_OFFSET_X_PX;
		accent.y = TERRAIN_MID_SEAM_ACCENT_OFFSET_Y_PX;
		accent.alpha = TERRAIN_MID_SEAM_ACCENT_ALPHA;
		midTerrain.addChild(accent);
		placedSeamAccents += 1;
	}

	const sampled =
		sampledSurfaceTop && sampledSurfaceBottom
			? (() => {
					const top = new Array<number>(worldW + 1);
					const bottom = new Array<number>(worldW + 1);
					for (let x = 0; x <= worldW; x += 1) {
						const idxF = x / surfaceStepPx;
						const i0 = Math.max(
							0,
							Math.min(
								sampledSurfaceTop.length - 1,
								Math.floor(idxF),
							),
						);
						const i1 = Math.max(
							0,
							Math.min(
								sampledSurfaceTop.length - 1,
								Math.ceil(idxF),
							),
						);
						const t = idxF - Math.floor(idxF);
						top[x] =
							sampledSurfaceTop[i0]! * (1 - t) +
							sampledSurfaceTop[i1]! * t;
						bottom[x] =
							sampledSurfaceBottom[i0]! * (1 - t) +
							sampledSurfaceBottom[i1]! * t;
					}
					return { top, bottom };
				})()
			: null;
	const samples =
		sampled ??
		buildRoadSamples(frontBuilt.segments, frontTerrain.y, frontTargetH);
	// Bush/hole generation removed by request.
	// ─── Procedural hazards + route integration ──────────────────────────
	const hazardLayer = new Container();
	hazardLayer.sortableChildren = true;
	hazardLayer.zIndex = TERRAIN_HAZARD_LAYER_Z_INDEX;
	const hazardZones = analyzeTerrainForHazards(
		worldW,
		hillSurfaceY,
		waterForbiddenInterval,
	);
	const localY = (worldY: number): number => worldY - frontTerrain.y;
	// const routeLine = new Graphics();
	// const SHOW_ROUTE_DEBUG = true;
	// if (SHOW_ROUTE_DEBUG) {
	// 	routeLine.moveTo(0, hillSurfaceY(0) - frontTerrain.y);
	// 	for (let x = 1; x <= worldW; x += 1) {
	// 		routeLine.lineTo(x, hillSurfaceY(x) - frontTerrain.y);
	// 	}
	// 	routeLine.stroke({ color: 0xff2a2a, width: 4, alpha: 0.96 });
	// }
	// frontTerrain.addChild(routeLine);

	for (const [index, zone] of hazardZones.entries()) {
		const { startX, endX } = zone;
		const width = Math.max(1, endX - startX);
		const centerX = (startX + endX) / 2;

		const isWater = zone.type === "water";
		const assets = isWater
			? TERRAIN_WATER_TRAP_ALIASES
			: TERRAIN_SAND_TRAP_ALIASES;
		const alias = assets[index % assets.length]!;

		const sprite = new Sprite(Assets.get(alias));
		sprite.x = centerX;

		if (isWater) {
			sprite.anchor.set(0.5, TERRAIN_WATER_SPRITE_ANCHOR_Y);
			sprite.y = localY(zone.topY);
			sprite.width = width + TERRAIN_WATER_TRAP_WIDTH_PADDING_PX;
			const depth = Math.abs(localY(hillSurfaceY(centerX)) - sprite.y);
			sprite.height = depth + TERRAIN_WATER_TRAP_EXTRA_DEPTH_PX;
			sprite.zIndex = TERRAIN_WATER_TRAP_Z_INDEX;
		} else {
			sprite.anchor.set(0.5, 0);
			sprite.y = localY(hillSurfaceY(centerX));
			sprite.width = width;
			sprite.height = Math.min(
				TERRAIN_SAND_TRAP_MAX_HEIGHT_PX,
				width * TERRAIN_SAND_TRAP_HEIGHT_TO_WIDTH_RATIO,
			);
			sprite.zIndex = TERRAIN_SAND_TRAP_Z_INDEX;
		}

		hazardLayer.addChild(sprite);
	}
	hazardLayer.sortChildren();
	frontTerrain.addChild(hazardLayer);

	const waterBandBackdropGradient = new FillGradient({
		type: "linear",
		start: { x: 0, y: 0 },
		end: { x: 0, y: 1 },
		textureSpace: "local",
		colorStops: [...TERRAIN_WATER_BACKDROP_GRADIENT_STOPS],
	});
	const waterBackdrop = new Graphics();
	waterBackdrop
		.rect(
			-TERRAIN_ROAD_WORLD_PADDING_PX,
			localY(groundY + TERRAIN_WATER_BACKDROP_WORLD_Y_ABOVE_GROUND_PX),
			worldW + TERRAIN_ROAD_WORLD_PADDING_PX * 2,
			TERRAIN_WATER_BACKDROP_HEIGHT_PX,
		)
		.fill(waterBandBackdropGradient);

	const groundFill = new Graphics();
	groundFill
		.rect(
			-TERRAIN_ROAD_WORLD_PADDING_PX,
			frontTargetH - TERRAIN_FRONT_GROUND_FILL_TOP_OFFSET_PX,
			worldW + TERRAIN_ROAD_WORLD_PADDING_PX * 2,
			TERRAIN_FRONT_GROUND_FILL_HEIGHT_PX,
		)
		.fill(TERRAIN_FRONT_GROUND_FILL_COLOR);
	frontTerrain.addChildAt(groundFill, TERRAIN_FRONT_CHILD_INDEX_GROUND_FILL);
	frontTerrain.addChildAt(
		waterBackdrop,
		TERRAIN_FRONT_CHILD_INDEX_WATER_BACKDROP,
	);

	frontTerrain.setChildIndex(groundFill, TERRAIN_FRONT_CHILD_INDEX_GROUND_FILL);
	frontTerrain.setChildIndex(
		waterBackdrop,
		TERRAIN_FRONT_CHILD_INDEX_WATER_BACKDROP,
	);
	frontTerrain.setChildIndex(
		frontBuilt.layer,
		TERRAIN_FRONT_CHILD_INDEX_ROAD_LAYER,
	);
	frontTerrain.setChildIndex(
		hazardLayer,
		TERRAIN_FRONT_CHILD_INDEX_HAZARD_LAYER,
	);
	// frontTerrain.setChildIndex(routeLine, 4);
	frontTerrain.sortChildren();
	frontTerrain.tint = tint;
	// Atmospheric perspective: distant ridge cooler / bluer than mid-ground.
	midTerrain.tint = TERRAIN_MID_LAYER_TINT;
	backTerrain.tint = TERRAIN_BACK_LAYER_TINT;
	midTerrain.alpha = TERRAIN_MID_LAYER_ALPHA;
	backTerrain.alpha = TERRAIN_BACK_LAYER_ALPHA;

	root.addChild(backTerrain);
	root.addChild(midTerrain);
	root.addChild(frontTerrain);
	return { root, backTerrain, midTerrain, frontTerrain };
};
