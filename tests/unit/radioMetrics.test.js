import { describe, expect, it } from 'vitest';
import {
  deriveRadioMetrics,
  inferSpreadingFactorFromSensitivity,
  parseSpreadingFactor,
} from '../../src/radioMetrics.js';

describe('radio metrics', () => {
  it('parses LoRa spreading factor from modem labels', () => {
    expect(parseSpreadingFactor('EU868 Narrow - SF9/BW62.5/CR5')).toBe(9);
    expect(parseSpreadingFactor('sf12 bw125')).toBe(12);
    expect(parseSpreadingFactor('no preset')).toBeNull();
  });

  it('infers spreading factor and noise floor from sensitivity', () => {
    expect(inferSpreadingFactorFromSensitivity(-137)).toBe(12);
    expect(inferSpreadingFactorFromSensitivity(-126)).toBe(8);

    const metrics = deriveRadioMetrics({
      modemText: 'MeshCore default SF11/BW250',
      rxSens: -133,
      fadeMargin: 10,
    });

    expect(metrics.spreadingFactor).toBe(11);
    expect(metrics.requiredSnrDb).toBe(-17.5);
    expect(metrics.requiredSnrWithMarginDb).toBe(-7.5);
    expect(metrics.noiseFloorDbm).toBe(-115.5);
  });
});
