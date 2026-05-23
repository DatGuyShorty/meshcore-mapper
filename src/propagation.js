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

  let maxV = -Infinity;

  for (let i = 1; i < n - 1; i++) {
    const d1    = fracs[i] * totalDistM;
    const d2    = totalDistM - d1;
    const lineH = txH + (rxH - txH) * fracs[i];
    const r1    = useFresnel ? Math.sqrt(λ * d1 * d2 / totalDistM) : 0;
    const h     = profileElevs[i] + r1 - lineH;
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

// ─── Signal strength → RGBA colour ──────────────────────────────
/**
 * @param {number} sigDbm   - received signal power (dBm)
 * @param {number} rxSens   - receiver sensitivity threshold (dBm)
 * @returns {[number,number,number,number]} [r, g, b, a]
 */
export function signalToRGBA(sigDbm, rxSens) {
  if (sigDbm < rxSens)  return [80,   0,  0,  90]; // below threshold
  if (sigDbm > -90)     return [0,  200, 80, 180]; // strong
  if (sigDbm > -110)    return [100, 220,  0, 165]; // good
  if (sigDbm > -125)    return [255, 200,  0, 155]; // marginal
  return                       [255,  80,  0, 140]; // weak
}

// P6: write directly into a Uint8ClampedArray — avoids one [r,g,b,a] allocation per pixel
/**
 * @param {Uint8ClampedArray} buf  - ImageData buffer
 * @param {number}            base - byte offset (idx * 4)
 * @param {number}            sigDbm
 * @param {number}            rxSens
 */
export function writePixel(buf, base, sigDbm, rxSens) {
  let r, g, b, a;
  if      (sigDbm < rxSens) { r=80;  g=0;   b=0;  a=90;  }
  else if (sigDbm > -90)    { r=0;   g=200; b=80; a=180; }
  else if (sigDbm > -110)   { r=100; g=220; b=0;  a=165; }
  else if (sigDbm > -125)   { r=255; g=200; b=0;  a=155; }
  else                      { r=255; g=80;  b=0;  a=140; }
  buf[base]=r; buf[base+1]=g; buf[base+2]=b; buf[base+3]=a;
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
