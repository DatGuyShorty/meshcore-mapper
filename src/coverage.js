/**
 * coverage.js - Coverage analysis and heatmap rendering.
 * Exports: init
 */
import { state, clearCoverageLayers } from './map.js';
import {
  addCoverageOverlayTile,
  getMapViewportMetrics,
  onMapViewportChanged,
  setCoverageLayerOpacity,
} from './mapAdapter.js';
import {
  setProgress, hideProgress, setStatus, yieldToUI, setCancelHandler,
  setButtonBusy, setInlineStatus,
} from './ui.js';
import { fetchElevations, fetchElevationsFromTiles } from './elevation.js';
import { fetchFoliage } from './foliage.js';
import { fetchBuildings } from './buildings.js';
import { getCoverageSettings } from './settings.js';
import {
  buildElevationGridPoints,
  coverageBbox,
  elevationGridShape,
  unionBbox,
} from './coverageGrid.js';
import {
  cancelCoverageCompute,
  computeCoverage,
  formatCoverageBackendStatus,
  initCoverageBackends,
} from './coverageBackend.js';
import { applyScenarioProfile } from './scenarios.js';

let _isRunning = false;
let _cancelToken = null;
let _abortController = null;

const MAX_COVERAGE_GRID_RES = 4096;
const MAX_COVERAGE_PIXELS = MAX_COVERAGE_GRID_RES * MAX_COVERAGE_GRID_RES;
const MAX_CPU_PIXELS = 16_777_216;
const COVERAGE_TILE_SIZE = 1024;

export function cancelCoverage() {
  if (_cancelToken) _cancelToken.cancelled = true;
  if (_abortController) _abortController.abort();
  cancelCoverageCompute();
}

export async function runCoverageAnalysis(onlyId = null) {
  if (_isRunning) return;
  const active = onlyId !== null
    ? state.repeaters.filter(r => r.id === onlyId)
    : state.repeaters.filter(r => r.visible);

  if (active.length === 0) {
    const msg = state.repeaters.length === 0
      ? 'Add at least one repeater first.'
      : 'No visible repeaters selected. Unhide at least one node.';
    setStatus(msg);
    setInlineStatus('coverage-status', msg, 'warning');
    return;
  }

  _isRunning = true;
  _cancelToken = { cancelled: false };
  _abortController = new AbortController();
  setCancelHandler(cancelCoverage);
  setButtonBusy('btn-compute', true, 'Computing...');
  setInlineStatus('coverage-status', `Computing ${active.length} visible node${active.length !== 1 ? 's' : ''}...`, 'info');

  const totalStart = performance.now();
  const settings = getCoverageSettings();
  const {
    rxHeight, rxSens, fadeMargin, radiusKm,
    useLos, useFresnel, useFoliage, foliageLossPerM,
    useBuildings, buildingLossPerM,
    computeWorkerCount, computeBackend, deriveObstacleHeights,
    datasetBatchConcurrency,
    demTileConcurrency, foliageTileConcurrency, buildingTileConcurrency,
  } = settings;

  // Derive gridRes from the actual map zoom level so coverage pixels match screen pixels.
  // qualityMult: Fast=0.5×, Balanced=1×, High Detail=2×, Maximum=3×.
  // m/pixel at current zoom: 156543.034 * cos(lat) / 2^zoom (Web Mercator standard).
  const { zoom: _mapZoom, centerLat: _mapLat } = getMapViewportMetrics();
  const _mapMPerPx = 156543.034 * Math.cos(_mapLat * Math.PI / 180) / Math.pow(2, _mapZoom);
  const _diameterM = radiusKm * 2000;
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
  const needsElevationGrid = useLos || useFoliage || useBuildings;
  const metrics = _makeMetrics(active.length, gridRes, radiusKm);

  console.info(`[coverage] starting analysis - ${active.length} repeater(s), radius=${radiusKm} km, zoom=${_mapZoom}, ~${_mapMPerPx.toFixed(1)} m/px, grid=${gridRes}x${gridRes} (zoom-matched, mult=${settings.qualityMult})`);
  clearCoverageLayers();
  setProgress(2, 'Initialising grid...');

  const repBboxes = active.map(rep => coverageBbox(rep, radiusKm));
  const unionBBox = unionBbox(repBboxes);

  try {
    const obstacleFetchStart = performance.now();
    const { foliagePayload, buildingsPayload } = await _fetchObstaclePayloads({
      useFoliage, useBuildings, unionBBox, metrics, signal: _abortController.signal,
      foliageTileConcurrency,
      buildingTileConcurrency,
      datasetBatchConcurrency,
      deriveObstacleHeights,
      onProgress: p => {
        const foliageRatio = useFoliage ? _ratio(p.foliageDone, p.foliageTotal) : 1;
        const buildingsRatio = useBuildings ? _ratio(p.buildingsDone, p.buildingsTotal) : 1;
        const enabled = (useFoliage ? 1 : 0) + (useBuildings ? 1 : 0);
        const combined = enabled ? ((foliageRatio + buildingsRatio) / enabled) : 1;
        const etaMs = _etaMs(obstacleFetchStart, combined);
        const pct = 5 + combined * 8;
        setProgress(
          pct,
          `Fetching obstacle data... foliage ${p.foliageDone}/${p.foliageTotal}, buildings ${p.buildingsDone}/${p.buildingsTotal}${etaMs !== null ? ` (ETA ${_fmtDuration(etaMs)})` : ''}`
        );
      },
    });

    const slicePct = 85 / active.length;
    for (let ri = 0; ri < active.length; ri++) {
      _throwIfCancelled();
      const rep = active[ri];
      const bbox = repBboxes[ri];
      const basePct = 15 + slicePct * ri;
      const { latMin, latMax, lonMin, lonMax } = bbox;

      setProgress(basePct, `${rep.name}: preparing terrain grid...`);
      const { elevTargetM, ELEV_RES } = elevationGridShape(gridRes, radiusKm);
      console.debug(`[coverage] ${rep.name}: ELEV_RES=${ELEV_RES} (${(radiusKm * 2000 / ELEV_RES).toFixed(0)} m/cell), grid=${gridRes}x${gridRes}, target=${elevTargetM} m`);

      const elevGridPoints = buildElevationGridPoints({ latMin, latMax, lonMin, lonMax, ELEV_RES });
      let txElev = 0;
      let gridElevsF32 = new Float32Array(ELEV_RES * ELEV_RES);

      if (needsElevationGrid) {
        setProgress(basePct + slicePct * 0.1, `${rep.name}: fetching ${elevGridPoints.length.toLocaleString()} terrain points...`);
        const elevationStart = performance.now();

        // Tx point: use the full pipeline (mem → DB → tile → API) for highest accuracy.
        const [txElevResult] = await fetchElevations(
          [{ latitude: rep.lat, longitude: rep.lon }],
          metrics.elevation,
          { signal: _abortController.signal }
        );
        txElev = txElevResult;

        // Grid: sample DEM tiles directly — no point DB overhead for bulk raster queries.
        const terrainFetchStart = performance.now();
        const gridElevs = await fetchElevationsFromTiles(
          elevGridPoints,
          metrics.elevation,
          {
            signal: _abortController.signal,
            demTileConcurrency,
            targetResolutionM: Math.max(1, radiusKm * 2000 / Math.max(1, ELEV_RES - 1)),
            onProgress: ({ completed, total }) => {
              const ratio = _ratio(completed, total);
              const etaMs = _etaMs(terrainFetchStart, ratio);
              const pct = basePct + slicePct * (0.1 + 0.35 * ratio);
              setProgress(
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
      }

      _throwIfCancelled();
      setProgress(basePct + slicePct * 0.5, `${rep.name}: computing signal levels...`);
      const computeStart = performance.now();
      const computePayload = {
        gridElevs: gridElevsF32, gridRes, ELEV_RES,
        rep: { lat: rep.lat, lon: rep.lon, height: rep.height, power: rep.power, freq: rep.freq, gain: rep.gain ?? 0 },
        txElev, latMin, latMax, lonMin, lonMax,
        radiusKm, rxHeight, effectiveSens, useLos, useFresnel,
        useFoliage, foliageLossPerM, profileTargetSpacingM, profileMaxSamples,
        foliage: foliagePayload,
        useBuildings, buildingLossPerM,
        buildings: buildingsPayload,
      };
      const { rgba, stats, backend } = await computeCoverage(computePayload, {
        backendPreference: computeBackend,
        workerCount: computeWorkerCount,
        signal: _abortController.signal,
        onProgress: backendProgress => {
          const backendPct = typeof backendProgress === 'number'
            ? backendProgress
            : (backendProgress?.pct ?? 0);
          const stage = typeof backendProgress === 'object' && backendProgress?.stage
            ? ` (${_humanizeStage(backendProgress.stage)})`
            : '';
          const etaMs = _etaMs(computeStart, backendPct);
          setProgress(
            basePct + slicePct * (0.5 + 0.5 * backendPct),
            `${rep.name}: computing... ${Math.round(backendPct * 100)}%${stage}${etaMs !== null ? ` (ETA ${_fmtDuration(etaMs)})` : ''}`
          );
        },
      });
      const safeStats = stats ?? {};
      metrics.backendsUsed.add(backend);
      metrics.workerCount = Math.max(metrics.workerCount, safeStats.workerCount ?? 0);
      metrics.computeMs += performance.now() - computeStart;
      metrics.workerComputeMs += safeStats.workerComputeMs ?? 0;
      metrics.insidePoints += safeStats.insidePoints ?? 0;

      const expectedRgbaBytes = gridRes * gridRes * 4;
      if (!(rgba instanceof Uint8ClampedArray) || rgba.length !== expectedRgbaBytes) {
        throw new Error(
          `Coverage backend ${backend || 'unknown'} returned invalid RGBA buffer `
          + `(expected ${expectedRgbaBytes} bytes, got ${rgba?.length ?? 'undefined'}).`
        );
      }

      _throwIfCancelled();
      const renderStart = performance.now();
      await _renderCoverageOverlay({ rgba, gridRes, latMin, latMax, lonMin, lonMax, repId: rep.id });
      metrics.renderMs += performance.now() - renderStart;
      console.debug(`[coverage] ${rep.name}: rendered ${gridRes}x${gridRes} signal overlay`);
    }

    setProgress(100, 'Done!');
    await yieldToUI();
    hideProgress();
    metrics.totalMs = performance.now() - totalStart;
    console.info('[coverage] metrics', metrics);
    const summary = _formatPerformanceSummary(metrics);
    setStatus(`Coverage computed for ${active.length} repeater(s). ${summary}`);
    setInlineStatus('coverage-status', summary, 'success');
  } catch (err) {
    hideProgress();
    if (err.cancelled || err.name === 'AbortError') {
      setStatus('Coverage analysis cancelled.');
      setInlineStatus('coverage-status', 'Coverage analysis cancelled.', 'warning');
    } else {
      setStatus(`Error: ${err.message}`);
      setInlineStatus('coverage-status', `Coverage error: ${err.message}`, 'error');
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

function _makeMetrics(repeaters, gridRes, radiusKm) {
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
    },
  };
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
}) {
  const osmStart = performance.now();
  let foliageData = null;
  let buildingData = null;

  const progressState = {
    foliageDone: 0,
    foliageTotal: useFoliage ? 1 : 0,
    buildingsDone: 0,
    buildingsTotal: useBuildings ? 1 : 0,
  };

  onProgress?.(progressState);

  if (useFoliage || useBuildings) setProgress(5, 'Fetching OSM obstacle layers...');

  const [foliageResult, buildingResult] = await Promise.all([
    useFoliage
      ? fetchFoliage(unionBBox.latMin, unionBBox.latMax, unionBBox.lonMin, unionBBox.lonMax, {
        signal,
        tileConcurrency: foliageTileConcurrency,
        datasetBatchConcurrency,
        deriveObstacleHeights,
        onProgress: ({ completed, total }) => {
          progressState.foliageDone = completed;
          progressState.foliageTotal = total;
          onProgress?.(progressState);
        },
      })
        .catch(e => {
          if (e?.cancelled || e?.name === 'AbortError') throw e;
          console.warn('Foliage fetch failed, skipping:', e);
          return null;
        })
      : Promise.resolve(null),
    useBuildings
      ? fetchBuildings(unionBBox.latMin, unionBBox.latMax, unionBBox.lonMin, unionBBox.lonMax, {
        signal,
        tileConcurrency: buildingTileConcurrency,
        datasetBatchConcurrency,
        deriveObstacleHeights,
        onProgress: ({ completed, total }) => {
          progressState.buildingsDone = completed;
          progressState.buildingsTotal = total;
          onProgress?.(progressState);
        },
      })
        .catch(e => {
          if (e?.cancelled || e?.name === 'AbortError') throw e;
          console.warn('Buildings fetch failed, skipping:', e);
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
      tileIndex: foliageData.tileIndex,
    } : null,
    buildingsPayload: buildingData ? {
      polygons: buildingData.polygons,
      bboxes: buildingData.bboxes,
      heights: buildingData.heights,
      tileIndex: buildingData.tileIndex,
    } : null,
  };
}

async function _renderCoverageOverlay({ rgba, gridRes, latMin, latMax, lonMin, lonMax, repId }) {
  if (!(rgba instanceof Uint8ClampedArray)) {
    throw new Error('Coverage renderer expected an RGBA Uint8ClampedArray.');
  }
  let nonZeroAlpha = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] > 0) nonZeroAlpha++;
  }
  const opacitySlider = document.getElementById('coverage-opacity');
  const rawOpacity = opacitySlider ? parseFloat(opacitySlider.value) / 100 : 0.65;
  const opacity = Number.isFinite(rawOpacity) ? Math.max(0.05, Math.min(1, rawOpacity)) : 0.65;

  const rowDen = Math.max(1, gridRes - 1);
  const colDen = Math.max(1, gridRes - 1);
  const latSpan = latMax - latMin;
  const lonSpan = lonMax - lonMin;

  let tileCount = 0;
  for (let row0 = 0; row0 < gridRes; row0 += COVERAGE_TILE_SIZE) {
    const tileH = Math.min(COVERAGE_TILE_SIZE, gridRes - row0);
    for (let col0 = 0; col0 < gridRes; col0 += COVERAGE_TILE_SIZE) {
      const tileW = Math.min(COVERAGE_TILE_SIZE, gridRes - col0);
      const canvas = document.createElement('canvas');
      canvas.width = tileW;
      canvas.height = tileH;
      const ctx = canvas.getContext('2d');
      const imageData = ctx.createImageData(tileW, tileH);

      for (let tr = 0; tr < tileH; tr++) {
        const srcStart = ((row0 + tr) * gridRes + col0) * 4;
        const srcEnd = srcStart + tileW * 4;
        const dstStart = tr * tileW * 4;
        imageData.data.set(rgba.subarray(srcStart, srcEnd), dstStart);
      }
      ctx.putImageData(imageData, 0, 0);

      const blobUrl = await new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob
          ? resolve(URL.createObjectURL(blob))
          : reject(new Error('canvas.toBlob failed')));
      });

      const top = latMax - (row0 / rowDen) * latSpan;
      const bottom = latMax - ((row0 + tileH - 1) / rowDen) * latSpan;
      const left = lonMin + (col0 / colDen) * lonSpan;
      const right = lonMin + ((col0 + tileW - 1) / colDen) * lonSpan;

      addCoverageOverlayTile({
        blobUrl,
        bounds: [[bottom, left], [top, right]],
        opacity,
        repId,
      });
      tileCount++;
    }
  }

  console.info(
    `[coverage] overlay added: ${gridRes}x${gridRes}, tiles=${tileCount}, ` +
    `nonZeroAlpha=${nonZeroAlpha.toLocaleString()}, opacity=${opacity}`
  );
}

function _throwIfCancelled() {
  if (!_cancelToken?.cancelled && !_abortController?.signal.aborted) return;
  const err = new Error('Cancelled');
  err.cancelled = true;
  throw err;
}

function _formatPerformanceSummary(metrics) {
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

function _backendLabel(metrics) {
  const backends = [...(metrics.backendsUsed ?? [])];
  if (!backends.length) return `${metrics.workerCount} CPU worker${metrics.workerCount !== 1 ? 's' : ''}`;
  return backends.map(b => {
    if (b === 'cuda') return 'Python CUDA';
    return `${metrics.workerCount} CPU worker${metrics.workerCount !== 1 ? 's' : ''}`;
  }).join(', ');
}

function _fmtMs(ms) {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function _ratio(done, total) {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(1, done / total));
}

function _etaMs(startTs, progressRatio) {
  if (!Number.isFinite(progressRatio) || progressRatio <= 0 || progressRatio >= 1) return null;
  const elapsed = performance.now() - startTs;
  return elapsed * (1 - progressRatio) / progressRatio;
}

function _fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '...';
  const sec = Math.ceil(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}

function _humanizeStage(stage) {
  if (!stage) return 'compute';
  return String(stage).replace(/[-_]/g, ' ');
}

function updateQualityNote() {
  const qualityMult = parseFloat(document.getElementById('grid-res')?.value);
  const radiusKm = parseFloat(document.getElementById('analysis-radius')?.value) || 15;
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

function _capGridResForMemory(rawGridRes) {
  const byPixels = Math.floor(Math.sqrt(MAX_COVERAGE_PIXELS));
  const byCpu = Math.floor(Math.sqrt(MAX_CPU_PIXELS));
  const cap = Math.min(MAX_COVERAGE_GRID_RES, byPixels, byCpu);
  // Keep output buffers renderer-safe; very large canvases can crash Electron and blank the window.
  return Math.max(16, Math.min(rawGridRes, cap));
}

function updateLegendLabels() {
  const rxSens = parseFloat(document.getElementById('rx-sensitivity')?.value);
  const fadeMargin = parseFloat(document.getElementById('fade-margin')?.value);
  const threshold = (Number.isFinite(rxSens) ? rxSens : -137) + (Number.isFinite(fadeMargin) ? fadeMargin : 0);
  const stops = [
    ['legend-strong', threshold + 50, '+50 dB Strong'],
    ['legend-good', threshold + 38, '+38 dB Good'],
    ['legend-marginal', threshold + 25, '+25 dB Marginal'],
    ['legend-weak', threshold + 13, '+13 dB Weak'],
    ['legend-threshold', threshold, '0 dB Threshold'],
  ];
  for (const [id, dbm, label] of stops) {
    const el = document.getElementById(id);
    if (el) el.textContent = `${Math.round(dbm)} dBm / ${label}`;
  }
}

export function init() {
  setCancelHandler(cancelCoverage);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && _isRunning) cancelCoverage(); });
  initCoverageBackends().then(status => {
    const text = formatCoverageBackendStatus(status);
    console.info(`[coverage] ${text}`);
    setInlineStatus('backend-status', text, 'info');
  });
  document.getElementById('btn-compute').addEventListener('click', () => runCoverageAnalysis());
  document.getElementById('scenario-profile')?.addEventListener('change', e => {
    applyScenarioProfile(e.target.value);
    updateQualityNote();
    updateLegendLabels();
  });

  ['grid-res', 'analysis-radius', 'compute-backend', 'obstacle-height-mode'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', updateQualityNote);
    document.getElementById(id)?.addEventListener('input', updateQualityNote);
  });
  onMapViewportChanged(updateQualityNote);
  ['rx-sensitivity', 'fade-margin'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', updateLegendLabels);
    document.getElementById(id)?.addEventListener('input', updateLegendLabels);
  });
  updateQualityNote();
  updateLegendLabels();

  document.getElementById('coverage-opacity').addEventListener('input', e => {
    const opacity = parseFloat(e.target.value) / 100;
    setCoverageLayerOpacity(opacity);
  });

  const foliageToggle = document.getElementById('use-foliage');
  const foliageRow = document.getElementById('foliage-loss-per-m').closest('label');
  const toggleFoliageRow = () => { foliageRow.style.display = foliageToggle.checked ? '' : 'none'; };
  foliageToggle.addEventListener('change', toggleFoliageRow);
  toggleFoliageRow();

  const buildingToggle = document.getElementById('use-buildings');
  const buildingRow = document.getElementById('building-loss-per-m').closest('label');
  const toggleBuildingRow = () => { buildingRow.style.display = buildingToggle.checked ? '' : 'none'; };
  buildingToggle.addEventListener('change', toggleBuildingRow);
  toggleBuildingRow();

  document.getElementById('btn-clear-coverage').addEventListener('click', () => {
    clearCoverageLayers();
    setStatus('Coverage cleared.');
    setInlineStatus('coverage-status', 'Coverage overlay cleared.', 'info');
  });
}
