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

  it('renders no-link pixels (below sensitivity or non-finite) fully transparent', () => {
    const grid = new Float32Array([-150, NaN, -80, -60]);
    const rgba = colorizeSignalGrid(grid, 2, { mode: 'rssi', effectiveSens: -133 });
    // -150 dBm is below receiver sensitivity → transparent (no rectangular tint).
    expect(Array.from(rgba.slice(0, 4))).toEqual([0, 0, 0, 0]);
    // Non-finite (uncomputed / beyond radius) → transparent.
    expect(Array.from(rgba.slice(4, 8))).toEqual([0, 0, 0, 0]);
    // -80 dBm is a usable link → visible.
    expect(rgba[11]).toBeGreaterThan(0);
  });

  it('normalizes the LoS overlay mode', () => {
    expect(normalizeCoverageOverlayMode('los')).toBe('los');
  });

  it('colorizes the LoS overlay from the clearance grid', () => {
    const signal = new Float32Array([-80, -80, -80, -80]);
    const los = new Float32Array([2.0, 0.3, -1.0, NaN]);
    const rgba = colorizeSignalGrid(signal, 2, { mode: 'los', losGrid: los });
    // clear (ratio ≥1) → green dominant
    expect(rgba[1]).toBeGreaterThan(rgba[0]);
    // obstructed (ratio <0) → red dominant and opaque
    expect(rgba[8]).toBeGreaterThan(rgba[9]);
    expect(rgba[11]).toBeGreaterThan(0);
    // no LoS data (NaN) → transparent
    expect(Array.from(rgba.slice(12, 16))).toEqual([0, 0, 0, 0]);
  });

  it('marks NLoS pixels in signal modes by desaturating', () => {
    const signal = new Float32Array([-80, -80, -80, -80]);
    const allClear = colorizeSignalGrid(signal, 2, { mode: 'rssi', losGrid: new Float32Array([1.5, 1.5, 1.5, 1.5]) });
    const withNlos = colorizeSignalGrid(signal, 2, { mode: 'rssi', losGrid: new Float32Array([1.5, -0.5, 1.5, 1.5]) });
    // clear pixel unchanged; obstructed pixel re-colored
    expect(Array.from(withNlos.slice(0, 4))).toEqual(Array.from(allClear.slice(0, 4)));
    expect(Array.from(withNlos.slice(4, 8))).not.toEqual(Array.from(allClear.slice(4, 8)));
    // marking can be disabled
    const noMark = colorizeSignalGrid(signal, 2, { mode: 'rssi', losGrid: new Float32Array([1.5, -0.5, 1.5, 1.5]), markNlos: false });
    expect(Array.from(noMark.slice(4, 8))).toEqual(Array.from(allClear.slice(4, 8)));
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
