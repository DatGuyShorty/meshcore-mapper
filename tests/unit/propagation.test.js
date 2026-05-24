import { describe, expect, it } from 'vitest';
import { fspl, pointInPolygon, profileSampleCount } from '../../src/propagation.js';

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
});
