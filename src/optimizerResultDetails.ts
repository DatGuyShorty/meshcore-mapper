export type OptimizerResultDetailInput = {
  lat: number;
  lon: number;
  score: number;
  elevM: number;
  coverageRatio?: number;
  redundancyRatio?: number;
  avgMarginDb?: number;
  losRatio?: number;
  fresnelRatio?: number;
  backhaulMarginDb?: number;
  backhaulRxPowerDbm?: number;
  backhaulDistanceM?: number;
  backhaulLos?: boolean;
  backhaulFresnelClear?: boolean;
  backhaulPeerName?: string;
  scoreBreakdown?: ScoreBreakdown;
};

type ScoreBreakdown = {
  label?: string;
  components?: Record<string, { weight?: number; contribution?: number } | null | undefined>;
  prominence?: { contribution?: number } | null;
  roadAdjacency?: { contribution?: number } | null;
};

/**
 * Core candidate explanation rows shared by the list item and marker popup.
 */
export function optimizerResultCoreDetails(result: OptimizerResultDetailInput): string[] {
  const coverage = result.coverageRatio ?? result.score;
  const rows = [
    `New coverage: ${formatPercent(coverage)}`,
    `Score: ${formatPercent(result.score)}`,
    `Elevation: ${result.elevM.toFixed(0)} m`,
  ];
  if (Number.isFinite(result.avgMarginDb)) rows.push(`Average margin: ${(result.avgMarginDb ?? 0).toFixed(1)} dB`);
  if ((result.redundancyRatio ?? 0) > 0) rows.push(`Redundant coverage: ${formatPercent(result.redundancyRatio ?? 0)}`);
  if (Number.isFinite(result.losRatio)) rows.push(`LoS: ${formatPercent(result.losRatio ?? 0, 0)}`);
  if (Number.isFinite(result.fresnelRatio)) rows.push(`Fresnel: ${formatPercent(result.fresnelRatio ?? 0, 0)}`);
  if (Number.isFinite(result.backhaulMarginDb)) {
    const peer = result.backhaulPeerName || 'source';
    rows.push(`Backhaul to ${peer}: ${(result.backhaulMarginDb ?? 0).toFixed(1)} dB`);
    if (Number.isFinite(result.backhaulRxPowerDbm)) rows.push(`Backhaul RX: ${(result.backhaulRxPowerDbm ?? 0).toFixed(1)} dBm`);
    if (Number.isFinite(result.backhaulDistanceM)) rows.push(`Backhaul distance: ${formatDistance(result.backhaulDistanceM ?? 0)}`);
    rows.push(`Backhaul LoS: ${result.backhaulLos ? 'clear' : 'blocked'}`);
    if (typeof result.backhaulFresnelClear === 'boolean') {
      rows.push(`Backhaul Fresnel: ${result.backhaulFresnelClear ? 'clear' : 'blocked'}`);
    }
  }
  const why = optimizerScoreBreakdownSummary(result.scoreBreakdown);
  if (why) rows.push(`Why: ${why}`);
  return rows;
}

export function optimizerScoreBreakdownSummary(breakdown: ScoreBreakdown | null | undefined): string {
  if (!breakdown?.components) return '';
  const labels: Record<string, string> = {
    coverage: 'cov',
    redundancy: 'redund',
    margin: 'margin',
    los: 'LoS',
    fresnel: 'Fresnel',
    backhaul: 'source',
  };
  const parts = Object.entries(labels)
    .map(([key, label]) => {
      const component = breakdown.components?.[key];
      if (!component || (component.weight ?? 0) <= 0 || (component.contribution ?? 0) <= 0) return '';
      return `${label} ${((component.contribution ?? 0) * 100).toFixed(1)}%`;
    })
    .filter(Boolean);
  if ((breakdown.prominence?.contribution ?? 0) > 0) {
    parts.push(`terrain ${((breakdown.prominence?.contribution ?? 0) * 100).toFixed(1)}%`);
  }
  if ((breakdown.roadAdjacency?.contribution ?? 0) > 0) {
    parts.push(`access ${((breakdown.roadAdjacency?.contribution ?? 0) * 100).toFixed(1)}%`);
  }
  return parts.length ? `${breakdown.label || 'Objective'}: ${parts.join(', ')}` : '';
}

function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters.toFixed(0)} m`;
}
