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
  writePixel,
} from '../../src/propagation.js';
import { foliageLossDb, weissbergerFoliageLossDb } from '../../src/foliage.js';

describe('propagation math', () => {
  it('computes FSPL at a known LoRa-scale distance', () => {
    expect(fspl(1000, 868)).toBeCloseTo(91.21, 1);
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
