import { describe, it, expect } from 'vitest';
import {
  _toUint8Array,
  _latLonToTilePoint,
  _estimatePointSpacingM,
  _chooseDemTileZoom,
  _sampleTerrariumElevation,
  _fillNulls,
} from '../../src/elevation.js';

describe('elevation helper functions', () => {
  it('converts common buffer-like values into Uint8Array', () => {
    expect(_toUint8Array(null)).toBeNull();
    expect(_toUint8Array(undefined)).toBeNull();
    const sourceArray = [1, 2, 3];
    expect(_toUint8Array(sourceArray)).toEqual(new Uint8Array([1, 2, 3]));
    const buffer = new ArrayBuffer(3);
    const bytes = new Uint8Array(buffer);
    bytes.set([4, 5, 6]);
    expect(_toUint8Array(buffer)).toEqual(new Uint8Array([4, 5, 6]));
    const view = new Uint16Array([0x0708]);
    expect(_toUint8Array(view)).toEqual(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  });

  it('maps lat/lon to tile indices and pixel offsets within bounds', () => {
    const point = _latLonToTilePoint(0, 0, 10);
    expect(point.tx).toBeGreaterThanOrEqual(0);
    expect(point.ty).toBeGreaterThanOrEqual(0);
    expect(point.tx).toBeLessThan(1024);
    expect(point.ty).toBeLessThan(1024);
    expect(point.px).toBeGreaterThanOrEqual(0);
    expect(point.px).toBeLessThan(256);
    expect(point.py).toBeGreaterThanOrEqual(0);
    expect(point.py).toBeLessThan(256);

    const east = _latLonToTilePoint(0, 180, 10);
    expect(east.tx).toBe(1023);
    expect(east.px).toBeGreaterThanOrEqual(0);
    expect(east.px).toBeLessThan(256);
  });

  it('estimates spacing as zero for insufficient point sets', () => {
    expect(_estimatePointSpacingM([])).toBe(0);
    expect(_estimatePointSpacingM([{ latitude: 1, longitude: 1 }])).toBe(0);
    expect(_estimatePointSpacingM([{ lat: 1, lon: 1 }, { latitude: 1, longitude: 1 }])).toBe(0);
  });

  it('estimates spacing from the envelope of coordinates', () => {
    const points = [
      { latitude: 10, longitude: 10 },
      { latitude: 11, longitude: 11 },
      { latitude: 10.5, longitude: 10.5 },
    ];
    const spacing = _estimatePointSpacingM(points);
    expect(spacing).toBeGreaterThan(0);
    expect(spacing).toBeLessThan(200000);
  });

  it('chooses a DEM tile zoom within allowed range', () => {
    const points = [
      { latitude: 45, longitude: -120 },
      { latitude: 45.1, longitude: -119.9 },
    ];
    expect(_chooseDemTileZoom(points, { demTileZoom: 5 })).toBe(10);
    expect(_chooseDemTileZoom(points, { demTileZoom: 20 })).toBe(15);
    const dynamicZoom = _chooseDemTileZoom(points, { targetResolutionM: 50 });
    expect(dynamicZoom).toBeGreaterThanOrEqual(10);
    expect(dynamicZoom).toBeLessThanOrEqual(15);
  });

  it('samples terrarium tile elevations using bilinear interpolation', () => {
    const tile = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([128, 0, 0, 0, 129, 0, 0, 0, 130, 0, 0, 0, 131, 0, 0, 0]),
    };
    const center = _sampleTerrariumElevation(tile, 0.5, 0.5);
    expect(center).toBeCloseTo((0 + 256 + 512 + 768) / 4, 5);
    expect(_sampleTerrariumElevation(tile, 0, 0)).toBe(0);
    expect(_sampleTerrariumElevation(tile, 1, 1)).toBe(768);
  });

  it('fills null elevation results with nearest available values', () => {
    const results = [1, null, null, 4, null, 6];
    const points = [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
      { latitude: 0, longitude: 2 },
      { latitude: 0, longitude: 3 },
      { latitude: 0, longitude: 4 },
      { latitude: 0, longitude: 5 },
    ];
    const stats = _fillNulls(results, points);
    expect(results).toEqual([1, 1, 1, 4, 4, 6]);
    expect(stats).toEqual({ filledFromNeighbour: 3, defaultedToZero: 0 });
  });

  it('reports defaulted-to-zero when no neighbour is available', () => {
    const results = [null, null, null];
    const points = [
      { latitude: 1, longitude: 1 },
      { latitude: 1, longitude: 2 },
      { latitude: 1, longitude: 3 },
    ];
    const stats = _fillNulls(results, points);
    expect(results).toEqual([0, 0, 0]);
    expect(stats).toEqual({ filledFromNeighbour: 0, defaultedToZero: 3 });
  });

  it('reports zero counts when there were no nulls', () => {
    const results = [10, 20, 30];
    const points = [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
      { latitude: 0, longitude: 2 },
    ];
    expect(_fillNulls(results, points)).toEqual({
      filledFromNeighbour: 0,
      defaultedToZero: 0,
    });
    expect(results).toEqual([10, 20, 30]);
  });
});
