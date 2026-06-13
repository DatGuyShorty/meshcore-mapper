import { describe, expect, it } from 'vitest';
import {
  optimizerResultCoreDetails,
  optimizerScoreBreakdownSummary,
} from '../../src/optimizerResultDetails.js';

describe('optimizer result detail formatting', () => {
  it('formats shared candidate explanation rows for list items and popups', () => {
    const rows = optimizerResultCoreDetails({
      lat: 48.1,
      lon: 18.2,
      score: 0.765,
      elevM: 421.4,
      coverageRatio: 0.432,
      redundancyRatio: 0.125,
      avgMarginDb: 11.25,
      losRatio: 0.8,
      fresnelRatio: 0.6,
      backhaulPeerName: 'Source A',
      backhaulMarginDb: 14.5,
      backhaulRxPowerDbm: -91.2,
      backhaulDistanceM: 1234,
      backhaulLos: true,
      backhaulFresnelClear: false,
      scoreBreakdown: {
        label: 'Balanced',
        components: {
          coverage: { weight: 0.6, contribution: 0.24 },
          margin: { weight: 0.25, contribution: 0.05 },
          los: { weight: 0.1, contribution: 0.08 },
          fresnel: { weight: 0.05, contribution: 0.03 },
          backhaul: { weight: 0.15, contribution: 0.02 },
        },
        prominence: { contribution: 0.01 },
        roadAdjacency: { contribution: 0.015 },
      },
    });

    expect(rows).toEqual([
      'New coverage: 43.2%',
      'Score: 76.5%',
      'Elevation: 421 m',
      'Average margin: 11.3 dB',
      'Redundant coverage: 12.5%',
      'LoS: 80%',
      'Fresnel: 60%',
      'Backhaul to Source A: 14.5 dB',
      'Backhaul RX: -91.2 dBm',
      'Backhaul distance: 1.2 km',
      'Backhaul LoS: clear',
      'Backhaul Fresnel: blocked',
      'Why: Balanced: cov 24.0%, margin 5.0%, LoS 8.0%, Fresnel 3.0%, source 2.0%, terrain 1.0%, access 1.5%',
    ]);
  });

  it('omits unavailable explanation components', () => {
    expect(optimizerScoreBreakdownSummary(null)).toBe('');
    expect(optimizerResultCoreDetails({
      lat: 0,
      lon: 0,
      score: 0.2,
      elevM: 0,
    })).toEqual([
      'New coverage: 20.0%',
      'Score: 20.0%',
      'Elevation: 0 m',
    ]);
  });
});
