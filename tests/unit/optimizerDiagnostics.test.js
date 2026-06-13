import { describe, expect, it } from 'vitest';
import {
  optimizerCompletionMessage,
  optimizerResultDiagnostics,
  optimizerShouldRenderDiagnostics,
} from '../../src/optimizerDiagnostics.js';

describe('optimizer result diagnostics', () => {
  it('summarizes rejected and zero-coverage candidates for empty results', () => {
    const stats = {
      candidates: 5,
      candidatesScored: 2,
      initialCoverageRatio: 0.25,
      finalCoverageRatio: 0.25,
      roundsCompleted: 0,
      rejectedByMargin: 1,
      rejectedByLos: 1,
      zeroNewCoverage: 2,
    };

    expect(optimizerCompletionMessage(0, stats, 'CPU worker')).toEqual({
      text: 'No suitable new location found via CPU worker (1 below source margin, 1 blocked source LoS, 2 added no new coverage).',
      kind: 'warning',
    });
    expect(optimizerResultDiagnostics(0, stats)).toEqual([
      'Initial coverage 25.0%',
      'Final coverage 25.0%',
      '0 rounds completed',
      '2/5 candidates scored',
      '1 below source margin, 1 blocked source LoS, 2 added no new coverage',
    ]);
  });

  it('reports target misses separately from normal successful runs', () => {
    const stats = {
      targetCoverageRatio: 0.9,
      targetReached: false,
      initialCoverageRatio: 0.2,
      finalCoverageRatio: 0.7,
      roundsCompleted: 2,
      candidates: 6,
      candidatesScored: 6,
    };

    expect(optimizerCompletionMessage(2, stats, 'CPU worker')).toMatchObject({
      kind: 'warning',
      text: 'Found 2 locations via CPU worker, but target 90.0% was not reached; initial mesh coverage 20.0% -> final 70.0%.',
    });
    expect(optimizerResultDiagnostics(2, stats)).toEqual([
      'Target 90.0% not reached',
      'Initial coverage 20.0%',
      'Final coverage 70.0%',
      '2 rounds completed',
      '6/6 candidates scored',
    ]);
    expect(optimizerShouldRenderDiagnostics(2, stats)).toBe(true);
  });

  it('renders constraint diagnostics for partial-success runs without double-counting source-link rejects', () => {
    const stats = {
      candidates: 8,
      candidatesScored: 5,
      initialCoverageRatio: 0,
      finalCoverageRatio: 0.5,
      roundsCompleted: 1,
      rejectedByExclusion: 1,
      rejectedByElevation: 1,
      rejectedByRedundancy: 1,
      rejectedByBackhaul: 3,
      rejectedByMargin: 2,
      rejectedByFresnel: 1,
    };

    expect(optimizerCompletionMessage(1, stats, 'CPU worker')).toEqual({
      text: 'Found 1 location via CPU worker; initial mesh coverage 0.0% -> final 50.0%.',
      kind: 'success',
    });
    expect(optimizerShouldRenderDiagnostics(1, stats)).toBe(true);
    expect(optimizerResultDiagnostics(1, stats)).toEqual([
      'Initial coverage 0.0%',
      'Final coverage 50.0%',
      '1 round completed',
      '5/8 candidates scored',
      '1 inside exclusion zones, 1 below minimum elevation, 1 below redundancy target, 2 below source margin, 1 blocked source Fresnel',
    ]);
  });

  it('skips extra diagnostics for clean successful runs', () => {
    expect(optimizerShouldRenderDiagnostics(1, {
      candidates: 4,
      candidatesScored: 4,
      finalCoverageRatio: 0.5,
      roundsCompleted: 1,
    })).toBe(false);
  });

  it('keeps already-reached target messaging concise', () => {
    const stats = {
      targetCoverageRatio: 0.6,
      targetReached: true,
      initialCoverageRatio: 0.75,
      finalCoverageRatio: 0.75,
      roundsCompleted: 0,
    };

    expect(optimizerCompletionMessage(0, stats, 'CPU worker')).toEqual({
      text: 'Target 60% coverage already reached final 75.0%.',
      kind: 'success',
    });
  });
});
