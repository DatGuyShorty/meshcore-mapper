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
 *
 * @param {number}   txElevM      - TX ground elevation (m AMSL)
 * @param {number}   rxElevM      - RX ground elevation (m AMSL)
 * @param {number[]} profileElevs - terrain elevations along path (incl. TX and RX ends)
 * @param {number}   txHeightM    - TX antenna height above ground (m)
 * @param {number}   rxHeightM    - RX antenna height above ground (m)
 * @param {number}   totalDistM   - total path length (m)
 * @param {number}   freqMHz      - frequency (MHz)
 * @param {boolean}  useFresnel   - include first Fresnel zone clearance requirement
 * @returns {{ los: boolean, diffractionLossDb: number }}
 */
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

export function checkLoS(txElevM, rxElevM, profileElevs, txHeightM, rxHeightM, totalDistM, freqMHz, useFresnel) {
  const n = profileElevs.length;
  if (n < 2) return { los: true, diffractionLossDb: 0 };

  const txH  = txElevM + txHeightM;
  const rxH  = rxElevM + rxHeightM;
  const λ    = _getLambda(freqMHz);
  const fracs = _getFracs(n);

  // Earth-curvature correction using effective Earth radius (k = 4/3, standard atmosphere).
  // Adds d1*d2/(2*Re_eff) to each terrain sample, accounting for the planet's curvature
  // over long paths.  At 15 km the peak bulge is ~14 m — significant for marginal links.
  const Re_eff = 6371000 * (4 / 3);

  let maxV = -Infinity;

  for (let i = 1; i < n - 1; i++) {
    const d1    = fracs[i] * totalDistM;
    const d2    = totalDistM - d1;
    const lineH = txH + (rxH - txH) * fracs[i];
    const r1    = useFresnel ? Math.sqrt(λ * d1 * d2 / totalDistM) : 0;
    const bulge = d1 * d2 / (2 * Re_eff);               // effective terrain rise due to Earth curvature
    const h     = profileElevs[i] + bulge + r1 - lineH;
    const v     = h * Math.sqrt(2 * totalDistM / (λ * d1 * d2));
    if (v > maxV) maxV = v;
  }

  if (maxV < -0.7) return { los: true, diffractionLossDb: 0 };

  // Continuous ITU-R P.526-15 approximation — no discontinuity, < 0.5 dB error for v > 2
  const loss = maxV > -0.78
    ? 6.9 + 20 * Math.log10(Math.sqrt((maxV - 0.1) ** 2 + 1) + maxV - 0.1)
    : 0;

  return { los: maxV < 0, diffractionLossDb: Math.max(0, loss) };
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
