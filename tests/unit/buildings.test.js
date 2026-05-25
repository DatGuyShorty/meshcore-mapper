import { describe, expect, it } from 'vitest';
import { buildingLossDb } from '../../src/buildings.js';

describe('building attenuation', () => {
  it('adds traversal and wall loss when the ray crosses below rooftops', () => {
    const profileLats = new Float64Array([0, 0, 0]);
    const profileLons = new Float64Array([-1, 0, 1]);
    const profileElevs = new Float32Array([0, 0, 0]);
    const building = [[-0.1, -0.1], [-0.1, 0.1], [0.1, 0.1], [0.1, -0.1]];

    const loss = buildingLossDb(
      profileLats,
      profileLons,
      profileElevs,
      1,
      1,
      [building],
      [{ latMin: -0.1, latMax: 0.1, lonMin: -0.1, lonMax: 0.1 }],
      [10],
      null,
      200,
      0.5
    );

    expect(loss).toBeGreaterThan(20);
  });

  it('skips building loss when the ray clears the rooftop', () => {
    const profileLats = new Float64Array([0, 0, 0]);
    const profileLons = new Float64Array([-1, 0, 1]);
    const profileElevs = new Float32Array([0, 0, 0]);
    const building = [[-0.1, -0.1], [-0.1, 0.1], [0.1, 0.1], [0.1, -0.1]];

    const loss = buildingLossDb(
      profileLats,
      profileLons,
      profileElevs,
      50,
      50,
      [building],
      [{ latMin: -0.1, latMax: 0.1, lonMin: -0.1, lonMax: 0.1 }],
      [10],
      null,
      200,
      0.5
    );

    expect(loss).toBe(0);
  });
});
