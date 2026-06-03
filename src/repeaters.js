// @ts-check
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
import { normalizeWsRepeaterSnapshot, normalizeWsUrl, wsKeyForRow } from './repeaterRows.js';

const PALETTE = [
  '#61dafb', '#4ade80', '#fb923c', '#f472b6',
  '#a78bfa', '#facc15', '#34d399', '#f87171',
];

// Module-local interaction state
let placingMode  = false;
/** @type {number | null} */
let editingId    = null; // null = add mode, number = ID being edited
/** @type {any | null} */
let _lastRemoved = null; // F5: single-level undo snapshot
let _filterText  = '';
let _sortMode    = 'name-az';

// Context menu
/** @type {HTMLDivElement | null} */
let _ctxMenu     = null;
/** @type {number | null} */
let _ctxTargetId = null;

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
  _ctxMenu.addEventListener('click', (/** @type {MouseEvent} */ e) => {
    const item = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target.closest('[data-ctx]') : null);
    if (!item) return;
    const id = _ctxTargetId;
    _hideCtxMenu();
    const rep = state.repeaters.find((/** @type {any} */ x) => x.id === id);
    if (!rep) return;
    if (item.dataset.ctx === 'info')     rep.marker.openPopup();
    if (item.dataset.ctx === 'p2p')      startPickingFrom(rep);
    if (item.dataset.ctx === 'edit')     editRepeater(/** @type {number} */ (id));
    if (item.dataset.ctx === 'vis')      toggleVisibility(/** @type {number} */ (id));
    if (item.dataset.ctx === 'coverage') runCoverageAnalysis(/** @type {any} */ (id));
    if (item.dataset.ctx === 'pathfrom') document.dispatchEvent(
      new CustomEvent('path:from-node', { detail: { id } })
    );
    if (item.dataset.ctx === 'optimize') document.dispatchEvent(
      new CustomEvent('map:optimize-here', { detail: { lat: rep.lat, lon: rep.lon } })
    );
    if (item.dataset.ctx === 'delete')   removeRepeater(/** @type {number} */ (id));
  });
  document.addEventListener('click', (/** @type {MouseEvent} */ e) => {
    if (_ctxMenu && _ctxMenu.style.display !== 'none' && e.target instanceof Node && !_ctxMenu.contains(e.target)) {
      _hideCtxMenu();
    }
  }, true);
}

/**
 * @param {any} r
 * @param {MouseEvent} mouseEvt
 */
function _showCtxMenu(r, mouseEvt) {
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

function _hideCtxMenu() {
  if (_ctxMenu) _ctxMenu.style.display = 'none';
}

function _saveWsToDb() {
  const rows = state.repeaters
    .filter((/** @type {any} */ r) => r.fromWs)
    .map((/** @type {any} */ r) => ({ name: r.name, lat: r.lat, lon: r.lon, short: r.short ?? null, lastSeen: r.lastSeen ?? null, wsKey: r.wsKey ?? null }));
  window.electronAPI.wsRepeatersSave(rows).catch(e => console.warn('[ws] DB save failed:', e));
}

/**
 * @returns {{ height: number, power: number, freq: number, gain: number }}
 */
function _getWsDefaults() {
  /** @param {string} id */
  const v = (id) => /** @type {HTMLInputElement | null} */ (document.getElementById(id))?.value ?? '';
  return {
    height: parseFloat(v('ws-default-height')) || 10,
    power:  parseFloat(v('ws-default-power'))  || 20,
    freq:   parseFloat(v('ws-default-freq'))   || 869.525,
    gain:   parseFloat(v('ws-default-gain'))   || 2,
  };
}

/** @param {any} r */
function _wsKeyForRow(r) {
  return wsKeyForRow(r);
}

/**
 * @param {any} r
 * @param {string} name
 */
function _wsPopupLines(r, name) {
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
function _applyWsRow(rep, r, defaults) {
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
    if (rep[key] !== value) {
      rep[key] = value;
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
  return { coverageChanged, displayChanged };
}

async function _loadWsFromDb() {
  try {
    const rows = await window.electronAPI.wsRepeatersLoad();
    if (!rows.length) return;
    const savedUndo = _lastRemoved;
    for (const r of rows) {
      const d    = _getWsDefaults();
      const rep    = addRepeater(r.name, r.lat, r.lon, d.height, d.power, d.freq, d.gain, { render: false, notify: false });
      rep.fromWs   = true;
      rep.short    = r.short    ?? null;
      rep.lastSeen = r.lastSeen ?? null;
      rep.wsKey    = _wsKeyForRow(r);
      _wsRepeaterIds.add(rep.id);
      rep.marker.setPopupContent(_wsPopupLines(r, r.name));
    }
    _lastRemoved = savedUndo;
    renderRepeaterList();
    _syncUndoBtn();
    document.dispatchEvent(new CustomEvent('repeaters:changed'));
    console.info(`[ws] restored ${rows.length} repeater(s) from DB`);
  } catch (e) { console.warn('[ws] DB load failed:', e); }
}

// WebSocket live feed
/** @type {WebSocket | null} */
let _ws = null;
/** @type {Set<number>} */
const _wsRepeaterIds = new Set(); // IDs of repeaters imported from the live WS feed

/** @param {string} status */
function _setWsStatus(status) {
  const dot = document.getElementById('ws-status-dot');
  const btn = document.getElementById('btn-ws-connect');
  if (!dot || !btn) return;
  dot.dataset.status = status;
  dot.title = status;
  btn.textContent = status === 'connected' ? 'Disconnect' : 'Connect';
}

/** @param {unknown} data */
function _syncWsRepeaters(data) {
  const snapshot = normalizeWsRepeaterSnapshot(data);
  if (!snapshot.ok) { console.warn('[ws] unexpected message shape, expected array'); return; }
  if (snapshot.invalidCount) console.warn(`[ws] skipped ${snapshot.invalidCount} invalid entr${snapshot.invalidCount === 1 ? 'y' : 'ies'}`);
  if (snapshot.duplicateCount) console.warn(`[ws] skipped ${snapshot.duplicateCount} duplicate entr${snapshot.duplicateCount === 1 ? 'y' : 'ies'}`);

  if (!snapshot.explicitClear && snapshot.rows.length === 0 && _wsRepeaterIds.size > 0) {
    console.warn('[ws] ignoring empty/all-invalid snapshot to avoid clearing existing live nodes');
    return;
  }
  const incoming = snapshot.rows;
  const incomingKeys = snapshot.keys;

  let coverageChanged = false;
  let displayChanged = false;

  // Remove stale WS repeaters without clobbering manual undo state.
  const savedUndo = _lastRemoved;
  for (const id of [..._wsRepeaterIds]) {
    const rep = /** @type {Repeater | undefined} */ (state.repeaters.find((/** @type {any} */ x) => x.id === id));
    if (rep && rep.wsKey != null && !incomingKeys.has(rep.wsKey)) {
      removeRepeater(id, { rememberUndo: false, render: false, clearCoverage: false, notify: false });
      _wsRepeaterIds.delete(id);
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
    const rep = addRepeater(name, parseFloat(r.lat), parseFloat(r.lon), defaults.height, defaults.power, defaults.freq, defaults.gain, { render: false, notify: false });
    _applyWsRow(rep, r, defaults);
    _wsRepeaterIds.add(rep.id);
    coverageChanged = true;
    displayChanged = true;
  }

  // Coverage layers are persistent snapshots — node changes no longer wipe them.
  if (coverageChanged || displayChanged) {
    renderRepeaterList();
    document.dispatchEvent(new CustomEvent('repeaters:changed'));
  }
  console.info(`[ws] synced ${_wsRepeaterIds.size} repeater(s)`);
  _saveWsToDb();
}

/** @param {string} url */
export function connectLiveFeed(url) {
  disconnectLiveFeed();
  const wsUrl = normalizeWsUrl(url);
  if (!wsUrl) {
    _setWsStatus('error');
    setStatus('Live feed URL must start with ws://, wss://, http://, or https://.');
    return;
  }
  _setWsStatus('connecting');
  _ws = new WebSocket(wsUrl);
  const ws = _ws;
  ws.onopen  = () => {
    _setWsStatus('connected');
    setStatus('Live feed connected.');
    // Trigger Node-RED to send the current repeater list immediately
    ws.send('{}');
  };
  ws.onerror = () => { _setWsStatus('error'); };
  ws.onclose = () => { _setWsStatus('disconnected'); _ws = null; };
  ws.onmessage = (/** @type {MessageEvent<string>} */ e) => {
    try { _syncWsRepeaters(JSON.parse(e.data)); }
    catch (err) { console.warn('[ws] failed to parse message:', err); }
  };
}

export function disconnectLiveFeed() {
  if (!_ws) return;
  _ws.onclose = null; // suppress status side-effect during manual disconnect
  _ws.close();
  _ws = null;
  // Remove WS markers from the map without clobbering manual undo state.
  const savedUndo = _lastRemoved;
  let removed = false;
  for (const id of [..._wsRepeaterIds]) {
    removeRepeater(id, { rememberUndo: false, render: false, clearCoverage: false, notify: false });
    removed = true;
  }
  _lastRemoved = savedUndo;
  _syncUndoBtn();
  _wsRepeaterIds.clear();
  if (removed) {
    renderRepeaterList();
    document.dispatchEvent(new CustomEvent('repeaters:changed'));
  }
  _setWsStatus('disconnected');
  setStatus('Live feed disconnected.');
}

function _syncUndoBtn() {
  const btn = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-undo-remove'));
  if (btn) btn.disabled = _lastRemoved === null;
}

/** @param {string} color */
function makeMarkerIcon(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
    <path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 14 22 14 22S28 23.333 28 14C28 6.268 21.732 0 14 0z" fill="${color}" stroke="#fff" stroke-width="2"/>
    <circle cx="14" cy="14" r="5" fill="#fff" opacity="0.9"/>
    <line x1="14" y1="2" x2="14" y2="7" stroke="#fff" stroke-width="2"/>
    <line x1="10" y1="3.5" x2="12" y2="7.5" stroke="#fff" stroke-width="1.5"/>
    <line x1="18" y1="3.5" x2="16" y2="7.5" stroke="#fff" stroke-width="1.5"/>
  </svg>`;
  return L.divIcon({ html: svg, iconSize: [28, 36], iconAnchor: [14, 36], popupAnchor: [0, -36], className: '' });
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
export function addRepeater(name, lat, lon, height, power, freq, gain = 2, options = {}) {
  name = String(name ?? `Repeater ${state.nextId}`);
  const color = PALETTE[state.repeaters.length % PALETTE.length];
  const id = state.nextId++;

  const marker = L.marker([lat, lon], { icon: makeMarkerIcon(color), draggable: true })
    .addTo(map)
    .bindPopup(`<b>${escHtml(name)}</b><br>TX: ${power} dBm + ${gain} dBi @ ${freq} MHz<br>Ant. height: ${height} m`);

  marker.on('dragend', () => {
    const r = /** @type {Repeater | undefined} */ (state.repeaters.find((/** @type {any} */ x) => x.id === id));
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

  marker.on('click', async (/** @type {any} */ e) => {
    if (e.originalEvent) e.originalEvent._meshcoreHandled = true;
    const r = /** @type {Repeater | undefined} */ (state.repeaters.find((/** @type {any} */ x) => x.id === id));
    if (!r) return;
    if (await handleRepeaterClick(r)) return; // consumed by P2P picking
    if (handlePathNodePick(r)) return; // consumed by best-path picking
    _showCtxMenu(r, e.originalEvent);
  });

  /** @type {Repeater} */
  const repeater = { id, name, lat, lon, height, power, freq, gain, marker, color, visible: true };
  state.repeaters.push(repeater);
  if (options.render !== false) renderRepeaterList();
  if (options.notify !== false) document.dispatchEvent(new CustomEvent('repeaters:changed'));
  return repeater;
}

/**
 * @param {number} id
 * @param {{ rememberUndo?: boolean, render?: boolean, clearCoverage?: boolean, notify?: boolean }} [options]
 */
export function removeRepeater(id, options = {}) {
  const idx = state.repeaters.findIndex((/** @type {any} */ r) => r.id === id);
  if (idx === -1) return;
  const r = state.repeaters[idx];
  if (options.rememberUndo !== false) {
    _lastRemoved = { name: r.name, lat: r.lat, lon: r.lon, height: r.height, power: r.power, freq: r.freq, gain: r.gain };
  }
  r.marker.remove();
  state.repeaters.splice(idx, 1);
  if (r.fromWs) _wsRepeaterIds.delete(id);
  if (options.render !== false) renderRepeaterList();
  _syncUndoBtn();
  if (options.notify !== false) document.dispatchEvent(new CustomEvent('repeaters:changed'));
}

// F5: restore the last individually-deleted repeater
export function undoLastRemove() {
  if (!_lastRemoved) return;
  const r = _lastRemoved;
  _lastRemoved = null;
  addRepeater(r.name, r.lat, r.lon, r.height, r.power, r.freq, r.gain);
  _syncUndoBtn();
}

/** Cancel placement mode without placing — called by optimizerUI when it needs map clicks. */
export function cancelPlacing() {
  if (!placingMode) return;
  placingMode = false;
  document.getElementById('place-hint')?.classList.add('hidden');
  const btn = document.getElementById('btn-add-click');
  if (btn) btn.textContent = 'Place on Map';
  map.getContainer().style.cursor = '';
}

/** @param {number} id */
function setEditMode(id) {
  const r = /** @type {Repeater | undefined} */ (state.repeaters.find((/** @type {any} */ x) => x.id === id));
  if (!r) {
    // Stale UI interaction (e.g. context menu retained after the repeater was
    // removed). Reset edit state and bail; throwing here used to surface as a
    // confusing "Cannot read properties of undefined" error in DevTools.
    console.warn(`[repeaters] setEditMode: no repeater with id=${id}`);
    clearEditMode();
    return;
  }
  editingId = id;
  /** @param {string} elId @param {string | number} value */
  const setVal = (elId, value) => {
    const el = /** @type {HTMLInputElement | HTMLSelectElement | null} */ (document.getElementById(elId));
    if (el) el.value = String(value);
  };
  setVal('repeater-name', r.name);
  setVal('repeater-lat', r.lat);
  setVal('repeater-lon', r.lon);
  setVal('repeater-height', r.height);
  setVal('repeater-power', r.power);
  setVal('repeater-freq', r.freq);
  setVal('repeater-gain', r.gain);  // B4: reset preset selects so stale selections don't overwrite the loaded values
  setVal('radio-preset', '');
  setVal('antenna-preset', '');
  const addBtn = document.getElementById('btn-add-repeater');
  if (addBtn) addBtn.textContent = 'Update Node';
  const clickBtn = document.getElementById('btn-add-click');
  if (clickBtn) clickBtn.textContent = 'Cancel';
  const addPanel = /** @type {HTMLDetailsElement | null} */ (document.getElementById('add-repeater-summary')?.closest('details') ?? null);
  if (addPanel) addPanel.open = true;
  document.getElementById('sidebar')?.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearEditMode() {
  editingId = null;
  const addBtn = document.getElementById('btn-add-repeater');
  if (addBtn) addBtn.textContent = 'Add Node';
  const clickBtn = document.getElementById('btn-add-click');
  if (clickBtn) clickBtn.textContent = 'Place on Map';
}

/** @param {number} id */
export function editRepeater(id) {
  cancelPlacing();
  setEditMode(id);
}

/** @param {number} id */
function toggleVisibility(id) {
  const r = /** @type {Repeater | undefined} */ (state.repeaters.find((/** @type {any} */ x) => x.id === id));
  if (!r) return;
  r.visible = !r.visible;
  if (r.visible) {
    r.marker.addTo(map);
  } else {
    r.marker.remove();
  }
  const covLayers = state.coverageLayers.filter((/** @type {any} */ l) => l._repeaterId === id);
  covLayers.forEach((/** @type {any} */ l) => {
    if (r.visible) l.addTo(map); else l.remove();
  });
  renderRepeaterList();
  document.dispatchEvent(new CustomEvent('repeaters:changed'));
}

function renderRepeaterList() {
  const ul = document.getElementById('repeater-list');
  if (!ul) return;

  let list = state.repeaters.filter((/** @type {Repeater} */ r) =>
    !_filterText || [
      r.name,
      `${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}`,
      `${r.height} ${r.power} ${r.freq} ${r.gain}`,
      r.short ?? '',
      r.lastSeen ?? '',
    ].join(' ').toLowerCase().includes(_filterText)
  );
  if (_sortMode === 'name-az') list.sort((/** @type {Repeater} */ a, /** @type {Repeater} */ b) => a.name.localeCompare(b.name));
  else if (_sortMode === 'name-za') list.sort((/** @type {Repeater} */ a, /** @type {Repeater} */ b) => b.name.localeCompare(a.name));

  if (list.length === 0) {
    ul.innerHTML = state.repeaters.length === 0
      ? '<li class="empty-msg">No repeaters added yet.</li>'
      : '<li class="empty-msg">No nodes match the filter.</li>';
    return;
  }

  ul.innerHTML = list.map((/** @type {Repeater} */ r) => {
    const sub = (r.fromWs && r.lastSeen)
      ? `${r.lat.toFixed(4)}, ${r.lon.toFixed(4)} \u00b7 ${escHtml(r.lastSeen)}`
      : `${r.lat.toFixed(4)}, ${r.lon.toFixed(4)} \u00b7 ${r.height}m \u00b7 ${r.power}dBm+${r.gain}dBi \u00b7 ${r.freq}MHz`;
    return `
    <li class="repeater-item${r.visible ? '' : ' ri-hidden'}" data-id="${r.id}">
      <div class="ri-color" style="background:${r.color}"></div>
      <div class="ri-info">
        <div class="ri-name">${escHtml(r.name)}</div>
        <div class="ri-coords">${sub}</div>
      </div>
      <button class="ri-vis" data-action="toggle-vis" data-id="${r.id}" title="${r.visible ? 'Hide' : 'Show'}">${r.visible ? 'On' : 'Off'}</button>
      <button class="ri-edit" data-action="edit" data-id="${r.id}" title="Edit">\u270e</button>
      <button class="ri-del"  data-action="delete" data-id="${r.id}" title="Remove">\u00d7</button>
    </li>`;
  }).join('');

  if (editingId !== null) {
    const el = ul.querySelector(`[data-id="${editingId}"]`);
    if (el) el.classList.add('editing');
  }
}

export function refreshRepeaterList({ notify = true, clearUndo = false } = {}) {
  if (clearUndo) _lastRemoved = null;
  renderRepeaterList();
  _syncUndoBtn();
  if (notify) document.dispatchEvent(new CustomEvent('repeaters:changed'));
}

export function init() {
  _initCtxMenu();
  _loadWsFromDb();

  document.getElementById('node-filter')?.addEventListener('input', (/** @type {Event} */ e) => {
    _filterText = /** @type {HTMLInputElement} */ (e.target).value.toLowerCase();
    renderRepeaterList();
  });
  document.getElementById('node-sort')?.addEventListener('change', (/** @type {Event} */ e) => {
    _sortMode = /** @type {HTMLSelectElement} */ (e.target).value;
    renderRepeaterList();
  });
  document.getElementById('btn-toggle-all-vis')?.addEventListener('click', () => {
    const anyHidden = state.repeaters.some((/** @type {Repeater} */ r) => !r.visible);
    for (const r of /** @type {Repeater[]} */ (state.repeaters)) {
      if (anyHidden ? !r.visible : r.visible) toggleVisibility(r.id);
    }
  });

  // A1: delegated click handler — no window globals needed
  document.getElementById('repeater-list')?.addEventListener('click', (/** @type {MouseEvent} */ e) => {
    const btn = /** @type {HTMLButtonElement | null} */ (e.target instanceof Element ? e.target.closest('button[data-action]') : null);
    if (!btn) return;
    const id = parseInt(btn.dataset.id ?? '');
    if (btn.dataset.action === 'edit')       editRepeater(id);
    if (btn.dataset.action === 'delete')     removeRepeater(id);
    if (btn.dataset.action === 'toggle-vis') toggleVisibility(id);
  });
  document.getElementById('btn-add-repeater')?.addEventListener('click', () => {
    /** @param {string} id */
    const v = (id) => /** @type {HTMLInputElement | null} */ (document.getElementById(id))?.value ?? '';
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
      const r = /** @type {Repeater | undefined} */ (state.repeaters.find((/** @type {any} */ x) => x.id === editingId));
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
      hint.classList.remove('hidden');
      btn.textContent = 'Cancel';
      map.getContainer().style.cursor = 'crosshair';
    } else {
      hint.classList.add('hidden');
      btn.textContent = 'Place on Map';
      map.getContainer().style.cursor = '';
    }
  });

  map.on('click', (/** @type {any} */ e) => {
    if (!placingMode) return;
    if (e.originalEvent) e.originalEvent._meshcoreHandled = true;
    /** @param {string} id */
    const v = (id) => /** @type {HTMLInputElement | null} */ (document.getElementById(id))?.value ?? '';
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
    if (_ws) {
      disconnectLiveFeed();
    } else {
      const url = /** @type {HTMLInputElement | null} */ (document.getElementById('ws-url'))?.value.trim() ?? '';
      if (url) connectLiveFeed(url);
    }
  });

  document.getElementById('btn-clear-nodes')?.addEventListener('click', () => {
    if (!confirmAction('Clear all nodes? Coverage layers are kept — delete them from the Coverage panel.')) return;
    clearEditMode();
    [...state.repeaters].forEach((/** @type {Repeater} */ r) => removeRepeater(r.id, { render: false, clearCoverage: false, notify: false }));
    _lastRemoved = null;
    _syncUndoBtn();
    renderRepeaterList();
    document.dispatchEvent(new CustomEvent('repeaters:changed'));
    setStatus('All nodes cleared.');
  });
}
