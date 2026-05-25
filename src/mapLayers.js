/**
 * mapLayers.js - Independent OSM overlay layers (foliage, buildings, barriers).
 * These are visual reference layers shown on the map regardless of whether
 * coverage analysis is running. Fetched based on the current map viewport.
 * Exports: init
 */
import { map, state, clearFoliageLayers, clearBuildingLayers, clearBarrierLayers } from './map.js';
import { fetchFoliage } from './foliage.js';
import { fetchBuildings } from './buildings.js';
import { setButtonBusy, setInlineStatus, yieldToUI } from './ui.js';

let _foliageEnabled = false;
let _buildingsEnabled = false;
let _barriersEnabled = false;
let _autoRefresh = true;
let _loading = false;
let _refreshTimer = null;
let _abortController = null;
let _suppressStartupRefresh = true;

const DEFAULT_FOLIAGE_OPACITY = 0.18;
const DEFAULT_BUILDING_OPACITY = 0.45;
const DEFAULT_BARRIER_OPACITY = 0.35;

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

const FOLIAGE_COLORS = {
  forest: '#22c55e',
  wood: '#22c55e',
  orchard: '#4d7c0f',
  vineyard: '#4d7c0f',
  shrubbery: '#16a34a',
  scrub: '#15803d',
  heath: '#166534',
  wetland: '#0f766e',
  mangrove: '#0f766e',
  meadow: '#84cc16',
  farmland: '#bef264',
  park: '#22c55e',
  reedbed: '#0d9488',
  swamp: '#115e59',
  tree_row: '#15803d',
  greenhouse_horticulture: '#4d7c0f',
  plant_nursery: '#4d7c0f',
  hedge: '#86efac',
};

function _foliageStyle(kind = 'forest') {
  const fillOpacity = _opacityFromSlider('foliage-opacity', DEFAULT_FOLIAGE_OPACITY);
  const fillColor = FOLIAGE_COLORS[kind] || FOLIAGE_COLORS.forest;
  return {
    color: fillColor,
    weight: 1,
    opacity: _outlineOpacity(fillOpacity, 0.42),
    fill: true,
    fillColor,
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

function _barrierStyle() {
  const fillOpacity = _opacityFromSlider('barrier-opacity', DEFAULT_BARRIER_OPACITY);
  return {
    color: '#f97316',
    weight: 1.2,
    opacity: _outlineOpacity(fillOpacity, 0.4),
    fill: true,
    fillColor: '#fb923c',
    fillOpacity,
    interactive: false,
  };
}

function _applyBarrierOpacity() {
  const style = _barrierStyle();
  state.barrierLayers.forEach(layer => layer.setStyle(style));
}

async function _loadFoliage(signal) {
  clearFoliageLayers();
  const b = map.getBounds();
  const deriveObstacleHeights = document.getElementById('obstacle-height-mode')?.value === 'dsm-dem';
  const data = await fetchFoliage(b.getSouth(), b.getNorth(), b.getWest(), b.getEast(), { signal, deriveObstacleHeights });
  for (let i = 0; i < data.polygons.length; i++) {
    if (signal?.aborted) throw _abortError();
    const poly = data.polygons[i];
    const kind = String(data.kinds?.[i] ?? 'forest');
    const layer = L.polygon(poly, {
      renderer: _getRenderer(),
      ..._foliageStyle(kind),
    }).addTo(map);
    state.foliageLayers.push(layer);
    if (i % 200 === 0) await yieldToUI();
  }
  return data.polygons.length;
}

async function _loadBuildings(signal) {
  clearBuildingLayers();
  clearBarrierLayers();
  const b = map.getBounds();
  const deriveObstacleHeights = document.getElementById('obstacle-height-mode')?.value === 'dsm-dem';
  const data = await fetchBuildings(b.getSouth(), b.getNorth(), b.getWest(), b.getEast(), { signal, deriveObstacleHeights });
  let buildingCount = 0;
  let barrierCount = 0;

  for (let bi = 0; bi < data.polygons.length; bi++) {
    if (signal?.aborted) throw _abortError();
    const poly = data.polygons[bi];
    const kind = String(data.kinds?.[bi] ?? 'building');
    const isBarrier = kind.startsWith('barrier:') || kind.startsWith('man_made:') || kind.startsWith('military:');
    if (!isBarrier && !_buildingsEnabled) continue;
    if (isBarrier && !_barriersEnabled) continue;

    const h = data.heights[bi] ?? 5;
    const t = Math.min(1, h / 30);
    const fill = isBarrier ? '#fb923c' : (t < 0.33 ? '#9ca3af' : t < 0.66 ? '#c4a875' : '#a0856e');
    const style = isBarrier ? _barrierStyle() : _buildingStyle(fill);
    const layer = L.polygon(poly, {
      renderer: _getRenderer(),
      ...style,
    }).addTo(map);

    if (isBarrier) {
      state.barrierLayers.push(layer);
      barrierCount++;
    } else {
      state.buildingLayers.push(layer);
      buildingCount++;
    }
    if (bi % 200 === 0) await yieldToUI();
  }
  return { buildingCount, barrierCount };
}

async function _refresh() {
  if (_loading) return;
  if (!_foliageEnabled && !_buildingsEnabled && !_barriersEnabled) {
    _setStatus('Enable vegetation, buildings, or barriers before refreshing.', 'warning');
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
    if (_buildingsEnabled || _barriersEnabled) {
      const { buildingCount, barrierCount } = await _loadBuildings(_abortController.signal);
      if (_buildingsEnabled) parts.push(`${buildingCount} building${buildingCount !== 1 ? 's' : ''}`);
      if (_barriersEnabled) parts.push(`${barrierCount} barrier${barrierCount !== 1 ? 's' : ''}`);
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
  if (_suppressStartupRefresh) {
    _suppressStartupRefresh = false;
    return;
  }
  if (!_autoRefresh || (!_foliageEnabled && !_buildingsEnabled && !_barriersEnabled)) return;
  clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(_refresh, 800);
}

export function init() {
  const foliageEl = document.getElementById('layer-foliage');
  const buildingsEl = document.getElementById('layer-buildings');
  const barriersEl = document.getElementById('layer-barriers');
  const autoRefreshEl = document.getElementById('layer-auto-refresh');
  const foliageOpacityEl = document.getElementById('foliage-opacity');
  const buildingOpacityEl = document.getElementById('building-opacity');
  const barrierOpacityEl = document.getElementById('barrier-opacity');

  _foliageEnabled = foliageEl.checked;
  _buildingsEnabled = buildingsEl.checked;
  _barriersEnabled = barriersEl.checked;
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

  barriersEl.addEventListener('change', async (e) => {
    _barriersEnabled = e.target.checked;
    if (!_barriersEnabled) { clearBarrierLayers(); _setStatus(''); return; }
    await _refresh();
  });

  autoRefreshEl.addEventListener('change', (e) => {
    _autoRefresh = e.target.checked;
  });

  foliageOpacityEl.addEventListener('input', _applyFoliageOpacity);
  buildingOpacityEl.addEventListener('input', _applyBuildingOpacity);
  barrierOpacityEl.addEventListener('input', _applyBarrierOpacity);

  document.getElementById('btn-refresh-layers').addEventListener('click', _refresh);
  document.getElementById('btn-cancel-layers').addEventListener('click', () => _abortController?.abort());

  map.on('moveend', _scheduleRefresh);
  if (_foliageEnabled || _buildingsEnabled || _barriersEnabled) {
    if (_autoRefresh) {
      _refresh().catch((e) => {
        console.warn('[mapLayers] initial layer load failed:', e);
      });
    } else {
      _setStatus('Layers enabled. Pan/zoom map or click Refresh Layers to load data.');
    }
  }
}
