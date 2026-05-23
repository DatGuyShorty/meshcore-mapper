/**
 * optimizerUI.js — Draw search area, run optimizer, display results.
 * Exports: init
 */
import { map } from './map.js';
import { setProgress, hideProgress, setStatus, yieldToUI } from './ui.js';
import { addRepeater, cancelPlacing } from './repeaters.js';
import { findBestLocations } from './optimizer.js';

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
        <div class="ori-score">${(r.score * 100).toFixed(1)}% coverage · ${r.elevM.toFixed(0)} m elev</div>
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
  });

  document.getElementById('btn-draw-area').addEventListener('click', () => {
    if (drawing) return;
    drawing = true;
    corner1 = null;
    cancelPlacing();
    document.getElementById('draw-hint').classList.remove('hidden');
    map.getContainer().style.cursor = 'crosshair';
  });

  document.getElementById('btn-clear-area').addEventListener('click', clearArea);

  map.on('click', (e) => {
    if (!drawing) return;
    cancelPlacing();

    if (!corner1) {
      corner1 = { lat: e.latlng.lat, lon: e.latlng.lng };
      document.getElementById('draw-hint').textContent = 'Now click the opposite corner…';
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
    document.getElementById('draw-hint').textContent = 'Click two opposite corners of the search area on the map…';
    document.getElementById('btn-optimize').disabled = false;
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
      return;
    }

    const txParams = {
      height: parseFloat(document.getElementById('opt-height').value)       || 10,
      power:  parseFloat(document.getElementById('repeater-power').value)   || 20,
      freq:   parseFloat(document.getElementById('repeater-freq').value)    || 868,
      gain:   parseFloat(document.getElementById('repeater-gain').value)    || 2,
    };

    const opts = {
      rxHeight:     parseFloat(document.getElementById('rx-height').value)       || 1.5,
      rxSens:       parseFloat(document.getElementById('rx-sensitivity').value)  || -137,
      fadeMargin:   parseFloat(document.getElementById('fade-margin').value)     || 0,
      radiusKm:     parseFloat(document.getElementById('analysis-radius').value) || 15,
      useLos:       document.getElementById('use-los').checked,
      useFresnel:   document.getElementById('use-fresnel').checked,
      candidateRes: parseInt(document.getElementById('opt-candidate-res').value) || 20,
      evalRes: 48,
    };

    const nRepeaters = parseInt(document.getElementById('opt-n-repeaters').value) || 1;

    clearResults();
    setProgress(2, 'Starting optimizer…');

    try {
      const results = await findBestLocations(bounds, nRepeaters, txParams, opts,
        (pct, msg) => setProgress(pct, msg));

      setProgress(100, 'Optimization complete.');
      await yieldToUI();
      hideProgress();
      renderResults(results, txParams);
      setStatus(`Optimizer found ${results.length} best location(s).`);
    } catch (err) {
      hideProgress();
      setStatus(`Optimizer error: ${err.message}`);
      console.error(err);
    }
  });
}
