import { describe, expect, it } from 'vitest';
import {
  boundsForTileGrid,
  boundsCenteredOn,
  boundsForFocusPoints,
  boundsWithTileBuffer,
  buildTerrainGridPoints,
  buildTerrainMeshArrays,
  format3dSceneStatus,
  isLatLonInsideBounds,
  latLonFromMeters,
  nodeMarkerMetrics,
  projectLatLonToMeters,
  sampleTerrainElevation,
} from '../../src/terrain3dModel.js';

describe('3D terrain model helpers', () => {
  const bounds = {
    latMin: 48,
    latMax: 48.01,
    lonMin: 18,
    lonMax: 18.02,
  };

  it('builds a row-major terrain sampling grid', () => {
    const points = buildTerrainGridPoints(bounds, 3);

    expect(points).toHaveLength(9);
    expect(points[0]).toEqual({ latitude: bounds.latMax, longitude: bounds.lonMin });
    expect(points[8]).toEqual({ latitude: bounds.latMin, longitude: bounds.lonMax });
  });

  it('projects coordinates around the viewport center', () => {
    const center = projectLatLonToMeters(48.005, 18.01, bounds);
    const east = projectLatLonToMeters(48.005, 18.02, bounds);

    expect(Math.abs(center.x)).toBeLessThan(0.001);
    expect(Math.abs(center.z)).toBeLessThan(0.001);
    expect(east.x).toBeGreaterThan(700);
  });

  it('converts 3D pan offsets back to map bounds for retile refreshes', () => {
    const east = projectLatLonToMeters(48.005, 18.015, bounds);
    const center = latLonFromMeters(east.x, east.z, bounds);
    const shifted = boundsCenteredOn(center, bounds);

    expect(center.lat).toBeCloseTo(48.005);
    expect(center.lon).toBeCloseTo(18.015);
    expect(shifted.latMax - shifted.latMin).toBeCloseTo(bounds.latMax - bounds.latMin);
    expect(shifted.lonMax - shifted.lonMin).toBeCloseTo(bounds.lonMax - bounds.lonMin);
    expect((shifted.lonMin + shifted.lonMax) / 2).toBeCloseTo(18.015);
  });

  it('expands viewport bounds into a buffered 3D terrain tile area', () => {
    const buffered = boundsWithTileBuffer(bounds, 1);

    expect(buffered.latMin).toBeCloseTo(47.99);
    expect(buffered.latMax).toBeCloseTo(48.02);
    expect(buffered.lonMin).toBeCloseTo(17.98);
    expect(buffered.lonMax).toBeCloseTo(18.04);
  });

  it('expands viewport bounds into a 4x4 3D terrain tile grid', () => {
    const tiled = boundsForTileGrid(bounds, 4, 4);

    expect(tiled.latMin).toBeCloseTo(47.985);
    expect(tiled.latMax).toBeCloseTo(48.025);
    expect(tiled.lonMin).toBeCloseTo(17.97);
    expect(tiled.lonMax).toBeCloseTo(18.05);
  });

  it('frames selected 3D focus points with surrounding terrain context', () => {
    const pointFocus = boundsForFocusPoints([{ lat: 48.006, lon: 18.012 }], bounds);
    expect((pointFocus.latMin + pointFocus.latMax) / 2).toBeCloseTo(48.006);
    expect((pointFocus.lonMin + pointFocus.lonMax) / 2).toBeCloseTo(18.012);
    expect(pointFocus.latMax - pointFocus.latMin).toBeCloseTo(bounds.latMax - bounds.latMin);

    const linkFocus = boundsForFocusPoints([
      { lat: 48.001, lon: 18.002 },
      { lat: 48.009, lon: 18.018 },
    ], bounds);
    expect(linkFocus.latMin).toBeLessThan(48.001);
    expect(linkFocus.latMax).toBeGreaterThan(48.009);
    expect(linkFocus.lonMin).toBeLessThan(18.002);
    expect(linkFocus.lonMax).toBeGreaterThan(18.018);
  });

  it('builds mesh arrays and samples interpolated terrain height', () => {
    const elevations = new Float32Array([
      100, 110, 120,
      130, 140, 150,
      160, 170, 180,
    ]);

    const mesh = buildTerrainMeshArrays({
      bounds,
      elevations,
      res: 3,
      verticalScale: 2,
    });

    expect(mesh.positions).toHaveLength(27);
    expect(mesh.colors).toHaveLength(27);
    expect(Array.from(mesh.uvs.slice(0, 2))).toEqual([0, 1]);
    expect(Array.from(mesh.uvs.slice(16, 18))).toEqual([1, 0]);
    expect(mesh.indices).toHaveLength(24);
    expect(mesh.minElevation).toBe(100);
    expect(mesh.maxElevation).toBe(180);
    expect(sampleTerrainElevation(48.005, 18.01, { bounds, elevations, res: 3 })).toBeCloseTo(140);
    expect(sampleTerrainElevation(48.2, 17.5, { bounds, elevations, res: 3 })).toBeCloseTo(100);
    expect(sampleTerrainElevation(47.8, 18.5, { bounds, elevations, res: 3 })).toBeCloseTo(180);
  });

  it('filters 3D nodes to the viewport with an optional pad', () => {
    expect(isLatLonInsideBounds(48.005, 18.01, bounds)).toBe(true);
    expect(isLatLonInsideBounds(48.02, 18.01, bounds)).toBe(false);
    expect(isLatLonInsideBounds(48.0101, 18.01, bounds, 0.02)).toBe(true);
  });

  it('scales 3D node markers so nodes remain visible on map-sized terrain', () => {
    const compact = nodeMarkerMetrics(500, 300, 10, 3);
    const mapSized = nodeMarkerMetrics(8000, 6000, 10, 3);

    expect(compact.radius).toBeGreaterThanOrEqual(28);
    expect(mapSized.radius).toBeGreaterThan(compact.radius);
    expect(mapSized.mastHeight).toBeGreaterThan(mapSized.radius);
    expect(mapSized.ringRadius).toBeGreaterThan(mapSized.radius);
  });

  it('formats 3D terrain source state in the final status', () => {
    const stats = { buildings: 2, foliage: 3, nodes: 4, coverage: 1, links: 5 };
    const live = format3dSceneStatus({ res: 64, tileCount: 16, stats, terrainSource: 'dem' });
    const preview = format3dSceneStatus({ res: 64, tileCount: 16, stats, terrainSource: 'preview' });

    expect(live).toMatchObject({
      kind: 'success',
      text: expect.stringContaining('3D terrain 64x64 over 16 tiles'),
    });
    expect(preview).toMatchObject({
      kind: 'warning',
      text: expect.stringContaining('Preview terrain (synthetic; DEM unavailable)'),
    });
    expect(preview.text).toContain('4 nodes');
    expect(preview.text).toContain('5 links');
  });
});
