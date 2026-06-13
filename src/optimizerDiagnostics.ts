export type OptimizerMessageKind = 'success' | 'warning' | 'error' | 'info';

export type OptimizerCompletionMessage = {
  text: string;
  kind: OptimizerMessageKind;
};

export type OptimizerStats = Record<string, any>;

export function optimizerCompletionMessage(
  resultCount: number,
  stats: OptimizerStats | undefined,
  backendLabel: string,
): OptimizerCompletionMessage {
  if (!stats) {
    return {
      text: `Found ${resultCount} best location${resultCount !== 1 ? 's' : ''} via ${backendLabel}.`,
      kind: 'success',
    };
  }
  if (stats.targetReached) {
    const target = Number.isFinite(stats.targetCoverageRatio)
      ? `${(stats.targetCoverageRatio * 100).toFixed(0)}%`
      : 'requested';
    const finalCoverage = Number.isFinite(stats.finalCoverageRatio)
      ? ` final ${formatPercent(stats.finalCoverageRatio)}`
      : '';
    if (resultCount === 0) {
      return {
        text: `Target ${target} coverage already reached${finalCoverage}.`,
        kind: 'success',
      };
    }
    return {
      text: `Reached target ${target} coverage with ${resultCount} repeater${resultCount !== 1 ? 's' : ''} via ${backendLabel};${finalCoverage}.`,
      kind: 'success',
    };
  }

  const targetMiss = Number.isFinite(stats.targetCoverageRatio) && !stats.targetReached;
  const gapText = Number.isFinite(stats.initialCoverageRatio)
    ? ` initial mesh coverage ${formatPercent(stats.initialCoverageRatio)}`
    : '';
  if (resultCount > 0) {
    const finalCoverage = Number.isFinite(stats.finalCoverageRatio)
      ? ` -> final ${formatPercent(stats.finalCoverageRatio)}`
      : '';
    const detail = `${gapText}${finalCoverage}`;
    if (targetMiss) {
      return {
        text: `Found ${resultCount} location${resultCount !== 1 ? 's' : ''} via ${backendLabel}, but target ${formatPercent(stats.targetCoverageRatio)} was not reached;${detail}.`,
        kind: 'warning',
      };
    }
    return {
      text: detail
        ? `Found ${resultCount} location${resultCount !== 1 ? 's' : ''} via ${backendLabel};${detail}.`
        : `Found ${resultCount} location${resultCount !== 1 ? 's' : ''} via ${backendLabel}.`,
      kind: 'success',
    };
  }

  const reason = optimizerRejectionSummary(stats);
  return {
    text: `No suitable new location found via ${backendLabel}${reason ? ` (${reason})` : ''}.`,
    kind: 'warning',
  };
}

export function optimizerResultDiagnostics(resultCount: number, stats: OptimizerStats | undefined): string[] {
  if (!stats) return [];
  const lines: string[] = [];

  if (Number.isFinite(stats.targetCoverageRatio)) {
    const target = formatPercent(stats.targetCoverageRatio);
    if (stats.targetReached) {
      lines.push(`Target ${target} reached`);
    } else {
      lines.push(`Target ${target} not reached`);
    }
  }
  if (Number.isFinite(stats.initialCoverageRatio)) {
    lines.push(`Initial coverage ${formatPercent(stats.initialCoverageRatio)}`);
  }
  if (Number.isFinite(stats.finalCoverageRatio)) {
    lines.push(`Final coverage ${formatPercent(stats.finalCoverageRatio)}`);
  }
  if (Number.isFinite(stats.roundsCompleted)) {
    lines.push(`${stats.roundsCompleted} round${stats.roundsCompleted === 1 ? '' : 's'} completed`);
  }
  if (Number.isFinite(stats.candidatesScored) || Number.isFinite(stats.candidates)) {
    lines.push(`${stats.candidatesScored ?? 0}/${stats.candidates ?? 0} candidates scored`);
  }

  const rejects = optimizerRejectionSummary(stats);
  if (rejects) lines.push(rejects);
  if (resultCount === 0 && !rejects && (stats.candidates ?? 0) > 0) {
    lines.push('No candidate improved uncovered coverage');
  }
  return lines;
}

export function optimizerShouldRenderDiagnostics(resultCount: number, stats: OptimizerStats | undefined): boolean {
  if (!stats) return false;
  if (resultCount === 0) return optimizerResultDiagnostics(resultCount, stats).length > 0;
  if (Number.isFinite(stats.targetCoverageRatio) && !stats.targetReached) return true;
  return Boolean(optimizerRejectionSummary(stats));
}

function optimizerRejectionSummary(stats: OptimizerStats): string {
  const rejects: string[] = [];
  if (stats.rejectedByExclusion) rejects.push(`${stats.rejectedByExclusion} inside exclusion zones`);
  if (stats.rejectedByElevation) rejects.push(`${stats.rejectedByElevation} below minimum elevation`);
  if (stats.rejectedByRedundancy) rejects.push(`${stats.rejectedByRedundancy} below redundancy target`);
  if (stats.rejectedByMargin) rejects.push(`${stats.rejectedByMargin} below source margin`);
  if (stats.rejectedByLos) rejects.push(`${stats.rejectedByLos} blocked source LoS`);
  if (stats.rejectedByFresnel) rejects.push(`${stats.rejectedByFresnel} blocked source Fresnel`);
  const genericBackhaul = (stats.rejectedByBackhaul ?? 0)
    - (stats.rejectedByMargin ?? 0)
    - (stats.rejectedByLos ?? 0)
    - (stats.rejectedByFresnel ?? 0);
  if (genericBackhaul > 0) rejects.push(`${genericBackhaul} rejected by source link`);
  if (stats.zeroNewCoverage) rejects.push(`${stats.zeroNewCoverage} added no new coverage`);
  return rejects.join(', ');
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
