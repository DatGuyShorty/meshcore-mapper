/**
 * mapLayers.ts - Independent OSM overlay layers (foliage, buildings, barriers).
 * These are visual reference layers shown on the map regardless of whether
 * coverage analysis is running. Fetched based on the current map viewport.
 * Exports: init
 */
import { map, state, clearFoliageLayers, clearBuildingLayers, clearBarrierLayers } from './map.js';
import { fetchFoliage } from './foliage.js';
import { fetchBuildings } from './buildings.js';
import { hideProgress, setButtonBusy, setCancelHandler, setInlineStatus, setProgress, yieldToUI } from './ui.js';

type LayerCategory = 'foliage' | 'building' | 'barrier';

type LayerStyle = {
  color: string;
  weight: number;
  opacity: number;
  fill: boolean;
  fillColor: string;
  fillOpacity: number;
  interactive: boolean;
};

export type ObstacleMetadata = {
  id: string;
  category: LayerCategory;
  title: string;
  source: string;
  osmType: string;
  rawOsmType: string;
  heightM: number | null;
  heightLabel: string;
  heightSource: string;
  attenuationDbPerM: number | null;
  attenuationFactor: number | null;
  attenuationLabel: string;
  geometry: 'Polygon';
};

type ObstacleInput = {
  category: LayerCategory;
  id: string | number;
  osmType: string;
  heightM?: number | null;
  attenuationDbPerM?: number | null;
  attenuationFactor?: number | null;
};

type LeafletObstacleLayer = {
  setStyle?(style: LayerStyle): void;
  on?(event: 'click', handler: (event: ObstacleClickEvent) => void): void;
  addTo(target: unknown): LeafletObstacleLayer;
  _foliageKind?: string;
  _obstacle?: ObstacleMetadata;
  _buildingFill?: string;
};

type ObstacleClickEvent = {
  originalEvent?: {
    _meshcoreHandled?: boolean;
  };
} | null;

type AbortError = Error & { cancelled?: boolean };

type ProgressMeta = {
  title: string;
};

type PolygonPoint = [number, number];
type PolygonRing = PolygonPoint[];
type PolygonShape = PolygonRing | PolygonRing[];

type FoliageData = {
  polygons: PolygonShape[];
  kinds?: ArrayLike<unknown>;
  factors?: ArrayLike<unknown>;
  ids?: ArrayLike<unknown>;
  canopyHeights?: ArrayLike<unknown>;
};

type BuildingData = {
  polygons: PolygonShape[];
  kinds?: ArrayLike<unknown>;
  ids?: ArrayLike<unknown>;
  heights: ArrayLike<unknown>;
};

type RefreshOptions = {
  showJob?: boolean;
};

type SelectionChangedDetail = {
  kind?: string;
  id?: unknown;
};

let _foliageEnabled = false;
let _buildingsEnabled = false;
let _barriersEnabled = false;
let _autoRefresh = true;
let _loading = false;
let _refreshTimer: ReturnType<typeof setTimeout> | null = null;
let _abortController: AbortController | null = null;
let _suppressStartupRefresh = true;
let _selectedObstacleId: string | null = null;

const DEFAULT_FOLIAGE_OPACITY = 0.18;
const DEFAULT_BUILDING_OPACITY = 0.45;
const DEFAULT_BARRIER_OPACITY = 0.35;

let _polyRenderer: unknown = null;
function _getRenderer(): unknown {
  if (!_polyRenderer) _polyRenderer = L.canvas({ padding: 0.1 });
  return _polyRenderer;
}

function _setStatus(msg: string, kind = 'info'): void {
  setInlineStatus('layer-status', msg, kind);
}

function _layerJobTitle(): string {
  const parts: string[] = [];
  if (_foliageEnabled) parts.push('vegetation');
  if (_buildingsEnabled) parts.push('buildings');
  if (_barriersEnabled) parts.push('barriers');
  return `Map Layers: ${parts.join(', ') || 'refresh'}`;
}

export function _opacityFromSlider(id: string, fallback: number): number {
  const el = document.getElementById(id) as HTMLInputElement | null;
  const value = parseFloat(el?.value ?? '');
  const pct = Number.isFinite(value) ? value : fallback * 100;
  return Math.max(0, Math.min(1, pct / 100));
}

export function _outlineOpacity(fillOpacity: number, boost: number): number {
  if (fillOpacity <= 0) return 0;
  return Math.min(1, fillOpacity + boost);
}

const FOLIAGE_COLORS: Record<string, string> = {
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

export function _foliageStyle(kind = 'forest', selected = false): LayerStyle {
  const fillOpacity = _opacityFromSlider('foliage-opacity', DEFAULT_FOLIAGE_OPACITY);
  const fillColor = FOLIAGE_COLORS[kind] || FOLIAGE_COLORS.forest;
  return {
    color: fillColor,
    weight: selected ? 3 : 1,
    opacity: selected ? 1 : _outlineOpacity(fillOpacity, 0.42),
    fill: true,
    fillColor,
    fillOpacity,
    interactive: true,
  };
}

export function _buildingStyle(fillColor: string, selected = false): LayerStyle {
  const fillOpacity = _opacityFromSlider('building-opacity', DEFAULT_BUILDING_OPACITY);
  return {
    color: selected ? '#facc15' : '#6b7280',
    weight: selected ? 3 : 0.8,
    opacity: selected ? 1 : _outlineOpacity(fillOpacity, 0.25),
    fill: true,
    fillColor,
    fillOpacity,
    interactive: true,
  };
}

export function _barrierStyle(selected = false): LayerStyle {
  const fillOpacity = _opacityFromSlider('barrier-opacity', DEFAULT_BARRIER_OPACITY);
  return {
    color: selected ? '#facc15' : '#f97316',
    weight: selected ? 3 : 1.2,
    opacity: selected ? 1 : _outlineOpacity(fillOpacity, 0.4),
    fill: true,
    fillColor: '#fb923c',
    fillOpacity,
    interactive: true,
  };
}

function _isSelectedObstacle(obstacle: ObstacleMetadata | undefined): boolean {
  return _selectedObstacleId !== null && String(obstacle?.id) === _selectedObstacleId;
}

function _syncObstacleSelectionHighlight(): void {
  state.foliageLayers.forEach((layer: LeafletObstacleLayer) => {
    layer.setStyle?.(_foliageStyle(layer._foliageKind, _isSelectedObstacle(layer._obstacle)));
  });
  state.buildingLayers.forEach((layer: LeafletObstacleLayer) => {
    layer.setStyle?.(_buildingStyle(layer._buildingFill ?? '#9ca3af', _isSelectedObstacle(layer._obstacle)));
  });
  state.barrierLayers.forEach((layer: LeafletObstacleLayer) => {
    layer.setStyle?.(_barrierStyle(_isSelectedObstacle(layer._obstacle)));
  });
}

function _readableOsmType(kind: string): string {
  return String(kind || 'unknown').replace(/_/g, ' ');
}

function _numberInput(id: string, fallback: number): number {
  const value = parseFloat((document.getElementById(id) as HTMLInputElement | null)?.value ?? '');
  return Number.isFinite(value) ? value : fallback;
}

function _heightSourceLabel(): string {
  const mode = (document.getElementById('obstacle-height-mode') as HTMLSelectElement | null)?.value;
  return mode === 'dsm-dem'
    ? 'DSM-DEM sampled where available; OSM/default fallback'
    : 'OSM tags and local defaults';
}

export function _obstacleMetadata({
  category,
  id,
  osmType,
  heightM = null,
  attenuationDbPerM = null,
  attenuationFactor = null,
}: ObstacleInput): ObstacleMetadata {
  const titles = {
    foliage: 'Vegetation',
    building: 'Building',
    barrier: 'Barrier',
  } satisfies Record<LayerCategory, string>;
  return {
    id: `${category}:${id}`,
    category,
    title: titles[category],
    source: category === 'foliage' ? 'OpenStreetMap vegetation' : 'OpenStreetMap structures',
    osmType: _readableOsmType(osmType),
    rawOsmType: osmType,
    heightM: Number.isFinite(heightM) ? heightM : null,
    heightLabel: category === 'foliage' ? 'Canopy height' : 'Structure height',
    heightSource: _heightSourceLabel(),
    attenuationDbPerM: Number.isFinite(attenuationDbPerM) ? attenuationDbPerM : null,
    attenuationFactor: Number.isFinite(attenuationFactor) ? attenuationFactor : null,
    attenuationLabel: category === 'foliage' ? 'Vegetation loss' : 'Building/barrier loss',
    geometry: 'Polygon',
  };
}

export function _selectObstacle(obstacle: ObstacleMetadata, event: ObstacleClickEvent = null): void {
  if (event?.originalEvent) event.originalEvent._meshcoreHandled = true;
  document.dispatchEvent(new CustomEvent('obstacle:selected', { detail: { obstacle } }));
}

function _applyFoliageOpacity(): void {
  state.foliageLayers.forEach((layer: LeafletObstacleLayer) => {
    layer.setStyle?.(_foliageStyle(layer._foliageKind, _isSelectedObstacle(layer._obstacle)));
  });
}

function _applyBuildingOpacity(): void {
  state.buildingLayers.forEach((layer: LeafletObstacleLayer) => {
    layer.setStyle?.(_buildingStyle(layer._buildingFill ?? '#9ca3af', _isSelectedObstacle(layer._obstacle)));
  });
}

function _applyBarrierOpacity(): void {
  state.barrierLayers.forEach((layer: LeafletObstacleLayer) => {
    layer.setStyle?.(_barrierStyle(_isSelectedObstacle(layer._obstacle)));
  });
}

async function _loadFoliage(signal: AbortSignal): Promise<number> {
  clearFoliageLayers();
  const b = map.getBounds();
  const deriveObstacleHeights = (document.getElementById('obstacle-height-mode') as HTMLSelectElement | null)?.value === 'dsm-dem';
  const data = await fetchFoliage(b.getSouth(), b.getNorth(), b.getWest(), b.getEast(), { signal, deriveObstacleHeights }) as FoliageData;
  for (let i = 0; i < data.polygons.length; i++) {
    if (signal?.aborted) throw _abortError();
    const poly = data.polygons[i];
    const kind = String(data.kinds?.[i] ?? 'forest');
    const factor = Number(data.factors?.[i]);
    const baseLoss = _numberInput('foliage-loss-per-m', 0.3);
    const obstacle = _obstacleMetadata({
      category: 'foliage',
      id: String(data.ids?.[i] ?? i),
      osmType: kind,
      heightM: Number(data.canopyHeights?.[i] ?? NaN),
      attenuationDbPerM: baseLoss * (Number.isFinite(factor) ? factor : 1),
      attenuationFactor: Number.isFinite(factor) ? factor : null,
    });
    const layer = L.polygon(poly, {
      renderer: _getRenderer(),
      className: 'obstacle-foliage',
      ..._foliageStyle(kind, _isSelectedObstacle(obstacle)),
    }).addTo(map) as LeafletObstacleLayer;
    layer._foliageKind = kind;
    layer._obstacle = obstacle;
    layer.on?.('click', (event) => _selectObstacle(obstacle, event));
    state.foliageLayers.push(layer);
    if (i % 200 === 0) await yieldToUI();
  }
  return data.polygons.length;
}

async function _loadBuildings(signal: AbortSignal): Promise<{ buildingCount: number; barrierCount: number }> {
  clearBuildingLayers();
  clearBarrierLayers();
  const b = map.getBounds();
  const deriveObstacleHeights = (document.getElementById('obstacle-height-mode') as HTMLSelectElement | null)?.value === 'dsm-dem';
  const data = await fetchBuildings(b.getSouth(), b.getNorth(), b.getWest(), b.getEast(), { signal, deriveObstacleHeights }) as BuildingData;
  let buildingCount = 0;
  let barrierCount = 0;

  for (let bi = 0; bi < data.polygons.length; bi++) {
    if (signal?.aborted) throw _abortError();
    const poly = data.polygons[bi];
    const kind = String(data.kinds?.[bi] ?? 'building');
    const isBarrier = kind.startsWith('barrier:') || kind.startsWith('man_made:') || kind.startsWith('military:');
    if (!isBarrier && !_buildingsEnabled) continue;
    if (isBarrier && !_barriersEnabled) continue;

    const h = Number(data.heights[bi] ?? 5);
    const t = Math.min(1, h / 30);
    const fill = isBarrier ? '#fb923c' : (t < 0.33 ? '#9ca3af' : t < 0.66 ? '#c4a875' : '#a0856e');
    const category = isBarrier ? 'barrier' : 'building';
    const obstacle = _obstacleMetadata({
      category,
      id: String(data.ids?.[bi] ?? bi),
      osmType: kind,
      heightM: Number(h),
      attenuationDbPerM: _numberInput('building-loss-per-m', 0.5),
      attenuationFactor: 1,
    });
    const style = isBarrier ? _barrierStyle(_isSelectedObstacle(obstacle)) : _buildingStyle(fill, _isSelectedObstacle(obstacle));
    const layer = L.polygon(poly, {
      renderer: _getRenderer(),
      className: isBarrier ? 'obstacle-barrier' : 'obstacle-building',
      ...style,
    }).addTo(map) as LeafletObstacleLayer;
    layer._obstacle = obstacle;
    layer._buildingFill = fill;
    layer.on?.('click', (event) => _selectObstacle(obstacle, event));

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

async function _refresh(options: RefreshOptions = {}): Promise<void> {
  if (_loading) return;
  if (!_foliageEnabled && !_buildingsEnabled && !_barriersEnabled) {
    _setStatus('Enable vegetation, buildings, or barriers before refreshing.', 'warning');
    return;
  }
  const showJob = options.showJob !== false;

  _loading = true;
  _abortController?.abort();
  _abortController = new AbortController();
  const btn = document.getElementById('btn-refresh-layers');
  const cancelBtn = document.getElementById('btn-cancel-layers') as HTMLButtonElement | null;
  const progressMeta: ProgressMeta = { title: _layerJobTitle() };
  setButtonBusy(btn, true, 'Loading...');
  if (showJob) setCancelHandler(() => _abortController?.abort());
  if (cancelBtn) cancelBtn.disabled = false;
  _setStatus('Loading layers...');
  if (showJob) setProgress(2, 'Preparing map layer refresh...', progressMeta);

  try {
    const parts: string[] = [];
    if (_foliageEnabled) {
      if (showJob) setProgress(12, 'Loading vegetation polygons...', progressMeta);
      const n = await _loadFoliage(_abortController.signal);
      parts.push(`${n} vegetation polygon${n !== 1 ? 's' : ''}`);
      if (showJob) setProgress(45, `${n} vegetation polygon${n !== 1 ? 's' : ''} loaded.`, progressMeta);
    }
    if (_buildingsEnabled || _barriersEnabled) {
      if (showJob) setProgress(_foliageEnabled ? 55 : 12, 'Loading structure polygons...', progressMeta);
      const { buildingCount, barrierCount } = await _loadBuildings(_abortController.signal);
      if (_buildingsEnabled) parts.push(`${buildingCount} building${buildingCount !== 1 ? 's' : ''}`);
      if (_barriersEnabled) parts.push(`${barrierCount} barrier${barrierCount !== 1 ? 's' : ''}`);
      if (showJob) setProgress(90, 'Structure polygons loaded.', progressMeta);
    }
    if (showJob) {
      setProgress(100, parts.length ? `${parts.join(', ')} loaded.` : 'Map layers refreshed.', progressMeta);
      await yieldToUI();
    }
    _setStatus(parts.length ? parts.join(', ') + ' loaded.' : '', parts.length ? 'success' : 'info');
  } catch (rawErr) {
    const e = rawErr as AbortError;
    if (e?.cancelled || e?.name === 'AbortError') {
      _setStatus('Layer refresh cancelled.', 'warning');
    } else {
      _setStatus('Layer fetch failed. Check connection.', 'error');
      console.warn('[mapLayers] refresh failed:', e);
    }
  } finally {
    if (showJob) hideProgress();
    _loading = false;
    _abortController = null;
    if (showJob) setCancelHandler(null);
    setButtonBusy(btn, false);
    if (cancelBtn) cancelBtn.disabled = true;
  }
}

function _abortError(): AbortError {
  const err = new Error('Cancelled') as AbortError;
  err.name = 'AbortError';
  err.cancelled = true;
  return err;
}

function _scheduleRefresh(): void {
  if (_suppressStartupRefresh) {
    _suppressStartupRefresh = false;
    return;
  }
  if (!_autoRefresh || (!_foliageEnabled && !_buildingsEnabled && !_barriersEnabled)) return;
  if (_refreshTimer !== null) clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(_refresh, 800);
}

export function init(): void {
  const foliageEl = document.getElementById('layer-foliage') as HTMLInputElement | null;
  const buildingsEl = document.getElementById('layer-buildings') as HTMLInputElement | null;
  const barriersEl = document.getElementById('layer-barriers') as HTMLInputElement | null;
  const autoRefreshEl = document.getElementById('layer-auto-refresh') as HTMLInputElement | null;
  const foliageOpacityEl = document.getElementById('foliage-opacity');
  const buildingOpacityEl = document.getElementById('building-opacity');
  const barrierOpacityEl = document.getElementById('barrier-opacity');
  if (!foliageEl || !buildingsEl || !barriersEl || !autoRefreshEl) return;

  _foliageEnabled = foliageEl.checked;
  _buildingsEnabled = buildingsEl.checked;
  _barriersEnabled = barriersEl.checked;
  _autoRefresh = autoRefreshEl.checked;

  foliageEl.addEventListener('change', async (e) => {
    _foliageEnabled = (e.target as HTMLInputElement).checked;
    if (!_foliageEnabled) { _abortController?.abort(); clearFoliageLayers(); _setStatus(''); return; }
    await _refresh();
  });

  buildingsEl.addEventListener('change', async (e) => {
    _buildingsEnabled = (e.target as HTMLInputElement).checked;
    if (!_buildingsEnabled) { _abortController?.abort(); clearBuildingLayers(); _setStatus(''); return; }
    await _refresh();
  });

  barriersEl.addEventListener('change', async (e) => {
    _barriersEnabled = (e.target as HTMLInputElement).checked;
    if (!_barriersEnabled) { _abortController?.abort(); clearBarrierLayers(); _setStatus(''); return; }
    await _refresh();
  });

  autoRefreshEl.addEventListener('change', (e) => {
    _autoRefresh = (e.target as HTMLInputElement).checked;
  });

  foliageOpacityEl?.addEventListener('input', _applyFoliageOpacity);
  buildingOpacityEl?.addEventListener('input', _applyBuildingOpacity);
  barrierOpacityEl?.addEventListener('input', _applyBarrierOpacity);
  document.addEventListener('selection:changed', (event) => {
    const detail = (event as CustomEvent<SelectionChangedDetail>).detail;
    _selectedObstacleId = detail?.kind === 'obstacle' && detail?.id !== null && detail?.id !== undefined
      ? String(detail.id)
      : null;
    _syncObstacleSelectionHighlight();
  });

  document.getElementById('btn-refresh-layers')?.addEventListener('click', () => {
    _refresh();
  });
  document.getElementById('btn-cancel-layers')?.addEventListener('click', () => _abortController?.abort());

  map.on('moveend', _scheduleRefresh);
  if (_foliageEnabled || _buildingsEnabled || _barriersEnabled) {
    if (_autoRefresh) {
      _refresh({ showJob: false }).catch((e) => {
        console.warn('[mapLayers] initial layer load failed:', e);
      });
    } else {
      _setStatus('Layers enabled. Pan/zoom map or click Refresh Layers to load data.');
    }
  }
}
