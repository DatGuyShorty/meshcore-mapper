import type { CombinedCoverageSummary, NodeFailureSummary } from './coverageNetwork.js';

export type CoverageNetworkSimulation = {
  sourceKey: string;
  label: string;
} | null;

export type CoverageNetworkRow = {
  label: string;
  value: string;
};

export type CoverageNetworkFailureRow = CoverageNetworkRow & {
  action?: {
    text: string;
    sourceKey: string;
    label: string;
  };
};

export type CoverageNetworkSummaryModel =
  | {
    status: 'empty';
    simulation: CoverageNetworkSimulation;
    emptyText: string;
  }
  | {
    status: 'ready';
    simulation: CoverageNetworkSimulation;
    title: string;
    visibleLayerText: string;
    metrics: CoverageNetworkRow[];
    topServingText: string | null;
    statsRows: CoverageNetworkRow[];
    failureRows: CoverageNetworkFailureRow[];
  };

type CoverageNetworkDocumentLike = Pick<Document, 'createElement'>;

export type CoverageNetworkSummaryCallbacks = {
  onSimulateOffline?: (sourceKey: string, label: string) => void;
  onClearSimulation?: () => void;
  doc?: CoverageNetworkDocumentLike;
};

export function buildCoverageNetworkSummaryModel(
  summary: CombinedCoverageSummary,
  failure: NodeFailureSummary | null,
  simulation: CoverageNetworkSimulation,
): CoverageNetworkSummaryModel {
  const activeSimulation = simulation?.sourceKey ? simulation : null;
  if (summary.status !== 'ready') {
    return {
      status: 'empty',
      simulation: activeSimulation,
      emptyText: summary.status === 'no-visible-layers'
        ? 'No visible coverage layers.'
        : 'No combined coverage yet.',
    };
  }

  return {
    status: 'ready',
    simulation: activeSimulation,
    title: activeSimulation
      ? `Combined Network - ${activeSimulation.label} offline`
      : 'Combined Visible Network',
    visibleLayerText: `${summary.visibleLayerCount} visible layer${summary.visibleLayerCount === 1 ? '' : 's'}`,
    metrics: [
      { label: 'Covered area', value: _fmtArea(summary.coveredAreaKm2) },
      { label: 'Covered', value: _fmtPct(summary.coveredPct) },
      { label: 'Uncovered', value: _fmtArea(summary.uncoveredAreaKm2) },
      { label: 'Redundancy', value: _fmtPct(summary.redundancyPct) },
      { label: 'Weak margin', value: _fmtPct(summary.weakPct) },
      { label: 'Median margin', value: _fmtDb(summary.medianMarginDb) },
    ],
    topServingText: summary.topServing?.length
      ? `Top serving: ${summary.topServing.map(item => `${item.label} ${_fmtPct(item.pct)}`).join(', ')}`
      : null,
    statsRows: coverageNetworkStatsRows(summary),
    failureRows: failure?.status === 'ready'
      ? coverageNodeFailureRows(failure, activeSimulation?.sourceKey ?? null)
      : [],
  };
}

export function renderCoverageNetworkSummaryModel(
  container: HTMLElement,
  model: CoverageNetworkSummaryModel,
  callbacks: CoverageNetworkSummaryCallbacks = {},
): void {
  const doc = callbacks.doc ?? document;
  container.textContent = '';
  if (model.simulation) container.appendChild(_renderSimulationBanner(model.simulation, callbacks, doc));

  if (model.status === 'empty') {
    const empty = doc.createElement('div');
    empty.className = 'empty-msg';
    empty.textContent = model.emptyText;
    container.appendChild(empty);
    return;
  }

  const head = doc.createElement('div');
  head.className = 'coverage-network-head';
  const title = doc.createElement('span');
  title.textContent = model.title;
  const count = doc.createElement('span');
  count.textContent = model.visibleLayerText;
  head.append(title, count);

  const metrics = doc.createElement('div');
  metrics.className = 'coverage-network-metrics';
  for (const row of model.metrics) {
    const item = doc.createElement('span');
    const key = doc.createElement('b');
    key.textContent = row.label;
    const value = doc.createElement('em');
    value.textContent = row.value;
    item.append(key, value);
    metrics.appendChild(item);
  }

  container.append(head, metrics);

  if (model.topServingText) {
    const top = doc.createElement('div');
    top.className = 'coverage-network-serving';
    top.textContent = model.topServingText;
    container.appendChild(top);
  }

  container.appendChild(_renderDetails('Network stats', 'coverage-network-details', model.statsRows, callbacks, doc));

  if (model.failureRows.length) {
    container.appendChild(_renderDetails(
      'Critical nodes',
      'coverage-network-details coverage-network-critical',
      model.failureRows,
      callbacks,
      doc,
    ));
  }
}

export function coverageNetworkStatsRows(summary: CombinedCoverageSummary): CoverageNetworkRow[] {
  return [
    { label: 'Analysis area', value: _fmtArea(summary.analysisAreaKm2) },
    { label: 'Covered area', value: _fmtArea(summary.coveredAreaKm2) },
    { label: 'Uncovered area', value: _fmtArea(summary.uncoveredAreaKm2) },
    { label: 'Overlap area', value: _fmtArea(summary.overlapAreaKm2) },
    { label: 'Weak-margin area', value: _fmtArea(summary.weakAreaKm2) },
    { label: 'Average margin', value: _fmtDb(summary.averageMarginDb) },
    { label: 'Median margin', value: _fmtDb(summary.medianMarginDb) },
    { label: 'Best margin', value: _fmtDb(summary.bestMarginDb) },
    { label: 'Sample grid', value: `${summary.sampleRows} x ${summary.sampleCols}` },
    {
      label: 'Top serving',
      value: summary.topServing?.length
        ? _fmtServingRows(summary.topServing)
        : 'n/a',
    },
    {
      label: 'Node contributions',
      value: summary.nodeContributions?.length
        ? _fmtServingRows(summary.nodeContributions)
        : 'n/a',
    },
  ];
}

export function coverageNodeFailureRows(
  failure: NodeFailureSummary,
  activeOfflineSourceKey: string | null,
): CoverageNetworkFailureRow[] {
  const rows: CoverageNetworkFailureRow[] = [
    { label: 'Baseline covered', value: _fmtArea(failure.baselineCoveredAreaKm2) },
  ];
  for (const impact of (failure.impacts ?? []).slice(0, 5)) {
    rows.push({
      label: impact.label,
      value: `${_fmtArea(impact.lostAreaKm2)} lost (${_fmtPct(impact.lostPctOfNetwork)} of network, ${_fmtPct(impact.lostPctOfSourceCoverage)} of node coverage)`,
      action: {
        text: activeOfflineSourceKey === impact.sourceKey ? 'Active' : 'Sim',
        sourceKey: impact.sourceKey,
        label: impact.label,
      },
    });
  }
  return rows;
}

function _renderSimulationBanner(
  simulation: NonNullable<CoverageNetworkSimulation>,
  callbacks: CoverageNetworkSummaryCallbacks,
  doc: CoverageNetworkDocumentLike,
): HTMLElement {
  const banner = doc.createElement('div');
  banner.className = 'coverage-network-sim';
  const text = doc.createElement('span');
  text.textContent = `Simulating ${simulation.label} offline`;
  const clear = doc.createElement('button');
  clear.type = 'button';
  clear.textContent = 'Clear';
  clear.addEventListener('click', () => callbacks.onClearSimulation?.());
  banner.append(text, clear);
  return banner;
}

function _renderDetails(
  summaryText: string,
  className: string,
  rows: Array<CoverageNetworkRow | CoverageNetworkFailureRow>,
  callbacks: CoverageNetworkSummaryCallbacks,
  doc: CoverageNetworkDocumentLike,
): HTMLElement {
  const details = doc.createElement('details');
  details.className = className;
  const summary = doc.createElement('summary');
  summary.textContent = summaryText;
  details.appendChild(summary);
  const list = doc.createElement('dl');
  for (const row of rows) {
    const dt = doc.createElement('dt');
    dt.textContent = row.label;
    const dd = doc.createElement('dd');
    const action = 'action' in row ? row.action : undefined;
    if (action) {
      const text = doc.createElement('span');
      text.textContent = row.value;
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = action.text;
      button.addEventListener('click', () => callbacks.onSimulateOffline?.(action.sourceKey, action.label));
      dd.append(text, button);
    } else {
      dd.textContent = row.value;
    }
    list.append(dt, dd);
  }
  details.appendChild(list);
  return details;
}

function _fmtArea(km2: unknown): string {
  const n = Number(km2);
  if (!Number.isFinite(n) || n <= 0) return '0 km2';
  if (n < 1) return `${(n * 100).toFixed(1)} ha`;
  return `${n.toFixed(n >= 10 ? 0 : 1)} km2`;
}

function _fmtPct(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(n >= 10 ? 0 : 1)}%` : 'n/a';
}

function _fmtDb(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(1)} dB` : 'n/a';
}

function _fmtServingRows(items: Array<{ label: string; areaKm2: number; pct: number }>): string {
  return items.map(item => `${item.label} ${_fmtArea(item.areaKm2)} (${_fmtPct(item.pct)})`).join(', ');
}
