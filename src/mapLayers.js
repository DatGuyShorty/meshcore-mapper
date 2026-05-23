/**
 * mapLayers.js — Independent OSM overlay layers (foliage, buildings).
 * These are visual reference layers shown on the map regardless of whether
 * coverage analysis is running. Fetched based on the current map viewport.
 * Exports: init
 */
import { map, state, clearFoliageLayers, clearBuildingLayers } from './map.js';
import { fetchFoliage } from './foliage.js';
import { fetchBuildings } from './buildings.js';

let _foliageEnabled   = false;
let _buildingsEnabled = false;
let _autoRefresh      = true;
let _loading          = false;
let _refreshTimer     = null;

// Shared canvas renderer for all overlay polygons
let _polyRenderer = null;
function _getRenderer() {
  if (!_polyRenderer) _polyRenderer = L.canvas({ padding: 0.1 });
  return _polyRenderer;
}

function _setStatus(msg) {
  const el = document.getElementById('layer-status');
  if (el) el.textContent = msg;
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
    const h    = data.heights[bi] ?? 5;
    const t    = Math.min(1, h / 30);
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
  if (!_foliageEnabled && !_buildingsEnabled) return;

  _loading = true;
  const btn = document.getElementById('btn-refresh-layers');
  if (btn) btn.disabled = true;
  _setStatus('Loading…');

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
    _setStatus(parts.length ? parts.join(', ') + ' loaded.' : '');
  } catch (e) {
    _setStatus('Fetch failed — check connection.');
    console.warn('[mapLayers] refresh failed:', e);
  } finally {
    _loading = false;
    if (btn) btn.disabled = false;
  }
}

function _scheduleRefresh() {
  if (!_autoRefresh || (!_foliageEnabled && !_buildingsEnabled)) return;
  clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(_refresh, 800);
}

export function init() {
  document.getElementById('layer-foliage').addEventListener('change', async (e) => {
    _foliageEnabled = e.target.checked;
    if (!_foliageEnabled) { clearFoliageLayers(); _setStatus(''); return; }
    await _refresh();
  });

  document.getElementById('layer-buildings').addEventListener('change', async (e) => {
    _buildingsEnabled = e.target.checked;
    if (!_buildingsEnabled) { clearBuildingLayers(); _setStatus(''); return; }
    await _refresh();
  });

  document.getElementById('layer-auto-refresh').addEventListener('change', (e) => {
    _autoRefresh = e.target.checked;
  });

  document.getElementById('btn-refresh-layers').addEventListener('click', _refresh);

  map.on('moveend', _scheduleRefresh);
}
