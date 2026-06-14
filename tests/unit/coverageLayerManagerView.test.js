import { describe, expect, it } from 'vitest';
import {
  buildCoverageLayerManagerRows,
} from '../../src/coverageLayerManagerView.js';

describe('coverage layer manager view model', () => {
  it('renders an empty state when no layers exist', () => {
    expect(buildCoverageLayerManagerRows([], fallbackLabel)).toEqual([
      {
        kind: 'empty',
        text: 'No coverage layers yet. Compute coverage to add one.',
      },
    ]);
  });

  it('groups layers by scenario and exposes stable row state', () => {
    const rows = buildCoverageLayerManagerRows([
      layer({ scenario: 'quick', createdAt: 20, label: 'Quick old', layerId: 'old', visible: false, opacity: 0.4 }),
      layer({ scenario: null, createdAt: 10, label: 'Legacy', layerId: 'legacy' }),
      layer({ scenario: 'quick', createdAt: 50, label: 'Quick new', layerId: 'new', opacity: 0.75 }),
    ], fallbackLabel);

    expect(rows.map(row => row.kind)).toEqual(['group', 'layer', 'group', 'layer', 'layer']);
    expect(rows[0]).toMatchObject({ kind: 'group', label: 'Legacy / unspecified', count: 1 });
    expect(rows[2]).toMatchObject({ kind: 'group', label: 'quick', count: 2 });
    expect(rows[3]).toMatchObject({
      kind: 'layer',
      layerId: 'old',
      visible: false,
      name: 'Quick old',
      opacityPercent: 40,
    });
    expect(rows[4]).toMatchObject({
      kind: 'layer',
      layerId: 'new',
      visible: true,
      name: 'Quick new',
      opacityPercent: 75,
    });
  });

  it('falls back to generated names and default opacity for legacy layers', () => {
    const rows = buildCoverageLayerManagerRows([
      layer({ label: null, layerId: 'legacy' }),
    ], fallbackLabel);

    expect(rows[1]).toMatchObject({
      kind: 'layer',
      layerId: 'legacy',
      name: 'Generated Node',
      opacityPercent: 65,
    });
  });

  it('carries metadata, title text, detail rows, and warning state', () => {
    const rows = buildCoverageLayerManagerRows([
      layer({
        label: 'Restored',
        metadata: {
          backend: 'cuda',
          backendLabel: 'Python CUDA',
          settingsSnapshot: { scenarioProfile: 'balanced' },
          warnings: ['Terrain gaps found.'],
          cache: { demTileRequests: 3, demTileCacheHits: 2, demTileNetFetches: 1 },
          computeMs: 1250,
        },
      }),
    ], fallbackLabel);
    const row = rows[1];

    expect(row).toMatchObject({
      kind: 'layer',
      meta: 'Python CUDA | 64x64 | 7.5 km | balanced | 1 warning',
    });
    expect(row.title).toContain('Compute: 1.3s');
    expect(row.details).toEqual(expect.arrayContaining([
      { label: 'Backend', value: 'Python CUDA', warning: false },
      { label: 'Warnings', value: 'Terrain gaps found.', warning: true },
    ]));
  });

  function layer({
    scenario = 'balanced',
    createdAt = 30,
    label = 'Layer',
    layerId = 'layer',
    visible = true,
    opacity,
    metadata = {},
  } = {}) {
    return {
      layerId,
      label,
      visible,
      opacity,
      createdAt,
      rep: { name: 'Node' },
      gridRes: 64,
      radiusKm: 7.5,
      metadata: {
        createdAt,
        settingsSnapshot: { scenarioProfile: scenario },
        ...metadata,
      },
    };
  }

  function fallbackLabel(result) {
    return `Generated ${result?.rep?.name ?? 'Layer'}`;
  }
});
