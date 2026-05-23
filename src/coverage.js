/**
 * coverage.js - Coverage analysis and heatmap rendering.
 * Exports: init
 */
import { map, state, clearCoverageLayers } from './map.js';
import {
  setProgress, hideProgress, setStatus, yieldToUI, setCancelHandler,
  setButtonBusy, setInlineStatus,
} from './ui.js';
import { fetchElevations } from './elevation.js';
import { fetchFoliage } from './foliage.js';
import { fetchBuildings } from './buildings.js';
import { getCoverageSettings } from './settings.js';
import { createCoverageWorkerPoolJob } from './coverageWorkerPool.js';

let _isRunning = false;
let _cancelToken = null;
let _currentJob = null;
let _abortController = null;

export function cancelCoverage() {
  if (_cancelToken) _cancelToken.cancelled = true;
  if (_abortController) _abortController.abort();
  if (_currentJob) {
    _currentJob.cancel();
    _currentJob = null;
  }
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
  setButtonBusy('btn-compute', true, 'Computing...');
  setInlineStatus('coverage-status', `Computing ${active.length} visible node${active.length !== 1 ? 's' : ''}...`, 'info');

  const totalStart = performance.now();
  const settings = getCoverageSettings();
  const {
    rxHeight, rxSens, fadeMargin, radiusKm, gridRes,
    useLos, useFresnel, useFoliage, foliageLossPerM,
    useBuildings, buildingLossPerM,
    profileTargetSpacingM, profileMaxSamples,
  } = settings;
  const effectiveSens = rxSens + fadeMargin;
  const needsElevationGrid = useLos || useFoliage || useBuildings;
  const metrics = _makeMetrics(active.length, gridRes, radiusKm);

  console.info(`[coverage] starting analysis - ${active.length} repeater(s), radius=${radiusKm} km, grid=${gridRes}`);
  clearCoverageLayers();
  setProgress(2, 'Initialising grid...');

  const repBboxes = active.map(rep => _coverageBbox(rep, radiusKm));
  const unionBBox = _unionBbox(repBboxes);

  try {
    const { foliagePayload, buildingsPayload } = await _fetchObstaclePayloads({
      useFoliage, useBuildings, unionBBox, metrics, signal: _abortController.signal,
    });

    const slicePct = 85 / active.length;
    for (let ri = 0; ri < active.length; ri++) {
      _throwIfCancelled();
      const rep = active[ri];
      const bbox = repBboxes[ri];
      const basePct = 15 + slicePct * ri;
      const { latMin, latMax, lonMin, lonMax } = bbox;

      setProgress(basePct, `${rep.name}: preparing terrain grid...`);
      const { elevTargetM, ELEV_RES } = _elevationGridShape(gridRes, radiusKm);
      console.debug(`[coverage] ${rep.name}: ELEV_RES=${ELEV_RES} (${(radiusKm * 2000 / ELEV_RES).toFixed(0)} m/cell), grid=${gridRes}x${gridRes}, target=${elevTargetM} m`);

      const elevGridPoints = _buildElevationGridPoints({ latMin, latMax, lonMin, lonMax, ELEV_RES });
      let txElev = 0;
      let gridElevsF32 = new Float32Array(ELEV_RES * ELEV_RES);

      if (needsElevationGrid) {
        setProgress(basePct + slicePct * 0.1, `${rep.name}: fetching ${elevGridPoints.length.toLocaleString()} terrain points...`);
        const elevationStart = performance.now();
        const allElevs = await fetchElevations(
          [{ latitude: rep.lat, longitude: rep.lon }, ...elevGridPoints],
          metrics.elevation,
          { signal: _abortController.signal }
        );
        metrics.elevationMs += performance.now() - elevationStart;
        txElev = allElevs[0];
        if (typeof txElev !== 'number' || Number.isNaN(txElev)) {
          throw new Error(`Could not fetch elevation for ${rep.name}.`);
        }
        gridElevsF32 = new Float32Array(allElevs.slice(1));
      }

      _throwIfCancelled();
      setProgress(basePct + slicePct * 0.5, `${rep.name}: computing signal levels...`);
      const computeStart = performance.now();
      const job = createCoverageWorkerPoolJob({
        gridElevs: gridElevsF32,
        gridRes,
        ELEV_RES,
        rep: { lat: rep.lat, lon: rep.lon, height: rep.height, power: rep.power, freq: rep.freq, gain: rep.gain ?? 0 },
        txElev,
        latMin, latMax, lonMin, lonMax,
        radiusKm, rxHeight, effectiveSens, useLos, useFresnel,
        useFoliage, foliageLossPerM, profileTargetSpacingM, profileMaxSamples,
        foliage: foliagePayload,
        useBuildings, buildingLossPerM,
        buildings: buildingsPayload,
      }, {
        onProgress: workerPct => {
          setProgress(basePct + slicePct * (0.5 + 0.5 * workerPct), `${rep.name}: computing... ${Math.round(workerPct * 100)}%`);
        },
      });
      _currentJob = job;
      metrics.workerCount = Math.max(metrics.workerCount, job.workerCount);
      const { rgba, stats } = await job.promise;
      _currentJob = null;
      metrics.computeMs += performance.now() - computeStart;
      metrics.workerComputeMs += stats.workerComputeMs;
      metrics.insidePoints += stats.insidePoints;

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
    _currentJob = null;
    _abortController = null;
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
    },
  };
}

function _coverageBbox(rep, radiusKm) {
  const degPerKmLat = 1 / 110.574;
  const degPerKmLon = 1 / (111.320 * Math.cos(rep.lat * Math.PI / 180));
  return {
    latMin: rep.lat - radiusKm * degPerKmLat,
    latMax: rep.lat + radiusKm * degPerKmLat,
    lonMin: rep.lon - radiusKm * degPerKmLon,
    lonMax: rep.lon + radiusKm * degPerKmLon,
  };
}

function _unionBbox(bboxes) {
  return {
    latMin: Math.min(...bboxes.map(b => b.latMin)),
    latMax: Math.max(...bboxes.map(b => b.latMax)),
    lonMin: Math.min(...bboxes.map(b => b.lonMin)),
    lonMax: Math.max(...bboxes.map(b => b.lonMax)),
  };
}

async function _fetchObstaclePayloads({ useFoliage, useBuildings, unionBBox, metrics, signal }) {
  const osmStart = performance.now();
  let foliageData = null;
  let buildingData = null;

  if (useFoliage || useBuildings) setProgress(5, 'Fetching OSM obstacle layers...');

  const [foliageResult, buildingResult] = await Promise.all([
    useFoliage
      ? fetchFoliage(unionBBox.latMin, unionBBox.latMax, unionBBox.lonMin, unionBBox.lonMax, { signal })
        .catch(e => {
          if (e?.cancelled || e?.name === 'AbortError') throw e;
          console.warn('Foliage fetch failed, skipping:', e);
          return null;
        })
      : Promise.resolve(null),
    useBuildings
      ? fetchBuildings(unionBBox.latMin, unionBBox.latMax, unionBBox.lonMin, unionBBox.lonMax, { signal })
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

function _elevationGridShape(gridRes, radiusKm) {
  const elevTargetM = gridRes >= 384 ? 50 : gridRes >= 256 ? 75 : gridRes >= 128 ? 120 : 180;
  const maxRes = gridRes >= 384 ? 512 : gridRes >= 256 ? 384 : 256;
  return {
    elevTargetM,
    ELEV_RES: Math.min(Math.ceil(radiusKm * 2000 / elevTargetM), maxRes),
  };
}

function _buildElevationGridPoints({ latMin, latMax, lonMin, lonMax, ELEV_RES }) {
  const points = new Array(ELEV_RES * ELEV_RES);
  let i = 0;
  for (let r = 0; r < ELEV_RES; r++) {
    const rowFrac = ELEV_RES > 1 ? r / (ELEV_RES - 1) : 0;
    const latitude = latMax - rowFrac * (latMax - latMin);
    for (let c = 0; c < ELEV_RES; c++) {
      const colFrac = ELEV_RES > 1 ? c / (ELEV_RES - 1) : 0;
      points[i++] = {
        latitude,
        longitude: lonMin + colFrac * (lonMax - lonMin),
      };
    }
  }
  return points;
}

async function _renderCoverageOverlay({ rgba, gridRes, latMin, latMax, lonMin, lonMax, repId }) {
  const canvas = document.createElement('canvas');
  canvas.width = gridRes;
  canvas.height = gridRes;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(gridRes, gridRes);
  imageData.data.set(rgba);
  ctx.putImageData(imageData, 0, 0);

  const blobUrl = await new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob
      ? resolve(URL.createObjectURL(blob))
      : reject(new Error('canvas.toBlob failed')));
  });
  const opacitySlider = document.getElementById('coverage-opacity');
  const opacity = opacitySlider ? parseFloat(opacitySlider.value) / 100 : 0.65;
  const overlay = L.imageOverlay(
    blobUrl,
    [[latMin, lonMin], [latMax, lonMax]],
    { opacity, interactive: false }
  ).addTo(map);
  overlay._repeaterId = repId;
  overlay._blobUrl = blobUrl;
  state.coverageLayers.push(overlay);
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
  return `Total ${_fmtMs(metrics.totalMs)}. ` +
    `Elevation ${_fmtMs(metrics.elevationMs)} (${cacheHits.toLocaleString()} cache hits, ` +
    `${(e.apiPoints ?? 0).toLocaleString()} API points, ${(e.duplicatePoints ?? 0).toLocaleString()} deduped). ` +
    `OSM ${_fmtMs(metrics.osmMs)}, compute ${_fmtMs(metrics.computeMs)} on ${metrics.workerCount} worker${metrics.workerCount !== 1 ? 's' : ''}, render ${_fmtMs(metrics.renderMs)}.`;
}

function _fmtMs(ms) {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function updateQualityNote() {
  const gridRes = parseInt(document.getElementById('grid-res')?.value, 10) || 128;
  const radiusKm = parseFloat(document.getElementById('analysis-radius')?.value) || 15;
  const cells = gridRes * gridRes;
  const metersPerPixel = Math.round((radiusKm * 2000) / gridRes);
  const label = gridRes >= 384 ? 'Maximum'
    : gridRes >= 256 ? 'High Detail'
    : gridRes >= 128 ? 'Balanced'
    : 'Fast';
  const el = document.getElementById('quality-note');
  if (el) el.textContent = `${label}: ${gridRes} x ${gridRes} signal pixels (${cells.toLocaleString()} samples), about ${metersPerPixel} m per pixel at this radius.`;
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
  document.getElementById('btn-compute').addEventListener('click', () => runCoverageAnalysis());

  ['grid-res', 'analysis-radius'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', updateQualityNote);
    document.getElementById(id)?.addEventListener('input', updateQualityNote);
  });
  ['rx-sensitivity', 'fade-margin'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', updateLegendLabels);
    document.getElementById(id)?.addEventListener('input', updateLegendLabels);
  });
  updateQualityNote();
  updateLegendLabels();

  document.getElementById('coverage-opacity').addEventListener('input', e => {
    const opacity = parseFloat(e.target.value) / 100;
    state.coverageLayers.forEach(l => l.setOpacity(opacity));
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
