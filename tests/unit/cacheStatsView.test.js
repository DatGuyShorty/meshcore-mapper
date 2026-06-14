import { describe, expect, it } from 'vitest';
import { CACHE_UNAVAILABLE_TEXT, formatCacheStats } from '../../src/cacheStatsView.js';

describe('cache stats view', () => {
  it('formats cache counts for the settings panel', () => {
    expect(formatCacheStats({
      elevations: 1234,
      demTiles: 2,
      foliage: 5,
      buildings: 6,
      sizeKb: 77,
    })).toBe('Cache: 1,234 elevations, 2 DEM tiles, 5 foliage, 6 buildings, 77 KB');
  });

  it('normalizes missing, invalid, and negative counts to zero', () => {
    expect(formatCacheStats({
      elevations: 'bad',
      demTiles: null,
      foliage: -1,
      buildings: undefined,
      sizeKb: 0,
    })).toBe('Cache: 0 elevations, 0 DEM tiles, 0 foliage, 0 buildings, 0 KB');
  });

  it('exposes the unavailable fallback text', () => {
    expect(CACHE_UNAVAILABLE_TEXT).toBe('Cache: unavailable');
  });
});
