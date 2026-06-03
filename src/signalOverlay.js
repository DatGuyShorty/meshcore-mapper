// @ts-check
import { writePixel } from './propagation.js';

/**
 * @typedef {'margin' | 'rssi' | 'snr' | 'los'} CoverageOverlayMode
 * @typedef {readonly [number, number, number, number, number]} GradientStop  Bound dBm/dB, R, G, B, A.
 */

/** @type {ReadonlyArray<CoverageOverlayMode>} */
export const COVERAGE_OVERLAY_MODES = Object.freeze(['margin', 'rssi', 'snr', 'los']);

/** @type {ReadonlyArray<GradientStop>} */
const RSSI_GRADIENT = Object.freeze([
  [-125, 140, 0, 0, 80],
  [-110, 255, 95, 0, 115],
  [-95, 250, 205, 0, 145],
  [-80, 70, 205, 60, 165],
  [-60, 40, 215, 210, 185],
]);

/** @type {ReadonlyArray<GradientStop>} */
const SNR_GRADIENT = Object.freeze([
  [-10, 140, 0, 0, 80],
  [0, 255, 115, 0, 120],
  [10, 245, 210, 20, 145],
  [20, 70, 210, 70, 170],
  [30, 40, 215, 210, 185],
]);

/**
 * LoS clearance gradient, keyed on minFresnelClearanceRatio:
 * <0 obstructed (terrain crosses the direct ray), 0–0.6 partial Fresnel,
 * 0.6–1 grazing, ≥1 first Fresnel zone clear.
 * @type {ReadonlyArray<GradientStop>}
 */
const LOS_GRADIENT = Object.freeze([
  [-1.0, 150, 30, 30, 150],  // obstructed — dark red
  [0.0, 230, 70, 40, 150],   // blocked boundary — red-orange
  [0.6, 245, 200, 0, 150],   // 60% Fresnel — amber
  [1.0, 120, 210, 60, 165],  // first Fresnel clear — green
  [2.0, 0, 200, 130, 175],   // wide clearance — deep green
]);

/**
 * @param {unknown} mode
 * @returns {CoverageOverlayMode}
 */
export function normalizeCoverageOverlayMode(mode) {
  return COVERAGE_OVERLAY_MODES.includes(/** @type {CoverageOverlayMode} */ (mode))
    ? /** @type {CoverageOverlayMode} */ (mode)
    : 'margin';
}

/**
 * @param {ArrayLike<number> | null | undefined} signalGrid
 * @param {number} gridRes
 * @param {{ mode?: CoverageOverlayMode, effectiveSens?: number, noiseFloorDbm?: number, requiredSnrWithMarginDb?: number, losGrid?: ArrayLike<number> | null, markNlos?: boolean }} [opts]
 * @returns {Uint8ClampedArray}
 */
export function colorizeSignalGrid(signalGrid, gridRes, {
  mode = 'margin',
  effectiveSens = -133,
  noiseFloorDbm = -115.5,
  requiredSnrWithMarginDb = -17.5,
  losGrid = null,
  markNlos = true,
} = {}) {
  const signal = signalGrid instanceof Float32Array
    ? signalGrid
    : new Float32Array(/** @type {ArrayLike<number>} */ (signalGrid ?? []));
  const expected = gridRes * gridRes;
  if (signal.length !== expected) {
    throw new Error(`Signal grid length mismatch: expected ${expected}, got ${signal.length}`);
  }
  const los = losGrid && losGrid.length === expected
    ? (losGrid instanceof Float32Array ? losGrid : new Float32Array(/** @type {ArrayLike<number>} */ (losGrid)))
    : null;

  const out = new Uint8ClampedArray(expected * 4);
  const overlayMode = normalizeCoverageOverlayMode(mode);

  // Dedicated LoS-clearance overlay: colorize the LoS grid directly.
  if (overlayMode === 'los') {
    for (let i = 0; i < expected; i++) {
      _writeLosPixel(out, i * 4, los ? los[i] : NaN);
    }
    return out;
  }

  const snrStops = overlayMode === 'snr' ? _snrStops(requiredSnrWithMarginDb) : null;
  for (let i = 0; i < signal.length; i++) {
    const base = i * 4;
    _writeSignalOverlayPixelResolved(out, base, signal[i], {
      overlayMode,
      effectiveSens,
      noiseFloorDbm,
      snrStops,
    });
    // Mark non-LoS (obstructed / diffraction-served) coverage so true LoS stands
    // out: desaturate + darken visible pixels whose clearance ratio is negative.
    if (markNlos && los && out[base + 3] > 0) {
      const ratio = los[i];
      if (Number.isFinite(ratio) && ratio < 0) _markNlosPixel(out, base);
    }
  }
  return out;
}

/**
 * Colorize one pixel of the LoS-clearance overlay. NaN clearance (no LoS data)
 * → transparent; finite ratios map through {@link LOS_GRADIENT}.
 * @param {Uint8ClampedArray} buf
 * @param {number} base
 * @param {number} ratio
 */
function _writeLosPixel(buf, base, ratio) {
  if (Number.isNaN(ratio) || ratio === undefined) {
    buf[base] = 0; buf[base + 1] = 0; buf[base + 2] = 0; buf[base + 3] = 0;
    return;
  }
  const first = LOS_GRADIENT[0][0];
  const last = LOS_GRADIENT[LOS_GRADIENT.length - 1][0];
  const clamped = ratio > last ? last : (ratio < first ? first : ratio);
  _writeGradientPixel(buf, base, clamped, LOS_GRADIENT);
}

/**
 * Desaturate + darken a colored pixel to flag non-LoS coverage.
 * @param {Uint8ClampedArray} buf
 * @param {number} base
 */
function _markNlosPixel(buf, base) {
  const r = buf[base], g = buf[base + 1], b = buf[base + 2];
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  buf[base] = Math.round(0.45 * r + 0.275 * lum);
  buf[base + 1] = Math.round(0.45 * g + 0.275 * lum);
  buf[base + 2] = Math.round(0.45 * b + 0.275 * lum);
}

/**
 * @param {Uint8ClampedArray} buf
 * @param {number} base
 * @param {number} rxPower
 * @param {{ mode?: CoverageOverlayMode, effectiveSens?: number, noiseFloorDbm?: number, requiredSnrWithMarginDb?: number }} [opts]
 */
export function writeSignalOverlayPixel(buf, base, rxPower, {
  mode = 'margin',
  effectiveSens = -133,
  noiseFloorDbm = -115.5,
  requiredSnrWithMarginDb = -17.5,
} = {}) {
  const overlayMode = normalizeCoverageOverlayMode(mode);
  _writeSignalOverlayPixelResolved(buf, base, rxPower, {
    overlayMode,
    effectiveSens,
    noiseFloorDbm,
    snrStops: overlayMode === 'snr' ? _snrStops(requiredSnrWithMarginDb) : null,
  });
}

/**
 * @param {Uint8ClampedArray} buf
 * @param {number} base
 * @param {number} rxPower
 * @param {{ overlayMode: CoverageOverlayMode, effectiveSens: number, noiseFloorDbm: number, snrStops: ReadonlyArray<GradientStop> | null }} opts
 */
function _writeSignalOverlayPixelResolved(buf, base, rxPower, {
  overlayMode,
  effectiveSens,
  noiseFloorDbm,
  snrStops,
}) {
  // No usable link (beyond radius, or below receiver sensitivity, or not
  // computed) → fully transparent, so the overlay shows only real coverage
  // instead of tinting the whole rectangular analysis grid.
  if (!Number.isFinite(rxPower) || rxPower < effectiveSens) {
    buf[base] = 0;
    buf[base + 1] = 0;
    buf[base + 2] = 0;
    buf[base + 3] = 0;
    return;
  }
  if (overlayMode === 'rssi') {
    _writeGradientPixel(buf, base, rxPower, RSSI_GRADIENT);
  } else if (overlayMode === 'snr' && snrStops) {
    _writeGradientPixel(buf, base, rxPower - noiseFloorDbm, snrStops);
  } else {
    writePixel(buf, base, rxPower, effectiveSens);
  }
}

/**
 * Build the per-mode SNR gradient stops, anchoring the threshold curve around
 * the modem's required SNR (+ fade margin) so the legend tracks user settings.
 * @param {number} requiredSnrWithMarginDb
 * @returns {ReadonlyArray<GradientStop>}
 */
function _snrStops(requiredSnrWithMarginDb) {
  const req = Number.isFinite(requiredSnrWithMarginDb) ? requiredSnrWithMarginDb : -17.5;
  const low = Math.min(-20, req - 10);
  const high = Math.max(20, req + 20);
  const midHigh = Math.max(req + 10, Math.min(10, high - 5));
  return [
    /** @type {GradientStop} */ ([low, SNR_GRADIENT[0][1], SNR_GRADIENT[0][2], SNR_GRADIENT[0][3], SNR_GRADIENT[0][4]]),
    /** @type {GradientStop} */ ([req, SNR_GRADIENT[1][1], SNR_GRADIENT[1][2], SNR_GRADIENT[1][3], SNR_GRADIENT[1][4]]),
    /** @type {GradientStop} */ ([midHigh, SNR_GRADIENT[2][1], SNR_GRADIENT[2][2], SNR_GRADIENT[2][3], SNR_GRADIENT[2][4]]),
    /** @type {GradientStop} */ ([Math.max(midHigh + 1, 20), SNR_GRADIENT[3][1], SNR_GRADIENT[3][2], SNR_GRADIENT[3][3], SNR_GRADIENT[3][4]]),
    /** @type {GradientStop} */ ([high, SNR_GRADIENT[4][1], SNR_GRADIENT[4][2], SNR_GRADIENT[4][3], SNR_GRADIENT[4][4]]),
  ];
}

/**
 * @param {Uint8ClampedArray} buf
 * @param {number} base
 * @param {number} value
 * @param {ReadonlyArray<GradientStop>} stops
 */
function _writeGradientPixel(buf, base, value, stops) {
  if (!Number.isFinite(value)) {
    buf[base] = 70;
    buf[base + 1] = 0;
    buf[base + 2] = 0;
    buf[base + 3] = 55;
    return;
  }

  if (value <= stops[0][0]) {
    _copyStop(buf, base, stops[0]);
    return;
  }
  const last = stops[stops.length - 1];
  if (value >= last[0]) {
    _copyStop(buf, base, last);
    return;
  }

  let hiIndex = 1;
  while (hiIndex < stops.length - 1 && value > stops[hiIndex][0]) hiIndex++;
  const lo = stops[hiIndex - 1];
  const hi = stops[hiIndex];
  const span = hi[0] - lo[0];
  const t = span > 0 ? (value - lo[0]) / span : 0;
  buf[base] = Math.round(lo[1] + (hi[1] - lo[1]) * t);
  buf[base + 1] = Math.round(lo[2] + (hi[2] - lo[2]) * t);
  buf[base + 2] = Math.round(lo[3] + (hi[3] - lo[3]) * t);
  buf[base + 3] = Math.round(lo[4] + (hi[4] - lo[4]) * t);
}

/**
 * @param {Uint8ClampedArray} buf
 * @param {number} base
 * @param {GradientStop} stop
 */
function _copyStop(buf, base, stop) {
  buf[base] = stop[1];
  buf[base + 1] = stop[2];
  buf[base + 2] = stop[3];
  buf[base + 3] = stop[4];
}
