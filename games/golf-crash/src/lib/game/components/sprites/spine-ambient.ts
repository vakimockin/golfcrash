import { Spine } from "@esotericsoftware/spine-pixi-v8";
import type { Container } from "pixi.js";

/** `node.label` for ambient Spine flocks — read in `directionalSpriteKind`. */
export const AMBIENT_SPINE_BIRD_LABEL = "ambient-spine-bird";
export const AMBIENT_SPINE_DUCK_LABEL = "ambient-spine-duck";

/** Planned crash hazards (not ambient) — read in `directionalSpriteKind`. */
export const HAZARD_SPINE_BIRD_LABEL = "hazard-spine-bird";
export const HAZARD_SPINE_UFO_LABEL = "hazard-spine-ufo";

const DUCK_LOOPS_PRIMARY = ["ver_1/loop", "ver_2/loop", "ver3/loop"] as const;
const DUCK_LOOPS_ALT = ["ver_1/loop3", "ver_2/loop4", "ver3/loop2"] as const;

/** Pick a flock “variant” loop; `duck2` uses the alternate numbered loops. */
export const pickAmbientDuckLoop = (flockAlias: "duck" | "duck2"): string => {
  const pool = flockAlias === "duck2" ? DUCK_LOOPS_ALT : DUCK_LOOPS_PRIMARY;
  return pool[Math.floor(Math.random() * pool.length)]!;
};

export const spawnSpineAmbient = (
  parent: Container,
  opts: {
    skeleton: string;
    atlas: string;
    animation: string;
    x: number;
    y: number;
    alpha: number;
    flip: boolean;
    targetWidth: number;
    label: typeof AMBIENT_SPINE_BIRD_LABEL | typeof AMBIENT_SPINE_DUCK_LABEL;
  },
): Spine => {
  const spine = Spine.from({ skeleton: opts.skeleton, atlas: opts.atlas });
  spine.label = opts.label;
  spine.x = opts.x;
  spine.y = opts.y;
  spine.alpha = opts.alpha;
  spine.state.setAnimation(0, opts.animation, true);
  spine.update(0);
  const b = spine.getBounds();
  const w = Math.max(1, b.width);
  const scale = opts.targetWidth / w;
  spine.scale.set(opts.flip ? -scale : scale, scale);
  parent.addChild(spine);
  return spine;
};

export const spawnSpineIdleAmbient = (
  parent: Container,
  opts: {
    skeleton: string;
    atlas: string;
    animation: string;
    x: number;
    y: number;
    alpha: number;
    flip: boolean;
    targetWidth: number;
  },
): Spine => {
  const spine = Spine.from({ skeleton: opts.skeleton, atlas: opts.atlas });
  spine.x = opts.x;
  spine.y = opts.y;
  spine.alpha = opts.alpha;
  spine.state.setAnimation(0, opts.animation, true);
  spine.update(0);
  const b = spine.getBounds();
  const w = Math.max(1, b.width);
  const scale = opts.targetWidth / w;
  spine.scale.set(opts.flip ? -scale : scale, scale);
  parent.addChild(spine);
  return spine;
};

/** Scripted round hazards that use Spine exports from `/assets/animations/*` (bird, UFO). */
export const spawnPlannedHazardSpine = (
  parent: Container,
  opts: {
    kind: "bird" | "fakeBoost";
    goldenBird: boolean;
    x: number;
    y: number;
    alpha: number;
    /** Initial horizontal mirror; `faceSpriteDirection` may adjust each frame. */
    flip: boolean;
    targetWidth: number;
  },
): Spine => {
  const isBird = opts.kind === "bird";
  const skeleton = isBird
    ? opts.goldenBird
      ? "spineGoldenBirdJson"
      : "spineBirdJson"
    : "spineUfoJson";
  const atlas = isBird
    ? opts.goldenBird
      ? "spineGoldenBirdAtlas"
      : "spineBirdAtlas"
    : "spineUfoAtlas";
  const animation = isBird ? "loop" : "idle";
  const label = isBird ? HAZARD_SPINE_BIRD_LABEL : HAZARD_SPINE_UFO_LABEL;

  const spine = Spine.from({ skeleton, atlas });
  spine.label = label;
  spine.x = opts.x;
  spine.y = opts.y;
  spine.alpha = opts.alpha;
  spine.state.setAnimation(0, animation, true);
  spine.update(0);
  const b = spine.getBounds();
  const w = Math.max(1, b.width);
  const scale = opts.targetWidth / w;
  spine.scale.set(opts.flip ? -scale : scale, scale);
  parent.addChild(spine);
  return spine;
};

const SHEIKH_SPINE_REF_HEIGHT = 357;

export const placeSheikhOnTee = (
  spine: Spine,
  x: number,
  y: number,
  scaleMul = 0.42,
): void => {
  spine.x = x;
  spine.y = y;
  spine.state.setAnimation(0, "idle", true);
  spine.update(0);
  const b = spine.getBounds();
  const s = (SHEIKH_SPINE_REF_HEIGHT * scaleMul) / Math.max(1, b.height);
  spine.scale.set(s);
};

/** One-shot: return to `idle` loop when `swing` finishes. */
export const attachSheikhSwingComplete = (spine: Spine): void => {
  spine.state.addListener({
    complete: (entry) => {
      if (entry.animation?.name !== "swing") return;
      spine.state.setAnimation(0, "idle", true);
    },
  });
};

/** Locomotion: current sheikh export (`sheikh.json`) has `idle` + `swing` only — no `run` clip yet. */
export const setSheikhLocomotion = (
  spine: Spine,
  mode: "idle" | "run",
  loop: boolean,
): void => {
  const hasRun = !!spine.skeleton.data.findAnimation("run");
  const name = mode === "run" && hasRun ? "run" : "idle";
  spine.state.setAnimation(0, name, loop);
};
