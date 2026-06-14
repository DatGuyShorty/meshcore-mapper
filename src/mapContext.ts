import { map, state } from './map.js';
import { inspectCoverageAtPoint } from './coveragePoint.js';
import { escHtml, setActiveTab } from './ui.js';
import { optimizerResultCoreDetails } from './optimizerResultDetails.js';
import { nodeHealth } from './liveHealth.js';
import {
  type CoverageInspectorInput,
  coveragePointInspectorContent,
  coveragePointPopupContent,
  coverageRowContent,
  formatCoverageDb,
  formatCoverageDbm,
  formatCoverageDistance,
} from './coverageInspectorView.js';
import {
  createSelectionStore,
  type LatLngPoint,
  type Obstacle,
  type OptimizerCandidate,
  type SelectedLink,
} from './selectionStore.js';

type LatLonPoint = {
  lat: number;
  lon: number;
};

type Repeater = Record<string, any> & {
  id: string | number;
  name?: string;
  lat: number;
  lon: number;
  visible?: boolean;
  fromWs?: boolean;
  short?: string | null;
  lastSeen?: string | number | null;
};

type LinkInspector = Record<string, any> & {
  id?: string | number;
  kind?: string;
  label?: string;
  pointA?: unknown;
  pointB?: unknown;
  endpointAName?: string;
  endpointBName?: string;
};

type MeshcoreClickEvent = MouseEvent & {
  _meshcoreHandled?: boolean;
};

type MapClickEvent = {
  latlng: LatLngPoint;
  originalEvent?: MeshcoreClickEvent;
};

const _selectionStore = createSelectionStore();
let _inspectorActionsBound = false;

/** @param {number} v */
export const _fmtDb = formatCoverageDb;

/** @param {number} v */
export const _fmtDbm = formatCoverageDbm;

/** @param {number} m */
export const _fmtDistance = formatCoverageDistance;

/** @param {import('./coveragePoint.js').CoverageInspectRow} row */
export const _coverageRow = coverageRowContent;

/** @param {{ lat: number, lng: number }} latlng */
function _coverageInspectorInput(latlng: LatLngPoint): CoverageInspectorInput {
  const rows = inspectCoverageAtPoint(latlng, state.coverageResults);
  const allLayerCount = state.coverageResults.length;
  const visibleLayerCount = state.coverageResults.filter(result => result?.visible !== false).length;
  return { latlng, rows, allLayerCount, visibleLayerCount };
}

/** @param {{ lat: number, lng: number }} latlng */
export function _popupContent(latlng: LatLngPoint): string {
  return coveragePointPopupContent(_coverageInspectorInput(latlng));
}

/** @param {{ lat: number, lng: number }} latlng */
export function _pointInspectorContent(latlng: LatLngPoint): string {
  return coveragePointInspectorContent(_coverageInspectorInput(latlng));
}

/** @param {number} value */
function _plural(value: number): string {
  return value === 1 ? '' : 's';
}

/**
 * @param {string} label
 * @param {number} value
 * @param {string} detail
 */
function _summaryStat(label: string, value: number, detail: string): string {
  return `<div class="inspector-stat">
    <span>${escHtml(label)}</span>
    <strong>${escHtml(value)}</strong>
    <em>${escHtml(detail)}</em>
  </div>`;
}

/**
 * @param {unknown} value
 * @param {string} unit
 * @param {number} [digits]
 */
function _fmtUnit(value: unknown, unit: string, digits = 1): string {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(digits)} ${unit}` : `Unknown ${unit}`;
}

/**
 * @param {string} label
 * @param {unknown} value
 */
function _inspectorSpecRow(label: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  return `<dt>${escHtml(label)}</dt><dd>${escHtml(String(value))}</dd>`;
}

/** @param {number | string | null} id */
function _findRepeater(id: number | string | null): Repeater | undefined {
  return state.repeaters.find(rep => String(rep?.id) === String(id));
}

/**
 * @param {string | null | undefined} kind
 * @param {string | number | null | undefined} id
 */
function _findLink(kind: string | null | undefined, id: string | number | null | undefined): LinkInspector | undefined {
  const source = kind === 'path' ? state.pathLinks : state.p2pLinks;
  return source.find(link => String(link?.id) === String(id));
}

/** @param {any} rep */
export function _nodeInspectorContent(rep: Repeater): string {
  const visible = rep?.visible !== false;
  const coords = `${Number(rep?.lat).toFixed(5)}, ${Number(rep?.lon).toFixed(5)}`;
  const tx = `${_fmtUnit(rep?.power, 'dBm')} + ${_fmtUnit(rep?.gain, 'dBi')}`;
  const health = nodeHealth(rep);
  const liveRows: Array<[string, unknown]> = [];
  if (rep?.fromWs) liveRows.push(['Source', 'Live feed']);
  if (rep?.short) liveRows.push(['ID', rep.short]);
  if (rep?.fromWs) liveRows.push(['Health', `${health.label} (${health.detail})`]);
  if (rep?.lastSeen) liveRows.push(['Last Seen', rep.lastSeen]);
  return `<div class="inspector-node-card">
    <div class="inspector-node-head">
      <span class="inspector-node-color" style="background:${escHtml(rep?.color ?? '#61dafb')}"></span>
      <div class="inspector-node-title">
        <div class="map-context-title">${escHtml(rep?.name ?? 'Node')}</div>
        <div class="map-context-coords">${escHtml(coords)}</div>
      </div>
      <span class="map-context-status">${escHtml(rep?.fromWs ? health.label : visible ? 'Visible' : 'Hidden')}</span>
    </div>
    <dl class="inspector-node-specs">
      <dt>Height</dt><dd>${escHtml(_fmtUnit(rep?.height, 'm AGL'))}</dd>
      <dt>TX</dt><dd>${escHtml(tx)}</dd>
      <dt>Frequency</dt><dd>${escHtml(_fmtUnit(rep?.freq, 'MHz', 3))}</dd>
      ${liveRows.map(row => `<dt>${escHtml(row[0])}</dt><dd>${escHtml(row[1])}</dd>`).join('')}
    </dl>
    <div class="inspector-actions">
      <button type="button" class="btn-secondary btn-xs" data-inspector-action="node-edit" data-node-id="${escHtml(rep?.id)}">Edit</button>
      <button type="button" class="btn-secondary btn-xs" data-inspector-action="node-toggle-visibility" data-node-id="${escHtml(rep?.id)}">${visible ? 'Hide' : 'Show'}</button>
      <button type="button" class="btn-secondary btn-xs" data-inspector-action="node-coverage" data-node-id="${escHtml(rep?.id)}">Run Coverage</button>
      <button type="button" class="btn-secondary btn-xs" data-inspector-action="node-view-3d" data-node-id="${escHtml(rep?.id)}">View 3D</button>
      <button type="button" class="btn-secondary btn-xs" data-inspector-action="node-p2p" data-node-id="${escHtml(rep?.id)}">P2P Link</button>
      <button type="button" class="btn-secondary btn-xs" data-inspector-action="node-optimize" data-node-id="${escHtml(rep?.id)}">Optimize Here</button>
      <button type="button" class="btn-secondary btn-xs inspector-danger" data-inspector-action="node-delete" data-node-id="${escHtml(rep?.id)}">Delete</button>
      <button type="button" class="btn-secondary btn-xs" data-inspector-action="clear-selection">Clear</button>
    </div>
  </div>`;
}

/** @param {any} obstacle */
export function _obstacleInspectorContent(obstacle: Obstacle): string {
  const colors: Record<string, string> = {
    foliage: '#22c55e',
    building: '#9ca3af',
    barrier: '#fb923c',
  };
  const category = String(obstacle?.category ?? 'obstacle');
  const title = obstacle?.title ?? 'Obstacle';
  const source = obstacle?.source ?? 'Map overlay';
  const type = obstacle?.rawOsmType ?? obstacle?.osmType ?? 'unknown';
  const heightLabel = obstacle?.heightLabel ?? 'Height';
  const attenuationLabel = obstacle?.attenuationLabel ?? 'Loss rate';
  const factor = Number(obstacle?.attenuationFactor);
  const factorLabel = Number.isFinite(factor) ? `${factor.toFixed(2)}x` : 'Unknown';

  return `<div class="inspector-link-card">
    <div class="inspector-link-head">
      <span class="inspector-node-color" style="background:${escHtml(colors[category] ?? '#94a3b8')}"></span>
      <div class="inspector-node-title">
        <div class="map-context-title">${escHtml(title)}</div>
        <div class="map-context-coords">${escHtml(obstacle?.id ?? source)}</div>
      </div>
      <span class="map-context-status">${escHtml(category)}</span>
    </div>
    <dl class="inspector-node-specs">
      ${_inspectorSpecRow('OSM Type', type)}
      ${_inspectorSpecRow(heightLabel, _fmtUnit(obstacle?.heightM, 'm'))}
      ${_inspectorSpecRow('Height Source', obstacle?.heightSource ?? 'OSM/default fallback')}
      ${_inspectorSpecRow(attenuationLabel, _fmtUnit(obstacle?.attenuationDbPerM, 'dB/m', 2))}
      ${_inspectorSpecRow('Loss Factor', factorLabel)}
      ${_inspectorSpecRow('Source', source)}
      ${_inspectorSpecRow('Geometry', obstacle?.geometry ?? 'Polygon')}
    </dl>
    <div class="inspector-actions">
      <button type="button" class="btn-secondary btn-xs" data-inspector-action="obstacle-open-map">Open Map Layers</button>
      <button type="button" class="btn-secondary btn-xs" data-inspector-action="obstacle-edit-model">Edit Model</button>
      <button type="button" class="btn-secondary btn-xs" data-inspector-action="clear-selection">Clear</button>
    </div>
  </div>`;
}

/**
 * @param {string} label
 * @param {unknown} value
 * @param {string} [unit]
 * @param {number} [digits]
 */
function _linkSpecRow(label: string, value: unknown, unit = '', digits = 1): string {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (typeof value === 'number' && !Number.isFinite(value)) return '';
  const text = Number.isFinite(n)
    ? `${n.toFixed(digits)}${unit ? ` ${unit}` : ''}`
    : String(value);
  return `<dt>${escHtml(label)}</dt><dd>${escHtml(text)}</dd>`;
}

/** @param {number | null | undefined} margin */
function _linkStatus(margin: number | null | undefined): string {
  if (!Number.isFinite(margin)) return 'Pending';
  const m = Number(margin);
  if (m >= 10) return 'Healthy';
  if (m >= 0) return 'Tight';
  return 'Failed';
}

/**
 * @param {unknown} value
 * @param {number} digits
 */
function _fmtMaybeNumber(value: unknown, digits: number): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : 'Unknown';
}

/** @param {any} link */
export function _linkInspectorContent(link: LinkInspector): string {
  const kind = link?.kind === 'path' ? 'path' : 'p2p';
  const title = kind === 'path' ? (link?.label ?? 'Relay Hop') : 'P2P Link';
  const endpointA = link?.endpointAName ?? 'Point A';
  const endpointB = link?.endpointBName ?? 'Point B';
  const margin = Number(link?.margin);
  const status = _linkStatus(margin);
  const distM = Number(link?.distM);
  const distKm = Number.isFinite(distM) ? distM / 1000 : null;
  const los = typeof link?.geometricLos === 'boolean'
    ? (link.geometricLos ? 'LoS clear' : 'LoS blocked')
    : null;
  const fresnel = typeof link?.fresnelClear === 'boolean'
    ? (link.fresnelClear ? 'Fresnel clear' : 'Fresnel blocked')
    : null;
  return `<div class="inspector-link-card">
    <div class="inspector-link-head">
      <div class="inspector-link-swatch" style="background:${escHtml(link?.color ?? '#facc15')}"></div>
      <div class="inspector-node-title">
        <div class="map-context-title">${escHtml(title)}</div>
        <div class="map-context-coords">${escHtml(endpointA)} -> ${escHtml(endpointB)}</div>
      </div>
      <span class="map-context-status">${escHtml(status)}</span>
    </div>
    <dl class="inspector-node-specs">
      ${_linkSpecRow('Distance', distKm, 'km', 2)}
      ${_linkSpecRow('Margin', link?.margin, 'dB')}
      ${_linkSpecRow('RX Power', link?.rxPower, 'dBm')}
      ${_linkSpecRow('Path Loss', link?.pathLoss, 'dB')}
      ${_linkSpecRow('Total Loss', link?.totalPathLoss, 'dB')}
      ${_linkSpecRow('Diffraction', link?.diffractionLoss, 'dB')}
      ${_linkSpecRow('Foliage', link?.foliageLoss, 'dB')}
      ${_linkSpecRow('Buildings', link?.buildingLoss, 'dB')}
      ${_linkSpecRow('LoS', los)}
      ${_linkSpecRow('Fresnel', fresnel)}
      ${_linkSpecRow('Samples', link?.sampleCount, '', 0)}
    </dl>
    <div class="inspector-actions">
      <button type="button" class="btn-secondary btn-xs" data-inspector-action="${kind === 'path' ? 'link-path-open' : 'link-p2p-open'}">Open ${kind === 'path' ? 'Path' : 'Budget'}</button>
      <button type="button" class="btn-secondary btn-xs" data-inspector-action="link-view-3d">View 3D</button>
      ${kind === 'p2p' ? '<button type="button" class="btn-secondary btn-xs" data-inspector-action="link-p2p-profile">Profile</button>' : ''}
      <button type="button" class="btn-secondary btn-xs" data-inspector-action="${kind === 'path' ? 'link-path-recompute' : 'link-p2p-recompute'}">Recompute</button>
      <button type="button" class="btn-secondary btn-xs" data-inspector-action="clear-selection">Clear</button>
    </div>
  </div>`;
}

/** @param {any} candidate */
export function _optimizerCandidateInspectorContent(candidate: OptimizerCandidate): string {
  const rank = Number.isFinite(candidate?.rank) ? Number(candidate.rank) : null;
  const title = rank ? `Suggested #${rank}` : 'Optimizer Candidate';
  const details = optimizerResultCoreDetails(candidate as any);
  const formula = candidate?.scoreBreakdown?.formula;
  const hasBackhaul = Number.isFinite(candidate?.backhaulPeerLat) && Number.isFinite(candidate?.backhaulPeerLon);
  const score = Number(candidate?.score);
  return `<div class="inspector-candidate-card">
    <div class="inspector-candidate-head">
      <span class="inspector-candidate-rank">${rank ?? '?'}</span>
      <div class="inspector-node-title">
        <div class="map-context-title">${escHtml(title)}</div>
        <div class="map-context-coords">${escHtml(_fmtMaybeNumber(candidate?.lat, 5))}, ${escHtml(_fmtMaybeNumber(candidate?.lon, 5))}</div>
      </div>
      <span class="map-context-status">${Number.isFinite(score) ? `${escHtml((score * 100).toFixed(1))}%` : 'Pending'}</span>
    </div>
    <div class="inspector-detail-list">
      ${details.map(row => `<div>${escHtml(row)}</div>`).join('')}
      ${formula ? `<div>Objective: ${escHtml(formula)}</div>` : ''}
    </div>
    <div class="inspector-actions">
      <button type="button" class="btn-secondary btn-xs" data-inspector-action="optimizer-add">Add Node</button>
      <button type="button" class="btn-secondary btn-xs" data-inspector-action="optimizer-open">Open Optimizer</button>
      <button type="button" class="btn-secondary btn-xs" data-inspector-action="optimizer-view-3d">View 3D</button>
      ${hasBackhaul ? '<button type="button" class="btn-secondary btn-xs" data-inspector-action="optimizer-show-backhaul">Show Backhaul</button>' : ''}
      <button type="button" class="btn-secondary btn-xs" data-inspector-action="clear-selection">Clear</button>
    </div>
  </div>`;
}

export function _projectSummaryContent(): string {
  const nodeCount = state.repeaters.length;
  const visibleNodeCount = state.repeaters.filter(rep => rep?.visible !== false).length;
  const layerCount = state.coverageResults.length;
  const visibleLayerCount = state.coverageResults.filter(result => result?.visible !== false).length;
  const p2pCount = state.p2pLinks.length;
  const pathCount = state.pathLinks.length;

  return `<div class="inspector-summary">
    <div class="inspector-summary-grid">
      ${_summaryStat('Nodes', nodeCount, `${visibleNodeCount} visible`)}
      ${_summaryStat('Coverage Layers', layerCount, `${visibleLayerCount} visible`)}
      ${_summaryStat('P2P Links', p2pCount, `${p2pCount} link${_plural(p2pCount)}`)}
      ${_summaryStat('Relay Paths', pathCount, `${pathCount} path${_plural(pathCount)}`)}
    </div>
    <div class="inspector-actions">
      <button type="button" class="btn-secondary btn-xs" data-inspector-tab="nodes">Add Node</button>
      <button type="button" class="btn-secondary btn-xs" data-inspector-tab="coverage">Coverage</button>
      <button type="button" class="btn-secondary btn-xs" data-inspector-tab="planning">Optimize</button>
    </div>
  </div>`;
}

/** @param {string} title */
function _setInspectorTitle(title: string): void {
  const titleEl = document.getElementById('selection-inspector-title');
  if (titleEl) titleEl.textContent = title;
}

/** @param {string} html */
function _renderInspector(html: string): void {
  const body = document.getElementById('selection-inspector-body');
  if (body) body.innerHTML = html;
}

function _dispatchSelectionChanged(): void {
  document.dispatchEvent(new CustomEvent('selection:changed', {
    detail: _selectionStore.currentDetail(),
  }));
}

function _refreshAndDispatchSelection(): void {
  _refreshSelectionInspector();
  _dispatchSelectionChanged();
}

function _refreshSelectionInspector(): void {
  const selection = _selectionStore.snapshot();
  if (selection.obstacle) {
    _setInspectorTitle('Obstacle');
    _renderInspector(_obstacleInspectorContent(selection.obstacle));
    return;
  }
  if (selection.optimizerCandidate) {
    _setInspectorTitle('Optimizer Candidate');
    _renderInspector(_optimizerCandidateInspectorContent(selection.optimizerCandidate));
    return;
  }
  if (selection.link) {
    const link = _findLink(selection.link.kind, selection.link.id);
    if (link) {
      _setInspectorTitle(link.kind === 'path' ? 'Relay Link' : 'P2P Link');
      _renderInspector(_linkInspectorContent(link));
      return;
    }
    _selectionStore.clearLink();
  }
  const nextSelection = _selectionStore.snapshot();
  if (nextSelection.nodeId !== null) {
    const rep = _findRepeater(nextSelection.nodeId);
    if (rep) {
      _setInspectorTitle('Node');
      _renderInspector(_nodeInspectorContent(rep));
      return;
    }
    _selectionStore.clearNode();
  }
  const fallbackSelection = _selectionStore.snapshot();
  if (fallbackSelection.point) {
    _setInspectorTitle('Map Point');
    _renderInspector(_pointInspectorContent(fallbackSelection.point));
    return;
  }
  _setInspectorTitle('Project Summary');
  _renderInspector(_projectSummaryContent());
}

/** @param {{ lat: number, lng: number } | null} latlng */
export function updateSelectionInspector(latlng: LatLngPoint | null = null): void {
  _selectionStore.selectPoint(latlng);
  _refreshAndDispatchSelection();
}

/** @param {number | string | null} id */
export function updateNodeInspector(id: number | string | null): void {
  _selectionStore.selectNode(id);
  _refreshAndDispatchSelection();
}

/**
 * @param {string} kind
 * @param {string | number} id
 */
export function updateLinkInspector(kind: string, id: string | number): void {
  _selectionStore.selectLink(kind, id);
  _refreshAndDispatchSelection();
}

/** @param {any} candidate */
export function updateOptimizerCandidateInspector(candidate: OptimizerCandidate | null): void {
  _selectionStore.selectOptimizerCandidate(candidate);
  _refreshAndDispatchSelection();
}

/** @param {any | null} obstacle */
export function updateObstacleInspector(obstacle: Obstacle | null): void {
  _selectionStore.selectObstacle(obstacle);
  _refreshAndDispatchSelection();
}

/** @param {{ lat: number, lng: number }} latlng */
function _prefillNodeAtPoint(latlng: LatLngPoint): void {
  setActiveTab('nodes');
  const latInput = document.getElementById('repeater-lat');
  const lonInput = document.getElementById('repeater-lon');
  if (latInput && 'value' in latInput) latInput.value = latlng.lat.toFixed(5);
  if (lonInput && 'value' in lonInput) lonInput.value = latlng.lng.toFixed(5);
  const addPanel = document.getElementById('add-repeater-summary')?.closest('details');
  if (addPanel && 'open' in addPanel) addPanel.open = true;
  document.getElementById('repeater-name')?.focus();
}

/** @param {any} point */
function _latLonPoint(point: unknown): LatLonPoint | null {
  const raw = point as { lat?: unknown; lon?: unknown; lng?: unknown } | null | undefined;
  const lat = Number(raw?.lat);
  const lon = Number(raw?.lon ?? raw?.lng);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

/**
 * @param {string} label
 * @param {Array<any>} points
 */
function _dispatch3dFocus(label: string, points: unknown[]): void {
  const valid = points.map(_latLonPoint).filter(Boolean);
  if (!valid.length) return;
  document.dispatchEvent(new CustomEvent('map3d:focus', {
    detail: {
      label,
      point: valid[0],
      points: valid,
    },
  }));
}

/**
 * @param {string} type
 * @param {number | string} id
 */
function _dispatchNodeAction(type: string, id: number | string): void {
  const rep = _findRepeater(id);
  if (!rep) return;
  if (type === 'node-optimize') {
    document.dispatchEvent(new CustomEvent('map:optimize-here', {
      detail: { id: rep.id, lat: rep.lat, lon: rep.lon },
    }));
    return;
  }
  if (type === 'node-view-3d') {
    _dispatch3dFocus(rep.name || 'node', [{ lat: rep.lat, lon: rep.lon }]);
    return;
  }
  const eventName = ({
    'node-edit': 'node:edit',
    'node-toggle-visibility': 'node:toggle-visibility',
    'node-coverage': 'node:coverage',
    'node-p2p': 'node:p2p',
    'node-delete': 'node:delete',
  })[type];
  if (eventName) document.dispatchEvent(new CustomEvent(eventName, { detail: { id: rep.id } }));
}

/** @param {string} type */
function _dispatchLinkAction(type: string): void {
  if (type === 'link-view-3d') {
    const selectedLink = _selectionStore.snapshot().link;
    const link = selectedLink ? _findLink(selectedLink.kind, selectedLink.id) : null;
    if (link) _dispatch3dFocus(link.label || `${link.endpointAName ?? 'Point A'} to ${link.endpointBName ?? 'Point B'}`, [link.pointA, link.pointB]);
    return;
  }
  if (type === 'link-p2p-open') document.dispatchEvent(new CustomEvent('link:p2p-open'));
  else if (type === 'link-p2p-profile') document.dispatchEvent(new CustomEvent('link:p2p-profile'));
  else if (type === 'link-p2p-recompute') document.dispatchEvent(new CustomEvent('link:p2p-recompute'));
  else if (type === 'link-path-open') document.dispatchEvent(new CustomEvent('link:path-open'));
  else if (type === 'link-path-recompute') document.dispatchEvent(new CustomEvent('link:path-recompute'));
}

/** @param {string} type */
function _dispatchOptimizerAction(type: string): void {
  const candidate = _selectionStore.snapshot().optimizerCandidate;
  if (!candidate) return;
  if (type === 'optimizer-view-3d') {
    const rank = Number.isFinite(candidate.rank) ? `Suggested #${candidate.rank}` : 'optimizer candidate';
    _dispatch3dFocus(rank, [{ lat: candidate.lat, lon: candidate.lon }]);
    return;
  }
  if (type === 'optimizer-open') {
    setActiveTab('planning');
    document.querySelectorAll('#tab-planning details.panel').forEach((d: Element) => {
      if (d.querySelector('summary')?.textContent?.includes('Best Location Optimizer')) {
        (d as HTMLDetailsElement).open = true;
      }
    });
    return;
  }
  const eventName = ({
    'optimizer-add': 'optimizer:candidate-add',
    'optimizer-show-backhaul': 'optimizer:candidate-show-backhaul',
  })[type];
  if (eventName) {
    document.dispatchEvent(new CustomEvent(eventName, {
      detail: { candidate },
    }));
  }
}

/** @param {string} type */
function _dispatchObstacleAction(type: string): void {
  if (type === 'obstacle-open-map') setActiveTab('map');
  else if (type === 'obstacle-edit-model') {
    setActiveTab('coverage');
    const obstacle = _selectionStore.snapshot().obstacle;
    const focusId = obstacle?.category === 'foliage'
      ? 'use-foliage'
      : 'use-buildings';
    const openParents = (el: Element | null): void => {
      let details = el?.closest('details') ?? null;
      while (details) {
        (details as HTMLDetailsElement).open = true;
        details = details.parentElement?.closest('details') ?? null;
      }
    };
    const heightMode = document.getElementById('obstacle-height-mode');
    const focusEl = document.getElementById(focusId);
    openParents(heightMode);
    openParents(focusEl);
    focusEl?.scrollIntoView?.({ block: 'center' });
    setTimeout(() => focusEl?.focus(), 0);
  }
}

function _bindInspectorActions(): void {
  if (_inspectorActionsBound) return;
  const body = document.getElementById('selection-inspector-body');
  if (!body) return;
  _inspectorActionsBound = true;
  body.addEventListener('click', (event: MouseEvent) => {
    const target = event.target instanceof Element
      ? event.target.closest('[data-inspector-tab], [data-inspector-action]') as HTMLElement | null
      : null;
    if (!target) return;
    const tab = target.dataset.inspectorTab;
    if (tab) {
      setActiveTab(tab);
      return;
    }
    const selection = _selectionStore.snapshot();
    if (target.dataset.inspectorAction === 'add-node-here' && selection.point) {
      _prefillNodeAtPoint(selection.point);
    } else if (target.dataset.inspectorAction === 'point-view-3d' && selection.point) {
      _dispatch3dFocus('map point', [selection.point]);
    } else if (target.dataset.inspectorAction === 'clear-selection') {
      updateSelectionInspector(null);
      map.closePopup?.();
    } else if (target.dataset.inspectorAction?.startsWith('node-')) {
      const nodeId = target.dataset.nodeId ?? selection.nodeId;
      if (nodeId !== null && nodeId !== undefined) _dispatchNodeAction(target.dataset.inspectorAction, nodeId);
    } else if (target.dataset.inspectorAction?.startsWith('link-')) {
      _dispatchLinkAction(target.dataset.inspectorAction);
    } else if (target.dataset.inspectorAction?.startsWith('optimizer-')) {
      _dispatchOptimizerAction(target.dataset.inspectorAction);
    } else if (target.dataset.inspectorAction?.startsWith('obstacle-')) {
      _dispatchObstacleAction(target.dataset.inspectorAction);
    }
  });
}

/** @param {{ originalEvent?: any }} event */
export function _shouldIgnoreMapClick(event: { originalEvent?: MeshcoreClickEvent }): boolean {
  if (event.originalEvent?._meshcoreHandled) return true;
  return map.getContainer().style.cursor === 'crosshair';
}

export function init(): void {
  _bindInspectorActions();
  _refreshAndDispatchSelection();
  document.addEventListener('repeaters:changed', _refreshAndDispatchSelection);
  document.addEventListener('repeater:moved', _refreshAndDispatchSelection);
  document.addEventListener('coverage:changed', _refreshAndDispatchSelection);
  document.addEventListener('p2p:changed', _refreshAndDispatchSelection);
  document.addEventListener('node:selected', (event: Event) => {
    const detail = (event as CustomEvent<{ id?: string | number | null }>).detail;
    updateNodeInspector(detail?.id ?? null);
  });
  document.addEventListener('link:selected', (event: Event) => {
    const { kind, id } = (event as CustomEvent<{ kind?: string; id?: string | number }>).detail ?? {};
    if (kind && id) updateLinkInspector(kind, id);
  });
  document.addEventListener('optimizer:candidate-selected', (event: Event) => {
    const detail = (event as CustomEvent<{ candidate?: OptimizerCandidate | null }>).detail;
    updateOptimizerCandidateInspector(detail?.candidate ?? null);
  });
  document.addEventListener('obstacle:selected', (event: Event) => {
    const detail = (event as CustomEvent<{ obstacle?: Obstacle | null }>).detail;
    updateObstacleInspector(detail?.obstacle ?? null);
  });
  document.addEventListener('optimizer:results-cleared', () => {
    if (_selectionStore.snapshot().optimizerCandidate) updateSelectionInspector(null);
  });
  map.on('click', (event: MapClickEvent) => {
    if (_shouldIgnoreMapClick(event)) return;
    updateSelectionInspector(event.latlng);
    L.popup({
      className: 'map-context-popup',
      maxWidth: 390,
      autoPanPadding: [24, 24],
    })
      .setLatLng(event.latlng)
      .setContent(_popupContent(event.latlng))
      .openOn(map);
  });
}
