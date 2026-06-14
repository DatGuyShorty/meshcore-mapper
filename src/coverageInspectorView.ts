import type { CoverageInspectRow } from './coveragePoint.js';

export type CoverageInspectorLatLng = {
  lat: number;
  lng: number;
};

export type CoverageInspectorInput = {
  latlng: CoverageInspectorLatLng;
  rows: CoverageInspectRow[];
  allLayerCount: number;
  visibleLayerCount: number;
};

export function formatCoverageDb(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(1)} dB`;
}

export function formatCoverageDbm(v: number): string {
  return `${v.toFixed(1)} dBm`;
}

export function formatCoverageDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

export function coverageRowContent(row: CoverageInspectRow): string {
  const ok = row.margin >= 0;
  const los = row.los
    ? (row.los.geometricLos ? 'LoS clear' : 'LoS blocked')
    : 'LoS not evaluated';
  const fresnel = row.los && typeof row.los.fresnelClear === 'boolean'
    ? (row.los.fresnelClear ? 'Fresnel clear' : 'Fresnel blocked')
    : '';
  const status = ok ? 'Covered' : 'Below threshold';
  const source = row.rxPowerSource === 'grid' ? 'Heatmap sample' : 'Point model';
  const layerRef = Number.isFinite(row.layerOrdinal) && Number.isFinite(row.layerTotal)
    ? `Layer ${row.layerOrdinal}/${row.layerTotal}`
    : 'Layer';
  return `<div class="map-context-coverage-row ${ok ? 'ok' : 'weak'}">
    <div class="map-context-row-head">
      <div>
        <strong>${_escHtml(row.repName)}</strong>
        <span>${formatCoverageDistance(row.distM)} away</span>
      </div>
      <span class="map-context-status">${_escHtml(status)}</span>
    </div>
    <div class="map-context-layer-meta">
      <span>${_escHtml(layerRef)}</span>
      <span>${_escHtml(row.layerLabel)}</span>
      <span>${_escHtml(source)}</span>
    </div>
    <div class="map-context-metrics">
      <span>RSSI ${formatCoverageDbm(row.rxPower)}</span>
      <span>SNR ${formatCoverageDb(row.snrDb)}</span>
      <span>Margin ${formatCoverageDb(row.margin)}</span>
      <span>${_escHtml(los)}</span>
      ${fresnel ? `<span>${_escHtml(fresnel)}</span>` : ''}
    </div>
    <div class="map-context-reason">${_escHtml(row.reason ?? (ok ? 'Covered.' : 'Below threshold.'))}</div>
    ${_lossBreakdown(row)}
  </div>`;
}

export function coveragePointPopupContent(input: CoverageInspectorInput): string {
  const { coords, coverage } = _mapPointCoverage(input);
  return `<div class="map-context-card">
    <div class="map-context-title">Map Point</div>
    <div class="map-context-coords">${_escHtml(coords)}</div>
    ${coverage}
  </div>`;
}

export function coveragePointInspectorContent(input: CoverageInspectorInput): string {
  const { coords, coverage } = _mapPointCoverage(input);
  return `<div class="inspector-map-card">
    <div class="map-context-title">Map Point</div>
    <div class="map-context-coords">${_escHtml(coords)}</div>
    ${coverage}
    <div class="inspector-actions">
      <button type="button" class="btn-secondary btn-xs" data-inspector-action="add-node-here">Add Node Here</button>
      <button type="button" class="btn-secondary btn-xs" data-inspector-action="point-view-3d">View 3D</button>
      <button type="button" class="btn-secondary btn-xs" data-inspector-action="clear-selection">Clear</button>
    </div>
  </div>`;
}

export function coverageEmptyMessage(allLayerCount: number, visibleLayerCount: number): string {
  if (allLayerCount < 1) return 'No coverage has been computed yet.';
  if (visibleLayerCount < 1) return 'All coverage layers are hidden.';
  return 'No visible coverage layer reaches this point.';
}

function _mapPointCoverage(input: CoverageInspectorInput): { coords: string; coverage: string } {
  const { latlng, rows, allLayerCount, visibleLayerCount } = input;
  const coords = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
  const coverage = rows.length
    ? `<div class="map-context-section">
        <div class="map-context-heading">Visible Coverage At Point</div>
        ${rows.map(coverageRowContent).join('')}
      </div>`
    : `<div class="map-context-empty">${coverageEmptyMessage(allLayerCount, visibleLayerCount)}</div>`;
  return { coords, coverage };
}

function _lossRows(row: CoverageInspectRow): Array<[string, number]> {
  const losses = row.losses;
  const rows: Array<[string, number]> = [];
  const add = (label: string, value: unknown): void => {
    const n = Number(value);
    if (Number.isFinite(n) && Math.abs(n) >= 0.05) rows.push([label, n]);
  };
  add('FSPL', losses?.pathLossDb);
  add('Diffraction', losses?.diffractionLossDb);
  add('Foliage', losses?.foliageLossDb);
  add('Buildings', losses?.buildingLossDb);
  add('Reflection', losses?.reflectionGainDb);
  return rows;
}

function _lossBreakdown(row: CoverageInspectRow): string {
  const rows = _lossRows(row);
  if (!rows.length) return '';
  return `<div class="map-context-losses">
    ${rows.map(([label, value]) => {
      const text = label === 'Reflection' ? formatCoverageDb(value) : `${value.toFixed(1)} dB`;
      return `<span><b>${_escHtml(label)}</b>${_escHtml(text)}</span>`;
    }).join('')}
  </div>`;
}

function _escHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
