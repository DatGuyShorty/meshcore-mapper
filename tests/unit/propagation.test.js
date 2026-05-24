import { describe, expect, it } from 'vitest';
import { fspl, pointInPolygon, profileSampleCount } from '../../src/propagation.js';
import { foliageLossDb, weissbergerFoliageLossDb } from '../../src/foliage.js';

describe('propagation math', () => {
  it('computes FSPL at a known LoRa-scale distance', () => {
    expect(fspl(1000, 868)).toBeCloseTo(91.21, 1);
  });

  it('clamps profile sample counts to the requested bounds', () => {
    expect(profileSampleCount(0, 50, 16, 512)).toBe(16);
    expect(profileSampleCount(100000, 1, 16, 512)).toBe(512);
  });

  it('detects points inside simple lat/lon polygons', () => {
    const square = [[0, 0], [0, 1], [1, 1], [1, 0]];
    expect(pointInPolygon(0.5, 0.5, square)).toBe(true);
    expect(pointInPolygon(1.5, 0.5, square)).toBe(false);
  });

  it('caps long forest crossings with a sublinear vegetation model', () => {
    const profileLats = new Float64Array([0, 0, 0, 0, 0, 0, 0]);
    const profileLons = new Float64Array([0, 0.00045, 0.0009, 0.00135, 0.0018, 0.00225, 0.0027]);
    const profileElevs = new Float32Array(profileLats.length).fill(100);
    const forest = [[-1, -1], [-1, 1], [1, 1], [1, -1]];

    const loss = foliageLossDb(
      profileLats, profileLons, profileElevs,
      1.5, 1.5,
      [forest], [{ latMin: -1, latMax: 1, lonMin: -1, lonMax: 1 }],
      [20], [1], null,
      300, 0.3, 868
    );

    expect(loss).toBeGreaterThan(25);
    expect(loss).toBeLessThan(45);
  });

  it('preserves low user-selected foliage loss below the vegetation cap', () => {
    expect(Math.min(300 * 0.05, weissbergerFoliageLossDb(868, 300))).toBeCloseTo(15, 1);
  });
});
