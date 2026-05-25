import { describe, expect, it } from 'vitest';
import {
  buildTerrainGridPoints,
  buildTerrainMeshArrays,
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
    expect(mesh.indices).toHaveLength(24);
    expect(mesh.minElevation).toBe(100);
    expect(mesh.maxElevation).toBe(180);
    expect(sampleTerrainElevation(48.005, 18.01, { bounds, elevations, res: 3 })).toBeCloseTo(140);
  });
});
