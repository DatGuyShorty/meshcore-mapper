/**
 * repeaters.js — Repeater CRUD, map markers, and placement UI.
 * Exports: addRepeater, removeRepeater, cancelPlacing, init
 *
 * @typedef {Object} Repeater
 * @property {number} id
 * @property {string} name
 * @property {number} lat
 * @property {number} lon
 * @property {number} height
 * @property {number} power
 * @property {number} freq
 * @property {number} gain
 * @property {any} marker     Leaflet marker handle
 * @property {string} color
 * @property {boolean} visible
 * @property {boolean} [fromWs]
 * @property {string | null} [short]
 * @property {string | null} [lastSeen]
 * @property {string | null} [wsKey]
 * @property {string} [pattern]
 * @property {number} [azimuthDeg]
 */
import { map, state } from './map.js';
import { confirmAction, escHtml, setStatus } from './ui.js';
import { handleRepeaterClick, startPickingFrom } from './p2p.js';
import { runCoverageAnalysis } from './coverage.js';
import { handlePathNodePick } from './pathfinderUI.js';
import type { WsRepeaterRow } from './repeaterRows.js';
import { normalizeWsRepeaterSnapshot, normalizeWsUrl, wsKeyForRow } from './repeaterRows.js';
import { attachEirpHint } from './eirp.js';
import { createLiveFeedStore } from './liveFeedStore.js';
import { renderNodeList } from './nodeListView.js';
import {
  applyNodeEditorValues,
  nodeEditorValuesFromRepeater,
  openNodeEditorPanel,
  setNodeEditorMode,
} from './nodeEditorView.js';
import { liveHealthSummary, nodeHealth, type NodeHealthState } from './liveHealth.js';

type RepeaterMarker = Record<string, any> & {
  addTo(target: unknown): RepeaterMarker;
  bindPopup(html: string): RepeaterMarker;
  on(event: string, handler: (event: any) => void): RepeaterMarker;
  getLatLng(): { lat: number; lng: number };
  setLatLng(latlng: [number, number]): void;
  setPopupContent(html: string): void;
  openPopup(): void;
  remove(): void;
  setIcon?(icon: unknown): void;
};

export type Repeater = {
  id: number;
  name: string;
  lat: number;
  lon: number;
  height: number;
  power: number;
  freq: number;
  gain: number;
  marker: RepeaterMarker;
  color: string;
  visible: boolean;
  fromWs?: boolean;
  short?: string | null;
  lastSeen?: string | null;
  wsKey?: string | null;
  pattern?: string;
  azimuthDeg?: number;
};

type RepeaterDefaults = {
  height: number;
  power: number;
  freq: number;
  gain: number;
};

type AddRepeaterOptions = {
  render?: boolean;
  notify?: boolean;
};

type RemoveRepeaterOptions = AddRepeaterOptions & {
  rememberUndo?: boolean;
  clearCoverage?: boolean;
};

type RefreshRepeaterListOptions = {
  notify?: boolean;
  clearUndo?: boolean;
};

type RemovedRepeaterSnapshot = Pick<Repeater, 'name' | 'lat' | 'lon' | 'height' | 'power' | 'freq' | 'gain'>;

type RepeaterChangeResult = {
  coverageChanged: boolean;
  displayChanged: boolean;
};

type MeshcoreMouseEvent = MouseEvent & {
  _meshcoreHandled?: boolean;
};

type MarkerClickEvent = {
  originalEvent?: MeshcoreMouseEvent;
};

type MapClickEvent = MarkerClickEvent & {
  latlng: { lat: number; lng: number };
};

const PALETTE = [
  '#61dafb', '#4ade80', '#fb923c', '#f472b6',
  '#a78bfa', '#facc15', '#34d399', '#f87171',
];

const runCoverageForNode = runCoverageAnalysis as (onlyId?: number | string | null) => Promise<unknown>;

// Module-local interaction state
let placingMode  = false;
let editingId: number | null = null; // null = add mode, number = ID being edited
let _lastRemoved: RemovedRepeaterSnapshot | null = null; // F5: single-level undo snapshot
let _filterText  = '';
let _sortMode    = 'name-az';
let _selectedNodeId: number | string | null = null;
let _healthTimer: number | null = null;

// Context menu
let _ctxMenu: HTMLDivElement | null = null;
let _ctxTargetId: number | null = null;

function _initCtxMenu() {
  _ctxMenu = document.createElement('div');
  _ctxMenu.id = 'node-ctx-menu';
  _ctxMenu.style.display = 'none';
  _ctxMenu.innerHTML = `
    <div class="ctx-item" data-ctx="info">Info</div>
    <div class="ctx-item" data-ctx="p2p">P2P Link</div>
    <div class="ctx-item" data-ctx="edit">Edit</div>
    <div class="ctx-item" data-ctx="vis"></div>
    <div class="ctx-separator"></div>
    <div class="ctx-item" data-ctx="coverage">Run Coverage</div>
    <div class="ctx-item" data-ctx="optimize">Optimize Here</div>
    <div class="ctx-item" data-ctx="pathfrom">Best Path From...</div>
    <div class="ctx-separator"></div>
    <div class="ctx-item ctx-danger" data-ctx="delete">Remove</div>
  `;
  document.body.append(_ctxMenu);
  _ctxMenu.addEventListener('click', (e: MouseEvent) => {
    const item = e.target instanceof Element
      ? e.target.closest('[data-ctx]') as HTMLElement | null
      : null;
    if (!item) return;
    const id = _ctxTargetId;
    _hideCtxMenu();
    if (id === null) return;
    const rep = state.repeaters.find((/** @type {any} */ x) => x.id === id);
    if (!rep) return;
    if (item.dataset.ctx === 'info')     rep.marker.openPopup();
    if (item.dataset.ctx === 'p2p')      startPickingFrom(rep);
    if (item.dataset.ctx === 'edit')     editRepeater(id);
    if (item.dataset.ctx === 'vis')      toggleVisibility(id);
    if (item.dataset.ctx === 'coverage') runCoverageForNode(id);
    if (item.dataset.ctx === 'pathfrom') document.dispatchEvent(
      new CustomEvent('path:from-node', { detail: { id } })
    );
    if (item.dataset.ctx === 'optimize') document.dispatchEvent(
      new CustomEvent('map:optimize-here', { detail: { id: rep.id, lat: rep.lat, lon: rep.lon } })
    );
    if (item.dataset.ctx === 'delete')   removeRepeater(id);
  });
  document.addEventListener('click', (e: MouseEvent) => {
    if (_ctxMenu && _ctxMenu.style.display !== 'none' && e.target instanceof Node && !_ctxMenu.contains(e.target)) {
      _hideCtxMenu();
    }
  }, true);
}

/**
 * @param {any} r
 * @param {MouseEvent} mouseEvt
 */
function _showCtxMenu(r: Repeater, mouseEvt: MouseEvent): void {
  _ctxTargetId = r.id;
  if (!_ctxMenu) return;
  const visItem = _ctxMenu.querySelector('[data-ctx="vis"]');
  if (visItem) visItem.textContent = r.visible ? 'Hide' : 'Show';
  // Position off-screen first so the browser lays the element out, then measure + reposition
  _ctxMenu.style.left = '-9999px';
  _ctxMenu.style.top  = '-9999px';
  _ctxMenu.style.display = 'block';
  const mw = _ctxMenu.offsetWidth;
  const mh = _ctxMenu.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;
  let x = mouseEvt.clientX + 4, y = mouseEvt.clientY + 4;
  if (x + mw > vw) x = mouseEvt.clientX - mw - 4;
  if (y + mh > vh) y = mouseEvt.clientY - mh - 4;
  _ctxMenu.style.left = x + 'px';
  _ctxMenu.style.top  = y + 'px';
}

function _hideCtxMenu(): void {
  if (_ctxMenu) _ctxMenu.style.display = 'none';
}

function _saveWsToDb(): void {
  const rows = state.repeaters
    .filter((r: Repeater) => r.fromWs)
    .map((r: Repeater) => ({ name: r.name, lat: r.lat, lon: r.lon, short: r.short ?? null, lastSeen: r.lastSeen ?? null, wsKey: r.wsKey ?? null }));
  window.electronAPI.wsRepeatersSave(rows).catch(e => console.warn('[ws] DB save failed:', e));
}

function _inputValue(id: string): string {
  return (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
}

/**
 * @returns {{ height: number, power: number, freq: number, gain: number }}
 */
function _getWsDefaults(): RepeaterDefaults {
  const v = _inputValue;
  return {
    height: parseFloat(v('ws-default-height')) || 10,
    power:  parseFloat(v('ws-default-power'))  || 20,
    freq:   parseFloat(v('ws-default-freq'))   || 869.525,
    gain:   parseFloat(v('ws-default-gain'))   || 2,
  };
}

/** @param {any} r */
function _wsKeyForRow(r: unknown): string {
  return wsKeyForRow(r);
}

/**
 * @param {any} r
 * @param {string} name
 */
function _wsPopupLines(r: Record<string, any>, name: string): string {
  const short = r.short ?? null;
  const lastSeen = r.last_seen ?? r.lastSeen ?? null;
  return [
    `<b>${escHtml(name)}</b>`,
    short ? `ID: <code>${escHtml(short)}</code>` : null,
    lastSeen ? `Last seen: ${escHtml(lastSeen)}` : null,
  ].filter(Boolean).join('<br>');
}

/**
 * @param {any} rep
 * @param {any} r
 * @param {Record<string, number>} defaults
 */
function _applyWsRow(rep: Repeater, r: WsRepeaterRow | Record<string, any>, defaults: RepeaterDefaults): RepeaterChangeResult {
  const lat = parseFloat(r.lat);
  const lon = parseFloat(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { coverageChanged: false, displayChanged: false };
  }
  const name = String(r.name ?? 'Unknown');
  const lastSeen = r.last_seen ?? r.lastSeen ?? null;
  const short = r.short ?? null;
  let coverageChanged = false;
  let displayChanged = false;

  if (rep.name !== name) { rep.name = name; displayChanged = true; }
  if (rep.lat !== lat || rep.lon !== lon) {
    rep.lat = lat;
    rep.lon = lon;
    rep.marker.setLatLng([lat, lon]);
    coverageChanged = true;
    displayChanged = true;
  }
  for (const [key, value] of Object.entries(defaults)) {
    if ((rep as any)[key] !== value) {
      (rep as any)[key] = value;
      coverageChanged = true;
      displayChanged = true;
    }
  }
  if (rep.short !== short || rep.lastSeen !== lastSeen) displayChanged = true;
  rep.fromWs = true;
  rep.short = short;
  rep.lastSeen = lastSeen;
  rep.wsKey = _wsKeyForRow(r);
  rep.marker.setPopupContent(_wsPopupLines(r, name));
  rep.marker.setIcon?.(makeMarkerIcon(rep.color, _isSelectedNode(rep.id), nodeHealth(rep).state));
  return { coverageChanged, displayChanged };
}

async function _loadWsFromDb(): Promise<void> {
  try {
    const rows = await window.electronAPI.wsRepeatersLoad();
    if (!rows.length) return;
    const savedUndo = _lastRemoved;
    for (const r of rows) {
      const d    = _getWsDefaults();
      const rep = addRepeater(r.name, r.lat, r.lon, d.height, d.power, d.freq, d.gain, { render: false, notify: false });
      rep.fromWs   = true;
      rep.short    = r.short    ?? null;
      rep.lastSeen = r.lastSeen ?? null;
      rep.wsKey    = _wsKeyForRow(r);
      _liveFeedStore.addRepeaterId(rep.id);
      rep.marker.setPopupContent(_wsPopupLines(r, r.name));
      rep.marker.setIcon?.(makeMarkerIcon(rep.color, _isSelectedNode(rep.id), nodeHealth(rep).state));
    }
    _lastRemoved = savedUndo;
    renderRepeaterList();
    _syncUndoBtn();
    document.dispatchEvent(new CustomEvent('repeaters:changed'));
    console.info(`[ws] restored ${rows.length} repeater(s) from DB`);
  } catch (e) { console.warn('[ws] DB load failed:', e); }
}

// WebSocket live feed
const _liveFeedStore = createLiveFeedStore<WebSocket>();

/** @param {string} status */
function _setWsStatus(status: string): void {
  const dot = document.getElementById('ws-status-dot');
  const btn = document.getElementById('btn-ws-connect');
  if (!dot || !btn) return;
  dot.dataset.status = status;
  dot.title = status;
  btn.textContent = status === 'connected' ? 'Disconnect' : 'Connect';
}

function _updateLiveHealthSummary(): void {
  const el = document.getElementById('ws-health-summary');
  if (!el) return;
  const summary = liveHealthSummary(state.repeaters as Repeater[]);
  el.textContent = summary.text;
  el.classList.toggle('ws-health-alert', summary.alert);
}

/** @param {unknown} data */
function _syncWsRepeaters(data: unknown): void {
  const snapshot = normalizeWsRepeaterSnapshot(data);
  if (!snapshot.ok) { console.warn('[ws] unexpected message shape, expected array'); return; }
  if (snapshot.invalidCount) console.warn(`[ws] skipped ${snapshot.invalidCount} invalid entr${snapshot.invalidCount === 1 ? 'y' : 'ies'}`);
  if (snapshot.duplicateCount) console.warn(`[ws] skipped ${snapshot.duplicateCount} duplicate entr${snapshot.duplicateCount === 1 ? 'y' : 'ies'}`);

  if (!snapshot.explicitClear && snapshot.rows.length === 0 && _liveFeedStore.getRepeaterCount() > 0) {
    console.warn('[ws] ignoring empty/all-invalid snapshot to avoid clearing existing live nodes');
    return;
  }
  const incoming = snapshot.rows;
  const incomingKeys = snapshot.keys;

  let coverageChanged = false;
  let displayChanged = false;

  // Remove stale WS repeaters without clobbering manual undo state.
  const savedUndo = _lastRemoved;
  for (const id of _liveFeedStore.getRepeaterIds()) {
    const rep = /** @type {Repeater | undefined} */ (state.repeaters.find((/** @type {any} */ x) => x.id === id));
    if (rep && rep.wsKey != null && !incomingKeys.has(rep.wsKey)) {
      removeRepeater(id, { rememberUndo: false, render: false, clearCoverage: false, notify: false });
      _liveFeedStore.deleteRepeaterId(id);
      coverageChanged = true;
      displayChanged = true;
    }
  }
  _lastRemoved = savedUndo;
  _syncUndoBtn();

  for (const r of incoming) {
    const key = _wsKeyForRow(r);
    const existing = state.repeaters.find((/** @type {any} */ x) => x.fromWs && x.wsKey === key);
    const defaults = _getWsDefaults();
    if (existing) {
      const result = _applyWsRow(existing, r, defaults);
      coverageChanged = result.coverageChanged || coverageChanged;
      displayChanged = result.displayChanged || displayChanged;
      continue;
    }

    const name = String(r.name ?? 'Unknown');
    const rep = addRepeater(name, r.lat, r.lon, defaults.height, defaults.power, defaults.freq, defaults.gain, { render: false, notify: false });
    _applyWsRow(rep, r, defaults);
    _liveFeedStore.addRepeaterId(rep.id);
    coverageChanged = true;
    displayChanged = true;
  }

  // Coverage layers are persistent snapshots — node changes no longer wipe them.
  if (coverageChanged || displayChanged) {
    renderRepeaterList();
    document.dispatchEvent(new CustomEvent('repeaters:changed'));
  }
  console.info(`[ws] synced ${_liveFeedStore.getRepeaterCount()} repeater(s)`);
  _saveWsToDb();
}

/** @param {string} url */
export function connectLiveFeed(url: string): void {
  disconnectLiveFeed();
  const wsUrl = normalizeWsUrl(url);
  if (!wsUrl) {
    _setWsStatus('error');
    setStatus('Live feed URL must start with ws://, wss://, http://, or https://.');
    return;
  }
  _setWsStatus('connecting');
  _liveFeedStore.setConnection(new WebSocket(wsUrl));
  const ws = _liveFeedStore.getConnection();
  if (!ws) return;
  ws.onopen  = () => {
    _setWsStatus('connected');
    setStatus('Live feed connected.');
    // Trigger Node-RED to send the current repeater list immediately
    ws.send('{}');
  };
  ws.onerror = () => { _setWsStatus('error'); };
  ws.onclose = () => { _setWsStatus('disconnected'); _liveFeedStore.clearConnection(); };
  ws.onmessage = (e: MessageEvent<string>) => {
    try { _syncWsRepeaters(JSON.parse(e.data)); }
    catch (err) { console.warn('[ws] failed to parse message:', err); }
  };
}

export function disconnectLiveFeed(): void {
  const ws = _liveFeedStore.getConnection();
  if (!ws) return;
  ws.onclose = null; // suppress status side-effect during manual disconnect
  ws.close();
  _liveFeedStore.clearConnection();
  // Remove WS markers from the map without clobbering manual undo state.
  const savedUndo = _lastRemoved;
  let removed = false;
  for (const id of _liveFeedStore.getRepeaterIds()) {
    removeRepeater(id, { rememberUndo: false, render: false, clearCoverage: false, notify: false });
    removed = true;
  }
  _lastRemoved = savedUndo;
  _syncUndoBtn();
  _liveFeedStore.clearRepeaterIds();
  if (removed) {
    renderRepeaterList();
    document.dispatchEvent(new CustomEvent('repeaters:changed'));
  }
  _setWsStatus('disconnected');
  setStatus('Live feed disconnected.');
}

function _syncUndoBtn(): void {
  const btn = document.getElementById('btn-undo-remove') as HTMLButtonElement | null;
  if (btn) btn.disabled = _lastRemoved === null;
}

/**
 * @param {string} color
 * @param {boolean} [selected]
 */
function makeMarkerIcon(color: string, selected = false, health: NodeHealthState = 'planned'): any {
  const stroke = selected ? '#facc15' : markerStrokeForHealth(health);
  const strokeWidth = selected ? 4 : health === 'planned' ? 2 : 3;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
    <path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 14 22 14 22S28 23.333 28 14C28 6.268 21.732 0 14 0z" fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
    <circle cx="14" cy="14" r="5" fill="#fff" opacity="0.9"/>
    <line x1="14" y1="2" x2="14" y2="7" stroke="#fff" stroke-width="2"/>
    <line x1="10" y1="3.5" x2="12" y2="7.5" stroke="#fff" stroke-width="1.5"/>
    <line x1="18" y1="3.5" x2="16" y2="7.5" stroke="#fff" stroke-width="1.5"/>
  </svg>`;
  return L.divIcon({ html: svg, iconSize: [28, 36], iconAnchor: [14, 36], popupAnchor: [0, -36], className: '' });
}

function markerStrokeForHealth(health: NodeHealthState): string {
  if (health === 'live') return '#22c55e';
  if (health === 'stale') return '#f59e0b';
  if (health === 'missing') return '#f87171';
  return '#fff';
}

/** @param {number | string | null} id */
function _isSelectedNode(id: number | string | null): boolean {
  return _selectedNodeId !== null && String(_selectedNodeId) === String(id);
}

function _syncSelectedNodeMarkers(): void {
  (state.repeaters as Repeater[]).forEach(r => {
    r.marker?.setIcon?.(makeMarkerIcon(r.color, _isSelectedNode(r.id), nodeHealth(r).state));
  });
}

function _syncSelectedNodeList(): void {
  document.querySelectorAll('#repeater-list .repeater-item[data-id]').forEach((item: Element) => {
    const selected = _isSelectedNode((item as HTMLElement).dataset.id ?? null);
    item.classList.toggle('ri-selected', selected);
  });
}

function _syncSelectedNodeHighlight(): void {
  _syncSelectedNodeMarkers();
  _syncSelectedNodeList();
}

/**
 * @param {any} name
 * @param {number} lat
 * @param {number} lon
 * @param {number} height
 * @param {number} power
 * @param {number} freq
 * @param {number} [gain]
 * @param {{ render?: boolean, notify?: boolean }} [options]
 * @returns {Repeater}
 */
export function addRepeater(
  name: unknown,
  lat: number,
  lon: number,
  height: number,
  power: number,
  freq: number,
  gain = 2,
  options: AddRepeaterOptions = {}
): Repeater {
  const displayName = String(name ?? `Repeater ${state.nextId}`);
  const color = PALETTE[state.repeaters.length % PALETTE.length];
  const id = state.nextId++;

  const marker = L.marker([lat, lon], { icon: makeMarkerIcon(color), draggable: true })
    .addTo(map)
    .bindPopup(`<b>${escHtml(displayName)}</b><br>TX: ${power} dBm + ${gain} dBi @ ${freq} MHz<br>Ant. height: ${height} m`);

  marker.on('dragend', () => {
    const r = (state.repeaters as Repeater[]).find(x => x.id === id);
    if (r) {
      r.lat = marker.getLatLng().lat;
      r.lon = marker.getLatLng().lng;
      // B8: keep popup content in sync with new position
      r.marker.setPopupContent(`<b>${escHtml(r.name)}</b><br>TX: ${r.power} dBm + ${r.gain} dBi @ ${r.freq} MHz<br>Ant. height: ${r.height} m`);
      document.dispatchEvent(new CustomEvent('repeater:moved', {
        detail: { id: r.id, lat: r.lat, lon: r.lon },
      }));
    }
    setStatus('Repeater moved. Existing coverage layers kept; compute to add a fresh one.');
    renderRepeaterList();
  });

  marker.on('click', async (e: MarkerClickEvent) => {
    if (e.originalEvent) e.originalEvent._meshcoreHandled = true;
    const r = (state.repeaters as Repeater[]).find(x => x.id === id);
    if (!r) return;
    if (await handleRepeaterClick(r)) return; // consumed by P2P picking
    if (handlePathNodePick(r)) return; // consumed by best-path picking
    document.dispatchEvent(new CustomEvent('node:selected', { detail: { id: r.id } }));
    if (e.originalEvent) _showCtxMenu(r, e.originalEvent);
  });

  const repeater: Repeater = { id, name: displayName, lat, lon, height, power, freq, gain, marker, color, visible: true };
  state.repeaters.push(repeater);
  if (options.render !== false) renderRepeaterList();
  if (options.notify !== false) document.dispatchEvent(new CustomEvent('repeaters:changed'));
  return repeater;
}

/**
 * @param {number} id
 * @param {{ rememberUndo?: boolean, render?: boolean, clearCoverage?: boolean, notify?: boolean }} [options]
 */
export function removeRepeater(id: number, options: RemoveRepeaterOptions = {}): void {
  const idx = (state.repeaters as Repeater[]).findIndex(r => r.id === id);
  if (idx === -1) return;
  const r = state.repeaters[idx] as Repeater;
  if (options.rememberUndo !== false) {
    _lastRemoved = { name: r.name, lat: r.lat, lon: r.lon, height: r.height, power: r.power, freq: r.freq, gain: r.gain };
  }
  r.marker.remove();
  state.repeaters.splice(idx, 1);
  if (r.fromWs) _liveFeedStore.deleteRepeaterId(id);
  if (options.render !== false) renderRepeaterList();
  _syncUndoBtn();
  if (options.notify !== false) document.dispatchEvent(new CustomEvent('repeaters:changed'));
}

// F5: restore the last individually-deleted repeater
export function undoLastRemove(): void {
  if (!_lastRemoved) return;
  const r = _lastRemoved;
  _lastRemoved = null;
  addRepeater(r.name, r.lat, r.lon, r.height, r.power, r.freq, r.gain);
  _syncUndoBtn();
}

/** Cancel placement mode without placing — called by optimizerUI when it needs map clicks. */
export function cancelPlacing(): void {
  if (!placingMode) return;
  placingMode = false;
  setNodeEditorMode(document, 'add');
  map.getContainer().style.cursor = '';
}

/** @param {number} id */
function setEditMode(id: number): void {
  const r = (state.repeaters as Repeater[]).find(x => x.id === id);
  if (!r) {
    // Stale UI interaction (e.g. context menu retained after the repeater was
    // removed). Reset edit state and bail; throwing here used to surface as a
    // confusing "Cannot read properties of undefined" error in DevTools.
    console.warn(`[repeaters] setEditMode: no repeater with id=${id}`);
    clearEditMode();
    return;
  }
  editingId = id;
  // Reset preset selects so stale selections don't overwrite the loaded values.
  applyNodeEditorValues(document, nodeEditorValuesFromRepeater(r));
  setNodeEditorMode(document, 'edit');
  openNodeEditorPanel(document);
}

function clearEditMode(): void {
  editingId = null;
  setNodeEditorMode(document, 'add');
}

/** @param {number} id */
export function editRepeater(id: number): void {
  cancelPlacing();
  setEditMode(id);
}

/** @param {number} id */
export function toggleVisibility(id: number): void {
  const r = (state.repeaters as Repeater[]).find(x => x.id === id);
  if (!r) return;
  r.visible = !r.visible;
  if (r.visible) {
    r.marker.addTo(map);
  } else {
    r.marker.remove();
  }
  const covLayers = state.coverageLayers.filter((l: any) => l._repeaterId === id);
  covLayers.forEach((l: any) => {
    if (r.visible) l.addTo(map); else l.remove();
  });
  renderRepeaterList();
  document.dispatchEvent(new CustomEvent('repeaters:changed'));
}

function renderRepeaterList(): void {
  const ul = document.getElementById('repeater-list');
  if (!ul) return;

  renderNodeList(ul, state.repeaters as Repeater[], {
    filterText: _filterText,
    sortMode: _sortMode,
    selectedNodeId: _selectedNodeId,
    editingId,
  });
  _syncSelectedNodeList();
  _updateLiveHealthSummary();
}

export function refreshRepeaterList({ notify = true, clearUndo = false }: RefreshRepeaterListOptions = {}): void {
  if (clearUndo) _lastRemoved = null;
  renderRepeaterList();
  _syncUndoBtn();
  if (notify) document.dispatchEvent(new CustomEvent('repeaters:changed'));
}

/** @param {any} event */
function _repeaterFromEvent(event: Event): Repeater | undefined {
  const id = (event as CustomEvent<{ id?: string | number | null }>).detail?.id;
  return (state.repeaters as Repeater[]).find(r => String(r.id) === String(id));
}

export function init(): void {
  _initCtxMenu();
  _loadWsFromDb();
  _updateLiveHealthSummary();
  if (_healthTimer === null) {
    _healthTimer = window.setInterval(() => {
      renderRepeaterList();
      _syncSelectedNodeMarkers();
    }, 60000);
  }

  attachEirpHint({ powerId: 'repeater-power', gainId: 'repeater-gain', freqId: 'repeater-freq', hintId: 'eirp-hint' });

  document.getElementById('node-filter')?.addEventListener('input', (e: Event) => {
    _filterText = ((e.target as HTMLInputElement | null)?.value ?? '').toLowerCase();
    renderRepeaterList();
  });
  document.getElementById('node-sort')?.addEventListener('change', (e: Event) => {
    _sortMode = (e.target as HTMLSelectElement | null)?.value ?? 'name-az';
    renderRepeaterList();
  });
  document.addEventListener('selection:changed', (event: Event) => {
    const detail = (event as CustomEvent<{ kind?: string; id?: string | number | null }>).detail;
    _selectedNodeId = detail?.kind === 'node' ? detail.id ?? null : null;
    _syncSelectedNodeHighlight();
  });
  document.getElementById('btn-toggle-all-vis')?.addEventListener('click', () => {
    const anyHidden = (state.repeaters as Repeater[]).some(r => !r.visible);
    for (const r of state.repeaters as Repeater[]) {
      if (anyHidden ? !r.visible : r.visible) toggleVisibility(r.id);
    }
  });

  // A1: delegated click handler — no window globals needed
  document.getElementById('repeater-list')?.addEventListener('click', (e: MouseEvent) => {
    const btn = e.target instanceof Element
      ? e.target.closest('button[data-action]') as HTMLButtonElement | null
      : null;
    if (!btn) {
      const item = e.target instanceof Element
        ? e.target.closest('.repeater-item[data-id]') as HTMLElement | null
        : null;
      if (item) document.dispatchEvent(new CustomEvent('node:selected', { detail: { id: item.dataset.id } }));
      return;
    }
    const id = parseInt(btn.dataset.id ?? '');
    if (btn.dataset.action === 'edit')       editRepeater(id);
    if (btn.dataset.action === 'delete')     removeRepeater(id);
    if (btn.dataset.action === 'toggle-vis') toggleVisibility(id);
  });

  document.addEventListener('node:edit', (e: Event) => {
    const r = _repeaterFromEvent(e);
    if (r) editRepeater(r.id);
  });
  document.addEventListener('node:toggle-visibility', (e: Event) => {
    const r = _repeaterFromEvent(e);
    if (r) toggleVisibility(r.id);
  });
  document.addEventListener('node:coverage', (e: Event) => {
    const r = _repeaterFromEvent(e);
    if (r) runCoverageForNode(r.id);
  });
  document.addEventListener('node:p2p', (e: Event) => {
    const r = _repeaterFromEvent(e);
    if (r) startPickingFrom(r);
  });
  document.addEventListener('node:delete', (e: Event) => {
    const r = _repeaterFromEvent(e);
    if (r) removeRepeater(r.id);
  });

  document.getElementById('btn-add-repeater')?.addEventListener('click', () => {
    const v = _inputValue;
    const name   = v('repeater-name').trim() || `Repeater ${state.nextId}`;
    const lat    = parseFloat(v('repeater-lat'));
    const lon    = parseFloat(v('repeater-lon'));
    const height = parseFloat(v('repeater-height')) || 10;
    const power  = parseFloat(v('repeater-power')) || 20;
    const freq   = parseFloat(v('repeater-freq')) || 869.525;
    const gain   = parseFloat(v('repeater-gain')) || 2;

    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setStatus('Invalid coordinates. Enter valid lat/lon.');
      return;
    }

    if (editingId !== null) {
      const r = (state.repeaters as Repeater[]).find(x => x.id === editingId);
      if (r) {
        r.name = name; r.lat = lat; r.lon = lon; r.height = height;
        r.power = power; r.freq = freq; r.gain = gain;
        r.marker.setLatLng([lat, lon]);
        r.marker.setPopupContent(`<b>${escHtml(name)}</b><br>TX: ${power} dBm + ${gain} dBi @ ${freq} MHz<br>Ant. height: ${height} m`);
        renderRepeaterList();
        setStatus(`Updated ${name}. Existing coverage layers kept; compute to add a fresh one.`);
      }
      clearEditMode();
      return;
    }

    addRepeater(name, lat, lon, height, power, freq, gain);
    map.setView([lat, lon], Math.max(map.getZoom(), 11));
  });

  document.getElementById('btn-add-click')?.addEventListener('click', () => {
    // In edit mode this button acts as cancel
    if (editingId !== null) { clearEditMode(); return; }

    placingMode = !placingMode;
    const hint = document.getElementById('place-hint');
    const btn  = document.getElementById('btn-add-click');
    if (!hint || !btn) return;
    if (placingMode) {
      setNodeEditorMode(document, 'placing');
      map.getContainer().style.cursor = 'crosshair';
    } else {
      setNodeEditorMode(document, 'add');
      map.getContainer().style.cursor = '';
    }
  });

  map.on('click', (e: MapClickEvent) => {
    if (!placingMode) return;
    if (e.originalEvent) e.originalEvent._meshcoreHandled = true;
    const v = _inputValue;
    const name   = v('repeater-name').trim() || `Repeater ${state.nextId}`;
    const height = parseFloat(v('repeater-height')) || 10;
    const power  = parseFloat(v('repeater-power')) || 20;
    const freq   = parseFloat(v('repeater-freq')) || 869.525;
    const gain   = parseFloat(v('repeater-gain')) || 2;
    addRepeater(name, e.latlng.lat, e.latlng.lng, height, power, freq, gain);
    cancelPlacing();
  });

  document.getElementById('btn-undo-remove')?.addEventListener('click', undoLastRemove);

  document.getElementById('btn-ws-connect')?.addEventListener('click', () => {
    if (_liveFeedStore.hasConnection()) {
      disconnectLiveFeed();
    } else {
      const url = _inputValue('ws-url').trim();
      if (url) connectLiveFeed(url);
    }
  });

  document.getElementById('btn-clear-nodes')?.addEventListener('click', () => {
    if (!confirmAction('Clear all nodes? Coverage layers are kept — delete them from the Coverage panel.')) return;
    clearEditMode();
    [...state.repeaters as Repeater[]].forEach(r => removeRepeater(r.id, { render: false, clearCoverage: false, notify: false }));
    _lastRemoved = null;
    _syncUndoBtn();
    renderRepeaterList();
    document.dispatchEvent(new CustomEvent('repeaters:changed'));
    setStatus('All nodes cleared.');
  });
}
