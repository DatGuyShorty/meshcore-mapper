export type CacheStatsSnapshot = {
  elevations?: unknown;
  demTiles?: unknown;
  foliage?: unknown;
  buildings?: unknown;
  sizeKb?: unknown;
};

export const CACHE_UNAVAILABLE_TEXT = 'Cache: unavailable';

export function formatCacheStats(stats: CacheStatsSnapshot): string {
  return `Cache: ${_count(stats?.elevations).toLocaleString()} elevations, `
    + `${_count(stats?.demTiles)} DEM tiles, `
    + `${_count(stats?.foliage)} foliage, `
    + `${_count(stats?.buildings)} buildings, `
    + `${_count(stats?.sizeKb)} KB`;
}

function _count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}
