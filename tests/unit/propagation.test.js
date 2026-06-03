import { describe, expect, it, vi } from 'vitest';
import {
  antennaPatternOffsetDb,
  bearingDeg,
  bilinearElev,
  checkLoS,
  earthBulgeM,
  fspl,
  haversine,
  pointInPolygon,
  profileSampleCount,
  segmentPolygonIntervals,
  shadowFadingDb,
  sixRayReflectionGainDb,
  traceBuildingFacadeRays,
  twoRayReflectionGainDb,
  writePixel,
} from '../../src/propagation.js';
import { foliageLossDb, weissbergerFoliageLossDb } from '../../src/foliage.js';

describe('propagation math', () => {
  it('computes FSPL at a known LoRa-scale distance', () => {
    expect(fspl(1000, 868)).toBeCloseTo(91.21, 1);
  });

  describe('two-ray ground reflection', () => {
    it('returns 0 when disabled or geometry/frequency is invalid', () => {
      expect(twoRayReflectionGainDb(1000, 10, 2, 868, 0)).toBe(0);
      expect(twoRayReflectionGainDb(0, 10, 2, 868, 0.7)).toBe(0);
      expect(twoRayReflectionGainDb(1000, 10, 2, 0, 0.7)).toBe(0);
      expect(twoRayReflectionGainDb(1000, 10, 2, 868, Number.NaN)).toBe(0);
    });

    it('stays within the physical bound for the reflection coefficient', () => {
      const R = 0.7;
      const peak = 20 * Math.log10(1 + R); // constructive ceiling
      for (let d = 100; d <= 5000; d += 50) {
        const g = twoRayReflectionGainDb(d, 30, 2, 868, R);
        expect(g).toBeGreaterThanOrEqual(-20.001);
        expect(g).toBeLessThanOrEqual(peak + 0.001);
      }
    });

    it('is symmetric in TX and RX heights', () => {
      expect(twoRayReflectionGainDb(1500, 30, 3, 868, 0.8))
        .toBeCloseTo(twoRayReflectionGainDb(1500, 3, 30, 868, 0.8), 6);
    });

    it('produces both constructive and destructive interference across range', () => {
      let sawGain = false;
      let sawLoss = false;
      for (let d = 50; d <= 3000; d += 10) {
        const g = twoRayReflectionGainDb(d, 30, 5, 868, 0.9);
        if (g > 0.5) sawGain = true;
        if (g < -0.5) sawLoss = true;
      }
      expect(sawGain).toBe(true);
      expect(sawLoss).toBe(true);
    });

    it('adds finite six-ray corridor reflections with bounded coherent gain', () => {
      let sawDifferentFromTwoRay = false;
      for (let d = 100; d <= 5000; d += 100) {
        const twoRay = twoRayReflectionGainDb(d, 20, 2, 868, 0.7);
        const sixRay = sixRayReflectionGainDb(d, 20, 2, 868, 0.7, 0.35, 24);
        expect(Number.isFinite(sixRay)).toBe(true);
        expect(sixRay).toBeGreaterThanOrEqual(-30.001);
        expect(sixRay).toBeLessThanOrEqual(10);
        if (Math.abs(sixRay - twoRay) > 0.25) sawDifferentFromTwoRay = true;
      }
      expect(sawDifferentFromTwoRay).toBe(true);
    });

    it('keeps six-ray reflections finite for invalid optional parameters', () => {
      expect(Number.isFinite(sixRayReflectionGainDb(1000, 20, 2, 868, Number.NaN, Number.NaN, Number.NaN))).toBe(true);
    });

    it('traces finite first-order reflections from real building facades', () => {
      const building = [[0.001, 0.003], [0.001, 0.007], [0.002, 0.007], [0.002, 0.003]];
      const rays = traceBuildingFacadeRays({
        txLat: 0,
        txLon: 0,
        txAbsElevM: 8,
        rxLat: 0,
        rxLon: 0.01,
        rxAbsElevM: 8,
        buildings: {
          polygons: [building],
          bboxes: [{ latMin: 0.001, latMax: 0.002, lonMin: 0.003, lonMax: 0.007 }],
          heights: [20],
          tileIndex: null,
        },
        elevGrid: new Float32Array([0, 0, 0, 0]),
        elevRes: 2,
        bounds: { latMin: -0.001, latMax: 0.003, lonMin: -0.001, lonMax: 0.011 },
      });

      expect(rays.length).toBeGreaterThan(0);
      expect(rays[0].buildingIndex).toBe(0);
      expect(rays[0].lat).toBeCloseTo(0.001, 5);
      expect(rays[0].lon).toBeGreaterThan(0.003);
      expect(rays[0].lon).toBeLessThan(0.007);
      expect(Number.isFinite(rays[0].pathM)).toBe(true);
    });

    it('rejects facade reflections above the building rooftop', () => {
      const building = [[0.001, 0.003], [0.001, 0.007], [0.002, 0.007], [0.002, 0.003]];
      const rays = traceBuildingFacadeRays({
        txLat: 0,
        txLon: 0,
        txAbsElevM: 15,
        rxLat: 0,
        rxLon: 0.01,
        rxAbsElevM: 15,
        buildings: {
          polygons: [building],
          bboxes: [{ latMin: 0.001, latMax: 0.002, lonMin: 0.003, lonMax: 0.007 }],
          heights: [4],
          tileIndex: null,
        },
        elevGrid: new Float32Array([0, 0, 0, 0]),
        elevRes: 2,
        bounds: { latMin: -0.001, latMax: 0.003, lonMin: -0.001, lonMax: 0.011 },
      });

      expect(rays).toEqual([]);
    });
  });

  it('computes known distances and bearings', () => {
    expect(haversine(0, 0, 0, 1)).toBeCloseTo(111195, -1);
    expect(bearingDeg(0, 0, 1, 0)).toBeCloseTo(0, 6);
    expect(bearingDeg(0, 0, 0, 1)).toBeCloseTo(90, 6);
  });

  it('applies directional antenna pattern offsets', () => {
    expect(antennaPatternOffsetDb('omni', 0, 180)).toBe(0);
    expect(antennaPatternOffsetDb('sector90', 0, 40)).toBe(0);
    expect(antennaPatternOffsetDb('sector90', 0, 80)).toBe(-10);
    expect(antennaPatternOffsetDb('sector120', 0, 180)).toBe(-20);
    expect(antennaPatternOffsetDb({ hpbwDeg: 60, maxAttenDb: 18 }, 0, 60)).toBeCloseTo(-12);
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

  it('computes segment intervals through polygons', () => {
    const square = [[-1, 0], [-1, 1], [1, 1], [1, 0]];
    expect(segmentPolygonIntervals(0, -1, 0, 2, square)).toEqual([
      [1 / 3, 2 / 3],
    ]);
  });

  it('interpolates elevations and earth bulge consistently', () => {
    const grid = new Float32Array([10, 20, 30, 40]);
    expect(bilinearElev(0.5, 0.5, grid, 2, 0, 1, 0, 1)).toBeCloseTo(25);
    expect(bilinearElev(10, 20, new Float32Array([123]), 1, 10, 10, 20, 20)).toBe(123);
    expect(earthBulgeM(0.5, 10000)).toBeCloseTo(1.47, 2);
  });

  it('uses Deygout diffraction to account for multiple terrain edges', () => {
    const profile = new Float32Array([0, 35, 0, 35, 0]);
    const singleEdge = checkLoS(0, 0, profile, 10, 10, 10000, 868, false, 'knife-edge');
    const multiEdge = checkLoS(0, 0, profile, 10, 10, 10000, 868, false, 'deygout');

    expect(multiEdge.diffractionModel).toBe('deygout');
    expect(multiEdge.diffractionLossDb).toBeGreaterThan(singleEdge.diffractionLossDb + 5);
  });

  it('writes threshold-aware coverage pixels', () => {
    const rgba = new Uint8ClampedArray(8);
    writePixel(rgba, 0, -130, -120);
    writePixel(rgba, 4, -90, -120);

    expect(Array.from(rgba.subarray(0, 4))).toEqual([70, 0, 0, 70]);
    expect(rgba[7]).toBeGreaterThan(70);
  });

  it('makes shadow fading deterministic when random inputs are controlled', () => {
    expect(shadowFadingDb(0)).toBe(0);

    const random = vi.spyOn(Math, 'random')
      .mockReturnValueOnce(Math.exp(-0.5))
      .mockReturnValueOnce(0);

    expect(shadowFadingDb(4)).toBeCloseTo(4);
    random.mockRestore();
  });

  it('keeps shadow fading finite if the random source returns zero', () => {
    const random = vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0);

    expect(Number.isFinite(shadowFadingDb(4))).toBe(true);
    random.mockRestore();
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
