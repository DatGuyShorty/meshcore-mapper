/**
 * mapLayers.js - Independent OSM overlay layers (foliage, buildings).
 * These are visual reference layers shown on the map regardless of whether
 * coverage analysis is running. Fetched based on the current map viewport.
 * Exports: init
 */
import { map, state, clearFoliageLayers, clearBuildingLayers } from './map.js';
import { fetchFoliage } from './foliage.js';
import { fetchBuildings } from './buildings.js';
import { setButtonBusy, setInlineStatus, yieldToUI } from './ui.js';

let _foliageEnabled = false;
let _buildingsEnabled = false;
let _autoRefresh = true;
let _loading = false;
let _refreshTimer = null;
let _abortController = null;

const DEFAULT_FOLIAGE_OPACITY = 0.18;
const DEFAULT_BUILDING_OPACITY = 0.45;

let _polyRenderer = null;
function _getRenderer() {
  if (!_polyRenderer) _polyRenderer = L.canvas({ padding: 0.1 });
  return _polyRenderer;
}

function _setStatus(msg, kind = 'info') {
  setInlineStatus('layer-status', msg, kind);
}

function _opacityFromSlider(id, fallback) {
  const value = parseFloat(document.getElementById(id)?.value);
  const pct = Number.isFinite(value) ? value : fallback * 100;
  return Math.max(0, Math.min(1, pct / 100));
}

function _outlineOpacity(fillOpacity, boost) {
  if (fillOpacity <= 0) return 0;
  return Math.min(1, fillOpacity + boost);
}

function _foliageStyle() {
  const fillOpacity = _opacityFromSlider('foliage-opacity', DEFAULT_FOLIAGE_OPACITY);
  return {
    color: '#22c55e',
    weight: 1,
    opacity: _outlineOpacity(fillOpacity, 0.42),
    fill: true,
    fillColor: '#22c55e',
    fillOpacity,
    interactive: false,
  };
}

function _buildingStyle(fillColor) {
  const fillOpacity = _opacityFromSlider('building-opacity', DEFAULT_BUILDING_OPACITY);
  return {
    color: '#6b7280',
    weight: 0.8,
    opacity: _outlineOpacity(fillOpacity, 0.25),
    fill: true,
    fillColor,
    fillOpacity,
    interactive: false,
  };
}

function _applyFoliageOpacity() {
  const style = _foliageStyle();
  state.foliageLayers.forEach(layer => layer.setStyle(style));
}

function _applyBuildingOpacity() {
  const fillOpacity = _opacityFromSlider('building-opacity', DEFAULT_BUILDING_OPACITY);
  const opacity = _outlineOpacity(fillOpacity, 0.25);
  state.buildingLayers.forEach(layer => layer.setStyle({ opacity, fillOpacity }));
}

async function _loadFoliage(signal) {
  clearFoliageLayers();
  const b = map.getBounds();
  const deriveObstacleHeights = document.getElementById('obstacle-height-mode')?.value === 'dsm-dem';
  const data = await fetchFoliage(b.getSouth(), b.getNorth(), b.getWest(), b.getEast(), { signal, deriveObstacleHeights });
  for (let i = 0; i < data.polygons.length; i++) {
    if (signal?.aborted) throw _abortError();
    const poly = data.polygons[i];
    const layer = L.polygon(poly, {
      renderer: _getRenderer(),
      ..._foliageStyle(),
    }).addTo(map);
    state.foliageLayers.push(layer);
    if (i % 200 === 0) await yieldToUI();
  }
  return data.polygons.length;
}

async function _loadBuildings(signal) {
  clearBuildingLayers();
  const b = map.getBounds();
  const deriveObstacleHeights = document.getElementById('obstacle-height-mode')?.value === 'dsm-dem';
  const data = await fetchBuildings(b.getSouth(), b.getNorth(), b.getWest(), b.getEast(), { signal, deriveObstacleHeights });
  for (let bi = 0; bi < data.polygons.length; bi++) {
    if (signal?.aborted) throw _abortError();
    const poly = data.polygons[bi];
    const h = data.heights[bi] ?? 5;
    const t = Math.min(1, h / 30);
    const fill = t < 0.33 ? '#9ca3af' : t < 0.66 ? '#c4a875' : '#a0856e';
    const layer = L.polygon(poly, {
      renderer: _getRenderer(),
      ..._buildingStyle(fill),
    }).addTo(map);
    state.buildingLayers.push(layer);
    if (bi % 200 === 0) await yieldToUI();
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
  _abortController = new AbortController();
  const btn = document.getElementById('btn-refresh-layers');
  const cancelBtn = document.getElementById('btn-cancel-layers');
  setButtonBusy(btn, true, 'Loading...');
  if (cancelBtn) cancelBtn.disabled = false;
  _setStatus('Loading layers...');

  try {
    const parts = [];
    if (_foliageEnabled) {
      const n = await _loadFoliage(_abortController.signal);
      parts.push(`${n} vegetation polygon${n !== 1 ? 's' : ''}`);
    }
    if (_buildingsEnabled) {
      const n = await _loadBuildings(_abortController.signal);
      parts.push(`${n} building${n !== 1 ? 's' : ''}`);
    }
    _setStatus(parts.length ? parts.join(', ') + ' loaded.' : '', parts.length ? 'success' : 'info');
  } catch (e) {
    if (e?.cancelled || e?.name === 'AbortError') {
      _setStatus('Layer refresh cancelled.', 'warning');
    } else {
      _setStatus('Layer fetch failed. Check connection.', 'error');
      console.warn('[mapLayers] refresh failed:', e);
    }
  } finally {
    _loading = false;
    _abortController = null;
    setButtonBusy(btn, false);
    if (cancelBtn) cancelBtn.disabled = true;
  }
}

function _abortError() {
  const err = new Error('Cancelled');
  err.name = 'AbortError';
  err.cancelled = true;
  return err;
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
  const foliageOpacityEl = document.getElementById('foliage-opacity');
  const buildingOpacityEl = document.getElementById('building-opacity');

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

  foliageOpacityEl.addEventListener('input', _applyFoliageOpacity);
  buildingOpacityEl.addEventListener('input', _applyBuildingOpacity);

  document.getElementById('btn-refresh-layers').addEventListener('click', _refresh);
  document.getElementById('btn-cancel-layers').addEventListener('click', () => _abortController?.abort());

  map.on('moveend', _scheduleRefresh);
  if (_foliageEnabled || _buildingsEnabled) setTimeout(_refresh, 0);
}
