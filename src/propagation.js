/**
 * propagation.js
 * Pure LoRa radio propagation calculations.
 * No DOM, no map, no network — safe to call from any context including a future optimizer.
 */

// ─── Haversine distance (metres) ────────────────────────────────
/**
 * @param {number} lat1 @param {number} lon1
 * @param {number} lat2 @param {number} lon2
 * @returns {number} distance in metres
 */
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ─── Free-Space Path Loss (dB) ───────────────────────────────────
// FSPL = 20·log10(d_m) + 20·log10(f_hz) − 147.55
/**
 * @param {number} distanceM - distance in metres (clamped to ≥1)
 * @param {number} freqMHz   - frequency in MHz
 * @returns {number} path loss in dB
 */
export function fspl(distanceM, freqMHz) {
  if (distanceM < 1) distanceM = 1;
  return 20 * Math.log10(distanceM) + 20 * Math.log10(freqMHz * 1e6) - 147.55;
}

// ─── Line-of-Sight with knife-edge diffraction ───────────────────
/**
 * Check LoS along a pre-sampled terrain profile and compute diffraction loss.
 * Uses the Fresnel-Kirchhoff diffraction parameter (ITU-R P.526).
 * Fresnel clearance is reported separately; it is not added to terrain height
 * for diffraction loss.
 *
 * @param {number}   txElevM      - TX ground elevation (m AMSL)
 * @param {number}   rxElevM      - RX ground elevation (m AMSL)
 * @param {number[]} profileElevs - terrain elevations along path (incl. TX and RX ends)
 * @param {number}   txHeightM    - TX antenna height above ground (m)
 * @param {number}   rxHeightM    - RX antenna height above ground (m)
 * @param {number}   totalDistM   - total path length (m)
 * @param {number}   freqMHz      - frequency (MHz)
 * @param {boolean}  useFresnel   - use first Fresnel zone clearance for the returned `los` flag
 * @returns {{ los: boolean, diffractionLossDb: number }}
 */
// B6: single source of truth for the effective Earth radius used everywhere in the propagation model
export const RE_EFF = 6371000 * (4 / 3); // k = 4/3, standard atmosphere

// P5: cached wavelength and sample-fraction arrays — computed once per unique input, reused thereafter
const _lambdaCache = new Map();
const _fracsCache  = new Map();

function _getLambda(freqMHz) {
  if (!_lambdaCache.has(freqMHz)) _lambdaCache.set(freqMHz, 299792458 / (freqMHz * 1e6));
  return _lambdaCache.get(freqMHz);
}

function _getFracs(n) {
  if (!_fracsCache.has(n)) {
    const f = new Float64Array(n);
    for (let i = 0; i < n; i++) f[i] = i / (n - 1);
    _fracsCache.set(n, f);
  }
  return _fracsCache.get(n);
}

function _knifeEdgeLossDb(v) {
  if (v <= -0.78) return 0;
  return Math.max(0, 6.9 + 20 * Math.log10(Math.sqrt((v - 0.1) ** 2 + 1) + v - 0.1));
}

function _deygoutSectionLoss(obstacleHeights, distsM, lambdaM, i0, i1, h0, h1) {
  if (i1 - i0 < 2) return 0;

  const sectionDist = distsM[i1] - distsM[i0];
  if (sectionDist <= 0) return 0;

  let maxV = -Infinity;
  let maxIdx = -1;

  for (let i = i0 + 1; i < i1; i++) {
    const d1 = distsM[i] - distsM[i0];
    const d2 = distsM[i1] - distsM[i];
    if (d1 <= 0 || d2 <= 0) continue;
    const lineH = h0 + (h1 - h0) * (d1 / sectionDist);
    const h = obstacleHeights[i] - lineH;
    const v = h * Math.sqrt(2 * sectionDist / (lambdaM * d1 * d2));
    if (v > maxV) {
      maxV = v;
      maxIdx = i;
    }
  }

  if (maxIdx < 0 || maxV <= -0.78) return 0;

  const mainLoss = _knifeEdgeLossDb(maxV);
  const peakH = obstacleHeights[maxIdx];
  const leftLoss = _deygoutSectionLoss(obstacleHeights, distsM, lambdaM, i0, maxIdx, h0, peakH);
  const rightLoss = _deygoutSectionLoss(obstacleHeights, distsM, lambdaM, maxIdx, i1, peakH, h1);
  return mainLoss + leftLoss + rightLoss;
}

function _normalizeAzimuthDeg(deg) {
  let a = deg % 360;
  if (a < 0) a += 360;
  return a;
}

function _shortestAngleDiffDeg(a, b) {
  const d = Math.abs(_normalizeAzimuthDeg(a) - _normalizeAzimuthDeg(b));
  return d > 180 ? 360 - d : d;
}

export function bearingDeg(lat1, lon1, lat2, lon2) {
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return _normalizeAzimuthDeg(Math.atan2(y, x) * 180 / Math.PI);
}

export function antennaPatternOffsetDb(pattern, boresightDeg, targetBearingDeg) {
  if (!pattern || pattern === 'omni') return 0;

  const offAxis = _shortestAngleDiffDeg(boresightDeg ?? 0, targetBearingDeg ?? 0);
  if (typeof pattern === 'string') {
    if (pattern === 'sector120') {
      if (offAxis <= 60) return 0;
      if (offAxis <= 90) return -3;
      if (offAxis <= 120) return -10;
      return -20;
    }
    if (pattern === 'sector90') {
      if (offAxis <= 45) return 0;
      if (offAxis <= 70) return -3;
      if (offAxis <= 100) return -10;
      return -20;
    }
    return 0;
  }

  const hpbwDeg = Math.max(1, Number(pattern.hpbwDeg) || 360);
  const maxAttenDb = Math.max(0, Number(pattern.maxAttenDb) || 20);
  const attenDb = Math.min(maxAttenDb, 12 * (offAxis / hpbwDeg) ** 2);
  return -attenDb;
}

export function checkLoS(txElevM, rxElevM, profileElevs, txHeightM, rxHeightM, totalDistM, freqMHz, useFresnel, diffractionModel = 'knife-edge') {
  const n = profileElevs.length;
  if (n < 2) {
    return {
      los: true,
      geometricLos: true,
      fresnelClear: true,
      diffractionLossDb: 0,
      diffractionModel,
      minClearanceM: Infinity,
      minFresnelClearanceRatio: Infinity,
    };
  }

  const txH  = txElevM + txHeightM;
  const rxH  = rxElevM + rxHeightM;
  const λ    = _getLambda(freqMHz);
  const fracs = _getFracs(n);
  const distsM = new Float64Array(n);
  const obstacleHeights = new Float64Array(n);
  obstacleHeights[0] = txH;
  obstacleHeights[n - 1] = rxH;

  // Earth-curvature correction using effective Earth radius (k = 4/3, standard atmosphere).
  // Adds d1*d2/(2*Re_eff) to each terrain sample, accounting for the planet's curvature
  // over long paths.  At 15 km the peak bulge is ~14 m — significant for marginal links.

  let maxV = -Infinity;
  let minClearanceM = Infinity;
  let minFresnelClearanceRatio = Infinity;

  for (let i = 1; i < n - 1; i++) {
    const d1    = fracs[i] * totalDistM;
    const d2    = totalDistM - d1;
    const lineH = txH + (rxH - txH) * fracs[i];
    const r1    = Math.sqrt(λ * d1 * d2 / totalDistM);
    const bulge = d1 * d2 / (2 * RE_EFF);              // effective terrain rise due to Earth curvature
    const terrainH = profileElevs[i] + bulge;
    distsM[i] = d1;
    obstacleHeights[i] = terrainH;
    const clearanceM = lineH - terrainH;
    const h     = terrainH - lineH;
    const v     = h * Math.sqrt(2 * totalDistM / (λ * d1 * d2));
    if (v > maxV) maxV = v;
    if (clearanceM < minClearanceM) minClearanceM = clearanceM;
    if (r1 > 0) {
      const ratio = clearanceM / r1;
      if (ratio < minFresnelClearanceRatio) minFresnelClearanceRatio = ratio;
    }
  }
  distsM[0] = 0;
  distsM[n - 1] = totalDistM;

  const geometricLos = maxV < 0;
  const fresnelClear = minFresnelClearanceRatio >= 1;
  const los = useFresnel ? fresnelClear : geometricLos;

  if (maxV < -0.7) {
    return {
      los,
      geometricLos,
      fresnelClear,
      diffractionLossDb: 0,
      diffractionModel,
      minClearanceM,
      minFresnelClearanceRatio,
    };
  }

  const singleEdgeLoss = _knifeEdgeLossDb(maxV);
  const deygoutLoss = diffractionModel === 'deygout'
    ? _deygoutSectionLoss(obstacleHeights, distsM, λ, 0, n - 1, txH, rxH)
    : singleEdgeLoss;
  const loss = diffractionModel === 'deygout'
    ? Math.max(singleEdgeLoss, deygoutLoss)
    : singleEdgeLoss;

  return {
    los,
    geometricLos,
    fresnelClear,
    diffractionLossDb: Math.max(0, loss),
    diffractionModel: diffractionModel === 'deygout' && deygoutLoss >= singleEdgeLoss ? 'deygout' : 'knife-edge',
    minClearanceM,
    minFresnelClearanceRatio,
  };
}

export function profileSampleCount(distanceM, targetSpacingM = 50, minSamples = 16, maxSamples = 512) {
  if (!Number.isFinite(distanceM) || distanceM <= 0) return minSamples;
  return Math.max(minSamples, Math.min(maxSamples, Math.ceil(distanceM / targetSpacingM) + 1));
}

export function earthBulgeM(fraction, totalDistM) {
  const d1 = fraction * totalDistM;
  const d2 = totalDistM - d1;
  return (d1 > 0 && d2 > 0) ? d1 * d2 / (2 * RE_EFF) : 0;
}

// ─── Shadow fading (log-normal fading) ──────────────────────────────
// Log-normal fading model: L = L_0 + 10n·log10(d) + X_σ
// where X_σ ~ N(0, σ) is Gaussian random variable (in dB)
// Typical σ = 4–8 dB for LoRa links in suburban/urban areas
/**
 * Apply log-normal shadow fading to path loss.
 * @param {number} sigmaDbd - standard deviation of fading (dB); 0 = disabled
 * @returns {number} shadow fading value (dB), normally distributed with mean 0 and std dev σ
 */
export function shadowFadingDb(sigmaDbd, seedKey = null) {
  if (!Number.isFinite(sigmaDbd) || sigmaDbd <= 0) return 0;

  let u1;
  let u2;
  if (seedKey == null) {
    // Backward-compatible random mode.
    u1 = Math.max(Number.EPSILON, Math.random());
    u2 = Math.random();
  } else {
    // Deterministic mode for stable repeated calculations with unchanged inputs.
    const seedA = _fnv1a32(`${seedKey}|a`);
    const seedB = _fnv1a32(`${seedKey}|b`);
    u1 = Math.max(Number.EPSILON, _unitFromSeed(seedA));
    u2 = _unitFromSeed(seedB);
  }

  // Box-Muller transform: convert two uniform RVs to Gaussian
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return sigmaDbd * z;
}

function _fnv1a32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function _unitFromSeed(seed) {
  // LCG step; returns [0, 1).
  const next = (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0;
  return next / 4294967296;
}
// ─── FUTURE: Multi-edge diffraction models ──────────────────────────────────────────────────────────────────────────────────────────────
// Current: Deygout multi-edge (primary) + single knife-edge fallback lower bound
// TODO: Rounded obstacle diffraction — smooth transitions for non-sharp peaks
// TODO: Antenna patterns — directional gain (azimuth/elevation masks) per antenna
export function segmentPolygonIntervals(lat1, lon1, lat2, lon2, poly) {
  if (!poly || poly.length < 3) return [];

  const ts = [0, 1];
  const dx = lon2 - lon1;
  const dy = lat2 - lat1;
  const EPS = 1e-9;

  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [y3, x3] = poly[j];
    const [y4, x4] = poly[i];
    const sx = x4 - x3;
    const sy = y4 - y3;
    const denom = dx * sy - dy * sx;
    if (Math.abs(denom) < EPS) continue;

    const qpx = x3 - lon1;
    const qpy = y3 - lat1;
    const t = (qpx * sy - qpy * sx) / denom;
    const u = (qpx * dy - qpy * dx) / denom;
    if (t > EPS && t < 1 - EPS && u >= -EPS && u <= 1 + EPS) ts.push(t);
  }

  ts.sort((a, b) => a - b);
  const uniq = [];
  for (const t of ts) {
    if (uniq.length === 0 || Math.abs(t - uniq[uniq.length - 1]) > 1e-6) uniq.push(t);
  }

  const intervals = [];
  for (let i = 0; i < uniq.length - 1; i++) {
    const a = uniq[i];
    const b = uniq[i + 1];
    if (b - a < EPS) continue;
    const mid = (a + b) / 2;
    const lat = lat1 + (lat2 - lat1) * mid;
    const lon = lon1 + (lon2 - lon1) * mid;
    if (pointInPolygon(lat, lon, poly)) intervals.push([a, b]);
  }
  return intervals;
}


// P6: write directly into a Uint8ClampedArray — avoids one [r,g,b,a] allocation per pixel
/**
 * @param {Uint8ClampedArray} buf  - ImageData buffer
 * @param {number}            base - byte offset (idx * 4)
 * @param {number}            sigDbm
 * @param {number}            rxSens
 */
// Gradient stops: [normalised 0-1, r, g, b, alpha]
// 0 = at rxSens (threshold), 1 = strong signal (cap at -70 dBm)
const GRAD = [
  [0.00, 220,  40,   0, 120],  // red-orange  — just above threshold
  [0.25, 255, 160,   0, 145],  // amber
  [0.50, 230, 220,   0, 155],  // yellow
  [0.75,  80, 210,  30, 165],  // yellow-green
  [1.00,   0, 200,  90, 180],  // green       — strong signal
];

export function writePixel(buf, base, sigDbm, rxSens) {
  if (sigDbm < rxSens) {
    // Below threshold — dark red, semi-transparent
    buf[base]=70; buf[base+1]=0; buf[base+2]=0; buf[base+3]=70;
    return;
  }
  const CAP = rxSens + 50;                    // map [rxSens … rxSens+50 dB] → [0 … 1]
  const t = Math.min(1, (sigDbm - rxSens) / (CAP - rxSens));

  // Find which segment t falls in
  let i = 1;
  while (i < GRAD.length - 1 && t > GRAD[i][0]) i++;
  const lo = GRAD[i - 1], hi = GRAD[i];
  const f = (t - lo[0]) / (hi[0] - lo[0]);

  buf[base]   = Math.round(lo[1] + f * (hi[1] - lo[1]));
  buf[base+1] = Math.round(lo[2] + f * (hi[2] - lo[2]));
  buf[base+2] = Math.round(lo[3] + f * (hi[3] - lo[3]));
  buf[base+3] = Math.round(lo[4] + f * (hi[4] - lo[4]));
}

// ─── Bilinear elevation interpolation ───────────────────────────
/**
 * Sample a flat row-major elevation grid at an arbitrary lat/lon using bilinear interpolation.
 * @param {number} lat @param {number} lon
 * @param {number[]} grid  - flat [row * res + col] elevation array
 * @param {number} res     - grid resolution (same for rows and cols)
 * @param {number} latMin @param {number} latMax @param {number} lonMin @param {number} lonMax
 * @returns {number} interpolated elevation (m)
 */
export function bilinearElev(lat, lon, grid, res, latMin, latMax, lonMin, lonMax) {
  if (!grid || res <= 1) return grid?.[0] ?? 0;
  const latSpan = latMax - latMin;
  const lonSpan = lonMax - lonMin;
  if (latSpan === 0 || lonSpan === 0) return grid[0] ?? 0;
  const cFrac = (lon - lonMin) / (lonMax - lonMin) * (res - 1);
  const rFrac = (latMax - lat) / (latMax - latMin) * (res - 1);
  const c0 = Math.max(0, Math.min(res - 2, Math.floor(cFrac)));
  const r0 = Math.max(0, Math.min(res - 2, Math.floor(rFrac)));
  const tc = cFrac - c0, tr = rFrac - r0;
  return grid[r0*res+c0]*(1-tc)*(1-tr)
       + grid[r0*res+c0+1]*tc*(1-tr)
       + grid[(r0+1)*res+c0]*(1-tc)*tr
       + grid[(r0+1)*res+c0+1]*tc*tr;
}

// ─── Point-in-polygon (lat/lon) ──────────────────────────────────
/**
 * Ray-casting point-in-polygon test for a [lat, lon] polygon.
 * @param {number} lat
 * @param {number} lon
 * @param {Array<[number,number]>} poly - array of [lat, lon] vertex pairs
 * @returns {boolean}
 */
export function pointInPolygon(lat, lon, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
