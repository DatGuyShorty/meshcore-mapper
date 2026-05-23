import { RE_EFF, pointInPolygon } from './propagation.js';

const TILE_N16 = 16; // matches foliage.js / buildings.js tile index resolution

export function sampleObstacleHeights(profilePoints, foliage, buildings) {
  const n = profilePoints.length;
  const vegH = new Float32Array(n);
  const bldH = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const lat = profilePoints[i].latitude;
    const lon = profilePoints[i].longitude;

    if (foliage?.polygons?.length > 0) {
      const candidates = _candidatesAtPoint(lat, lon, foliage.tileIndex, foliage.polygons.length);
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
      const candidates = _candidatesAtPoint(lat, lon, buildings.tileIndex, buildings.polygons.length);
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

function _candidatesAtPoint(lat, lon, tileIndex, count) {
  if (!tileIndex) return Array.from({ length: count }, (_, i) => i);
  const r = Math.max(0, Math.min(TILE_N16 - 1, Math.floor((lat - tileIndex.latMin) / tileIndex.latSpan * TILE_N16)));
  const c = Math.max(0, Math.min(TILE_N16 - 1, Math.floor((lon - tileIndex.lonMin) / tileIndex.lonSpan * TILE_N16)));
  return tileIndex.tiles[r * TILE_N16 + c];
}

export function drawTerrainProfile(elevs, txElev, rxElev, txHeight, rxHeight, distM, freqMHz, vegH = null, bldH = null) {
  const W = 240, H = 105;
  const n = elevs.length;
  const lambda = 299792458 / (freqMHz * 1e6);
  const txH = txElev + txHeight;
  const rxH = rxElev + rxHeight;

  const effective = [];
  const losH = [];
  const fresnelR = [];
  for (let i = 0; i < n; i++) {
    const frac = i / (n - 1);
    const d1 = frac * distM;
    const d2 = distM - d1;
    const bulge = (d1 > 0 && d2 > 0) ? d1 * d2 / (2 * RE_EFF) : 0;
    effective.push(elevs[i] + bulge);
    losH.push(txH + (rxH - txH) * frac);
    fresnelR.push((d1 > 0 && d2 > 0) ? Math.sqrt(lambda * d1 * d2 / distM) : 0);
  }

  const maxObst = effective.map((e, i) => e + Math.max(vegH?.[i] ?? 0, bldH?.[i] ?? 0));
  const allH = [
    ...maxObst,
    ...losH.map((h, i) => h + fresnelR[i]),
    txElev, rxElev,
  ];
  const yMin = Math.min(...allH) - 5;
  const yMax = Math.max(...allH) + 12;

  const toX = i => 2 + (i / (n - 1)) * (W - 4);
  const toY = h => 4 + (1 - (h - yMin) / (yMax - yMin)) * (H - 16);

  const terrainTopPts = effective.map((e, i) => `${toX(i).toFixed(1)},${toY(e).toFixed(1)}`);
  const terrainRevPts = [...effective].reverse().map((e, i) => `${toX(n - 1 - i).toFixed(1)},${toY(e).toFixed(1)}`);
  const terrainPoly = `M${terrainTopPts.join(' L')} L${toX(n - 1).toFixed(1)},${H} L${toX(0).toFixed(1)},${H} Z`;

  const vegTopPts = effective.map((e, i) => `${toX(i).toFixed(1)},${toY(e + (vegH?.[i] ?? 0)).toFixed(1)}`);
  const vegPoly = `M${vegTopPts.join(' L')} L${terrainRevPts.join(' L')} Z`;
  const bldTopPts = effective.map((e, i) => `${toX(i).toFixed(1)},${toY(e + (bldH?.[i] ?? 0)).toFixed(1)}`);
  const bldPoly = `M${bldTopPts.join(' L')} L${terrainRevPts.join(' L')} Z`;

  const maxObstPts = maxObst.map((h, i) => `${toX(i).toFixed(1)},${toY(h).toFixed(1)}`);
  const maxObstPoly = `M${maxObstPts.join(' L')} L${toX(n - 1).toFixed(1)},${H} L${toX(0).toFixed(1)},${H} Z`;

  const fzTopPts = losH.map((h, i) => `${toX(i).toFixed(1)},${toY(h + fresnelR[i]).toFixed(1)}`);
  const fzBotPts = losH.map((h, i) => `${toX(i).toFixed(1)},${toY(h - fresnelR[i]).toFixed(1)}`);
  const fzPoly = `M${fzTopPts.join(' L')} L${[...fzBotPts].reverse().join(' L')} Z`;
  const losLine = `M${toX(0).toFixed(1)},${toY(txH).toFixed(1)} L${toX(n - 1).toFixed(1)},${toY(rxH).toFixed(1)}`;
  const obstrClip = `M${toX(0).toFixed(1)},0 L${toX(n - 1).toFixed(1)},0 L${toX(n - 1).toFixed(1)},${toY(rxH).toFixed(1)} L${toX(0).toFixed(1)},${toY(txH).toFixed(1)} Z`;

  const txX = toX(0).toFixed(1);
  const rxX = toX(n - 1).toFixed(1);
  const distLabel = distM >= 1000 ? `${(distM / 1000).toFixed(2)} km` : `${distM.toFixed(0)} m`;

  const hasVeg = vegH && vegH.some(v => v > 0);
  const hasBld = bldH && bldH.some(v => v > 0);
  let legendX = 4;
  const legendItems = [];
  if (hasVeg) legendItems.push({ color: 'rgba(34,197,94,0.8)', label: 'Veg' });
  if (hasBld) legendItems.push({ color: 'rgba(100,116,139,0.9)', label: 'Bldg' });
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
