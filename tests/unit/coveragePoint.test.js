import { describe, expect, it } from 'vitest';
import { inspectCoverageAtPoint } from '../../src/coveragePoint.js';

describe('coverage point inspection', () => {
  it('returns point signal details sorted by strongest margin', () => {
    const near = makeCoverageResult(1, 'Near', 0, 0);
    const far = makeCoverageResult(2, 'Far', 0, 0.08);

    const rows = inspectCoverageAtPoint({ lat: 0, lng: 0.01 }, [far, near]);

    expect(rows).toHaveLength(2);
    expect(rows[0].repName).toBe('Near');
    expect(rows[0].margin).toBeGreaterThan(rows[1].margin);
    expect(rows[0].rxPower).toBeGreaterThan(rows[0].threshold);
    expect(rows[0].snrDb).toBeCloseTo(rows[0].rxPower + 115.5, 1);
    expect(rows[0].requiredSnrDb).toBe(-17.5);
  });

  it('returns no rows outside computed coverage radius', () => {
    const rows = inspectCoverageAtPoint({ lat: 0, lng: 0.5 }, [
      makeCoverageResult(1, 'Near', 0, 0),
    ]);

    expect(rows).toEqual([]);
  });

  function makeCoverageResult(id, name, lat, lon) {
    return {
      rep: {
        id,
        name,
        lat,
        lon,
        height: 10,
        power: 20,
        freq: 868,
        gain: 2,
      },
      bounds: {
        latMin: -1,
        latMax: 1,
        lonMin: -1,
        lonMax: 1,
      },
      radiusKm: 20,
      rxHeight: 1.5,
      effectiveSens: -133,
      noiseFloorDbm: -115.5,
      requiredSnrWithMarginDb: -17.5,
      useLos: false,
      useFresnel: false,
      diffractionModel: 'deygout',
      txElev: 0,
      elevGrid: new Float32Array(4),
      elevRes: 2,
      foliage: null,
      buildings: null,
      profileTargetSpacingM: 50,
      profileMaxSamples: 16,
    };
  }
});
