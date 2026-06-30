import { map, state } from './map.js';
import type { PathResult, RelayNode } from './pathfinder.js';
import { findBestPath } from './pathfinder.js';
import { getP2PSettings } from './settings.js';
import {
  escHtml, hideProgress, setActiveTab, setButtonBusy, setCancelHandler,
  setProgress, yieldToUI,
} from './ui.js';
import {
  formatPathLineLabel,
  formatPathStatus,
  pathMarginColor,
  renderPathResultHtml,
} from './pathfinderResultView.js';
import {
  ensureDifferentPathEndpoints,
  renderPathEndpointSelects,
  type PathEndpointNode,
} from './pathfinderEndpointView.js';

type PickTarget = 'from' | 'to' | null;
type AbortLikeError = Error & { cancelled?: boolean };
type ProgressMeta = { title: string };
type RepeaterOption = RelayNode & PathEndpointNode;
type PathClickEvent = {
  originalEvent?: {
    _meshcoreHandled?: boolean;
  };
} | null;
type PathPolyline = {
  _pathLinkId?: string;
  setStyle?(style: { weight: number; opacity: number }): void;
  getElement?(): { classList: { toggle(name: string, force?: boolean): void } } | null;
  bringToFront?(): void;
  bindTooltip(content: string, options?: Record<string, unknown>): PathPolyline;
  on(event: 'click', handler: (event: PathClickEvent) => void): void;
  addTo(target: unknown): PathPolyline;
};
type PathMarker = {
  addTo(target: unknown): PathMarker;
  bindTooltip(content: string, options?: Record<string, unknown>): PathMarker;
};
type PathLink = {
  id: string;
  kind: 'path';
  label: string;
  pointA: { lat: number; lon: number };
  pointB: { lat: number; lon: number };
  endpointARepeaterId: string | number;
  endpointBRepeaterId: string | number;
  endpointAName: string;
  endpointBName: string;
  hopIndex: number;
  hopTotal: number;
  margin: number;
  rxPower: number | null;
  distM: number | null;
  color: string;
};
type SelectionChangedDetail = {
  kind?: string;
  linkKind?: string;
  id?: string | number | null;
};
type PathFromNodeDetail = {
  id: string | number;
};

let _pathPolylines: PathPolyline[] = [];
let _pathMarkers: PathMarker[] = [];
let _abortController: AbortController | null = null;
let _pickTarget: PickTarget = null;
let _selectedPathLinkId: string | number | null = null;

function _syncPathSelectionHighlight(): void {
  _pathPolylines.forEach((line) => {
    const selected = _selectedPathLinkId !== null && String(line._pathLinkId) === String(_selectedPathLinkId);
    line.setStyle?.({
      weight: selected ? 7 : 4,
      opacity: selected ? 1 : 0.9,
    });
    line.getElement?.()?.classList.toggle('map-object-selected', selected);
    if (selected) line.bringToFront?.();
  });
}

function _setPickMode(target: PickTarget): void {
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

export function initPathfinderUI(): void {
  document.getElementById('btn-find-path')?.addEventListener('click', _runPathFinder);
  document.getElementById('btn-cancel-path')?.addEventListener('click', () => _abortController?.abort());
  document.getElementById('btn-path-pick-from')?.addEventListener('click', () => {
    setActiveTab('planning');
    _refreshPathSelects();
    _setPickMode('from');
  });
  document.getElementById('btn-path-pick-to')?.addEventListener('click', () => {
    setActiveTab('planning');
    _refreshPathSelects();
    _setPickMode('to');
  });
  document.addEventListener('repeaters:changed', _refreshPathSelects);
  document.addEventListener('selection:changed', (event) => {
    const detail = (event as CustomEvent<SelectionChangedDetail>).detail;
    _selectedPathLinkId = detail?.kind === 'link' && detail.linkKind === 'path'
      ? detail.id ?? null
      : null;
    _syncPathSelectionHighlight();
  });
  setTimeout(_refreshPathSelects, 0);

  document.addEventListener('path:from-node', (event) => {
    const detail = (event as CustomEvent<PathFromNodeDetail>).detail;
    setActiveTab('planning');
    document.querySelectorAll('#tab-planning details.panel').forEach((d) => {
      if (d.querySelector('summary')?.textContent?.includes('Best Relay Path')) {
        (d as HTMLDetailsElement).open = true;
      }
    });
    _refreshPathSelects();
    const fromSel = document.getElementById('path-from') as HTMLSelectElement | null;
    if (fromSel) fromSel.value = String(detail.id);
    const toSel = document.getElementById('path-to') as HTMLSelectElement | null;
    if (fromSel && toSel) ensureDifferentPathEndpoints(fromSel, toSel);
    _setPickMode(null);
  });
  document.addEventListener('link:path-open', () => {
    setActiveTab('planning');
    document.querySelectorAll('#tab-planning details.panel').forEach((d) => {
      if (d.querySelector('summary')?.textContent?.includes('Best Relay Path')) {
        (d as HTMLDetailsElement).open = true;
      }
    });
  });
  document.addEventListener('link:path-recompute', () => {
    setActiveTab('planning');
    _runPathFinder();
  });
}

export function handlePathNodePick(r: { id: string | number }): boolean {
  if (!_pickTarget) return false;
  const fromSel = document.getElementById('path-from') as HTMLSelectElement | null;
  const toSel = document.getElementById('path-to') as HTMLSelectElement | null;
  if (!fromSel || !toSel) return false;

  if (_pickTarget === 'from') {
    fromSel.value = String(r.id);
    ensureDifferentPathEndpoints(fromSel, toSel);
  } else {
    toSel.value = String(r.id);
    ensureDifferentPathEndpoints(fromSel, toSel);
  }

  _setPickMode(null);
  return true;
}

function _refreshPathSelects(): void {
  const nodes = state.repeaters as RepeaterOption[];
  const fromSel = document.getElementById('path-from') as HTMLSelectElement | null;
  const toSel = document.getElementById('path-to') as HTMLSelectElement | null;
  if (!fromSel || !toSel) return;

  const { hasNodes } = renderPathEndpointSelects(fromSel, toSel, nodes);
  if (!hasNodes) {
    _setPickMode(null);
  }
}

function _clearPathLayers(): void {
  _pathPolylines.forEach((l) => map.removeLayer(l));
  _pathMarkers.forEach((m) => map.removeLayer(m));
  _pathPolylines = [];
  _pathMarkers = [];
  _selectedPathLinkId = null;
  state.pathLinks = [];
  _dispatchLinkChanged();
}

function _dispatchLinkChanged(): void {
  document.dispatchEvent(new CustomEvent('p2p:changed'));
}

function _selectPathLink(id: string, event: PathClickEvent): void {
  if (event?.originalEvent) event.originalEvent._meshcoreHandled = true;
  document.dispatchEvent(new CustomEvent('link:selected', {
    detail: { kind: 'path', id },
  }));
}

function _setPathStatus(msg: string, isError = false): void {
  const status = document.getElementById('path-status');
  if (!status) return;
  status.textContent = msg;
  status.className = 'hint' + (isError ? ' hint-error' : '');
  status.classList.remove('hidden');
}

function _renderPath(result: PathResult): void {
  const { path, bottleneck, numHops, edgeDistances, edgeRxPowers = [] } = result;
  _clearPathLayers();
  const pathLinks: PathLink[] = [];

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1].node;
    const b = path[i].node;
    const margin = path[i].incomingMargin ?? 0;
    const color = pathMarginColor(margin);
    const line = L.polyline([[a.lat, a.lon], [b.lat, b.lon]], {
      color,
      weight: 4,
      opacity: 0.9,
      className: 'path-hop-line',
    }).addTo(map) as PathPolyline;
    line.bindTooltip(formatPathLineLabel(margin, edgeDistances[i - 1], edgeRxPowers[i - 1]), {
      permanent: true,
      direction: 'center',
      className: 'path-line-label',
    });
    const id = `path-hop-${i}`;
    line._pathLinkId = id;
    line.on('click', (event) => _selectPathLink(id, event));
    _pathPolylines.push(line);
    pathLinks.push({
      id,
      kind: 'path',
      label: `Relay Hop ${i}/${numHops}`,
      pointA: { lat: a.lat, lon: a.lon },
      pointB: { lat: b.lat, lon: b.lon },
      endpointARepeaterId: a.id,
      endpointBRepeaterId: b.id,
      endpointAName: a.name ?? `Node ${a.id}`,
      endpointBName: b.name ?? `Node ${b.id}`,
      hopIndex: i,
      hopTotal: numHops,
      margin,
      rxPower: edgeRxPowers[i - 1] ?? null,
      distM: edgeDistances[i - 1] ?? null,
      color,
    });
  }
  state.pathLinks = pathLinks;
  _dispatchLinkChanged();
  _syncPathSelectionHighlight();

  for (let i = 0; i < path.length; i++) {
    const { node } = path[i];
    const isEndpoint = (i === 0 || i === path.length - 1);
    const icon = L.divIcon({
      html: `<div style="width:${isEndpoint ? 14 : 10}px;height:${isEndpoint ? 14 : 10}px;border-radius:50%;background:${isEndpoint ? '#facc15' : '#a78bfa'};border:2px solid #fff;"></div>`,
      iconSize: [14, 14], iconAnchor: [7, 7], className: '',
    });
    _pathMarkers.push(L.marker([node.lat, node.lon], { icon }).addTo(map).bindTooltip(escHtml(node.name), { permanent: false }));
  }

  const latlngs = path.map((p) => [p.node.lat, p.node.lon] as [number, number]);
  if (latlngs.length > 1) map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });

  const resultsEl = document.getElementById('path-results');
  if (resultsEl) resultsEl.innerHTML = renderPathResultHtml(result);
  const status = formatPathStatus(bottleneck);
  _setPathStatus(status.text, status.isError);
}

async function _runPathFinder(): Promise<void> {
  const fromSel = document.getElementById('path-from') as HTMLSelectElement | null;
  const toSel = document.getElementById('path-to') as HTMLSelectElement | null;
  const fromId = parseInt(fromSel?.value ?? '');
  const toId = parseInt(toSel?.value ?? '');
  if (isNaN(fromId) || isNaN(toId) || fromId === toId) {
    _setPathStatus('Select two different nodes.', true);
    return;
  }

  const p2p = getP2PSettings();
  const useFresnel = (document.getElementById('path-use-fresnel') as HTMLInputElement | null)?.checked ?? false;
  const useFoliage = (document.getElementById('path-use-foliage') as HTMLInputElement | null)?.checked ?? false;
  const useBuildings = (document.getElementById('path-use-buildings') as HTMLInputElement | null)?.checked ?? false;
  const maxHops = Math.max(0, parseInt((document.getElementById('path-max-hops') as HTMLInputElement | null)?.value ?? '0', 10) || 0);
  const hopPenaltyDb = Math.max(0, parseFloat((document.getElementById('path-hop-penalty-db') as HTMLInputElement | null)?.value ?? '5') || 0);
  const startTime = performance.now();
  const step = (msg: string): void => {
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
    useFoliage,
    useBuildings,
    maxHops,
    hopPenaltyDb,
  }));

  _setPathStatus('Computing relay path...');
  const resEl = document.getElementById('path-results');
  if (resEl) resEl.innerHTML = '';
  setButtonBusy('btn-find-path', true, 'Computing...');
  const cancelBtn = document.getElementById('btn-cancel-path') as HTMLButtonElement | null;
  if (cancelBtn) cancelBtn.disabled = false;
  _abortController = new AbortController();
  setCancelHandler(() => _abortController?.abort());
  const progressMeta: ProgressMeta = { title: 'Relay Path Search' };
  setProgress(2, 'Preparing relay path search...', progressMeta);
  _clearPathLayers();

  try {
    const requiredRx = p2p.rxSens + (p2p.fadeMargin ?? 0);
    _setPathStatus(`Radius-limited path search... (${p2p.pathHopRadiusKm} km hop radius)`);
    const result = await findBestPath(state.repeaters, fromId, toId, requiredRx, p2p.rxGain, useFresnel, {
      ...p2p,
      useFoliage,
      useBuildings,
      maxHops,
      hopPenaltyDb,
      signal: _abortController.signal,
      onLog: (line) => console.info(`[pathfinder] ${line}`),
      onProgress: (pct, msg) => {
        setProgress(pct, msg, progressMeta);
        _setPathStatus(msg);
      },
    });
    if (!result) {
      hideProgress();
      step('No path found');
      _setPathStatus('No path found - nodes may be out of range or all links blocked.', true);
      return;
    }
    setProgress(100, 'Relay path ready.', progressMeta);
    await yieldToUI();
    hideProgress();
    _renderPath(result);
    step(`Complete: hops=${result.numHops}, bottleneck=${result.bottleneck.toFixed(1)} dB, total=${(performance.now() - startTime).toFixed(1)}ms`);
    console.info(`[pathfinder] ${result.numHops}-hop path, bottleneck=${result.bottleneck.toFixed(1)} dB`);
  } catch (rawErr) {
    const err = rawErr as AbortLikeError;
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
    const btn = document.getElementById('btn-cancel-path') as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
  }
}
