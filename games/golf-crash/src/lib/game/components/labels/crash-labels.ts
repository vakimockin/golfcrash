import type { CrashCause, PreShotFail } from "../math/math.js";

export const PRE_SHOT_FAIL_LABEL: Record<PreShotFail, string> = {
  mole: "A MOLE STOLE THE BALL!",
  clubBreak: "CLUB SNAPPED!",
  selfHit: "OUCH! SELF HIT!",
};

export const CRASH_CAUSE_LABEL: Record<CrashCause, string> = {
  bird: "BIRD STRIKE!",
  wind: "GUST OF WIND!",
  helicopter: "HELICOPTER!",
  plane: "PLANE!",
  cart: "RUNAWAY CART!",
  landed: "SAFE LANDING",
  fakeBoost: "FAKE BOOST!",
};
