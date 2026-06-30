import { describe, expect, it } from 'vitest';
import {
  buildP2PBudgetRows,
  p2pResultStatusMessage,
  profileSvgForFullscreen,
  renderP2PProfileReportHtml,
  renderP2PResultPanelHtml,
} from '../../src/p2pResultView.js';

describe('P2P result panel view', () => {
  it('builds core budget rows with status colors', () => {
    const rows = buildP2PBudgetRows(result({ margin: 12.4, diffractionLoss: 4 }));

    expect(rows).toEqual(expect.arrayContaining([
      { key: 'Distance', value: '2.45 km', color: '' },
      { key: 'Diffraction loss', value: '4.0 dB', color: '' },
      { key: 'Link margin', value: '12.4 dB', color: '#4ade80' },
      { key: 'Geometric LoS', value: '<span style="color:#4ade80">Clear</span>', color: null },
      { key: 'Fresnel clearance', value: '<span style="color:#4ade80">Clear</span>', color: null },
    ]));
  });

  it('adds obstacle, shadow fading, and Monte Carlo rows when present', () => {
    const rows = buildP2PBudgetRows(result({
      foliageLoss: 8,
      buildingLoss: 18,
      shadowFadingLoss: 1.5,
      monteCarlo: {
        enabled: true,
        trials: 500,
        outageProbability: 0.22,
        marginP05: -2,
        marginP50: 4,
        marginP95: 9,
      },
    }));

    expect(rows).toEqual(expect.arrayContaining([
      { key: 'Foliage loss', value: '8.0 dB', color: '#facc15' },
      { key: 'Building loss', value: '18.0 dB', color: '#fc8181' },
      { key: 'Shadow fading', value: '1.5 dB', color: '#facc15' },
      { key: 'MC outage probability', value: '22.0%', color: '#fc8181' },
      { key: 'MC margin P05', value: '-2.0 dB', color: '#fc8181' },
    ]));
  });

  it('renders escaped warnings, budget/profile tabs, and profile actions', () => {
    const html = renderP2PResultPanelHtml(result({
      warnings: ['Terrain <gap>'],
      profileSvg: '<svg><path /></svg>',
    }));

    expect(html).toContain('data-target="p2p-tab-budget"');
    expect(html).toContain('data-target="p2p-tab-profile"');
    expect(html).toContain('Terrain &lt;gap&gt;');
    expect(html).toContain('<svg><path /></svg>');
    expect(html).toContain('btn-fullscreen-profile');
    expect(html).toContain('btn-save-profile');
  });

  it('formats OK and failed status messages', () => {
    expect(p2pResultStatusMessage(result({ margin: 1.25 }))).toBe('Link OK (+1.3 dB margin)');
    expect(p2pResultStatusMessage(result({ margin: -3.25 }))).toBe('Link FAILED (-3.3 dB short)');
  });

  it('renders the fullscreen profile report with endpoint and radio details', () => {
    const html = renderP2PProfileReportHtml(result({
      _settings: {
        freqMHz: 869.525,
        txPower: 27,
        txGain: 6,
        rxGain: 3,
        txHeight: 12,
        rxHeight: 2,
      },
      monteCarlo: {
        enabled: true,
        trials: 250,
        outageProbability: 0.125,
        marginP05: -1.2,
        marginP50: 4.4,
        marginP95: 9.8,
      },
    }), {
      pointA: { lat: 48.1234567, lng: 18.2345678 },
      pointB: { lat: 49.1111111, lon: 19.2222222 },
      generatedAt: '2026-06-30T12:34:56.000Z',
    });

    expect(html).toContain('Terrain LoS Profile Report');
    expect(html).toContain('Exported 2026-06-30 12:34:56 UTC');
    expect(html).toContain('A (TX): 48.123457, 18.234568');
    expect(html).toContain('B (RX): 49.111111, 19.222222');
    expect(html).toContain('FREQUENCY</span><strong>869.5 MHz');
    expect(html).toContain('Monte Carlo 250 trials');
    expect(html).toContain('Outage 12.5%');
  });

  it('rewrites profile SVG classes for fullscreen rendering', () => {
    expect(profileSvgForFullscreen('<svg class="p2p-above-los p2p-above-los"></svg>'))
      .toBe('<svg class="p2p-above-los-fullscreen p2p-above-los-fullscreen"></svg>');
  });

  function result(overrides = {}) {
    return {
      distM: 2450,
      sampleCount: 128,
      pathLoss: 118.3,
      diffractionLoss: 4,
      foliageLoss: 0,
      buildingLoss: 0,
      shadowFadingLoss: 0,
      totalPathLoss: 122.3,
      txEirp: 29,
      txPatternOffset: 0,
      rxPatternOffset: 0,
      rxPower: -93.3,
      fadeMargin: 10,
      requiredRx: -123,
      margin: 12.4,
      profileSvg: '<svg></svg>',
      warnings: [],
      geoResult: { geometricLos: true, diffractionModel: 'deygout' },
      fresnelResult: { fresnelClear: true },
      ...overrides,
    };
  }
});
