import { map, state } from './map.js';
import { findBestPath } from './pathfinder.js';
import { getP2PSettings } from './settings.js';
import {
  escHtml, hideProgress, setActiveTab, setButtonBusy, setCancelHandler,
  setProgress, yieldToUI,
} from './ui.js';

let _pathPolylines = [];
let _pathMarkers = [];
let _abortController = null;
let _pickTarget = null;

function _setPickMode(target) {
  _pickTarget = target;
  const hint = document.getElementById('path-pick-hint');
  const status = document.getElementById('path-status');
  if (hint) {
    hint.textContent = target
      ? `Click a repeater marker on the map to choose ${target === 'from' ? 'the FROM endpoint' : 'the TO endpoint'}.`
      : 'Click a repeater marker on the map to choose the path endpoint.';
    hint.classList.toggle('hidden', !target);
  }
  if (status && target) {
    status.textContent = target === 'from'
      ? 'Pick a FROM node on the map.'
      : 'Pick a TO node on the map.';
    status.className = 'hint';
    status.classList.remove('hidden');
  }
}

export function initPathfinderUI() {
  document.getElementById('btn-find-path').addEventListener('click', _runPathFinder);
  document.getElementById('btn-cancel-path').addEventListener('click', () => _abortController?.abort());
  document.getElementById('btn-path-pick-from').addEventListener('click', () => {
    setActiveTab('planning');
    _refreshPathSelects();
    _setPickMode('from');
  });
  document.getElementById('btn-path-pick-to').addEventListener('click', () => {
    setActiveTab('planning');
    _refreshPathSelects();
    _setPickMode('to');
  });
  document.addEventListener('repeaters:changed', _refreshPathSelects);
  setTimeout(_refreshPathSelects, 0);

  document.addEventListener('path:from-node', e => {
    setActiveTab('planning');
    document.querySelectorAll('#tab-planning details.panel').forEach(d => {
      if (d.querySelector('summary')?.textContent.includes('Best Relay Path')) d.open = true;
    });
    _refreshPathSelects();
    const fromSel = document.getElementById('path-from');
    if (fromSel) fromSel.value = String(e.detail.id);
    const toSel = document.getElementById('path-to');
    if (fromSel && toSel) _ensureDifferentEndpoints(fromSel, toSel);
    _setPickMode(null);
  });
}

export function handlePathNodePick(r) {
  if (!_pickTarget) return false;
  const fromSel = document.getElementById('path-from');
  const toSel = document.getElementById('path-to');
  if (!fromSel || !toSel) return false;

  if (_pickTarget === 'from') {
    fromSel.value = String(r.id);
    _ensureDifferentEndpoints(fromSel, toSel);
  } else {
    toSel.value = String(r.id);
    _ensureDifferentEndpoints(fromSel, toSel);
  }

  _setPickMode(null);
  return true;
}

function _ensureDifferentEndpoints(fromSel, toSel) {
  if (fromSel.value !== toSel.value || toSel.options.length <= 1) return;
  const next = [...toSel.options].find(opt => opt.value !== fromSel.value);
  if (next) toSel.value = next.value;
}

function _refreshPathSelects() {
  const nodes = state.repeaters;
  const fromSel = document.getElementById('path-from');
  const toSel = document.getElementById('path-to');
  if (!fromSel || !toSel) return;

  const savedFrom = fromSel.value;
  const savedTo = toSel.value;

  fromSel.innerHTML = '';
  toSel.innerHTML = '';

  if (nodes.length === 0) {
    fromSel.innerHTML = toSel.innerHTML = '<option value="">-- no nodes --</option>';
    _setPickMode(null);
    return;
  }

  const sorted = [...nodes].sort((a, b) => a.name.localeCompare(b.name));
  for (const r of sorted) {
    fromSel.appendChild(new Option(r.name, String(r.id)));
    toSel.appendChild(new Option(r.name, String(r.id)));
  }

  if (savedFrom && [...fromSel.options].some(o => o.value === savedFrom)) fromSel.value = savedFrom;
  if (savedTo && [...toSel.options].some(o => o.value === savedTo)) toSel.value = savedTo;

  _ensureDifferentEndpoints(fromSel, toSel);
}

function _clearPathLayers() {
  _pathPolylines.forEach(l => map.removeLayer(l));
  _pathMarkers.forEach(m => map.removeLayer(m));
  _pathPolylines = [];
  _pathMarkers = [];
  state.pathLinks = [];
  _dispatchLinkChanged();
}

function _dispatchLinkChanged() {
  document.dispatchEvent(new CustomEvent('p2p:changed'));
}

function _marginColor(margin) {
  if (margin >= 15) return '#4ade80';
  if (margin >= 5) return '#86efac';
  if (margin >= 0) return '#facc15';
  if (margin >= -5) return '#fb923c';
  return '#f87171';
}

function _setPathStatus(msg, isError = false) {
  const status = document.getElementById('path-status');
  status.textContent = msg;
  status.className = 'hint' + (isError ? ' hint-error' : '');
  status.classList.remove('hidden');
}

function _pathLineLabel(margin, distM, rxPower) {
  const sign = margin >= 0 ? '+' : '';
  const rxText = Number.isFinite(rxPower) ? ` - ${rxPower.toFixed(1)} dBm` : '';
  return `<b>${sign}${margin.toFixed(1)} dB</b><br>${(distM / 1000).toFixed(2)} km${rxText}`;
}

function _renderPath(result) {
  const { path, bottleneck, numHops, edgeDistances, edgeRxPowers = [] } = result;
  _clearPathLayers();
  const pathLinks = [];

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1].node;
    const b = path[i].node;
    const margin = path[i].incomingMargin;
    const color = _marginColor(margin);
    const line = L.polyline([[a.lat, a.lon], [b.lat, b.lon]], {
      color,
      weight: 4,
      opacity: 0.9,
    }).addTo(map);
    line.bindTooltip(_pathLineLabel(margin, edgeDistances[i - 1], edgeRxPowers[i - 1]), {
      permanent: true,
      direction: 'center',
      className: 'path-line-label',
    });
    _pathPolylines.push(line);
    pathLinks.push({
      id: `path-hop-${i}`,
      kind: 'path',
      pointA: { lat: a.lat, lon: a.lon },
      pointB: { lat: b.lat, lon: b.lon },
      margin,
      rxPower: edgeRxPowers[i - 1] ?? null,
      distM: edgeDistances[i - 1] ?? null,
      color,
    });
  }
  state.pathLinks = pathLinks;
  _dispatchLinkChanged();

  for (let i = 0; i < path.length; i++) {
    const { node } = path[i];
    const isEndpoint = (i === 0 || i === path.length - 1);
    const icon = L.divIcon({
      html: `<div style="width:${isEndpoint ? 14 : 10}px;height:${isEndpoint ? 14 : 10}px;border-radius:50%;background:${isEndpoint ? '#facc15' : '#a78bfa'};border:2px solid #fff;"></div>`,
      iconSize: [14, 14], iconAnchor: [7, 7], className: '',
    });
    _pathMarkers.push(L.marker([node.lat, node.lon], { icon }).addTo(map).bindTooltip(escHtml(node.name), { permanent: false }));
  }

  const latlngs = path.map(p => [p.node.lat, p.node.lon]);
  if (latlngs.length > 1) map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });

  const bottleneckColor = _marginColor(bottleneck);
  let html = `<div class="path-summary">
    <span class="path-hops">${numHops} hop${numHops !== 1 ? 's' : ''}</span>
    <span class="path-bottleneck" style="color:${bottleneckColor}">Bottleneck: ${bottleneck.toFixed(1)} dB</span>
  </div>
  <table class="p2p-table"><tbody>`;

  for (let i = 0; i < path.length; i++) {
    const { node, incomingMargin } = path[i];
    const distStr = i > 0 ? ` - ${(edgeDistances[i - 1] / 1000).toFixed(1)} km` : '';
    const marginStr = incomingMargin !== null
      ? `<span style="color:${_marginColor(incomingMargin)}">${incomingMargin >= 0 ? '+' : ''}${incomingMargin.toFixed(1)} dB</span>`
      : '';
    html += `<tr>
      <td class="p2p-key">${i === 0 ? '&bull;' : '&middot;'} ${escHtml(node.name)}</td>
      <td class="p2p-val">${marginStr}${distStr}</td>
    </tr>`;
  }
  html += '</tbody></table>';

  document.getElementById('path-results').innerHTML = html;
  _setPathStatus(bottleneck >= 0
    ? `Path found - bottleneck +${bottleneck.toFixed(1)} dB`
    : `Path found but link is marginal (${bottleneck.toFixed(1)} dB)`);
}

async function _runPathFinder() {
  const fromId = parseInt(document.getElementById('path-from').value);
  const toId = parseInt(document.getElementById('path-to').value);
  if (isNaN(fromId) || isNaN(toId) || fromId === toId) {
    _setPathStatus('Select two different nodes.', true);
    return;
  }

  const p2p = getP2PSettings();
  const useFresnel = document.getElementById('path-use-fresnel').checked;
  const startTime = performance.now();
  const step = (msg) => {
    const elapsed = (performance.now() - startTime).toFixed(1);
    console.info(`[pathfinder] [${elapsed}ms] ${msg}`);
  };
  step('UI start: ' + JSON.stringify({
    fromId,
    toId,
    rxSens: p2p.rxSens,
    fadeMargin: p2p.fadeMargin,
    requiredRx: p2p.rxSens + (p2p.fadeMargin ?? 0),
    pathHopRadiusKm: p2p.pathHopRadiusKm,
    rxGain: p2p.rxGain,
    useFresnel,
    useFoliage: p2p.useFoliage,
    useBuildings: p2p.useBuildings,
  }));

  _setPathStatus('Computing relay path...');
  document.getElementById('path-results').innerHTML = '';
  setButtonBusy('btn-find-path', true, 'Computing...');
  document.getElementById('btn-cancel-path').disabled = false;
  _abortController = new AbortController();
  setCancelHandler(() => _abortController?.abort());
  setProgress(2, 'Preparing relay path search...');
  _clearPathLayers();

  try {
    const requiredRx = p2p.rxSens + (p2p.fadeMargin ?? 0);
    _setPathStatus(`Radius-limited path search... (${p2p.pathHopRadiusKm} km hop radius)`);
    const result = await findBestPath(state.repeaters, fromId, toId, requiredRx, p2p.rxGain, useFresnel, {
      ...p2p,
      signal: _abortController.signal,
      onLog: (line) => console.info(`[pathfinder] ${line}`),
      onProgress: (pct, msg) => {
        setProgress(pct, msg);
        _setPathStatus(msg);
      },
    });
    if (!result) {
      hideProgress();
      step('No path found');
      _setPathStatus('No path found - nodes may be out of range or all links blocked.', true);
      return;
    }
    setProgress(100, 'Relay path ready.');
    await yieldToUI();
    hideProgress();
    _renderPath(result);
    step(`Complete: hops=${result.numHops}, bottleneck=${result.bottleneck.toFixed(1)} dB, total=${(performance.now() - startTime).toFixed(1)}ms`);
    console.info(`[pathfinder] ${result.numHops}-hop path, bottleneck=${result.bottleneck.toFixed(1)} dB`);
  } catch (err) {
    hideProgress();
    if (err?.cancelled || err?.name === 'AbortError') {
      _setPathStatus('Path search cancelled.', true);
    } else {
      _setPathStatus(`Error: ${err.message}`, true);
      console.error('[pathfinder]', err);
    }
  } finally {
    _abortController = null;
    setCancelHandler(null);
    setButtonBusy('btn-find-path', false);
    document.getElementById('btn-cancel-path').disabled = true;
  }
}
