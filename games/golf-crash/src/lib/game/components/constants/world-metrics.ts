/** World size, playable bounds, camera and surface sampling tuning for bootstrap/renderers. */

export const WORLD_W = 7600;
export const WORLD_H = 8000;
export const GROUND_Y = 5000;

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

export const FLIGHT_CAMERA_FOCUS_X = 0.36;
export const FLIGHT_CAMERA_FOCUS_Y = 0.55;
export const IDLE_CAMERA_FOCUS_X = 0.4;
export const CAMERA_LERP = 0.08;

export const PLANNED_HAZARD_WIDTH = 150;

export const FRONT_TILE_HEIGHT = 1500;
export const HORIZON_Y_VAL = GROUND_Y + 110;
export const SURFACE_STEP_PX = 8;
