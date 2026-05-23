/**
 * p2p.js — Point-to-Point link budget panel.
 * Click two map points, fetch terrain profile, report FSPL + diffraction loss + received power.
 */
import { map, state } from './map.js';
import { fetchElevations } from './elevation.js';
import { checkLoS, haversine, fspl, RE_EFF, pointInPolygon } from './propagation.js';
import { fetchFoliage, foliageLossDb } from './foliage.js';
import { fetchBuildings, buildingLossDb } from './buildings.js';
import { findBestPath } from './pathfinder.js';

const PROFILE_SAMPLES = 64;

let picking = false;  // expecting a click
let pointA  = null;
let pointB  = null;
let markers = [];
let polyline = null;

// Path-finder map layers
let _pathPolylines = [];
let _pathMarkers   = [];

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

function _updateP2PLineLabel(margin, rxPower, distM) {
  if (!polyline) return;

  const color = margin >= 10 ? '#4ade80' : margin >= 0 ? '#facc15' : '#fc8181';
  polyline.setStyle({ color, weight: 3, dashArray: margin < 0 ? '4 4' : null, opacity: 0.95 });

  const sign = margin >= 0 ? '+' : '';
  const label = `${sign}${margin.toFixed(1)} dB`;
  const details = `${(distM / 1000).toFixed(2)} km · ${rxPower.toFixed(1)} dBm`;

  if (polyline.getTooltip()) {
    polyline.setTooltipContent(`<b>${label}</b><br>${details}`);
  } else {
    polyline.bindTooltip(`<b>${label}</b><br>${details}`, {
      permanent: true,
      direction: 'center',
      className: 'p2p-line-label',
    });
  }
}

/**
 * For each profile sample, look up vegetation canopy height and building height (m above terrain).
 * Returns two Float32Arrays: vegH[i] > 0 means the sample is inside a foliage polygon, bldH[i] > 0 inside a building.
 */
const TILE_N16 = 16; // must match the TILE_N used in foliage.js / buildings.js
function _sampleObstacleHeights(profilePoints, foliage, buildings) {
  const n = profilePoints.length;
  const vegH = new Float32Array(n);
  const bldH = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const lat = profilePoints[i].latitude;
    const lon = profilePoints[i].longitude;

    if (foliage?.polygons?.length > 0) {
      let candidates;
      const ti = foliage.tileIndex;
      if (ti) {
        const r = Math.max(0, Math.min(TILE_N16 - 1, Math.floor((lat - ti.latMin) / ti.latSpan * TILE_N16)));
        const c = Math.max(0, Math.min(TILE_N16 - 1, Math.floor((lon - ti.lonMin) / ti.lonSpan * TILE_N16)));
        candidates = ti.tiles[r * TILE_N16 + c];
      } else {
        candidates = foliage.polygons.map((_, j) => j);
      }
      for (const pi of candidates) {
        const bb = foliage.bboxes[pi];
        if (lat < bb.latMin || lat > bb.latMax || lon < bb.lonMin || lon > bb.lonMax) continue;
        if (pointInPolygon(lat, lon, foliage.polygons[pi])) {
          vegH[i] = foliage.canopyHeights[pi] ?? 10;
          break;
        }
      }
    }

    if (buildings?.polygons?.length > 0) {
      let candidates;
      const ti = buildings.tileIndex;
      if (ti) {
        const r = Math.max(0, Math.min(TILE_N16 - 1, Math.floor((lat - ti.latMin) / ti.latSpan * TILE_N16)));
        const c = Math.max(0, Math.min(TILE_N16 - 1, Math.floor((lon - ti.lonMin) / ti.lonSpan * TILE_N16)));
        candidates = ti.tiles[r * TILE_N16 + c];
      } else {
        candidates = buildings.polygons.map((_, j) => j);
      }
      for (const pi of candidates) {
        const bb = buildings.bboxes[pi];
        if (lat < bb.latMin || lat > bb.latMax || lon < bb.lonMin || lon > bb.lonMax) continue;
        if (pointInPolygon(lat, lon, buildings.polygons[pi])) {
          bldH[i] = buildings.heights[pi] ?? 5;
          break;
        }
      }
    }
  }
  return { vegH, bldH };
}

/**
 * Render a terrain profile SVG for the given elevation array.
 * Shows: terrain cross-section, earth-curvature effective terrain, Fresnel zone,
 * LOS line, TX/RX masts, and red obstruction highlight where terrain blocks the path.
 */
function drawTerrainProfile(elevs, txElev, rxElev, txHeight, rxHeight, distM, freqMHz, vegH = null, bldH = null) {
  const W = 240, H = 105;
  const n = elevs.length;
  const λ = 299792458 / (freqMHz * 1e6);
  const Re_eff = RE_EFF;
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

  // Max physical obstacle top per sample (terrain + vegetation or building)
  const maxObst = effective.map((e, i) => e + Math.max(vegH?.[i] ?? 0, bldH?.[i] ?? 0));

  // Y-scale bounds — include vegetation and building tops
  const allH = [
    ...maxObst,
    ...losH.map((h, i) => h + fresnelR[i]),
    txElev, rxElev,
  ];
  const yMin = Math.min(...allH) - 5;
  const yMax = Math.max(...allH) + 12;

  const toX = i => 2 + (i / (n - 1)) * (W - 4);
  const toY = h => 4 + (1 - (h - yMin) / (yMax - yMin)) * (H - 16);

  // Base terrain polygon (earth-curvature corrected)
  const terrainTopPts  = effective.map((e, i) => `${toX(i).toFixed(1)},${toY(e).toFixed(1)}`);
  const terrainRevPts  = [...effective].reverse().map((e, i) => `${toX(n-1-i).toFixed(1)},${toY(e).toFixed(1)}`);
  const terrainPoly    = `M${terrainTopPts.join(' L')} L${toX(n - 1).toFixed(1)},${H} L${toX(0).toFixed(1)},${H} Z`;

  // Vegetation polygon — stacked on terrain, where vegH > 0 the polygon is visible
  const vegTopPts = effective.map((e, i) => `${toX(i).toFixed(1)},${toY(e + (vegH?.[i] ?? 0)).toFixed(1)}`);
  const vegPoly   = `M${vegTopPts.join(' L')} L${terrainRevPts.join(' L')} Z`;

  // Building polygon — stacked on terrain, where bldH > 0 the polygon is visible
  const bldTopPts = effective.map((e, i) => `${toX(i).toFixed(1)},${toY(e + (bldH?.[i] ?? 0)).toFixed(1)}`);
  const bldPoly   = `M${bldTopPts.join(' L')} L${terrainRevPts.join(' L')} Z`;

  // Combined max-obstacle polygon — used for the red "blocked" highlight
  const maxObstPts  = maxObst.map((h, i) => `${toX(i).toFixed(1)},${toY(h).toFixed(1)}`);
  const maxObstPoly = `M${maxObstPts.join(' L')} L${toX(n - 1).toFixed(1)},${H} L${toX(0).toFixed(1)},${H} Z`;

  // Fresnel zone polygon and border polylines
  const fzTopPts = losH.map((h, i) => `${toX(i).toFixed(1)},${toY(h + fresnelR[i]).toFixed(1)}`);
  const fzBotPts = losH.map((h, i) => `${toX(i).toFixed(1)},${toY(h - fresnelR[i]).toFixed(1)}`);
  const fzPoly = `M${fzTopPts.join(' L')} L${[...fzBotPts].reverse().join(' L')} Z`;

  // LOS line (antenna tip to antenna tip)
  const losLine = `M${toX(0).toFixed(1)},${toY(txH).toFixed(1)} L${toX(n - 1).toFixed(1)},${toY(rxH).toFixed(1)}`;

  // Clip path: region visually above the LOS line (obstruction highlight)
  const obstrClip = `M${toX(0).toFixed(1)},0 L${toX(n - 1).toFixed(1)},0 L${toX(n - 1).toFixed(1)},${toY(rxH).toFixed(1)} L${toX(0).toFixed(1)},${toY(txH).toFixed(1)} Z`;

  // TX / RX masts
  const txX = toX(0).toFixed(1);
  const rxX = toX(n - 1).toFixed(1);

  const distLabel = distM >= 1000 ? `${(distM / 1000).toFixed(2)} km` : `${distM.toFixed(0)} m`;

  // Legend — only show vegetation/building entries if present along the path
  const hasVeg = vegH && vegH.some(v => v > 0);
  const hasBld = bldH && bldH.some(v => v > 0);
  let legendX = 4;
  const legendItems = [];
  if (hasVeg) { legendItems.push({ color: 'rgba(34,197,94,0.8)', label: 'Veg' }); }
  if (hasBld) { legendItems.push({ color: 'rgba(100,116,139,0.9)', label: 'Bldg' }); }
  const legendSvg = legendItems.map(({ color, label }) => {
    const lx = legendX;
    legendX += 26;
    return `<rect x="${lx}" y="4" width="7" height="5" fill="${color}"/><text x="${lx + 9}" y="9" fill="#9ca3af" font-size="5.5" font-family="sans-serif">${label}</text>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="display:block;border-radius:4px;background:#0d1117;margin-bottom:8px;border:1px solid #1e2a3a">
  <defs><clipPath id="p2p-above-los"><path d="${obstrClip}"/></clipPath></defs>
  <path d="${fzPoly}" fill="rgba(97,218,251,0.07)"/>
  <path d="${terrainPoly}" fill="#3d2e1a" stroke="#7a6040" stroke-width="0.8"/>
  <path d="${vegPoly}" fill="rgba(34,197,94,0.45)" stroke="rgba(34,197,94,0.65)" stroke-width="0.6"/>
  <path d="${bldPoly}" fill="rgba(100,116,139,0.65)" stroke="rgba(148,163,184,0.75)" stroke-width="0.6"/>
  <path d="${maxObstPoly}" fill="rgba(239,68,68,0.45)" clip-path="url(#p2p-above-los)"/>
  <polyline points="${fzTopPts.join(' ')}" fill="none" stroke="rgba(97,218,251,0.30)" stroke-width="0.7" stroke-dasharray="3,2"/>
  <polyline points="${fzBotPts.join(' ')}" fill="none" stroke="rgba(97,218,251,0.30)" stroke-width="0.7" stroke-dasharray="3,2"/>
  <path d="${losLine}" fill="none" stroke="#facc15" stroke-width="1.5" stroke-dasharray="5,3"/>
  <line x1="${txX}" y1="${toY(txElev).toFixed(1)}" x2="${txX}" y2="${toY(txH).toFixed(1)}" stroke="#61dafb" stroke-width="2" stroke-linecap="round"/>
  <circle cx="${txX}" cy="${toY(txH).toFixed(1)}" r="2.5" fill="#61dafb"/>
  <line x1="${rxX}" y1="${toY(rxElev).toFixed(1)}" x2="${rxX}" y2="${toY(rxH).toFixed(1)}" stroke="#4ade80" stroke-width="2" stroke-linecap="round"/>
  <circle cx="${rxX}" cy="${toY(rxH).toFixed(1)}" r="2.5" fill="#4ade80"/>
  <text x="${txX}" y="${H - 1}" text-anchor="middle" fill="#61dafb" font-size="7" font-family="sans-serif">A</text>
  <text x="${rxX}" y="${H - 1}" text-anchor="middle" fill="#4ade80" font-size="7" font-family="sans-serif">B</text>
  <text x="${(W / 2).toFixed(0)}" y="${H - 1}" text-anchor="middle" fill="#6b7280" font-size="7" font-family="sans-serif">${distLabel}</text>
  ${legendSvg}
</svg>`;
}

async function computeLinkBudget() {
  if (!pointA || !pointB) return;

  setStatus('Fetching elevation and obstacle data…');
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

  // Fetch elevation + foliage + buildings in parallel (foliage/buildings failing is non-fatal)
  const PAD = 0.003;
  const latMin = Math.min(pointA.lat, pointB.lat) - PAD;
  const latMax = Math.max(pointA.lat, pointB.lat) + PAD;
  const lonMin = Math.min(pointA.lng, pointB.lng) - PAD;
  const lonMax = Math.max(pointA.lng, pointB.lng) + PAD;

  let elevs, foliage = null, buildings = null;
  try {
    [elevs] = await Promise.all([fetchElevations(profilePoints)]);
  } catch (e) {
    setStatus(`Elevation fetch failed: ${e.message}`, true);
    return;
  }

  // Fetch foliage and buildings in parallel, non-fatal if unavailable
  [foliage, buildings] = await Promise.all([
    fetchFoliage(latMin, latMax, lonMin, lonMax).catch(e => { console.warn('[p2p] foliage fetch failed:', e.message); return null; }),
    fetchBuildings(latMin, latMax, lonMin, lonMax).catch(e => { console.warn('[p2p] buildings fetch failed:', e.message); return null; }),
  ]);

  const txElev = elevs[0];
  const rxElev = elevs[PROFILE_SAMPLES - 1];

  // Build lat/lon arrays needed by foliage/building loss functions
  const profileLats = new Float64Array(PROFILE_SAMPLES);
  const profileLons = new Float64Array(PROFILE_SAMPLES);
  for (let i = 0; i < PROFILE_SAMPLES; i++) {
    profileLats[i] = profilePoints[i].latitude;
    profileLons[i] = profilePoints[i].longitude;
  }

  // Per-sample obstacle heights (for visualization)
  const { vegH, bldH } = _sampleObstacleHeights(profilePoints, foliage, buildings);

  // Geometric LoS (pure knife-edge, no Fresnel padding) — for actual diffraction loss
  const geoResult = checkLoS(txElev, rxElev, elevs, txHeight, rxHeight, distM, freqMHz, false);
  // Fresnel-zone clearance — quality indicator only
  const fresnelResult = checkLoS(txElev, rxElev, elevs, txHeight, rxHeight, distM, freqMHz, true);

  // Foliage and building losses
  const foliageLoss = foliage
    ? foliageLossDb(profileLats, profileLons, elevs, txHeight, rxHeight,
        foliage.polygons, foliage.bboxes, foliage.canopyHeights, foliage.factors,
        foliage.tileIndex, distM, undefined)
    : 0;
  const bldLoss = buildings
    ? buildingLossDb(profileLats, profileLons, elevs, txHeight, rxHeight,
        buildings.polygons, buildings.bboxes, buildings.heights,
        buildings.tileIndex, distM, undefined)
    : 0;

  const pathLoss    = fspl(distM, freqMHz);
  const totalExtras = geoResult.diffractionLossDb + foliageLoss + bldLoss;
  const rxPower     = txPower + txGain + rxGain - pathLoss - totalExtras;
  const margin      = rxPower - rxSens;

  _updateP2PLineLabel(margin, rxPower, distM);

  console.info(`[p2p] dist=${(distM/1000).toFixed(2)} km  FSPL=${pathLoss.toFixed(1)} dB  diff=${geoResult.diffractionLossDb.toFixed(1)} dB  foliage=${foliageLoss.toFixed(1)} dB  bld=${bldLoss.toFixed(1)} dB  rxPower=${rxPower.toFixed(1)} dBm  margin=${margin.toFixed(1)} dB`);

  const profileSvg = drawTerrainProfile(elevs, txElev, rxElev, txHeight, rxHeight, distM, freqMHz, vegH, bldH);

  const fmt = v => v.toFixed(1);
  const diffColor = geoResult.diffractionLossDb > 20 ? '#fc8181' : geoResult.diffractionLossDb > 6 ? '#facc15' : '';
  const vegColor  = foliageLoss > 15 ? '#fc8181' : foliageLoss > 5 ? '#facc15' : '#4ade80';
  const bldColor  = bldLoss > 15 ? '#fc8181' : bldLoss > 5 ? '#facc15' : '#4ade80';
  const geoLabel = geoResult.los
    ? '<span style="color:#4ade80">✓ Clear</span>'
    : '<span style="color:#fc8181">✗ Blocked</span>';
  const fresnelLabel = fresnelResult.los
    ? '<span style="color:#4ade80">✓ Clear</span>'
    : (geoResult.los
        ? '<span style="color:#facc15">⚠ Partial</span>'
        : '<span style="color:#fc8181">✗ Blocked</span>');

  const rows = [
    ['Distance',            `${(distM / 1000).toFixed(2)} km`, ''],
    ['Free-space loss',     `${fmt(pathLoss)} dB`, ''],
    ['Diffraction loss',    `${fmt(geoResult.diffractionLossDb)} dB`, diffColor],
    ...(foliageLoss > 0 ? [['Foliage loss',  `${fmt(foliageLoss)} dB`, vegColor]] : []),
    ...(bldLoss > 0     ? [['Building loss', `${fmt(bldLoss)} dB`, bldColor]] : []),
    ['Total path loss',     `${fmt(pathLoss + totalExtras)} dB`, ''],
    ['TX EIRP',             `${fmt(txPower + txGain)} dBm`, ''],
    ['Received power',      `${fmt(rxPower)} dBm`, ''],
    ['Link margin',         `${fmt(margin)} dB`, margin >= 10 ? '#4ade80' : margin >= 0 ? '#facc15' : '#fc8181'],
    ['Geometric LoS',       geoLabel, null],
    ['Fresnel zone',        fresnelLabel, null],
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
  document.getElementById('btn-p2p-update').addEventListener('click', async () => {
    if (!pointA || !pointB) {
      setStatus('Pick point A and point B first, then recalculate.', true);
      return;
    }
    await computeLinkBudget();
  });
  document.getElementById('btn-p2p-clear').addEventListener('click', () => {
    resetState();
    clearResults();
    document.getElementById('p2p-pick-hint').classList.add('hidden');
    document.getElementById('btn-p2p-pick').disabled = false;
    picking = false;
    map.getContainer().style.cursor = '';
  });

  // ── Best Relay Path panel ──
  document.getElementById('btn-find-path').addEventListener('click', _runPathFinder);
  document.addEventListener('repeaters:changed', _refreshPathSelects);
  // populate once on init (nodes may already be loaded from DB)
  setTimeout(_refreshPathSelects, 0);

  // Context-menu shortcut: pre-select the right-clicked node as "From" and switch to Tools tab
  document.addEventListener('path:from-node', e => {
    document.querySelector('.tab-btn[data-tab="tools"]')?.click();
    // Expand the Best Relay Path panel if it's collapsed
    document.querySelectorAll('#tab-tools details.panel').forEach(d => {
      if (d.querySelector('summary')?.textContent.includes('Best Relay Path')) d.open = true;
    });
    _refreshPathSelects();
    const fromSel = document.getElementById('path-from');
    if (fromSel) fromSel.value = String(e.detail.id);
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

// ─── Best Relay Path helpers ─────────────────────────────────────

function _refreshPathSelects() {
  const nodes = state.repeaters;
  const fromSel = document.getElementById('path-from');
  const toSel   = document.getElementById('path-to');
  if (!fromSel || !toSel) return;

  const savedFrom = fromSel.value;
  const savedTo   = toSel.value;

  fromSel.innerHTML = '';
  toSel.innerHTML   = '';

  if (nodes.length === 0) {
    fromSel.innerHTML = toSel.innerHTML = '<option value="">— no nodes —</option>';
    return;
  }

  for (const r of nodes) {
    const opt = `<option value="${r.id}">${r.name}</option>`;
    fromSel.insertAdjacentHTML('beforeend', opt);
    toSel.insertAdjacentHTML('beforeend', opt);
  }

  // Restore previous selection if still valid
  if (savedFrom && [...fromSel.options].some(o => o.value === savedFrom)) fromSel.value = savedFrom;
  if (savedTo   && [...toSel.options].some(o => o.value === savedTo))     toSel.value   = savedTo;

  // Default: from = first node, to = last node (different if possible)
  if (nodes.length >= 2 && fromSel.value === toSel.value) {
    toSel.value = nodes[nodes.length - 1].id;
  }
}

function _clearPathLayers() {
  _pathPolylines.forEach(l => map.removeLayer(l));
  _pathMarkers.forEach(m => map.removeLayer(m));
  _pathPolylines = [];
  _pathMarkers   = [];
}

function _marginColor(margin) {
  if (margin >= 15) return '#4ade80';
  if (margin >= 5)  return '#86efac';
  if (margin >= 0)  return '#facc15';
  if (margin >= -5) return '#fb923c';
  return '#f87171';
}

function _renderPath(result) {
  const { path, bottleneck, numHops, edgeDistances } = result;
  _clearPathLayers();

  // Draw hop segments on map
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1].node;
    const b = path[i].node;
    const m = path[i].incomingMargin;
    const color = _marginColor(m);
    _pathPolylines.push(
      L.polyline([[a.lat, a.lon], [b.lat, b.lon]], { color, weight: 3, opacity: 0.85 }).addTo(map)
    );
  }

  // Draw node markers along the path
  for (let i = 0; i < path.length; i++) {
    const { node } = path[i];
    const isEndpoint = (i === 0 || i === path.length - 1);
    const icon = L.divIcon({
      html: `<div style="width:${isEndpoint ? 14 : 10}px;height:${isEndpoint ? 14 : 10}px;border-radius:50%;background:${isEndpoint ? '#facc15' : '#a78bfa'};border:2px solid #fff;"></div>`,
      iconSize: [14, 14], iconAnchor: [7, 7], className: '',
    });
    _pathMarkers.push(L.marker([node.lat, node.lon], { icon }).addTo(map).bindTooltip(node.name, { permanent: false }));
  }

  // Fit map
  const latlngs = path.map(p => [p.node.lat, p.node.lon]);
  if (latlngs.length > 1) map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });

  // Build results HTML
  const bottleneckColor = _marginColor(bottleneck);
  let html = `<div class="path-summary">
    <span class="path-hops">${numHops} hop${numHops !== 1 ? 's' : ''}</span>
    <span class="path-bottleneck" style="color:${bottleneckColor}">Bottleneck: ${bottleneck.toFixed(1)} dB</span>
  </div>
  <table class="p2p-table"><tbody>`;

  for (let i = 0; i < path.length; i++) {
    const { node, incomingMargin } = path[i];
    const isFirst = i === 0;
    const distStr = i > 0 ? ` — ${(edgeDistances[i - 1] / 1000).toFixed(1)} km` : '';
    const marginStr = incomingMargin !== null
      ? `<span style="color:${_marginColor(incomingMargin)}">${incomingMargin >= 0 ? '+' : ''}${incomingMargin.toFixed(1)} dB</span>`
      : '';
    html += `<tr>
      <td class="p2p-key">${isFirst ? '◉' : '●'} ${node.name}</td>
      <td class="p2p-val">${marginStr}${distStr}</td>
    </tr>`;
  }
  html += '</tbody></table>';

  document.getElementById('path-results').innerHTML = html;
  document.getElementById('path-status').textContent =
    bottleneck >= 0 ? `Path found — bottleneck +${bottleneck.toFixed(1)} dB` : `Path found but link is marginal (${bottleneck.toFixed(1)} dB)`;
  document.getElementById('path-status').className = 'hint';
  document.getElementById('path-status').classList.remove('hidden');
}

async function _runPathFinder() {
  const fromId = parseInt(document.getElementById('path-from').value);
  const toId   = parseInt(document.getElementById('path-to').value);
  if (isNaN(fromId) || isNaN(toId) || fromId === toId) {
    document.getElementById('path-status').textContent = 'Select two different nodes.';
    document.getElementById('path-status').className = 'hint hint-error';
    document.getElementById('path-status').classList.remove('hidden');
    return;
  }

  const rxSens     = parseFloat(document.getElementById('p2p-rx-sens').value)   || -137;
  const rxGain     = parseFloat(document.getElementById('p2p-rx-gain').value)   || 2;
  const useFresnel = document.getElementById('path-use-fresnel').checked;

  document.getElementById('path-status').textContent = 'Computing…';
  document.getElementById('path-status').className = 'hint';
  document.getElementById('path-status').classList.remove('hidden');
  document.getElementById('path-results').innerHTML = '';
  _clearPathLayers();

  try {
    const nodes = state.repeaters;
    const result = await findBestPath(nodes, fromId, toId, rxSens, rxGain, useFresnel);
    if (!result) {
      document.getElementById('path-status').textContent = 'No path found — nodes may be out of range or all links blocked.';
      document.getElementById('path-status').className = 'hint hint-error';
      return;
    }
    _renderPath(result);
    console.info(`[pathfinder] ${result.numHops}-hop path, bottleneck=${result.bottleneck.toFixed(1)} dB`);
  } catch (err) {
    document.getElementById('path-status').textContent = `Error: ${err.message}`;
    document.getElementById('path-status').className = 'hint hint-error';
    console.error('[pathfinder]', err);
  }
}
