import { describe, expect, it } from 'vitest';
import {
  buildElevationGridPoints,
  coverageBbox,
  elevationGridShape,
  unionBbox,
} from '../../src/coverageGrid.js';

describe('coverage grid helpers', () => {
  it('builds reusable coverage bounds and unions', () => {
    const a = coverageBbox({ lat: 48, lon: 17 }, 1);
    const b = coverageBbox({ lat: 48.01, lon: 17.02 }, 1);
    const union = unionBbox([a, b]);

    expect(union.latMin).toBeLessThan(a.latMax);
    expect(union.latMax).toBeGreaterThan(b.latMin);
    expect(union.lonMin).toBeLessThan(a.lonMax);
    expect(union.lonMax).toBeGreaterThan(b.lonMin);
  });

  it('keeps coverage bounds finite near the poles', () => {
    const bbox = coverageBbox({ lat: 90, lon: 18 }, 10);

    expect(bbox.latMax).toBe(90);
    expect(bbox.latMin).toBeLessThan(90);
    expect(bbox.lonMin).toBe(-180);
    expect(bbox.lonMax).toBe(180);
  });

  it('builds elevation grid points in row-major north-to-south order', () => {
    const points = buildElevationGridPoints({
      latMin: 10,
      latMax: 12,
      lonMin: 20,
      lonMax: 22,
      ELEV_RES: 2,
    });

    expect(points).toEqual([
      { latitude: 12, longitude: 20 },
      { latitude: 12, longitude: 22 },
      { latitude: 10, longitude: 20 },
      { latitude: 10, longitude: 22 },
    ]);
  });

  it('keeps elevation grid shape capped for high detail coverage', () => {
    expect(elevationGridShape(512, 20)).toEqual({
      elevTargetM: 50,
      ELEV_RES: 512,
    });
  });
});
