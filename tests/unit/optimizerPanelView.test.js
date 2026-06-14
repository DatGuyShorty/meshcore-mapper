import { describe, expect, it } from 'vitest';
import {
  optimizerCandidateItemHtml,
  optimizerCandidatePopupHtml,
  optimizerDiagnosticsItemHtml,
} from '../../src/optimizerPanelView.js';

describe('optimizer panel view', () => {
  it('renders escaped candidate list rows with shared details', () => {
    const html = optimizerCandidateItemHtml(candidate({
      backhaulPeerName: '<Source>',
      scoreBreakdown: {
        label: 'Balanced',
        components: {
          coverage: { weight: 0.6, contribution: 0.25 },
        },
      },
    }), 2);

    expect(html).toContain('#2');
    expect(html).toContain('48.2863, 18.5054');
    expect(html).toContain('New coverage: 42.0%');
    expect(html).toContain('Backhaul to &lt;Source&gt;: 12.4 dB');
    expect(html).toContain('Why: Balanced: cov 25.0%');
    expect(html).toContain('+ Add');
  });

  it('renders candidate marker popup content and objective formula', () => {
    const html = optimizerCandidatePopupHtml(candidate({
      scoreBreakdown: { formula: 'coverage + margin' },
    }), 1);

    expect(html).toContain('<b>Suggested #1</b>');
    expect(html).toContain('48.28625, 18.50540');
    expect(html).toContain('Score: 62.0%');
    expect(html).toContain('Objective: coverage + margin');
  });

  it('renders diagnostics for constrained zero-result runs', () => {
    const html = optimizerDiagnosticsItemHtml(0, {
      candidates: 8,
      candidatesScored: 5,
      initialCoverageRatio: 0,
      finalCoverageRatio: 0.5,
      roundsCompleted: 1,
      rejectedByExclusion: 3,
      rejectedByBackhaul: 4,
      rejectedByMargin: 2,
      rejectedByFresnel: 1,
    });

    expect(html).toContain('Optimizer diagnostics');
    expect(html).toContain('5/8 candidates scored');
    expect(html).toContain('3 inside exclusion zones');
    expect(html).toContain('2 below source margin');
    expect(html).toContain('1 blocked source Fresnel');
  });

  it('skips diagnostics for clean successful runs', () => {
    expect(optimizerDiagnosticsItemHtml(3, { candidateCount: 20 })).toBe('');
  });

  function candidate(overrides = {}) {
    return {
      lat: 48.28625,
      lon: 18.5054,
      score: 0.62,
      coverageRatio: 0.42,
      elevM: 318,
      avgMarginDb: 8.5,
      backhaulPeerName: 'Source A',
      backhaulMarginDb: 12.4,
      backhaulRxPowerDbm: -91,
      backhaulDistanceM: 1500,
      backhaulLos: true,
      backhaulFresnelClear: true,
      ...overrides,
    };
  }
});
