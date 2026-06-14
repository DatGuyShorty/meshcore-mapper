import {
  coverageLayerDetailRows,
  formatCoverageLayerMeta,
  formatCoverageLayerTitle,
  groupCoverageLayersByScenario,
} from './coverageMetadata.js';

const EMPTY_LAYER_TEXT = 'No coverage layers yet. Compute coverage to add one.';

export type CoverageLayerManagerDetail = {
  label: string;
  value: string;
  warning: boolean;
};

export type CoverageLayerManagerRow =
  | { kind: 'empty'; text: string }
  | { kind: 'group'; label: string; count: number }
  | {
    kind: 'layer';
    result: any;
    layerId: string;
    visible: boolean;
    name: string;
    meta: string;
    title: string;
    opacityPercent: number;
    details: CoverageLayerManagerDetail[];
  };

export type CoverageLayerManagerCallbacks = {
  fallbackLabel: (result: any) => string;
  setLayerLabel: (layerId: string, label: string) => string;
  applyLayerSettings: (result: any) => void;
  recomputeLayer: (result: any) => void | Promise<void>;
  deleteLayer: (layerId: string) => void;
  onRecomputeError: (err: unknown) => void;
};

export function buildCoverageLayerManagerRows(
  results: any[],
  fallbackLabel: (result: any) => string,
): CoverageLayerManagerRow[] {
  const layers = Array.isArray(results) ? results : [];
  if (layers.length === 0) return [{ kind: 'empty', text: EMPTY_LAYER_TEXT }];

  const rows: CoverageLayerManagerRow[] = [];
  for (const group of groupCoverageLayersByScenario(layers)) {
    rows.push({ kind: 'group', label: group.label, count: group.layers.length });
    for (const result of group.layers) {
      rows.push(_layerRow(result, fallbackLabel));
    }
  }
  return rows;
}

export function renderCoverageLayerManager(
  container: HTMLElement,
  results: any[],
  callbacks: CoverageLayerManagerCallbacks,
): void {
  container.textContent = '';
  const rows = buildCoverageLayerManagerRows(results, callbacks.fallbackLabel);
  for (const row of rows) {
    container.appendChild(_renderRow(row, callbacks));
  }
}

function _layerRow(
  result: any,
  fallbackLabel: (result: any) => string,
): CoverageLayerManagerRow {
  const layerId = String(result?.layerId ?? '');
  const rawOpacity = Number(result?.opacity);
  return {
    kind: 'layer',
    result,
    layerId,
    visible: result?.visible !== false,
    name: result?.label ?? fallbackLabel(result),
    meta: formatCoverageLayerMeta(result),
    title: formatCoverageLayerTitle(result),
    opacityPercent: Number.isFinite(rawOpacity) ? Math.round(rawOpacity * 100) : 65,
    details: coverageLayerDetailRows(result).map(([label, value]) => ({
      label,
      value,
      warning: label === 'Warnings',
    })),
  };
}

function _renderRow(
  row: CoverageLayerManagerRow,
  callbacks: CoverageLayerManagerCallbacks,
): HTMLElement {
  if (row.kind === 'empty') {
    const li = document.createElement('li');
    li.className = 'empty-msg';
    li.textContent = row.text;
    return li;
  }

  if (row.kind === 'group') {
    const li = document.createElement('li');
    li.className = 'coverage-layer-group';
    li.textContent = `${row.label} (${row.count})`;
    return li;
  }

  return _renderLayerRow(row, callbacks);
}

function _renderLayerRow(
  row: Extract<CoverageLayerManagerRow, { kind: 'layer' }>,
  callbacks: CoverageLayerManagerCallbacks,
): HTMLElement {
  const li = document.createElement('li');
  li.className = 'coverage-layer-item';
  li.dataset.layerId = row.layerId;

  const vis = document.createElement('input');
  vis.type = 'checkbox';
  vis.className = 'cov-layer-vis';
  vis.checked = row.visible;
  vis.title = 'Show / hide this layer';

  const label = document.createElement('input');
  label.type = 'text';
  label.className = 'cov-layer-name-input';
  label.value = row.name;
  label.maxLength = 120;
  label.title = 'Coverage layer name';
  label.addEventListener('change', () => {
    label.value = callbacks.setLayerLabel(row.layerId, label.value);
  });
  label.addEventListener('blur', () => {
    label.value = callbacks.setLayerLabel(row.layerId, label.value);
  });
  label.addEventListener('keydown', e => {
    if (e.key === 'Enter') label.blur();
    if (e.key === 'Escape') {
      label.value = row.name;
      label.blur();
    }
  });

  const meta = document.createElement('span');
  meta.className = 'cov-layer-meta';
  meta.textContent = row.meta;
  meta.title = row.title;

  const info = document.createElement('div');
  info.className = 'cov-layer-info';
  info.append(label, meta, _renderDetails(row.details));

  const opacity = document.createElement('input');
  opacity.type = 'range';
  opacity.className = 'cov-layer-opacity';
  opacity.min = '5';
  opacity.max = '100';
  opacity.step = '5';
  opacity.value = String(row.opacityPercent);
  opacity.title = 'Layer opacity';

  const useSettings = document.createElement('button');
  useSettings.type = 'button';
  useSettings.className = 'cov-layer-use';
  useSettings.textContent = 'Use';
  useSettings.title = 'Use this layer\'s settings';
  useSettings.addEventListener('click', () => callbacks.applyLayerSettings(row.result));

  const recompute = document.createElement('button');
  recompute.type = 'button';
  recompute.className = 'cov-layer-recompute';
  recompute.textContent = 'Run';
  recompute.title = 'Recompute this layer';
  recompute.addEventListener('click', () => {
    void Promise.resolve(callbacks.recomputeLayer(row.result)).catch(callbacks.onRecomputeError);
  });

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'cov-layer-del btn-icon';
  del.textContent = '\u2715';
  del.title = 'Delete this layer';
  del.addEventListener('click', () => {
    if (row.layerId) callbacks.deleteLayer(row.layerId);
  });

  li.append(vis, info, opacity, useSettings, recompute, del);
  return li;
}

function _renderDetails(detailsRows: CoverageLayerManagerDetail[]): HTMLElement {
  const details = document.createElement('details');
  details.className = 'cov-layer-details';

  const summary = document.createElement('summary');
  summary.textContent = 'Details';
  details.appendChild(summary);

  const dl = document.createElement('dl');
  for (const row of detailsRows) {
    const dt = document.createElement('dt');
    dt.textContent = row.label;
    const dd = document.createElement('dd');
    dd.textContent = row.value;
    if (row.warning) dd.className = 'cov-layer-warning';
    dl.append(dt, dd);
  }
  details.appendChild(dl);
  return details;
}
