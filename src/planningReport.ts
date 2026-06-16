import {
  coverageWarningCountText,
  coverageWarningDetailText,
  normalizeCoverageWarnings,
} from './coverageWarnings.js';

type UnknownRecord = Record<string, unknown>;

export type PlanningReportRepeater = {
  id?: number | string;
  name?: string;
  lat?: number;
  lon?: number;
  height?: number;
  power?: number;
  freq?: number;
  gain?: number;
  fromWs?: boolean;
  source?: string;
  lastSeen?: string | number | null;
};

export type PlanningReportCoverageResult = {
  visible?: boolean;
  rep?: { id?: number | string; name?: string } | null;
  label?: string;
  gridRes?: number;
  radiusKm?: number;
  effectiveSens?: number;
  bounds?: {
    latMin?: number;
    latMax?: number;
    lonMin?: number;
    lonMax?: number;
  } | null;
  metadata?: UnknownRecord | null;
  warnings?: unknown[] | null;
};

export type PlanningReportLink = {
  kind?: string;
  label?: string;
  endpointAName?: string;
  endpointBName?: string;
  hopIndex?: number;
  hopTotal?: number;
  margin?: number | null;
  rxPower?: number | null;
  distM?: number | null;
};

export type PlanningReportOptimizerRecommendation = {
  rank?: number;
  lat?: number;
  lon?: number;
  score?: number;
  elevM?: number;
  coverageRatio?: number;
  redundancyRatio?: number;
  avgMarginDb?: number;
  losRatio?: number;
  fresnelRatio?: number;
  backhaulMarginDb?: number;
  backhaulRxPowerDbm?: number;
  backhaulDistanceM?: number;
  backhaulPeerName?: string;
  scoreBreakdown?: UnknownRecord | null;
};

export type PlanningReportInput = {
  generatedAt: string;
  screenshotDataUrl?: string | null;
  screenshotError?: string | null;
  settings?: UnknownRecord | null;
  repeaters?: PlanningReportRepeater[] | null;
  coverageResults?: PlanningReportCoverageResult[] | null;
  p2pLinks?: PlanningReportLink[] | null;
  pathLinks?: PlanningReportLink[] | null;
  optimizerRecommendations?: PlanningReportOptimizerRecommendation[] | null;
  networkStats?: UnknownRecord | null;
};

type TableColumn<T> = {
  label: string;
  value: (item: T, index: number) => string;
};

const NETWORK_STAT_LABELS: Record<string, string> = {
  status: 'Status',
  totalLayerCount: 'Coverage layers',
  visibleLayerCount: 'Visible layers',
  sampleRows: 'Sample rows',
  sampleCols: 'Sample columns',
  analysisAreaKm2: 'Analysis area',
  coveredAreaKm2: 'Covered area',
  uncoveredAreaKm2: 'Uncovered area',
  overlapAreaKm2: 'Overlap area',
  weakAreaKm2: 'Weak area',
  coveredPct: 'Covered',
  redundancyPct: 'Redundancy',
  weakPct: 'Weak coverage',
  averageMarginDb: 'Average margin',
  medianMarginDb: 'Median margin',
  bestMarginDb: 'Best margin',
  topServing: 'Top serving nodes',
  nodeContributions: 'Node contributions',
};

export function buildPlanningReportHtml(input: PlanningReportInput): string {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const repeaters = input.repeaters ?? [];
  const coverageResults = input.coverageResults ?? [];
  const p2pLinks = input.p2pLinks ?? [];
  const pathLinks = input.pathLinks ?? [];
  const allLinks = [...p2pLinks, ...pathLinks];
  const optimizerRecommendations = input.optimizerRecommendations ?? [];
  const visibleCoverageCount = coverageResults.filter(result => result?.visible !== false).length;
  const screenshotDataUrl = safeImageDataUrl(input.screenshotDataUrl);
  const warnings = collectCoverageWarnings(coverageResults);
  const criticalLinks = allLinks
    .filter(link => Number.isFinite(Number(link.margin)))
    .sort((a, b) => Number(a.margin) - Number(b.margin))
    .slice(0, 12);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>MeshCore Mapper Planning Report</title>
  <style>
    :root { color-scheme: light; font-family: Inter, Segoe UI, Arial, sans-serif; color: #172033; background: #f6f7f9; }
    body { margin: 0; padding: 32px; }
    main { max-width: 1120px; margin: 0 auto; background: #fff; border: 1px solid #d7dce5; border-radius: 8px; overflow: hidden; }
    header { padding: 28px 32px; background: #142136; color: #fff; }
    h1, h2, h3 { margin: 0; letter-spacing: 0; }
    h1 { font-size: 28px; }
    h2 { font-size: 18px; margin-bottom: 14px; color: #142136; }
    h3 { font-size: 14px; margin-bottom: 8px; color: #3b4658; }
    section { padding: 24px 32px; border-top: 1px solid #e4e8ef; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; }
    th, td { border: 1px solid #dce2eb; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #eef2f7; color: #243047; font-weight: 700; }
    .meta { margin-top: 8px; color: #d5deeb; font-size: 13px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
    .metric { border: 1px solid #dce2eb; border-radius: 6px; padding: 12px; background: #fbfcfe; }
    .metric span { display: block; color: #5b6678; font-size: 12px; }
    .metric strong { display: block; margin-top: 4px; font-size: 20px; color: #172033; }
    .screenshot { display: block; width: 100%; max-height: 680px; object-fit: contain; border: 1px solid #dce2eb; border-radius: 6px; background: #eef2f7; }
    .placeholder { border: 1px dashed #a7b1c2; border-radius: 6px; padding: 20px; color: #5b6678; background: #fbfcfe; }
    .note-list { margin: 0; padding-left: 18px; color: #3b4658; }
    .note-list li { margin: 5px 0; }
    .nowrap { white-space: nowrap; }
    @media print { body { padding: 0; background: #fff; } main { border: 0; border-radius: 0; } section { break-inside: avoid; } }
  </style>
</head>
<body>
<main>
  <header>
    <h1>MeshCore Mapper Planning Report</h1>
    <div class="meta">Generated ${escapeHtml(formatDateTime(generatedAt))}</div>
  </header>

  <section>
    <h2>Scenario Summary</h2>
    <div class="summary">
      ${metric('Nodes', String(repeaters.length))}
      ${metric('Coverage Layers', `${visibleCoverageCount}/${coverageResults.length}`)}
      ${metric('P2P Links', String(p2pLinks.length))}
      ${metric('Relay Hops', String(pathLinks.length))}
      ${metric('Optimizer Picks', String(optimizerRecommendations.length))}
      ${metric('Screenshot', screenshotDataUrl ? 'Captured' : 'Not captured')}
    </div>
  </section>

  <section>
    <h2>Map Screenshot</h2>
    ${screenshotDataUrl
      ? `<img class="screenshot" src="${escapeAttr(screenshotDataUrl)}" alt="Current map screenshot">`
      : `<div class="placeholder">${escapeHtml(input.screenshotError || 'No screenshot captured for this report.')}</div>`}
  </section>

  <section>
    <h2>Nodes</h2>
    ${table(repeaters, [
      { label: '#', value: (_r, i) => String(i + 1) },
      { label: 'Name', value: r => textOrDash(r.name) },
      { label: 'Latitude', value: r => formatCoordinate(r.lat) },
      { label: 'Longitude', value: r => formatCoordinate(r.lon) },
      { label: 'Height', value: r => formatMeters(r.height) },
      { label: 'Power', value: r => formatDbm(r.power) },
      { label: 'Frequency', value: r => formatMHz(r.freq) },
      { label: 'Gain', value: r => formatDb(r.gain) },
      { label: 'Source', value: r => nodeSource(r) },
    ], 'No nodes are currently in the scenario.')}
  </section>

  <section>
    <h2>Coverage And Weak Areas</h2>
    ${keyValueTable(networkStatRows(input.networkStats ?? {}), 'No coverage statistics are available. Compute coverage first.')}
  </section>

  <section>
    <h2>Coverage Layers</h2>
    ${table(coverageResults, [
      { label: 'Layer', value: coverageLabel },
      { label: 'Visible', value: r => r.visible === false ? 'No' : 'Yes' },
      { label: 'Grid', value: r => formatGrid(r.gridRes) },
      { label: 'Radius', value: r => formatKm(r.radiusKm) },
      { label: 'Threshold', value: r => formatDbm(r.effectiveSens) },
      { label: 'Bounds', value: coverageBounds },
      { label: 'Backend', value: coverageBackend },
      { label: 'Warnings', value: r => formatWarningCount(layerWarnings(r).length) },
    ], 'No coverage layers are currently available.')}
  </section>

  <section>
    <h2>P2P Critical Links</h2>
    ${table(criticalLinks, [
      { label: 'Type', value: linkType },
      { label: 'Link', value: linkName },
      { label: 'Margin', value: r => formatDb(r.margin) },
      { label: 'RX Power', value: r => formatDbm(r.rxPower) },
      { label: 'Distance', value: r => formatMetersOrKm(r.distM) },
      { label: 'Priority', value: linkPriority },
    ], allLinks.length ? 'No computed links include margin data yet.' : 'No active P2P or relay links are currently displayed.')}
  </section>

  <section>
    <h2>Optimizer Recommendations</h2>
    ${table(optimizerRecommendations, [
      { label: 'Rank', value: (r, i) => String(r.rank ?? i + 1) },
      { label: 'Latitude', value: r => formatCoordinate(r.lat) },
      { label: 'Longitude', value: r => formatCoordinate(r.lon) },
      { label: 'Score', value: r => formatPercentRatio(r.score) },
      { label: 'New Coverage', value: r => formatPercentRatio(r.coverageRatio) },
      { label: 'Avg Margin', value: r => formatDb(r.avgMarginDb) },
      { label: 'Backhaul', value: optimizerBackhaul },
      { label: 'Why', value: optimizerWhy },
    ], 'No optimizer recommendations are currently available. Run the optimizer to include suggested locations.')}
  </section>

  <section>
    <h2>Settings</h2>
    ${keyValueTable(settingsRows(input.settings ?? {}), 'No settings were captured.')}
  </section>

  <section>
    <h2>Data Quality Notes</h2>
    <ul class="note-list">
      ${dataQualityNotes(input, coverageResults, allLinks, warnings).map(note => `<li>${escapeHtml(note)}</li>`).join('')}
    </ul>
  </section>
</main>
</body>
</html>`;
}

function metric(label: string, value: string): string {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function table<T>(items: T[], columns: TableColumn<T>[], emptyText: string): string {
  const header = columns.map(col => `<th>${escapeHtml(col.label)}</th>`).join('');
  const body = items.length
    ? items.map((item, index) => `<tr>${columns.map(col => `<td>${escapeHtml(col.value(item, index))}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${columns.length}">${escapeHtml(emptyText)}</td></tr>`;
  return `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

function keyValueTable(rows: Array<[string, string]>, emptyText: string): string {
  if (!rows.length) return `<div class="placeholder">${escapeHtml(emptyText)}</div>`;
  return `<table><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>${rows
    .map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(value)}</td></tr>`)
    .join('')}</tbody></table>`;
}

function networkStatRows(stats: UnknownRecord): Array<[string, string]> {
  return Object.entries(stats)
    .filter(([_key, value]) => value !== undefined)
    .map(([key, value]): [string, string] => [NETWORK_STAT_LABELS[key] ?? key, formatStatValue(key, value)])
    .sort(([a], [b]) => a.localeCompare(b));
}

function settingsRows(settings: UnknownRecord): Array<[string, string]> {
  return Object.entries(settings)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]): [string, string] => [key, formatSettingValue(value)]);
}

function dataQualityNotes(
  input: PlanningReportInput,
  coverageResults: PlanningReportCoverageResult[],
  links: PlanningReportLink[],
  warnings: string[]
): string[] {
  const hiddenCoverage = coverageResults.filter(result => result?.visible === false).length;
  const incompleteCoverage = coverageResults.filter(result => !result?.gridRes || !result?.bounds).length;
  const notes = [
    input.screenshotDataUrl ? 'Map screenshot was embedded in the report.' : `Map screenshot was not embedded${input.screenshotError ? `: ${input.screenshotError}` : '.'}`,
    `${coverageResults.length - hiddenCoverage} visible coverage layer(s), ${hiddenCoverage} hidden coverage layer(s).`,
    `${links.length} active link overlay(s) were included from the current map state.`,
    `${input.optimizerRecommendations?.length ?? 0} optimizer recommendation(s) were included from the latest optimizer run.`,
  ];
  if (incompleteCoverage) notes.push(`${incompleteCoverage} coverage layer(s) are missing grid or bounds metadata.`);
  if (warnings.length) {
    const shownWarnings = coverageWarningDetailText(warnings.slice(0, 6), '; ');
    notes.push(`Coverage warnings: ${shownWarnings}${warnings.length > 6 ? `; and ${warnings.length - 6} more` : ''}.`);
  } else {
    notes.push('No coverage warnings were captured in layer metadata.');
  }
  return notes;
}

function coverageLabel(result: PlanningReportCoverageResult): string {
  return textOrDash(result.rep?.name ?? result.label);
}

function coverageBounds(result: PlanningReportCoverageResult): string {
  const bounds = result.bounds;
  if (!bounds) return '-';
  const latMin = formatCoordinate(bounds.latMin);
  const latMax = formatCoordinate(bounds.latMax);
  const lonMin = formatCoordinate(bounds.lonMin);
  const lonMax = formatCoordinate(bounds.lonMax);
  return `lat ${latMin} to ${latMax}, lon ${lonMin} to ${lonMax}`;
}

function coverageBackend(result: PlanningReportCoverageResult): string {
  const metadata = result.metadata ?? {};
  return textOrDash(firstString(metadata.backend, metadata.backendLabel, metadata.source));
}

function layerWarnings(result: PlanningReportCoverageResult): string[] {
  const metadata = result.metadata ?? {};
  const rawWarnings = result.warnings ?? metadata.warnings ?? metadata.warning ?? metadata.notes ?? [];
  return normalizeCoverageWarnings(rawWarnings);
}

function collectCoverageWarnings(results: PlanningReportCoverageResult[]): string[] {
  return results.flatMap(layerWarnings);
}

function linkType(link: PlanningReportLink): string {
  return link.kind === 'path' ? 'Relay hop' : 'P2P';
}

function linkName(link: PlanningReportLink): string {
  const endpoints = [link.endpointAName, link.endpointBName].filter(Boolean).join(' to ');
  return endpoints || textOrDash(link.label);
}

function linkPriority(link: PlanningReportLink): string {
  const margin = Number(link.margin);
  if (!Number.isFinite(margin)) return 'Unknown';
  if (margin < 0) return 'Failing';
  if (margin < 10) return 'Weak';
  return 'Healthy';
}

function optimizerBackhaul(result: PlanningReportOptimizerRecommendation): string {
  const peer = result.backhaulPeerName ? ` to ${result.backhaulPeerName}` : '';
  const margin = formatDb(result.backhaulMarginDb);
  const rx = formatDbm(result.backhaulRxPowerDbm);
  const distance = formatMetersOrKm(result.backhaulDistanceM);
  if (margin === '-' && rx === '-' && distance === '-') return '-';
  return `${margin}${peer}, ${rx}, ${distance}`;
}

function optimizerWhy(result: PlanningReportOptimizerRecommendation): string {
  const breakdown = result.scoreBreakdown ?? {};
  const label = firstString(breakdown.label, breakdown.formula);
  if (label) return label;
  const los = formatPercentRatio(result.losRatio);
  const fresnel = formatPercentRatio(result.fresnelRatio);
  const redundancy = formatPercentRatio(result.redundancyRatio);
  return `LoS ${los}, Fresnel ${fresnel}, Redundancy ${redundancy}`;
}

function nodeSource(node: PlanningReportRepeater): string {
  if (node.source) return String(node.source);
  return node.fromWs ? 'Live feed' : 'Planned';
}

function safeImageDataUrl(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  return /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value) ? value : null;
}

function formatStatValue(key: string, value: unknown): string {
  if (key.endsWith('Pct')) return formatPercent(value);
  if (key.endsWith('Km2')) return `${formatNumber(value, 3)} km2`;
  if (key.endsWith('Db')) return formatDb(value);
  if ((key === 'topServing' || key === 'nodeContributions') && Array.isArray(value)) {
    return value.map(item => {
      const row = item as UnknownRecord;
      return `${textOrDash(row.label as string)}: ${formatNumber(row.areaKm2, 3)} km2 (${formatPercent(row.pct)})`;
    }).join('; ') || '-';
  }
  return formatSettingValue(value);
}

function formatSettingValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? formatNumber(value, 4) : '-';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function formatCoordinate(value: unknown): string {
  return formatNumber(value, 5);
}

function formatGrid(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? `${n} x ${n}` : '-';
}

function formatMeters(value: unknown): string {
  return Number.isFinite(Number(value)) ? `${formatNumber(value, 1)} m` : '-';
}

function formatMetersOrKm(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return Math.abs(n) >= 1000 ? `${formatNumber(n / 1000, 2)} km` : `${formatNumber(n, 0)} m`;
}

function formatKm(value: unknown): string {
  return Number.isFinite(Number(value)) ? `${formatNumber(value, 2)} km` : '-';
}

function formatMHz(value: unknown): string {
  return Number.isFinite(Number(value)) ? `${formatNumber(value, 3)} MHz` : '-';
}

function formatDbm(value: unknown): string {
  return Number.isFinite(Number(value)) ? `${formatNumber(value, 1)} dBm` : '-';
}

function formatDb(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return `${n > 0 ? '+' : ''}${formatNumber(n, 1)} dB`;
}

function formatPercent(value: unknown): string {
  return Number.isFinite(Number(value)) ? `${formatNumber(value, 1)}%` : '-';
}

function formatPercentRatio(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return `${formatNumber(n * 100, 1)}%`;
}

function formatWarningCount(count: number): string {
  if (!count) return 'None';
  return coverageWarningCountText(count);
}

function formatNumber(value: unknown, digits: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function textOrDash(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value: unknown): string {
  return escapeHtml(value);
}
