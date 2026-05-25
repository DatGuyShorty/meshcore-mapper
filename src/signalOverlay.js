import { writePixel } from './propagation.js';

export const COVERAGE_OVERLAY_MODES = Object.freeze(['margin', 'rssi', 'snr']);

const RSSI_GRADIENT = Object.freeze([
  [-125, 140, 0, 0, 80],
  [-110, 255, 95, 0, 115],
  [-95, 250, 205, 0, 145],
  [-80, 70, 205, 60, 165],
  [-60, 40, 215, 210, 185],
]);

const SNR_GRADIENT = Object.freeze([
  [-10, 140, 0, 0, 80],
  [0, 255, 115, 0, 120],
  [10, 245, 210, 20, 145],
  [20, 70, 210, 70, 170],
  [30, 40, 215, 210, 185],
]);

export function normalizeCoverageOverlayMode(mode) {
  return COVERAGE_OVERLAY_MODES.includes(mode) ? mode : 'margin';
}

export function colorizeSignalGrid(signalGrid, gridRes, {
  mode = 'margin',
  effectiveSens = -133,
  noiseFloorDbm = -115.5,
  requiredSnrWithMarginDb = -17.5,
} = {}) {
  const signal = signalGrid instanceof Float32Array
    ? signalGrid
    : new Float32Array(signalGrid ?? 0);
  const expected = gridRes * gridRes;
  if (signal.length !== expected) {
    throw new Error(`Signal grid length mismatch: expected ${expected}, got ${signal.length}`);
  }

  const out = new Uint8ClampedArray(expected * 4);
  const overlayMode = normalizeCoverageOverlayMode(mode);
  const snrStops = overlayMode === 'snr' ? _snrStops(requiredSnrWithMarginDb) : null;
  for (let i = 0; i < signal.length; i++) {
    _writeSignalOverlayPixelResolved(out, i * 4, signal[i], {
      overlayMode,
      effectiveSens,
      noiseFloorDbm,
      snrStops,
    });
  }
  return out;
}

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

function _writeSignalOverlayPixelResolved(buf, base, rxPower, {
  overlayMode,
  effectiveSens,
  noiseFloorDbm,
  snrStops,
}) {
  if (overlayMode === 'rssi') {
    _writeGradientPixel(buf, base, rxPower, RSSI_GRADIENT);
  } else if (overlayMode === 'snr') {
    _writeGradientPixel(buf, base, rxPower - noiseFloorDbm, snrStops);
  } else {
    writePixel(buf, base, rxPower, effectiveSens);
  }
}

function _snrStops(requiredSnrWithMarginDb) {
  const req = Number.isFinite(requiredSnrWithMarginDb) ? requiredSnrWithMarginDb : -17.5;
  const low = Math.min(-20, req - 10);
  const high = Math.max(20, req + 20);
  const midHigh = Math.max(req + 10, Math.min(10, high - 5));
  return [
    [low, ...SNR_GRADIENT[0].slice(1)],
    [req, ...SNR_GRADIENT[1].slice(1)],
    [midHigh, ...SNR_GRADIENT[2].slice(1)],
    [Math.max(midHigh + 1, 20), ...SNR_GRADIENT[3].slice(1)],
    [high, ...SNR_GRADIENT[4].slice(1)],
  ];
}

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

function _copyStop(buf, base, stop) {
  buf[base] = stop[1];
  buf[base + 1] = stop[2];
  buf[base + 2] = stop[3];
  buf[base + 3] = stop[4];
}
