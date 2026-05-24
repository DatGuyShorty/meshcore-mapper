import { map, state } from './map.js';
import { findBestPath } from './pathfinder.js';
import { getP2PSettings } from './settings.js';
import { escHtml, setActiveTab, setButtonBusy } from './ui.js';

let _pathPolylines = [];
let _pathMarkers = [];
let _abortController = null;

export function initPathfinderUI() {
  document.getElementById('btn-find-path').addEventListener('click', _runPathFinder);
  document.getElementById('btn-cancel-path').addEventListener('click', () => _abortController?.abort());
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
  });
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
    return;
  }

  for (const r of nodes) {
    fromSel.appendChild(new Option(r.name, String(r.id)));
    toSel.appendChild(new Option(r.name, String(r.id)));
  }

  if (savedFrom && [...fromSel.options].some(o => o.value === savedFrom)) fromSel.value = savedFrom;
  if (savedTo && [...toSel.options].some(o => o.value === savedTo)) toSel.value = savedTo;

  if (nodes.length >= 2 && fromSel.value === toSel.value) {
    toSel.value = nodes[nodes.length - 1].id;
  }
}

function _clearPathLayers() {
  _pathPolylines.forEach(l => map.removeLayer(l));
  _pathMarkers.forEach(m => map.removeLayer(m));
  _pathPolylines = [];
  _pathMarkers = [];
}

function _marginColor(margin) {
  if (margin >= 15) return '#4ade80';
  if (margin >= 5) return '#86efac';
  if (margin >= 0) return '#facc15';
  if (margin >= -5) return '#fb923c';
  return '#f87171';
}

function _renderPath(result) {
  const { path, bottleneck, numHops, edgeDistances } = result;
  _clearPathLayers();

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1].node;
    const b = path[i].node;
    const color = _marginColor(path[i].incomingMargin);
    _pathPolylines.push(
      L.polyline([[a.lat, a.lon], [b.lat, b.lon]], { color, weight: 3, opacity: 0.85 }).addTo(map)
    );
  }

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
  document.getElementById('path-status').textContent =
    bottleneck >= 0 ? `Path found - bottleneck +${bottleneck.toFixed(1)} dB` : `Path found but link is marginal (${bottleneck.toFixed(1)} dB)`;
  document.getElementById('path-status').className = 'hint';
  document.getElementById('path-status').classList.remove('hidden');
}

async function _runPathFinder() {
  const fromId = parseInt(document.getElementById('path-from').value);
  const toId = parseInt(document.getElementById('path-to').value);
  if (isNaN(fromId) || isNaN(toId) || fromId === toId) {
    document.getElementById('path-status').textContent = 'Select two different nodes.';
    document.getElementById('path-status').className = 'hint hint-error';
    document.getElementById('path-status').classList.remove('hidden');
    return;
  }

  const p2p = getP2PSettings();
  const useFresnel = document.getElementById('path-use-fresnel').checked;

  document.getElementById('path-status').textContent = 'Computing...';
  document.getElementById('path-status').className = 'hint';
  document.getElementById('path-status').classList.remove('hidden');
  document.getElementById('path-results').innerHTML = '';
  setButtonBusy('btn-find-path', true, 'Computing...');
  document.getElementById('btn-cancel-path').disabled = false;
  _abortController = new AbortController();
  _clearPathLayers();

  try {
    const requiredRx = p2p.rxSens + (p2p.fadeMargin ?? 0);
    const result = await findBestPath(state.repeaters, fromId, toId, requiredRx, p2p.rxGain, useFresnel, {
      ...p2p,
      signal: _abortController.signal,
    });
    if (!result) {
      document.getElementById('path-status').textContent = 'No path found - nodes may be out of range or all links blocked.';
      document.getElementById('path-status').className = 'hint hint-error';
      return;
    }
    _renderPath(result);
    console.info(`[pathfinder] ${result.numHops}-hop path, bottleneck=${result.bottleneck.toFixed(1)} dB`);
  } catch (err) {
    if (err?.cancelled || err?.name === 'AbortError') {
      document.getElementById('path-status').textContent = 'Path search cancelled.';
      document.getElementById('path-status').className = 'hint hint-error';
    } else {
      document.getElementById('path-status').textContent = `Error: ${err.message}`;
      document.getElementById('path-status').className = 'hint hint-error';
      console.error('[pathfinder]', err);
    }
  } finally {
    _abortController = null;
    setButtonBusy('btn-find-path', false);
    document.getElementById('btn-cancel-path').disabled = true;
  }
}
