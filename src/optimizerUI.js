/**
 * optimizerUI.js — Draw search area, run optimizer, display results.
 * Exports: init
 */
import { map } from './map.js';
import {
  setProgress, hideProgress, setStatus, yieldToUI,
  setActiveTab, setButtonBusy, setInlineStatus,
} from './ui.js';
import { addRepeater, cancelPlacing } from './repeaters.js';
import { buildGrid } from './optimizer.js';
import { fetchElevations } from './elevation.js';
import { fetchFoliage } from './foliage.js';
import { fetchBuildings } from './buildings.js';
import { getOptimizerSettings } from './settings.js';

// Module-local interaction state
let drawing     = false;
let corner1     = null;
let areaRect    = null;
const resultMarkers = [];

function clearResults() {
  resultMarkers.forEach(m => map.removeLayer(m));
  resultMarkers.length = 0;
  document.getElementById('opt-results').innerHTML = '';
}

function clearArea() {
  if (areaRect) { map.removeLayer(areaRect); areaRect = null; }
  corner1 = null;
  drawing = false;
  document.getElementById('draw-hint').classList.add('hidden');
  document.getElementById('btn-optimize').disabled = true;
  setInlineStatus('opt-status', 'Draw a search area to enable the optimizer.', 'info');
  map.getContainer().style.cursor = '';
  clearResults();
}

function makeSuggestedIcon(rank) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="14" fill="#facc15" stroke="#fff" stroke-width="2"/>
    <text x="16" y="21" text-anchor="middle" font-size="14" font-weight="bold" fill="#0f1117">${rank}</text>
  </svg>`;
  return L.divIcon({ html: svg, iconSize: [32, 32], iconAnchor: [16, 16], className: '' });
}

function renderResults(results, txParams) {
  const ul = document.getElementById('opt-results');
  results.forEach((r, i) => {
    const marker = L.marker([r.lat, r.lon], { icon: makeSuggestedIcon(i + 1), zIndexOffset: 500 })
      .addTo(map)
      .bindPopup(`<b>Suggested #${i + 1}</b><br>${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}<br>Coverage: ${(r.score * 100).toFixed(1)}%<br>Elev: ${r.elevM.toFixed(0)} m`);
    resultMarkers.push(marker);

    const li = document.createElement('li');
    li.className = 'opt-result-item';
    li.innerHTML = `
      <span class="ori-rank">#${i + 1}</span>
      <div class="ori-info">
        <div class="ori-coords">${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}</div>
        <div class="ori-score">${(r.score * 100).toFixed(1)}% coverage, ${r.elevM.toFixed(0)} m elev</div>
      </div>
      <button class="ori-add" title="Add as repeater">+ Add</button>`;
    li.querySelector('.ori-add').addEventListener('click', () => {
      addRepeater(`Suggested ${i + 1}`, r.lat, r.lon, txParams.height, txParams.power, txParams.freq, txParams.gain);
    });
    ul.appendChild(li);
  });
}

export function init() {
  document.getElementById('btn-copy-to-opt').addEventListener('click', () => {
    document.getElementById('opt-height').value = document.getElementById('repeater-height').value;
    // F8: also copy power, freq, gain so the optimizer uses the same TX profile
    // (these don't have a dedicated opt-* input; they are read directly from the Nodes form at run time—
    //  so nothing extra to copy here; the optimizer already reads repeater-power/freq/gain at run time)
  });

  document.getElementById('btn-draw-area').addEventListener('click', () => {
    if (drawing) return;
    drawing = true;
    corner1 = null;
    cancelPlacing();
    document.getElementById('draw-hint').classList.remove('hidden');
    setInlineStatus('opt-status', 'Draw mode active.', 'warning');
    map.getContainer().style.cursor = 'crosshair';
  });

  document.getElementById('btn-clear-area').addEventListener('click', clearArea);

  // Context-menu "Optimize Here" shortcut: build a search area around a specific repeater
  document.addEventListener('map:optimize-here', ({ detail: { lat, lon } }) => {
    const radiusKm = parseFloat(document.getElementById('analysis-radius').value) || 15;
    const dLat = radiusKm / 110.574;
    const dLon = radiusKm / (111.320 * Math.cos(lat * Math.PI / 180));
    const bounds = [[lat - dLat, lon - dLon], [lat + dLat, lon + dLon]];
    if (areaRect) map.removeLayer(areaRect);
    areaRect = L.rectangle(bounds, { className: 'search-area-rect' }).addTo(map);
    corner1 = null;
    drawing = false;
    document.getElementById('draw-hint').classList.add('hidden');
    document.getElementById('btn-optimize').disabled = false;
    setInlineStatus('opt-status', 'Search area ready.', 'success');
    clearResults();
    map.fitBounds(bounds, { padding: [40, 40] });
    setActiveTab('planning');
  });

  map.on('click', (e) => {
    if (!drawing) return;
    cancelPlacing();

    if (!corner1) {
      corner1 = { lat: e.latlng.lat, lon: e.latlng.lng };
      document.getElementById('draw-hint').textContent = 'Now click the opposite corner.';
      return;
    }

    const c2 = { lat: e.latlng.lat, lon: e.latlng.lng };
    const bounds = [
      [Math.min(corner1.lat, c2.lat), Math.min(corner1.lon, c2.lon)],
      [Math.max(corner1.lat, c2.lat), Math.max(corner1.lon, c2.lon)],
    ];

    if (areaRect) map.removeLayer(areaRect);
    areaRect = L.rectangle(bounds, { className: 'search-area-rect' }).addTo(map);

    drawing = false;
    document.getElementById('draw-hint').classList.add('hidden');
    document.getElementById('draw-hint').textContent = 'Click two opposite corners of the search area on the map.';
    document.getElementById('btn-optimize').disabled = false;
    setInlineStatus('opt-status', 'Search area ready.', 'success');
    map.getContainer().style.cursor = '';
    clearResults();
  });

  document.getElementById('btn-optimize').addEventListener('click', async () => {
    if (!areaRect) return;

    const b = areaRect.getBounds();
    const bounds = {
      latMin: b.getSouth(), latMax: b.getNorth(),
      lonMin: b.getWest(),  lonMax: b.getEast(),
    };

    if (bounds.latMax - bounds.latMin < 0.001 || bounds.lonMax - bounds.lonMin < 0.001) {
      setStatus('Search area is too small. Draw a larger rectangle.');
      setInlineStatus('opt-status', 'Search area is too small.', 'error');
      return;
    }

    const { txParams, opts, nRepeaters } = getOptimizerSettings();

    clearResults();
    setButtonBusy('btn-optimize', true, 'Scoring...');
    setInlineStatus('opt-status', 'Scoring candidate locations...', 'info');

    try {
      setProgress(2, 'Building evaluation grid...');
      const evalPoints = buildGrid(bounds.latMin, bounds.latMax, bounds.lonMin, bounds.lonMax, opts.evalRes);
      const candidates = buildGrid(bounds.latMin, bounds.latMax, bounds.lonMin, bounds.lonMax, opts.candidateRes);

      setProgress(5, `Fetching elevation for ${evalPoints.length + candidates.length} points...`);
      const allPoints = [...evalPoints, ...candidates];
      const allElevs  = opts.useLos ? await fetchElevations(allPoints) : allPoints.map(() => 0);
      const evalElevs      = allElevs.slice(0, evalPoints.length);
      const candidateElevs = allElevs.slice(evalPoints.length);

      if (opts.useFoliage || opts.useBuildings) {
        setProgress(12, 'Fetching obstacle layers...');
        const [foliage, buildings] = await Promise.all([
          opts.useFoliage
            ? fetchFoliage(bounds.latMin, bounds.latMax, bounds.lonMin, bounds.lonMax)
                .catch(e => { console.warn('[optimizer] foliage fetch failed, skipping:', e); return null; })
            : Promise.resolve(null),
          opts.useBuildings
            ? fetchBuildings(bounds.latMin, bounds.latMax, bounds.lonMin, bounds.lonMax)
                .catch(e => { console.warn('[optimizer] buildings fetch failed, skipping:', e); return null; })
            : Promise.resolve(null),
        ]);
        opts.foliage = foliage;
        opts.buildings = buildings;
      }

      setProgress(20, 'Scoring candidate locations...');

      const results = await _runOptimizerWorker(
        { evalPoints, evalElevs, candidates, candidateElevs, nRepeaters, txParams,
          opts: { ...opts, latMin: bounds.latMin, latMax: bounds.latMax,
                           lonMin: bounds.lonMin, lonMax: bounds.lonMax } },
        (pct, msg) => setProgress(pct, msg)
      );

      setProgress(100, 'Optimization complete.');
      await yieldToUI();
      hideProgress();
      renderResults(results, txParams);
      setStatus(`Optimizer found ${results.length} best location(s).`);
      setInlineStatus('opt-status', `Found ${results.length} best location${results.length !== 1 ? 's' : ''}.`, 'success');
    } catch (err) {
      hideProgress();
      setStatus(`Optimizer error: ${err.message}`);
      setInlineStatus('opt-status', `Optimizer error: ${err.message}`, 'error');
      console.error(err);
    } finally {
      setButtonBusy('btn-optimize', false);
    }
  });
}

function _runOptimizerWorker(data, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./optimizerWorker.js', import.meta.url),
      { type: 'module' }
    );
    worker.onmessage = ({ data: msg }) => {
      if (msg.type === 'progress') {
        onProgress(msg.pct, msg.msg);
      } else if (msg.type === 'done') {
        worker.terminate();
        resolve(msg.results);
      }
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(`Optimizer worker error: ${err.message}`));
    };
    worker.postMessage(data);
  });
}
