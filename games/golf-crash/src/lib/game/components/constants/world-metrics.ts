/** World size, playable bounds, camera and surface sampling tuning for bootstrap/renderers.
 *  Core layout numbers for terrain/fairway live in `terrain-builder-constants.ts`; this
 *  file re-exports them under historical names so gameplay code stays unchanged.
 */

import {
  TERRAIN_FRONT_ROAD_STRIP_HEIGHT_PX,
  TERRAIN_GROUND_Y_PX,
  TERRAIN_HORIZON_ABOVE_GROUND_PX,
  TERRAIN_SURFACE_SAMPLE_STEP_PX,
  TERRAIN_WORLD_H_PX,
  TERRAIN_WORLD_W_PX,
} from "../terrain/terrain-builder-constants.js";

export const WORLD_W = TERRAIN_WORLD_W_PX;
export const WORLD_H = TERRAIN_WORLD_H_PX;
export const GROUND_Y = TERRAIN_GROUND_Y_PX;

export const BACKGROUND_OVERSCAN_X = 2200;
export const SCREENS_TO_SPACE = 6;

export const BALL_START_X = 690;
export const BALL_START_Y = GROUND_Y - 90;
export const BALL_APEX_Y = GROUND_Y - 1180;
export const BALL_SPEED_X = 600;
export const CHAR_X = BALL_START_X - 200;

export const FLAG_X = WORLD_W - 700;
export const HOLE_X = FLAG_X;
export const PLAY_END_X = HOLE_X;

export const NEAR_HOLE_DISTANCE = 320;

export const FLIGHT_CAMERA_FOCUS_X = 0.45;
export const FLIGHT_CAMERA_FOCUS_Y = 0.4;
export const IDLE_CAMERA_FOCUS_X = 0.4;
export const CAMERA_LERP = 0.08;

export const PLANNED_HAZARD_WIDTH = 150;

export const FRONT_TILE_HEIGHT = TERRAIN_FRONT_ROAD_STRIP_HEIGHT_PX;
export const HORIZON_Y_VAL = GROUND_Y + TERRAIN_HORIZON_ABOVE_GROUND_PX;
export const SURFACE_STEP_PX = TERRAIN_SURFACE_SAMPLE_STEP_PX;
