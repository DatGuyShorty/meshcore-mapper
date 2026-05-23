/**
 * coverage.js — Coverage analysis and heatmap rendering.
 * Exports: init
 */
import { map, state, clearCoverageLayers } from './map.js';
import { setProgress, hideProgress, setStatus, yieldToUI, setCancelHandler } from './ui.js';
import { fetchElevations } from './elevation.js';
import { writePixel } from './propagation.js';
import { fetchFoliage } from './foliage.js';
import { fetchBuildings } from './buildings.js';

const PROFILE_SAMPLES = 32; // terrain samples per path for LoS check
let _isRunning = false;
let _cancelToken = null;   // { cancelled: bool } — reset each run
let _currentWorker = null; // running worker ref for early termination

export function cancelCoverage() {
  if (_cancelToken) _cancelToken.cancelled = true;
  if (_currentWorker) { _currentWorker.terminate(); _currentWorker = null; }
}

export async function runCoverageAnalysis(onlyId = null) {
  if (_isRunning) return;
  const active = onlyId !== null
    ? state.repeaters.filter(r => r.id === onlyId)
    : state.repeaters.filter(r => r.visible);
  if (active.length === 0) {
    setStatus(state.repeaters.length === 0
      ? 'Add at least one repeater first.'
      : 'No visible repeaters selected. Unhide at least one node.');
    return;
  }
  _isRunning = true;
  _cancelToken = { cancelled: false };
  const t0 = performance.now();
  console.info(`[coverage] starting analysis — ${active.length} repeater(s) (of ${state.repeaters.length}), radius=${document.getElementById('analysis-radius').value} km, grid=${document.getElementById('grid-res').value}`);

  const rxHeight   = parseFloat(document.getElementById('rx-height').value) || 1.5;
  const rxSens     = parseFloat(document.getElementById('rx-sensitivity').value) || -137;
  const fadeMargin = parseFloat(document.getElementById('fade-margin').value) || 0;
  const effectiveSens = rxSens + fadeMargin;
  const radiusKm   = parseFloat(document.getElementById('analysis-radius').value) || 15;
  const gridRes    = parseInt(document.getElementById('grid-res').value) || 128;
  const useLos         = document.getElementById('use-los').checked;
  const useFresnel     = document.getElementById('use-fresnel').checked;
  const useFoliage     = document.getElementById('use-foliage').checked;
  const foliageLossPerM = parseFloat(document.getElementById('foliage-loss-per-m').value) || 0.3;
  const useBuildings    = document.getElementById('use-buildings').checked;
  const buildingLossPerM = parseFloat(document.getElementById('building-loss-per-m').value) || 0.5;

  clearCoverageLayers();

  setProgress(2, 'Initialising grid…');

  // ── Pre-compute per-repeater bboxes (needed for union and per-repeater elev grid) ──
  const degPerKmLat = 1 / 110.574;
  const repBboxes = active.map(rep => {
    const degPerKmLon = 1 / (111.320 * Math.cos(rep.lat * Math.PI / 180));
    return {
      latMin: rep.lat - radiusKm * degPerKmLat,
      latMax: rep.lat + radiusKm * degPerKmLat,
      lonMin: rep.lon - radiusKm * degPerKmLon,
      lonMax: rep.lon + radiusKm * degPerKmLon,
    };
  });

  // ── Foliage and buildings are purely geographic — fetch once for the union bbox ──
  // Union bbox covers all repeaters; tile-based caching means this is 1 merged lookup
  // instead of N separate fetches with N tile-merge + tileIndex-build passes.
  const unionLatMin = Math.min(...repBboxes.map(b => b.latMin));
  const unionLatMax = Math.max(...repBboxes.map(b => b.latMax));
  const unionLonMin = Math.min(...repBboxes.map(b => b.lonMin));
  const unionLonMax = Math.max(...repBboxes.map(b => b.lonMax));

  let foliageData = null;
  if (useFoliage) {
    try {
      setProgress(5, 'Fetching forest polygons…');
      foliageData = await fetchFoliage(unionLatMin, unionLatMax, unionLonMin, unionLonMax);
    } catch (e) {
      console.warn('Foliage fetch failed, skipping:', e);
    }
  }

  let buildingData = null;
  if (useBuildings) {
    try {
      setProgress(10, 'Fetching building footprints…');
      buildingData = await fetchBuildings(unionLatMin, unionLatMax, unionLonMin, unionLonMax);
    } catch (e) {
      console.warn('Buildings fetch failed, skipping:', e);
    }
  }

  // Serialise foliage/buildings once for the worker (structured-clone happens per worker post,
  // but we only build these objects once and reuse the same reference for all repeaters).
  const foliagePayload = foliageData ? {
    polygons:      foliageData.polygons,
    bboxes:        foliageData.bboxes,
    canopyHeights: foliageData.canopyHeights,
    factors:       foliageData.factors,
    tileIndex:     foliageData.tileIndex,
  } : null;
  const buildingsPayload = buildingData ? {
    polygons:  buildingData.polygons,
    bboxes:    buildingData.bboxes,
    heights:   buildingData.heights,
    tileIndex: buildingData.tileIndex,
  } : null;

  // Each repeater gets an equal slice of the 15→100% range.
  const slicePct = 85 / active.length;
  try {
    for (let ri = 0; ri < active.length; ri++) {
      if (_cancelToken.cancelled) { const e = new Error('Cancelled'); e.cancelled = true; throw e; }
      const rep  = active[ri];
      const bbox = repBboxes[ri];
      const { latMin, latMax, lonMin, lonMax } = bbox;

      const basePct = 15 + slicePct * ri;
      setProgress(basePct, `Fetching TX elevation for ${rep.name}…`);

      const [txElev] = await fetchElevations([{ latitude: rep.lat, longitude: rep.lon }]);
      if (typeof txElev !== 'number' || isNaN(txElev)) throw new Error(`Could not fetch elevation for ${rep.name}.`);
      console.info(`[coverage] ${rep.name}: TX elev=${txElev.toFixed(1)} m`);

      // P12: adaptive elevation grid
      const ELEV_RES = Math.min(Math.ceil(radiusKm * 2000 / 150), 256);
      console.debug(`[coverage] ${rep.name}: ELEV_RES=${ELEV_RES} (${(radiusKm*2000/ELEV_RES).toFixed(0)} m/cell), grid=${gridRes}×${gridRes}`);
      const elevGridPoints = [];
      for (let r = 0; r < ELEV_RES; r++) {
        for (let c = 0; c < ELEV_RES; c++) {
          elevGridPoints.push({
            latitude:  latMax - r * (latMax - latMin) / (ELEV_RES - 1),
            longitude: lonMin + c * (lonMax - lonMin) / (ELEV_RES - 1),
          });
        }
      }

      setProgress(basePct + slicePct * 0.1, `${rep.name}: fetching ${elevGridPoints.length.toLocaleString()} elevation points…`);
      const gridElevs = useLos ? await fetchElevations(elevGridPoints) : new Float32Array(ELEV_RES * ELEV_RES);

      // P9: flat typed arrays for the signal grid
      const gridLats = new Float64Array(gridRes * gridRes);
      const gridLons = new Float64Array(gridRes * gridRes);
      for (let r = 0; r < gridRes; r++) {
        for (let c = 0; c < gridRes; c++) {
          const i = r * gridRes + c;
          gridLats[i] = latMax - r * (latMax - latMin) / (gridRes - 1);
          gridLons[i] = lonMin + c * (lonMax - lonMin) / (gridRes - 1);
        }
      }

      setProgress(basePct + slicePct * 0.5, `${rep.name}: computing signal levels…`);

      // P15: fetchElevations() returns number[]; Float32Array is already typed when useLos=false
      const gridElevsF32 = useLos ? new Float32Array(gridElevs) : gridElevs;
      const signalGrid = await _runInWorker({
        gridLats: gridLats.buffer,
        gridLons: gridLons.buffer,
        gridElevs: gridElevsF32.buffer,
        gridRes, ELEV_RES,
        rep: { lat: rep.lat, lon: rep.lon, height: rep.height, power: rep.power, freq: rep.freq, gain: rep.gain ?? 0 },
        txElev, latMin, latMax, lonMin, lonMax,
        radiusKm, rxHeight, effectiveSens, useLos, useFresnel,
        useFoliage, foliageLossPerM, profileSamples: PROFILE_SAMPLES,
        foliage: foliagePayload,
        useBuildings, buildingLossPerM,
        buildings: buildingsPayload,
      }, [gridLats.buffer, gridLons.buffer, gridElevsF32.buffer],
      (workerPct) => {
        setProgress(basePct + slicePct * (0.5 + 0.5 * workerPct), `${rep.name}: computing… ${Math.round(workerPct * 100)}%`);
      });

      console.debug(`[coverage] ${rep.name}: signal grid computed (${gridRes}×${gridRes})`);

      // Render signal grid to canvas image overlay
      const canvas = document.createElement('canvas');
      canvas.width = gridRes; canvas.height = gridRes;
      const ctx = canvas.getContext('2d');
      const imageData = ctx.createImageData(gridRes, gridRes);
      for (let idx = 0; idx < signalGrid.length; idx++) {
        writePixel(imageData.data, idx * 4, signalGrid[idx], effectiveSens);
      }
      ctx.putImageData(imageData, 0, 0);

      // B7: blob URL is far cheaper than base64 toDataURL (no string allocation, no encoding)
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
      overlay._repeaterId = rep.id;
      overlay._blobUrl    = blobUrl;  // stored for revocation on clear
      state.coverageLayers.push(overlay);
    }

    setProgress(100, 'Done!');
    await yieldToUI();
    hideProgress();
    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    console.info(`[coverage] done in ${elapsed}s for ${active.length} repeater(s)`);
    setStatus(`Coverage computed for ${active.length} repeater(s). Elevation data via open-elevation.com`);
  } catch (err) {
    hideProgress();
    if (err.cancelled) {
      setStatus('Coverage analysis cancelled.');
    } else {
      setStatus(`Error: ${err.message}`);
      console.error(err);
    }
  } finally {
    _isRunning = false;
  }
}

/**
 * Run the coverage inner loop inside a Web Worker.
 * All typed arrays are transferred (zero-copy). Complex objects (foliage) are structured-cloned.
 * @param {object}   payload    - all data the worker needs
 * @param {ArrayBuffer[]} transfer - Transferable buffers list
 * @param {function} onProgress - (0..1) progress callback
 * @returns {Promise<Float32Array>} signalGrid
 */
function _runInWorker(payload, transfer, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./coverageWorker.js', import.meta.url),
      { type: 'module' }
    );
    _currentWorker = worker;
    worker.onmessage = ({ data: msg }) => {
      if (_cancelToken?.cancelled) {
        worker.terminate();
        _currentWorker = null;
        const e = new Error('Cancelled'); e.cancelled = true;
        reject(e);
        return;
      }
      if (msg.type === 'progress') {
        onProgress(msg.pct);
      } else if (msg.type === 'done') {
        _currentWorker = null;
        worker.terminate();
        resolve(msg.signalGrid);
      }
    };
    worker.onerror = (err) => {
      _currentWorker = null;
      worker.terminate();
      reject(new Error(`Coverage worker error: ${err.message}`));
    };
    worker.postMessage(payload, transfer);
  });
}

export function init() {
  setCancelHandler(cancelCoverage);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && _isRunning) cancelCoverage(); });
  document.getElementById('btn-compute').addEventListener('click', () => runCoverageAnalysis());

  document.getElementById('coverage-opacity').addEventListener('input', e => {
    const opacity = parseFloat(e.target.value) / 100;
    state.coverageLayers.forEach(l => l.setOpacity(opacity));
  });

  // U2: show/hide the Forest Loss row based on whether foliage is enabled
  const foliageToggle = document.getElementById('use-foliage');
  const foliageRow    = document.getElementById('foliage-loss-per-m').closest('label');
  const toggleFoliageRow = () => { foliageRow.style.display = foliageToggle.checked ? '' : 'none'; };
  foliageToggle.addEventListener('change', toggleFoliageRow);
  toggleFoliageRow();

  const buildingToggle = document.getElementById('use-buildings');
  const buildingRow    = document.getElementById('building-loss-per-m').closest('label');
  const toggleBuildingRow = () => { buildingRow.style.display = buildingToggle.checked ? '' : 'none'; };
  buildingToggle.addEventListener('change', toggleBuildingRow);
  toggleBuildingRow();

  // U3: clear coverage without removing repeaters
  document.getElementById('btn-clear-coverage').addEventListener('click', () => {
    clearCoverageLayers();
    setStatus('Coverage cleared.');
  });
}
