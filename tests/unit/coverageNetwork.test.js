import { describe, expect, it } from 'vitest';
import {
  buildCombinedCoverageOverlay,
  coverageLayerSourceKey,
  coverageNetworkStatsForExport,
  normalizeCombinedCoverageOverlayMode,
  summarizeCombinedCoverage,
  summarizeNodeFailureImpact,
} from '../../src/coverageNetwork.js';

describe('combined coverage summary', () => {
  it('reports empty and no-visible states', () => {
    expect(summarizeCombinedCoverage([])).toMatchObject({
      status: 'empty',
      totalLayerCount: 0,
      visibleLayerCount: 0,
    });

    expect(summarizeCombinedCoverage([layer({ visible: false })])).toMatchObject({
      status: 'no-visible-layers',
      totalLayerCount: 1,
      visibleLayerCount: 0,
    });
  });

  it('summarizes covered area from visible layers only', () => {
    const summary = summarizeCombinedCoverage([
      layer({ name: 'Visible node', signal: 10 }),
      layer({ name: 'Hidden node', signal: 20, visible: false }),
    ], { maxSamples: 100 });

    expect(summary.status).toBe('ready');
    expect(summary.visibleLayerCount).toBe(1);
    expect(summary.coveredPct).toBe(100);
    expect(summary.redundancyPct).toBe(0);
    expect(summary.topServing).toEqual([
      expect.objectContaining({ sourceKey: 'node:Visible node:0.50000:0.50000', label: 'Visible node', pct: 100 }),
    ]);
    expect(summary.nodeContributions).toEqual([
      expect.objectContaining({ sourceKey: 'node:Visible node:0.50000:0.50000', label: 'Visible node', pct: 100 }),
    ]);
  });

  it('counts overlap as redundancy and attributes best serving layer', () => {
    const summary = summarizeCombinedCoverage([
      layer({ name: 'Lower margin', signal: 8 }),
      layer({ name: 'Higher margin', signal: 18 }),
    ], { maxSamples: 100 });

    expect(summary.status).toBe('ready');
    expect(summary.visibleLayerCount).toBe(2);
    expect(summary.coveredPct).toBe(100);
    expect(summary.redundancyPct).toBe(100);
    expect(summary.medianMarginDb).toBe(18);
    expect(summary.topServing[0]).toEqual(expect.objectContaining({
      sourceKey: 'node:Higher margin:0.50000:0.50000',
      label: 'Higher margin',
      pct: 100,
    }));
  });

  it('keeps full node contribution stats while limiting top serving nodes', () => {
    const summary = summarizeCombinedCoverage([
      layer({ name: 'A', signals: [20, -10, -10, -10] }),
      layer({ name: 'B', signals: [-10, 20, -10, -10] }),
      layer({ name: 'C', signals: [-10, -10, 20, -10] }),
      layer({ name: 'D', signals: [-10, -10, -10, 20] }),
    ], { maxSamples: 64 });

    expect(summary.status).toBe('ready');
    expect(summary.nodeContributions).toHaveLength(4);
    expect(summary.nodeContributions.map(item => item.label)).toEqual(['A', 'B', 'C', 'D']);
    expect(summary.nodeContributions).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'A', pct: expect.closeTo(25, 1) }),
      expect.objectContaining({ label: 'D', pct: expect.closeTo(25, 1) }),
    ]));
    expect(summary.topServing).toHaveLength(3);
    expect(summary.topServing.map(item => item.label)).toEqual(['A', 'B', 'C']);
  });

  it('builds rounded export stats from a ready summary', () => {
    const summary = summarizeCombinedCoverage([
      layer({ name: 'Alpha', signal: 8 }),
      layer({ name: 'Beta', signal: 18 }),
    ], { maxSamples: 100 });

    const stats = coverageNetworkStatsForExport(summary);

    expect(stats).toMatchObject({
      status: 'ready',
      totalLayerCount: 2,
      visibleLayerCount: 2,
      coveredPct: 100,
      redundancyPct: 100,
      medianMarginDb: 18,
    });
    expect(stats.topServing[0]).toMatchObject({
      sourceKey: 'node:Beta:0.50000:0.50000',
      label: 'Beta',
      pct: 100,
    });
    expect(stats.nodeContributions[0]).toMatchObject({
      sourceKey: 'node:Beta:0.50000:0.50000',
      label: 'Beta',
      pct: 100,
    });
  });

  it('builds minimal export stats for empty summaries', () => {
    expect(coverageNetworkStatsForExport(summarizeCombinedCoverage([]))).toEqual({
      status: 'empty',
      totalLayerCount: 0,
      visibleLayerCount: 0,
    });
  });

  it('estimates node-failure impact from source-exclusive coverage', () => {
    const impact = summarizeNodeFailureImpact([
      layer({ id: 1, name: 'Alpha', signals: [10, 10, -5, -5] }),
      layer({ id: 2, name: 'Beta', signals: [-5, 10, 10, -5] }),
    ], { maxSamples: 64 });

    expect(impact.status).toBe('ready');
    expect(impact.impacts).toHaveLength(2);
    expect(impact.impacts[0]).toMatchObject({
      label: 'Alpha',
      lostPctOfNetwork: expect.closeTo(33.333, 1),
      lostPctOfSourceCoverage: expect.closeTo(50, 1),
    });
    expect(impact.impacts[1]).toMatchObject({
      label: 'Beta',
      lostPctOfNetwork: expect.closeTo(33.333, 1),
      lostPctOfSourceCoverage: expect.closeTo(50, 1),
    });
  });

  it('treats duplicate layers from the same source as one node for failure impact', () => {
    const impact = summarizeNodeFailureImpact([
      layer({ id: 7, name: 'Duplicate Source', signal: 10 }),
      layer({ id: 7, name: 'Duplicate Source', signal: 12 }),
    ], { maxSamples: 64 });

    expect(impact.status).toBe('ready');
    expect(impact.impacts).toHaveLength(1);
    expect(impact.impacts[0]).toMatchObject({
      label: 'Duplicate Source',
      lostPctOfNetwork: 100,
    });
  });

  it('excludes simulated-offline sources from combined stats and overlays', () => {
    const offline = coverageLayerSourceKey({ rep: { id: 1, name: 'Alpha' } });
    const results = [
      layer({ id: 1, name: 'Alpha', signal: 10 }),
      layer({ id: 2, name: 'Beta', signal: 12 }),
    ];

    const summary = summarizeCombinedCoverage(results, {
      maxSamples: 64,
      offlineSourceKeys: [offline],
    });
    const overlay = buildCombinedCoverageOverlay(results, {
      mode: 'strongest-node',
      maxSide: 32,
      offlineSourceKeys: [offline],
    });
    const impact = summarizeNodeFailureImpact(results, {
      maxSamples: 64,
      offlineSourceKeys: [offline],
    });

    expect(summary.status).toBe('ready');
    expect(summary.topServing).toEqual([expect.objectContaining({ label: 'Beta' })]);
    expect(overlay.status).toBe('ready');
    expect(impact.status).toBe('ready');
    expect(impact.impacts).toHaveLength(1);
    expect(impact.impacts[0].label).toBe('Beta');
  });

  it('normalizes combined overlay modes', () => {
    expect(normalizeCombinedCoverageOverlayMode('best-margin')).toBe('best-margin');
    expect(normalizeCombinedCoverageOverlayMode('strongest-node')).toBe('strongest-node');
    expect(normalizeCombinedCoverageOverlayMode('covered-by-n')).toBe('covered-by-n');
    expect(normalizeCombinedCoverageOverlayMode('missing')).toBe('none');
  });

  it('builds best-margin, gap, overlap, strongest-node, and covered-by-N overlay rasters', () => {
    const best = buildCombinedCoverageOverlay([layer({ signal: 15 })], {
      mode: 'best-margin',
      maxSide: 32,
    });
    expect(best.status).toBe('ready');
    expect(best.gridRes).toBeGreaterThanOrEqual(32);
    expect(alphaPixels(best.rgba)).toBeGreaterThan(0);

    const gaps = buildCombinedCoverageOverlay([layer({ signal: -5 })], {
      mode: 'gaps',
      maxSide: 32,
    });
    expect(gaps.status).toBe('ready');
    expect(alphaPixels(gaps.rgba)).toBeGreaterThan(0);

    const overlap = buildCombinedCoverageOverlay([
      layer({ signal: 12 }),
      layer({ signal: 18 }),
    ], { mode: 'overlap', maxSide: 32 });
    expect(overlap.status).toBe('ready');
    expect(alphaPixels(overlap.rgba)).toBeGreaterThan(0);

    const strongest = buildCombinedCoverageOverlay([
      layer({ name: 'Lower RSSI', signal: 12 }),
      layer({ name: 'Higher RSSI', signal: 18 }),
    ], { mode: 'strongest-node', maxSide: 32 });
    expect(strongest.status).toBe('ready');
    expect(alphaPixels(strongest.rgba)).toBeGreaterThan(0);

    const coveredByN = buildCombinedCoverageOverlay([
      layer({ signal: 12 }),
      layer({ signal: 18 }),
    ], { mode: 'covered-by-n', minCoverageCount: 2, maxSide: 32 });
    expect(coveredByN.status).toBe('ready');
    expect(coveredByN.minCoverageCount).toBe(2);
    expect(alphaPixels(coveredByN.rgba)).toBeGreaterThan(0);
  });

  it('honors covered-by-N threshold', () => {
    const overlay = buildCombinedCoverageOverlay([
      layer({ signal: 12 }),
      layer({ signal: 18 }),
    ], { mode: 'covered-by-n', minCoverageCount: 3, maxSide: 32 });

    expect(overlay.status).toBe('empty-overlay');
    expect(alphaPixels(overlay.rgba)).toBe(0);
  });

  it('does not build a combined overlay when disabled or no layers are visible', () => {
    expect(buildCombinedCoverageOverlay([layer()], { mode: 'none' })).toMatchObject({
      status: 'disabled',
      mode: 'none',
    });
    expect(buildCombinedCoverageOverlay([layer({ visible: false })], { mode: 'best-margin' })).toMatchObject({
      status: 'no-visible-layers',
    });
  });

  function layer({ id = undefined, name = 'Node', signal = 10, signals = null, visible = true } = {}) {
    return {
      visible,
      rep: { id, name, lat: 0.5, lon: 0.5 },
      bounds: { latMin: 0, latMax: 1, lonMin: 0, lonMax: 1 },
      gridRes: 2,
      effectiveSens: 0,
      signalGrid: new Float32Array(signals ?? [signal, signal, signal, signal]),
    };
  }

  function alphaPixels(rgba) {
    let count = 0;
    for (let i = 3; i < rgba.length; i += 4) {
      if (rgba[i] > 0) count++;
    }
    return count;
  }
});
