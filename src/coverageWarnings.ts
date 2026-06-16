export const COVERAGE_WARNING_LABEL = 'Warnings';

export type CoverageWarningDetailRow = [typeof COVERAGE_WARNING_LABEL, string];

export function normalizeCoverageWarnings(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(_warningText).filter(Boolean);
  }
  const text = _warningText(value);
  return text ? [text] : [];
}

export function coverageWarningCountText(value: unknown): string {
  const count = typeof value === 'number'
    ? Math.max(0, Math.floor(value))
    : normalizeCoverageWarnings(value).length;
  return `${count} warning${count === 1 ? '' : 's'}`;
}

export function coverageWarningDetailText(value: unknown, separator = ' '): string {
  return normalizeCoverageWarnings(value).join(separator);
}

export function coverageWarningTitleLine(value: unknown): string | null {
  const detail = coverageWarningDetailText(value);
  return detail ? `${COVERAGE_WARNING_LABEL}: ${detail}` : null;
}

export function coverageWarningDetailRow(value: unknown): CoverageWarningDetailRow | null {
  const detail = coverageWarningDetailText(value);
  return detail ? [COVERAGE_WARNING_LABEL, detail] : null;
}

export function isCoverageWarningLabel(label: unknown): boolean {
  return label === COVERAGE_WARNING_LABEL;
}

function _warningText(value: unknown): string {
  return String(value ?? '').trim();
}
