import { describe, expect, it } from 'vitest';
import {
  colorizeSignalGrid,
  normalizeCoverageOverlayMode,
  writeSignalOverlayPixel,
} from '../../src/signalOverlay.js';

describe('signal overlay colorization', () => {
  it('normalizes unsupported overlay modes to margin', () => {
    expect(normalizeCoverageOverlayMode('rssi')).toBe('rssi');
    expect(normalizeCoverageOverlayMode('watts')).toBe('margin');
  });

  it('colorizes the same signal grid for RSSI and SNR modes', () => {
    const signalGrid = new Float32Array([-130, -110, -80, -60]);

    const rssi = colorizeSignalGrid(signalGrid, 2, {
      mode: 'rssi',
      effectiveSens: -133,
      noiseFloorDbm: -115.5,
      requiredSnrWithMarginDb: -17.5,
    });
    const snr = colorizeSignalGrid(signalGrid, 2, {
      mode: 'snr',
      effectiveSens: -133,
      noiseFloorDbm: -115.5,
      requiredSnrWithMarginDb: -17.5,
    });

    expect(rssi).toHaveLength(16);
    expect(snr).toHaveLength(16);
    expect(Array.from(rssi.slice(0, 4))).not.toEqual(Array.from(snr.slice(0, 4)));
    expect(rssi[15]).toBeGreaterThan(rssi[3]);
  });

  it('writes a single overlay pixel with the same color rules used by grid overlays', () => {
    const buf = new Uint8ClampedArray(4);

    writeSignalOverlayPixel(buf, 0, -80, {
      mode: 'rssi',
      effectiveSens: -133,
      noiseFloorDbm: -115.5,
      requiredSnrWithMarginDb: -17.5,
    });

    expect(buf[3]).toBeGreaterThan(0);
    expect(buf[1]).toBeGreaterThan(buf[0]);
  });
});
