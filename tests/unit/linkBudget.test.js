import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/elevation.js', () => ({
  fetchElevations: vi.fn(async points => points.map(() => 100)),
}));

vi.mock('../../src/foliage.js', () => ({
  fetchFoliage: vi.fn(async () => null),
  foliageLossDb: vi.fn(() => 0),
}));

vi.mock('../../src/buildings.js', () => ({
  fetchBuildings: vi.fn(async () => null),
  buildingLossDb: vi.fn(() => 0),
}));

import { fetchElevations } from '../../src/elevation.js';
import { calculateLinkBudget } from '../../src/linkBudget.js';

describe('P2P link budget calculation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a reconciled and stable budget for unchanged inputs', async () => {
    const pointA = { lat: 0, lng: 0 };
    const pointB = { lat: 0, lng: 0.001 };
    const settings = {
      txHeight: 10,
      rxHeight: 1.5,
      txPower: 20,
      txGain: 5,
      rxGain: 2,
      antennaPattern: 'sector90',
      txAzimuthDeg: 0,
      rxAzimuthDeg: 270,
      freqMHz: 868,
      rxSens: -133,
      fadeMargin: 10,
      useFoliage: false,
      useBuildings: false,
      foliageLossPerM: 0.3,
      buildingLossPerM: 0.5,
      deriveObstacleHeights: false,
      profileTargetSpacingM: 30,
      profileMaxSamples: 64,
      shadowFadingSigmaDb: 4,
      shadowFadingStochastic: true,
      shadowFadingTrials: 120,
    };

    const result = await calculateLinkBudget(
      pointA,
      pointB,
      settings
    );

    const resultAgain = await calculateLinkBudget(
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.001 },
      settings
    );

    expect(fetchElevations).toHaveBeenCalledTimes(2);
    expect(result.txPatternOffset).toBe(-10);
    expect(result.rxPatternOffset).toBe(0);
    expect(Number.isFinite(result.shadowFadingLoss)).toBe(true);
    expect(resultAgain.shadowFadingLoss).toBeCloseTo(result.shadowFadingLoss, 10);
    expect(result.totalPathLoss).toBeCloseTo(
      result.pathLoss + result.diffractionLoss + result.foliageLoss + result.buildingLoss + result.shadowFadingLoss
    );
    expect(result.rxPower).toBeCloseTo(
      result.txEirp + result.effectiveRxGain - result.totalPathLoss
    );
    expect(result.margin).toBeCloseTo(result.rxPower - result.requiredRx);
    expect(result.monteCarlo?.enabled).toBe(true);
    expect(result.monteCarlo?.trials).toBe(120);
    expect(resultAgain.monteCarlo?.outageProbability).toBeCloseTo(result.monteCarlo?.outageProbability ?? 0, 10);
    expect(resultAgain.monteCarlo?.marginP50).toBeCloseTo(result.monteCarlo?.marginP50 ?? 0, 10);
    expect(result.profileSvg).toContain('<svg');
  });
});
