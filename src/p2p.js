/**
 * p2p.js - Point-to-point picking UI.
 * Link-budget math, terrain profile rendering, and pathfinder UI live in
 * dedicated modules.
 */
import { map, state } from './map.js';
import { calculateLinkBudget } from './linkBudget.js';
import { initPathfinderUI } from './pathfinderUI.js';
import { haversine } from './propagation.js';
import { getP2PSettings } from './settings.js';
import { escHtml, setActiveTab, setButtonBusy } from './ui.js';

let picking = false;
let pointA = null;
let pointB = null;
let markers = [];
let markerA = null;
let markerB = null;
let polyline = null;
let _abortController = null;
let _recalcTimer = null;
let _endpointARepeaterId = null;
let _endpointBRepeaterId = null;

function _dispatchP2PChanged() {
  document.dispatchEvent(new CustomEvent('p2p:changed'));
}

function _pointToLatLon(point) {
  if (!point) return null;
  const lat = Number(point.lat);
  const lon = Number(point.lng ?? point.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function _linkColorFromMargin(margin) {
  if (!Number.isFinite(margin)) return '#facc15';
  if (margin >= 10) return '#4ade80';
  if (margin >= 0) return '#facc15';
  return '#fc8181';
}

function _syncP2PLinkState(result = null) {
  const a = _pointToLatLon(pointA);
  const b = _pointToLatLon(pointB);
  if (!a || !b) {
    state.p2pLinks = [];
    _dispatchP2PChanged();
    return;
  }

  const margin = Number(result?.margin);
  const rxPower = Number(result?.rxPower);
  const distM = Number.isFinite(result?.distM)
    ? result.distM
    : haversine(a.lat, a.lon, b.lat, b.lon);
  state.p2pLinks = [{
    id: 'active-p2p',
    kind: 'p2p',
    pointA: a,
    pointB: b,
    endpointARepeaterId: _endpointARepeaterId,
    endpointBRepeaterId: _endpointBRepeaterId,
    margin: Number.isFinite(margin) ? margin : null,
    rxPower: Number.isFinite(rxPower) ? rxPower : null,
    distM,
    color: _linkColorFromMargin(margin),
  }];
  _dispatchP2PChanged();
}

function resetState() {
  markers.forEach(m => map.removeLayer(m));
  markers = [];
  markerA = null;
  markerB = null;
  if (polyline) { map.removeLayer(polyline); polyline = null; }
  pointA = pointB = null;
  _endpointARepeaterId = null;
  _endpointBRepeaterId = null;
  clearTimeout(_recalcTimer);
  _syncP2PLinkState();
}

function makePin(latlng, label, color) {
  const icon = L.divIcon({
    html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;"></div>`,
    iconSize: [12, 12], iconAnchor: [6, 6], className: '',
  });
  return L.marker(latlng, { icon, draggable: true }).addTo(map).bindTooltip(escHtml(label), { permanent: true, direction: 'top', offset: [0, -8] });
}

function _syncPolylineGeometry() {
  if (!polyline || !pointA || !pointB) return;
  polyline.setLatLngs([pointA, pointB]);
  _syncP2PLinkState();
}

function _scheduleRecalc(reason = 'Endpoint moved. Recalculating...') {
  if (!pointA || !pointB) return;
  setStatus(reason);
  clearTimeout(_recalcTimer);
  _recalcTimer = setTimeout(() => {
    computeAndRenderLinkBudget();
  }, 220);
}

function _bindEndpointMarkerDrag(marker, endpoint) {
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

function _profileSvgForFullscreen(profileSvg) {
  return String(profileSvg).replace(/p2p-above-los/g, 'p2p-above-los-fullscreen');
}

function _profileReportHtml(result) {
  const settings = result?._settings ?? {};
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

function _ensureProfileFullscreen() {
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
    modal.querySelector('.profile-fullscreen-body').innerHTML = '';
    document.body.classList.remove('profile-modal-open');
  };

  modal.querySelector('#btn-close-profile-fullscreen').addEventListener('click', close);
  modal.addEventListener('click', event => {
    if (event.target === modal) close();
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) close();
  });

  document.body.appendChild(modal);
  return modal;
}

function _openProfileFullscreen(result) {
  const modal = _ensureProfileFullscreen();
  modal.querySelector('.profile-fullscreen-body').innerHTML = `
    ${_profileReportHtml(result)}
    <div class="profile-fullscreen-chart">${_profileSvgForFullscreen(result.profileSvg)}</div>
  `;
  modal.classList.remove('hidden');
  document.body.classList.add('profile-modal-open');
  modal.querySelector('#btn-close-profile-fullscreen').focus();
}

function _renderBudget(result) {
  _updateP2PLineLabel(result.margin, result.rxPower, result.distM);
  _syncP2PLinkState(result);

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
    ['Diffraction model', `${result.geoResult.diffractionModel || 'knife-edge'}`, ''],
    ['Free-space loss', `${_fmt(result.pathLoss)} dB`, ''],
    ['Diffraction loss', `${_fmt(result.diffractionLoss)} dB`, diffColor],
    ...(result.foliageLoss > 0 ? [['Foliage loss', `${_fmt(result.foliageLoss)} dB`, vegColor]] : []),
    ...(result.buildingLoss > 0 ? [['Building loss', `${_fmt(result.buildingLoss)} dB`, bldColor]] : []),
    ...(Math.abs(result.shadowFadingLoss ?? 0) > 0.05 ? [['Shadow fading', `${_fmt(result.shadowFadingLoss)} dB`, result.shadowFadingLoss > 0 ? '#facc15' : '#4ade80']] : []),
    ['Total path loss', `${_fmt(result.totalPathLoss)} dB`, ''],
    ['TX EIRP', `${_fmt(result.txEirp)} dBm`, ''],
    ['TX pattern offset', `${_fmt(result.txPatternOffset ?? 0)} dB`, ''],
    ['RX pattern offset', `${_fmt(result.rxPatternOffset ?? 0)} dB`, ''],
    ['Received power', `${_fmt(result.rxPower)} dBm`, ''],
    ...(result.fadeMargin > 0 ? [['Required RX', `${_fmt(result.requiredRx)} dBm`, '']] : []),
    ['Link margin', `${_fmt(result.margin)} dB`, result.margin >= 10 ? '#4ade80' : result.margin >= 0 ? '#facc15' : '#fc8181'],
    ...(result.monteCarlo?.enabled ? [
      ['MC trials', `${result.monteCarlo.trials}`, ''],
      ['MC outage probability', `${(result.monteCarlo.outageProbability * 100).toFixed(1)}%`, result.monteCarlo.outageProbability < 0.05 ? '#4ade80' : result.monteCarlo.outageProbability < 0.2 ? '#facc15' : '#fc8181'],
      ['MC margin P05', `${_fmt(result.monteCarlo.marginP05)} dB`, result.monteCarlo.marginP05 >= 0 ? '#4ade80' : '#fc8181'],
      ['MC margin P50', `${_fmt(result.monteCarlo.marginP50)} dB`, ''],
      ['MC margin P95', `${_fmt(result.monteCarlo.marginP95)} dB`, ''],
    ] : []),
    ['Geometric LoS', geoLabel, null],
    ['Fresnel clearance', fresnelLabel, null],
  ];

  const tbody = rows.map(([k, v, color]) => {
    const val = color === null ? v : `<span style="color:${color}">${v}</span>`;
    return `<tr><td class="p2p-key">${k}</td><td class="p2p-val">${val}</td></tr>`;
  }).join('');
  const warningHtml = result.warnings?.length
    ? `<div class="status-line warning">${result.warnings.map(escHtml).join('<br>')}</div>`
    : '';

  const container = document.getElementById('p2p-results');
  container.innerHTML = `
    <div class="p2p-inner-tabbar">
      <button class="p2p-inner-tab active" data-target="p2p-tab-budget">Budget</button>
      <button class="p2p-inner-tab" data-target="p2p-tab-profile">Profile</button>
    </div>
    <div id="p2p-tab-budget" class="p2p-inner-panel">
      ${warningHtml}
      <table class="p2p-table"><tbody>${tbody}</tbody></table>
    </div>
    <div id="p2p-tab-profile" class="p2p-inner-panel hidden">
      <div class="p2p-profile-preview">${result.profileSvg}</div>
      <div class="p2p-profile-actions">
        <button id="btn-fullscreen-profile" class="btn-secondary" type="button">Fullscreen</button>
        <button id="btn-save-profile" class="btn-secondary" type="button">Save PNG</button>
      </div>
    </div>`;

  container.querySelectorAll('.p2p-inner-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.p2p-inner-tab').forEach(b => b.classList.remove('active'));
      container.querySelectorAll('.p2p-inner-panel').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.target).classList.remove('hidden');
    });
  });

  document.getElementById('btn-fullscreen-profile').addEventListener('click', () => {
    _openProfileFullscreen(result);
  });

  document.getElementById('btn-save-profile').addEventListener('click', () => {
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

      const wrapLine = (text, x, y, maxWidth, lineHeight) => {
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

      const drawMetric = (label, value, x, y, color = '#e2e8f0') => {
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
        const a = document.createElement('a');
        a.href = URL.createObjectURL(pngBlob);
        a.download = `terrain-profile-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      }, 'image/png');
    };
    img.src = url;
  });

  setStatus(result.margin >= 0
    ? `Link OK (+${_fmt(result.margin)} dB margin)`
    : `Link FAILED (${_fmt(result.margin)} dB short)`);
}

async function computeAndRenderLinkBudget() {
  if (!pointA || !pointB) return;
  _abortController?.abort();
  setStatus('Calculating link budget...');
  setButtonBusy('btn-p2p-update', true, 'Calculating...');
  document.getElementById('btn-cancel-p2p').disabled = false;
  document.getElementById('p2p-results').innerHTML = '';
  _abortController = new AbortController();

  try {
    const settings = getP2PSettings();
    const result = await calculateLinkBudget(pointA, pointB, settings, { signal: _abortController.signal });
    result._settings = settings;
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
  if (!polyline) polyline = L.polyline([pointA, pointB], { color: '#facc15', weight: 2, dashArray: '6 4' }).addTo(map);
  _syncPolylineGeometry();
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
  if (r.pattern) document.getElementById('p2p-pattern').value = r.pattern;
  if (Number.isFinite(r.azimuthDeg)) document.getElementById('p2p-tx-azimuth').value = r.azimuthDeg;
}

function _copyRepeaterToP2PRx(r) {
  document.getElementById('p2p-rx-height').value = r.height;
  document.getElementById('p2p-rx-gain').value = r.gain;
  if (Number.isFinite(r.azimuthDeg)) document.getElementById('p2p-rx-azimuth').value = r.azimuthDeg;
}

export async function handleRepeaterClick(r) {
  if (!picking) return false;
  if (!pointA) {
    pointA = L.latLng(r.lat, r.lon);
    _endpointARepeaterId = r.id;
    markerA = makePin(pointA, `A: ${r.name}`, '#61dafb');
    _bindEndpointMarkerDrag(markerA, 'A');
    markers.push(markerA);
    _copyRepeaterToP2P(r);
    document.getElementById('p2p-pick-hint').textContent = 'Now click point B (receiver)...';
  } else {
    pointB = L.latLng(r.lat, r.lon);
    _endpointBRepeaterId = r.id;
    markerB = makePin(pointB, `B: ${r.name}`, '#4ade80');
    _bindEndpointMarkerDrag(markerB, 'B');
    markers.push(markerB);
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
  _endpointARepeaterId = r.id;
  markerA = makePin(pointA, `A: ${r.name}`, '#61dafb');
  _bindEndpointMarkerDrag(markerA, 'A');
  markers.push(markerA);
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
  document.getElementById('btn-p2p-dir-coverage').addEventListener('click', () => {
    if (!pointA || !pointB) {
      setStatus('Pick point A and point B first, then run directional coverage.', true);
      return;
    }
    const settings = getP2PSettings();
    const distKm = haversine(pointA.lat, pointA.lng, pointB.lat, pointB.lng) / 1000;
    const requiredRadiusKm = Math.max(0.1, distKm + 0.05); // include B with a small buffer
    const radiusInput = document.getElementById('analysis-radius');
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

  document.addEventListener('repeater:moved', event => {
    const id = event?.detail?.id;
    const lat = event?.detail?.lat;
    const lon = event?.detail?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    if (_endpointARepeaterId === id) {
      pointA = L.latLng(lat, lon);
      markerA?.setLatLng(pointA);
      _syncPolylineGeometry();
      _scheduleRecalc('TX repeater moved. Recalculating...');
    }
    if (_endpointBRepeaterId === id) {
      pointB = L.latLng(lat, lon);
      markerB?.setLatLng(pointB);
      _syncPolylineGeometry();
      _scheduleRecalc('RX repeater moved. Recalculating...');
    }
  });

  initPathfinderUI();

  map.on('click', async (e) => {
    if (!picking) return;
    if (e.originalEvent) e.originalEvent._meshcoreHandled = true;
    if (!pointA) {
      pointA = e.latlng;
      _endpointARepeaterId = null;
      markerA = makePin(e.latlng, 'A (TX)', '#61dafb');
      _bindEndpointMarkerDrag(markerA, 'A');
      markers.push(markerA);
      document.getElementById('p2p-pick-hint').textContent = 'Now click point B (receiver)...';
    } else {
      pointB = e.latlng;
      _endpointBRepeaterId = null;
      markerB = makePin(e.latlng, 'B (RX)', '#4ade80');
      _bindEndpointMarkerDrag(markerB, 'B');
      markers.push(markerB);
      _finishPick();
      await computeAndRenderLinkBudget();
    }
  });
}
