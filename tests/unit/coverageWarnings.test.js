import { describe, expect, it } from 'vitest';
import {
  COVERAGE_WARNING_LABEL,
  coverageWarningCountText,
  coverageWarningDetailRow,
  coverageWarningDetailText,
  coverageWarningTitleLine,
  isCoverageWarningLabel,
  normalizeCoverageWarnings,
} from '../../src/coverageWarnings.js';

describe('coverage warning presentation helpers', () => {
  it('normalizes warning arrays and single-string payloads', () => {
    expect(normalizeCoverageWarnings([' Terrain gap ', null, '', 'Buildings unavailable.'])).toEqual([
      'Terrain gap',
      'Buildings unavailable.',
    ]);
    expect(normalizeCoverageWarnings('  DEM fallback used.  ')).toEqual(['DEM fallback used.']);
    expect(normalizeCoverageWarnings(null)).toEqual([]);
  });

  it('formats warning counts and detail rows consistently', () => {
    const warnings = ['Terrain gap.', 'Buildings unavailable.'];

    expect(coverageWarningCountText(warnings)).toBe('2 warnings');
    expect(coverageWarningCountText(1)).toBe('1 warning');
    expect(coverageWarningDetailText(warnings, '; ')).toBe('Terrain gap.; Buildings unavailable.');
    expect(coverageWarningTitleLine(warnings)).toBe('Warnings: Terrain gap. Buildings unavailable.');
    expect(coverageWarningDetailRow(warnings)).toEqual([COVERAGE_WARNING_LABEL, 'Terrain gap. Buildings unavailable.']);
    expect(coverageWarningDetailRow([])).toBeNull();
    expect(isCoverageWarningLabel('Warnings')).toBe(true);
    expect(isCoverageWarningLabel('Warning')).toBe(false);
  });
});
