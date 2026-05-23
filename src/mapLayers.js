/**
 * mapLayers.js - Independent OSM overlay layers (foliage, buildings).
 * These are visual reference layers shown on the map regardless of whether
 * coverage analysis is running. Fetched based on the current map viewport.
 * Exports: init
 */
import { map, state, clearFoliageLayers, clearBuildingLayers } from './map.js';
import { fetchFoliage } from './foliage.js';
import { fetchBuildings } from './buildings.js';
import { setButtonBusy, setInlineStatus } from './ui.js';

let _foliageEnabled = false;
let _buildingsEnabled = false;
let _autoRefresh = true;
let _loading = false;
let _refreshTimer = null;

let _polyRenderer = null;
function _getRenderer() {
  if (!_polyRenderer) _polyRenderer = L.canvas({ padding: 0.1 });
  return _polyRenderer;
}

function _setStatus(msg, kind = 'info') {
  setInlineStatus('layer-status', msg, kind);
}

async function _loadFoliage() {
  clearFoliageLayers();
  const b = map.getBounds();
  const data = await fetchFoliage(b.getSouth(), b.getNorth(), b.getWest(), b.getEast());
  for (const poly of data.polygons) {
    const layer = L.polygon(poly, {
      renderer: _getRenderer(),
      color: '#22c55e', weight: 1, opacity: 0.6,
      fill: true, fillColor: '#22c55e', fillOpacity: 0.18, interactive: false,
    }).addTo(map);
    state.foliageLayers.push(layer);
  }
  return data.polygons.length;
}

async function _loadBuildings() {
  clearBuildingLayers();
  const b = map.getBounds();
  const data = await fetchBuildings(b.getSouth(), b.getNorth(), b.getWest(), b.getEast());
  for (let bi = 0; bi < data.polygons.length; bi++) {
    const poly = data.polygons[bi];
    const h = data.heights[bi] ?? 5;
    const t = Math.min(1, h / 30);
    const fill = t < 0.33 ? '#9ca3af' : t < 0.66 ? '#c4a875' : '#a0856e';
    const layer = L.polygon(poly, {
      renderer: _getRenderer(),
      color: '#6b7280', weight: 0.8, opacity: 0.7,
      fill: true, fillColor: fill, fillOpacity: 0.45, interactive: false,
    }).addTo(map);
    state.buildingLayers.push(layer);
  }
  return data.polygons.length;
}

async function _refresh() {
  if (_loading) return;
  if (!_foliageEnabled && !_buildingsEnabled) {
    _setStatus('Enable vegetation or buildings before refreshing.', 'warning');
    return;
  }

  _loading = true;
  const btn = document.getElementById('btn-refresh-layers');
  setButtonBusy(btn, true, 'Loading...');
  _setStatus('Loading layers...');

  try {
    const parts = [];
    if (_foliageEnabled) {
      const n = await _loadFoliage();
      parts.push(`${n} vegetation polygon${n !== 1 ? 's' : ''}`);
    }
    if (_buildingsEnabled) {
      const n = await _loadBuildings();
      parts.push(`${n} building${n !== 1 ? 's' : ''}`);
    }
    _setStatus(parts.length ? parts.join(', ') + ' loaded.' : '', parts.length ? 'success' : 'info');
  } catch (e) {
    _setStatus('Layer fetch failed. Check connection.', 'error');
    console.warn('[mapLayers] refresh failed:', e);
  } finally {
    _loading = false;
    setButtonBusy(btn, false);
  }
}

function _scheduleRefresh() {
  if (!_autoRefresh || (!_foliageEnabled && !_buildingsEnabled)) return;
  clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(_refresh, 800);
}

export function init() {
  const foliageEl = document.getElementById('layer-foliage');
  const buildingsEl = document.getElementById('layer-buildings');
  const autoRefreshEl = document.getElementById('layer-auto-refresh');

  _foliageEnabled = foliageEl.checked;
  _buildingsEnabled = buildingsEl.checked;
  _autoRefresh = autoRefreshEl.checked;

  foliageEl.addEventListener('change', async (e) => {
    _foliageEnabled = e.target.checked;
    if (!_foliageEnabled) { clearFoliageLayers(); _setStatus(''); return; }
    await _refresh();
  });

  buildingsEl.addEventListener('change', async (e) => {
    _buildingsEnabled = e.target.checked;
    if (!_buildingsEnabled) { clearBuildingLayers(); _setStatus(''); return; }
    await _refresh();
  });

  autoRefreshEl.addEventListener('change', (e) => {
    _autoRefresh = e.target.checked;
  });

  document.getElementById('btn-refresh-layers').addEventListener('click', _refresh);

  map.on('moveend', _scheduleRefresh);
  if (_foliageEnabled || _buildingsEnabled) setTimeout(_refresh, 0);
}
