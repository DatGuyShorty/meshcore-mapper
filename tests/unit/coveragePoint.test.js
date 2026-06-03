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

  it('reports the stored grid value (heatmap source of truth) over a fresh recompute', () => {
    const result = makeCoverageResult(1, 'Gridded', 0, 0);
    // 2×2 grid over the bounds; clicking near (lat 0, lon 0.01) lands in the
    // south-east cell. Seed that cell with a clearly-good value the recompute
    // would never produce, to prove the grid wins.
    result.gridRes = 2;
    result.signalGrid = new Float32Array([
      -150, -150, // row 0 (north)
      -150, -70,  // row 1 (south): SE cell = -70 dBm
    ]);

    const rows = inspectCoverageAtPoint({ lat: -0.0001, lng: 0.0001 }, [result]);

    expect(rows).toHaveLength(1);
    expect(rows[0].rxPower).toBe(-70);
    expect(rows[0].margin).toBe(-70 - result.effectiveSens);
    expect(rows[0].snrDb).toBeCloseTo(-70 - result.noiseFloorDbm, 6);
  });

  it('falls back to the recomputed signal when no grid is stored', () => {
    const result = makeCoverageResult(1, 'NoGrid', 0, 0);
    const rows = inspectCoverageAtPoint({ lat: 0, lng: 0.01 }, [result]);

    expect(rows).toHaveLength(1);
    expect(rows[0].rxPower).toBeGreaterThan(result.threshold ?? result.effectiveSens);
    expect(Number.isFinite(rows[0].rxPower)).toBe(true);
  });

  it('returns no rows outside computed coverage radius', () => {
    const rows = inspectCoverageAtPoint({ lat: 0, lng: 0.5 }, [
      makeCoverageResult(1, 'Near', 0, 0),
    ]);

    expect(rows).toEqual([]);
  });

  it('ignores coverage results with invalid radius metadata', () => {
    const result = makeCoverageResult(1, 'Near', 0, 0);
    result.radiusKm = undefined;

    expect(inspectCoverageAtPoint({ lat: 0, lng: 0.01 }, [result])).toEqual([]);
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
