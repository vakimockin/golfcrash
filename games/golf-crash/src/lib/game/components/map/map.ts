import type { WorldId } from "../../entities/Background.js";

export type MapFeatureType = "water" | "sand" | "bush" | "tree" | "cart" | "hole";

const GROUND_Y = 4000;
const FINAL_HOLE_X = 6900;
const WORLD_W = 7600;

export type MapFeature = {
  id: string;
  type: MapFeatureType;
  x: number;
  y: number;
  scale: number;
  asset?: string;
  alpha?: number;
  flip?: boolean;
  hazardLevelY?: number;
  leftEdgeX?: number;
  rightEdgeX?: number;
};

export type LandingZone = {
  id: string;
  type: "fairway" | "sand" | "water" | "cart" | "hole";
  x: number;
  y: number;
  radius: number;
  featureId?: string;
};

export type MapLayout = {
  id: WorldId;
  seed: string;
  start: {
    ballX: number;
    ballY: number;
    characterX: number;
    characterY: number;
  };
  features: MapFeature[];
  landingZones: LandingZone[];
};

const feature = (
  id: string,
  type: MapFeatureType,
  x: number,
  y: number,
  scale: number,
  asset?: string,
  alpha = 1,
  flip = false,
): MapFeature => ({ id, type, x, y, scale, asset, alpha, flip });

// Default surface — flat baseline used until the front-layer silhouette is
// sampled at runtime. `setSurfaceFn` replaces this with a data-driven curve
// that traces the visible striped fairway from the front PNGs.
let surfaceFn: (x: number) => number = (_x: number) => GROUND_Y - 250;

export const hillSurfaceY = (x: number): number => surfaceFn(x);

export const setSurfaceFn = (fn: (x: number) => number): void => {
  surfaceFn = fn;
};

const BASE_START = (): MapLayout["start"] => ({
  ballX: 690,
  ballY: hillSurfaceY(690),
  characterX: 490,
  characterY: hillSurfaceY(490) - 72,
});

// Find local maxima in surface Y (= visual valleys, since +Y is down).
// Returns sparse, non-clustered candidate points across the play area.
const findValleys = (
  fromX: number,
  toX: number,
  step = 24,
  minSpacing = 360,
): Array<{ x: number; y: number }> => {
  const valleys: Array<{ x: number; y: number }> = [];
  let lastValleyX = -Infinity;
  for (let x = fromX + step; x < toX - step; x += step) {
    const left = hillSurfaceY(x - step);
    const mid = hillSurfaceY(x);
    const right = hillSurfaceY(x + step);
    if (mid >= left && mid >= right && mid - Math.min(left, right) > 2) {
      if (x - lastValleyX < minSpacing) continue;
      valleys.push({ x, y: mid });
      lastValleyX = x;
    }
  }
  return valleys;
};

const findHazardEdges = (
  centerX: number,
  hazardLevelY: number,
  step = 5,
): { leftX: number; rightX: number } => {
  let leftX = centerX;
  let rightX = centerX;
  while (hillSurfaceY(leftX) > hazardLevelY) {
    leftX -= step;
    if (centerX - leftX > 800) break;
  }
  while (hillSurfaceY(rightX) > hazardLevelY) {
    rightX += step;
    if (rightX - centerX > 800) break;
  }
  return { leftX, rightX };
};

const terrainHazards = (worldId: "sunny" | "golden" | "night"): MapFeature[] => {
  const start = BASE_START();
  const safeStart = start.ballX + 420;
  const valleys = findValleys(safeStart, WORLD_W - 600);
  const alpha = worldId === "night" ? 0.62 : worldId === "golden" ? 0.8 : 0.9;

  return valleys.slice(0, 7).map((point, index) => {
    const isWater = index % 2 === 0;
    const asset = isWater
      ? (["waterTrap1", "waterTrap2", "waterTrap4"] as const)[index % 3]
      : (["sandTrap1", "sandTrap2"] as const)[index % 2];
    const hazardLevelY = point.y - (isWater ? 12 : 8);
    const edges = findHazardEdges(point.x, hazardLevelY);
    return {
      ...feature(
        `${isWater ? "water" : "sand"}-${Math.floor(index / 2) + 1}`,
        isWater ? "water" : "sand",
        point.x,
        point.y + (isWater ? 46 : 48),
        isWater ? 0.36 : 0.44,
        asset,
        alpha,
      ),
      hazardLevelY,
      leftEdgeX: edges.leftX,
      rightEdgeX: edges.rightX,
    };
  });
};

const baseLandingZones = (hazards: MapFeature[]): LandingZone[] => [
  { id: "fairway-1", type: "fairway", x: 980, y: hillSurfaceY(980), radius: 150 },
  { id: "fairway-2", type: "fairway", x: 1560, y: hillSurfaceY(1560), radius: 170 },
  { id: "fairway-3", type: "fairway", x: 2520, y: hillSurfaceY(2520), radius: 180 },
  { id: "fairway-4", type: "fairway", x: 4200, y: hillSurfaceY(4200), radius: 180 },
  { id: "fairway-5", type: "fairway", x: 5200, y: hillSurfaceY(5200), radius: 180 },
  { id: "fairway-6", type: "fairway", x: 6200, y: hillSurfaceY(6200), radius: 180 },
  ...hazards.map((hazard): LandingZone => ({
    id: hazard.id,
    type: hazard.type === "water" ? "water" : "sand",
    x: hazard.x,
    y: hazard.y,
    radius: hazard.type === "water" ? 150 : 130,
    featureId: hazard.id,
  })),
  { id: "hole", type: "hole", x: FINAL_HOLE_X, y: hillSurfaceY(FINAL_HOLE_X) + 8, radius: 80, featureId: "hole" },
];

const buildLayout = (id: "sunny" | "golden" | "night"): MapLayout => {
  const hazards = terrainHazards(id);
  const start = BASE_START();
  return {
    id,
    seed: `${id}-v1`,
    start,
    features: [
      ...hazards,
      feature("hole", "hole", FINAL_HOLE_X, hillSurfaceY(FINAL_HOLE_X) + 8, 1),
    ],
    landingZones: baseLandingZones(hazards),
  };
};

export const MAP_LAYOUTS: Record<WorldId, MapLayout> = {
  sunny: buildLayout("sunny"),
  golden: buildLayout("golden"),
  night: buildLayout("night"),
  space: {
    id: "space",
    seed: "space-v1",
    start: BASE_START(),
    features: [],
    landingZones: [],
  },
  desert: {
    id: "desert",
    seed: "desert-v1",
    start: BASE_START(),
    features: [],
    landingZones: [],
  },
  jungle: {
    id: "jungle",
    seed: "jungle-v1",
    start: BASE_START(),
    features: [],
    landingZones: [],
  },
};

// Recompute layouts using the current `surfaceFn`. Call after `setSurfaceFn`.
export const rebuildLayouts = (): void => {
  MAP_LAYOUTS.sunny = buildLayout("sunny");
  MAP_LAYOUTS.golden = buildLayout("golden");
  MAP_LAYOUTS.night = buildLayout("night");
  MAP_LAYOUTS.space = { ...MAP_LAYOUTS.space, start: BASE_START() };
  MAP_LAYOUTS.desert = { ...MAP_LAYOUTS.desert, start: BASE_START() };
  MAP_LAYOUTS.jungle = { ...MAP_LAYOUTS.jungle, start: BASE_START() };
};

export const getMapLayout = (worldId: WorldId): MapLayout =>
  MAP_LAYOUTS[worldId] ?? MAP_LAYOUTS.sunny;
