import { describe, expect, it } from 'vitest';
import { buildGrid, optimizerNeedsTerrain } from '../../src/optimizer.js';

describe('optimizer terrain requirements', () => {
  it('loads terrain when any terrain-aware propagation effect is enabled', () => {
    expect(optimizerNeedsTerrain({ useLos: true })).toBe(true);
    expect(optimizerNeedsTerrain({ useFoliage: true })).toBe(true);
    expect(optimizerNeedsTerrain({ useBuildings: true })).toBe(true);
  });

  it('skips terrain only for pure free-space scoring', () => {
    expect(optimizerNeedsTerrain({
      useLos: false,
      useFoliage: false,
      useBuildings: false,
    })).toBe(false);
  });

  it('builds finite grids even when resolution is too low', () => {
    expect(buildGrid(10, 11, 20, 21, 0)).toEqual([
      { latitude: 11, longitude: 20 },
    ]);
    expect(buildGrid(10, 11, 20, 21, 1)).toEqual([
      { latitude: 11, longitude: 20 },
    ]);
  });
});
