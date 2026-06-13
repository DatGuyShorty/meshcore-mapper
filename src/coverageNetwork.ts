const DEFAULT_MAX_SAMPLES = 40000;
const DEFAULT_WEAK_MARGIN_DB = 10;
const DEFAULT_OVERLAY_MAX_SIDE = 512;

export type CombinedCoverageOverlayMode = 'none' | 'best-margin' | 'gaps' | 'overlap' | 'strongest-node' | 'covered-by-n';

type Bbox = {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
};

export type CombinedCoverageLayer = {
  grid: ArrayLike<number>;
  gridRes: number;
  bounds: Bbox;
  threshold: number;
  sourceKey: string;
  label: string;
  color: readonly [number, number, number];
};

type SummaryBase = {
  status: string;
  totalLayerCount: number;
  visibleLayerCount: number;
};

type ServingSummary = {
  label: string;
  areaKm2: number;
  pct: number;
};

export type CombinedCoverageSummary = SummaryBase & Partial<{
  sampleRows: number;
  sampleCols: number;
  analysisAreaKm2: number;
  coveredAreaKm2: number;
  uncoveredAreaKm2: number;
  overlapAreaKm2: number;
  weakAreaKm2: number;
  coveredPct: number;
  redundancyPct: number;
  weakPct: number;
  averageMarginDb: number | null;
  medianMarginDb: number | null;
  bestMarginDb: number | null;
  topServing: ServingSummary[];
}>;

type NodeFailureImpact = {
  sourceKey: string;
  label: string;
  coveredAreaKm2: number;
  lostAreaKm2: number;
  lostPctOfNetwork: number;
  lostPctOfSourceCoverage: number;
};

export type NodeFailureSummary = SummaryBase & Partial<{
  sampleRows: number;
  sampleCols: number;
  analysisAreaKm2: number;
  baselineCoveredAreaKm2: number;
  impacts: NodeFailureImpact[];
}>;

export type CombinedCoverageOverlay = {
  status: string;
  mode: CombinedCoverageOverlayMode;
  bounds?: Bbox;
  gridRes?: number;
  rgba?: Uint8ClampedArray;
  paintedPixels?: number;
  visibleLayerCount?: number;
  minCoverageCount?: number;
};

type CoverageNetworkOptions = {
  maxSamples?: number;
  weakMarginDb?: number;
  offlineSourceKeys?: Iterable<string>;
};

type CombinedOverlayOptions = {
  mode?: unknown;
  maxSide?: number;
  minCoverageCount?: number;
  offlineSourceKeys?: Iterable<string>;
};

type SourceImpactCounter = {
  sourceKey: string;
  label: string;
  coveredCells: number;
  exclusiveCells: number;
};

type SampleShape = {
  rows: number;
  cols: number;
};

export const COMBINED_COVERAGE_OVERLAY_MODES = Object.freeze([
  'none',
  'best-margin',
  'gaps',
  'overlap',
  'strongest-node',
  'covered-by-n',
] as const);

export function normalizeCombinedCoverageOverlayMode(mode: unknown): CombinedCoverageOverlayMode {
  return COMBINED_COVERAGE_OVERLAY_MODES.includes(mode as CombinedCoverageOverlayMode)
    ? mode as CombinedCoverageOverlayMode
    : 'none';
}

/**
 * Build an approximate combined-network summary from visible coverage layers.
 * Layers may have different bounds/resolutions, so this samples a common grid
 * over their union instead of assuming their rasters align.
 */
export function summarizeCombinedCoverage(
  results: any[] | null | undefined,
  options: CoverageNetworkOptions = {},
): CombinedCoverageSummary {
  const all = Array.isArray(results) ? results : [];
  const layers = _activeLayers(all, options);
  if (!layers.length) {
    return {
      status: all.length ? 'no-visible-layers' : 'empty',
      totalLayerCount: all.length,
      visibleLayerCount: 0,
    };
  }

  const bounds = _unionBounds(layers);
  if (!bounds) {
    return {
      status: 'no-data',
      totalLayerCount: all.length,
      visibleLayerCount: layers.length,
    };
  }

  const maxSamples = _positiveInt(options.maxSamples, DEFAULT_MAX_SAMPLES);
  const weakMarginDb = _finiteOr(options.weakMarginDb, DEFAULT_WEAK_MARGIN_DB);
  const shape = _sampleShape(bounds, maxSamples);
  const bboxAreaKm2 = _bboxAreaKm2(bounds);
  const cellAreaKm2 = bboxAreaKm2 / Math.max(1, shape.rows * shape.cols);
  const serving = new Map<string, number>();
  const coveredMargins: number[] = [];

  let analysisCells = 0;
  let coveredCells = 0;
  let uncoveredCells = 0;
  let overlapCells = 0;
  let weakCells = 0;
  let bestMarginDb = -Infinity;
  let marginSum = 0;

  for (let row = 0; row < shape.rows; row++) {
    const lat = bounds.latMax - ((row + 0.5) / shape.rows) * (bounds.latMax - bounds.latMin);
    for (let col = 0; col < shape.cols; col++) {
      const lon = bounds.lonMin + ((col + 0.5) / shape.cols) * (bounds.lonMax - bounds.lonMin);
      let insideAny = false;
      let coverageCount = 0;
      let best: { margin: number; label: string } | null = null;

      for (const layer of layers) {
        const rx = _sampleLayer(layer, lat, lon);
        if (!Number.isFinite(rx)) continue;
        insideAny = true;
        const margin = rx - layer.threshold;
        if (!best || margin > best.margin) best = { margin, label: layer.label };
        if (margin >= 0) coverageCount++;
      }

      if (!insideAny || !best) continue;
      analysisCells++;
      if (coverageCount > 0) {
        coveredCells++;
        if (coverageCount > 1) overlapCells++;
        if (best.margin < weakMarginDb) weakCells++;
        bestMarginDb = Math.max(bestMarginDb, best.margin);
        marginSum += best.margin;
        coveredMargins.push(best.margin);
        serving.set(best.label, (serving.get(best.label) ?? 0) + 1);
      } else {
        uncoveredCells++;
      }
    }
  }

  if (!analysisCells) {
    return {
      status: 'no-data',
      totalLayerCount: all.length,
      visibleLayerCount: layers.length,
    };
  }

  coveredMargins.sort((a, b) => a - b);
  const coveredAreaKm2 = coveredCells * cellAreaKm2;
  const analysisAreaKm2 = analysisCells * cellAreaKm2;
  return {
    status: 'ready',
    totalLayerCount: all.length,
    visibleLayerCount: layers.length,
    sampleRows: shape.rows,
    sampleCols: shape.cols,
    analysisAreaKm2,
    coveredAreaKm2,
    uncoveredAreaKm2: uncoveredCells * cellAreaKm2,
    overlapAreaKm2: overlapCells * cellAreaKm2,
    weakAreaKm2: weakCells * cellAreaKm2,
    coveredPct: coveredCells / analysisCells * 100,
    redundancyPct: coveredCells ? overlapCells / coveredCells * 100 : 0,
    weakPct: coveredCells ? weakCells / coveredCells * 100 : 0,
    averageMarginDb: coveredCells ? marginSum / coveredCells : null,
    medianMarginDb: _median(coveredMargins),
    bestMarginDb: Number.isFinite(bestMarginDb) ? bestMarginDb : null,
    topServing: [...serving.entries()]
      .map(([label, cells]) => ({
        label,
        areaKm2: cells * cellAreaKm2,
        pct: coveredCells ? cells / coveredCells * 100 : 0,
      }))
      .sort((a, b) => b.areaKm2 - a.areaKm2)
      .slice(0, 3),
  };
}

export function coverageNetworkStatsForExport(summary: CombinedCoverageSummary): Record<string, any> {
  if (summary.status !== 'ready') {
    return {
      status: summary.status,
      totalLayerCount: summary.totalLayerCount ?? 0,
      visibleLayerCount: summary.visibleLayerCount ?? 0,
    };
  }

  return {
    status: summary.status,
    totalLayerCount: summary.totalLayerCount,
    visibleLayerCount: summary.visibleLayerCount,
    sampleRows: summary.sampleRows,
    sampleCols: summary.sampleCols,
    analysisAreaKm2: _round(summary.analysisAreaKm2 ?? 0, 3),
    coveredAreaKm2: _round(summary.coveredAreaKm2 ?? 0, 3),
    uncoveredAreaKm2: _round(summary.uncoveredAreaKm2 ?? 0, 3),
    overlapAreaKm2: _round(summary.overlapAreaKm2 ?? 0, 3),
    weakAreaKm2: _round(summary.weakAreaKm2 ?? 0, 3),
    coveredPct: _round(summary.coveredPct ?? 0, 2),
    redundancyPct: _round(summary.redundancyPct ?? 0, 2),
    weakPct: _round(summary.weakPct ?? 0, 2),
    averageMarginDb: _roundNullable(summary.averageMarginDb ?? null, 2),
    medianMarginDb: _roundNullable(summary.medianMarginDb ?? null, 2),
    bestMarginDb: _roundNullable(summary.bestMarginDb ?? null, 2),
    topServing: (summary.topServing ?? []).map(item => ({
      label: item.label,
      areaKm2: _round(item.areaKm2, 3),
      pct: _round(item.pct, 2),
    })),
  };
}

/**
 * Estimate critical source nodes by sampling visible coverage layers. A source
 * is critical for a cell only when that source is the sole source covering it.
 */
export function summarizeNodeFailureImpact(
  results: any[] | null | undefined,
  options: Pick<CoverageNetworkOptions, 'maxSamples' | 'offlineSourceKeys'> = {},
): NodeFailureSummary {
  const all = Array.isArray(results) ? results : [];
  const layers = _activeLayers(all, options);
  if (!layers.length) {
    return {
      status: all.length ? 'no-visible-layers' : 'empty',
      totalLayerCount: all.length,
      visibleLayerCount: 0,
    };
  }

  const bounds = _unionBounds(layers);
  if (!bounds) {
    return {
      status: 'no-data',
      totalLayerCount: all.length,
      visibleLayerCount: layers.length,
    };
  }

  const shape = _sampleShape(bounds, _positiveInt(options.maxSamples, DEFAULT_MAX_SAMPLES));
  const bboxAreaKm2 = _bboxAreaKm2(bounds);
  const cellAreaKm2 = bboxAreaKm2 / Math.max(1, shape.rows * shape.cols);
  const bySource = new Map<string, SourceImpactCounter>();
  let analysisCells = 0;
  let coveredCells = 0;

  for (let row = 0; row < shape.rows; row++) {
    const lat = bounds.latMax - ((row + 0.5) / shape.rows) * (bounds.latMax - bounds.latMin);
    for (let col = 0; col < shape.cols; col++) {
      const lon = bounds.lonMin + ((col + 0.5) / shape.cols) * (bounds.lonMax - bounds.lonMin);
      let insideAny = false;
      const coveringSources = new Map<string, string>();

      for (const layer of layers) {
        const rx = _sampleLayer(layer, lat, lon);
        if (!Number.isFinite(rx)) continue;
        insideAny = true;
        if (rx >= layer.threshold) coveringSources.set(layer.sourceKey, layer.label);
      }

      if (!insideAny) continue;
      analysisCells++;
      if (!coveringSources.size) continue;
      coveredCells++;

      for (const [sourceKey, label] of coveringSources) {
        const item = _sourceImpact(bySource, sourceKey, label);
        item.coveredCells++;
      }
      if (coveringSources.size === 1) {
        const only = coveringSources.entries().next().value;
        if (only) {
          const [sourceKey, label] = only;
          _sourceImpact(bySource, sourceKey, label).exclusiveCells++;
        }
      }
    }
  }

  if (!analysisCells) {
    return {
      status: 'no-data',
      totalLayerCount: all.length,
      visibleLayerCount: layers.length,
    };
  }
  if (!coveredCells) {
    return {
      status: 'no-covered-cells',
      totalLayerCount: all.length,
      visibleLayerCount: layers.length,
      analysisAreaKm2: analysisCells * cellAreaKm2,
    };
  }

  const baselineCoveredAreaKm2 = coveredCells * cellAreaKm2;
  return {
    status: 'ready',
    totalLayerCount: all.length,
    visibleLayerCount: layers.length,
    sampleRows: shape.rows,
    sampleCols: shape.cols,
    analysisAreaKm2: analysisCells * cellAreaKm2,
    baselineCoveredAreaKm2,
    impacts: [...bySource.values()]
      .map(item => ({
        sourceKey: item.sourceKey,
        label: item.label,
        coveredAreaKm2: item.coveredCells * cellAreaKm2,
        lostAreaKm2: item.exclusiveCells * cellAreaKm2,
        lostPctOfNetwork: item.exclusiveCells / coveredCells * 100,
        lostPctOfSourceCoverage: item.coveredCells ? item.exclusiveCells / item.coveredCells * 100 : 0,
      }))
      .sort((a, b) => (b.lostAreaKm2 - a.lostAreaKm2) || a.label.localeCompare(b.label)),
  };
}

export function buildCombinedCoverageOverlay(
  results: any[] | null | undefined,
  options: CombinedOverlayOptions = {},
): CombinedCoverageOverlay {
  const mode = normalizeCombinedCoverageOverlayMode(options.mode);
  const all = Array.isArray(results) ? results : [];
  if (mode === 'none') return { status: 'disabled', mode };

  const layers = _activeLayers(all, options);
  if (!layers.length) return { status: all.length ? 'no-visible-layers' : 'empty', mode };

  const bounds = _unionBounds(layers);
  if (!bounds) return { status: 'no-data', mode };

  const gridRes = _overlayGridRes(bounds, _positiveInt(options.maxSide, DEFAULT_OVERLAY_MAX_SIDE));
  const minCoverageCount = Math.max(1, _positiveInt(options.minCoverageCount, 2));
  const rgba = new Uint8ClampedArray(gridRes * gridRes * 4);
  let paintedPixels = 0;

  for (let row = 0; row < gridRes; row++) {
    const lat = bounds.latMax - (row / Math.max(1, gridRes - 1)) * (bounds.latMax - bounds.latMin);
    for (let col = 0; col < gridRes; col++) {
      const lon = bounds.lonMin + (col / Math.max(1, gridRes - 1)) * (bounds.lonMax - bounds.lonMin);
      let insideAny = false;
      let coverageCount = 0;
      let bestMargin = -Infinity;
      let bestRx = -Infinity;
      let strongestLayer: CombinedCoverageLayer | null = null;

      for (const layer of layers) {
        const rx = _sampleLayer(layer, lat, lon);
        if (!Number.isFinite(rx)) continue;
        insideAny = true;
        const margin = rx - layer.threshold;
        bestMargin = Math.max(bestMargin, margin);
        if (margin >= 0) {
          coverageCount++;
          if (rx > bestRx) {
            bestRx = rx;
            strongestLayer = layer;
          }
        }
      }

      const base = (row * gridRes + col) * 4;
      if (mode === 'best-margin') {
        _writeBestMarginPixel(rgba, base, coverageCount > 0 ? bestMargin : NaN);
      } else if (mode === 'gaps') {
        _writeGapPixel(rgba, base, insideAny && coverageCount === 0);
      } else if (mode === 'overlap') {
        _writeOverlapPixel(rgba, base, coverageCount);
      } else if (mode === 'strongest-node') {
        _writeStrongestNodePixel(rgba, base, strongestLayer);
      } else if (mode === 'covered-by-n') {
        _writeCoveredByNPixel(rgba, base, coverageCount, minCoverageCount);
      }
      if (rgba[base + 3] > 0) paintedPixels++;
    }
  }

  return {
    status: paintedPixels ? 'ready' : 'empty-overlay',
    mode,
    bounds,
    gridRes,
    rgba,
    paintedPixels,
    visibleLayerCount: layers.length,
    minCoverageCount,
  };
}

function _normalizeLayer(result: any): CombinedCoverageLayer | null {
  const grid = result?.signalGrid;
  const gridRes = Number(result?.gridRes);
  const bounds = result?.bounds;
  const threshold = _threshold(result);
  if (!grid || typeof grid.length !== 'number') return null;
  if (!Number.isInteger(gridRes) || gridRes < 1 || grid.length < gridRes * gridRes) return null;
  if (!_validBounds(bounds) || !Number.isFinite(threshold)) return null;
  return {
    grid,
    gridRes,
    bounds,
    threshold,
    sourceKey: coverageLayerSourceKey(result),
    label: String(result?.rep?.name ?? result?.label ?? 'Layer'),
    color: _sourceColor(String(result?.rep?.name ?? result?.label ?? 'Layer')),
  };
}

export function coverageLayerSourceKey(result: any): string {
  if (result?.rep?.id !== undefined && result?.rep?.id !== null) return `id:${String(result.rep.id)}`;
  const name = String(result?.rep?.name ?? result?.label ?? 'Layer');
  const lat = Number(result?.rep?.lat);
  const lon = Number(result?.rep?.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon)) return `node:${name}:${lat.toFixed(5)}:${lon.toFixed(5)}`;
  return `node:${name}`;
}

function _activeLayers(all: any[], options: { offlineSourceKeys?: Iterable<string> } = {}): CombinedCoverageLayer[] {
  const offline = new Set(options.offlineSourceKeys ?? []);
  return all
    .filter(result => result?.visible !== false)
    .map(_normalizeLayer)
    .filter(_isLayer)
    .filter(layer => !offline.has(layer.sourceKey));
}

function _isLayer(layer: CombinedCoverageLayer | null): layer is CombinedCoverageLayer {
  return layer !== null;
}

function _threshold(result: any): number {
  const effective = Number(result?.effectiveSens);
  if (Number.isFinite(effective)) return effective;
  const rxSens = Number(result?.rxSens);
  const fadeMargin = Number(result?.fadeMargin);
  if (Number.isFinite(rxSens) && Number.isFinite(fadeMargin)) return rxSens + fadeMargin;
  return NaN;
}

function _validBounds(bounds: any): bounds is Bbox {
  return Number.isFinite(bounds?.latMin)
    && Number.isFinite(bounds?.latMax)
    && Number.isFinite(bounds?.lonMin)
    && Number.isFinite(bounds?.lonMax)
    && bounds.latMax > bounds.latMin
    && bounds.lonMax > bounds.lonMin;
}

function _unionBounds(layers: Array<{ bounds: Bbox }>): Bbox | null {
  const bounds = {
    latMin: Infinity,
    latMax: -Infinity,
    lonMin: Infinity,
    lonMax: -Infinity,
  };
  for (const layer of layers) {
    bounds.latMin = Math.min(bounds.latMin, layer.bounds.latMin);
    bounds.latMax = Math.max(bounds.latMax, layer.bounds.latMax);
    bounds.lonMin = Math.min(bounds.lonMin, layer.bounds.lonMin);
    bounds.lonMax = Math.max(bounds.lonMax, layer.bounds.lonMax);
  }
  return _validBounds(bounds) ? bounds : null;
}

function _sampleShape(bounds: Bbox, maxSamples: number): SampleShape {
  const centerLat = (bounds.latMin + bounds.latMax) / 2;
  const latKm = Math.max(0.001, (bounds.latMax - bounds.latMin) * 111.32);
  const lonKm = Math.max(0.001, (bounds.lonMax - bounds.lonMin) * 111.32 * Math.max(0.15, Math.cos(centerLat * Math.PI / 180)));
  const aspect = Math.max(0.2, Math.min(5, lonKm / latKm));
  const cols = Math.max(8, Math.min(250, Math.round(Math.sqrt(maxSamples * aspect))));
  const rows = Math.max(8, Math.min(250, Math.floor(maxSamples / cols)));
  return { rows, cols };
}

function _overlayGridRes(bounds: Bbox, maxSide: number): number {
  const centerLat = (bounds.latMin + bounds.latMax) / 2;
  const latKm = Math.max(0.001, (bounds.latMax - bounds.latMin) * 111.32);
  const lonKm = Math.max(0.001, (bounds.lonMax - bounds.lonMin) * 111.32 * Math.max(0.15, Math.cos(centerLat * Math.PI / 180)));
  const longSideKm = Math.max(latKm, lonKm);
  const shortSideKm = Math.min(latKm, lonKm);
  const side = Math.max(32, Math.min(maxSide, Math.round(maxSide * Math.max(0.35, shortSideKm / longSideKm))));
  return Math.max(32, side);
}

function _bboxAreaKm2(bounds: Bbox): number {
  const centerLat = (bounds.latMin + bounds.latMax) / 2;
  const latKm = Math.abs(bounds.latMax - bounds.latMin) * 111.32;
  const lonKm = Math.abs(bounds.lonMax - bounds.lonMin) * 111.32 * Math.max(0.15, Math.cos(centerLat * Math.PI / 180));
  return latKm * lonKm;
}

function _sampleLayer(layer: Pick<CombinedCoverageLayer, 'grid' | 'gridRes' | 'bounds'>, lat: number, lon: number): number {
  const { bounds, grid, gridRes } = layer;
  if (lat < bounds.latMin || lat > bounds.latMax || lon < bounds.lonMin || lon > bounds.lonMax) return NaN;
  const row = Math.max(0, Math.min(gridRes - 1, Math.round((bounds.latMax - lat) / (bounds.latMax - bounds.latMin) * (gridRes - 1))));
  const col = Math.max(0, Math.min(gridRes - 1, Math.round((lon - bounds.lonMin) / (bounds.lonMax - bounds.lonMin) * (gridRes - 1))));
  return Number(grid[row * gridRes + col]);
}

function _positiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

function _finiteOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _median(values: number[]): number | null {
  if (!values.length) return null;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

function _round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function _roundNullable(value: number | null, decimals: number): number | null {
  return value === null ? null : _round(value, decimals);
}

function _sourceImpact(map: Map<string, SourceImpactCounter>, sourceKey: string, label: string): SourceImpactCounter {
  let item = map.get(sourceKey);
  if (!item) {
    item = { sourceKey, label, coveredCells: 0, exclusiveCells: 0 };
    map.set(sourceKey, item);
  }
  return item;
}

function _writeBestMarginPixel(buf: Uint8ClampedArray, base: number, margin: number): void {
  if (!Number.isFinite(margin)) return;
  const t = Math.max(0, Math.min(1, margin / 50));
  buf[base] = Math.round(245 - 205 * t);
  buf[base + 1] = Math.round(120 + 95 * t);
  buf[base + 2] = Math.round(30 + 170 * t);
  buf[base + 3] = Math.round(90 + 95 * t);
}

function _writeGapPixel(buf: Uint8ClampedArray, base: number, isGap: boolean): void {
  if (!isGap) return;
  buf[base] = 235;
  buf[base + 1] = 60;
  buf[base + 2] = 60;
  buf[base + 3] = 150;
}

function _writeOverlapPixel(buf: Uint8ClampedArray, base: number, count: number): void {
  if (count < 2) return;
  const t = Math.max(0, Math.min(1, (count - 2) / 3));
  buf[base] = Math.round(70 - 30 * t);
  buf[base + 1] = Math.round(170 + 45 * t);
  buf[base + 2] = Math.round(220 - 90 * t);
  buf[base + 3] = Math.round(120 + 65 * t);
}

function _writeStrongestNodePixel(buf: Uint8ClampedArray, base: number, layer: CombinedCoverageLayer | null): void {
  if (!layer) return;
  buf[base] = layer.color[0];
  buf[base + 1] = layer.color[1];
  buf[base + 2] = layer.color[2];
  buf[base + 3] = 155;
}

function _writeCoveredByNPixel(buf: Uint8ClampedArray, base: number, count: number, minCoverageCount: number): void {
  if (count < minCoverageCount) return;
  const t = Math.max(0, Math.min(1, (count - minCoverageCount) / 3));
  buf[base] = Math.round(95 - 45 * t);
  buf[base + 1] = Math.round(185 + 35 * t);
  buf[base + 2] = Math.round(90 + 80 * t);
  buf[base + 3] = Math.round(130 + 45 * t);
}

function _sourceColor(text: string): readonly [number, number, number] {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hue = ((hash >>> 0) % 360) / 60;
  const c = 170;
  const x = Math.round(c * (1 - Math.abs(hue % 2 - 1)));
  const m = 50;
  if (hue < 1) return [c + m, x + m, m];
  if (hue < 2) return [x + m, c + m, m];
  if (hue < 3) return [m, c + m, x + m];
  if (hue < 4) return [m, x + m, c + m];
  if (hue < 5) return [x + m, m, c + m];
  return [c + m, m, x + m];
}
