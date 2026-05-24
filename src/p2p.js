/**
 * p2p.js - Point-to-point picking UI.
 * Link-budget math, terrain profile rendering, and pathfinder UI live in
 * dedicated modules.
 */
import { map } from './map.js';
import { calculateLinkBudget } from './linkBudget.js';
import { initPathfinderUI } from './pathfinderUI.js';
import { getP2PSettings } from './settings.js';
import { escHtml, setActiveTab, setButtonBusy } from './ui.js';

let picking = false;
let pointA = null;
let pointB = null;
let markers = [];
let polyline = null;
let _abortController = null;

function resetState() {
  markers.forEach(m => map.removeLayer(m));
  markers = [];
  if (polyline) { map.removeLayer(polyline); polyline = null; }
  pointA = pointB = null;
}

function makePin(latlng, label, color) {
  const icon = L.divIcon({
    html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;"></div>`,
    iconSize: [12, 12], iconAnchor: [6, 6], className: '',
  });
  return L.marker(latlng, { icon }).addTo(map).bindTooltip(escHtml(label), { permanent: true, direction: 'top', offset: [0, -8] });
}

function setStatus(msg, isError = false) {
  const el = document.getElementById('p2p-status');
  el.textContent = msg;
  el.className = 'hint' + (isError ? ' hint-error' : '');
  el.classList.remove('hidden');
}

function clearResults() {
  document.getElementById('p2p-results').innerHTML = '';
  document.getElementById('p2p-status').classList.add('hidden');
}

function _updateP2PLineLabel(margin, rxPower, distM) {
  if (!polyline) return;
  const color = margin >= 10 ? '#4ade80' : margin >= 0 ? '#facc15' : '#fc8181';
  polyline.setStyle({ color, weight: 3, dashArray: margin < 0 ? '4 4' : null, opacity: 0.95 });

  const sign = margin >= 0 ? '+' : '';
  const label = `${sign}${margin.toFixed(1)} dB`;
  const details = `${(distM / 1000).toFixed(2)} km - ${rxPower.toFixed(1)} dBm`;
  const html = `<b>${label}</b><br>${details}`;
  if (polyline.getTooltip()) {
    polyline.setTooltipContent(html);
  } else {
    polyline.bindTooltip(html, {
      permanent: true,
      direction: 'center',
      className: 'p2p-line-label',
    });
  }
}

function _fmt(v) {
  return v.toFixed(1);
}

function _renderBudget(result) {
  _updateP2PLineLabel(result.margin, result.rxPower, result.distM);

  const diffColor = result.diffractionLoss > 20 ? '#fc8181' : result.diffractionLoss > 6 ? '#facc15' : '';
  const vegColor = result.foliageLoss > 15 ? '#fc8181' : result.foliageLoss > 5 ? '#facc15' : '#4ade80';
  const bldColor = result.buildingLoss > 15 ? '#fc8181' : result.buildingLoss > 5 ? '#facc15' : '#4ade80';
  const geoLabel = result.geoResult.geometricLos
    ? '<span style="color:#4ade80">Clear</span>'
    : '<span style="color:#fc8181">Blocked</span>';
  const fresnelLabel = result.fresnelResult.fresnelClear
    ? '<span style="color:#4ade80">Clear</span>'
    : (result.geoResult.geometricLos
        ? '<span style="color:#facc15">Partial</span>'
        : '<span style="color:#fc8181">Blocked</span>');

  const rows = [
    ['Distance', `${(result.distM / 1000).toFixed(2)} km`, ''],
    ['Profile samples', `${result.sampleCount}`, ''],
    ['Free-space loss', `${_fmt(result.pathLoss)} dB`, ''],
    ['Diffraction loss', `${_fmt(result.diffractionLoss)} dB`, diffColor],
    ...(result.foliageLoss > 0 ? [['Foliage loss', `${_fmt(result.foliageLoss)} dB`, vegColor]] : []),
    ...(result.buildingLoss > 0 ? [['Building loss', `${_fmt(result.buildingLoss)} dB`, bldColor]] : []),
    ['Total path loss', `${_fmt(result.totalPathLoss)} dB`, ''],
    ['TX EIRP', `${_fmt(result.txEirp)} dBm`, ''],
    ['Received power', `${_fmt(result.rxPower)} dBm`, ''],
    ...(result.fadeMargin > 0 ? [['Required RX', `${_fmt(result.requiredRx)} dBm`, '']] : []),
    ['Link margin', `${_fmt(result.margin)} dB`, result.margin >= 10 ? '#4ade80' : result.margin >= 0 ? '#facc15' : '#fc8181'],
    ['Geometric LoS', geoLabel, null],
    ['Fresnel clearance', fresnelLabel, null],
  ];

  const tbody = rows.map(([k, v, color]) => {
    const val = color === null ? v : `<span style="color:${color}">${v}</span>`;
    return `<tr><td class="p2p-key">${k}</td><td class="p2p-val">${val}</td></tr>`;
  }).join('');

  document.getElementById('p2p-results').innerHTML =
    result.profileSvg + `<table class="p2p-table"><tbody>${tbody}</tbody></table>`;
  setStatus(result.margin >= 0
    ? `Link OK (+${_fmt(result.margin)} dB margin)`
    : `Link FAILED (${_fmt(result.margin)} dB short)`);
}

async function computeAndRenderLinkBudget() {
  if (!pointA || !pointB) return;
  setStatus('Fetching elevation and obstacle data...');
  setButtonBusy('btn-p2p-update', true, 'Calculating...');
  document.getElementById('btn-cancel-p2p').disabled = false;
  document.getElementById('p2p-results').innerHTML = '';
  _abortController = new AbortController();

  try {
    const result = await calculateLinkBudget(pointA, pointB, getP2PSettings(), { signal: _abortController.signal });
    console.info(`[p2p] dist=${(result.distM / 1000).toFixed(2)} km FSPL=${result.pathLoss.toFixed(1)} dB diff=${result.diffractionLoss.toFixed(1)} dB foliage=${result.foliageLoss.toFixed(1)} dB bld=${result.buildingLoss.toFixed(1)} dB rxPower=${result.rxPower.toFixed(1)} dBm margin=${result.margin.toFixed(1)} dB`);
    _renderBudget(result);
  } catch (err) {
    if (err?.cancelled || err?.name === 'AbortError') {
      setStatus('Link budget cancelled.', true);
    } else {
      setStatus(`Link budget failed: ${err.message}`, true);
      console.error('[p2p]', err);
    }
  } finally {
    _abortController = null;
    setButtonBusy('btn-p2p-update', false);
    document.getElementById('btn-cancel-p2p').disabled = true;
  }
}

function startPicking() {
  resetState();
  clearResults();
  picking = true;
  document.getElementById('p2p-pick-hint').classList.remove('hidden');
  document.getElementById('btn-p2p-pick').disabled = true;
  map.getContainer().style.cursor = 'crosshair';
}

function _finishPick() {
  polyline = L.polyline([pointA, pointB], { color: '#facc15', weight: 2, dashArray: '6 4' }).addTo(map);
  picking = false;
  document.getElementById('p2p-pick-hint').classList.add('hidden');
  document.getElementById('btn-p2p-pick').disabled = false;
  map.getContainer().style.cursor = '';
}

function _copyRepeaterToP2P(r) {
  document.getElementById('p2p-tx-height').value = r.height;
  document.getElementById('p2p-tx-power').value = r.power;
  document.getElementById('p2p-tx-gain').value = r.gain;
  document.getElementById('p2p-freq').value = r.freq;
}

function _copyRepeaterToP2PRx(r) {
  document.getElementById('p2p-rx-height').value = r.height;
  document.getElementById('p2p-rx-gain').value = r.gain;
}

export async function handleRepeaterClick(r) {
  if (!picking) return false;
  if (!pointA) {
    pointA = L.latLng(r.lat, r.lon);
    markers.push(makePin(pointA, `A: ${r.name}`, '#61dafb'));
    _copyRepeaterToP2P(r);
    document.getElementById('p2p-pick-hint').textContent = 'Now click point B (receiver)...';
  } else {
    pointB = L.latLng(r.lat, r.lon);
    markers.push(makePin(pointB, `B: ${r.name}`, '#4ade80'));
    _copyRepeaterToP2PRx(r);
    _finishPick();
    await computeAndRenderLinkBudget();
  }
  return true;
}

export function startPickingFrom(r) {
  setActiveTab('planning');
  startPicking();
  pointA = L.latLng(r.lat, r.lon);
  markers.push(makePin(pointA, `A: ${r.name}`, '#61dafb'));
  _copyRepeaterToP2P(r);
  document.getElementById('p2p-pick-hint').textContent = 'Now click point B (receiver)...';
}

export function init() {
  document.getElementById('btn-p2p-pick').addEventListener('click', startPicking);
  document.getElementById('btn-p2p-update').addEventListener('click', async () => {
    if (!pointA || !pointB) {
      setStatus('Pick point A and point B first, then recalculate.', true);
      return;
    }
    await computeAndRenderLinkBudget();
  });
  document.getElementById('btn-p2p-clear').addEventListener('click', () => {
    _abortController?.abort();
    resetState();
    clearResults();
    document.getElementById('p2p-pick-hint').classList.add('hidden');
    document.getElementById('btn-p2p-pick').disabled = false;
    picking = false;
    map.getContainer().style.cursor = '';
  });
  document.getElementById('btn-cancel-p2p').addEventListener('click', () => _abortController?.abort());

  initPathfinderUI();

  map.on('click', async (e) => {
    if (!picking) return;
    if (!pointA) {
      pointA = e.latlng;
      markers.push(makePin(e.latlng, 'A (TX)', '#61dafb'));
      document.getElementById('p2p-pick-hint').textContent = 'Now click point B (receiver)...';
    } else {
      pointB = e.latlng;
      markers.push(makePin(e.latlng, 'B (RX)', '#4ade80'));
      _finishPick();
      await computeAndRenderLinkBudget();
    }
  });
}
