import { describe, expect, it } from 'vitest';
import {
  buildGrid,
  buildRefinedGrid,
  computeRoadAdjacencyScores,
  optimizerNeedsTerrain,
  optimizerObjectiveDetails,
  runOptimizerScoring,
  scoreOptimizerCandidates,
} from '../../src/optimizer.js';

describe('optimizer terrain requirements', () => {
  it('loads terrain when any terrain-aware propagation effect is enabled', () => {
    expect(optimizerNeedsTerrain({ useLos: true })).toBe(true);
    expect(optimizerNeedsTerrain({ useFoliage: true })).toBe(true);
    expect(optimizerNeedsTerrain({ useBuildings: true })).toBe(true);
    expect(optimizerNeedsTerrain({
      sourceNode: { lat: 0, lon: 0, height: 10, power: 20, freq: 869.525 },
      requireSourceLos: true,
    })).toBe(true);
    expect(optimizerNeedsTerrain({ preferHighGround: true })).toBe(true);
  });

  it('skips terrain only for pure free-space scoring', () => {
    expect(optimizerNeedsTerrain({
      useLos: false,
      useFoliage: false,
      useBuildings: false,
    })).toBe(false);
  });

  it('builds finite grids even when resolution is too low', () => {
    expect(buildGrid(10, 11, 20, 21, 0)).toEqual([
      { latitude: 11, longitude: 20 },
    ]);
    expect(buildGrid(10, 11, 20, 21, 1)).toEqual([
      { latitude: 11, longitude: 20 },
    ]);
  });

  it('adds bounded local refinement candidates around the base grid', () => {
    const base = buildGrid(10, 11, 20, 21, 3);
    const refined = buildRefinedGrid(10, 11, 20, 21, 3);

    expect(refined.length).toBeGreaterThan(base.length);
    expect(refined).toEqual(expect.arrayContaining(base));
    expect(refined.every(pt => pt.latitude >= 10 && pt.latitude <= 11 && pt.longitude >= 20 && pt.longitude <= 21)).toBe(true);
  });

  it('documents optimizer objective formulas', () => {
    expect(optimizerObjectiveDetails('coverage')).toMatchObject({
      id: 'coverage',
      label: 'Coverage First',
      weights: {
        coverage: 0.80,
        redundancy: 0,
        margin: 0.15,
        los: 0.05,
        fresnel: 0,
        backhaul: 0.05,
      },
    });
    expect(optimizerObjectiveDetails('redundancy')).toMatchObject({
      id: 'redundancy',
      label: 'Redundancy First',
      weights: {
        coverage: 0.25,
        redundancy: 0.45,
      },
    });
    expect(optimizerObjectiveDetails('min-repeaters')).toMatchObject({
      id: 'min-repeaters',
      label: 'Min Repeaters To Target',
      weights: {
        coverage: 0.85,
        redundancy: 0,
      },
    });
    expect(optimizerObjectiveDetails('unknown')).toMatchObject({
      id: 'balanced',
      label: 'Balanced',
    });
    expect(optimizerObjectiveDetails('backhaul').formula).toContain('source margin');
    expect(optimizerObjectiveDetails('redundancy').formula).toContain('redundant coverage');
    expect(optimizerObjectiveDetails('min-repeaters').formula).toContain('target coverage');
  });

  it('rejects source-linked candidates that cannot meet the required backhaul margin', () => {
    const results = scoreOptimizerCandidates({
      evalPoints: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.005 }],
      evalElevs: [0, 0],
      candidates: [{ latitude: 0, longitude: 0.005 }],
      candidateElevs: [0],
      nRepeaters: 1,
      txParams: { height: 10, power: 20, freq: 869.525, gain: 2 },
      opts: {
        rxHeight: 1.5,
        rxSens: -133,
        fadeMargin: 0,
        radiusKm: 2,
        useLos: false,
        useFresnel: false,
        gridRes: 1,
        latMin: 0,
        latMax: 0,
        lonMin: 0,
        lonMax: 0.005,
        foliage: null,
        buildings: null,
        sourceNode: { lat: 0, lon: 0, height: 10, power: 20, freq: 869.525, gain: 2, elevM: 0, name: 'A' },
        requireSourceLink: true,
        requireSourceLos: true,
        sourceMinMarginDb: 200,
      },
    });

    expect(results).toEqual([]);
  });

  it('returns source-link diagnostics for accepted source-linked candidates', () => {
    const results = scoreOptimizerCandidates({
      evalPoints: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.005 }],
      evalElevs: [0, 0],
      candidates: [{ latitude: 0, longitude: 0.005 }],
      candidateElevs: [0],
      nRepeaters: 1,
      txParams: { height: 10, power: 20, freq: 869.525, gain: 2 },
      opts: {
        rxHeight: 1.5,
        rxSens: -133,
        fadeMargin: 0,
        radiusKm: 2,
        useLos: false,
        useFresnel: false,
        gridRes: 1,
        latMin: 0,
        latMax: 0,
        lonMin: 0,
        lonMax: 0.005,
        foliage: null,
        buildings: null,
        sourceNode: { lat: 0, lon: 0, height: 10, power: 20, freq: 869.525, gain: 2, elevM: 0, name: 'A' },
        requireSourceLink: true,
        requireSourceLos: true,
        sourceMinMarginDb: 0,
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      backhaulPeerName: 'A',
      backhaulLos: true,
      backhaulFresnelClear: true,
      coveredPoints: 2,
      scoreBreakdown: {
        objective: 'balanced',
        label: 'Balanced',
        components: {
          coverage: expect.objectContaining({ weight: 0.60 }),
          margin: expect.objectContaining({ weight: 0.25 }),
          backhaul: expect.objectContaining({ weight: 0.15 }),
        },
      },
    });
    expect(results[0].backhaulMarginDb).toBeGreaterThan(0);
    expect(results[0].scoreBreakdown?.formula).toContain('terrain prominence');
    expect(results[0].scoreBreakdown?.finalScore).toBeCloseTo(results[0].score);
    expect(results[0].scoreBreakdown?.prominence?.weight).toBe(0);
  });

  it('uses high-ground preference as a candidate tie-breaker when enabled', () => {
    const base = {
      evalPoints: [{ latitude: 0, longitude: 0.0001 }],
      evalElevs: [0],
      candidates: [
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 0.0002 },
        { latitude: 0, longitude: 0.001 },
      ],
      candidateElevs: [0, 100, 0],
      nRepeaters: 1,
      txParams: { height: 10, power: 20, freq: 869.525, gain: 2 },
      opts: {
        rxHeight: 1.5,
        rxSens: -133,
        fadeMargin: 0,
        radiusKm: 1,
        useLos: false,
        useFresnel: false,
        gridRes: 1,
        latMin: 0,
        latMax: 0,
        lonMin: 0,
        lonMax: 0.001,
        foliage: null,
        buildings: null,
      },
    };

    const withoutPreference = runOptimizerScoring({
      ...base,
      opts: { ...base.opts, preferHighGround: false },
    });
    const withPreference = runOptimizerScoring({
      ...base,
      opts: { ...base.opts, preferHighGround: true },
    });

    expect(withoutPreference.results[0].lon).toBeCloseTo(0, 6);
    expect(withoutPreference.results[0].scoreBreakdown?.prominence?.weight).toBe(0);
    expect(withPreference.results[0].lon).toBeCloseTo(0.0002, 6);
    expect(withPreference.results[0].scoreBreakdown?.prominence).toMatchObject({
      weight: 0.06,
      value: 1,
      contribution: 0.06,
    });
    expect(withPreference.stats).toMatchObject({
      preferHighGround: true,
      prominenceWeight: 0.06,
    });
  });

  it('rejects candidates below the minimum site elevation', () => {
    const { results, stats } = runOptimizerScoring({
      evalPoints: [{ latitude: 0, longitude: 0 }],
      evalElevs: [0],
      candidates: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.0002 }],
      candidateElevs: [20, 80],
      nRepeaters: 1,
      txParams: { height: 10, power: 20, freq: 869.525, gain: 2 },
      opts: {
        rxHeight: 1.5,
        rxSens: -133,
        fadeMargin: 0,
        radiusKm: 1,
        useLos: false,
        useFresnel: false,
        gridRes: 1,
        latMin: 0,
        latMax: 0,
        lonMin: 0,
        lonMax: 0.0002,
        foliage: null,
        buildings: null,
        minCandidateElevationM: 50,
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0].lon).toBeCloseTo(0.0002, 6);
    expect(stats).toMatchObject({
      minCandidateElevationM: 50,
      rejectedByElevation: 1,
      candidatesScored: 1,
    });
  });

  it('rejects candidates inside exclusion zones', () => {
    const { results, stats } = runOptimizerScoring({
      evalPoints: [{ latitude: 0, longitude: 0 }],
      evalElevs: [0],
      candidates: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.0002 }],
      candidateElevs: [0, 0],
      nRepeaters: 1,
      txParams: { height: 10, power: 20, freq: 869.525, gain: 2 },
      opts: {
        rxHeight: 1.5,
        rxSens: -133,
        fadeMargin: 0,
        radiusKm: 1,
        useLos: false,
        useFresnel: false,
        gridRes: 1,
        latMin: 0,
        latMax: 0,
        lonMin: 0,
        lonMax: 0.0002,
        foliage: null,
        buildings: null,
        exclusionZones: [{
          latMin: -0.0001,
          latMax: 0.0001,
          lonMin: -0.0001,
          lonMax: 0.0001,
        }],
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0].lon).toBeCloseTo(0.0002, 6);
    expect(stats).toMatchObject({
      exclusionZones: 1,
      rejectedByExclusion: 1,
      candidatesScored: 1,
    });
  });

  it('rejects candidates below the minimum redundancy target', () => {
    const { results, stats } = runOptimizerScoring({
      evalPoints: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.01 }],
      evalElevs: [0, 0],
      candidates: [{ latitude: 0, longitude: 0.01 }, { latitude: 0, longitude: 0 }],
      candidateElevs: [0, 0],
      nRepeaters: 1,
      txParams: { height: 10, power: 20, freq: 869.525, gain: 2 },
      opts: {
        rxHeight: 1.5,
        rxSens: -133,
        fadeMargin: 0,
        radiusKm: 0.4,
        useLos: false,
        useFresnel: false,
        gridRes: 1,
        latMin: 0,
        latMax: 0,
        lonMin: 0,
        lonMax: 0.01,
        foliage: null,
        buildings: null,
        minRedundancyRatio: 0.4,
        existingNodes: [{ lat: 0, lon: 0, height: 10, power: 20, freq: 869.525, gain: 2, elevM: 0, name: 'Existing' }],
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      lon: 0,
      coveredPoints: 0,
      redundantPoints: 1,
      redundancyRatio: 0.5,
    });
    expect(stats).toMatchObject({
      minRedundancyRatio: 0.4,
      initialCoveredPoints: 1,
      rejectedByRedundancy: 1,
      candidatesScored: 2,
    });
  });

  it('uses road-adjacent preference as a candidate tie-breaker when road data is available', () => {
    const base = {
      evalPoints: [{ latitude: 0, longitude: 0.0001 }],
      evalElevs: [0],
      candidates: [
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 0.0002 },
      ],
      candidateElevs: [0, 0],
      nRepeaters: 1,
      txParams: { height: 10, power: 20, freq: 869.525, gain: 2 },
      opts: {
        rxHeight: 1.5,
        rxSens: -133,
        fadeMargin: 0,
        radiusKm: 1,
        useLos: false,
        useFresnel: false,
        gridRes: 1,
        latMin: 0,
        latMax: 0,
        lonMin: 0,
        lonMax: 0.0002,
        foliage: null,
        buildings: null,
        roadLines: [{
          id: 'road-1',
          type: 'service',
          points: [
            { latitude: -0.001, longitude: 0.0002 },
            { latitude: 0.001, longitude: 0.0002 },
          ],
        }],
      },
    };

    const scores = computeRoadAdjacencyScores(base.candidates, base.opts.roadLines, 500);
    const withoutPreference = runOptimizerScoring({
      ...base,
      opts: { ...base.opts, preferRoadAdjacent: false },
    });
    const withPreference = runOptimizerScoring({
      ...base,
      opts: { ...base.opts, preferRoadAdjacent: true },
    });

    expect(scores[1]).toBeGreaterThan(scores[0]);
    expect(withoutPreference.results[0].lon).toBeCloseTo(0, 6);
    expect(withPreference.results[0].lon).toBeCloseTo(0.0002, 6);
    expect(withPreference.results[0].scoreBreakdown?.roadAdjacency).toMatchObject({
      weight: 0.04,
      value: 1,
      contribution: 0.04,
    });
    expect(withPreference.stats).toMatchObject({
      preferRoadAdjacent: true,
      roadLineCount: 1,
      roadAdjacencyWeight: 0.04,
    });
  });

  it('prefers uncovered mesh gaps over already-covered cells', () => {
    const results = scoreOptimizerCandidates({
      evalPoints: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.01 }],
      evalElevs: [0, 0],
      candidates: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.01 }],
      candidateElevs: [0, 0],
      nRepeaters: 1,
      txParams: { height: 10, power: 20, freq: 869.525, gain: 2 },
      opts: {
        rxHeight: 1.5,
        rxSens: -133,
        fadeMargin: 0,
        radiusKm: 0.4,
        useLos: false,
        useFresnel: false,
        gridRes: 1,
        latMin: 0,
        latMax: 0,
        lonMin: 0,
        lonMax: 0.01,
        foliage: null,
        buildings: null,
        gapAware: true,
        existingNodes: [{ lat: 0, lon: 0, height: 10, power: 20, freq: 869.525, gain: 2, elevM: 0, name: 'Existing' }],
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0].lon).toBeCloseTo(0.01, 6);
  });

  it('can prioritize redundant coverage over uncovered gap coverage', () => {
    const results = scoreOptimizerCandidates({
      evalPoints: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.01 }],
      evalElevs: [0, 0],
      candidates: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.01 }],
      candidateElevs: [0, 0],
      nRepeaters: 1,
      txParams: { height: 10, power: 20, freq: 869.525, gain: 2 },
      opts: {
        rxHeight: 1.5,
        rxSens: -133,
        fadeMargin: 0,
        radiusKm: 0.4,
        useLos: false,
        useFresnel: false,
        gridRes: 1,
        latMin: 0,
        latMax: 0,
        lonMin: 0,
        lonMax: 0.01,
        foliage: null,
        buildings: null,
        gapAware: true,
        objective: 'redundancy',
        existingNodes: [{ lat: 0, lon: 0, height: 10, power: 20, freq: 869.525, gain: 2, elevM: 0, name: 'Existing' }],
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0].lon).toBeCloseTo(0, 6);
    expect(results[0]).toMatchObject({
      coveredPoints: 0,
      redundantPoints: 1,
      candidateCoveredPoints: 1,
      redundancyRatio: 0.5,
      scoreBreakdown: {
        objective: 'redundancy',
        components: {
          redundancy: expect.objectContaining({ weight: 0.45 }),
        },
      },
    });
  });

  it('prefers first backup coverage over repeatedly stacked redundant coverage', () => {
    const results = scoreOptimizerCandidates({
      evalPoints: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.01 }],
      evalElevs: [0, 0],
      candidates: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.01 }],
      candidateElevs: [0, 0],
      nRepeaters: 1,
      txParams: { height: 10, power: 20, freq: 869.525, gain: 2 },
      opts: {
        rxHeight: 1.5,
        rxSens: -133,
        fadeMargin: 0,
        radiusKm: 0.4,
        useLos: false,
        useFresnel: false,
        gridRes: 1,
        latMin: 0,
        latMax: 0,
        lonMin: 0,
        lonMax: 0.01,
        foliage: null,
        buildings: null,
        gapAware: true,
        objective: 'redundancy',
        existingNodes: [
          { lat: 0, lon: 0, height: 10, power: 20, freq: 869.525, gain: 2, elevM: 0, name: 'Existing A1' },
          { lat: 0, lon: 0, height: 10, power: 20, freq: 869.525, gain: 2, elevM: 0, name: 'Existing A2' },
          { lat: 0, lon: 0.01, height: 10, power: 20, freq: 869.525, gain: 2, elevM: 0, name: 'Existing B1' },
        ],
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0].lon).toBeCloseTo(0.01, 6);
    expect(results[0]).toMatchObject({
      coveredPoints: 0,
      redundantPoints: 1,
      redundancyRatio: 0.5,
    });
    expect(results[0].scoreBreakdown?.components.redundancy.value).toBeCloseTo(0.5);
  });

  it('allows later suggestions to uplink through earlier connected suggestions', () => {
    const results = scoreOptimizerCandidates({
      evalPoints: [{ latitude: 0, longitude: 0.005 }, { latitude: 0, longitude: 0.01 }],
      evalElevs: [0, 0],
      candidates: [{ latitude: 0, longitude: 0.005 }, { latitude: 0, longitude: 0.01 }],
      candidateElevs: [0, 0],
      nRepeaters: 2,
      txParams: { height: 10, power: 20, freq: 869.525, gain: 2 },
      opts: {
        rxHeight: 1.5,
        rxSens: -133,
        fadeMargin: 0,
        radiusKm: 0.4,
        useLos: false,
        useFresnel: false,
        gridRes: 1,
        latMin: 0,
        latMax: 0,
        lonMin: 0,
        lonMax: 0.01,
        foliage: null,
        buildings: null,
        sourceNode: { lat: 0, lon: 0, height: 10, power: 20, freq: 869.525, gain: 2, elevM: 0, name: 'Source' },
        requireSourceLink: true,
        requireSourceLos: false,
        sourceMinMarginDb: 67,
      },
    });

    expect(results).toHaveLength(2);
    expect(results[1].backhaulPeerName).toBe('Suggested 1');
  });

  it('stops min-repeaters objective once target coverage is reached', () => {
    const { results, stats } = runOptimizerScoring({
      evalPoints: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.01 }, { latitude: 0, longitude: 0.02 }],
      evalElevs: [0, 0, 0],
      candidates: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.01 }, { latitude: 0, longitude: 0.02 }],
      candidateElevs: [0, 0, 0],
      nRepeaters: 3,
      txParams: { height: 10, power: 20, freq: 869.525, gain: 2 },
      opts: {
        rxHeight: 1.5,
        rxSens: -133,
        fadeMargin: 0,
        radiusKm: 0.4,
        useLos: false,
        useFresnel: false,
        gridRes: 1,
        latMin: 0,
        latMax: 0,
        lonMin: 0,
        lonMax: 0.02,
        foliage: null,
        buildings: null,
        objective: 'min-repeaters',
        targetCoverageRatio: 1 / 3,
      },
    });

    expect(results).toHaveLength(1);
    expect(stats).toMatchObject({
      roundsCompleted: 1,
      targetReached: true,
      targetCoverageRatio: 1 / 3,
    });
    expect(stats.finalCoverageRatio).toBeCloseTo(1 / 3);
  });
});
