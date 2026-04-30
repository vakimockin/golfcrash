/** Sample step along X when scanning hill curve for valleys / flats (world px). */
export const TERRAIN_HAZARD_SAMPLE_STEP_PX = 8;

// ═══ World layout + fairway strip (bootstrap, sampler, terrain share these) ═══

export const TERRAIN_WORLD_W_PX = 7600;
export const TERRAIN_WORLD_H_PX = 8000;
/** Reference “ground” line in world Y (ball / character baseline hooks). */
export const TERRAIN_GROUND_Y_PX = 2000;
/** Target rendered height of front road / fairway SVG tiles (drives all strip scales). */
export const TERRAIN_FRONT_ROAD_STRIP_HEIGHT_PX = 2000;
/** Fairway top/bottom band resampling step along X (must match bootstrap surface arrays). */
export const TERRAIN_SURFACE_SAMPLE_STEP_PX = 8;

export const TERRAIN_VALLEY_MIN_WIDTH_PX = 220;
export const TERRAIN_VALLEY_MAX_WIDTH_PX = 320;
export const TERRAIN_VALLEY_MIN_DEPTH_PX = 16;
export const TERRAIN_VALLEY_LIP_TOLERANCE_PX = 0;
/** Added to max(lips) when computing interior water plane in valley scan (world Y grows down). */
export const TERRAIN_VALLEY_WATER_LEVEL_BELOW_MAX_LIP_PX = 4;
/** Interior samples must stay above (waterLevel − this) to count as unobstructed trough. */
export const TERRAIN_VALLEY_INTERIOR_WATER_CLEARANCE_PX = 5;
export const TERRAIN_WATER_HAZARD_TOP_Y_OFFSET_PX = 15;

export const TERRAIN_FLAT_MIN_WIDTH_PX = 150;
export const TERRAIN_FLAT_MAX_WIDTH_PX = 400;
export const TERRAIN_FLAT_TOLERANCE_PX = 3;

/** Overlap subtracted between adjacent road sprites to hide seams (local px after scale). */
export const TERRAIN_ROAD_SEAM_OVERLAP_PX = 2;
/** Step along world X when resampling embedded road silhouette from profile textures. */
export const TERRAIN_ROAD_PROFILE_WORLD_STEP_PX = 2;
/** Road tiles repeat from −padding through worldW + 2×padding. */
export const TERRAIN_ROAD_WORLD_PADDING_PX = 1000;
/** Slight widening so scaled tiles don't leave gaps. */
export const TERRAIN_ROAD_SPRITE_WIDTH_FUDGE_PX = 1.5;
/** Fallback fill when profile missing: fraction of strip height toward “top”. */
export const TERRAIN_ROAD_PROFILE_GAP_TOP_RATIO = 0.72;
export const TERRAIN_ROAD_PROFILE_GAP_BOTTOM_RATIO = 0.13;

// ═══ Layer stacking: horizon Y and parallax (world Y grows down) ═══

export const TERRAIN_HORIZON_ABOVE_GROUND_PX = 110;
export const TERRAIN_MID_LAYER_BELOW_HORIZON_PX = 130;
export const TERRAIN_BACK_LAYER_BELOW_HORIZON_PX = 180;

/** Strip SVG scale height = TERRAIN_FRONT_ROAD_STRIP_HEIGHT_PX × factor. */
export const TERRAIN_MIDDLE_ROAD_HEIGHT_FACTOR = 0.9;
export const TERRAIN_BACK_ROAD_HEIGHT_FACTOR = 1.3;

/** Parent Container.scale per terrain band (parallax). */
export const TERRAIN_FRONT_PARALLAX_SCALE = 1;
export const TERRAIN_MID_PARALLAX_SCALE = 0.85;
export const TERRAIN_BACK_PARALLAX_SCALE = 0.7;

/** Per-sprite alpha in buildRoadLayer (front opaque, mid/back slightly soft). */
export const TERRAIN_FRONT_ROAD_SPRITE_ALPHA = 1;
export const TERRAIN_DISTANT_ROAD_SPRITE_ALPHA = 0.98;

/** draw order inside frontTerrain after sortChildren(). */
export const TERRAIN_FRONT_CHILD_INDEX_GROUND_FILL = 0;
export const TERRAIN_FRONT_CHILD_INDEX_WATER_BACKDROP = 1;
export const TERRAIN_FRONT_CHILD_INDEX_ROAD_LAYER = 2;
export const TERRAIN_FRONT_CHILD_INDEX_HAZARD_LAYER = 3;

export const TERRAIN_FRONT_ROAD_ALIASES = [
  "front1",
  "front2",
  "front3",
  "front4",
  "front5",
  "front6",
] as const;

export const TERRAIN_MIDDLE_ROAD_ALIASES = [
  "middle1",
  "middle2",
  "middle3",
  "middle4",
  "middle5",
  "middle6",
] as const;

export const TERRAIN_BACK_ROAD_ALIASES = [
  "back1",
  "back2",
  "back3",
  "back4",
  "back5",
  "back6",
] as const;

export const TERRAIN_HAZARD_LAYER_Z_INDEX = 5;

export const TERRAIN_WATER_TRAP_ALIASES = [
  "water_trap_1",
  "water_trap_2",
  "water_trap_3",
  "water_trap_4",
] as const;

export const TERRAIN_SAND_TRAP_ALIASES = [
  "sand_trap_1",
  "sand_trap_2",
] as const;

export const TERRAIN_WATER_TRAP_WIDTH_PADDING_PX = 15;
export const TERRAIN_WATER_TRAP_EXTRA_DEPTH_PX = 70;
export const TERRAIN_WATER_SPRITE_ANCHOR_Y = 0.2;
export const TERRAIN_WATER_TRAP_Z_INDEX = 5;
export const TERRAIN_SAND_TRAP_Z_INDEX = 4;
export const TERRAIN_SAND_TRAP_MAX_HEIGHT_PX = 50;
export const TERRAIN_SAND_TRAP_HEIGHT_TO_WIDTH_RATIO = 0.25;

export const TERRAIN_WATER_BACKDROP_WORLD_Y_ABOVE_GROUND_PX = 88;
export const TERRAIN_WATER_BACKDROP_HEIGHT_PX = 5200;

export const TERRAIN_WATER_BACKDROP_GRADIENT_STOPS = [
  { offset: 0, color: 0xaee5fc },
  { offset: 0.45, color: 0x5699c9 },
  { offset: 1, color: 0x0d253f },
] as const;

export const TERRAIN_FRONT_GROUND_FILL_TOP_OFFSET_PX = 20;
export const TERRAIN_FRONT_GROUND_FILL_HEIGHT_PX = 5600;
export const TERRAIN_FRONT_GROUND_FILL_COLOR = 0x182028;

export const TERRAIN_MID_LAYER_TINT = 0xc8dcc8;
export const TERRAIN_BACK_LAYER_TINT = 0x4a6d94;
export const TERRAIN_MID_LAYER_ALPHA = 0.95;
export const TERRAIN_BACK_LAYER_ALPHA = 0.99;

// ─── Middle layer extras (route overlay + decorative seam sprites) ───
//
// Strip height follows TERRAIN_MIDDLE_ROAD_HEIGHT_FACTOR × incoming
// frontTileHeight. Seam accents multiply that baseline by SCALE_MULTIPLIER
// × AXIS_SCALE_{X,Y}; anchors and OFFSET_* tweak placement vs the seam.

// Route-line drawn along the top silhouette of the middle terrain layer.
// Step is in worldW units (pre-scale, since the line lives inside midTerrain
// which has its own parallax scale applied by the parent).
export const TERRAIN_MID_ROUTE_LINE_STEP_PX = 4;
export const TERRAIN_MID_ROUTE_LINE_COLOR = 0xff2a2a;
export const TERRAIN_MID_ROUTE_LINE_WIDTH_PX = 4;
export const TERRAIN_MID_ROUTE_LINE_ALPHA = 0.96;
export const TERRAIN_MID_ROUTE_LINE_LIFT_PX = 1;

export const TERRAIN_MID_SEAM_ACCENT_ALIASES = [
  "middleDog",
  "middleGirls",
  "middleSnake",
  "middleAngryPlayers",
] as const;
export const TERRAIN_MID_SEAM_ACCENT_EVERY_N = 3;
// Skip seams that fall outside the visible world by this margin. Seams in
// the off-screen overscan padding would waste draw calls.
export const TERRAIN_MID_SEAM_ACCENT_WORLD_PADDING_PX = 150;

/** Overall size vs the middle-road strip (`middleUniformScale`). */
export const TERRAIN_MID_SEAM_ACCENT_SCALE_MULTIPLIER = 1.0;
/**
 * Fine-tune width vs height independently (1 = inherit aspect from scale multiplier × road scale).
 * Example: SCALE_MULTIPLIER 1.25 + AXIS_X 1.2 makes the accent wider/taller-ish on X only.
 */
export const TERRAIN_MID_SEAM_ACCENT_AXIS_SCALE_X = 1;
export const TERRAIN_MID_SEAM_ACCENT_AXIS_SCALE_Y = 1;

// Anchor of the accent sprite. Default (0, 1) = bottom-left, identical to
// how middle road tiles are placed in buildRoadLayer (sprite.anchor.set(0, 1)).
// Switch to (0.5, 1) if you want the accent centred on the seam X.
export const TERRAIN_MID_SEAM_ACCENT_ANCHOR_X = 0;
export const TERRAIN_MID_SEAM_ACCENT_ANCHOR_Y = 1;
// Horizontal nudge added on top of seamX (midTerrain-local px, pre-parallax).
// Useful when the character art inside the SVG sits off-centre and needs
// to be aligned with the actual seam visible on screen.
export const TERRAIN_MID_SEAM_ACCENT_OFFSET_X_PX = 0;
// Vertical nudge added on top of the road baseline (y = 0). Negative lifts
// the accent ABOVE the silhouette, positive sinks it INTO the ground.
// midTerrain Y grows down.
export const TERRAIN_MID_SEAM_ACCENT_OFFSET_Y_PX = 1;
// Opacity per accent. 1 = fully opaque. Drop slightly to fade characters
// into the distant atmosphere if they read as too sharp against road tiles.
export const TERRAIN_MID_SEAM_ACCENT_ALPHA = 1;
