import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLayerPrefs, writeLayerPref } from '../../src/coveragePersistence.js';

describe('coverage layer preferences', () => {
  const originalLocalStorage = globalThis.localStorage;
  let store;

  beforeEach(() => {
    store = new Map();
    globalThis.localStorage = {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => { store.set(key, String(value)); },
      removeItem: key => { store.delete(key); },
    };
  });

  afterEach(() => {
    globalThis.localStorage = originalLocalStorage;
  });

  it('persists labels without dropping other layer preferences', () => {
    writeLayerPref('layer-1', { visible: false, opacity: 0.4 });
    writeLayerPref('layer-1', { label: 'North ridge check' });

    expect(readLayerPrefs()).toEqual({
      'layer-1': {
        visible: false,
        opacity: 0.4,
        label: 'North ridge check',
      },
    });
  });

  it('sanitizes stored preference maps when reading', () => {
    store.set('meshcoreMapper_coverageLayerPrefs', JSON.stringify({
      ' layer-1 ': { opacity: 2, visible: false, label: 'x'.repeat(200) },
      'layer-2': { visible: 'bad' },
      '': { opacity: 0.5 },
    }));

    expect(readLayerPrefs()).toEqual({
      'layer-1': {
        opacity: 1,
        visible: false,
        label: 'x'.repeat(120),
      },
    });
  });
});
