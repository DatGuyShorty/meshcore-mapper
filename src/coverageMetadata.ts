export type CoverageRunMetadata = {
  version: 1;
  createdAt: number | null;
  sourceNode: string;
  backend: string;
  backendLabel: string;
  gridRes: number | null;
  radiusKm: number | null;
  computeMs: number | null;
  workerComputeMs: number | null;
  workerCount: number | null;
  insidePoints: number | null;
  settingsSnapshot: Record<string, any>;
  dataSources: { terrain: boolean; foliage: boolean; buildings: boolean };
  cache: CoverageCacheMetadata;
  warnings: string[];
};

export type CoverageCacheMetadata = {
  elevationCacheHits: number;
  demTileRequests: number;
  demTileCacheHits: number;
  demTileNetFetches: number;
  apiPoints: number;
};

export type CoverageDetailRow = [string, string];

export type CoverageScenarioGroup = {
  label: string;
  layers: any[];
  latestCreatedAt: number;
  firstIndex: number;
};

export function createCoverageRunMetadata({
  result,
  settings,
  backend,
  stats,
  metrics,
  obstacleWarnings = [],
  computeMs,
}: {
  result: any;
  settings: any;
  backend?: string | null;
  stats: any;
  metrics: any;
  obstacleWarnings?: string[];
  computeMs?: number;
}): CoverageRunMetadata {
  const e = metrics?.elevation ?? {};
  const backendName = typeof backend === 'string' && backend ? backend : 'unknown';
  return {
    version: 1,
    createdAt: _finiteOrNull(result?.createdAt),
    sourceNode: String(result?.rep?.name ?? 'Node'),
    backend: backendName,
    backendLabel: _backendLabel(backendName, stats?.workerCount ?? metrics?.workerCount),
    gridRes: _finiteOrNull(result?.gridRes),
    radiusKm: _finiteOrNull(result?.radiusKm),
    computeMs: _finiteOrNull(computeMs),
    workerComputeMs: _finiteOrNull(stats?.workerComputeMs),
    workerCount: _finiteOrNull(stats?.workerCount ?? metrics?.workerCount),
    insidePoints: _finiteOrNull(stats?.insidePoints),
    settingsSnapshot: _settingsSnapshot(settings),
    dataSources: {
      terrain: Boolean(settings?.useLos || settings?.useFresnel || settings?.useFoliage || settings?.useBuildings),
      foliage: Boolean(settings?.useFoliage),
      buildings: Boolean(settings?.useBuildings),
    },
    cache: {
      elevationCacheHits: _count(e.memHits) + _count(e.dbHits),
      demTileRequests: _count(e.demTileRequests),
      demTileCacheHits: _count(e.demTileMemHits) + _count(e.demTileDbHits),
      demTileNetFetches: _count(e.demTileNetFetches),
      apiPoints: _count(e.apiPoints),
    },
    warnings: coverageRunWarnings(metrics, obstacleWarnings),
  };
}

export function coverageRunWarnings(metrics: any, obstacleWarnings: string[] = []): string[] {
  const warnings: string[] = [];
  const e = metrics?.elevation ?? {};
  const filled = _count(e.elevationFilledFromNeighbour);
  const zeroed = _count(e.elevationDefaultedToZero);
  if (filled || zeroed) {
    const bits: string[] = [];
    if (filled) bits.push(`${filled.toLocaleString()} terrain samples interpolated from neighbours`);
    if (zeroed) bits.push(`${zeroed.toLocaleString()} terrain samples defaulted to 0 m`);
    warnings.push(`Terrain data gaps: ${bits.join(', ')}.`);
  }
  for (const warning of obstacleWarnings) {
    const text = String(warning ?? '').trim();
    if (text) warnings.push(text);
  }
  return warnings;
}

export function formatCoverageLayerMeta(result: any): string {
  const metadata = _metadata(result);
  const bits = [
    metadata.backendLabel,
    _gridText(metadata.gridRes ?? result?.gridRes),
    _radiusText(metadata.radiusKm ?? result?.radiusKm),
  ].filter(Boolean);
  const scenario = metadata.settingsSnapshot?.scenarioProfile;
  if (typeof scenario === 'string' && scenario) bits.push(scenario);
  if (metadata.warnings.length) bits.push(`${metadata.warnings.length} warning${metadata.warnings.length === 1 ? '' : 's'}`);
  return bits.join(' | ');
}

export function formatCoverageLayerTitle(result: any): string {
  const metadata = _metadata(result);
  const lines = [
    `Source: ${metadata.sourceNode}`,
    `Backend: ${metadata.backendLabel}`,
    `Grid: ${_gridText(metadata.gridRes ?? result?.gridRes) || 'unknown'}`,
    `Radius: ${_radiusText(metadata.radiusKm ?? result?.radiusKm) || 'unknown'}`,
  ];
  if (metadata.computeMs !== null) lines.push(`Compute: ${_duration(metadata.computeMs)}`);
  const cache = metadata.cache;
  if (cache.demTileRequests || cache.apiPoints || cache.elevationCacheHits) {
    lines.push(
      `Terrain cache: ${cache.elevationCacheHits.toLocaleString()} point hits, `
      + `${cache.demTileCacheHits.toLocaleString()}/${cache.demTileRequests.toLocaleString()} DEM tiles cached, `
      + `${cache.demTileNetFetches.toLocaleString()} DEM fetched, ${cache.apiPoints.toLocaleString()} API points`
    );
  }
  if (metadata.warnings.length) {
    lines.push(`Warnings: ${metadata.warnings.join(' ')}`);
  }
  return lines.join('\n');
}

export function coverageLayerDetailRows(result: any): CoverageDetailRow[] {
  const metadata = _metadata(result);
  const rows: CoverageDetailRow[] = [
    ['Source', metadata.sourceNode],
    ['Backend', metadata.backendLabel],
    ['Grid', _gridText(metadata.gridRes ?? result?.gridRes) || 'unknown'],
    ['Radius', _radiusText(metadata.radiusKm ?? result?.radiusKm) || 'unknown'],
  ];
  if (metadata.computeMs !== null) rows.push(['Compute', _duration(metadata.computeMs)]);
  if (metadata.workerCount !== null) rows.push(['Workers', String(Math.round(metadata.workerCount))]);
  if (metadata.insidePoints !== null) rows.push(['Inside cells', Math.round(metadata.insidePoints).toLocaleString()]);

  const scenario = metadata.settingsSnapshot?.scenarioProfile;
  if (typeof scenario === 'string' && scenario) rows.push(['Scenario', scenario]);

  const dataSources = _dataSourceText(metadata.dataSources);
  if (dataSources) rows.push(['Data', dataSources]);

  const cache = _cacheText(metadata.cache);
  if (cache) rows.push(['Cache', cache]);

  if (metadata.warnings.length) rows.push(['Warnings', metadata.warnings.join(' ')]);
  return rows;
}

export function coverageLayerSettingsSnapshot(result: any): Record<string, string | boolean> {
  const metadata = _metadata(result);
  const snapshot = metadata.settingsSnapshot ?? {};
  const settings: Record<string, string | boolean> = {};

  _setTextSetting(settings, 'scenario-profile', snapshot.scenarioProfile);
  _setTextSetting(
    settings,
    'compute-backend',
    snapshot.computeBackend ?? (metadata.backend === 'unknown' ? null : metadata.backend)
  );
  _setFiniteSetting(settings, 'analysis-radius', metadata.radiusKm ?? result?.radiusKm);
  _setFiniteSetting(settings, 'grid-res', snapshot.qualityMult);
  _setFiniteSetting(settings, 'rx-height', snapshot.rxHeight ?? result?.rxHeight);
  _setFiniteSetting(settings, 'rx-sensitivity', snapshot.rxSens ?? result?.rxSens);
  _setFiniteSetting(settings, 'fade-margin', snapshot.fadeMargin ?? result?.fadeMargin);
  _setBooleanSetting(settings, 'use-los', snapshot.useLos, result?.useLos);
  _setBooleanSetting(settings, 'use-fresnel', snapshot.useFresnel, result?.useFresnel);
  _setBooleanSetting(settings, 'use-reflection', snapshot.useGroundReflection, result?.useGroundReflection);
  _setTextSetting(settings, 'reflection-model', snapshot.reflectionModel ?? result?.reflectionModel);
  _setFiniteSetting(settings, 'reflection-coeff', snapshot.reflectionCoeff ?? result?.reflectionCoeff);
  _setFiniteSetting(settings, 'side-reflection-coeff', snapshot.sideReflectionCoeff ?? result?.sideReflectionCoeff);
  _setFiniteSetting(settings, 'reflection-corridor-width-m', snapshot.reflectionCorridorWidthM ?? result?.reflectionCorridorWidthM);
  _setBooleanSetting(settings, 'use-foliage', snapshot.useFoliage, Boolean(result?.foliage));
  _setFiniteSetting(settings, 'foliage-loss-per-m', snapshot.foliageLossPerM ?? result?.foliageLossPerM);
  _setBooleanSetting(settings, 'use-buildings', snapshot.useBuildings, result?.useBuildings);
  _setFiniteSetting(settings, 'building-loss-per-m', snapshot.buildingLossPerM ?? result?.buildingLossPerM);
  _setFiniteSetting(settings, 'compute-worker-count', snapshot.computeWorkerCount);
  _setFiniteSetting(settings, 'dataset-batch-concurrency', snapshot.datasetBatchConcurrency);
  _setFiniteSetting(settings, 'dem-tile-concurrency', snapshot.demTileConcurrency);
  _setFiniteSetting(settings, 'foliage-tile-concurrency', snapshot.foliageTileConcurrency);
  _setFiniteSetting(settings, 'building-tile-concurrency', snapshot.buildingTileConcurrency);

  if (typeof snapshot.deriveObstacleHeights === 'boolean') {
    settings['obstacle-height-mode'] = snapshot.deriveObstacleHeights ? 'dsm-dem' : 'osm';
  }

  return settings;
}

export function coverageScenarioLabel(result: any): string {
  const scenario = _metadata(result).settingsSnapshot?.scenarioProfile;
  if (typeof scenario === 'string' && scenario.trim()) return scenario.trim();
  return 'Legacy / unspecified';
}

export function groupCoverageLayersByScenario(results: any[]): CoverageScenarioGroup[] {
  const groups = new Map<string, CoverageScenarioGroup>();
  results.forEach((result, index) => {
    const label = coverageScenarioLabel(result);
    const createdAt = _finiteOrNull(result?.metadata?.createdAt ?? result?.createdAt) ?? index;
    const existing = groups.get(label);
    if (existing) {
      existing.layers.push(result);
      existing.latestCreatedAt = Math.max(existing.latestCreatedAt, createdAt);
      return;
    }
    groups.set(label, {
      label,
      layers: [result],
      latestCreatedAt: createdAt,
      firstIndex: index,
    });
  });
  return [...groups.values()]
    .sort((a, b) => (a.latestCreatedAt - b.latestCreatedAt) || (a.firstIndex - b.firstIndex));
}

function _finiteOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function _count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function _backendLabel(backend: string, workerCount: unknown): string {
  if (backend === 'cuda') return 'Python CUDA';
  if (backend === 'cpu') {
    const workers = _count(workerCount);
    return workers > 0 ? `${workers} CPU worker${workers === 1 ? '' : 's'}` : 'CPU workers';
  }
  return 'Unknown backend';
}

function _settingsSnapshot(settings: any): Record<string, any> {
  return {
    scenarioProfile: settings?.scenarioProfile ?? null,
    computeBackend: settings?.computeBackend ?? null,
    qualityMult: _finiteOrNull(settings?.qualityMult),
    rxHeight: _finiteOrNull(settings?.rxHeight),
    rxSens: _finiteOrNull(settings?.rxSens),
    fadeMargin: _finiteOrNull(settings?.fadeMargin),
    spreadingFactor: _finiteOrNull(settings?.spreadingFactor),
    useLos: Boolean(settings?.useLos),
    useFresnel: Boolean(settings?.useFresnel),
    useFoliage: Boolean(settings?.useFoliage),
    useBuildings: Boolean(settings?.useBuildings),
    useGroundReflection: Boolean(settings?.useGroundReflection),
    reflectionModel: settings?.reflectionModel ?? null,
    reflectionCoeff: _finiteOrNull(settings?.reflectionCoeff),
    sideReflectionCoeff: _finiteOrNull(settings?.sideReflectionCoeff),
    reflectionCorridorWidthM: _finiteOrNull(settings?.reflectionCorridorWidthM),
    foliageLossPerM: _finiteOrNull(settings?.foliageLossPerM),
    buildingLossPerM: _finiteOrNull(settings?.buildingLossPerM),
    diffractionModel: settings?.diffractionModel ?? null,
    deriveObstacleHeights: Boolean(settings?.deriveObstacleHeights),
    computeWorkerCount: _finiteOrNull(settings?.computeWorkerCount),
    datasetBatchConcurrency: _finiteOrNull(settings?.datasetBatchConcurrency),
    demTileConcurrency: _finiteOrNull(settings?.demTileConcurrency),
    foliageTileConcurrency: _finiteOrNull(settings?.foliageTileConcurrency),
    buildingTileConcurrency: _finiteOrNull(settings?.buildingTileConcurrency),
  };
}

function _metadata(result: any): CoverageRunMetadata {
  const m = result?.metadata ?? {};
  const backend = typeof m.backend === 'string' ? m.backend : 'unknown';
  return {
    version: 1,
    createdAt: _finiteOrNull(m.createdAt ?? result?.createdAt),
    sourceNode: String(m.sourceNode ?? result?.rep?.name ?? 'Node'),
    backend,
    backendLabel: typeof m.backendLabel === 'string' && m.backendLabel ? m.backendLabel : _backendLabel(backend, m.workerCount),
    gridRes: _finiteOrNull(m.gridRes ?? result?.gridRes),
    radiusKm: _finiteOrNull(m.radiusKm ?? result?.radiusKm),
    computeMs: _finiteOrNull(m.computeMs),
    workerComputeMs: _finiteOrNull(m.workerComputeMs),
    workerCount: _finiteOrNull(m.workerCount),
    insidePoints: _finiteOrNull(m.insidePoints),
    settingsSnapshot: m.settingsSnapshot ?? {},
    dataSources: m.dataSources ?? { terrain: false, foliage: false, buildings: false },
    cache: {
      elevationCacheHits: _count(m.cache?.elevationCacheHits),
      demTileRequests: _count(m.cache?.demTileRequests),
      demTileCacheHits: _count(m.cache?.demTileCacheHits),
      demTileNetFetches: _count(m.cache?.demTileNetFetches),
      apiPoints: _count(m.cache?.apiPoints),
    },
    warnings: Array.isArray(m.warnings) ? m.warnings.map(String).filter(Boolean) : [],
  };
}

function _gridText(gridRes: unknown): string {
  const n = _finiteOrNull(gridRes);
  return n === null ? '' : `${Math.round(n)}x${Math.round(n)}`;
}

function _radiusText(radiusKm: unknown): string {
  const n = _finiteOrNull(radiusKm);
  return n === null ? '' : `${n.toFixed(n >= 10 ? 0 : 1)} km`;
}

function _duration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function _dataSourceText(dataSources: { terrain?: boolean; foliage?: boolean; buildings?: boolean }): string {
  const parts: string[] = [];
  if (dataSources.terrain) parts.push('terrain');
  if (dataSources.foliage) parts.push('foliage');
  if (dataSources.buildings) parts.push('buildings');
  return parts.join(', ');
}

function _cacheText(cache: CoverageCacheMetadata): string {
  const parts: string[] = [];
  if (cache.elevationCacheHits) parts.push(`${cache.elevationCacheHits.toLocaleString()} point hits`);
  if (cache.demTileRequests) {
    parts.push(`${cache.demTileCacheHits.toLocaleString()}/${cache.demTileRequests.toLocaleString()} DEM cached`);
  }
  if (cache.demTileNetFetches) parts.push(`${cache.demTileNetFetches.toLocaleString()} DEM fetched`);
  if (cache.apiPoints) parts.push(`${cache.apiPoints.toLocaleString()} API points`);
  return parts.join(', ');
}

function _setTextSetting(target: Record<string, string | boolean>, id: string, value: unknown): void {
  if (typeof value !== 'string') return;
  const text = value.trim();
  if (text) target[id] = text;
}

function _setFiniteSetting(target: Record<string, string | boolean>, id: string, value: unknown): void {
  const n = _finiteOrNull(value);
  if (n !== null) target[id] = String(n);
}

function _setBooleanSetting(
  target: Record<string, string | boolean>,
  id: string,
  value: unknown,
  fallback: unknown,
): void {
  if (typeof value === 'boolean') {
    target[id] = value;
  } else if (typeof fallback === 'boolean') {
    target[id] = fallback;
  }
}
