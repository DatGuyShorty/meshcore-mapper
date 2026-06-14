import { describe, expect, it } from 'vitest';
import {
  coverageEmptyMessage,
  coveragePointInspectorContent,
  coveragePointPopupContent,
  coverageRowContent,
  formatCoverageDb,
  formatCoverageDbm,
  formatCoverageDistance,
} from '../../src/coverageInspectorView.js';

describe('coverage inspector view', () => {
  it('formats coverage values for compact inspection rows', () => {
    expect(formatCoverageDb(3.14159)).toBe('+3.1 dB');
    expect(formatCoverageDb(-2.45)).toBe('-2.5 dB');
    expect(formatCoverageDbm(-123.456)).toBe('-123.5 dBm');
    expect(formatCoverageDistance(999)).toBe('999 m');
    expect(formatCoverageDistance(1000)).toBe('1.00 km');
  });

  it('renders weak coverage rows with escaped labels, layer metadata, and losses', () => {
    const html = coverageRowContent({
      repName: '<Node>',
      layerLabel: '<Layer A>',
      layerOrdinal: 2,
      layerTotal: 3,
      rxPowerSource: 'grid',
      distM: 1200,
      rxPower: -80.4,
      snrDb: 10.5,
      margin: -1.2,
      los: { geometricLos: false, fresnelClear: false },
      reason: 'Below threshold; terrain obstruction adds about 12.3 dB diffraction loss.',
      losses: {
        pathLossDb: 112.5,
        diffractionLossDb: 12.3,
        foliageLossDb: 0,
        buildingLossDb: 4.2,
        reflectionGainDb: 0,
        obstacleLossAppliedDb: 4.2,
      },
    });

    expect(html).toContain('class="map-context-coverage-row weak"');
    expect(html).toContain('&lt;Node&gt;');
    expect(html).toContain('&lt;Layer A&gt;');
    expect(html).toContain('Layer 2/3');
    expect(html).toContain('Heatmap sample');
    expect(html).toContain('RSSI -80.4 dBm');
    expect(html).toContain('LoS blocked');
    expect(html).toContain('Fresnel blocked');
    expect(html).toContain('FSPL');
    expect(html).toContain('Diffraction');
    expect(html).toContain('Buildings');
  });

  it('renders popup empty states from layer counts', () => {
    expect(coverageEmptyMessage(0, 0)).toBe('No coverage has been computed yet.');
    expect(coverageEmptyMessage(2, 0)).toBe('All coverage layers are hidden.');
    expect(coverageEmptyMessage(2, 2)).toBe('No visible coverage layer reaches this point.');

    const html = coveragePointPopupContent({
      latlng: { lat: 1, lng: 2 },
      rows: [],
      allLayerCount: 0,
      visibleLayerCount: 0,
    });
    expect(html).toContain('Map Point');
    expect(html).toContain('1.00000, 2.00000');
    expect(html).toContain('No coverage has been computed yet.');
  });

  it('renders right-inspector actions with visible coverage rows', () => {
    const html = coveragePointInspectorContent({
      latlng: { lat: 3, lng: 4 },
      rows: [{
        repName: 'Node',
        layerLabel: 'Layer A',
        layerOrdinal: 1,
        layerTotal: 1,
        rxPowerSource: 'computed',
        distM: 10,
        rxPower: -80,
        snrDb: 35,
        margin: 10,
        los: null,
        reason: 'Covered with comfortable margin.',
        losses: {},
      }],
      allLayerCount: 1,
      visibleLayerCount: 1,
    });

    expect(html).toContain('Visible Coverage At Point');
    expect(html).toContain('Point model');
    expect(html).toContain('Add Node Here');
    expect(html).toContain('data-inspector-action="point-view-3d"');
    expect(html).toContain('data-inspector-action="clear-selection"');
  });
});
