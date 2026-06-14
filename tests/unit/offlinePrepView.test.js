import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OFFLINE_PREP_READINESS,
  formatOfflinePrepArea,
  formatOfflinePrepReadiness,
  normalizeOfflinePrepArea,
  offlinePrepReadinessRows,
  offlinePrepSummary,
} from '../../src/offlinePrepView.js';

describe('offline prep view helpers', () => {
  it('normalizes valid viewport bounds', () => {
    expect(normalizeOfflinePrepArea({
      latMin: '48.1',
      latMax: '48.2',
      lonMin: '18.1',
      lonMax: '18.2',
    })).toEqual({
      latMin: 48.1,
      latMax: 48.2,
      lonMin: 18.1,
      lonMax: 18.2,
    });
  });

  it('rejects invalid or inverted bounds', () => {
    expect(normalizeOfflinePrepArea({ latMin: 2, latMax: 1, lonMin: 0, lonMax: 1 })).toBeNull();
    expect(normalizeOfflinePrepArea({ latMin: 1, latMax: 2, lonMin: 4, lonMax: 4 })).toBeNull();
    expect(normalizeOfflinePrepArea(null)).toBeNull();
  });

  it('formats selected and missing areas', () => {
    expect(formatOfflinePrepArea(null)).toBe('Area: choose current viewport');
    expect(formatOfflinePrepArea({
      latMin: 48.1,
      latMax: 48.2,
      lonMin: 18.1,
      lonMax: 18.2,
    })).toBe('Area: 48.10000 to 48.20000 lat, 18.10000 to 18.20000 lon');
  });

  it('renders readiness rows by data type', () => {
    expect(offlinePrepReadinessRows({
      terrain: 'ready',
      foliage: 'warning',
      buildings: 'running',
      mapTiles: 'skipped',
    })).toEqual([
      { label: 'Terrain DEM', value: 'ready' },
      { label: 'Foliage', value: 'needs internet' },
      { label: 'Buildings', value: 'preparing' },
      { label: 'Map tiles', value: 'online only' },
    ]);
  });

  it('formats a compact summary for the settings panel', () => {
    expect(formatOfflinePrepReadiness(DEFAULT_OFFLINE_PREP_READINESS)).toBe(
      'Terrain DEM: needs prep | Foliage: needs prep | Buildings: needs prep | Map tiles: online only'
    );
    expect(offlinePrepSummary(null, DEFAULT_OFFLINE_PREP_READINESS)).toContain('Area: choose current viewport');
  });
});
