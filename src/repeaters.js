/**
 * repeaters.js — Repeater CRUD, map markers, and placement UI.
 * Exports: addRepeater, removeRepeater, cancelPlacing, init
 */
import { map, state, clearCoverageLayers, clearFoliageLayers } from './map.js';
import { escHtml, setStatus } from './ui.js';

const PALETTE = [
  '#61dafb', '#4ade80', '#fb923c', '#f472b6',
  '#a78bfa', '#facc15', '#34d399', '#f87171',
];

// Module-local interaction state
let placingMode = false;
let editingId = null; // null = add mode, number = ID being edited

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

export function addRepeater(name, lat, lon, height, power, freq, gain = 2) {
  const color = PALETTE[state.repeaters.length % PALETTE.length];
  const id = state.nextId++;

  const marker = L.marker([lat, lon], { icon: makeMarkerIcon(color), draggable: true })
    .addTo(map)
    .bindPopup(`<b>${escHtml(name)}</b><br>TX: ${power} dBm + ${gain} dBi @ ${freq} MHz<br>Ant. height: ${height} m`);

  marker.on('dragend', () => {
    const r = state.repeaters.find(x => x.id === id);
    if (r) { r.lat = marker.getLatLng().lat; r.lon = marker.getLatLng().lng; }
    clearCoverageLayers();
    setStatus('Repeater moved. Click Compute Coverage to refresh.');
    renderRepeaterList();
  });

  const repeater = { id, name, lat, lon, height, power, freq, gain, marker, color };
  state.repeaters.push(repeater);
  renderRepeaterList();
  return repeater;
}

export function removeRepeater(id) {
  const idx = state.repeaters.findIndex(r => r.id === id);
  if (idx === -1) return;
  state.repeaters[idx].marker.remove();
  state.repeaters.splice(idx, 1);
  clearCoverageLayers();
  clearFoliageLayers(); // B2: remove foliage outlines when repeater is deleted
  renderRepeaterList();
}

/** Cancel placement mode without placing — called by optimizerUI when it needs map clicks. */
export function cancelPlacing() {
  if (!placingMode) return;
  placingMode = false;
  document.getElementById('place-hint').classList.add('hidden');
  document.getElementById('btn-add-click').textContent = '📍 Place on Map';
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
  document.getElementById('antenna-preset').value = '';  document.getElementById('btn-add-repeater').textContent = '✓ Update';
  document.getElementById('btn-add-click').textContent    = '✕ Cancel';
  const addPanel = document.getElementById('add-repeater-summary')?.closest('details');
  if (addPanel) addPanel.open = true;
  document.getElementById('sidebar').scrollTo({ top: 0, behavior: 'smooth' });
}

function clearEditMode() {
  editingId = null;
  document.getElementById('btn-add-repeater').textContent = '+ Add';
  document.getElementById('btn-add-click').textContent    = '📍 Place on Map';
}

export function editRepeater(id) {
  cancelPlacing();
  setEditMode(id);
}

function renderRepeaterList() {
  const ul = document.getElementById('repeater-list');
  if (state.repeaters.length === 0) {
    ul.innerHTML = '<li class="empty-msg">No repeaters added yet.</li>';
    return;
  }
  // A1: use data-action/data-id attributes; delegation listener is in init()
  ul.innerHTML = state.repeaters.map(r => `
    <li class="repeater-item" data-id="${r.id}">
      <div class="ri-color" style="background:${r.color}"></div>
      <div class="ri-info">
        <div class="ri-name">${escHtml(r.name)}</div>
        <div class="ri-coords">${r.lat.toFixed(4)}, ${r.lon.toFixed(4)} \u00b7 ${r.height}m \u00b7 ${r.power}dBm+${r.gain}dBi \u00b7 ${r.freq}MHz</div>
      </div>
      <button class="ri-edit" data-action="edit" data-id="${r.id}" title="Edit">\u270e</button>
      <button class="ri-del"  data-action="delete" data-id="${r.id}" title="Remove">\u00d7</button>
    </li>`).join('');
  // U1: highlight the currently-edited item
  if (editingId !== null) {
    const el = ul.querySelector(`[data-id="${editingId}"]`);
    if (el) el.classList.add('editing');
  }
}

export function init() {
  // A1: delegated click handler — no window globals needed
  document.getElementById('repeater-list').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = parseInt(btn.dataset.id);
    if (btn.dataset.action === 'edit')   editRepeater(id);
    if (btn.dataset.action === 'delete') removeRepeater(id);
  });
  document.getElementById('btn-add-repeater').addEventListener('click', () => {
    const name   = document.getElementById('repeater-name').value.trim() || `Repeater ${state.nextId}`;
    const lat    = parseFloat(document.getElementById('repeater-lat').value);
    const lon    = parseFloat(document.getElementById('repeater-lon').value);
    const height = parseFloat(document.getElementById('repeater-height').value) || 10;
    const power  = parseFloat(document.getElementById('repeater-power').value) || 20;
    const freq   = parseFloat(document.getElementById('repeater-freq').value) || 868;
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
      btn.textContent = '✕ Cancel';
      map.getContainer().style.cursor = 'crosshair';
    } else {
      hint.classList.add('hidden');
      btn.textContent = '📍 Place on Map';
      map.getContainer().style.cursor = '';
    }
  });

  map.on('click', (e) => {
    if (!placingMode) return;
    const name   = document.getElementById('repeater-name').value.trim() || `Repeater ${state.nextId}`;
    const height = parseFloat(document.getElementById('repeater-height').value) || 10;
    const power  = parseFloat(document.getElementById('repeater-power').value) || 20;
    const freq   = parseFloat(document.getElementById('repeater-freq').value) || 868;
    const gain   = parseFloat(document.getElementById('repeater-gain').value) || 2;
    addRepeater(name, e.latlng.lat, e.latlng.lng, height, power, freq, gain);
    cancelPlacing();
  });

  document.getElementById('btn-clear-nodes').addEventListener('click', () => {
    clearEditMode();
    [...state.repeaters].forEach(r => removeRepeater(r.id));
    clearCoverageLayers();
    clearFoliageLayers();
    setStatus('All nodes cleared.');
  });
}
