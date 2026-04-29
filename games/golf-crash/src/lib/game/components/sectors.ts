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

export const randomInSector = (sector: Sector, pad = 0): number => {
  const from = sector.startX + pad;
  const to = sector.endX - pad;
  if (to <= from) return sector.centerX;
  return from + Math.random() * (to - from);
};
