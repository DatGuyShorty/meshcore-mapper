/**
 * p2p.js — Point-to-Point link budget panel.
 * Click two map points, fetch terrain profile, report FSPL + diffraction loss + received power.
 */
import { map } from './map.js';
import { fetchElevations } from './elevation.js';
import { checkLoS, haversine, fspl } from './propagation.js';

const PROFILE_SAMPLES = 64;

let picking = false;  // expecting a click
let pointA  = null;
let pointB  = null;
let markers = [];
let polyline = null;

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
  return L.marker(latlng, { icon }).addTo(map).bindTooltip(label, { permanent: true, direction: 'top', offset: [0, -8] });
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

/**
 * Render a terrain profile SVG for the given elevation array.
 * Shows: terrain cross-section, earth-curvature effective terrain, Fresnel zone,
 * LOS line, TX/RX masts, and red obstruction highlight where terrain blocks the path.
 */
function drawTerrainProfile(elevs, txElev, rxElev, txHeight, rxHeight, distM, freqMHz) {
  const W = 240, H = 105;
  const n = elevs.length;
  const λ = 299792458 / (freqMHz * 1e6);
  const Re_eff = 8495000; // 6371000 * 4/3
  const txH = txElev + txHeight;
  const rxH = rxElev + rxHeight;

  // Per-sample: effective terrain height (+ earth-curvature bulge), LOS height, Fresnel radius
  const effective = [];
  const losH = [];
  const fresnelR = [];
  for (let i = 0; i < n; i++) {
    const frac = i / (n - 1);
    const d1 = frac * distM;
    const d2 = distM - d1;
    const bulge = (d1 > 0 && d2 > 0) ? d1 * d2 / (2 * Re_eff) : 0;
    effective.push(elevs[i] + bulge);
    losH.push(txH + (rxH - txH) * frac);
    fresnelR.push((d1 > 0 && d2 > 0) ? Math.sqrt(λ * d1 * d2 / distM) : 0);
  }

  // Y-scale bounds
  const allH = [
    ...effective,
    ...losH.map((h, i) => h + fresnelR[i]),
    txElev, rxElev,
  ];
  const yMin = Math.min(...allH) - 5;
  const yMax = Math.max(...allH) + 12;

  const toX = i => 2 + (i / (n - 1)) * (W - 4);
  const toY = h => 4 + (1 - (h - yMin) / (yMax - yMin)) * (H - 16);

  // Terrain polygon
  const terrainTopPts = effective.map((e, i) => `${toX(i).toFixed(1)},${toY(e).toFixed(1)}`);
  const terrainPoly = `M${terrainTopPts.join(' L')} L${toX(n - 1).toFixed(1)},${H} L${toX(0).toFixed(1)},${H} Z`;

  // Fresnel zone polygon and border polylines
  const fzTopPts = losH.map((h, i) => `${toX(i).toFixed(1)},${toY(h + fresnelR[i]).toFixed(1)}`);
  const fzBotPts = losH.map((h, i) => `${toX(i).toFixed(1)},${toY(h - fresnelR[i]).toFixed(1)}`);
  const fzPoly = `M${fzTopPts.join(' L')} L${[...fzBotPts].reverse().join(' L')} Z`;

  // LOS line (antenna tip to antenna tip)
  const losLine = `M${toX(0).toFixed(1)},${toY(txH).toFixed(1)} L${toX(n - 1).toFixed(1)},${toY(rxH).toFixed(1)}`;

  // Clip path: region visually above the LOS line (terrain obstruction highlight)
  const obstrClip = `M${toX(0).toFixed(1)},0 L${toX(n - 1).toFixed(1)},0 L${toX(n - 1).toFixed(1)},${toY(rxH).toFixed(1)} L${toX(0).toFixed(1)},${toY(txH).toFixed(1)} Z`;

  // TX / RX masts
  const txX = toX(0).toFixed(1);
  const rxX = toX(n - 1).toFixed(1);

  const distLabel = distM >= 1000 ? `${(distM / 1000).toFixed(2)} km` : `${distM.toFixed(0)} m`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="display:block;border-radius:4px;background:#0d1117;margin-bottom:8px;border:1px solid #1e2a3a">
  <defs><clipPath id="p2p-above-los"><path d="${obstrClip}"/></clipPath></defs>
  <path d="${fzPoly}" fill="rgba(97,218,251,0.07)"/>
  <polyline points="${fzTopPts.join(' ')}" fill="none" stroke="rgba(97,218,251,0.30)" stroke-width="0.7" stroke-dasharray="3,2"/>
  <polyline points="${fzBotPts.join(' ')}" fill="none" stroke="rgba(97,218,251,0.30)" stroke-width="0.7" stroke-dasharray="3,2"/>
  <path d="${terrainPoly}" fill="#3d2e1a" stroke="#7a6040" stroke-width="0.8"/>
  <path d="${terrainPoly}" fill="rgba(239,68,68,0.5)" clip-path="url(#p2p-above-los)"/>
  <path d="${losLine}" fill="none" stroke="#facc15" stroke-width="1.5" stroke-dasharray="5,3"/>
  <line x1="${txX}" y1="${toY(txElev).toFixed(1)}" x2="${txX}" y2="${toY(txH).toFixed(1)}" stroke="#61dafb" stroke-width="2" stroke-linecap="round"/>
  <circle cx="${txX}" cy="${toY(txH).toFixed(1)}" r="2.5" fill="#61dafb"/>
  <line x1="${rxX}" y1="${toY(rxElev).toFixed(1)}" x2="${rxX}" y2="${toY(rxH).toFixed(1)}" stroke="#4ade80" stroke-width="2" stroke-linecap="round"/>
  <circle cx="${rxX}" cy="${toY(rxH).toFixed(1)}" r="2.5" fill="#4ade80"/>
  <text x="${txX}" y="${H - 1}" text-anchor="middle" fill="#61dafb" font-size="7" font-family="sans-serif">A</text>
  <text x="${rxX}" y="${H - 1}" text-anchor="middle" fill="#4ade80" font-size="7" font-family="sans-serif">B</text>
  <text x="${(W / 2).toFixed(0)}" y="${H - 1}" text-anchor="middle" fill="#6b7280" font-size="7" font-family="sans-serif">${distLabel}</text>
</svg>`;
}

async function computeLinkBudget() {
  if (!pointA || !pointB) return;

  setStatus('Fetching elevation profile…');
  document.getElementById('p2p-results').innerHTML = '';

  const txHeight = parseFloat(document.getElementById('p2p-tx-height').value) || 10;
  const rxHeight = parseFloat(document.getElementById('p2p-rx-height').value) || 1.5;
  const txPower  = parseFloat(document.getElementById('p2p-tx-power').value)  || 20;
  const txGain   = parseFloat(document.getElementById('p2p-tx-gain').value)   || 2;
  const rxGain   = parseFloat(document.getElementById('p2p-rx-gain').value)   || 2;
  const freqMHz  = parseFloat(document.getElementById('p2p-freq').value)      || 868;
  const rxSens   = parseFloat(document.getElementById('p2p-rx-sens').value)   || -137;

  const distM = haversine(pointA.lat, pointA.lng, pointB.lat, pointB.lng);

  // Build profile sample points
  const profilePoints = [];
  for (let i = 0; i < PROFILE_SAMPLES; i++) {
    const t = i / (PROFILE_SAMPLES - 1);
    profilePoints.push({
      latitude:  pointA.lat + (pointB.lat - pointA.lat) * t,
      longitude: pointA.lng + (pointB.lng - pointA.lng) * t,
    });
  }

  let elevs;
  try {
    elevs = await fetchElevations(profilePoints);
  } catch (e) {
    setStatus(`Elevation fetch failed: ${e.message}`, true);
    return;
  }

  const txElev = elevs[0];
  const rxElev = elevs[PROFILE_SAMPLES - 1];

  // Geometric LoS (pure knife-edge, no Fresnel padding) — for actual diffraction loss
  const geoResult = checkLoS(txElev, rxElev, elevs, txHeight, rxHeight, distM, freqMHz, false);
  // Fresnel-zone clearance (adds Fresnel radius to obstacle height) — quality indicator only
  const fresnelResult = checkLoS(txElev, rxElev, elevs, txHeight, rxHeight, distM, freqMHz, true);

  const pathLoss = fspl(distM, freqMHz);
  const rxPower  = txPower + txGain + rxGain - pathLoss - geoResult.diffractionLossDb;
  const margin   = rxPower - rxSens;

  console.info(`[p2p] dist=${(distM/1000).toFixed(2)} km, FSPL=${pathLoss.toFixed(1)} dB, diff=${geoResult.diffractionLossDb.toFixed(1)} dB, rxPower=${rxPower.toFixed(1)} dBm, margin=${margin.toFixed(1)} dB, geoLoS=${geoResult.los}, fresnelClear=${fresnelResult.los}`);

  const profileSvg = drawTerrainProfile(elevs, txElev, rxElev, txHeight, rxHeight, distM, freqMHz);

  const fmt = v => v.toFixed(1);
  const diffColor = geoResult.diffractionLossDb > 20 ? '#fc8181' : geoResult.diffractionLossDb > 6 ? '#facc15' : '';
  const geoLabel = geoResult.los
    ? '<span style="color:#4ade80">✓ Clear</span>'
    : '<span style="color:#fc8181">✗ Blocked</span>';
  const fresnelLabel = fresnelResult.los
    ? '<span style="color:#4ade80">✓ Clear</span>'
    : (geoResult.los
        ? '<span style="color:#facc15">⚠ Partial</span>'
        : '<span style="color:#fc8181">✗ Blocked</span>');

  const rows = [
    ['Distance',         `${(distM / 1000).toFixed(2)} km`, ''],
    ['Free-space loss',  `${fmt(pathLoss)} dB`, ''],
    ['Diffraction loss', `${fmt(geoResult.diffractionLossDb)} dB`, diffColor],
    ['Total path loss',  `${fmt(pathLoss + geoResult.diffractionLossDb)} dB`, ''],
    ['TX EIRP',          `${fmt(txPower + txGain)} dBm`, ''],
    ['Received power',   `${fmt(rxPower)} dBm`, ''],
    ['Link margin',      `${fmt(margin)} dB`, margin >= 10 ? '#4ade80' : margin >= 0 ? '#facc15' : '#fc8181'],
    ['Geometric LoS',    geoLabel, null],
    ['Fresnel zone',     fresnelLabel, null],
  ];

  const tbody = rows.map(([k, v, color]) => {
    const val = color === null ? v : `<span style="color:${color}">${v}</span>`;
    return `<tr><td class="p2p-key">${k}</td><td class="p2p-val">${val}</td></tr>`;
  }).join('');

  document.getElementById('p2p-results').innerHTML =
    profileSvg + `<table class="p2p-table"><tbody>${tbody}</tbody></table>`;
  setStatus(margin >= 0 ? `Link OK  (+${fmt(margin)} dB margin)` : `Link FAILED  (${fmt(margin)} dB short)`);
}

function startPicking() {
  resetState();
  clearResults();
  picking = true;
  document.getElementById('p2p-pick-hint').classList.remove('hidden');
  document.getElementById('btn-p2p-pick').disabled = true;
  map.getContainer().style.cursor = 'crosshair';
}

/**
 * Called when a repeater marker is clicked while P2P picking is active.
 * Sets point A (TX) on first click, point B (RX) on second click and computes.
 * @returns {boolean} true if the click was consumed (P2P was picking)
 */
export async function handleRepeaterClick(r) {
  if (!picking) return false;
  if (!pointA) {
    pointA = L.latLng(r.lat, r.lon);
    markers.push(makePin(pointA, `A: ${r.name}`, '#61dafb'));
    document.getElementById('p2p-tx-height').value = r.height;
    document.getElementById('p2p-tx-power').value  = r.power;
    document.getElementById('p2p-tx-gain').value   = r.gain;
    document.getElementById('p2p-freq').value       = r.freq;
    document.getElementById('p2p-pick-hint').textContent = 'Now click point B (receiver)…';
  } else {
    pointB = L.latLng(r.lat, r.lon);
    markers.push(makePin(pointB, `B: ${r.name}`, '#4ade80'));
    polyline = L.polyline([pointA, pointB], { color: '#facc15', weight: 2, dashArray: '6 4' }).addTo(map);
    picking = false;
    document.getElementById('p2p-pick-hint').classList.add('hidden');
    document.getElementById('btn-p2p-pick').disabled = false;
    map.getContainer().style.cursor = '';
    await computeLinkBudget();
  }
  return true;
}

/**
 * Start P2P picking with a given repeater pre-set as point A.
 * Switches to the Tools tab automatically.
 */
export function startPickingFrom(r) {
  document.querySelector('.tab-btn[data-tab="tools"]')?.click();
  startPicking();
  pointA = L.latLng(r.lat, r.lon);
  markers.push(makePin(pointA, `A: ${r.name}`, '#61dafb'));
  document.getElementById('p2p-tx-height').value = r.height;
  document.getElementById('p2p-tx-power').value  = r.power;
  document.getElementById('p2p-tx-gain').value   = r.gain;
  document.getElementById('p2p-freq').value       = r.freq;
  document.getElementById('p2p-pick-hint').textContent = 'Now click point B (receiver)…';
}

export function init() {
  document.getElementById('btn-p2p-pick').addEventListener('click', startPicking);
  document.getElementById('btn-p2p-clear').addEventListener('click', () => {
    resetState();
    clearResults();
    document.getElementById('p2p-pick-hint').classList.add('hidden');
    document.getElementById('btn-p2p-pick').disabled = false;
    picking = false;
    map.getContainer().style.cursor = '';
  });

  map.on('click', async (e) => {
    if (!picking) return;

    if (!pointA) {
      pointA = e.latlng;
      markers.push(makePin(e.latlng, 'A (TX)', '#61dafb'));
      document.getElementById('p2p-pick-hint').textContent = 'Now click point B (receiver)…';
    } else {
      pointB = e.latlng;
      markers.push(makePin(e.latlng, 'B (RX)', '#4ade80'));
      polyline = L.polyline([pointA, pointB], { color: '#facc15', weight: 2, dashArray: '6 4' }).addTo(map);
      picking = false;
      document.getElementById('p2p-pick-hint').classList.add('hidden');
      document.getElementById('btn-p2p-pick').disabled = false;
      map.getContainer().style.cursor = '';
      await computeLinkBudget();
    }
  });
}
