import { Assets, type Texture } from "pixi.js";

export type RoadProfileFromTexture = {
  width: number;
  height: number;
  top: number[];
  bottom: number[];
};

/** Filled when fairway silhouettes are stitched; used by procedural terrain. */
export const sampledSurfaceBands: {
  top: Float32Array | null;
  bottom: Float32Array | null;
} = { top: null, bottom: null };

const roadProfileCache = new Map<string, RoadProfileFromTexture>();

const smoothProfile = (values: number[], fallback: number): number[] => {
  const out = [...values];
  let last = fallback;
  for (let i = 0; i < out.length; i += 1) {
    if (Number.isFinite(out[i]!) && out[i]! >= 0) last = out[i]!;
    else out[i] = last;
  }
  last = fallback;
  for (let i = out.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(out[i]!) && out[i]! >= 0) last = out[i]!;
    else out[i] = last;
  }
  return out;
};

export const readRoadProfileFromTexture = (alias: string): RoadProfileFromTexture => {
  const cached = roadProfileCache.get(alias);
  if (cached) return cached;

  const texture = Assets.get(alias) as Texture;
  const width = Math.max(1, Math.round(texture.width || 1));
  const height = Math.max(1, Math.round(texture.height || 1));
  const fallback: RoadProfileFromTexture = {
    width,
    height,
    top: new Array(width).fill(Math.round(height * 0.28)),
    bottom: new Array(width).fill(Math.round(height * 0.87)),
  };

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    roadProfileCache.set(alias, fallback);
    return fallback;
  }
  try {
    const source = texture.source as { resource?: unknown } | undefined;
    const src = source?.resource ?? source;
    const drawable =
      src &&
      (typeof src === "object" && "width" in src
        ? (src as CanvasImageSource)
        : src instanceof ImageBitmap
          ? src
          : src instanceof HTMLImageElement
            ? src
            : src instanceof HTMLCanvasElement
              ? src
              : null);
    if (!drawable) {
      console.warn(`[surface] no drawable source for ${alias}`);
      roadProfileCache.set(alias, fallback);
      return fallback;
    }
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(drawable, 0, 0, width, height);
  } catch (error) {
    console.warn(`[surface] drawImage/get source failed for ${alias}`, error);
    roadProfileCache.set(alias, fallback);
    return fallback;
  }
  let pixels: Uint8ClampedArray;
  try {
    pixels = ctx.getImageData(0, 0, width, height).data;
  } catch (error) {
    console.warn(`[surface] getImageData failed for ${alias}`, error);
    roadProfileCache.set(alias, fallback);
    return fallback;
  }
  const top = new Array<number>(width).fill(-1);
  const bottom = new Array<number>(width).fill(-1);

  for (let x = 0; x < width; x += 1) {
    let t = -1;
    let b = -1;
    for (let y = 0; y < height; y += 1) {
      const idx = (y * width + x) * 4;
      const a = pixels[idx + 3]!;
      if (a < 12) continue;
      const isRoadLike = y > height * 0.18 && a > 20;
      if (!isRoadLike) continue;
      if (t < 0) t = y;
      b = y;
    }
    if (t < 0) {
      for (let y = 0; y < height; y += 1) {
        const idx = (y * width + x) * 4;
        const a = pixels[idx + 3]!;
        if (a < 12) continue;
        if (t < 0) t = y;
        b = y;
        break;
      }
    }
    top[x] = t;
    bottom[x] = b;
  }

  const profile: RoadProfileFromTexture = {
    width,
    height,
    top: smoothProfile(top, Math.round(height * 0.28)),
    bottom: smoothProfile(bottom, Math.round(height * 0.87)),
  };
  roadProfileCache.set(alias, profile);
  return profile;
};
