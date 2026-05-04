/** Horizontal slices for ambient mob X; 8 is enough granularity without stacking flocks. */
export const AMBIENT_MOB_SECTOR_COUNT = 8;

export type Sector = {
  id: number;
  startX: number;
  endX: number;
  centerX: number;
};

export const buildSectors = (worldW: number, count: number): Sector[] => {
  const safeCount = Math.max(1, count);
  const sectorW = worldW / safeCount;
  const sectors: Sector[] = [];
  for (let i = 0; i < safeCount; i += 1) {
    const startX = i * sectorW;
    const endX = i === safeCount - 1 ? worldW : (i + 1) * sectorW;
    sectors.push({
      id: i,
      startX,
      endX,
      centerX: (startX + endX) / 2,
    });
  }
  return sectors;
};

/** Split `[x0, x1]` into `count` columns (for spawns along the fairway, not full overscan). */
export const buildSectorsInSpan = (
  x0: number,
  x1: number,
  count: number,
): Sector[] => {
  const lo = Math.min(x0, x1);
  const hi = Math.max(x0, x1);
  const w = hi - lo;
  if (!(w > 0)) return buildSectors(1, count);
  return buildSectors(w, count).map((s) => ({
    ...s,
    startX: s.startX + lo,
    endX: s.endX + lo,
    centerX: s.centerX + lo,
  }));
};

export const randomInSector = (sector: Sector, pad = 0): number => {
  const from = sector.startX + pad;
  const to = sector.endX - pad;
  if (to <= from) return sector.centerX;
  return from + Math.random() * (to - from);
};

/** Round-robin shuffled sectors → spread `count` X samples without piling on one column. */
export const distributeAcrossSectors = (
  sectors: Sector[],
  count: number,
  pad = 60,
): number[] => {
  if (sectors.length === 0 || count <= 0) return [];
  const order = sectors.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const xs: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const sec = sectors[order[i % sectors.length]!]!;
    xs.push(randomInSector(sec, pad));
  }
  return xs;
};

/** Up to `k` different sectors (Fisher–Yates on indices). */
export const pickDistinctSectors = (sectors: Sector[], k: number): Sector[] => {
  if (sectors.length === 0 || k <= 0) return [];
  const idx = sectors.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  const take = Math.min(k, sectors.length);
  return idx.slice(0, take).map((i) => sectors[i]!);
};
