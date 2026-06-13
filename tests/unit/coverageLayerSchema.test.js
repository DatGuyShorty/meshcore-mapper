import { describe, expect, it } from 'vitest';
import {
  parseCoverageLayerPref,
  parseCoverageLayerPrefs,
  parseCoverageLayerRecord,
} from '../../src/coverageLayerSchema.js';

describe('coverage layer schema helpers', () => {
  it('accepts records with non-empty layer ids and trims the id', () => {
    expect(parseCoverageLayerRecord({ layerId: ' layer-1 ', gridRes: 2 })).toEqual({
      layerId: 'layer-1',
      gridRes: 2,
    });
    expect(parseCoverageLayerRecord({ layerId: '' })).toBeNull();
    expect(parseCoverageLayerRecord(null)).toBeNull();
  });

  it('sanitizes preference fields', () => {
    expect(parseCoverageLayerPref({
      opacity: 2,
      visible: false,
      label: 'x'.repeat(200),
    })).toEqual({
      opacity: 1,
      visible: false,
      label: 'x'.repeat(120),
    });
    expect(parseCoverageLayerPref({ opacity: 0 })).toEqual({ opacity: 0.05 });
    expect(parseCoverageLayerPref({ visible: 'nope' })).toBeNull();
  });

  it('filters invalid preference maps', () => {
    expect(parseCoverageLayerPrefs({
      ' layer-1 ': { opacity: 0.5 },
      '': { opacity: 0.7 },
      'layer-2': { visible: true },
      'layer-3': 'bad',
    })).toEqual({
      'layer-1': { opacity: 0.5 },
      'layer-2': { visible: true },
    });
    expect(parseCoverageLayerPrefs(null)).toEqual({});
  });
});
