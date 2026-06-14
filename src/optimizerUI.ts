/**
 * optimizerUI.ts — Draw search area, run optimizer, display results.
 * Exports: init
 */
import { map, state } from './map.js';
import {
  setProgress, hideProgress, setStatus, yieldToUI,
  setActiveTab, setButtonBusy, setInlineStatus, setCancelHandler,
} from './ui.js';
import { addRepeater, cancelPlacing } from './repeaters.js';
import { buildGrid, buildRefinedGrid, optimizerNeedsTerrain, optimizerObjectiveDetails } from './optimizer.js';
import { runOptimizerBackend } from './optimizerBackend.js';
import { fetchElevations } from './elevation.js';
import { fetchFoliage } from './foliage.js';
import { fetchBuildings } from './buildings.js';
import { fetchRoads } from './roads.js';
import type { RoadLine } from './roads.js';
import type { ObstacleSet } from './signalModel.js';
import { getOptimizerSettings } from './settings.js';
import { attachEirpHint } from './eirp.js';
import {
  optimizerCompletionMessage,
  type OptimizerStats,
} from './optimizerDiagnostics.js';
import type { OptimizerResultDetailInput } from './optimizerResultDetails.js';
import {
  optimizerCandidateItemHtml,
  optimizerCandidatePopupHtml,
  optimizerDiagnosticsItemHtml,
} from './optimizerPanelView.js';

type LatLon = {
  lat: number;
  lon: number;
};

type Bounds = {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
};

type TxParams = {
  height: number;
  power: number;
  freq: number;
  gain?: number;
};

type SourceNode = TxParams & LatLon & {
  id?: string | number;
  name?: string;
  elevM?: number;
};

type CandidateResult = OptimizerResultDetailInput & {
  rank?: number;
  txParams?: TxParams;
  backhaulPeerLat?: number;
  backhaulPeerLon?: number;
  scoreBreakdown?: OptimizerResultDetailInput['scoreBreakdown'] & { formula?: string };
};

type CandidateSelectionDetail = {
  candidate?: CandidateResult;
};

type SelectionDetail = {
  kind?: string;
  rank?: unknown;
};

type OptimizeHereDetail = {
  id?: unknown;
  lat?: number;
  lon?: number;
};

type LeafletBounds = {
  getSouth(): number;
  getNorth(): number;
  getWest(): number;
  getEast(): number;
};

type LeafletLayer = {
  addTo(target: unknown): LeafletLayer;
  bindTooltip?(content: string, options?: Record<string, unknown>): LeafletLayer;
  bringToFront?(): void;
  getBounds?(): LeafletBounds;
  setIcon?(icon: unknown): void;
  on?(type: string, handler: (event: OptimizerMarkerEvent) => void): void;
  _candidateRank?: number;
};

type OptimizerMarkerEvent = {
  originalEvent?: Event & { _meshcoreHandled?: boolean };
};

type LeafletMapClickEvent = {
  latlng: { lat: number; lng: number };
  originalEvent?: Event & { _meshcoreHandled?: boolean };
};

type OptimizerSettings = ReturnType<typeof getOptimizerSettings>;
type OptimizerOptions = OptimizerSettings['opts'] & {
  exclusionZones?: Bounds[];
  sourceNode?: SourceNode | null;
  existingNodes?: SourceNode[];
  roadLines?: RoadLine[];
  foliage?: ObstacleSet | null;
  buildings?: ObstacleSet | null;
  latMin?: number;
  latMax?: number;
  lonMin?: number;
  lonMax?: number;
};

type AbortLikeError = Error & {
  cancelled?: boolean;
};

function _input(id: string): HTMLInputElement | null {
  return document.getElementById(id) as HTMLInputElement | null;
}

function _select(id: string): HTMLSelectElement | null {
  return document.getElementById(id) as HTMLSelectElement | null;
}

function _button(id: string): HTMLButtonElement | null {
  return document.getElementById(id) as HTMLButtonElement | null;
}

function _inputValue(id: string): string {
  return _input(id)?.value ?? _select(id)?.value ?? '';
}

function _isAbort(err: unknown): boolean {
  const abortErr = err as Partial<AbortLikeError>;
  return Boolean(abortErr?.cancelled || abortErr?.name === 'AbortError');
}

function _errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Module-local interaction state
let drawing         = false;
let drawingCoverage = false;
let drawingExclusion = false;
let corner1: LatLon | null = null;
let coverageCorner1: LatLon | null = null;
let exclusionCorner1: LatLon | null = null;
let areaRect: LeafletLayer | null = null;
let coverageRect: LeafletLayer | null = null;
const exclusionRects: LeafletLayer[] = [];
let _abortController: AbortController | null = null;
const resultMarkers: LeafletLayer[] = [];
let _backhaulPreviewLayer: LeafletLayer | null = null;
let _sourceNode: SourceNode | null = null;
let _selectedCandidateRank: number | null = null;

function updateSourceStatus(): void {
  const sourceControlIds = [
    'opt-source-min-margin',
    'opt-require-source-link',
    'opt-require-source-los',
    'opt-require-source-fresnel',
  ];
  for (const id of sourceControlIds) {
    const el = _input(id);
    if (el) el.disabled = !_sourceNode;
  }
  if (!_sourceNode) {
    setInlineStatus('opt-source-status', 'Manual area search. No source node link required.', 'info');
    return;
  }
  const name = _sourceNode.name || `Node ${_sourceNode.id ?? ''}`.trim() || 'source node';
  setInlineStatus('opt-source-status', `Optimizing repeaters linked to ${name}.`, 'success');
}

function clearResults(): void {
  resultMarkers.forEach((m) => map.removeLayer(m));
  resultMarkers.length = 0;
  state.optimizerResults = [];
  _clearBackhaulPreview();
  const ul = document.getElementById('opt-results');
  if (ul) ul.innerHTML = '';
  document.dispatchEvent(new CustomEvent('optimizer:results-cleared'));
}

function _clearBackhaulPreview(): void {
  if (!_backhaulPreviewLayer) return;
  map.removeLayer(_backhaulPreviewLayer);
  _backhaulPreviewLayer = null;
}

function _showBackhaulPreview(candidate: CandidateResult): boolean {
  if (!Number.isFinite(candidate?.lat) || !Number.isFinite(candidate?.lon)) return false;
  if (!Number.isFinite(candidate?.backhaulPeerLat) || !Number.isFinite(candidate?.backhaulPeerLon)) return false;
  _clearBackhaulPreview();
  const margin = Number(candidate.backhaulMarginDb);
  const healthy = Number.isFinite(margin) && margin >= 10 && candidate.backhaulLos !== false;
  const color = healthy ? '#38bdf8' : '#facc15';
  const marginText = Number.isFinite(margin) ? `${margin.toFixed(1)} dB` : 'pending';
  const peerName = String(candidate.backhaulPeerName ?? 'backhaul peer');
  const previewLayer = L.polyline([
    [candidate.lat, candidate.lon],
    [candidate.backhaulPeerLat, candidate.backhaulPeerLon],
  ], {
    color,
    weight: 4,
    opacity: 0.95,
    dashArray: '8 5',
    className: 'optimizer-backhaul-preview map-object-selected',
  }).addTo(map).bindTooltip(`Backhaul to ${escapeHtml(peerName)}: ${escapeHtml(marginText)}`, {
    permanent: true,
    direction: 'center',
    className: 'path-line-label',
  }) as LeafletLayer;
  _backhaulPreviewLayer = previewLayer;
  previewLayer.bringToFront?.();
  return true;
}

function _syncCandidateSelectionHighlight(): void {
  resultMarkers.forEach((marker) => {
    if (!marker._candidateRank) return;
    const selected = _selectedCandidateRank !== null && marker._candidateRank === _selectedCandidateRank;
    marker.setIcon?.(makeSuggestedIcon(marker._candidateRank, selected));
  });
  document.querySelectorAll<HTMLElement>('#opt-results .opt-result-item[data-candidate-rank]').forEach((item) => {
    const rank = Number(item.dataset.candidateRank);
    item.classList.toggle('ori-selected', _selectedCandidateRank !== null && rank === _selectedCandidateRank);
  });
}

function updateExclusionStatus(): void {
  const count = exclusionRects.length;
  setInlineStatus(
    'opt-exclusion-status',
    count ? `${count} exclusion zone${count === 1 ? '' : 's'} active.` : 'No exclusion zones drawn.',
    count ? 'warning' : 'info'
  );
}

function clearArea(): void {
  if (areaRect)    { map.removeLayer(areaRect);    areaRect    = null; }
  if (coverageRect){ map.removeLayer(coverageRect); coverageRect = null; }
  exclusionRects.forEach(rect => map.removeLayer(rect));
  exclusionRects.length = 0;
  corner1 = null;
  coverageCorner1 = null;
  exclusionCorner1 = null;
  drawing = false;
  drawingCoverage = false;
  drawingExclusion = false;
  _sourceNode = null;
  document.getElementById('draw-hint')?.classList.add('hidden');
  document.getElementById('draw-coverage-hint')?.classList.add('hidden');
  document.getElementById('draw-exclusion-hint')?.classList.add('hidden');
  const btn = _button('btn-optimize');
  if (btn) btn.disabled = true;
  setInlineStatus('opt-status', 'Draw a search area to enable the optimizer.', 'info');
  updateExclusionStatus();
  updateSourceStatus();
  map.getContainer().style.cursor = '';
  clearResults();
}

/**
 * @param {number} rank
 * @param {boolean} [selected]
 */
function makeSuggestedIcon(rank: number, selected = false): unknown {
  const stroke = selected ? '#facc15' : '#fff';
  const strokeWidth = selected ? 4 : 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="14" fill="#facc15" stroke="${stroke}" stroke-width="${strokeWidth}"/>
    <text x="16" y="21" text-anchor="middle" font-size="14" font-weight="bold" fill="#0f1117">${rank}</text>
  </svg>`;
  return L.divIcon({ html: svg, iconSize: [32, 32], iconAnchor: [16, 16], className: '' });
}

/**
 * @param {Array<{ lat: number, lon: number, score: number, elevM: number, coverageRatio?: number, redundancyRatio?: number, avgMarginDb?: number, losRatio?: number, fresnelRatio?: number, backhaulMarginDb?: number, backhaulRxPowerDbm?: number, backhaulDistanceM?: number, backhaulLos?: boolean, backhaulFresnelClear?: boolean, backhaulPeerName?: string, backhaulPeerLat?: number, backhaulPeerLon?: number, scoreBreakdown?: any }>} results
 * @param {{ height: number, power: number, freq: number, gain?: number }} txParams
 */
function renderResults(results: CandidateResult[], txParams: TxParams): void {
  const ul = document.getElementById('opt-results');
  if (!ul) return;
  const candidates = results.map((r, i) => ({
      ...r,
      rank: i + 1,
      txParams: { ...txParams },
    }));
  state.optimizerResults = candidates;
  candidates.forEach((candidate, i) => {
    const r = candidate;
    const rank = candidate.rank ?? i + 1;
    const marker = L.marker([r.lat, r.lon], { icon: makeSuggestedIcon(rank, _selectedCandidateRank === rank), zIndexOffset: 500 })
      .addTo(map)
      .bindPopup(optimizerCandidatePopupHtml(r, rank));
    const optimizerMarker = marker as LeafletLayer;
    optimizerMarker._candidateRank = rank;
    optimizerMarker.on?.('click', (event) => {
      if (event.originalEvent) event.originalEvent._meshcoreHandled = true;
      document.dispatchEvent(new CustomEvent('optimizer:candidate-selected', {
        detail: { candidate },
      }));
    });
    resultMarkers.push(optimizerMarker);
    if (Number.isFinite(r.backhaulPeerLat) && Number.isFinite(r.backhaulPeerLon)) {
      const color = (r.backhaulMarginDb ?? 0) >= 10 && r.backhaulLos !== false ? '#22c55e' : '#facc15';
      const line = L.polyline([[r.lat, r.lon], [r.backhaulPeerLat, r.backhaulPeerLon]], {
        color,
        weight: 2,
        opacity: 0.75,
        dashArray: '6 6',
      }).addTo(map);
      resultMarkers.push(line as LeafletLayer);
    }

    const li = document.createElement('li');
    li.className = `opt-result-item${_selectedCandidateRank === rank ? ' ori-selected' : ''}`;
    li.dataset.candidateRank = String(rank);
    li.innerHTML = optimizerCandidateItemHtml(r, rank);
    li.querySelector('.ori-add')?.addEventListener('click', () => {
      addRepeater(`Suggested ${rank}`, r.lat, r.lon, txParams.height, txParams.power, txParams.freq, txParams.gain);
    });
    li.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('.ori-add')) return;
      document.dispatchEvent(new CustomEvent('optimizer:candidate-selected', {
        detail: { candidate },
      }));
    });
    ul.appendChild(li);
  });
  _syncCandidateSelectionHighlight();
}

/**
 * @param {number} resultCount
 * @param {Record<string, any> | undefined} stats
 */
function renderResultDiagnostics(resultCount: number, stats: OptimizerStats | undefined): void {
  const ul = document.getElementById('opt-results');
  if (!ul) return;
  const html = optimizerDiagnosticsItemHtml(resultCount, stats);
  if (!html) return;
  const li = document.createElement('li');
  li.className = 'opt-result-item opt-result-diagnostics';
  li.innerHTML = html;
  ul.appendChild(li);
}

function updateObjectiveNote(): void {
  const note = document.getElementById('opt-objective-note');
  const select = _select('opt-objective');
  if (!note || !select) return;
  note.textContent = optimizerObjectiveDetails(select.value).formula;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch] || ch));
}

/**
 * @param {string} id
 * @param {number} value
 */
function setInputValue(id: string, value: number): void {
  const el = _input(id);
  if (el && Number.isFinite(value)) el.value = String(value);
}

function repeaterToPlanningNode(r: Partial<SourceNode>): SourceNode {
  return {
    id: r.id,
    name: r.name,
    lat: Number(r.lat),
    lon: Number(r.lon),
    height: Number(r.height),
    power: Number(r.power),
    freq: Number(r.freq),
    gain: r.gain,
  };
}

/**
 * @param {number} evalCount
 * @param {number} candidateCount
 * @param {number} nRepeaters
 * @param {number} existingCount
 */
function updateEstimate(evalCount: number, candidateCount: number, nRepeaters: number, existingCount: number): void {
  const cells = evalCount * candidateCount * Math.max(1, nRepeaters);
  const prefix = `Scoring ${candidateCount} candidates x ${evalCount} cells`;
  const mesh = existingCount > 0 ? `, ${existingCount} visible mesh node${existingCount !== 1 ? 's' : ''}` : '';
  const msg = `${prefix}${mesh}.`;
  const kind = cells > 15_000_000 ? 'warning' : 'info';
  setInlineStatus('opt-estimate', cells > 15_000_000 ? `${msg} This may take a while on CPU.` : msg, kind);
}

/**
 * @param {number} nRepeaters
 * @param {{ name?: string } | null} sourceNode
 */
function _optimizerJobTitle(nRepeaters: number, sourceNode: SourceNode | null): string {
  const count = `${nRepeaters} repeater${nRepeaters === 1 ? '' : 's'}`;
  return sourceNode ? `Source-linked optimizer: ${count}` : `Optimizer: ${count}`;
}

/** @param {string} preference */
function _backendPreferenceLabel(preference: string): string {
  if (preference === 'cuda') return 'Python CUDA';
  if (preference === 'cpu') return 'CPU worker';
  return 'Auto backend';
}

export function init(): void {
  updateSourceStatus();
  updateExclusionStatus();
  updateObjectiveNote();
  document.addEventListener('selection:changed', (event: Event) => {
    const detail = (event as CustomEvent<SelectionDetail>).detail;
    _selectedCandidateRank = detail?.kind === 'optimizer-candidate'
      ? Number(detail.rank)
      : null;
    if (!Number.isFinite(_selectedCandidateRank)) _selectedCandidateRank = null;
    _syncCandidateSelectionHighlight();
  });
  document.getElementById('opt-objective')?.addEventListener('change', updateObjectiveNote);
  const updateEirpHint = attachEirpHint({ powerId: 'opt-power', gainId: 'opt-gain', freqId: 'opt-freq', hintId: 'opt-eirp-hint' });
  document.getElementById('btn-copy-to-opt')?.addEventListener('click', () => {
    const heightInput = _input('opt-height');
    if (_sourceNode) {
      if (heightInput) heightInput.value = String(_sourceNode.height);
      setInputValue('opt-power', _sourceNode.power);
      setInputValue('opt-freq', _sourceNode.freq);
      setInputValue('opt-gain', _sourceNode.gain ?? 0);
      setInlineStatus('opt-status', 'Copied source node radio into optimizer inputs.', 'success');
      updateEirpHint();
      return;
    }
    const src = _input('repeater-height');
    if (heightInput && src) heightInput.value = src.value;
    const power = _input('repeater-power');
    const freq = _input('repeater-freq');
    const gain = _input('repeater-gain');
    if (power) setInputValue('opt-power', parseFloat(power.value));
    if (freq) setInputValue('opt-freq', parseFloat(freq.value));
    if (gain) setInputValue('opt-gain', parseFloat(gain.value));
    updateEirpHint();
  });

  document.getElementById('btn-draw-area')?.addEventListener('click', () => {
    if (drawing || drawingCoverage || drawingExclusion) return;
    drawing = true;
    corner1 = null;
    _sourceNode = null;
    updateSourceStatus();
    cancelPlacing();
    document.getElementById('draw-hint')?.classList.remove('hidden');
    document.getElementById('draw-coverage-hint')?.classList.add('hidden');
    document.getElementById('draw-exclusion-hint')?.classList.add('hidden');
    setInlineStatus('opt-status', 'Draw mode active. Click two opposite corners of the search area.', 'warning');
    map.getContainer().style.cursor = 'crosshair';
  });

  document.getElementById('btn-draw-coverage-area')?.addEventListener('click', () => {
    if (drawing || drawingCoverage || drawingExclusion) return;
    drawingCoverage = true;
    coverageCorner1 = null;
    cancelPlacing();
    document.getElementById('draw-coverage-hint')?.classList.remove('hidden');
    document.getElementById('draw-hint')?.classList.add('hidden');
    document.getElementById('draw-exclusion-hint')?.classList.add('hidden');
    setInlineStatus('opt-status', 'Draw coverage area. Click two opposite corners of the area to optimise coverage within.', 'warning');
    map.getContainer().style.cursor = 'crosshair';
  });

  document.getElementById('btn-draw-exclusion-zone')?.addEventListener('click', () => {
    if (drawing || drawingCoverage || drawingExclusion) return;
    drawingExclusion = true;
    exclusionCorner1 = null;
    cancelPlacing();
    document.getElementById('draw-exclusion-hint')?.classList.remove('hidden');
    document.getElementById('draw-hint')?.classList.add('hidden');
    document.getElementById('draw-coverage-hint')?.classList.add('hidden');
    setInlineStatus('opt-status', 'Draw exclusion zone. Click two opposite corners of the area to avoid.', 'warning');
    map.getContainer().style.cursor = 'crosshair';
  });

  document.getElementById('btn-clear-area')?.addEventListener('click', clearArea);

  // Context-menu "Optimize Here" shortcut: build a search area around a specific repeater
  document.addEventListener('map:optimize-here', (event: Event) => {
    const { id, lat, lon } = (event as CustomEvent<OptimizeHereDetail>).detail ?? {};
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const rep = state.repeaters.find((r) => r.id === id);
    _sourceNode = rep ? {
      id: rep.id,
      name: rep.name,
      lat: rep.lat,
      lon: rep.lon,
      height: rep.height,
      power: rep.power,
      freq: rep.freq,
      gain: rep.gain,
    } : null;
    const radiusKm = parseFloat(_inputValue('analysis-radius')) || 15;
    const centerLat = Number(lat);
    const centerLon = Number(lon);
    const dLat = radiusKm / 110.574;
    const dLon = radiusKm / (111.320 * Math.cos(centerLat * Math.PI / 180));
    const bounds = [[centerLat - dLat, centerLon - dLon], [centerLat + dLat, centerLon + dLon]];
    if (areaRect) map.removeLayer(areaRect);
    areaRect = L.rectangle(bounds, { className: 'search-area-rect' }).addTo(map);
    if (coverageRect) { map.removeLayer(coverageRect); coverageRect = null; }
    corner1 = null;
    coverageCorner1 = null;
    exclusionCorner1 = null;
    drawing = false;
    drawingCoverage = false;
    drawingExclusion = false;
    document.getElementById('draw-hint')?.classList.add('hidden');
    document.getElementById('draw-coverage-hint')?.classList.add('hidden');
    document.getElementById('draw-exclusion-hint')?.classList.add('hidden');
    const optBtn = _button('btn-optimize');
    if (optBtn) optBtn.disabled = false;
    setInlineStatus('opt-status', _sourceNode ? 'Source-linked search area ready.' : 'Search area ready.', 'success');
    updateSourceStatus();
    clearResults();
    map.fitBounds(bounds, { padding: [40, 40] });
    setActiveTab('planning');
  });

  document.addEventListener('optimizer:candidate-add', (event: Event) => {
    const candidate = (event as CustomEvent<CandidateSelectionDetail>).detail?.candidate;
    if (!candidate || !Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lon)) return;
    const tx: Partial<TxParams> = candidate.txParams ?? {};
    const finiteOr = (value: unknown, fallback: number): number => {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    };
    const inputValue = (id: string): string => _inputValue(id);
    addRepeater(
      `Suggested ${candidate.rank ?? state.nextId}`,
      candidate.lat,
      candidate.lon,
      finiteOr(tx.height, finiteOr(inputValue('opt-height'), 10)),
      finiteOr(tx.power, finiteOr(inputValue('opt-power'), 20)),
      finiteOr(tx.freq, finiteOr(inputValue('opt-freq'), 869.525)),
      finiteOr(tx.gain, finiteOr(inputValue('opt-gain'), 2))
    );
    setStatus(`Added Suggested ${candidate.rank ?? ''}.`.trim());
  });

  document.addEventListener('optimizer:candidate-show-backhaul', (event: Event) => {
    const candidate = (event as CustomEvent<CandidateSelectionDetail>).detail?.candidate;
    if (!candidate) return;
    if (!_showBackhaulPreview(candidate)) return;
    map.fitBounds([[candidate.lat, candidate.lon], [candidate.backhaulPeerLat, candidate.backhaulPeerLon]], { padding: [50, 50] });
    setActiveTab('planning');
    setInlineStatus('opt-status', `Backhaul shown for Suggested ${candidate.rank ?? 'candidate'}.`, 'info');
  });

  map.on('click', (e: LeafletMapClickEvent) => {
    if (!drawing && !drawingCoverage && !drawingExclusion) return;
    if (e.originalEvent) e.originalEvent._meshcoreHandled = true;
    cancelPlacing();

    if (drawingExclusion) {
      const drawHint = document.getElementById('draw-exclusion-hint');
      if (!exclusionCorner1) {
        exclusionCorner1 = { lat: e.latlng.lat, lon: e.latlng.lng };
        if (drawHint) drawHint.textContent = 'Now click the opposite corner of the exclusion zone.';
        return;
      }
      const c2 = { lat: e.latlng.lat, lon: e.latlng.lng };
      const exBounds = [
        [Math.min(exclusionCorner1.lat, c2.lat), Math.min(exclusionCorner1.lon, c2.lon)],
        [Math.max(exclusionCorner1.lat, c2.lat), Math.max(exclusionCorner1.lon, c2.lon)],
      ];
      const rect = L.rectangle(exBounds, { className: 'exclusion-area-rect' }).addTo(map);
      exclusionRects.push(rect);
      drawingExclusion = false;
      exclusionCorner1 = null;
      drawHint?.classList.add('hidden');
      if (drawHint) drawHint.textContent = 'Click two opposite corners of the exclusion zone. Candidates inside exclusion zones are ignored.';
      updateExclusionStatus();
      const msg = areaRect ? 'Exclusion zone added. Search area ready.' : 'Exclusion zone added. Draw a search area to enable the optimizer.';
      setInlineStatus('opt-status', msg, areaRect ? 'success' : 'info');
      map.getContainer().style.cursor = '';
      clearResults();
      return;
    }

    if (drawingCoverage) {
      const drawHint = document.getElementById('draw-coverage-hint');
      if (!coverageCorner1) {
        coverageCorner1 = { lat: e.latlng.lat, lon: e.latlng.lng };
        if (drawHint) drawHint.textContent = 'Now click the opposite corner of the coverage area.';
        return;
      }
      const c2 = { lat: e.latlng.lat, lon: e.latlng.lng };
      const covBounds = [
        [Math.min(coverageCorner1.lat, c2.lat), Math.min(coverageCorner1.lon, c2.lon)],
        [Math.max(coverageCorner1.lat, c2.lat), Math.max(coverageCorner1.lon, c2.lon)],
      ];
      if (coverageRect) map.removeLayer(coverageRect);
      coverageRect = L.rectangle(covBounds, { className: 'coverage-area-rect' }).addTo(map);
      drawingCoverage = false;
      drawHint?.classList.add('hidden');
      if (drawHint) drawHint.textContent = 'Click two opposite corners of the coverage area on the map.';
      const hasBoth = Boolean(areaRect);
      if (hasBoth) setInlineStatus('opt-status', 'Search area + coverage area ready.', 'success');
      else setInlineStatus('opt-status', 'Coverage area set. Draw a search area to enable the optimizer.', 'info');
      map.getContainer().style.cursor = '';
      clearResults();
      return;
    }

    const drawHint = document.getElementById('draw-hint');

    if (!corner1) {
      corner1 = { lat: e.latlng.lat, lon: e.latlng.lng };
      if (drawHint) drawHint.textContent = 'Now click the opposite corner.';
      return;
    }

    const c2 = { lat: e.latlng.lat, lon: e.latlng.lng };
    const bounds = [
      [Math.min(corner1.lat, c2.lat), Math.min(corner1.lon, c2.lon)],
      [Math.max(corner1.lat, c2.lat), Math.max(corner1.lon, c2.lon)],
    ];

    if (areaRect) map.removeLayer(areaRect);
    areaRect = L.rectangle(bounds, { className: 'search-area-rect' }).addTo(map);

    drawing = false;
    drawHint?.classList.add('hidden');
    if (drawHint) drawHint.textContent = 'Click two opposite corners of the search area on the map.';
    const optBtn = _button('btn-optimize');
    if (optBtn) optBtn.disabled = false;
    const msg = coverageRect ? 'Search area + coverage area ready.' : 'Search area ready.';
    setInlineStatus('opt-status', msg, 'success');
    map.getContainer().style.cursor = '';
    clearResults();
  });

  document.getElementById('btn-optimize')?.addEventListener('click', async () => {
    if (!areaRect) return;

    const b = areaRect.getBounds?.();
    if (!b) return;
    const searchBounds = {
      latMin: b.getSouth(), latMax: b.getNorth(),
      lonMin: b.getWest(),  lonMax: b.getEast(),
    };

    // Coverage area defines where eval points are sampled.
    // Falls back to the search area when not drawn.
    const cb = coverageRect?.getBounds?.();
    const evalBounds = cb ? {
      latMin: cb.getSouth(), latMax: cb.getNorth(),
      lonMin: cb.getWest(),  lonMax: cb.getEast(),
    } : searchBounds;
    const exclusionZones = exclusionRects.map(rect => {
      const eb = rect.getBounds?.();
      if (!eb) return null;
      return {
        latMin: eb.getSouth(), latMax: eb.getNorth(),
        lonMin: eb.getWest(),  lonMax: eb.getEast(),
      };
    }).filter((zone): zone is Bounds => zone !== null);

    // Keep a single `bounds` alias for the search area (used for candidates, status, etc.).
    const bounds = searchBounds;

    if (bounds.latMax - bounds.latMin < 0.001 || bounds.lonMax - bounds.lonMin < 0.001) {
      setStatus('Search area is too small. Draw a larger rectangle.');
      setInlineStatus('opt-status', 'Search area is too small.', 'error');
      return;
    }

    if (evalBounds.latMax - evalBounds.latMin < 0.001 || evalBounds.lonMax - evalBounds.lonMin < 0.001) {
      setStatus('Coverage area is too small. Draw a larger coverage rectangle.');
      setInlineStatus('opt-status', 'Coverage area is too small.', 'error');
      return;
    }

    const { txParams, opts: optsBase, nRepeaters } = getOptimizerSettings();
    const opts: OptimizerOptions = { ...optsBase };
    const needsVisibleMeshContext = opts.gapAware || Number.isFinite(opts.minRedundancyRatio);
    const existingBaseNodes = needsVisibleMeshContext
      ? state.repeaters
          .filter((/** @type {any} */ r) => r.visible)
          .map(repeaterToPlanningNode)
      : [];
    const startTime = performance.now();
    const step = (msg: string): void => {
      const elapsed = (performance.now() - startTime).toFixed(1);
      console.info(`[optimizer] [${elapsed}ms] ${msg}`);
    };
    step('Settings: ' + JSON.stringify({
      nRepeaters,
      txHeight: txParams.height,
      txPower: txParams.power,
      txFreq: txParams.freq,
      txGain: txParams.gain,
      rxHeight: opts.rxHeight,
      rxSens: opts.rxSens,
      fadeMargin: opts.fadeMargin,
      radiusKm: opts.radiusKm,
      candidateRes: opts.candidateRes,
      evalRes: opts.evalRes,
      useLos: opts.useLos,
      useFresnel: opts.useFresnel,
      useFoliage: opts.useFoliage,
      useBuildings: opts.useBuildings,
      sourceNode: _sourceNode?.name ?? null,
      requireSourceLink: opts.requireSourceLink,
      requireSourceLos: opts.requireSourceLos,
      requireSourceFresnel: opts.requireSourceFresnel,
      sourceMinMarginDb: opts.sourceMinMarginDb,
      objective: opts.objective,
      targetCoverageRatio: opts.targetCoverageRatio,
      gapAware: opts.gapAware,
      minRedundancyRatio: opts.minRedundancyRatio,
      preferRoadAdjacent: opts.preferRoadAdjacent,
      existingNodes: existingBaseNodes.length,
      exclusionZones: exclusionZones.length,
    }));
    opts.exclusionZones = exclusionZones;

    clearResults();
    setButtonBusy('btn-optimize', true, 'Scoring...');
    const cancelBtn = _button('btn-cancel-optimize');
    if (cancelBtn) cancelBtn.disabled = false;
    setInlineStatus('opt-status', 'Scoring candidate locations...', 'info');
    _abortController = new AbortController();
    setCancelHandler(() => _abortController?.abort());
    const backendPreference = _select('compute-backend')?.value || 'auto';
    let jobWarningCount = 0;
    const jobMeta = {
      title: _optimizerJobTitle(nRepeaters, _sourceNode),
      backend: _backendPreferenceLabel(backendPreference),
    };
    const progress = (pct: number, msg: string): void => setProgress(pct, msg, {
      ...jobMeta,
      warningCount: jobWarningCount,
    });

    try {
      step('Building evaluation and candidate grids...');
      progress(2, 'Building evaluation grid...');
      // evalPoints are sampled from the coverage area (or search area if not set)
      const evalPoints = buildGrid(evalBounds.latMin, evalBounds.latMax, evalBounds.lonMin, evalBounds.lonMax, opts.evalRes);
      const candidates = opts.refineCandidates
        ? buildRefinedGrid(bounds.latMin, bounds.latMax, bounds.lonMin, bounds.lonMax, opts.candidateRes)
        : buildGrid(bounds.latMin, bounds.latMax, bounds.lonMin, bounds.lonMax, opts.candidateRes);
      step(`Grid sizes: eval=${evalPoints.length}, candidates=${candidates.length}`);
      updateEstimate(evalPoints.length, candidates.length, nRepeaters, existingBaseNodes.length);

      step('Fetching elevation for optimizer points...');
      const sourcePoint = _sourceNode ? { latitude: _sourceNode.lat, longitude: _sourceNode.lon } : null;
      const existingPoints = existingBaseNodes.map(n => ({ latitude: n.lat, longitude: n.lon }));
      const allPoints = [
        ...evalPoints,
        ...candidates,
        ...(sourcePoint ? [sourcePoint] : []),
        ...existingPoints,
      ];
      progress(5, `Fetching elevation for ${allPoints.length} points...`);
      const terrainOpts = _sourceNode ? { ...opts, sourceNode: _sourceNode } : opts;
      const allElevs  = optimizerNeedsTerrain(terrainOpts)
        ? await fetchElevations(allPoints, null, { signal: _abortController.signal })
        : allPoints.map(() => 0);
      const evalElevs      = allElevs.slice(0, evalPoints.length);
      const candidateElevs = allElevs.slice(evalPoints.length, evalPoints.length + candidates.length);
      const sourceElevIdx = evalPoints.length + candidates.length;
      const existingElevStart = sourceElevIdx + (sourcePoint ? 1 : 0);
      const sourceElev = sourcePoint ? allElevs[sourceElevIdx] : null;
      opts.sourceNode = _sourceNode ? { ..._sourceNode, elevM: sourceElev ?? 0 } : null;
      opts.existingNodes = existingBaseNodes.map((node, idx) => ({
        ...node,
        elevM: allElevs[existingElevStart + idx] ?? 0,
      }));
      step('Elevation fetch complete');

      if (opts.preferRoadAdjacent) {
        step('Fetching road access data...');
        progress(10, 'Fetching road access data...');
        const roads = await fetchRoads(bounds.latMin, bounds.latMax, bounds.lonMin, bounds.lonMax, {
          signal: _abortController.signal,
        }).catch((e: unknown) => {
          if (_isAbort(e)) throw e;
          console.warn('[optimizer] road fetch failed, skipping road-adjacent preference:', e);
          return null;
        });
        opts.roadLines = roads?.lines ?? [];
        if (!opts.roadLines.length) {
          jobWarningCount += 1;
          setInlineStatus('opt-status', 'Road-adjacent preference requested but road data was unavailable.', 'warning');
        }
        step(`Road access data ready: ${opts.roadLines.length} line(s)`);
      }

      const needsFacadeBuildings = opts.useLos && opts.useGroundReflection && opts.reflectionModel === 'facade';
      const needsBuildings = opts.useBuildings || needsFacadeBuildings;
      if (opts.useFoliage || needsBuildings) {
        step('Fetching obstacle layers...');
        progress(12, 'Fetching obstacle layers...');
        const [foliage, buildings] = await Promise.all([
          opts.useFoliage
            ? fetchFoliage(bounds.latMin, bounds.latMax, bounds.lonMin, bounds.lonMax, {
                signal: _abortController.signal,
                deriveObstacleHeights: opts.deriveObstacleHeights,
              })
                .catch((e: unknown) => {
                  if (_isAbort(e)) throw e;
                  console.warn('[optimizer] foliage fetch failed, skipping:', e);
                  return null;
                })
            : Promise.resolve(null),
          needsBuildings
            ? fetchBuildings(bounds.latMin, bounds.latMax, bounds.lonMin, bounds.lonMax, {
                signal: _abortController.signal,
                deriveObstacleHeights: opts.deriveObstacleHeights,
              })
                .catch((e: unknown) => {
                  if (_isAbort(e)) throw e;
                  console.warn('[optimizer] buildings fetch failed, skipping:', e);
                  return null;
                })
            : Promise.resolve(null),
        ]);
        opts.foliage = foliage;
        opts.buildings = buildings;
        if (opts.useFoliage && !foliage) {
          jobWarningCount += 1;
          setInlineStatus('opt-status', 'Foliage loss requested but vegetation data was unavailable.', 'warning');
        }
        if (needsBuildings && !buildings) {
          jobWarningCount += 1;
          setInlineStatus('opt-status', 'Structure data requested but building geometry was unavailable.', 'warning');
        }
        step(`Obstacle layers ready: foliage=${foliage ? 'yes' : 'no'}, buildings=${buildings ? 'yes' : 'no'}`);
      }

      step('Running optimizer backend...');
      progress(20, 'Scoring candidate locations...');

      const optimizerData = {
        evalPoints,
        evalElevs,
        candidates,
        candidateElevs,
        nRepeaters,
        txParams,
        opts: {
          ...opts,
          // Use evalBounds so the terrain elevation grid matches the eval point layout.
          // Profile lookups for TX locations outside evalBounds will be clamped to the
          // nearest edge elevation — acceptable when search & coverage areas are nearby.
          latMin: evalBounds.latMin,
          latMax: evalBounds.latMax,
          lonMin: evalBounds.lonMin,
          lonMax: evalBounds.lonMax,
        },
      };
      const { results, backend, stats } = await runOptimizerBackend(optimizerData, {
        backendPreference,
        onProgress: (pct, msg) => progress(pct, msg),
        signal: _abortController.signal,
      });

      jobMeta.backend = backend === 'cuda' ? 'Python CUDA' : 'CPU worker';
      progress(100, 'Optimization complete.');
      await yieldToUI();
      hideProgress();
      renderResults(results, txParams);
      const backendLabel = backend === 'cuda' ? 'Python CUDA' : 'CPU worker';
      renderResultDiagnostics(results.length, stats);
      step(`Optimization complete via ${backendLabel}, results=${results.length}, total=${(performance.now() - startTime).toFixed(1)}ms`);
      const completion = optimizerCompletionMessage(results.length, stats, backendLabel);
      setStatus(completion.text);
      setInlineStatus('opt-status', completion.text, completion.kind);
    } catch (rawErr) {
      hideProgress();
      if (_isAbort(rawErr)) {
        setStatus('Optimizer cancelled.');
        setInlineStatus('opt-status', 'Optimizer cancelled.', 'warning');
      } else {
        setStatus(`Optimizer error: ${_errorMessage(rawErr)}`);
        setInlineStatus('opt-status', `Optimizer error: ${_errorMessage(rawErr)}`, 'error');
        console.error(rawErr);
      }
    } finally {
      _abortController = null;
      setCancelHandler(null);
      setButtonBusy('btn-optimize', false);
      const btn = _button('btn-cancel-optimize');
      if (btn) btn.disabled = true;
    }
  });

  document.getElementById('btn-cancel-optimize')?.addEventListener('click', () => _abortController?.abort());
}
