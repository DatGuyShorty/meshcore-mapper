import { describe, expect, it } from 'vitest';
import { createCoverageStore } from '../../src/coverageStore.js';

describe('coverage store', () => {
  it('tracks coverage overlay layers and result metadata', () => {
    const store = createCoverageStore();
    const layers = [{ id: 'overlay-a' }];
    const results = [{ layerId: 'layer-a' }];

    store.setCoverageLayers(layers);
    store.setCoverageResults(results);

    expect(store.getCoverageLayers()).toBe(layers);
    expect(store.getCoverageResults()).toBe(results);

    store.clear();
    expect(store.getCoverageLayers()).toEqual([]);
    expect(store.getCoverageResults()).toEqual([]);
  });

  it('normalizes non-array assignments to empty arrays', () => {
    const store = createCoverageStore();

    store.setCoverageLayers(null);
    store.setCoverageResults(null);

    expect(store.getCoverageLayers()).toEqual([]);
    expect(store.getCoverageResults()).toEqual([]);
  });
});
