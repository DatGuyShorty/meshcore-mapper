/**
 * coverage.ts - Coverage analysis and heatmap rendering.
 * Exports: init
 *
 * The orchestration here is heavy on Leaflet + DOM; this file keeps those
 * boundaries typed locally while preserving existing runtime behavior.
 */
import { state, clearCoverageLayers, clearCoverageOverlayTiles } from './map.js';
import {
  addCoverageOverlayTile,
  getMapViewportMetrics,
  onMapViewportChanged,
  setCoverageTileOpacityByLayer,
  setCoverageTileVisibilityByLayer,
  removeCoverageTilesByLayer,
} from './mapAdapter.js';
import {
  persistLayerData,
  deleteLayerData,
  loadAllLayerData,
  clearAllLayerData,
  readLayerPrefs,
  writeLayerPref,
  deleteLayerPref,
  clearAllLayerPrefs,
} from './coveragePersistence.js';
import { writePersistedSettingValue } from './settingsPersistence.js';
import {
  setProgress, hideProgress, setStatus, yieldToUI, setCancelHandler,
  setButtonBusy, setInlineStatus,
} from './ui.js';
import { fetchElevations, fetchElevationsFromTiles } from './elevation.js';
import { fetchFoliage } from './foliage.js';
import { fetchBuildings } from './buildings.js';
import { getCoverageSettings } from './settings.js';
import {
  type Bbox,
  buildElevationGridPoints,
  coverageBbox,
  elevationGridShape,
  unionBbox,
} from './coverageGrid.js';
import {
  cancelCoverageCompute,
  computeCoverage,
  type CoverageBackendProgress,
  formatCoverageBackendStatus,
  initCoverageBackends,
} from './coverageBackend.js';
import { applyScenarioProfile } from './scenarios.js';
import { colorizeSignalGrid, normalizeCoverageOverlayMode } from './signalOverlay.js';
import { deriveRadioMetrics, selectedModemText } from './radioMetrics.js';
import { bearingDeg, haversine } from './propagation.js';
import {
  buildCombinedCoverageOverlay,
  type CombinedCoverageSummary,
  coverageLayerSourceKey,
  normalizeCombinedCoverageOverlayMode,
  type NodeFailureSummary,
  summarizeCombinedCoverage,
  summarizeNodeFailureImpact,
} from './coverageNetwork.js';
import type { CoverageLayerPref, CoverageLayerRecord } from './coveragePersistence.js';
import type { CoverageOverlayMode } from './signalOverlay.js';
import type { ObstacleSet } from './signalModel.js';
import {
  type CoverageScenarioGroup,
  coverageLayerDetailRows,
  coverageLayerSettingsSnapshot,
  createCoverageRunMetadata,
  formatCoverageLayerMeta,
  formatCoverageLayerTitle,
  groupCoverageLayersByScenario,
} from './coverageMetadata.js';

type CancelToken = { cancelled: boolean };

type Repeater = Record<string, any> & {
  id?: string | number;
  name?: string;
  lat: number;
  lon: number;
  height?: number;
  power?: number;
  freq?: number;
  gain?: number;
  pattern?: string;
  azimuthDeg?: number;
  visible?: boolean;
};

type DirectionalMask = {
  sourceLat: number;
  sourceLon: number;
  targetLat: number;
  targetLon: number;
  sectorDeg: number;
};

type DirectionalCoverageDetail = {
  pointA?: { lat: number; lon: number };
  pointB?: { lat: number; lon: number };
  endpointARepeaterId?: string | number | null;
  radiusKm?: unknown;
  sectorDeg?: unknown;
};

type RunCoverageOptions = {
  directionalMask?: DirectionalMask | null;
  radiusKmOverride?: number | null;
};

type CoverageSettings = ReturnType<typeof getCoverageSettings>;

type CoverageMetrics = {
  repeaters: number;
  gridRes: number;
  radiusKm: number;
  elevationMs: number;
  osmMs: number;
  computeMs: number;
  workerComputeMs: number;
  renderMs: number;
  totalMs: number;
  insidePoints: number;
  workerCount: number;
  backendsUsed: Set<string>;
  elevation: Record<string, any>;
};

type CoverageResult = Record<string, any> & {
  rep?: Repeater;
  repId?: string | number;
  bounds?: Bbox;
  latMin?: number;
  latMax?: number;
  lonMin?: number;
  lonMax?: number;
  radiusKm?: number;
  rxHeight?: number;
  effectiveSens?: number;
  rxSens?: number;
  fadeMargin?: number;
  noiseFloorDbm?: number;
  requiredSnrDb?: number;
  requiredSnrWithMarginDb?: number;
  spreadingFactor?: number;
  useLos?: boolean;
  useFresnel?: boolean;
  diffractionModel?: string;
  useGroundReflection?: boolean;
  reflectionModel?: string;
  reflectionCoeff?: number;
  sideReflectionCoeff?: number;
  reflectionCorridorWidthM?: number;
  txElev?: number;
  elevGrid?: Float32Array | ArrayBuffer | ArrayBufferView;
  elevRes?: number;
  foliage?: ObstacleSet | null;
  foliageLossPerM?: number;
  useBuildings?: boolean;
  buildings?: ObstacleSet | null;
  buildingLossPerM?: number;
  profileTargetSpacingM?: number;
  profileMaxSamples?: number;
  signalGrid?: Float32Array | ArrayBuffer | ArrayBufferView | number[];
  losGrid?: Float32Array | ArrayBuffer | ArrayBufferView | number[];
  gridRes?: number;
  directionalMask?: DirectionalMask | null;
  metadata?: any;
  layerId?: string;
  createdAt?: number;
  label?: string;
  opacity?: number;
  visible?: boolean;
  _blobUrl?: string | null;
};

type ObstacleProgress = {
  foliageDone: number;
  foliageTotal: number;
  buildingsDone: number;
  buildingsTotal: number;
};

type ObstaclePayloadArgs = {
  useFoliage: boolean;
  useBuildings: boolean;
  unionBBox: Bbox;
  metrics: CoverageMetrics;
  signal: AbortSignal;
  foliageTileConcurrency: number;
  buildingTileConcurrency: number;
  datasetBatchConcurrency: number;
  deriveObstacleHeights: boolean;
  onProgress?: ((progress: ObstacleProgress) => void) | null;
};

type ObstaclePayloadResult = {
  foliagePayload: ObstacleSet | null;
  buildingsPayload: ObstacleSet | null;
  obstacleWarnings: string[];
};

type RenderTilesOptions = {
  opacity: number;
  repId: string | number;
  layerId?: string | null;
  visible?: boolean;
  shouldContinue?: (() => boolean) | null;
};

type NetworkRow = {
  label: string;
  value: string;
  action?: {
    text: string;
    handler: () => void;
  };
};

type AbortLikeError = Error & { cancelled?: boolean };

function _input(id: string): HTMLInputElement | null {
  return document.getElementById(id) as HTMLInputElement | null;
}

function _select(id: string): HTMLSelectElement | null {
  return document.getElementById(id) as HTMLSelectElement | null;
}

function _button(id: string): HTMLButtonElement | null {
  return document.getElementById(id) as HTMLButtonElement | null;
}

function _inputValue(id: string): string {
  return _input(id)?.value ?? _select(id)?.value ?? '';
}

function _persistedEl(id: string): HTMLInputElement | HTMLSelectElement | null {
  return document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
}

function _isAbort(err: unknown): boolean {
  const abortErr = err as Partial<AbortLikeError>;
  return Boolean(abortErr?.cancelled || abortErr?.name === 'AbortError');
}

function _errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function _coverageResults(): CoverageResult[] {
  return state.coverageResults as CoverageResult[];
}

function _repeaters(): Repeater[] {
  return state.repeaters as Repeater[];
}

let _isRunning = false;
let _cancelToken: CancelToken | null = null;
let _abortController: AbortController | null = null;
let _rerenderSerial = 0;
let _restoreSerial = 0;
let _combinedOverlaySerial = 0;
let _simulatedOfflineSourceKey: string | null = null;
let _simulatedOfflineLabel = '';

const MAX_COVERAGE_GRID_RES = 4096;
const MAX_COVERAGE_PIXELS = MAX_COVERAGE_GRID_RES * MAX_COVERAGE_GRID_RES;
const MAX_CPU_PIXELS = 16_777_216;
const COVERAGE_TILE_SIZE = 1024;
const COMBINED_COVERAGE_LAYER_ID = '__combined_network_overlay__';

export function cancelCoverage(): void {
  if (_cancelToken) _cancelToken.cancelled = true;
  if (_abortController) _abortController.abort();
  cancelCoverageCompute();
}

function _dispatchCoverageChanged(): void {
  document.dispatchEvent(new CustomEvent('coverage:changed'));
}

export async function runCoverageAnalysis(
  onlyId: string | number | null = null,
  options: RunCoverageOptions | null = null
): Promise<void> {
  if (_isRunning) return;
  const active: Repeater[] = onlyId !== null
    ? _repeaters().filter(r => r.id === onlyId)
    : _repeaters().filter(r => r.visible);

  if (active.length === 0) {
    const msg = _repeaters().length === 0
      ? 'Add at least one repeater first.'
      : 'No visible repeaters selected. Unhide at least one node.';
    setStatus(msg);
    setInlineStatus('coverage-status', msg, 'warning');
    return;
  }

  _isRunning = true;
  _cancelToken = { cancelled: false };
  _abortController = new AbortController();
  const signal = _abortController.signal;
  setCancelHandler(cancelCoverage);
  setButtonBusy('btn-compute', true, 'Computing...');
  setInlineStatus('coverage-status', `Computing ${active.length} visible node${active.length !== 1 ? 's' : ''}...`, 'info');

  const totalStart = performance.now();
  const step = (msg: string): void => {
    const elapsed = (performance.now() - totalStart).toFixed(1);
    console.info(`[coverage] [${elapsed}ms] ${msg}`);
  };
  const settings = getCoverageSettings();
  const directionalMask = options?.directionalMask ?? null;
  const radiusKmOverride = Number(options?.radiusKmOverride);
  const runtimeRadiusKm = Number.isFinite(radiusKmOverride) && radiusKmOverride > 0
    ? radiusKmOverride
    : settings.radiusKm;
  const {
    rxHeight, rxSens, fadeMargin,
    noiseFloorDbm, requiredSnrDb, requiredSnrWithMarginDb, spreadingFactor,
    useLos, useFresnel, useFoliage, foliageLossPerM,
    useGroundReflection, reflectionModel, reflectionCoeff, sideReflectionCoeff, reflectionCorridorWidthM,
    useBuildings, buildingLossPerM,
    computeWorkerCount, computeBackend, deriveObstacleHeights,
    diffractionModel, useDeygout,
    datasetBatchConcurrency,
    demTileConcurrency, foliageTileConcurrency, buildingTileConcurrency,
  } = settings;
  const needsFacadeBuildings = useLos && useGroundReflection && reflectionModel === 'facade';
  const needsBuildingPayload = useBuildings || needsFacadeBuildings;
  let jobWarningCount = 0;
  const jobMeta = {
    title: _coverageJobTitle(active, directionalMask),
    backend: _backendPreferenceLabel(computeBackend, computeWorkerCount),
  };
  const progress = (pct: number, msg: string): void => setProgress(pct, msg, {
    ...jobMeta,
    warningCount: jobWarningCount,
  });

  // Derive gridRes from the actual map zoom level so coverage pixels match screen pixels.
  // qualityMult: Fast=0.5×, Balanced=1×, High Detail=2×, Maximum=3×.
  // m/pixel at current zoom: 156543.034 * cos(lat) / 2^zoom (Web Mercator standard).
  const { zoom: _mapZoom, centerLat: _mapLat } = getMapViewportMetrics();
  const _mapMPerPx = 156543.034 * Math.cos(_mapLat * Math.PI / 180) / Math.pow(2, _mapZoom);
  const _diameterM = runtimeRadiusKm * 2000;
  // No fixed pixel ceiling — let radius × zoom drive the resolution.
  // Hard floor: 16 px. Hard cap: no denser than 2 m/cell to prevent runaway memory.
  const _maxByDensity = Math.floor(_diameterM / 2);
  const rawGridRes = Math.max(16, Math.min(_maxByDensity, Math.round(settings.qualityMult * _diameterM / _mapMPerPx)));
  const gridRes = _capGridResForMemory(rawGridRes);
  if (gridRes < rawGridRes) {
    console.warn(`[coverage] grid clamped ${rawGridRes} -> ${gridRes} to stay within memory limits`);
  }
  // Profile spacing scales continuously: target ~(m/cell) spacing, clamped to [5, 120].
  const _mPerCell = _diameterM / gridRes;
  const profileTargetSpacingM = Math.max(5, Math.min(120, Math.round(_mPerCell)));
  const profileMaxSamples = Math.max(256, Math.min(4096, Math.round(_diameterM / profileTargetSpacingM * 1.2)));

  const effectiveSens = rxSens + fadeMargin;
  const needsElevationGrid = useLos || useFoliage || needsBuildingPayload;
  const metrics = _makeMetrics(active.length, gridRes, runtimeRadiusKm);

  step('Settings: ' + JSON.stringify({
    radiusKm: runtimeRadiusKm,
    rxHeight,
    rxSens,
    fadeMargin,
    spreadingFactor,
    noiseFloorDbm,
    useLos,
    useFresnel,
    diffractionModel,
    reflectionModel: useGroundReflection ? reflectionModel : 'none',
    useFoliage,
    useBuildings,
    needsFacadeBuildings,
    computeBackend,
    computeWorkerCount,
    deriveObstacleHeights,
    qualityMult: settings.qualityMult,
    directionalMask: directionalMask ? {
      sectorDeg: directionalMask.sectorDeg,
      sourceLat: directionalMask.sourceLat,
      sourceLon: directionalMask.sourceLon,
      targetLat: directionalMask.targetLat,
      targetLon: directionalMask.targetLon,
    } : null,
  }));
  console.info(`[coverage] starting analysis - ${active.length} repeater(s), radius=${runtimeRadiusKm} km, zoom=${_mapZoom}, ~${_mapMPerPx.toFixed(1)} m/px, grid=${gridRes}x${gridRes} (zoom-matched, mult=${settings.qualityMult})`);
  progress(2, 'Initialising grid...');

  const repBboxes = active.map(rep => coverageBbox(rep, runtimeRadiusKm));
  const unionBBox = unionBbox(repBboxes);

  try {
    step('Fetching obstacle payloads...');
    const obstacleFetchStart = performance.now();
    const { foliagePayload, buildingsPayload, obstacleWarnings } = await _fetchObstaclePayloads({
      useFoliage, useBuildings: needsBuildingPayload, unionBBox, metrics, signal,
      foliageTileConcurrency,
      buildingTileConcurrency,
      datasetBatchConcurrency,
      deriveObstacleHeights,
      onProgress: (p: ObstacleProgress) => {
        const foliageRatio = useFoliage ? _ratio(p.foliageDone, p.foliageTotal) : 1;
        const buildingsRatio = needsBuildingPayload ? _ratio(p.buildingsDone, p.buildingsTotal) : 1;
        const enabled = (useFoliage ? 1 : 0) + (needsBuildingPayload ? 1 : 0);
        const combined = enabled ? ((foliageRatio + buildingsRatio) / enabled) : 1;
        const etaMs = _etaMs(obstacleFetchStart, combined);
        const pct = 5 + combined * 8;
        progress(
          pct,
          `Fetching obstacle data... foliage ${p.foliageDone}/${p.foliageTotal}, buildings ${p.buildingsDone}/${p.buildingsTotal}${etaMs !== null ? ` (ETA ${_fmtDuration(etaMs)})` : ''}`
        );
      },
    });
    if (obstacleWarnings.length) {
      const warning = obstacleWarnings.join(' ');
      jobWarningCount = obstacleWarnings.length;
      step(`Obstacle warnings: ${warning}`);
      setInlineStatus('coverage-status', warning, 'warning');
      progress(13, 'Obstacle warnings recorded.');
    }
    step(`Obstacle payloads ready: foliage=${foliagePayload ? 'yes' : 'no'}, buildings=${buildingsPayload ? 'yes' : 'no'}`);

    const slicePct = 85 / active.length;
    for (let ri = 0; ri < active.length; ri++) {
      _throwIfCancelled();
      const rep = active[ri];
      const bbox = repBboxes[ri];
      const basePct = 15 + slicePct * ri;
      const { latMin, latMax, lonMin, lonMax } = bbox;
      step(`${rep.name}: starting coverage slice ${ri + 1}/${active.length}`);

      progress(basePct, `${rep.name}: preparing terrain grid...`);
      const { elevTargetM, ELEV_RES } = elevationGridShape(gridRes, runtimeRadiusKm);
      console.debug(`[coverage] ${rep.name}: ELEV_RES=${ELEV_RES} (${(runtimeRadiusKm * 2000 / ELEV_RES).toFixed(0)} m/cell), grid=${gridRes}x${gridRes}, target=${elevTargetM} m`);

      const elevGridPoints = buildElevationGridPoints({ latMin, latMax, lonMin, lonMax, ELEV_RES });
      let txElev = 0;
      let gridElevsF32 = new Float32Array(ELEV_RES * ELEV_RES);

      if (needsElevationGrid) {
        step(`${rep.name}: fetching terrain data (${elevGridPoints.length} points)`);
        progress(basePct + slicePct * 0.1, `${rep.name}: fetching ${elevGridPoints.length.toLocaleString()} terrain points...`);
        const elevationStart = performance.now();

        // Tx point: use the full pipeline (mem → DB → tile → API) for highest accuracy.
        const [txElevResult] = await fetchElevations(
          [{ latitude: rep.lat, longitude: rep.lon }],
          metrics.elevation,
        { signal }
        );
        txElev = txElevResult;

        // Grid: sample DEM tiles directly — no point DB overhead for bulk raster queries.
        const terrainFetchStart = performance.now();
        const gridElevs = await fetchElevationsFromTiles(
          elevGridPoints,
          metrics.elevation,
          {
            signal,
            demTileConcurrency,
            targetResolutionM: Math.max(1, runtimeRadiusKm * 2000 / Math.max(1, ELEV_RES - 1)),
            onProgress: ({ completed, total }) => {
              const ratio = _ratio(completed, total);
              const etaMs = _etaMs(terrainFetchStart, ratio);
              const pct = basePct + slicePct * (0.1 + 0.35 * ratio);
              progress(
                pct,
                `${rep.name}: terrain tiles ${completed}/${total}${etaMs !== null ? ` (ETA ${_fmtDuration(etaMs)})` : ''}`
              );
            },
          }
        );
        metrics.elevationMs += performance.now() - elevationStart;
        if (typeof txElev !== 'number' || Number.isNaN(txElev)) {
          throw new Error(`Could not fetch elevation for ${rep.name}.`);
        }
        gridElevsF32 = new Float32Array(gridElevs);
        step(`${rep.name}: terrain ready, TX elevation ${txElev.toFixed(1)} m`);
      }

      _throwIfCancelled();
      progress(basePct + slicePct * 0.5, `${rep.name}: computing signal levels...`);
      const computeStart = performance.now();
      const computePayload = {
        gridElevs: gridElevsF32, gridRes, ELEV_RES,
        rep: {
          lat: rep.lat,
          lon: rep.lon,
          height: rep.height,
          power: rep.power,
          freq: rep.freq,
          gain: rep.gain ?? 0,
          pattern: rep.pattern ?? 'omni',
          azimuthDeg: rep.azimuthDeg ?? 0,
        },
        txElev, latMin, latMax, lonMin, lonMax,
        radiusKm: runtimeRadiusKm, rxHeight, effectiveSens, useLos, useFresnel,
        useGroundReflection, reflectionModel, reflectionCoeff, sideReflectionCoeff, reflectionCorridorWidthM,
        diffractionModel, useDeygout,
        useFoliage, foliageLossPerM, profileTargetSpacingM, profileMaxSamples,
        foliage: foliagePayload,
        useBuildings, buildingLossPerM,
        buildings: buildingsPayload,
      };
      const { rgba, signalGrid, losGrid, stats, backend } = await computeCoverage(computePayload, {
        backendPreference: computeBackend,
        workerCount: computeWorkerCount,
        signal,
        onProgress: (backendProgress: CoverageBackendProgress) => {
          const backendPct = typeof backendProgress === 'number'
            ? backendProgress
            : (backendProgress?.pct ?? 0);
          const stage = typeof backendProgress === 'object' && backendProgress?.stage
            ? ` (${_humanizeStage(backendProgress.stage)})`
            : '';
          const etaMs = _etaMs(computeStart, backendPct);
          progress(
            basePct + slicePct * (0.5 + 0.5 * backendPct),
            `${rep.name}: computing... ${Math.round(backendPct * 100)}%${stage}${etaMs !== null ? ` (ETA ${_fmtDuration(etaMs)})` : ''}`
          );
        },
      });
      const safeStats = stats ?? {};
      metrics.backendsUsed.add(backend);
      metrics.workerCount = Math.max(metrics.workerCount, Number(safeStats.workerCount ?? 0));
      const computeElapsedMs = performance.now() - computeStart;
      metrics.computeMs += computeElapsedMs;
      metrics.workerComputeMs += Number(safeStats.workerComputeMs ?? 0);
      metrics.insidePoints += Number(safeStats.insidePoints ?? 0);
      step(`${rep.name}: compute done via ${backend}, inside=${safeStats.insidePoints ?? 0}`);

      const expectedRgbaBytes = gridRes * gridRes * 4;
      const expectedSignalValues = gridRes * gridRes;
      if (!(rgba instanceof Uint8ClampedArray) || rgba.length !== expectedRgbaBytes) {
        throw new Error(
          `Coverage backend ${backend || 'unknown'} returned invalid RGBA buffer `
          + `(expected ${expectedRgbaBytes} bytes, got ${rgba?.length ?? 'undefined'}).`
        );
      }
      if (!(signalGrid instanceof Float32Array) || signalGrid.length !== expectedSignalValues) {
        throw new Error(
          `Coverage backend ${backend || 'unknown'} returned invalid signal grid `
          + `(expected ${expectedSignalValues} floats, got ${signalGrid?.length ?? 'undefined'}).`
        );
      }

      if (directionalMask) {
        _applyDirectionalMask(signalGrid, gridRes, { latMin, latMax, lonMin, lonMax }, directionalMask);
      }

      _throwIfCancelled();
      const renderStart = performance.now();
      const coverageResult: CoverageResult = {
        rep: {
          id: rep.id,
          name: rep.name,
          lat: rep.lat,
          lon: rep.lon,
          height: rep.height,
          power: rep.power,
          freq: rep.freq,
          gain: rep.gain ?? 0,
          pattern: rep.pattern ?? 'omni',
          azimuthDeg: rep.azimuthDeg ?? 0,
        },
        bounds: { latMin, latMax, lonMin, lonMax },
        radiusKm: runtimeRadiusKm,
        rxHeight,
        effectiveSens,
        rxSens,
        fadeMargin,
        noiseFloorDbm,
        requiredSnrDb,
        requiredSnrWithMarginDb,
        spreadingFactor,
        useLos,
        useFresnel,
        diffractionModel,
        useGroundReflection,
        reflectionModel,
        reflectionCoeff,
        sideReflectionCoeff,
        reflectionCorridorWidthM,
        txElev,
        elevGrid: gridElevsF32,
        elevRes: ELEV_RES,
        foliage: useFoliage ? foliagePayload : null,
        foliageLossPerM,
        useBuildings,
        buildings: needsBuildingPayload ? buildingsPayload : null,
        buildingLossPerM,
        profileTargetSpacingM,
        profileMaxSamples,
        signalGrid,
        losGrid,
        gridRes,
        directionalMask,
      };
      coverageResult.metadata = createCoverageRunMetadata({
        result: coverageResult,
        settings,
        backend,
        stats: safeStats,
        metrics,
        obstacleWarnings,
        computeMs: computeElapsedMs,
      });
      await _addCoverageLayer(coverageResult);
      metrics.renderMs += performance.now() - renderStart;
      step(`${rep.name}: overlay rendered`);
      console.debug(`[coverage] ${rep.name}: rendered ${gridRes}x${gridRes} signal overlay`);
    }

    progress(100, 'Done!');
    await yieldToUI();
    hideProgress();
    metrics.totalMs = performance.now() - totalStart;
    console.info('[coverage] metrics', metrics);
    step(`Complete (${metrics.totalMs.toFixed(1)}ms total)`);
    const summary = _formatPerformanceSummary(metrics);
    const dataQuality = _formatDataQualityNote(metrics, obstacleWarnings);
    setStatus(`Coverage computed for ${active.length} repeater(s). ${summary}`);
    if (dataQuality) {
      setInlineStatus('coverage-status', `${dataQuality} ${summary}`, 'warning');
    } else {
      setInlineStatus('coverage-status', summary, 'success');
    }
  } catch (err: unknown) {
    hideProgress();
    if (_isAbort(err)) {
      setStatus('Coverage analysis cancelled.');
      setInlineStatus('coverage-status', 'Coverage analysis cancelled.', 'warning');
    } else {
      setStatus(`Error: ${_errorMessage(err)}`);
      setInlineStatus('coverage-status', `Coverage error: ${_errorMessage(err)}`, 'error');
      console.error(err);
    }
  } finally {
    _isRunning = false;
    _cancelToken = null;
    _abortController = null;
    setCancelHandler(null);
    setButtonBusy('btn-compute', false);
  }
}

function _makeMetrics(repeaters: number, gridRes: number, radiusKm: number): CoverageMetrics {
  return {
    repeaters,
    gridRes,
    radiusKm,
    osmMs: 0,
    elevationMs: 0,
    computeMs: 0,
    workerComputeMs: 0,
    renderMs: 0,
    totalMs: 0,
    backendsUsed: new Set(),
    workerCount: 0,
    insidePoints: 0,
    elevation: {
      calls: 0,
      requestedPoints: 0,
      uniquePoints: 0,
      duplicatePoints: 0,
      memHits: 0,
      dbHits: 0,
      cacheMisses: 0,
      apiPoints: 0,
      apiRequests: 0,
      storedPoints: 0,
      demTileZoom: 0,
      demTileRequests: 0,
      demTileMemHits: 0,
      demTileDbHits: 0,
      demTileNetFetches: 0,
      demTileMisses: 0,
      demTilePoints: 0,
      elevationFilledFromNeighbour: 0,
      elevationDefaultedToZero: 0,
    },
  };
}

function _coverageJobTitle(active: Repeater[], directionalMask: DirectionalMask | null): string {
  if (directionalMask) return 'Directional Coverage';
  if (active.length === 1) return `Coverage: ${active[0].name || 'selected node'}`;
  return `Coverage: ${active.length} nodes`;
}

function _backendPreferenceLabel(preference: string, workerCount: number): string {
  if (preference === 'cuda') return 'Python CUDA';
  if (preference === 'cpu') {
    return `${workerCount || 'auto'} CPU worker${workerCount === 1 ? '' : 's'}`;
  }
  return 'Auto backend';
}

// Build a user-facing note when the coverage result rests on incomplete data:
// terrain samples interpolated/zeroed by the elevation fallback, or obstacle
// layers that were requested but could not be fetched. Returns '' when clean.
function _formatDataQualityNote(metrics: CoverageMetrics, obstacleWarnings: string[]): string {
  const parts = [];
  const e = metrics.elevation || {};
  const filled = e.elevationFilledFromNeighbour ?? 0;
  const zeroed = e.elevationDefaultedToZero ?? 0;
  if (filled || zeroed) {
    const bits = [];
    if (filled) bits.push(`${filled.toLocaleString()} interpolated from neighbours`);
    if (zeroed) bits.push(`${zeroed.toLocaleString()} defaulted to 0 m`);
    parts.push(`Terrain data gaps (${bits.join(', ')}) — affected areas may be inaccurate.`);
  }
  if (obstacleWarnings?.length) parts.push(obstacleWarnings.join(' '));
  return parts.join(' ');
}

async function _fetchObstaclePayloads({
  useFoliage,
  useBuildings,
  unionBBox,
  metrics,
  signal,
  foliageTileConcurrency,
  buildingTileConcurrency,
  datasetBatchConcurrency,
  deriveObstacleHeights,
  onProgress = null,
}: ObstaclePayloadArgs): Promise<ObstaclePayloadResult> {
  const osmStart = performance.now();
  let foliageData: ObstacleSet | null = null;
  let buildingData: ObstacleSet | null = null;
  const obstacleWarnings: string[] = [];

  const progressState = {
    foliageDone: 0,
    foliageTotal: useFoliage ? 1 : 0,
    buildingsDone: 0,
    buildingsTotal: useBuildings ? 1 : 0,
  };

  onProgress?.(progressState);

  const derivationSampleLimit = deriveObstacleHeights ? 100 : 0;

  const [foliageResult, buildingResult] = await Promise.all([
    useFoliage
      ? fetchFoliage(unionBBox.latMin, unionBBox.latMax, unionBBox.lonMin, unionBBox.lonMax, {
        signal,
        tileConcurrency: foliageTileConcurrency,
        datasetBatchConcurrency,
        deriveObstacleHeights,
        derivationSampleLimit,
        onProgress: ({ completed, total }) => {
          progressState.foliageDone = completed;
          progressState.foliageTotal = total;
          onProgress?.(progressState);
        },
      })
        .catch((e: unknown) => {
          if (_isAbort(e)) throw e;
          console.warn('Foliage fetch failed, skipping:', e);
          obstacleWarnings.push('Foliage losses were requested but vegetation data could not be loaded.');
          return null;
        })
      : Promise.resolve(null),
    useBuildings
      ? fetchBuildings(unionBBox.latMin, unionBBox.latMax, unionBBox.lonMin, unionBBox.lonMax, {
        signal,
        tileConcurrency: buildingTileConcurrency,
        datasetBatchConcurrency,
        deriveObstacleHeights,
        derivationSampleLimit,
        onProgress: ({ completed, total }) => {
          progressState.buildingsDone = completed;
          progressState.buildingsTotal = total;
          onProgress?.(progressState);
        },
      })
        .catch((e: unknown) => {
          if (_isAbort(e)) throw e;
          console.warn('Buildings fetch failed, skipping:', e);
          obstacleWarnings.push('Structure data was requested but could not be loaded.');
          return null;
        })
      : Promise.resolve(null),
  ]);

  foliageData = foliageResult;
  buildingData = buildingResult;
  metrics.osmMs += performance.now() - osmStart;

  return {
    foliagePayload: foliageData ? {
      polygons: foliageData.polygons,
      bboxes: foliageData.bboxes,
      canopyHeights: foliageData.canopyHeights,
      factors: foliageData.factors,
      holes: foliageData.holes,
      tileIndex: foliageData.tileIndex,
    } : null,
    buildingsPayload: buildingData ? {
      polygons: buildingData.polygons,
      bboxes: buildingData.bboxes,
      heights: buildingData.heights,
      holes: buildingData.holes,
      tileIndex: buildingData.tileIndex,
    } : null,
    obstacleWarnings,
  };
}

async function _renderCoverageOverlay(result: CoverageResult): Promise<void> {
  const gridRes = Number(result.gridRes);
  if (!Number.isFinite(gridRes) || gridRes <= 0) return;
  const signalGrid = _restorePersistedFloat32Array(result.signalGrid) as ArrayLike<number> | null | undefined;
  const losGrid = _restorePersistedFloat32Array(result.losGrid) as ArrayLike<number> | null | undefined;
  const rawBounds = result.bounds ?? result;
  const latMin = Number(rawBounds.latMin);
  const latMax = Number(rawBounds.latMax);
  const lonMin = Number(rawBounds.lonMin);
  const lonMax = Number(rawBounds.lonMax);
  if (![latMin, latMax, lonMin, lonMax].every(Number.isFinite)) return;
  const repId = result.rep?.id ?? result.repId;
  const layerId = result.layerId ?? null;
  const visible = result.visible !== false;
  const rgba = colorizeSignalGrid(signalGrid, gridRes, {
    mode: getCoverageOverlayMode(),
    effectiveSens: result.effectiveSens,
    noiseFloorDbm: result.noiseFloorDbm,
    requiredSnrWithMarginDb: result.requiredSnrWithMarginDb,
    losGrid,
  });
  let nonZeroAlpha = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] > 0) nonZeroAlpha++;
  }
  const rawOpacity = Number.isFinite(result.opacity) ? Number(result.opacity) : _defaultLayerOpacity();
  const opacity = Number.isFinite(rawOpacity) ? Math.max(0.05, Math.min(1, rawOpacity)) : 0.65;

  const tileCount = await _renderRgbaOverlayTiles(rgba, gridRes, { latMin, latMax, lonMin, lonMax }, {
    opacity,
    repId: repId ?? 'coverage',
    layerId,
    visible,
  });

  console.info(
    `[coverage] overlay added: ${gridRes}x${gridRes}, tiles=${tileCount}, ` +
    `nonZeroAlpha=${nonZeroAlpha.toLocaleString()}, opacity=${opacity}`
  );
}

async function _renderRgbaOverlayTiles(rgba: Uint8ClampedArray, gridRes: number, bounds: Bbox, {
  opacity,
  repId,
  layerId,
  visible = true,
  shouldContinue = null,
}: RenderTilesOptions): Promise<number> {
  const { latMin, latMax, lonMin, lonMax } = bounds;
  const rowDen = Math.max(1, gridRes - 1);
  const colDen = Math.max(1, gridRes - 1);
  const latSpan = latMax - latMin;
  const lonSpan = lonMax - lonMin;

  let tileCount = 0;
  for (let row0 = 0; row0 < gridRes; row0 += COVERAGE_TILE_SIZE) {
    if (shouldContinue && !shouldContinue()) return tileCount;
    const tileH = Math.min(COVERAGE_TILE_SIZE, gridRes - row0);
    for (let col0 = 0; col0 < gridRes; col0 += COVERAGE_TILE_SIZE) {
      if (shouldContinue && !shouldContinue()) return tileCount;
      const tileW = Math.min(COVERAGE_TILE_SIZE, gridRes - col0);
      const canvas = document.createElement('canvas');
      canvas.width = tileW;
      canvas.height = tileH;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      const imageData = ctx.createImageData(tileW, tileH);

      for (let tr = 0; tr < tileH; tr++) {
        const srcStart = ((row0 + tr) * gridRes + col0) * 4;
        const srcEnd = srcStart + tileW * 4;
        const dstStart = tr * tileW * 4;
        imageData.data.set(rgba.subarray(srcStart, srcEnd), dstStart);
      }
      ctx.putImageData(imageData, 0, 0);

      const blobUrl = await new Promise<string>((resolve, reject) => {
        canvas.toBlob(blob => blob
          ? resolve(URL.createObjectURL(blob))
          : reject(new Error('canvas.toBlob failed')));
      });
      if (shouldContinue && !shouldContinue()) {
        URL.revokeObjectURL(blobUrl);
        return tileCount;
      }

      const top = latMax - (row0 / rowDen) * latSpan;
      const bottom = latMax - ((row0 + tileH - 1) / rowDen) * latSpan;
      const left = lonMin + (col0 / colDen) * lonSpan;
      const right = lonMin + ((col0 + tileW - 1) / colDen) * lonSpan;

      addCoverageOverlayTile({
        blobUrl,
        bounds: [[bottom, left], [top, right]],
        opacity,
        repId,
        layerId,
        visible,
      });
      tileCount++;
    }
  }
  return tileCount;
}

function _defaultLayerOpacity(): number {
  const raw = parseFloat(_inputValue('coverage-opacity')) / 100;
  return Number.isFinite(raw) ? Math.max(0.05, Math.min(1, raw)) : 0.65;
}

function _makeLayerLabel(result: CoverageResult): string {
  const t = new Date(result.createdAt ?? Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const bits = [`${result.radiusKm}km`, `${result.gridRes}px`];
  if (result.useLos) bits.push('LoS');
  if (result.foliage) bits.push('foliage');
  if (result.useBuildings) bits.push('bldg');
  if (result.directionalMask) bits.push('dir');
  return `${result.rep?.name ?? 'Node'} · ${bits.join(' ')} · ${t}`;
}

/**
 * Strip non-persistable / oversized fields before writing a layer to storage.
 * Foliage and building payloads are dropped (heavy polygon arrays); restored
 * layers fall back to grid sampling for point inspection.
 */
function _serializeLayer(result: CoverageResult): CoverageLayerRecord {
  const { foliage: _foliage, buildings: _buildings, ...rest } = result;
  return {
    ...rest,
    elevGrid: _persistFloat32ArrayBuffer(rest.elevGrid),
    signalGrid: _persistFloat32ArrayBuffer(rest.signalGrid),
    losGrid: _persistFloat32ArrayBuffer(rest.losGrid),
  } as CoverageLayerRecord;
}

function _persistFloat32ArrayBuffer(value: unknown): unknown {
  if (!(value instanceof Float32Array)) return value;
  const copy = new ArrayBuffer(value.byteLength);
  new Uint8Array(copy).set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  return copy;
}

function _restorePersistedFloat32Array(value: unknown): unknown {
  if (value instanceof Float32Array) return value;
  if (value instanceof ArrayBuffer) return new Float32Array(value);
  if (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer) {
    return new Float32Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Float32Array(value.buffer, value.byteOffset, Math.floor(value.byteLength / 4));
  }
  return value;
}

/**
 * Register a freshly computed coverage result as a new persistent layer:
 * assign identity + UI state, render it, and persist its grid data.
 */
async function _addCoverageLayer(result: CoverageResult): Promise<void> {
  result.layerId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `cov_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  result.createdAt = Date.now();
  if (result.metadata) result.metadata.createdAt = result.createdAt;
  result.label = _makeLayerLabel(result);
  result.opacity = _defaultLayerOpacity();
  result.visible = true;
  _coverageResults().push(result);
  await _renderCoverageOverlay(result);
  if (_simulatedOfflineSourceKey) _applyLayerTileVisibility(result.layerId);
  try {
    await persistLayerData(_serializeLayer(result));
  } catch (err) {
    console.warn('[coverage] persist failed:', err);
  }
  _dispatchCoverageChanged();
  renderCoverageLayerList();
}

/** Reload persisted coverage layers from storage and render them. */
export async function restoreCoverageLayers(): Promise<void> {
  const serial = ++_restoreSerial;
  let records: CoverageResult[];
  try {
    records = await loadAllLayerData() as CoverageResult[];
  } catch (err) {
    console.warn('[coverage] restore failed:', err);
    return;
  }
  if (serial !== _restoreSerial) return;
  if (!records.length) return;
  const prefs = readLayerPrefs();
  records.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  for (const rec of records) {
    if (serial !== _restoreSerial) return;
    rec.foliage = null;
    rec.buildings = null;
    rec.elevGrid = _restorePersistedFloat32Array(rec.elevGrid) as CoverageResult['elevGrid'];
    rec.signalGrid = _restorePersistedFloat32Array(rec.signalGrid) as CoverageResult['signalGrid'];
    rec.losGrid = _restorePersistedFloat32Array(rec.losGrid) as CoverageResult['losGrid'];
    const p = rec.layerId ? (prefs[rec.layerId] || {}) : {};
    if (typeof p.label === 'string' && p.label.trim()) rec.label = p.label.trim();
    rec.opacity = Number.isFinite(p.opacity) ? p.opacity : (Number.isFinite(rec.opacity) ? rec.opacity : 0.65);
    rec.visible = p.visible !== false;
    _coverageResults().push(rec);
    await _renderCoverageOverlay(rec);
  }
  _dispatchCoverageChanged();
  renderCoverageLayerList();
  console.info(`[coverage] restored ${records.length} coverage layer(s) from storage`);
}

function _setLayerVisible(layerId: string, visible: boolean): void {
  const r = _coverageResults().find(x => x.layerId === layerId);
  if (r) r.visible = visible;
  _applyLayerTileVisibility(layerId);
  writeLayerPref(layerId, { visible });
  _dispatchCoverageChanged();
  renderCoverageNetworkSummary();
  rerenderCombinedCoverageOverlay().catch(err => console.warn('[coverage] combined overlay update failed:', err));
}

function _setLayerOpacity(layerId: string, opacity: number): void {
  const r = _coverageResults().find(x => x.layerId === layerId);
  if (r) r.opacity = opacity;
  setCoverageTileOpacityByLayer(layerId, opacity);
  writeLayerPref(layerId, { opacity });
}

function _setLayerLabel(layerId: string, value: unknown): string {
  const r = _coverageResults().find(x => x.layerId === layerId);
  if (!r) return '';
  const label = String(value ?? '').trim().slice(0, 120);
  if (!label) return r.label ?? _makeLayerLabel(r);
  r.label = label;
  writeLayerPref(layerId, { label });
  _dispatchCoverageChanged();
  return label;
}

function _setAllLayersOpacity(opacity: number): void {
  for (const r of _coverageResults()) {
    if (!r.layerId) continue;
    r.opacity = opacity;
    setCoverageTileOpacityByLayer(r.layerId, opacity);
    writeLayerPref(r.layerId, { opacity });
  }
  renderCoverageLayerList();
}

function _deleteCoverageLayer(layerId: string): void {
  removeCoverageTilesByLayer(layerId);
  state.coverageResults = _coverageResults().filter(x => x.layerId !== layerId);
  deleteLayerData(layerId).catch(err => console.warn('[coverage] delete persist failed:', err));
  deleteLayerPref(layerId);
  _dispatchCoverageChanged();
  if (_simulatedOfflineSourceKey && !_coverageResults().some(result => coverageLayerSourceKey(result) === _simulatedOfflineSourceKey)) {
    _simulatedOfflineSourceKey = null;
    _simulatedOfflineLabel = '';
  }
  renderCoverageLayerList();
}

/** Remove every coverage layer from the map and from durable storage. */
async function clearAllCoverageLayers(): Promise<void> {
  _restoreSerial++;
  _simulatedOfflineSourceKey = null;
  _simulatedOfflineLabel = '';
  clearCoverageLayers(); // removes tiles + resets state.coverageResults + dispatches
  try {
    await clearAllLayerData();
  } catch (err) {
    console.warn('[coverage] clear persist failed:', err);
  }
  clearAllLayerPrefs();
  renderCoverageLayerList();
}

export function renderCoverageLayerList(): void {
  renderCoverageNetworkSummary();
  rerenderCombinedCoverageOverlay().catch(err => console.warn('[coverage] combined overlay update failed:', err));
  const ul = document.getElementById('coverage-layer-list');
  if (!ul) return;
  ul.textContent = '';
  if (_coverageResults().length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-msg';
    li.textContent = 'No coverage layers yet. Compute coverage to add one.';
    ul.appendChild(li);
    return;
  }
  for (const group of groupCoverageLayersByScenario(_coverageResults())) {
    ul.appendChild(_coverageLayerGroupHeader(group));
    for (const r of group.layers) {
      ul.appendChild(_coverageLayerItem(r));
    }
  }
}

async function rerenderCombinedCoverageOverlay(): Promise<void> {
  const serial = ++_combinedOverlaySerial;
  removeCoverageTilesByLayer(COMBINED_COVERAGE_LAYER_ID);
  const mode = getCombinedCoverageOverlayMode();
  if (mode === 'none') return;

  const overlay = buildCombinedCoverageOverlay(_coverageResults(), {
    mode,
    minCoverageCount: getCombinedCoverageMinCount(),
    offlineSourceKeys: _offlineSourceKeys(),
  });
  if (serial !== _combinedOverlaySerial || overlay.status !== 'ready' || !overlay.rgba || !overlay.gridRes || !overlay.bounds) return;
  const tileCount = await _renderRgbaOverlayTiles(overlay.rgba, overlay.gridRes, overlay.bounds, {
    opacity: 0.72,
    repId: 'combined-network',
    layerId: COMBINED_COVERAGE_LAYER_ID,
    visible: true,
    shouldContinue: () => serial === _combinedOverlaySerial,
  });
  console.info(`[coverage] combined overlay added: mode=${mode}, grid=${overlay.gridRes}x${overlay.gridRes}, tiles=${tileCount}`);
}

function renderCoverageNetworkSummary(): void {
  const el = document.getElementById('coverage-network-summary');
  if (!el) return;
  const networkOptions = { offlineSourceKeys: _offlineSourceKeys() };
  const summary = summarizeCombinedCoverage(_coverageResults(), networkOptions);
  el.textContent = '';

  if (summary.status !== 'ready') {
    if (_simulatedOfflineSourceKey) el.appendChild(_simulatedOfflineBanner());
    const empty = document.createElement('div');
    empty.className = 'empty-msg';
    empty.textContent = summary.status === 'no-visible-layers'
      ? 'No visible coverage layers.'
      : 'No combined coverage yet.';
    el.appendChild(empty);
    return;
  }

  const head = document.createElement('div');
  head.className = 'coverage-network-head';
  const title = document.createElement('span');
  title.textContent = _simulatedOfflineSourceKey
    ? `Combined Network - ${_simulatedOfflineLabel} offline`
    : 'Combined Visible Network';
  const count = document.createElement('span');
  count.textContent = `${summary.visibleLayerCount} visible layer${summary.visibleLayerCount === 1 ? '' : 's'}`;
  head.append(title, count);
  if (_simulatedOfflineSourceKey) el.appendChild(_simulatedOfflineBanner());

  const metrics = document.createElement('div');
  metrics.className = 'coverage-network-metrics';
  for (const [label, value] of [
    ['Covered area', _fmtArea(summary.coveredAreaKm2)],
    ['Covered', _fmtPct(summary.coveredPct)],
    ['Uncovered', _fmtArea(summary.uncoveredAreaKm2)],
    ['Redundancy', _fmtPct(summary.redundancyPct)],
    ['Weak margin', _fmtPct(summary.weakPct)],
    ['Median margin', _fmtDb(summary.medianMarginDb)],
  ]) {
    const item = document.createElement('span');
    const k = document.createElement('b');
    k.textContent = label;
    const v = document.createElement('em');
    v.textContent = value;
    item.append(k, v);
    metrics.appendChild(item);
  }

  el.append(head, metrics);

  if (summary.topServing?.length) {
    const top = document.createElement('div');
    top.className = 'coverage-network-serving';
    top.textContent = `Top serving: ${summary.topServing
      .map(item => `${item.label} ${_fmtPct(item.pct)}`)
      .join(', ')}`;
    el.appendChild(top);
  }

  const details = document.createElement('details');
  details.className = 'coverage-network-details';
  const detailsSummary = document.createElement('summary');
  detailsSummary.textContent = 'Network stats';
  details.appendChild(detailsSummary);
  const dl = document.createElement('dl');
  for (const [label, value] of _networkStatsRows(summary)) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
  }
  details.appendChild(dl);
  el.appendChild(details);

  const failure = summarizeNodeFailureImpact(_coverageResults(), networkOptions);
  if (failure.status === 'ready') {
    const critical = document.createElement('details');
    critical.className = 'coverage-network-details coverage-network-critical';
    const criticalSummary = document.createElement('summary');
    criticalSummary.textContent = 'Critical nodes';
    critical.appendChild(criticalSummary);
    const criticalList = document.createElement('dl');
    for (const row of _nodeFailureRows(failure)) {
      const dt = document.createElement('dt');
      dt.textContent = row.label;
      const dd = document.createElement('dd');
      if (row.action) {
        const text = document.createElement('span');
        text.textContent = row.value;
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = row.action.text;
        button.addEventListener('click', row.action.handler);
        dd.append(text, button);
      } else {
        dd.textContent = row.value;
      }
      criticalList.append(dt, dd);
    }
    critical.appendChild(criticalList);
    el.appendChild(critical);
  }
}

function _networkStatsRows(summary: CombinedCoverageSummary): Array<[string, string]> {
  return [
    ['Analysis area', _fmtArea(summary.analysisAreaKm2)],
    ['Covered area', _fmtArea(summary.coveredAreaKm2)],
    ['Uncovered area', _fmtArea(summary.uncoveredAreaKm2)],
    ['Overlap area', _fmtArea(summary.overlapAreaKm2)],
    ['Weak-margin area', _fmtArea(summary.weakAreaKm2)],
    ['Average margin', _fmtDb(summary.averageMarginDb)],
    ['Median margin', _fmtDb(summary.medianMarginDb)],
    ['Best margin', _fmtDb(summary.bestMarginDb)],
    ['Sample grid', `${summary.sampleRows} x ${summary.sampleCols}`],
    ['Top serving', summary.topServing?.length
      ? summary.topServing.map(item => `${item.label} ${_fmtArea(item.areaKm2)} (${_fmtPct(item.pct)})`).join(', ')
      : 'n/a'],
  ];
}

function _nodeFailureRows(failure: NodeFailureSummary): NetworkRow[] {
  const rows: NetworkRow[] = [
    { label: 'Baseline covered', value: _fmtArea(failure.baselineCoveredAreaKm2) },
  ];
  for (const impact of (failure.impacts ?? []).slice(0, 5)) {
    rows.push({
      label: impact.label,
      value: `${_fmtArea(impact.lostAreaKm2)} lost (${_fmtPct(impact.lostPctOfNetwork)} of network, ${_fmtPct(impact.lostPctOfSourceCoverage)} of node coverage)`,
      action: {
        text: _simulatedOfflineSourceKey === impact.sourceKey ? 'Active' : 'Sim',
        handler: () => _setSimulatedOfflineSource(impact.sourceKey, impact.label),
      },
    });
  }
  return rows;
}

function _offlineSourceKeys(): string[] {
  return _simulatedOfflineSourceKey ? [_simulatedOfflineSourceKey] : [];
}

function _simulatedOfflineBanner(): HTMLElement {
  const banner = document.createElement('div');
  banner.className = 'coverage-network-sim';
  const text = document.createElement('span');
  text.textContent = `Simulating ${_simulatedOfflineLabel} offline`;
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.textContent = 'Clear';
  clear.addEventListener('click', _clearSimulatedOfflineSource);
  banner.append(text, clear);
  return banner;
}

function _setSimulatedOfflineSource(sourceKey: string, label: string): void {
  _simulatedOfflineSourceKey = sourceKey;
  _simulatedOfflineLabel = label;
  _applySimulatedOfflineTileVisibility();
  renderCoverageNetworkSummary();
  rerenderCombinedCoverageOverlay().catch(err => console.warn('[coverage] combined overlay update failed:', err));
  setInlineStatus('coverage-status', `Simulating ${label} offline. Clear the simulation to restore the network view.`, 'info');
}

function _clearSimulatedOfflineSource(): void {
  const label = _simulatedOfflineLabel;
  _simulatedOfflineSourceKey = null;
  _simulatedOfflineLabel = '';
  _applySimulatedOfflineTileVisibility();
  renderCoverageNetworkSummary();
  rerenderCombinedCoverageOverlay().catch(err => console.warn('[coverage] combined overlay update failed:', err));
  if (label) setInlineStatus('coverage-status', `Cleared ${label} offline simulation.`, 'info');
}

function _applyLayerTileVisibility(layerId: string): void {
  const result = _coverageResults().find(item => item.layerId === layerId);
  if (!result) return;
  const visible = result.visible !== false
    && (!_simulatedOfflineSourceKey || coverageLayerSourceKey(result) !== _simulatedOfflineSourceKey);
  setCoverageTileVisibilityByLayer(layerId, visible);
}

function _applySimulatedOfflineTileVisibility(): void {
  for (const result of _coverageResults()) {
    if (result?.layerId) _applyLayerTileVisibility(result.layerId);
  }
}

function _coverageLayerGroupHeader(group: CoverageScenarioGroup): HTMLElement {
  const li = document.createElement('li');
  li.className = 'coverage-layer-group';
  li.textContent = `${group.label} (${group.layers.length})`;
  return li;
}

function _coverageLayerItem(r: CoverageResult): HTMLElement {
    const layerId = r.layerId ?? '';
    const li = document.createElement('li');
    li.className = 'coverage-layer-item';
    li.dataset.layerId = layerId;

    const vis = document.createElement('input');
    vis.type = 'checkbox';
    vis.className = 'cov-layer-vis';
    vis.checked = r.visible !== false;
    vis.title = 'Show / hide this layer';

    const label = document.createElement('input');
    label.type = 'text';
    label.className = 'cov-layer-name-input';
    label.value = r.label ?? _makeLayerLabel(r);
    label.maxLength = 120;
    label.title = 'Coverage layer name';
    label.addEventListener('change', () => {
      label.value = _setLayerLabel(layerId, label.value);
    });
    label.addEventListener('blur', () => {
      label.value = _setLayerLabel(layerId, label.value);
    });
    label.addEventListener('keydown', e => {
      if (e.key === 'Enter') label.blur();
      if (e.key === 'Escape') {
        label.value = r.label ?? _makeLayerLabel(r);
        label.blur();
      }
    });

    const meta = document.createElement('span');
    meta.className = 'cov-layer-meta';
    meta.textContent = formatCoverageLayerMeta(r);
    meta.title = formatCoverageLayerTitle(r);

    const details = _coverageLayerDetails(r);

    const info = document.createElement('div');
    info.className = 'cov-layer-info';
    info.append(label, meta, details);

    const opacity = document.createElement('input');
    opacity.type = 'range';
    opacity.className = 'cov-layer-opacity';
    opacity.min = '5';
    opacity.max = '100';
    opacity.step = '5';
    const layerOpacity = Number.isFinite(r.opacity) ? Number(r.opacity) : 0.65;
    opacity.value = String(Math.round(layerOpacity * 100));
    opacity.title = 'Layer opacity';

    const useSettings = document.createElement('button');
    useSettings.type = 'button';
    useSettings.className = 'cov-layer-use';
    useSettings.textContent = 'Use';
    useSettings.title = 'Use this layer\'s settings';
    useSettings.addEventListener('click', () => _applyLayerSettings(r));

    const recompute = document.createElement('button');
    recompute.type = 'button';
    recompute.className = 'cov-layer-recompute';
    recompute.textContent = 'Run';
    recompute.title = 'Recompute this layer';
    recompute.addEventListener('click', () => {
      _recomputeLayer(r).catch(err => {
        const msg = `Coverage recompute failed: ${err.message}`;
        setStatus(msg);
        setInlineStatus('coverage-status', msg, 'error');
        console.error(err);
      });
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'cov-layer-del btn-icon';
    del.textContent = '✕';
    del.title = 'Delete this layer';
    del.addEventListener('click', () => {
      if (layerId) _deleteCoverageLayer(layerId);
    });

    li.append(vis, info, opacity, useSettings, recompute, del);
    return li;
}

function _applyLayerSettings(result: CoverageResult, { announce = true }: { announce?: boolean } = {}): number {
  const settings = coverageLayerSettingsSnapshot(result);
  const entries = Object.entries(settings);
  if (!entries.length) {
    if (announce) setInlineStatus('coverage-status', 'This layer has no stored settings to reuse.', 'warning');
    return 0;
  }

  let applied = 0;
  const scenario = settings['scenario-profile'];
  if (scenario !== undefined) {
    applied += writePersistedSettingValue(
      _persistedEl('scenario-profile'),
      scenario,
      { notify: true }
    ) ? 1 : 0;
  }

  for (const [id, value] of entries) {
    if (id === 'scenario-profile') continue;
    applied += writePersistedSettingValue(
      _persistedEl(id),
      value,
      { notify: true }
    ) ? 1 : 0;
  }

  updateQualityNote();
  updateLegendLabels();

  const label = result.label ?? _makeLayerLabel(result);
  const msg = applied
    ? `Loaded settings from "${label}". Review and compute coverage to add a fresh layer.`
    : 'Stored settings did not match any current controls.';
  if (announce) {
    setStatus(msg);
    setInlineStatus('coverage-status', msg, applied ? 'info' : 'warning');
  }
  return applied;
}

async function _recomputeLayer(result: CoverageResult): Promise<void> {
  if (_isRunning) {
    const msg = 'Coverage is already running. Cancel or wait before recomputing a layer.';
    setStatus(msg);
    setInlineStatus('coverage-status', msg, 'warning');
    return;
  }

  const source = _findLayerSourceRepeater(result);
  const label = result.label ?? _makeLayerLabel(result);
  if (!source) {
    const sourceName = result?.rep?.name ? ` "${result.rep.name}"` : '';
    const msg = `Cannot recompute "${label}": source node${sourceName} is not in the current project.`;
    setStatus(msg);
    setInlineStatus('coverage-status', msg, 'warning');
    return;
  }

  const applied = _applyLayerSettings(result, { announce: false });
  if (!applied) {
    const msg = `Cannot recompute "${label}": no stored settings matched current controls.`;
    setStatus(msg);
    setInlineStatus('coverage-status', msg, 'warning');
    return;
  }

  const msg = `Recomputing "${label}" from ${source.name}...`;
  setStatus(msg);
  setInlineStatus('coverage-status', msg, 'info');
  await runCoverageAnalysis(source.id);
}

function _findLayerSourceRepeater(result: CoverageResult): Repeater | null {
  const source: Partial<Repeater> = result?.rep ?? {};
  if (source.id !== undefined && source.id !== null) {
    const byId = _repeaters().find(r => String(r.id) === String(source.id));
    if (byId) return byId;
  }

  const name = typeof source.name === 'string' ? source.name.trim() : '';
  const lat = Number(source.lat);
  const lon = Number(source.lon);
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  return _repeaters().find(r => (
    String(r.name ?? '').trim() === name
    && Math.abs(Number(r.lat) - lat) < 1e-5
    && Math.abs(Number(r.lon) - lon) < 1e-5
  )) ?? null;
}

function _coverageLayerDetails(result: CoverageResult): HTMLElement {
  const details = document.createElement('details');
  details.className = 'cov-layer-details';

  const summary = document.createElement('summary');
  summary.textContent = 'Details';
  details.appendChild(summary);

  const dl = document.createElement('dl');
  for (const [label, value] of coverageLayerDetailRows(result)) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    if (label === 'Warnings') dd.className = 'cov-layer-warning';
    dl.append(dt, dd);
  }
  details.appendChild(dl);
  return details;
}

function _initCoverageLayerListUi(): void {
  const ul = document.getElementById('coverage-layer-list');
  if (!ul) return;
  ul.addEventListener('change', e => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const li = target.closest('.coverage-layer-item');
    const layerId = (li as HTMLElement | null)?.dataset.layerId;
    if (!layerId) return;
    if (target.classList.contains('cov-layer-vis')) {
      _setLayerVisible(layerId, (target as HTMLInputElement).checked);
    }
  });
  ul.addEventListener('input', e => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (!target.classList.contains('cov-layer-opacity')) return;
    const li = target.closest('.coverage-layer-item');
    const layerId = (li as HTMLElement | null)?.dataset.layerId;
    if (!layerId) return;
    const opacity = parseFloat((target as HTMLInputElement).value) / 100;
    if (Number.isFinite(opacity)) _setLayerOpacity(layerId, opacity);
  });
}

function _throwIfCancelled(): void {
  if (!_cancelToken?.cancelled && !_abortController?.signal.aborted) return;
  const err = new Error('Cancelled') as AbortLikeError;
  err.cancelled = true;
  throw err;
}

function _formatPerformanceSummary(metrics: CoverageMetrics): string {
  const e = metrics.elevation;
  const cacheHits = (e.memHits ?? 0) + (e.dbHits ?? 0);
  const demHits = (e.demTileMemHits ?? 0) + (e.demTileDbHits ?? 0);
  return `Total ${_fmtMs(metrics.totalMs)}. ` +
    `Elevation ${_fmtMs(metrics.elevationMs)} (${cacheHits.toLocaleString()} cache hits, ` +
    `${(e.demTileRequests ?? 0).toLocaleString()} DEM tiles z${e.demTileZoom || '-'} ` +
    `(${demHits.toLocaleString()} cached, ${(e.demTileNetFetches ?? 0).toLocaleString()} fetched), ` +
    `${(e.apiPoints ?? 0).toLocaleString()} API points, ${(e.duplicatePoints ?? 0).toLocaleString()} deduped). ` +
    `OSM ${_fmtMs(metrics.osmMs)}, compute ${_fmtMs(metrics.computeMs)} via ${_backendLabel(metrics)}, render ${_fmtMs(metrics.renderMs)}.`;
}

function _backendLabel(metrics: CoverageMetrics): string {
  const backends = [...(metrics.backendsUsed ?? [])];
  if (!backends.length) return `${metrics.workerCount} CPU worker${metrics.workerCount !== 1 ? 's' : ''}`;
  return backends.map(b => {
    if (b === 'cuda') return 'Python CUDA';
    return `${metrics.workerCount} CPU worker${metrics.workerCount !== 1 ? 's' : ''}`;
  }).join(', ');
}

function _fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function _fmtArea(km2: unknown): string {
  const n = Number(km2);
  if (!Number.isFinite(n) || n <= 0) return '0 km2';
  if (n < 1) return `${(n * 100).toFixed(1)} ha`;
  return `${n.toFixed(n >= 10 ? 0 : 1)} km2`;
}

function _fmtPct(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(n >= 10 ? 0 : 1)}%` : 'n/a';
}

function _fmtDb(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(1)} dB` : 'n/a';
}

function _ratio(done: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(1, done / total));
}

function _etaMs(startTs: number, progressRatio: number): number | null {
  if (!Number.isFinite(progressRatio) || progressRatio <= 0 || progressRatio >= 1) return null;
  const elapsed = performance.now() - startTs;
  return elapsed * (1 - progressRatio) / progressRatio;
}

function _fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '...';
  const sec = Math.ceil(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}

function _humanizeStage(stage: unknown): string {
  if (!stage) return 'compute';
  return String(stage).replace(/[-_]/g, ' ');
}

export function getCoverageOverlayMode(): CoverageOverlayMode {
  return normalizeCoverageOverlayMode(_inputValue('coverage-overlay-mode'));
}

function getCombinedCoverageOverlayMode() {
  return normalizeCombinedCoverageOverlayMode(_inputValue('coverage-network-overlay'));
}

function getCombinedCoverageMinCount(): number {
  const value = parseInt(_inputValue('coverage-min-count'), 10);
  return Number.isFinite(value) ? Math.max(1, Math.min(8, value)) : 2;
}

export async function rerenderCoverageOverlays(): Promise<void> {
  const serial = ++_rerenderSerial;
  clearCoverageOverlayTiles();
  for (const result of _coverageResults()) {
    if (serial !== _rerenderSerial) return;
    await _renderCoverageOverlay(result);
  }
  if (serial === _rerenderSerial) await rerenderCombinedCoverageOverlay();
  _dispatchCoverageChanged();
}

function updateQualityNote(): void {
  const qualityMult = parseFloat(_inputValue('grid-res'));
  const radiusKm = parseFloat(_inputValue('analysis-radius')) || 15;
  const q = Number.isFinite(qualityMult) ? qualityMult : 1;
  const { centerLat, zoom } = getMapViewportMetrics();
  const mPerPx = 156543.034 * Math.cos(centerLat * Math.PI / 180) / Math.pow(2, zoom);
  const diameterM = radiusKm * 2000;
  const maxByDensity = Math.floor(diameterM / 2);
  const rawGridRes = Math.max(16, Math.min(maxByDensity, Math.round(q * diameterM / mPerPx)));
  const gridRes = _capGridResForMemory(rawGridRes);
  const cells = gridRes * gridRes;
  const metersPerPixel = Math.round((radiusKm * 2000) / gridRes);
  const label = q >= 3 ? 'Maximum'
    : q >= 2 ? 'High Detail'
    : q >= 1 ? 'Balanced'
    : 'Fast';
  const el = document.getElementById('quality-note');
  if (el) {
    const capped = gridRes < rawGridRes ? ' (capped for memory)' : '';
    el.textContent = `${label} (${q.toFixed(1)}x): ${gridRes} x ${gridRes} signal pixels (${cells.toLocaleString()} samples), about ${metersPerPixel} m per pixel at this radius${capped}.`;
  }
}

function _capGridResForMemory(rawGridRes: number): number {
  const byPixels = Math.floor(Math.sqrt(MAX_COVERAGE_PIXELS));
  const byCpu = Math.floor(Math.sqrt(MAX_CPU_PIXELS));
  const cap = Math.min(MAX_COVERAGE_GRID_RES, byPixels, byCpu);
  // Keep output buffers renderer-safe; very large canvases can crash Electron and blank the window.
  return Math.max(16, Math.min(rawGridRes, cap));
}

function updateLegendLabels(): void {
  const rxSens = parseFloat(_inputValue('rx-sensitivity'));
  const fadeMargin = parseFloat(_inputValue('fade-margin'));
  const sens = Number.isFinite(rxSens) ? rxSens : -137;
  const fade = Number.isFinite(fadeMargin) ? fadeMargin : 0;
  const radio = deriveRadioMetrics({
    modemText: selectedModemText(),
    rxSens: sens,
    fadeMargin: fade,
  });
  const mode = getCoverageOverlayMode();
  const legend = document.getElementById('map-legend');
  if (legend) {
    legend.dataset.mode = mode;
    legend.setAttribute('aria-label', `${_overlayModeLabel(mode)} legend`);
  }

  if (mode === 'rssi') {
    _setLegendLabels('RSSI', [
      ['legend-strong', '-60 dBm Strong'],
      ['legend-good', '-80 dBm Good'],
      ['legend-marginal', '-95 dBm Marginal'],
      ['legend-weak', '-110 dBm Weak'],
      ['legend-threshold', '-125 dBm Low'],
    ]);
    return;
  }

  if (mode === 'snr') {
    const req = radio.requiredSnrWithMarginDb;
    _setLegendLabels(`SNR (SF${radio.spreadingFactor})`, [
      ['legend-strong', '+20 dB High'],
      ['legend-good', '+10 dB Good'],
      ['legend-marginal', '0 dB Clear'],
      ['legend-weak', `${_fmtSignedDb(req)} Required`],
      ['legend-threshold', `${_fmtSignedDb(req - 10)} Low`],
    ]);
    return;
  }

  if (mode === 'los') {
    _setLegendLabels('LoS clearance', [
      ['legend-strong', 'Clear (≥1 Fresnel)'],
      ['legend-good', 'Grazing (~0.6)'],
      ['legend-marginal', 'Partial Fresnel'],
      ['legend-weak', 'Blocked edge'],
      ['legend-threshold', 'Obstructed (NLoS)'],
    ]);
    return;
  }

  const threshold = sens + fade;
  _setLegendLabels('Coverage Margin', [
    ['legend-strong', `${Math.round(threshold + 50)} dBm / +50 dB Strong`],
    ['legend-good', `${Math.round(threshold + 38)} dBm / +38 dB Good`],
    ['legend-marginal', `${Math.round(threshold + 25)} dBm / +25 dB Marginal`],
    ['legend-weak', `${Math.round(threshold + 13)} dBm / +13 dB Weak`],
    ['legend-threshold', `${Math.round(threshold)} dBm / 0 dB Threshold`],
  ]);
}

function _setLegendLabels(title: string, rows: Array<[string, string]>): void {
  const titleEl = document.getElementById('legend-title') ?? document.querySelector('#map-legend .legend-title');
  if (titleEl) titleEl.textContent = title;
  for (const [id, text] of rows) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }
}

function _overlayModeLabel(mode: CoverageOverlayMode): string {
  if (mode === 'rssi') return 'RSSI';
  if (mode === 'snr') return 'SNR';
  if (mode === 'los') return 'LoS clearance';
  return 'Coverage margin';
}

function _fmtSignedDb(value: unknown): string {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  return `${safe >= 0 ? '+' : ''}${safe.toFixed(1)} dB`;
}

export function init(): void {
  setCancelHandler(cancelCoverage);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && _isRunning) cancelCoverage(); });
  initCoverageBackends().then(status => {
    const text = formatCoverageBackendStatus(status);
    console.info(`[coverage] ${text}`);
    setInlineStatus('backend-status', text, 'info');
  });
  _button('btn-compute')?.addEventListener('click', () => runCoverageAnalysis());
  document.addEventListener('p2p:run-directional-coverage', (e: Event) => {
    const detail = (e as CustomEvent<DirectionalCoverageDetail>).detail;
    if (!detail?.pointA || !detail?.pointB) return;

    let sourceId = detail.endpointARepeaterId ?? null;
    if (sourceId == null) {
      let best: { id?: string | number; distM: number } | null = null;
      for (const rep of _repeaters()) {
        const d = haversine(rep.lat, rep.lon, detail.pointA.lat, detail.pointA.lon);
        if (!best || d < best.distM) best = { id: rep.id, distM: d };
      }
      if (!best || best.id == null || best.distM > 60) {
        setStatus('Directional coverage needs point A on/near a repeater (<= 60 m).');
        setInlineStatus('coverage-status', 'Directional coverage aborted: point A not tied to a source repeater.', 'warning');
        return;
      }
      sourceId = best.id;
    }
    if (sourceId == null) return;

    runCoverageAnalysis(sourceId, {
      radiusKmOverride: Number(detail.radiusKm),
      directionalMask: {
        sourceLat: detail.pointA.lat,
        sourceLon: detail.pointA.lon,
        targetLat: detail.pointB.lat,
        targetLon: detail.pointB.lon,
        sectorDeg: Math.max(10, Math.min(180, Number(detail.sectorDeg) || 60)),
      },
    }).catch(err => {
      setInlineStatus('coverage-status', `Directional coverage failed: ${_errorMessage(err)}`, 'error');
      console.error(err);
    });
  });
  document.getElementById('scenario-profile')?.addEventListener('change', e => {
    const target = e.target as HTMLSelectElement | null;
    if (target) applyScenarioProfile(target.value);
    updateQualityNote();
    updateLegendLabels();
  });

  ['grid-res', 'analysis-radius', 'compute-backend', 'obstacle-height-mode'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', updateQualityNote);
    document.getElementById(id)?.addEventListener('input', updateQualityNote);
  });
  onMapViewportChanged(updateQualityNote);
  ['rx-sensitivity', 'fade-margin', 'modem-preset'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', updateLegendLabels);
    document.getElementById(id)?.addEventListener('input', updateLegendLabels);
  });
  document.getElementById('coverage-overlay-mode')?.addEventListener('change', () => {
    updateLegendLabels();
    rerenderCoverageOverlays().catch(err => {
      setInlineStatus('coverage-status', `Overlay render error: ${_errorMessage(err)}`, 'error');
      console.error(err);
    });
  });
  document.getElementById('coverage-network-overlay')?.addEventListener('change', () => {
    rerenderCombinedCoverageOverlay().catch(err => {
      setInlineStatus('coverage-status', `Network overlay error: ${_errorMessage(err)}`, 'error');
      console.error(err);
    });
  });
  document.getElementById('coverage-min-count')?.addEventListener('input', () => {
    rerenderCombinedCoverageOverlay().catch(err => {
      setInlineStatus('coverage-status', `Network overlay error: ${_errorMessage(err)}`, 'error');
      console.error(err);
    });
  });
  document.getElementById('coverage-min-count')?.addEventListener('change', () => {
    rerenderCombinedCoverageOverlay().catch(err => {
      setInlineStatus('coverage-status', `Network overlay error: ${_errorMessage(err)}`, 'error');
      console.error(err);
    });
  });
  updateQualityNote();
  updateLegendLabels();

  document.getElementById('coverage-opacity')?.addEventListener('input', e => {
    const target = e.target as HTMLInputElement | null;
    const opacity = parseFloat(target?.value ?? '') / 100;
    if (!Number.isFinite(opacity)) return;
    _setAllLayersOpacity(Math.max(0.05, Math.min(1, opacity)));
    _dispatchCoverageChanged();
  });

  _initCoverageLayerListUi();
  restoreCoverageLayers().catch(err => console.warn('[coverage] restore failed:', err));

  const foliageToggle = _input('use-foliage');
  const foliageRow = _input('foliage-loss-per-m')?.closest('label') as HTMLElement | null;
  const toggleFoliageRow = (): void => {
    if (!foliageToggle || !foliageRow) return;
    foliageRow.style.display = foliageToggle.checked ? '' : 'none';
  };
  foliageToggle?.addEventListener('change', toggleFoliageRow);
  toggleFoliageRow();

  const buildingToggle = _input('use-buildings');
  const buildingRow = _input('building-loss-per-m')?.closest('label') as HTMLElement | null;
  const toggleBuildingRow = (): void => {
    if (!buildingToggle || !buildingRow) return;
    buildingRow.style.display = buildingToggle.checked ? '' : 'none';
  };
  buildingToggle?.addEventListener('change', toggleBuildingRow);
  toggleBuildingRow();

  const reflectionToggle = _input('use-reflection');
  const reflectionModelSelect = _select('reflection-model');
  const reflectionCoeff = _input('reflection-coeff');
  const sideReflectionCoeff = _input('side-reflection-coeff');
  const reflectionCorridorWidth = _input('reflection-corridor-width-m');
  const toggleReflectionControls = (): void => {
    if (!reflectionToggle || !reflectionModelSelect || !reflectionCoeff || !sideReflectionCoeff || !reflectionCorridorWidth) return;
    const enabled = reflectionToggle.checked;
    const sixRay = enabled && reflectionModelSelect.value === 'six-ray';
    const wallModel = enabled && (reflectionModelSelect.value === 'six-ray' || reflectionModelSelect.value === 'facade');
    reflectionModelSelect.disabled = !enabled;
    reflectionCoeff.disabled = !enabled;
    sideReflectionCoeff.disabled = !wallModel;
    reflectionCorridorWidth.disabled = !sixRay;
  };
  reflectionToggle?.addEventListener('change', toggleReflectionControls);
  reflectionModelSelect?.addEventListener('change', toggleReflectionControls);
  toggleReflectionControls();

  _button('btn-clear-coverage')?.addEventListener('click', async () => {
    setStatus('Clearing coverage layers...');
    setInlineStatus('coverage-status', 'Clearing coverage layers...', 'info');
    await clearAllCoverageLayers();
    setStatus('Coverage cleared.');
    setInlineStatus('coverage-status', 'All coverage layers cleared.', 'info');
  });
}

function _shortestAngleDiffDeg(a: number, b: number): number {
  const da = ((a % 360) + 360) % 360;
  const db = ((b % 360) + 360) % 360;
  const d = Math.abs(da - db);
  return d > 180 ? 360 - d : d;
}

function _applyDirectionalMask(signalGrid: Float32Array, gridRes: number, bounds: Bbox, directionalMask: DirectionalMask): void {
  const { latMin, latMax, lonMin, lonMax } = bounds;
  const centerBearing = bearingDeg(
    directionalMask.sourceLat,
    directionalMask.sourceLon,
    directionalMask.targetLat,
    directionalMask.targetLon
  );
  const halfSector = Math.max(5, Math.min(90, (directionalMask.sectorDeg ?? 60) / 2));
  const rowDen = Math.max(1, gridRes - 1);
  const colDen = Math.max(1, gridRes - 1);

  for (let r = 0; r < gridRes; r++) {
    const rf = r / rowDen;
    const lat = latMax - rf * (latMax - latMin);
    for (let c = 0; c < gridRes; c++) {
      const cf = c / colDen;
      const lon = lonMin + cf * (lonMax - lonMin);
      const idx = r * gridRes + c;
      const distM = haversine(directionalMask.sourceLat, directionalMask.sourceLon, lat, lon);
      if (distM < 3) continue;
      const b = bearingDeg(directionalMask.sourceLat, directionalMask.sourceLon, lat, lon);
      if (_shortestAngleDiffDeg(centerBearing, b) > halfSector) {
        signalGrid[idx] = -200;
      }
    }
  }
}
