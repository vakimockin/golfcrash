import type { CrashCause } from "../math/math.js";
import type { ObjectLayerId } from "../core/world-types.js";

/** Decorative mob layer matching each scripted crash flavour. */
export const CRASH_LAYER: Record<CrashCause, ObjectLayerId> = {
  cart: 0,
  wind: 1,
  bird: 1,
  helicopter: 2,
  plane: 3,
  timeout: 5,
  fakeBoost: 5,
};
