import { describe, expect, it } from 'vitest';
import {
  computeSignalToPoint,
  ensureProfileBuffers,
  fillTerrainProfile,
  flatDistanceM,
  fsplBaseDb,
} from '../../src/signalModel.js';

describe('signal model helpers', () => {
  it('computes flat distance and FSPL base terms', () => {
    expect(flatDistanceM(0, 0, 0, 0.01)).toBeCloseTo(1113.2, 1);
    expect(flatDistanceM(0, 179.9, 0, -179.9)).toBeGreaterThan(22000);
    expect(flatDistanceM(0, 179.9, 0, -179.9)).toBeLessThan(22500);
    expect(fsplBaseDb(868)).toBeCloseTo(31.21, 1);
  });

  it('fills terrain profiles from a bilinear elevation grid', () => {
    const buffers = ensureProfileBuffers(3);
    const grid = new Float32Array([
      100, 110,
      120, 130,
    ]);

    fillTerrainProfile(buffers, 3, 1, 0, 0, 1, grid, 2, {
      latMin: 0,
      latMax: 1,
      lonMin: 0,
      lonMax: 1,
    });

    expect(Array.from(buffers.elevs)).toEqual([100, 115, 130]);
    expect(Array.from(buffers.lats)).toEqual([1, 0.5, 0]);
    expect(Array.from(buffers.lons)).toEqual([0, 0.5, 1]);
  });

  it('applies directional antenna offsets to point signal calculations', () => {
    const result = computeSignalToPoint({
      tx: {
        lat: 0,
        lon: 0,
        height: 10,
        power: 20,
        gain: 5,
        freq: 868,
        pattern: 'sector90',
        azimuthDeg: 0,
      },
      txElev: 0,
      rxLat: 0,
      rxLon: 0.01,
      rxHeight: 1.5,
      rxGain: 2,
      rxPattern: 'sector90',
      rxAzimuthDeg: 270,
      effectiveSens: -123,
      useLos: false,
    });

    const expectedPathLoss = 20 * Math.log10(result.distM) + fsplBaseDb(868);
    expect(result.txPatternOffset).toBe(-10);
    expect(result.rxPatternOffset).toBe(0);
    expect(result.effectiveTxGain).toBe(-5);
    expect(result.effectiveRxGain).toBe(2);
    expect(result.rxPower).toBeCloseTo(20 - 5 + 2 - expectedPathLoss);
  });

  it('returns a safe no-coverage result for invalid signal inputs', () => {
    const result = computeSignalToPoint({
      tx: { lat: 95, lon: 0, height: 10, power: 20, freq: 868, gain: 0 },
      txElev: 0,
      rxLat: 0,
      rxLon: 0,
      rxHeight: 1.5,
      useLos: false,
    });

    expect(result.rxPower).toBe(-200);
    expect(result.distM).toBe(Infinity);
    expect(result.los).toBeNull();
  });
});
