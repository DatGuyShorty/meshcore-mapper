/**
 * repeaters.js — Repeater CRUD, map markers, and placement UI.
 * Exports: addRepeater, removeRepeater, cancelPlacing, init
 */
import { map, state, clearCoverageLayers } from './map.js';
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
let editingId    = null; // null = add mode, number = ID being edited
let _lastRemoved = null; // F5: single-level undo snapshot
let _filterText  = '';
let _sortMode    = 'name-az';

// Context menu
let _ctxMenu     = null;
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
  _ctxMenu.addEventListener('click', e => {
    const item = e.target.closest('[data-ctx]');
    if (!item) return;
    const id = _ctxTargetId;
    _hideCtxMenu();
    const rep = state.repeaters.find(x => x.id === id);
    if (!rep) return;
    if (item.dataset.ctx === 'info')     rep.marker.openPopup();
    if (item.dataset.ctx === 'p2p')      startPickingFrom(rep);
    if (item.dataset.ctx === 'edit')     editRepeater(id);
    if (item.dataset.ctx === 'vis')      toggleVisibility(id);
    if (item.dataset.ctx === 'coverage') runCoverageAnalysis(id);
    if (item.dataset.ctx === 'pathfrom') document.dispatchEvent(
      new CustomEvent('path:from-node', { detail: { id } })
    );
    if (item.dataset.ctx === 'optimize') document.dispatchEvent(
      new CustomEvent('map:optimize-here', { detail: { lat: rep.lat, lon: rep.lon } })
    );
    if (item.dataset.ctx === 'delete')   removeRepeater(id);
  });
  document.addEventListener('click', e => {
    if (_ctxMenu && _ctxMenu.style.display !== 'none' && !_ctxMenu.contains(e.target)) {
      _hideCtxMenu();
    }
  }, true);
}

function _showCtxMenu(r, mouseEvt) {
  _ctxTargetId = r.id;
  _ctxMenu.querySelector('[data-ctx="vis"]').textContent = r.visible ? 'Hide' : 'Show';
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
    .filter(r => r.fromWs)
    .map(r => ({ name: r.name, lat: r.lat, lon: r.lon, short: r.short ?? null, lastSeen: r.lastSeen ?? null, wsKey: r.wsKey ?? null }));
  window.electronAPI.wsRepeatersSave(rows).catch(e => console.warn('[ws] DB save failed:', e));
}

function _getWsDefaults() {
  return {
    height: parseFloat(document.getElementById('ws-default-height')?.value) || 10,
    power:  parseFloat(document.getElementById('ws-default-power')?.value)  || 20,
    freq:   parseFloat(document.getElementById('ws-default-freq')?.value)   || 869.525,
    gain:   parseFloat(document.getElementById('ws-default-gain')?.value)   || 2,
  };
}

function _wsKeyForRow(r) {
  return wsKeyForRow(r);
}

function _wsPopupLines(r, name) {
  const short = r.short ?? null;
  const lastSeen = r.last_seen ?? r.lastSeen ?? null;
  return [
    `<b>${escHtml(name)}</b>`,
    short ? `ID: <code>${escHtml(short)}</code>` : null,
    lastSeen ? `Last seen: ${escHtml(lastSeen)}` : null,
  ].filter(Boolean).join('<br>');
}

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
let _ws = null;
const _wsRepeaterIds = new Set(); // IDs of repeaters imported from the live WS feed

function _setWsStatus(status) {
  const dot = document.getElementById('ws-status-dot');
  const btn = document.getElementById('btn-ws-connect');
  if (!dot || !btn) return;
  dot.dataset.status = status;
  dot.title = status;
  btn.textContent = status === 'connected' ? 'Disconnect' : 'Connect';
}

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
    const rep = state.repeaters.find(x => x.id === id);
    if (rep && !incomingKeys.has(rep.wsKey)) {
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
    const existing = state.repeaters.find(x => x.fromWs && x.wsKey === key);
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

  if (coverageChanged) clearCoverageLayers();
  if (coverageChanged || displayChanged) {
    renderRepeaterList();
    document.dispatchEvent(new CustomEvent('repeaters:changed'));
  }
  console.info(`[ws] synced ${_wsRepeaterIds.size} repeater(s)`);
  _saveWsToDb();
}

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
  _ws.onopen  = () => {
    _setWsStatus('connected');
    setStatus('Live feed connected.');
    // Trigger Node-RED to send the current repeater list immediately
    _ws.send('{}');
  };
  _ws.onerror = () => { _setWsStatus('error'); };
  _ws.onclose = () => { _setWsStatus('disconnected'); _ws = null; };
  _ws.onmessage = e => {
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
    clearCoverageLayers();
    renderRepeaterList();
    document.dispatchEvent(new CustomEvent('repeaters:changed'));
  }
  _setWsStatus('disconnected');
  setStatus('Live feed disconnected.');
}

function _syncUndoBtn() {
  const btn = document.getElementById('btn-undo-remove');
  if (btn) btn.disabled = _lastRemoved === null;
}

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

export function addRepeater(name, lat, lon, height, power, freq, gain = 2, options = {}) {
  name = String(name ?? `Repeater ${state.nextId}`);
  const color = PALETTE[state.repeaters.length % PALETTE.length];
  const id = state.nextId++;

  const marker = L.marker([lat, lon], { icon: makeMarkerIcon(color), draggable: true })
    .addTo(map)
    .bindPopup(`<b>${escHtml(name)}</b><br>TX: ${power} dBm + ${gain} dBi @ ${freq} MHz<br>Ant. height: ${height} m`);

  marker.on('dragend', () => {
    const r = state.repeaters.find(x => x.id === id);
    if (r) {
      r.lat = marker.getLatLng().lat;
      r.lon = marker.getLatLng().lng;
      // B8: keep popup content in sync with new position
      r.marker.setPopupContent(`<b>${escHtml(r.name)}</b><br>TX: ${r.power} dBm + ${r.gain} dBi @ ${r.freq} MHz<br>Ant. height: ${r.height} m`);
      document.dispatchEvent(new CustomEvent('repeater:moved', {
        detail: { id: r.id, lat: r.lat, lon: r.lon },
      }));
    }
    clearCoverageLayers();
    setStatus('Repeater moved. Click Compute Coverage to refresh.');
    renderRepeaterList();
  });

  marker.on('click', async (e) => {
    if (e.originalEvent) e.originalEvent._meshcoreHandled = true;
    const r = state.repeaters.find(x => x.id === id);
    if (!r) return;
    if (await handleRepeaterClick(r)) return; // consumed by P2P picking
    if (handlePathNodePick(r)) return; // consumed by best-path picking
    _showCtxMenu(r, e.originalEvent);
  });

  const repeater = { id, name, lat, lon, height, power, freq, gain, marker, color, visible: true };
  state.repeaters.push(repeater);
  if (options.render !== false) renderRepeaterList();
  if (options.notify !== false) document.dispatchEvent(new CustomEvent('repeaters:changed'));
  return repeater;
}

export function removeRepeater(id, options = {}) {
  const idx = state.repeaters.findIndex(r => r.id === id);
  if (idx === -1) return;
  const r = state.repeaters[idx];
  if (options.rememberUndo !== false) {
    _lastRemoved = { name: r.name, lat: r.lat, lon: r.lon, height: r.height, power: r.power, freq: r.freq, gain: r.gain };
  }
  r.marker.remove();
  state.repeaters.splice(idx, 1);
  if (r.fromWs) _wsRepeaterIds.delete(id);
  if (options.clearCoverage !== false) clearCoverageLayers();
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
  document.getElementById('place-hint').classList.add('hidden');
  document.getElementById('btn-add-click').textContent = 'Place on Map';
  map.getContainer().style.cursor = '';
}

function setEditMode(id) {
  editingId = id;
  const r = state.repeaters.find(x => x.id === id);
  document.getElementById('repeater-name').value   = r.name;
  document.getElementById('repeater-lat').value    = r.lat;
  document.getElementById('repeater-lon').value    = r.lon;
  document.getElementById('repeater-height').value = r.height;
  document.getElementById('repeater-power').value  = r.power;
  document.getElementById('repeater-freq').value   = r.freq;
  document.getElementById('repeater-gain').value   = r.gain;  // B4: reset preset selects so stale selections don't overwrite the loaded values
  document.getElementById('radio-preset').value   = '';
  document.getElementById('antenna-preset').value = '';
  document.getElementById('btn-add-repeater').textContent = 'Update Node';
  document.getElementById('btn-add-click').textContent = 'Cancel';
  const addPanel = document.getElementById('add-repeater-summary')?.closest('details');
  if (addPanel) addPanel.open = true;
  document.getElementById('sidebar').scrollTo({ top: 0, behavior: 'smooth' });
}

function clearEditMode() {
  editingId = null;
  document.getElementById('btn-add-repeater').textContent = 'Add Node';
  document.getElementById('btn-add-click').textContent = 'Place on Map';
}

export function editRepeater(id) {
  cancelPlacing();
  setEditMode(id);
}

function toggleVisibility(id) {
  const r = state.repeaters.find(x => x.id === id);
  if (!r) return;
  r.visible = !r.visible;
  if (r.visible) {
    r.marker.addTo(map);
  } else {
    r.marker.remove();
  }
  const covLayers = state.coverageLayers.filter(l => l._repeaterId === id);
  covLayers.forEach(l => {
    if (r.visible) l.addTo(map); else l.remove();
  });
  renderRepeaterList();
  document.dispatchEvent(new CustomEvent('repeaters:changed'));
}

function renderRepeaterList() {
  const ul = document.getElementById('repeater-list');

  let list = state.repeaters.filter(r =>
    !_filterText || [
      r.name,
      `${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}`,
      `${r.height} ${r.power} ${r.freq} ${r.gain}`,
      r.short ?? '',
      r.lastSeen ?? '',
    ].join(' ').toLowerCase().includes(_filterText)
  );
  if (_sortMode === 'name-az') list.sort((a, b) => a.name.localeCompare(b.name));
  else if (_sortMode === 'name-za') list.sort((a, b) => b.name.localeCompare(a.name));

  if (list.length === 0) {
    ul.innerHTML = state.repeaters.length === 0
      ? '<li class="empty-msg">No repeaters added yet.</li>'
      : '<li class="empty-msg">No nodes match the filter.</li>';
    return;
  }

  ul.innerHTML = list.map(r => {
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

  document.getElementById('node-filter').addEventListener('input', e => {
    _filterText = e.target.value.toLowerCase();
    renderRepeaterList();
  });
  document.getElementById('node-sort').addEventListener('change', e => {
    _sortMode = e.target.value;
    renderRepeaterList();
  });
  document.getElementById('btn-toggle-all-vis').addEventListener('click', () => {
    const anyHidden = state.repeaters.some(r => !r.visible);
    for (const r of state.repeaters) {
      if (anyHidden ? !r.visible : r.visible) toggleVisibility(r.id);
    }
  });

  // A1: delegated click handler — no window globals needed
  document.getElementById('repeater-list').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = parseInt(btn.dataset.id);
    if (btn.dataset.action === 'edit')       editRepeater(id);
    if (btn.dataset.action === 'delete')     removeRepeater(id);
    if (btn.dataset.action === 'toggle-vis') toggleVisibility(id);
  });
  document.getElementById('btn-add-repeater').addEventListener('click', () => {
    const name   = document.getElementById('repeater-name').value.trim() || `Repeater ${state.nextId}`;
    const lat    = parseFloat(document.getElementById('repeater-lat').value);
    const lon    = parseFloat(document.getElementById('repeater-lon').value);
    const height = parseFloat(document.getElementById('repeater-height').value) || 10;
    const power  = parseFloat(document.getElementById('repeater-power').value) || 20;
    const freq   = parseFloat(document.getElementById('repeater-freq').value) || 869.525;
    const gain   = parseFloat(document.getElementById('repeater-gain').value) || 2;

    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setStatus('Invalid coordinates. Enter valid lat/lon.');
      return;
    }

    if (editingId !== null) {
      const r = state.repeaters.find(x => x.id === editingId);
      if (r) {
        r.name = name; r.lat = lat; r.lon = lon; r.height = height;
        r.power = power; r.freq = freq; r.gain = gain;
        r.marker.setLatLng([lat, lon]);
        r.marker.setPopupContent(`<b>${escHtml(name)}</b><br>TX: ${power} dBm + ${gain} dBi @ ${freq} MHz<br>Ant. height: ${height} m`);
        clearCoverageLayers();
        renderRepeaterList();
        setStatus(`Updated ${name}. Click Compute Coverage to refresh.`);
      }
      clearEditMode();
      return;
    }

    addRepeater(name, lat, lon, height, power, freq, gain);
    map.setView([lat, lon], Math.max(map.getZoom(), 11));
  });

  document.getElementById('btn-add-click').addEventListener('click', () => {
    // In edit mode this button acts as cancel
    if (editingId !== null) { clearEditMode(); return; }

    placingMode = !placingMode;
    const hint = document.getElementById('place-hint');
    const btn  = document.getElementById('btn-add-click');
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

  map.on('click', (e) => {
    if (!placingMode) return;
    if (e.originalEvent) e.originalEvent._meshcoreHandled = true;
    const name   = document.getElementById('repeater-name').value.trim() || `Repeater ${state.nextId}`;
    const height = parseFloat(document.getElementById('repeater-height').value) || 10;
    const power  = parseFloat(document.getElementById('repeater-power').value) || 20;
    const freq   = parseFloat(document.getElementById('repeater-freq').value) || 869.525;
    const gain   = parseFloat(document.getElementById('repeater-gain').value) || 2;
    addRepeater(name, e.latlng.lat, e.latlng.lng, height, power, freq, gain);
    cancelPlacing();
  });

  document.getElementById('btn-undo-remove').addEventListener('click', undoLastRemove);

  document.getElementById('btn-ws-connect').addEventListener('click', () => {
    if (_ws) {
      disconnectLiveFeed();
    } else {
      const url = document.getElementById('ws-url').value.trim();
      if (url) connectLiveFeed(url);
    }
  });

  document.getElementById('btn-clear-nodes').addEventListener('click', () => {
    if (!confirmAction('Clear all nodes and coverage overlays?')) return;
    clearEditMode();
    [...state.repeaters].forEach(r => removeRepeater(r.id, { render: false, clearCoverage: false, notify: false }));
    clearCoverageLayers();
    _lastRemoved = null;
    _syncUndoBtn();
    renderRepeaterList();
    document.dispatchEvent(new CustomEvent('repeaters:changed'));
    setStatus('All nodes cleared.');
  });
}
