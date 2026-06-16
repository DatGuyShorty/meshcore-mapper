import { describe, expect, it } from 'vitest';
import { buildPlanningReportHtml } from '../../src/planningReport.js';

describe('planning report view', () => {
  it('renders a complete reproducible report with escaped scenario data', () => {
    const html = buildPlanningReportHtml({
      generatedAt: '2026-06-14T10:20:30.000Z',
      screenshotDataUrl: 'data:image/png;base64,UE5H',
      settings: {
        'rx-height': '2.5',
        'unsafe-setting': '<script>alert(1)</script>',
      },
      repeaters: [{
        name: 'Alpha <base>',
        lat: 48.28625,
        lon: 18.5054,
        height: 12,
        power: 30,
        freq: 869.525,
        gain: 5,
        fromWs: true,
      }],
      coverageResults: [{
        rep: { name: 'Alpha <base>' },
        gridRes: 64,
        radiusKm: 12,
        effectiveSens: -129,
        bounds: { latMin: 48, latMax: 49, lonMin: 18, lonMax: 19 },
        metadata: { backend: 'CPU worker', warnings: [' DEM gap <tile> ', ''] },
      }, {
        visible: false,
        rep: { name: 'Hidden' },
      }],
      networkStats: {
        status: 'ready',
        totalLayerCount: 2,
        visibleLayerCount: 1,
        coveredAreaKm2: 42.25,
        coveredPct: 78.5,
        weakAreaKm2: 3.2,
        weakPct: 7.1,
        averageMarginDb: 11.4,
        topServing: [{ label: 'Alpha <base>', areaKm2: 42.25, pct: 100 }],
        nodeContributions: [
          { label: 'Alpha <base>', areaKm2: 42.25, pct: 100 },
          { label: 'Beta', areaKm2: 12.5, pct: 29.6 },
        ],
      },
      p2pLinks: [{
        kind: 'p2p',
        endpointAName: 'Alpha <base>',
        endpointBName: 'Beta',
        margin: -2,
        rxPower: -135,
        distM: 1500,
      }],
      pathLinks: [{
        kind: 'path',
        endpointAName: 'Beta',
        endpointBName: 'Gamma',
        margin: 12.4,
        rxPower: -91,
        distM: 800,
      }],
      optimizerRecommendations: [{
        rank: 1,
        lat: 48.3,
        lon: 18.6,
        score: 0.62,
        coverageRatio: 0.42,
        avgMarginDb: 8.5,
        backhaulPeerName: 'Alpha <base>',
        backhaulMarginDb: 12.4,
        backhaulRxPowerDbm: -91,
        backhaulDistanceM: 1500,
        scoreBreakdown: { label: 'Balanced <mix>' },
      }],
    });

    expect(html).toContain('<title>MeshCore Mapper Planning Report</title>');
    expect(html).toContain('Generated 2026-06-14T10:20:30.000Z');
    expect(html).toContain('src="data:image/png;base64,UE5H"');
    expect(html).toContain('Alpha &lt;base&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('P2P Critical Links');
    expect(html).toContain('Failing');
    expect(html).toContain('Optimizer Recommendations');
    expect(html).toContain('Balanced &lt;mix&gt;');
    expect(html).toContain('Node contributions');
    expect(html).toContain('Beta: 12.500 km2 (29.6%)');
    expect(html).toContain('Coverage warnings: DEM gap &lt;tile&gt;.');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('renders useful placeholders for empty scenarios and rejects unsafe screenshot urls', () => {
    const html = buildPlanningReportHtml({
      generatedAt: '2026-06-14T10:20:30.000Z',
      screenshotDataUrl: 'javascript:alert(1)',
    });

    expect(html).toContain('No nodes are currently in the scenario.');
    expect(html).toContain('No screenshot captured for this report.');
    expect(html).toContain('No coverage statistics are available. Compute coverage first.');
    expect(html).toContain('No optimizer recommendations are currently available.');
    expect(html).not.toContain('javascript:alert');
  });
});
