/**
 * Crash math — TypeScript port of apps/math-sdk/src/golf_crash_math.
 * Keep this file in lockstep with the Python implementation. Same constants,
 * same formula, same RNG → identical results for the same seed.
 */

export const HOUSE_EDGE = 0.02;
export const MAX_CRASH = 1_000_000;
/** Ordinary crash rounds — keep hole-in-one (`JACKPOT_MULT`) visually/economically supreme. */
export const NORMAL_CRASH_MULTIPLIER_CAP = 1000;
export const JACKPOT_MULT = 2000;
/** P(hole-in-one | survived pre-shot): ~1 in 1 000 000 (sync with `apps/math-sdk`). */
export const JACKPOT_PROB = 1e-6;
export const GROWTH_C = 0.08;
export const GROWTH_K = 1.6;

export const PRE_SHOT_PROBS = {
  mole: 0.005,
  clubBreak: 0.005,
  selfHit: 0.005,
} as const;

/** In-flight hazard weights — must match `apps/math-sdk/src/golf_crash_math/events.py` / `round._pick_crash_cause`. */
export const IN_FLIGHT_EVENT_PROBS = {
  bird: 0.05,
  wind: 0.05,
  helicopter: 0.02,
  plane: 0.01,
  cart: 0.02,
  fakeBoost: 0.02,
} as const;

export type Seed = {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
};

export type PreShotFail = "mole" | "clubBreak" | "selfHit";
export type DecorativeKind = "bird" | "wind" | "helicopter" | "plane" | "cart";
export type CrashCause = DecorativeKind | "landed" | "fakeBoost";
export type RoundOutcomeKind = "preShotFail" | "holeInOne" | "crash";
export type LandingZone = "fairway" | "sand" | "water" | "cart" | "hole";

export type DecorativeEvent = { kind: DecorativeKind; atSec: number };

export type RoundPlan = {
  roundId: string;
  seed: Seed;
  serverSeedHash: string;
  finalMultiplier: number;
  outcome: RoundOutcomeKind;
  landingZone: LandingZone;
  crashMultiplier: number;
  crashAtSec: number;
  preShotFail: PreShotFail | null;
  crashCause: CrashCause | null;
  decorativeEvents: DecorativeEvent[];
};

const enc = new TextEncoder();

const toArrayBuffer = (u: Uint8Array): ArrayBuffer => {
  const buf = new ArrayBuffer(u.byteLength);
  new Uint8Array(buf).set(u);
  return buf;
};

const hmacSha256 = async (keyBytes: Uint8Array, msg: Uint8Array): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, toArrayBuffer(msg));
  return new Uint8Array(sig);
};

const hmacStream = (seed: Seed, cursor: number): Promise<Uint8Array> => {
  const message = enc.encode(`${seed.clientSeed}:${seed.nonce}:${cursor}`);
  const key = enc.encode(seed.serverSeed);
  return hmacSha256(key, message);
};

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const sha256Hex = async (value: string): Promise<string> => {
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(value));
  return toHex(new Uint8Array(hash));
};

const roundIdFromSeed = async (seed: Seed): Promise<string> =>
  `round-${(await sha256Hex(`${seed.serverSeed}:${seed.clientSeed}:${seed.nonce}`)).slice(0, 16)}`;

export const floats = async (seed: Seed, count: number): Promise<number[]> => {
  const out: number[] = [];
  let cursor = 0;
  while (out.length < count) {
    const digest = await hmacStream(seed, cursor);
    for (let i = 0; i + 4 <= digest.length && out.length < count; i += 4) {
      const v =
        (digest[i]! * 0x1_00_00_00 +
          digest[i + 1]! * 0x1_00_00 +
          digest[i + 2]! * 0x1_00 +
          digest[i + 3]!) /
        0x1_00_00_00_00;
      out.push(v);
    }
    cursor += 1;
  }
  return out;
};

export const crashFromUniform = (u: number, houseEdge = HOUSE_EDGE): number => {
  if (u < 0 || u >= 1) throw new RangeError(`u must be in [0,1), got ${u}`);
  if (u < houseEdge) return 1.0;
  const rescaled = (u - houseEdge) / (1 - houseEdge);
  if (rescaled >= 1) return MAX_CRASH;
  const raw = 1 / (1 - rescaled);
  const crash = Math.floor(raw * 100) / 100;
  return Math.min(Math.max(crash, 1.0), MAX_CRASH);
};

export const multiplierAt = (elapsedSec: number): number => {
  if (elapsedSec <= 0) return 1;
  return 1 + GROWTH_C * Math.pow(elapsedSec, GROWTH_K);
};

export const timeForMultiplier = (mult: number): number => {
  if (mult <= 1) return 0;
  return Math.pow((mult - 1) / GROWTH_C, 1 / GROWTH_K);
};

const clampVisualCrashTime = (raw: number): number => {
  if (raw <= 0) return 1;
  return Math.min(7.5, Math.max(1, raw));
};

const pickPreShotFail = (u: number): PreShotFail | null => {
  let cum = 0;
  for (const [kind, p] of [
    ["mole", PRE_SHOT_PROBS.mole],
    ["clubBreak", PRE_SHOT_PROBS.clubBreak],
    ["selfHit", PRE_SHOT_PROBS.selfHit],
  ] as const) {
    cum += p;
    if (u < cum) return kind;
  }
  return null;
};

const pickCrashCause = (u: number): CrashCause => {
  let cum = 0;
  const weighted: [CrashCause, number][] = [
    ["bird", IN_FLIGHT_EVENT_PROBS.bird],
    ["wind", IN_FLIGHT_EVENT_PROBS.wind],
    ["helicopter", IN_FLIGHT_EVENT_PROBS.helicopter],
    ["plane", IN_FLIGHT_EVENT_PROBS.plane],
    ["cart", IN_FLIGHT_EVENT_PROBS.cart],
    ["fakeBoost", IN_FLIGHT_EVENT_PROBS.fakeBoost],
  ];
  for (const [cause, p] of weighted) {
    cum += p;
    if (u < cum) return cause;
  }
  return "landed";
};

const pickLandingZone = (u: number, cause: CrashCause): LandingZone => {
  if (cause === "cart") return "cart";
  if (cause === "fakeBoost") return "water";
  if (u < 0.55) return "fairway";
  if (u < 0.78) return "sand";
  return "water";
};

const scheduleDecorative = (
  rolls: number[],
  crashT: number,
  crashMultV: number,
): DecorativeEvent[] => {
  const out: DecorativeEvent[] = [];
  if (crashT <= 0.4) return out;

  const optionsForProgress = (progress: number): DecorativeKind[] => {
    if (crashMultV < 1.75) return ["cart", "wind", "bird"];
    if (progress < 0.25) return ["cart", "wind", "bird"];
    if (progress < 0.65) return ["wind", "bird", "helicopter"];
    return ["bird", "helicopter", "plane"];
  };

  let cursor = 0;
  const reach = Math.max(
    0.22,
    Math.min(1, Math.log(Math.max(1, crashMultV)) / Math.log(25)),
  );
  const maxEvents = Math.min(3, Math.max(1, Math.floor((crashT / 1.35) * reach)));
  for (let slot = 0; slot < maxEvents; slot++) {
    const progress = (slot + 1) / (maxEvents + 1);
    const baseT = crashT * progress;
    if (baseT >= crashT - 0.2) break;
    if (cursor + 1 >= rolls.length) break;
    const jitter = rolls[cursor]!;
    const pick = rolls[cursor + 1]!;
    cursor += 2;
    const t = Math.min(crashT - 0.2, baseT + (jitter - 0.5) * 0.35);
    const options = optionsForProgress(progress);
    out.push({
      kind: options[Math.min(options.length - 1, Math.floor(pick * options.length))]!,
      atSec: t,
    });
  }
  return out;
};

export const generatePlan = async (seed: Seed): Promise<RoundPlan> => {
  const rolls = await floats(seed, 32);
  const roundId = await roundIdFromSeed(seed);
  const serverSeedHash = await sha256Hex(seed.serverSeed);

  const preShotFail = pickPreShotFail(rolls[0]!);
  if (preShotFail !== null) {
    return {
      roundId,
      seed,
      serverSeedHash,
      finalMultiplier: 0,
      outcome: "preShotFail",
      landingZone: "water",
      crashMultiplier: 1,
      crashAtSec: 0,
      preShotFail,
      crashCause: null,
      decorativeEvents: [],
    };
  }

  if (rolls[1]! < JACKPOT_PROB) {
    const crashT = clampVisualCrashTime(timeForMultiplier(JACKPOT_MULT));
    return {
      roundId,
      seed,
      serverSeedHash,
      finalMultiplier: JACKPOT_MULT,
      outcome: "holeInOne",
      landingZone: "hole",
      crashMultiplier: JACKPOT_MULT,
      crashAtSec: crashT,
      preShotFail: null,
      crashCause: null,
      decorativeEvents: scheduleDecorative(rolls.slice(8), crashT, JACKPOT_MULT),
    };
  }

  const crashMultiplier = Math.min(crashFromUniform(rolls[2]!), NORMAL_CRASH_MULTIPLIER_CAP);
  const crashCause = pickCrashCause(rolls[3]!);
  const landingZone = pickLandingZone(rolls[4]!, crashCause);
  void rolls[5];
  void rolls[6];
  void rolls[7];
  const crashAtSec = clampVisualCrashTime(timeForMultiplier(crashMultiplier));
  return {
    roundId,
    seed,
    serverSeedHash,
    finalMultiplier: crashMultiplier,
    outcome: "crash",
    landingZone,
    crashMultiplier,
    crashAtSec,
    preShotFail: null,
    crashCause,
    decorativeEvents: scheduleDecorative(rolls.slice(8), crashAtSec, crashMultiplier),
  };
};

export const randomSeed = (): Seed => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return {
    serverSeed: hex.slice(0, 16),
    clientSeed: hex.slice(16, 32),
    nonce: 0,
  };
};
