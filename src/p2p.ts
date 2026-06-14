/**
 * p2p.js - Point-to-point picking UI.
 * Link-budget math, terrain profile rendering, and pathfinder UI live in
 * dedicated modules.
 */
import { map, state } from './map.js';
import type { P2PEndpoint, P2PSettings } from './linkBudget.js';
import { calculateLinkBudget } from './linkBudget.js';
import { initPathfinderUI } from './pathfinderUI.js';
import { haversine } from './propagation.js';
import { getP2PSettings } from './settings.js';
import { escHtml, setActiveTab, setButtonBusy } from './ui.js';
import { attachEirpHint } from './eirp.js';
import {
  formatP2PNumber,
  p2pResultStatusMessage,
  renderP2PResultPanelHtml,
} from './p2pResultView.js';

type LinkBudgetResult = Awaited<ReturnType<typeof calculateLinkBudget>> & {
  _settings?: P2PSettings;
};

type AbortLikeError = Error & {
  cancelled?: boolean;
};

type RepeaterLike = {
  id: number | string;
  name: string;
  lat: number;
  lon: number;
  height: number;
  power: number;
  freq: number;
  gain: number;
  pattern?: string;
  azimuthDeg?: number;
};

type P2PLinkState = {
  id: 'active-p2p';
  kind: 'p2p';
  label: string;
  pointA: { lat: number; lon: number };
  pointB: { lat: number; lon: number };
  endpointARepeaterId: number | string | null;
  endpointBRepeaterId: number | string | null;
  endpointAName: string;
  endpointBName: string;
  margin: number | null;
  rxPower: number | null;
  distM: number;
  pathLoss: number | null;
  totalPathLoss: number | null;
  diffractionLoss: number | null;
  foliageLoss: number | null;
  buildingLoss: number | null;
  geometricLos: boolean | null;
  fresnelClear: boolean | null;
  sampleCount: number | null;
  color: string;
};

type LeafletMarker = Record<string, any> & {
  addTo(target: unknown): LeafletMarker;
  bindTooltip(html: string, options?: Record<string, unknown>): LeafletMarker;
  on(event: string, handler: (event: any) => void): LeafletMarker;
  getLatLng(): P2PEndpoint;
  setLatLng(latlng: P2PEndpoint): void;
};

type LeafletPolyline = Record<string, any> & {
  addTo(target: unknown): LeafletPolyline;
  setLatLngs(latlngs: P2PEndpoint[]): void;
  setStyle?(style: Record<string, unknown>): void;
  getElement?(): Element | null;
  bringToFront?(): void;
  getTooltip?(): unknown;
  setTooltipContent?(html: string): void;
  bindTooltip?(html: string, options?: Record<string, unknown>): void;
  on(event: string, handler: (event: any) => void): LeafletPolyline;
  off?(event: string, handler: (event: any) => void): LeafletPolyline;
};

type MeshcoreMouseEvent = MouseEvent & {
  _meshcoreHandled?: boolean;
};

type LeafletClickEvent = {
  latlng: P2PEndpoint;
  originalEvent?: MeshcoreMouseEvent;
};

function _el<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

let picking = false;
let pointA: P2PEndpoint | null = null;
let pointB: P2PEndpoint | null = null;
let markers: LeafletMarker[] = [];
let markerA: LeafletMarker | null = null;
let markerB: LeafletMarker | null = null;
let polyline: LeafletPolyline | null = null;
let _abortController: AbortController | null = null;
let _recalcTimer: ReturnType<typeof setTimeout> | null = null;
let _endpointARepeaterId: number | string | null = null;
let _endpointBRepeaterId: number | string | null = null;
let _activeP2PSelected = false;
let _lastP2PResult: LinkBudgetResult | null = null;

function _dispatchP2PChanged(): void {
  document.dispatchEvent(new CustomEvent('p2p:changed'));
}

function _pointToLatLon(point: unknown): { lat: number; lon: number } | null {
  if (!point) return null;
  const raw = point as { lat?: unknown; lng?: unknown; lon?: unknown };
  const lat = Number(raw.lat);
  const lon = Number(raw.lng ?? raw.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function _linkColorFromMargin(margin: number): string {
  if (!Number.isFinite(margin)) return '#facc15';
  if (margin >= 10) return '#4ade80';
  if (margin >= 0) return '#facc15';
  return '#fc8181';
}

function _syncP2PSelectionHighlight(): void {
  if (!polyline) return;
  polyline.setStyle?.({
    weight: _activeP2PSelected ? 6 : 3,
    opacity: _activeP2PSelected ? 1 : 0.95,
  });
  polyline.getElement?.()?.classList.toggle('map-object-selected', _activeP2PSelected);
  if (_activeP2PSelected) polyline.bringToFront?.();
}

/** @param {number | string | null | undefined} id */
function _repeaterName(id: number | string | null | undefined): string | null {
  const rep = state.repeaters.find((/** @type {any} */ r) => String(r.id) === String(id));
  return rep?.name ?? null;
}

function _selectActiveP2PLink(event: LeafletClickEvent | null = null): void {
  if (event?.originalEvent) event.originalEvent._meshcoreHandled = true;
  document.dispatchEvent(new CustomEvent('link:selected', {
    detail: { kind: 'p2p', id: 'active-p2p' },
  }));
}

function _syncP2PLinkState(result: LinkBudgetResult | null = null): void {
  const a = _pointToLatLon(pointA);
  const b = _pointToLatLon(pointB);
  if (!a || !b) {
    state.p2pLinks = [];
    _dispatchP2PChanged();
    return;
  }

  const margin = Number(result?.margin);
  const rxPower = Number(result?.rxPower);
  const distM = result && Number.isFinite(result.distM)
    ? result.distM
    : haversine(a.lat, a.lon, b.lat, b.lon);
  state.p2pLinks = [{
    id: 'active-p2p',
    kind: 'p2p',
    label: 'P2P Link',
    pointA: a,
    pointB: b,
    endpointARepeaterId: _endpointARepeaterId,
    endpointBRepeaterId: _endpointBRepeaterId,
    endpointAName: _repeaterName(_endpointARepeaterId) ?? 'Point A',
    endpointBName: _repeaterName(_endpointBRepeaterId) ?? 'Point B',
    margin: Number.isFinite(margin) ? margin : null,
    rxPower: Number.isFinite(rxPower) ? rxPower : null,
    distM,
    pathLoss: result && Number.isFinite(result.pathLoss) ? result.pathLoss : null,
    totalPathLoss: result && Number.isFinite(result.totalPathLoss) ? result.totalPathLoss : null,
    diffractionLoss: result && Number.isFinite(result.diffractionLoss) ? result.diffractionLoss : null,
    foliageLoss: result && Number.isFinite(result.foliageLoss) ? result.foliageLoss : null,
    buildingLoss: result && Number.isFinite(result.buildingLoss) ? result.buildingLoss : null,
    geometricLos: typeof result?.geoResult?.geometricLos === 'boolean' ? result.geoResult.geometricLos : null,
    fresnelClear: typeof result?.fresnelResult?.fresnelClear === 'boolean' ? result.fresnelResult.fresnelClear : null,
    sampleCount: result && Number.isFinite(result.sampleCount) ? result.sampleCount : null,
    color: _linkColorFromMargin(margin),
  } satisfies P2PLinkState];
  _dispatchP2PChanged();
}

function resetState(): void {
  markers.forEach(m => map.removeLayer(m));
  markers = [];
  markerA = null;
  markerB = null;
  if (polyline) { map.removeLayer(polyline); polyline = null; }
  _activeP2PSelected = false;
  _lastP2PResult = null;
  pointA = pointB = null;
  _endpointARepeaterId = null;
  _endpointBRepeaterId = null;
  if (_recalcTimer) clearTimeout(_recalcTimer);
  _syncP2PLinkState();
}

function makePin(latlng: P2PEndpoint, label: string, color: string): LeafletMarker {
  const icon = L.divIcon({
    html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;"></div>`,
    iconSize: [12, 12], iconAnchor: [6, 6], className: '',
  });
  return L.marker(latlng, { icon, draggable: true }).addTo(map).bindTooltip(escHtml(label), { permanent: true, direction: 'top', offset: [0, -8] });
}

function _syncPolylineGeometry(): void {
  if (!polyline || !pointA || !pointB) return;
  polyline.setLatLngs([pointA, pointB]);
  _syncP2PLinkState();
}

function _scheduleRecalc(reason = 'Endpoint moved. Recalculating...'): void {
  if (!pointA || !pointB) return;
  setStatus(reason);
  if (_recalcTimer) clearTimeout(_recalcTimer);
  _recalcTimer = setTimeout(() => {
    computeAndRenderLinkBudget();
  }, 220);
}

function _bindEndpointMarkerDrag(marker: LeafletMarker, endpoint: 'A' | 'B'): void {
  marker.on('drag', () => {
    const ll = marker.getLatLng();
    if (endpoint === 'A') pointA = ll;
    else pointB = ll;
    _syncPolylineGeometry();
  });
  marker.on('dragend', () => {
    const ll = marker.getLatLng();
    if (endpoint === 'A') {
      pointA = ll;
      _endpointARepeaterId = null;
    } else {
      pointB = ll;
      _endpointBRepeaterId = null;
    }
    _syncPolylineGeometry();
    _scheduleRecalc('P2P point moved. Recalculating...');
  });
}

function setStatus(msg: string, isError = false): void {
  const el = _el('p2p-status');
  el.textContent = msg;
  el.className = 'hint' + (isError ? ' hint-error' : '');
  el.classList.remove('hidden');
}

function clearResults(): void {
  _el('p2p-results').innerHTML = '';
  _el('p2p-status').classList.add('hidden');
}

function _updateP2PLineLabel(margin: number, rxPower: number, distM: number): void {
  if (!polyline) return;
  const color = margin >= 10 ? '#4ade80' : margin >= 0 ? '#facc15' : '#fc8181';
  polyline.setStyle?.({
    color,
    weight: _activeP2PSelected ? 6 : 3,
    dashArray: margin < 0 ? '4 4' : null,
    opacity: _activeP2PSelected ? 1 : 0.95,
  });
  _syncP2PSelectionHighlight();

  const sign = margin >= 0 ? '+' : '';
  const label = `${sign}${margin.toFixed(1)} dB`;
  const details = `${(distM / 1000).toFixed(2)} km - ${rxPower.toFixed(1)} dBm`;
  const html = `<b>${label}</b><br>${details}`;
  if (polyline.getTooltip?.()) {
    polyline.setTooltipContent?.(html);
  } else {
    polyline.bindTooltip?.(html, {
      permanent: true,
      direction: 'center',
      className: 'p2p-line-label',
    });
  }
}

const _fmt = formatP2PNumber;

function _profileSvgForFullscreen(profileSvg: unknown): string {
  return String(profileSvg).replace(/p2p-above-los/g, 'p2p-above-los-fullscreen');
}

function _profileReportHtml(result: LinkBudgetResult): string {
  const settings: Partial<P2PSettings> = result?._settings ?? {};
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const aLat = pointA?.lat ?? 0;
  const aLon = pointA?.lng ?? 0;
  const bLat = pointB?.lat ?? 0;
  const bLon = pointB?.lng ?? 0;
  const marginColor = result.margin >= 10 ? '#4ade80' : (result.margin >= 0 ? '#facc15' : '#f87171');
  const fresnelLabel = result?.fresnelResult?.fresnelClear ? 'Clear' : (result?.geoResult?.geometricLos ? 'Partial' : 'Blocked');
  const geoLabel = result?.geoResult?.geometricLos ? 'Clear' : 'Blocked';

  return `
    <div class="profile-report-card">
      <div class="profile-report-title">Terrain LoS Profile Report</div>
      <div class="profile-report-subtitle">Exported ${escHtml(now)} UTC</div>
      <div class="profile-report-metrics">
        <div class="profile-report-metric"><span>LINK MARGIN</span><strong style="color:${marginColor}">${escHtml(_fmt(result.margin))} dB</strong></div>
        <div class="profile-report-metric"><span>RX POWER</span><strong>${escHtml(_fmt(result.rxPower))} dBm</strong></div>
        <div class="profile-report-metric"><span>DISTANCE</span><strong>${escHtml((result.distM / 1000).toFixed(2))} km</strong></div>
        <div class="profile-report-metric"><span>FREQUENCY</span><strong>${escHtml(_fmt(settings.freqMHz ?? 0))} MHz</strong></div>
        <div class="profile-report-metric"><span>SAMPLES</span><strong>${escHtml(String(result.sampleCount))}</strong></div>
      </div>
      <div class="profile-report-lines">
        <div>A (TX): ${escHtml(aLat.toFixed(6))}, ${escHtml(aLon.toFixed(6))}  ->  B (RX): ${escHtml(bLat.toFixed(6))}, ${escHtml(bLon.toFixed(6))}</div>
        <div>Path loss ${escHtml(_fmt(result.pathLoss))} dB | Diffraction ${escHtml(_fmt(result.diffractionLoss))} dB | Foliage ${escHtml(_fmt(result.foliageLoss))} dB | Buildings ${escHtml(_fmt(result.buildingLoss))} dB</div>
        <div>TX ${escHtml(_fmt(settings.txPower ?? 0))} dBm + ${escHtml(_fmt(settings.txGain ?? 0))} dBi | RX gain ${escHtml(_fmt(settings.rxGain ?? 0))} dBi | TX/RX heights ${escHtml(_fmt(settings.txHeight ?? 0))} / ${escHtml(_fmt(settings.rxHeight ?? 0))} m</div>
        <div>LoS geometric: ${escHtml(geoLabel)} | Fresnel: ${escHtml(fresnelLabel)} | Required RX: ${escHtml(_fmt(result.requiredRx ?? 0))} dBm</div>
        ${result.monteCarlo?.enabled
          ? `<div>Monte Carlo ${escHtml(String(result.monteCarlo.trials))} trials | Outage ${escHtml((result.monteCarlo.outageProbability * 100).toFixed(1))}% | Margin P05/P50/P95 ${escHtml(_fmt(result.monteCarlo.marginP05))} / ${escHtml(_fmt(result.monteCarlo.marginP50))} / ${escHtml(_fmt(result.monteCarlo.marginP95))} dB</div>`
          : ''}
      </div>
    </div>`;
}

function _ensureProfileFullscreen(): HTMLElement {
  let modal = document.getElementById('profile-fullscreen');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'profile-fullscreen';
  modal.className = 'profile-fullscreen hidden';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Terrain LoS profile');
  modal.innerHTML = `
    <div class="profile-fullscreen-bar">
      <span class="profile-fullscreen-title">Terrain LoS Profile</span>
      <button id="btn-close-profile-fullscreen" class="btn-secondary" type="button">Close</button>
    </div>
    <div class="profile-fullscreen-body"></div>`;

  const close = () => {
    modal.classList.add('hidden');
    const body = modal.querySelector('.profile-fullscreen-body') as HTMLElement | null;
    if (body) body.innerHTML = '';
    document.body.classList.remove('profile-modal-open');
  };

  modal.querySelector('#btn-close-profile-fullscreen')?.addEventListener('click', close);
  modal.addEventListener('click', event => {
    if (event.target === modal) close();
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) close();
  });

  document.body.appendChild(modal);
  return modal;
}

function _openProfileFullscreen(result: LinkBudgetResult): void {
  const modal = _ensureProfileFullscreen();
  const body = modal.querySelector('.profile-fullscreen-body') as HTMLElement | null;
  if (!body) return;
  body.innerHTML = `
    ${_profileReportHtml(result)}
    <div class="profile-fullscreen-chart">${_profileSvgForFullscreen(result.profileSvg)}</div>
  `;
  modal.classList.remove('hidden');
  document.body.classList.add('profile-modal-open');
  (modal.querySelector('#btn-close-profile-fullscreen') as HTMLButtonElement | null)?.focus();
}

function _renderBudget(result: LinkBudgetResult): void {
  _lastP2PResult = result;
  _updateP2PLineLabel(result.margin, result.rxPower, result.distM);
  _syncP2PLinkState(result);

  const container = _el('p2p-results');
  container.innerHTML = renderP2PResultPanelHtml(result);

  container.querySelectorAll('.p2p-inner-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.p2p-inner-tab').forEach(b => b.classList.remove('active'));
      container.querySelectorAll('.p2p-inner-panel').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      const target = (btn as HTMLElement).dataset.target;
      if (target) _el(target).classList.remove('hidden');
    });
  });

  _el('btn-fullscreen-profile').addEventListener('click', () => {
    _openProfileFullscreen(result);
  });

  _el('btn-save-profile').addEventListener('click', () => {
    const svg = container.querySelector('#p2p-tab-profile svg');
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const W = 1500;
    const H = 980;
    const reportX = 26;
    const reportY = 24;
    const reportW = W - 52;
    const reportH = 270;
    const chartX = 40;
    const chartY = reportY + reportH + 24;
    const chartW = W - chartX * 2;
    const chartH = 590;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(0, 0, W, H);

      const settings = getP2PSettings();
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const aLat = pointA?.lat ?? 0;
      const aLon = pointA?.lng ?? 0;
      const bLat = pointB?.lat ?? 0;
      const bLon = pointB?.lng ?? 0;
      const detailLines = [
        `A (TX): ${aLat.toFixed(6)}, ${aLon.toFixed(6)}   ->   B (RX): ${bLat.toFixed(6)}, ${bLon.toFixed(6)}`,
        `Path loss ${result.pathLoss.toFixed(1)} dB  |  Diffraction ${result.diffractionLoss.toFixed(1)} dB  |  Foliage ${result.foliageLoss.toFixed(1)} dB  |  Buildings ${result.buildingLoss.toFixed(1)} dB`,
        `TX ${settings.txPower.toFixed(1)} dBm + ${settings.txGain.toFixed(1)} dBi  |  RX gain ${settings.rxGain.toFixed(1)} dBi  |  TX/RX heights ${settings.txHeight.toFixed(1)} m / ${settings.rxHeight.toFixed(1)} m`,
      ];
      if (result.monteCarlo?.enabled) {
        detailLines.push(
          `Monte Carlo ${result.monteCarlo.trials} trials  |  Outage ${(result.monteCarlo.outageProbability * 100).toFixed(1)}%  |  Margin P05/P50/P95 ${result.monteCarlo.marginP05.toFixed(1)} / ${result.monteCarlo.marginP50.toFixed(1)} / ${result.monteCarlo.marginP95.toFixed(1)} dB`
        );
      }

      const wrapLine = (text: string, x: number, y: number, maxWidth: number, lineHeight: number): number => {
        const words = String(text).split(/\s+/);
        let line = '';
        let yy = y;
        for (const word of words) {
          const test = line ? `${line} ${word}` : word;
          if (ctx.measureText(test).width > maxWidth && line) {
            ctx.fillText(line, x, yy);
            line = word;
            yy += lineHeight;
          } else {
            line = test;
          }
        }
        if (line) ctx.fillText(line, x, yy);
        return yy + lineHeight;
      };

      const drawMetric = (label: string, value: string, x: number, y: number, color = '#e2e8f0'): void => {
        ctx.fillStyle = '#93c5fd';
        ctx.font = '600 15px sans-serif';
        ctx.fillText(label, x, y);
        ctx.fillStyle = color;
        ctx.font = '700 22px sans-serif';
        ctx.fillText(value, x, y + 28);
      };

      ctx.fillStyle = '#111a2a';
      ctx.fillRect(reportX, reportY, reportW, reportH);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      ctx.strokeRect(reportX, reportY, reportW, reportH);

      ctx.fillStyle = '#e5e7eb';
      ctx.font = '700 34px sans-serif';
      ctx.fillText('Terrain LoS Profile Report', reportX + 18, reportY + 44);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '15px monospace';
      ctx.fillText(`Exported ${now} UTC`, reportX + 20, reportY + 72);

      const statusColor = result.margin >= 10 ? '#4ade80' : (result.margin >= 0 ? '#facc15' : '#f87171');
      drawMetric('LINK MARGIN', `${result.margin.toFixed(1)} dB`, reportX + 22, reportY + 106, statusColor);
      drawMetric('RX POWER', `${result.rxPower.toFixed(1)} dBm`, reportX + 292, reportY + 106);
      drawMetric('DISTANCE', `${(result.distM / 1000).toFixed(2)} km`, reportX + 562, reportY + 106);
      drawMetric('FREQUENCY', `${settings.freqMHz.toFixed(3)} MHz`, reportX + 832, reportY + 106);
      drawMetric('SAMPLES', `${result.sampleCount}`, reportX + 1160, reportY + 106);

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '15px monospace';
      let textY = reportY + 178;
      for (const line of detailLines) {
        textY = wrapLine(line, reportX + 20, textY, reportW - 40, 22);
      }

      ctx.fillStyle = '#0b1220';
      ctx.fillRect(chartX, chartY, chartW, chartH);
      ctx.strokeStyle = '#263245';
      ctx.lineWidth = 1;
      ctx.strokeRect(chartX, chartY, chartW, chartH);
      ctx.drawImage(img, chartX, chartY, chartW, chartH);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px sans-serif';
      ctx.fillText('Generated by MeshCore Mapper P2P Analyzer', 34, H - 26);

      URL.revokeObjectURL(url);
      canvas.toBlob(pngBlob => {
        if (!pngBlob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(pngBlob);
        a.download = `terrain-profile-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      }, 'image/png');
    };
    img.src = url;
  });

  setStatus(p2pResultStatusMessage(result));
}

async function computeAndRenderLinkBudget(): Promise<void> {
  if (!pointA || !pointB) return;
  _abortController?.abort();
  setStatus('Calculating link budget...');
  setButtonBusy('btn-p2p-update', true, 'Calculating...');
  _el<HTMLButtonElement>('btn-cancel-p2p').disabled = false;
  _el('p2p-results').innerHTML = '';
  _abortController = new AbortController();

  try {
    const settings = getP2PSettings();
    const result = await calculateLinkBudget(pointA, pointB, settings, { signal: _abortController.signal }) as LinkBudgetResult;
    result._settings = settings;
    _renderBudget(result);
  } catch (rawErr) {
    const err = rawErr as AbortLikeError;
    if (err?.cancelled || err?.name === 'AbortError') {
      setStatus('Link budget cancelled.', true);
    } else {
      setStatus(`Link budget failed: ${err.message}`, true);
      console.error('[p2p]', err);
    }
  } finally {
    _abortController = null;
    setButtonBusy('btn-p2p-update', false);
    _el<HTMLButtonElement>('btn-cancel-p2p').disabled = true;
  }
}

function startPicking(): void {
  resetState();
  clearResults();
  picking = true;
  _el('p2p-pick-hint').classList.remove('hidden');
  _el<HTMLButtonElement>('btn-p2p-pick').disabled = true;
  map.getContainer().style.cursor = 'crosshair';
}

function _finishPick(): void {
  if (!pointA || !pointB) return;
  if (!polyline) polyline = L.polyline([pointA, pointB], {
    color: '#facc15',
    weight: 2,
    dashArray: '6 4',
    className: 'p2p-link-line',
  }).addTo(map);
  if (!polyline) return;
  polyline.off?.('click', _selectActiveP2PLink);
  polyline.on('click', _selectActiveP2PLink);
  _syncPolylineGeometry();
  _syncP2PSelectionHighlight();
  picking = false;
  _el('p2p-pick-hint').classList.add('hidden');
  _el<HTMLButtonElement>('btn-p2p-pick').disabled = false;
  map.getContainer().style.cursor = '';
}

function _copyRepeaterToP2P(r: RepeaterLike): void {
  _el<HTMLInputElement>('p2p-tx-height').value = String(r.height);
  _el<HTMLInputElement>('p2p-tx-power').value = String(r.power);
  _el<HTMLInputElement>('p2p-tx-gain').value = String(r.gain);
  _el<HTMLInputElement>('p2p-freq').value = String(r.freq);
  if (r.pattern) _el<HTMLSelectElement>('p2p-pattern').value = r.pattern;
  if (Number.isFinite(r.azimuthDeg)) _el<HTMLInputElement>('p2p-tx-azimuth').value = String(r.azimuthDeg);
}

function _copyRepeaterToP2PRx(r: RepeaterLike): void {
  _el<HTMLInputElement>('p2p-rx-height').value = String(r.height);
  _el<HTMLInputElement>('p2p-rx-gain').value = String(r.gain);
  if (Number.isFinite(r.azimuthDeg)) _el<HTMLInputElement>('p2p-rx-azimuth').value = String(r.azimuthDeg);
}

export async function handleRepeaterClick(r: RepeaterLike): Promise<boolean> {
  if (!picking) return false;
  if (!pointA) {
    const endpoint = L.latLng(r.lat, r.lon) as P2PEndpoint;
    pointA = endpoint;
    _endpointARepeaterId = r.id;
    const marker = makePin(endpoint, `A: ${r.name}`, '#61dafb');
    markerA = marker;
    _bindEndpointMarkerDrag(marker, 'A');
    markers.push(marker);
    _copyRepeaterToP2P(r);
    _el('p2p-pick-hint').textContent = 'Now click point B (receiver)...';
  } else {
    const endpoint = L.latLng(r.lat, r.lon) as P2PEndpoint;
    pointB = endpoint;
    _endpointBRepeaterId = r.id;
    const marker = makePin(endpoint, `B: ${r.name}`, '#4ade80');
    markerB = marker;
    _bindEndpointMarkerDrag(marker, 'B');
    markers.push(marker);
    _copyRepeaterToP2PRx(r);
    _finishPick();
    await computeAndRenderLinkBudget();
  }
  return true;
}

export function startPickingFrom(r: RepeaterLike): void {
  setActiveTab('planning');
  startPicking();
  const endpoint = L.latLng(r.lat, r.lon) as P2PEndpoint;
  pointA = endpoint;
  _endpointARepeaterId = r.id;
  const marker = makePin(endpoint, `A: ${r.name}`, '#61dafb');
  markerA = marker;
  _bindEndpointMarkerDrag(marker, 'A');
  markers.push(marker);
  _copyRepeaterToP2P(r);
  _el('p2p-pick-hint').textContent = 'Now click point B (receiver)...';
}

export function init(): void {
  attachEirpHint({ powerId: 'p2p-tx-power', gainId: 'p2p-tx-gain', freqId: 'p2p-freq', hintId: 'p2p-eirp-hint' });
  _el('btn-p2p-pick').addEventListener('click', startPicking);
  _el('btn-p2p-update').addEventListener('click', async () => {
    if (!pointA || !pointB) {
      setStatus('Pick point A and point B first, then recalculate.', true);
      return;
    }
    await computeAndRenderLinkBudget();
  });
  _el('btn-p2p-dir-coverage').addEventListener('click', () => {
    if (!pointA || !pointB) {
      setStatus('Pick point A and point B first, then run directional coverage.', true);
      return;
    }
    const settings = getP2PSettings();
    const distKm = haversine(pointA.lat, pointA.lng, pointB.lat, pointB.lng) / 1000;
    const requiredRadiusKm = Math.max(0.1, distKm + 0.05); // include B with a small buffer
    const radiusInput = document.getElementById('analysis-radius') as HTMLInputElement | null;
    if (radiusInput) {
      const current = parseFloat(radiusInput.value);
      if (!Number.isFinite(current) || current < requiredRadiusKm) {
        radiusInput.value = requiredRadiusKm.toFixed(2);
      }
    }
    document.dispatchEvent(new CustomEvent('p2p:run-directional-coverage', {
      detail: {
        pointA: { lat: pointA.lat, lon: pointA.lng },
        pointB: { lat: pointB.lat, lon: pointB.lng },
        endpointARepeaterId: _endpointARepeaterId,
        sectorDeg: settings.directionalSectorDeg,
        radiusKm: requiredRadiusKm,
      },
    }));
    setStatus(`Directional coverage requested (${settings.directionalSectorDeg} deg sector, radius ${requiredRadiusKm.toFixed(2)} km).`);
  });
  _el('btn-p2p-clear').addEventListener('click', () => {
    _abortController?.abort();
    resetState();
    clearResults();
    _el('p2p-pick-hint').classList.add('hidden');
    _el<HTMLButtonElement>('btn-p2p-pick').disabled = false;
    picking = false;
    map.getContainer().style.cursor = '';
  });
  _el('btn-cancel-p2p').addEventListener('click', () => _abortController?.abort());
  document.addEventListener('selection:changed', (event: Event) => {
    const detail = (event as CustomEvent<{ kind?: string; linkKind?: string; id?: string | number }>).detail;
    _activeP2PSelected = detail?.kind === 'link'
      && detail?.linkKind === 'p2p'
      && detail?.id === 'active-p2p';
    _syncP2PSelectionHighlight();
  });
  const openP2PPanel = () => {
    setActiveTab('planning');
    document.querySelectorAll('#tab-planning details.panel').forEach((d: Element) => {
      if (d.querySelector('summary')?.textContent?.includes('P2P Link Budget')) {
        (d as HTMLDetailsElement).open = true;
      }
    });
  };
  document.addEventListener('link:p2p-open', openP2PPanel);
  document.addEventListener('link:p2p-profile', () => {
    openP2PPanel();
    if (!_lastP2PResult?.profileSvg) {
      setStatus('Compute the P2P link before opening its terrain profile.', true);
      return;
    }
    const profileTab = document.querySelector('#p2p-results .p2p-inner-tab[data-target="p2p-tab-profile"]') as HTMLElement | null;
    profileTab?.click();
    _openProfileFullscreen(_lastP2PResult);
  });
  document.addEventListener('link:p2p-recompute', async () => {
    setActiveTab('planning');
    if (pointA && pointB) await computeAndRenderLinkBudget();
  });

  document.addEventListener('repeater:moved', (event: Event) => {
    const detail = (event as CustomEvent<{ id?: number | string; lat?: number; lon?: number }>).detail;
    const id = detail?.id;
    const lat = detail?.lat;
    const lon = detail?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    if (_endpointARepeaterId === id) {
      pointA = L.latLng(lat, lon);
      if (pointA) markerA?.setLatLng(pointA);
      _syncPolylineGeometry();
      _scheduleRecalc('TX repeater moved. Recalculating...');
    }
    if (_endpointBRepeaterId === id) {
      pointB = L.latLng(lat, lon);
      if (pointB) markerB?.setLatLng(pointB);
      _syncPolylineGeometry();
      _scheduleRecalc('RX repeater moved. Recalculating...');
    }
  });

  initPathfinderUI();

  map.on('click', async (e: LeafletClickEvent) => {
    if (!picking) return;
    if (e.originalEvent) e.originalEvent._meshcoreHandled = true;
    if (!pointA) {
      pointA = e.latlng;
      _endpointARepeaterId = null;
      const marker = makePin(e.latlng, 'A (TX)', '#61dafb');
      markerA = marker;
      _bindEndpointMarkerDrag(marker, 'A');
      markers.push(marker);
      _el('p2p-pick-hint').textContent = 'Now click point B (receiver)...';
    } else {
      pointB = e.latlng;
      _endpointBRepeaterId = null;
      const marker = makePin(e.latlng, 'B (RX)', '#4ade80');
      markerB = marker;
      _bindEndpointMarkerDrag(marker, 'B');
      markers.push(marker);
      _finishPick();
      await computeAndRenderLinkBudget();
    }
  });
}
