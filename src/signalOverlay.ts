import { writePixel } from './propagation.js';

export type CoverageOverlayMode = 'margin' | 'rssi' | 'snr' | 'los';
type GradientStop = readonly [number, number, number, number, number];

export type SignalGridColorizeOptions = {
  mode?: CoverageOverlayMode;
  effectiveSens?: number;
  noiseFloorDbm?: number;
  requiredSnrWithMarginDb?: number;
  losGrid?: ArrayLike<number> | null;
  markNlos?: boolean;
};

export const COVERAGE_OVERLAY_MODES = Object.freeze(['margin', 'rssi', 'snr', 'los'] as const);

const RSSI_GRADIENT: readonly GradientStop[] = Object.freeze([
  [-125, 140, 0, 0, 80],
  [-110, 255, 95, 0, 115],
  [-95, 250, 205, 0, 145],
  [-80, 70, 205, 60, 165],
  [-60, 40, 215, 210, 185],
]);

const SNR_GRADIENT: readonly GradientStop[] = Object.freeze([
  [-10, 140, 0, 0, 80],
  [0, 255, 115, 0, 120],
  [10, 245, 210, 20, 145],
  [20, 70, 210, 70, 170],
  [30, 40, 215, 210, 185],
]);

/**
 * LoS clearance gradient, keyed on minFresnelClearanceRatio:
 * <0 obstructed (terrain crosses the direct ray), 0-0.6 partial Fresnel,
 * 0.6-1 grazing, >=1 first Fresnel zone clear.
 */
const LOS_GRADIENT: readonly GradientStop[] = Object.freeze([
  [-1.0, 150, 30, 30, 150],
  [0.0, 230, 70, 40, 150],
  [0.6, 245, 200, 0, 150],
  [1.0, 120, 210, 60, 165],
  [2.0, 0, 200, 130, 175],
]);

export function normalizeCoverageOverlayMode(mode: unknown): CoverageOverlayMode {
  return COVERAGE_OVERLAY_MODES.includes(mode as CoverageOverlayMode)
    ? mode as CoverageOverlayMode
    : 'margin';
}

export function colorizeSignalGrid(signalGrid: ArrayLike<number> | null | undefined, gridRes: number, {
  mode = 'margin',
  effectiveSens = -133,
  noiseFloorDbm = -115.5,
  requiredSnrWithMarginDb = -17.5,
  losGrid = null,
  markNlos = true,
}: SignalGridColorizeOptions = {}): Uint8ClampedArray {
  const signal = signalGrid instanceof Float32Array
    ? signalGrid
    : new Float32Array(signalGrid ?? []);
  const expected = gridRes * gridRes;
  if (signal.length !== expected) {
    throw new Error(`Signal grid length mismatch: expected ${expected}, got ${signal.length}`);
  }
  const los = losGrid && losGrid.length === expected
    ? (losGrid instanceof Float32Array ? losGrid : new Float32Array(losGrid))
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
    // Mark non-LoS coverage so true LoS stands out: desaturate + darken visible
    // pixels whose clearance ratio is negative.
    if (markNlos && los && out[base + 3] > 0) {
      const ratio = los[i];
      if (Number.isFinite(ratio) && ratio < 0) _markNlosPixel(out, base);
    }
  }
  return out;
}

function _writeLosPixel(buf: Uint8ClampedArray, base: number, ratio: number): void {
  if (Number.isNaN(ratio)) {
    buf[base] = 0; buf[base + 1] = 0; buf[base + 2] = 0; buf[base + 3] = 0;
    return;
  }
  const first = LOS_GRADIENT[0][0];
  const last = LOS_GRADIENT[LOS_GRADIENT.length - 1][0];
  const clamped = ratio > last ? last : (ratio < first ? first : ratio);
  _writeGradientPixel(buf, base, clamped, LOS_GRADIENT);
}

function _markNlosPixel(buf: Uint8ClampedArray, base: number): void {
  const r = buf[base], g = buf[base + 1], b = buf[base + 2];
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  buf[base] = Math.round(0.45 * r + 0.275 * lum);
  buf[base + 1] = Math.round(0.45 * g + 0.275 * lum);
  buf[base + 2] = Math.round(0.45 * b + 0.275 * lum);
}

export function writeSignalOverlayPixel(buf: Uint8ClampedArray, base: number, rxPower: number, {
  mode = 'margin',
  effectiveSens = -133,
  noiseFloorDbm = -115.5,
  requiredSnrWithMarginDb = -17.5,
}: SignalGridColorizeOptions = {}): void {
  const overlayMode = normalizeCoverageOverlayMode(mode);
  _writeSignalOverlayPixelResolved(buf, base, rxPower, {
    overlayMode,
    effectiveSens,
    noiseFloorDbm,
    snrStops: overlayMode === 'snr' ? _snrStops(requiredSnrWithMarginDb) : null,
  });
}

function _writeSignalOverlayPixelResolved(
  buf: Uint8ClampedArray,
  base: number,
  rxPower: number,
  {
    overlayMode,
    effectiveSens,
    noiseFloorDbm,
    snrStops,
  }: {
    overlayMode: CoverageOverlayMode;
    effectiveSens: number;
    noiseFloorDbm: number;
    snrStops: readonly GradientStop[] | null;
  },
): void {
  // No usable link (beyond radius, below receiver sensitivity, or not computed)
  // is fully transparent, so the rectangular analysis grid does not tint.
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

function _snrStops(requiredSnrWithMarginDb: number): readonly GradientStop[] {
  const req = Number.isFinite(requiredSnrWithMarginDb) ? requiredSnrWithMarginDb : -17.5;
  const low = Math.min(-20, req - 10);
  const high = Math.max(20, req + 20);
  const midHigh = Math.max(req + 10, Math.min(10, high - 5));
  return [
    [low, SNR_GRADIENT[0][1], SNR_GRADIENT[0][2], SNR_GRADIENT[0][3], SNR_GRADIENT[0][4]],
    [req, SNR_GRADIENT[1][1], SNR_GRADIENT[1][2], SNR_GRADIENT[1][3], SNR_GRADIENT[1][4]],
    [midHigh, SNR_GRADIENT[2][1], SNR_GRADIENT[2][2], SNR_GRADIENT[2][3], SNR_GRADIENT[2][4]],
    [Math.max(midHigh + 1, 20), SNR_GRADIENT[3][1], SNR_GRADIENT[3][2], SNR_GRADIENT[3][3], SNR_GRADIENT[3][4]],
    [high, SNR_GRADIENT[4][1], SNR_GRADIENT[4][2], SNR_GRADIENT[4][3], SNR_GRADIENT[4][4]],
  ];
}

function _writeGradientPixel(
  buf: Uint8ClampedArray,
  base: number,
  value: number,
  stops: readonly GradientStop[],
): void {
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

function _copyStop(buf: Uint8ClampedArray, base: number, stop: GradientStop): void {
  buf[base] = stop[1];
  buf[base + 1] = stop[2];
  buf[base + 2] = stop[3];
  buf[base + 3] = stop[4];
}
