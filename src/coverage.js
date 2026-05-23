/**
 * coverage.js — Coverage analysis and heatmap rendering.
 * Exports: init
 */
import { map, state, clearCoverageLayers, clearFoliageLayers, clearBuildingLayers } from './map.js';
import { setProgress, hideProgress, setStatus, yieldToUI } from './ui.js';
import { fetchElevations } from './elevation.js';
import { writePixel } from './propagation.js';
import { fetchFoliage } from './foliage.js';
import { fetchBuildings } from './buildings.js';

const PROFILE_SAMPLES = 32; // terrain samples per path for LoS check
let _isRunning = false;

// Shared canvas renderer — avoids creating a separate SVG DOM element per polygon.
let _polyRenderer = null;
function _getRenderer() {
  if (!_polyRenderer) _polyRenderer = L.canvas({ padding: 0.1 });
  return _polyRenderer;
}

async function runCoverageAnalysis() {
  if (_isRunning) return;
  if (state.repeaters.length === 0) {
    setStatus('Add at least one repeater first.');
    return;
  }
  _isRunning = true;
  const t0 = performance.now();
  console.info(`[coverage] starting analysis — ${state.repeaters.length} repeater(s), radius=${document.getElementById('analysis-radius').value} km, grid=${document.getElementById('grid-res').value}`);

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
  clearFoliageLayers();
  clearBuildingLayers();
  setProgress(2, 'Initialising grid…');

  try {
    for (let ri = 0; ri < state.repeaters.length; ri++) {
      const rep = state.repeaters[ri];
      setProgress(5, `Fetching TX elevation for ${rep.name}…`);

      const [txElev] = await fetchElevations([{ latitude: rep.lat, longitude: rep.lon }]);
      if (typeof txElev !== 'number' || isNaN(txElev)) throw new Error(`Could not fetch elevation for ${rep.name}.`);
      console.info(`[coverage] ${rep.name}: TX elev=${txElev.toFixed(1)} m, ELEV_RES will be computed next`);

      const degPerKmLat = 1 / 110.574;
      const degPerKmLon = 1 / (111.320 * Math.cos(rep.lat * Math.PI / 180));
      const latMin = rep.lat - radiusKm * degPerKmLat;
      const latMax = rep.lat + radiusKm * degPerKmLat;
      const lonMin = rep.lon - radiusKm * degPerKmLon;
      const lonMax = rep.lon + radiusKm * degPerKmLon;

      // P12: adaptive elevation grid — target ~150 m/cell to match SRTM30m detail,
      // capped at 256×256 (beyond that the free API becomes impractically slow on cold cache).
      // At ≤19 km radius this stays ≤256; at 50 km → 256 cells = ~195 m/cell (was ~780 m).
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

      setProgress(10, `Fetching ${elevGridPoints.length.toLocaleString()} elevation points…`);
      const gridElevs = useLos ? await fetchElevations(elevGridPoints) : new Float32Array(ELEV_RES * ELEV_RES);

      // P9: flat typed arrays for the signal grid — better cache locality than object array
      const gridLats = new Float64Array(gridRes * gridRes);
      const gridLons = new Float64Array(gridRes * gridRes);
      for (let r = 0; r < gridRes; r++) {
        for (let c = 0; c < gridRes; c++) {
          const i = r * gridRes + c;
          gridLats[i] = latMax - r * (latMax - latMin) / (gridRes - 1);
          gridLons[i] = lonMin + c * (lonMax - lonMin) / (gridRes - 1);
        }
      }

      let foliageData = null;
      if (useFoliage) {
        try {
          setProgress(55, `Fetching forest polygons for ${rep.name}…`);
          foliageData = await fetchFoliage(latMin, latMax, lonMin, lonMax);
          console.info(`[coverage] ${rep.name}: foliage — ${foliageData.polygons.length} polygon(s) loaded`);
          for (const poly of foliageData.polygons) {
            const layer = L.polygon(poly, {
              renderer: _getRenderer(),
              color: '#22c55e', weight: 1, opacity: 0.6,
              fill: true, fillColor: '#22c55e', fillOpacity: 0.18, interactive: false,
            }).addTo(map);
            state.foliageLayers.push(layer);
          }
        } catch (e) {
          console.warn('Foliage fetch failed, skipping:', e);
        }
      }

      let buildingData = null;
      if (useBuildings) {
        try {
          setProgress(57, `Fetching building footprints for ${rep.name}…`);
          buildingData = await fetchBuildings(latMin, latMax, lonMin, lonMax);
          console.info(`[coverage] ${rep.name}: buildings — ${buildingData.polygons.length} building(s) loaded`);
          for (let bi = 0; bi < buildingData.polygons.length; bi++) {
            const poly = buildingData.polygons[bi];
            const h    = buildingData.heights[bi] ?? 5;
            // Color by height: short=gray, medium=tan, tall=brownish
            const t    = Math.min(1, h / 30);
            const fill = t < 0.33 ? '#9ca3af' : t < 0.66 ? '#c4a875' : '#a0856e';
            const layer = L.polygon(poly, {
              renderer: _getRenderer(),
              color: '#6b7280', weight: 0.8, opacity: 0.7,
              fill: true, fillColor: fill, fillOpacity: 0.45, interactive: false,
            }).addTo(map);
            state.buildingLayers.push(layer);
          }
        } catch (e) {
          console.warn('Buildings fetch failed, skipping:', e);
        }
      }

      setProgress(60, `Computing signal levels for ${rep.name}…`);

      // Offload the inner loop to a Web Worker to keep the UI thread responsive.
      // gridLats/gridLons are transferred (zero-copy); gridElevs is cloned (large but one-time).
      const gridElevsF32 = new Float32Array(gridElevs);
      const signalGrid = await _runInWorker({
        gridLats: gridLats.buffer,
        gridLons: gridLons.buffer,
        gridElevs: gridElevsF32.buffer,
        gridRes, ELEV_RES,
        rep: { lat: rep.lat, lon: rep.lon, height: rep.height, power: rep.power, freq: rep.freq, gain: rep.gain ?? 0 },
        txElev, latMin, latMax, lonMin, lonMax,
        radiusKm, rxHeight, effectiveSens, useLos, useFresnel,
        useFoliage, foliageLossPerM, profileSamples: PROFILE_SAMPLES,
        foliage: foliageData ? {
          polygons:      foliageData.polygons,
          bboxes:        foliageData.bboxes,
          canopyHeights: foliageData.canopyHeights,
          factors:       foliageData.factors,
          tileIndex:     foliageData.tileIndex,
        } : null,
        useBuildings, buildingLossPerM,
        buildings: buildingData ? {
          polygons:  buildingData.polygons,
          bboxes:    buildingData.bboxes,
          heights:   buildingData.heights,
          tileIndex: buildingData.tileIndex,
        } : null,
      }, [gridLats.buffer, gridLons.buffer, gridElevsF32.buffer],
      (workerPct) => {
        const pct = 60 + 35 * ((ri + workerPct) / state.repeaters.length);
        setProgress(pct, `${rep.name}: computing… ${Math.round(workerPct * 100)}%`);
      });

      console.debug(`[coverage] ${rep.name}: signal grid computed (${gridRes}×${gridRes})`);

      // Render signal grid to canvas image overlay
      const canvas = document.createElement('canvas');
      canvas.width = gridRes; canvas.height = gridRes;
      const ctx = canvas.getContext('2d');
      const imageData = ctx.createImageData(gridRes, gridRes);
      // P6: writePixel writes directly into buffer — no per-pixel array allocation
      for (let idx = 0; idx < signalGrid.length; idx++) {
        writePixel(imageData.data, idx * 4, signalGrid[idx], effectiveSens);
      }
      ctx.putImageData(imageData, 0, 0);

      const opacitySlider = document.getElementById('coverage-opacity');
      const opacity = opacitySlider ? parseFloat(opacitySlider.value) / 100 : 0.65;
      const overlay = L.imageOverlay(
        canvas.toDataURL(),
        [[latMin, lonMin], [latMax, lonMax]],
        { opacity, interactive: false }
      ).addTo(map);
      overlay._repeaterId = rep.id;
      state.coverageLayers.push(overlay);
    }

    setProgress(100, 'Done!');
    await yieldToUI();
    hideProgress();
    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    console.info(`[coverage] done in ${elapsed}s for ${state.repeaters.length} repeater(s)`);
    setStatus(`Coverage computed for ${state.repeaters.length} repeater(s). Elevation data via open-elevation.com`);
  } catch (err) {
    hideProgress();
    setStatus(`Error: ${err.message}`);
    console.error(err);
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
    worker.onmessage = ({ data: msg }) => {
      if (msg.type === 'progress') {
        onProgress(msg.pct);
      } else if (msg.type === 'done') {
        worker.terminate();
        resolve(msg.signalGrid);
      }
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(`Coverage worker error: ${err.message}`));
    };
    worker.postMessage(payload, transfer);
  });
}

export function init() {
  document.getElementById('btn-compute').addEventListener('click', runCoverageAnalysis);

  document.getElementById('coverage-opacity').addEventListener('input', e => {
    const opacity = parseFloat(e.target.value) / 100;
    state.coverageLayers.forEach(l => l.setOpacity(opacity));
  });

  // U2: show/hide the Forest Loss row based on whether foliage is enabled
  const foliageToggle = document.getElementById('use-foliage');
  const foliageRow    = document.getElementById('foliage-loss-per-m').closest('label');
  const toggleFoliageRow = () => { foliageRow.style.display = foliageToggle.checked ? '' : 'none'; };
  foliageToggle.addEventListener('change', (e) => {
    if (!e.target.checked) clearFoliageLayers();
    toggleFoliageRow();
  });
  toggleFoliageRow();

  const buildingToggle = document.getElementById('use-buildings');
  const buildingRow    = document.getElementById('building-loss-per-m').closest('label');
  const toggleBuildingRow = () => { buildingRow.style.display = buildingToggle.checked ? '' : 'none'; };
  buildingToggle.addEventListener('change', (e) => {
    if (!e.target.checked) clearBuildingLayers();
    toggleBuildingRow();
  });
  toggleBuildingRow();

  // U3: clear coverage without removing repeaters
  document.getElementById('btn-clear-coverage').addEventListener('click', () => {
    clearCoverageLayers();
    clearFoliageLayers();
    clearBuildingLayers();
    setStatus('Coverage cleared.');
  });
}
