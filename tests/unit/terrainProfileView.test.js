import { describe, expect, it } from 'vitest';
import { drawTerrainProfile, sampleObstacleHeights } from '../../src/terrainProfileView.js';

describe('terrain profile view helpers', () => {
  it('samples foliage and building heights along profile points', () => {
    const points = [
      { latitude: 0.5, longitude: 0.5 },
      { latitude: 0.75, longitude: 0.75 },
      { latitude: 2, longitude: 2 },
    ];
    const square = [[0, 0], [0, 1], [1, 1], [1, 0]];

    const { vegH, bldH } = sampleObstacleHeights(
      points,
      {
        polygons: [square],
        bboxes: [{ latMin: 0, latMax: 1, lonMin: 0, lonMax: 1 }],
        canopyHeights: [12],
        tileIndex: null,
      },
      {
        polygons: [square],
        bboxes: [{ latMin: 0, latMax: 1, lonMin: 0, lonMax: 1 }],
        heights: [8],
        tileIndex: null,
      }
    );

    expect(Array.from(vegH)).toEqual([12, 12, 0]);
    expect(Array.from(bldH)).toEqual([8, 8, 0]);
  });

  it('renders an SVG terrain profile with obstacle legends and stepped buildings', () => {
    const svg = drawTerrainProfile(
      new Float32Array([100, 110, 100]),
      100,
      100,
      10,
      1.5,
      1500,
      868,
      new Float32Array([0, 5, 0]),
      new Float32Array([0, 8, 0])
    );

    expect(svg).toContain('<svg');
    expect(svg).toContain('Veg');
    expect(svg).toContain('Bldg');
    expect(svg).toContain('H120.0 V');
    expect(svg).toContain('1.50 km');
  });

  it('renders finite SVG for degenerate profiles', () => {
    const svg = drawTerrainProfile(new Float32Array([100]), 100, 100, 10, 1.5, 0, 868);

    expect(svg).toContain('<svg');
    expect(svg).not.toMatch(/NaN|Infinity/);
  });
});
