import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  buildCoverageKml,
  buildCoveragePolygonGeoJson,
  buildKmz,
} from '../../src/gisExport.js';

describe('GIS coverage exports', () => {
  it('exports covered cells as per-node GeoJSON polygons', () => {
    const { fc, downsampled, stride } = buildCoveragePolygonGeoJson([
      layer({
        name: 'Alpha <base>',
        signalGrid: [-90, -120, -95, -130],
      }),
      layer({
        name: 'Hidden',
        visible: false,
        signalGrid: [-80, -80, -80, -80],
      }),
    ], {
      scope: 'per-node',
      generatedAt: '2026-06-14T10:20:30.000Z',
      networkStats: { status: 'ready' },
    });

    expect(downsampled).toBe(false);
    expect(stride).toBe(1);
    expect(fc.properties).toMatchObject({
      exportType: 'coverage-polygons',
      exportScope: 'per-node',
      sourceLayerCount: 1,
      networkStats: { status: 'ready' },
    });
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0]).toMatchObject({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [0, 0.5],
          [0.5, 0.5],
          [0.5, 1],
          [0, 1],
          [0, 0.5],
        ]],
      },
      properties: {
        export_scope: 'per-node',
        node: 'Alpha <base>',
        rssi_dbm: -90,
        margin_db: 10,
      },
    });
  });

  it('exports a combined network layer using strongest visible source per cell', () => {
    const { fc } = buildCoveragePolygonGeoJson([
      layer({
        name: 'Weak',
        signalGrid: [-95, -95, -95, -95],
      }),
      layer({
        name: 'Strong',
        signalGrid: [-80, -130, -80, -80],
      }),
    ], { scope: 'combined' });

    expect(fc.properties.exportScope).toBe('combined');
    expect(fc.features).toHaveLength(4);
    expect(fc.features[0].properties).toMatchObject({
      export_scope: 'combined',
      node: 'Strong',
      coverage_count: 2,
      margin_db: 20,
    });
    expect(fc.features[1].properties).toMatchObject({
      node: 'Weak',
      coverage_count: 1,
      margin_db: 5,
    });
  });

  it('bounds large polygon exports with stride metadata', () => {
    const { fc, downsampled, stride } = buildCoveragePolygonGeoJson([
      layer({
        gridRes: 5,
        signalGrid: new Array(25).fill(-90),
      }),
    ], {
      scope: 'per-node',
      maxSide: 2,
    });

    expect(downsampled).toBe(true);
    expect(stride).toBe(3);
    expect(fc.properties.downsampled).toBe(true);
    expect(fc.features).toHaveLength(4);
    expect(fc.features[0].properties.cell_stride).toBe(3);
  });

  it('builds escaped KML placemarks from polygon GeoJSON', () => {
    const { fc } = buildCoveragePolygonGeoJson([
      layer({ name: 'Alpha <base>', signalGrid: [-90, -120, -120, -120] }),
    ], { scope: 'per-node' });

    const kml = buildCoverageKml(fc, 'Coverage & Field');

    expect(kml).toContain('<kml xmlns="http://www.opengis.net/kml/2.2">');
    expect(kml).toContain('<name>Coverage &amp; Field</name>');
    expect(kml).toContain('<name>Alpha &lt;base&gt;</name>');
    expect(kml).toContain('<Polygon>');
    expect(kml).toContain('<Data name="margin_db"><value>10</value></Data>');
    expect(kml).not.toContain('Alpha <base>');
  });

  it('packages KML into a stored KMZ archive', () => {
    const kml = '<?xml version="1.0"?><kml><Document><name>Test</name></Document></kml>';
    const kmz = buildKmz(kml);
    const bytes = Buffer.from(kmz);

    expect(bytes.subarray(0, 2).toString('utf8')).toBe('PK');
    expect(bytes.includes(Buffer.from('doc.kml'))).toBe(true);
    expect(bytes.includes(Buffer.from(kml))).toBe(true);
    expect(bytes.readUInt32LE(bytes.length - 22)).toBe(0x06054b50);
  });

  function layer(overrides = {}) {
    const gridRes = overrides.gridRes ?? 2;
    return {
      visible: true,
      gridRes,
      bounds: { latMin: 0, latMax: 1, lonMin: 0, lonMax: 1 },
      effectiveSens: -100,
      rep: { id: overrides.id ?? 'a', name: overrides.name ?? 'Alpha' },
      signalGrid: overrides.signalGrid ?? new Array(gridRes * gridRes).fill(-90),
      ...overrides,
    };
  }
});
