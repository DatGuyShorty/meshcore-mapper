import { describe, expect, it } from 'vitest';
import {
  coverageRunWarnings,
  coverageLayerDetailRows,
  coverageLayerSettingsSnapshot,
  createCoverageRunMetadata,
  formatCoverageLayerMeta,
  formatCoverageLayerTitle,
  groupCoverageLayersByScenario,
} from '../../src/coverageMetadata.js';

describe('coverage run metadata', () => {
  it('creates persisted metadata from a coverage run slice', () => {
    const metadata = createCoverageRunMetadata({
      result: {
        createdAt: 1710000000000,
        rep: { name: 'Ridge Node' },
        gridRes: 128,
        radiusKm: 5,
      },
      settings: {
        scenarioProfile: 'quick',
        computeBackend: 'cpu',
        qualityMult: 1,
        rxHeight: 1.5,
        rxSens: -133,
        fadeMargin: 10,
        spreadingFactor: 11,
        useLos: true,
        useFresnel: true,
        useFoliage: true,
        useBuildings: false,
        useGroundReflection: false,
        reflectionModel: 'two-ray',
        diffractionModel: 'deygout',
        deriveObstacleHeights: false,
      },
      backend: 'cpu',
      stats: { workerCount: 4, workerComputeMs: 123.4, insidePoints: 88 },
      metrics: {
        workerCount: 4,
        elevation: {
          memHits: 2,
          dbHits: 3,
          demTileRequests: 4,
          demTileMemHits: 1,
          demTileDbHits: 1,
          demTileNetFetches: 2,
          apiPoints: 12,
        },
      },
      obstacleWarnings: ['Foliage data incomplete.'],
      computeMs: 150.5,
    });

    expect(metadata).toMatchObject({
      version: 1,
      createdAt: 1710000000000,
      sourceNode: 'Ridge Node',
      backend: 'cpu',
      backendLabel: '4 CPU workers',
      gridRes: 128,
      radiusKm: 5,
      computeMs: 150.5,
      workerComputeMs: 123.4,
      workerCount: 4,
      insidePoints: 88,
      dataSources: { terrain: true, foliage: true, buildings: false },
      cache: {
        elevationCacheHits: 5,
        demTileRequests: 4,
        demTileCacheHits: 2,
        demTileNetFetches: 2,
        apiPoints: 12,
      },
      warnings: ['Foliage data incomplete.'],
    });
    expect(metadata.settingsSnapshot).toMatchObject({
      scenarioProfile: 'quick',
      computeBackend: 'cpu',
      spreadingFactor: 11,
      useLos: true,
      useFresnel: true,
    });
  });

  it('formats layer metadata for restored layers', () => {
    const result = {
      rep: { name: 'Restored Node' },
      gridRes: 64,
      radiusKm: 7.5,
      metadata: {
        backend: 'cuda',
        backendLabel: 'Python CUDA',
        settingsSnapshot: { scenarioProfile: 'balanced' },
        warnings: ['Terrain data gaps: 3 terrain samples defaulted to 0 m.'],
        cache: { demTileRequests: 3, demTileCacheHits: 2, demTileNetFetches: 1 },
        computeMs: 1250,
      },
    };

    expect(formatCoverageLayerMeta(result)).toBe('Python CUDA | 64x64 | 7.5 km | balanced | 1 warning');
    expect(formatCoverageLayerTitle(result)).toContain('Compute: 1.3s');
    expect(formatCoverageLayerTitle(result)).toContain('Warnings: Terrain data gaps');
    expect(coverageLayerDetailRows(result)).toEqual(expect.arrayContaining([
      ['Source', 'Restored Node'],
      ['Backend', 'Python CUDA'],
      ['Grid', '64x64'],
      ['Radius', '7.5 km'],
      ['Compute', '1.3s'],
      ['Scenario', 'balanced'],
      ['Cache', '2/3 DEM cached, 1 DEM fetched'],
      ['Warnings', 'Terrain data gaps: 3 terrain samples defaulted to 0 m.'],
    ]));
    expect(coverageLayerDetailRows({
      metadata: { warnings: '  Single restored warning.  ' },
    })).toEqual(expect.arrayContaining([
      ['Warnings', 'Single restored warning.'],
    ]));
  });

  it('builds reusable coverage control settings from layer metadata', () => {
    const settings = coverageLayerSettingsSnapshot({
      radiusKm: 7,
      rxHeight: 2.5,
      rxSens: -129,
      fadeMargin: 6,
      useLos: false,
      useFresnel: true,
      useGroundReflection: true,
      reflectionModel: 'six-ray',
      reflectionCoeff: 0.6,
      sideReflectionCoeff: 0.25,
      reflectionCorridorWidthM: 40,
      useBuildings: true,
      buildingLossPerM: 0.8,
      metadata: {
        backend: 'cpu',
        radiusKm: 8,
        settingsSnapshot: {
          scenarioProfile: 'urban',
          computeBackend: 'cuda',
          qualityMult: 2,
          useFoliage: true,
          foliageLossPerM: 0.2,
          deriveObstacleHeights: true,
          computeWorkerCount: 3,
          datasetBatchConcurrency: 2,
          demTileConcurrency: 5,
          foliageTileConcurrency: 4,
          buildingTileConcurrency: 4,
        },
      },
    });

    expect(settings).toEqual({
      'scenario-profile': 'urban',
      'compute-backend': 'cuda',
      'analysis-radius': '8',
      'grid-res': '2',
      'rx-height': '2.5',
      'rx-sensitivity': '-129',
      'fade-margin': '6',
      'use-los': false,
      'use-fresnel': true,
      'use-reflection': true,
      'reflection-model': 'six-ray',
      'reflection-coeff': '0.6',
      'side-reflection-coeff': '0.25',
      'reflection-corridor-width-m': '40',
      'use-foliage': true,
      'foliage-loss-per-m': '0.2',
      'use-buildings': true,
      'building-loss-per-m': '0.8',
      'compute-worker-count': '3',
      'dataset-batch-concurrency': '2',
      'dem-tile-concurrency': '5',
      'foliage-tile-concurrency': '4',
      'building-tile-concurrency': '4',
      'obstacle-height-mode': 'dsm-dem',
    });
  });

  it('falls back to basic metadata for legacy layers', () => {
    const result = {
      rep: { name: 'Legacy Node' },
      gridRes: 32,
      radiusKm: 12,
    };

    expect(formatCoverageLayerMeta(result)).toBe('Unknown backend | 32x32 | 12 km');
    expect(formatCoverageLayerTitle(result)).toContain('Source: Legacy Node');
  });

  it('builds durable warning text from terrain gaps and obstacle warnings', () => {
    const warnings = coverageRunWarnings({
      elevation: {
        elevationFilledFromNeighbour: 4,
        elevationDefaultedToZero: 2,
      },
    }, [' Buildings unavailable. ', '', null]);

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('4 terrain samples interpolated');
    expect(warnings[0]).toContain('2 terrain samples defaulted');
    expect(warnings[1]).toBe('Buildings unavailable.');
  });

  it('groups layers by scenario with newest groups last', () => {
    const groups = groupCoverageLayersByScenario([
      layer('quick', 20, 'Quick old'),
      layer(null, 10, 'Legacy'),
      layer('balanced', 40, 'Balanced'),
      layer('quick', 50, 'Quick new'),
    ]);

    expect(groups.map(group => group.label)).toEqual(['Legacy / unspecified', 'balanced', 'quick']);
    expect(groups.at(-1).layers.map(item => item.label)).toEqual(['Quick old', 'Quick new']);
  });

  function layer(scenarioProfile, createdAt, label) {
    return {
      label,
      createdAt,
      metadata: {
        createdAt,
        settingsSnapshot: { scenarioProfile },
      },
    };
  }
});
