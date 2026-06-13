import { describe, expect, it } from 'vitest';
import {
  clampTileZoom,
  latLonToTilePixel,
  selectTextureLayout,
  tileTextureLayout,
  tileUrl,
} from '../../src/mapTileTexture.js';

describe('3D map tile texture helpers', () => {
  it('projects lon/lat into Web Mercator tile pixels', () => {
    const p = latLonToTilePixel(0, 0, 1);

    expect(p.x).toBeCloseTo(256);
    expect(p.y).toBeCloseTo(256);
  });

  it('builds a texture layout for the viewport bounds', () => {
    const layout = tileTextureLayout({
      latMin: 48,
      latMax: 48.01,
      lonMin: 18,
      lonMax: 18.02,
    }, 12, 512);

    expect(layout.width).toBeGreaterThan(1);
    expect(layout.height).toBeGreaterThan(1);
    expect(layout.tileXMax).toBeGreaterThanOrEqual(layout.tileXMin);
    expect(layout.tileYMax).toBeGreaterThanOrEqual(layout.tileYMin);
  });

  it('lowers texture zoom when the source would be heavily downsampled', () => {
    const bounds = {
      latMin: 48,
      latMax: 48.2,
      lonMin: 18,
      lonMax: 18.4,
    };
    const selected = selectTextureLayout(bounds, 17, 19, 512);

    expect(selected.zoom).toBeLessThan(17);
    expect(selected.layout.scale).toBeGreaterThanOrEqual(0.5);
    expect(selected.layout.width).toBeLessThanOrEqual(512);
    expect(selected.layout.height).toBeLessThanOrEqual(512);
    expect(selected.tileCount).toBeLessThanOrEqual(256);
  });

  it('lays out map textures across the antimeridian without negative width', () => {
    const layout = tileTextureLayout({
      latMin: -1,
      latMax: 1,
      lonMin: 179.5,
      lonMax: 180.5,
    }, 3, 512);

    expect(layout.pixelWidth).toBeGreaterThan(1);
    expect(layout.se.x).toBeGreaterThan(layout.nw.x);
    expect(layout.tileXMax).toBeGreaterThanOrEqual(layout.tileXMin);
    expect(tileUrl({ url: '/{z}/{x}/{y}.png' }, 3, layout.tileXMax, layout.tileYMin)).toMatch(/^\/3\/[0-7]\/\d+\.png$/);
  });

  it('formats active Leaflet tile URLs', () => {
    const url = tileUrl({
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      options: { subdomains: 'abc' },
    }, 12, 2252, 1441);

    expect(url).toMatch(/^https:\/\/[abc]\.tile\.openstreetmap\.org\/12\/2252\/1441\.png$/);
    expect(clampTileZoom(20, 17)).toBe(17);
  });
});
