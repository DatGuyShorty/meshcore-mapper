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

  it('can return an opt-in signal loss breakdown', () => {
    const result = computeSignalToPoint({
      tx: {
        lat: 0,
        lon: 0,
        height: 10,
        power: 20,
        gain: 2,
        freq: 868,
      },
      txElev: 0,
      rxLat: 0,
      rxLon: 0.01,
      rxHeight: 1.5,
      effectiveSens: -133,
      useLos: false,
      includeBreakdown: true,
    });

    const expectedPathLoss = 20 * Math.log10(result.distM) + fsplBaseDb(868);
    expect(result.breakdown).toBeDefined();
    expect(result.breakdown.pathLossDb).toBeCloseTo(expectedPathLoss, 6);
    expect(result.breakdown.diffractionLossDb).toBe(0);
    expect(result.breakdown.foliageLossDb).toBe(0);
    expect(result.breakdown.buildingLossDb).toBe(0);
    expect(result.breakdown.reflectionGainDb).toBe(0);
  });

  it('applies the six-ray reflection model during clear-LoS point calculations', () => {
    const baseArgs = {
      tx: {
        lat: 0,
        lon: 0,
        height: 20,
        power: 20,
        gain: 2,
        freq: 868,
      },
      txElev: 0,
      rxLat: 0,
      rxLon: 0.01,
      rxHeight: 2,
      effectiveSens: -133,
      useLos: true,
      useFresnel: false,
      useGroundReflection: true,
      reflectionCoeff: 0.7,
      elevGrid: new Float32Array([0, 0, 0, 0]),
      elevRes: 2,
      bounds: { latMin: -0.01, latMax: 0.01, lonMin: -0.01, lonMax: 0.02 },
    };

    const twoRay = computeSignalToPoint({ ...baseArgs, reflectionModel: 'two-ray' });
    const sixRay = computeSignalToPoint({
      ...baseArgs,
      reflectionModel: 'six-ray',
      sideReflectionCoeff: 0.35,
      reflectionCorridorWidthM: 24,
    });

    expect(twoRay.los?.geometricLos).toBe(true);
    expect(sixRay.rxPower).not.toBeCloseTo(twoRay.rxPower, 1);
    expect(Number.isFinite(sixRay.rxPower)).toBe(true);
  });

  it('uses real building facades as specular reflectors in facade mode', () => {
    const building = [[0.001, 0.003], [0.001, 0.007], [0.002, 0.007], [0.002, 0.003]];
    const baseArgs = {
      tx: {
        lat: 0,
        lon: 0,
        height: 8,
        power: 20,
        gain: 0,
        freq: 868,
      },
      txElev: 0,
      rxLat: 0,
      rxLon: 0.01,
      rxHeight: 8,
      effectiveSens: -133,
      useLos: true,
      useFresnel: false,
      useGroundReflection: true,
      reflectionCoeff: 0,
      sideReflectionCoeff: 0,
      elevGrid: new Float32Array([0, 0, 0, 0]),
      elevRes: 2,
      bounds: { latMin: -0.001, latMax: 0.003, lonMin: -0.001, lonMax: 0.011 },
      buildings: {
        polygons: [building],
        bboxes: [{ latMin: 0.001, latMax: 0.002, lonMin: 0.003, lonMax: 0.007 }],
        heights: [20],
        tileIndex: null,
      },
      applyBuildingLoss: false,
    };

    const directOnly = computeSignalToPoint({ ...baseArgs, reflectionModel: 'facade' });
    const reflected = computeSignalToPoint({
      ...baseArgs,
      reflectionModel: 'facade',
      sideReflectionCoeff: 0.5,
    });

    expect(reflected.los?.geometricLos).toBe(true);
    expect(Number.isFinite(reflected.rxPower)).toBe(true);
    expect(Math.abs(reflected.rxPower - directOnly.rxPower)).toBeGreaterThan(0.05);
  });

  it('applies building attenuation inside facade-mode coherent paths', () => {
    const blocker = [[-0.0005, 0.004], [-0.0005, 0.006], [0.0005, 0.006], [0.0005, 0.004]];
    const baseArgs = {
      tx: {
        lat: 0,
        lon: 0,
        height: 8,
        power: 20,
        gain: 0,
        freq: 868,
      },
      txElev: 0,
      rxLat: 0,
      rxLon: 0.01,
      rxHeight: 8,
      effectiveSens: -133,
      useLos: true,
      useFresnel: false,
      useGroundReflection: true,
      reflectionModel: 'facade',
      reflectionCoeff: 0,
      sideReflectionCoeff: 0,
      elevGrid: new Float32Array([0, 0, 0, 0]),
      elevRes: 2,
      bounds: { latMin: -0.001, latMax: 0.001, lonMin: -0.001, lonMax: 0.011 },
      buildings: {
        polygons: [blocker],
        bboxes: [{ latMin: -0.0005, latMax: 0.0005, lonMin: 0.004, lonMax: 0.006 }],
        heights: [20],
        tileIndex: null,
      },
      buildingLossPerM: 0.5,
    };

    const withoutBuildingLoss = computeSignalToPoint({ ...baseArgs, applyBuildingLoss: false });
    const withBuildingLoss = computeSignalToPoint({ ...baseArgs, applyBuildingLoss: true });

    expect(withBuildingLoss.rxPower).toBeLessThan(withoutBuildingLoss.rxPower - 10);
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
