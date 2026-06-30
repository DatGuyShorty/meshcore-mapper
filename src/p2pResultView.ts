export type P2PBudgetRow = {
  key: string;
  value: string;
  color: string | null;
};

export type P2PProfileReportPoint = {
  lat?: number;
  lng?: number;
  lon?: number;
} | null | undefined;

export type P2PProfileReportOptions = {
  pointA?: P2PProfileReportPoint;
  pointB?: P2PProfileReportPoint;
  generatedAt?: Date | string;
};

export function formatP2PNumber(value: number): string {
  return Number(value).toFixed(1);
}

export function buildP2PBudgetRows(result: any): P2PBudgetRow[] {
  const diffColor = result.diffractionLoss > 20 ? '#fc8181' : result.diffractionLoss > 6 ? '#facc15' : '';
  const vegColor = result.foliageLoss > 15 ? '#fc8181' : result.foliageLoss > 5 ? '#facc15' : '#4ade80';
  const bldColor = result.buildingLoss > 15 ? '#fc8181' : result.buildingLoss > 5 ? '#facc15' : '#4ade80';
  const rows: P2PBudgetRow[] = [
    ['Distance', `${(result.distM / 1000).toFixed(2)} km`, ''],
    ['Profile samples', `${result.sampleCount}`, ''],
    ['Diffraction model', `${result.geoResult.diffractionModel || 'knife-edge'}`, ''],
    ['Free-space loss', `${formatP2PNumber(result.pathLoss)} dB`, ''],
    ['Diffraction loss', `${formatP2PNumber(result.diffractionLoss)} dB`, diffColor],
  ].map(([key, value, color]) => ({ key, value, color }));
  if (result.foliageLoss > 0) rows.push({ key: 'Foliage loss', value: `${formatP2PNumber(result.foliageLoss)} dB`, color: vegColor });
  if (result.buildingLoss > 0) rows.push({ key: 'Building loss', value: `${formatP2PNumber(result.buildingLoss)} dB`, color: bldColor });
  if (Math.abs(result.shadowFadingLoss ?? 0) > 0.05) {
    rows.push({
      key: 'Shadow fading',
      value: `${formatP2PNumber(result.shadowFadingLoss)} dB`,
      color: result.shadowFadingLoss > 0 ? '#facc15' : '#4ade80',
    });
  }
  rows.push(
    { key: 'Total path loss', value: `${formatP2PNumber(result.totalPathLoss)} dB`, color: '' },
    { key: 'TX EIRP', value: `${formatP2PNumber(result.txEirp)} dBm`, color: '' },
    { key: 'TX pattern offset', value: `${formatP2PNumber(result.txPatternOffset ?? 0)} dB`, color: '' },
    { key: 'RX pattern offset', value: `${formatP2PNumber(result.rxPatternOffset ?? 0)} dB`, color: '' },
    { key: 'Received power', value: `${formatP2PNumber(result.rxPower)} dBm`, color: '' },
  );
  if (result.fadeMargin > 0) rows.push({ key: 'Required RX', value: `${formatP2PNumber(result.requiredRx)} dBm`, color: '' });
  rows.push({
    key: 'Link margin',
    value: `${formatP2PNumber(result.margin)} dB`,
    color: result.margin >= 10 ? '#4ade80' : result.margin >= 0 ? '#facc15' : '#fc8181',
  });
  if (result.monteCarlo?.enabled) {
    rows.push(
      { key: 'MC trials', value: `${result.monteCarlo.trials}`, color: '' },
      {
        key: 'MC outage probability',
        value: `${(result.monteCarlo.outageProbability * 100).toFixed(1)}%`,
        color: result.monteCarlo.outageProbability < 0.05 ? '#4ade80' : result.monteCarlo.outageProbability < 0.2 ? '#facc15' : '#fc8181',
      },
      {
        key: 'MC margin P05',
        value: `${formatP2PNumber(result.monteCarlo.marginP05)} dB`,
        color: result.monteCarlo.marginP05 >= 0 ? '#4ade80' : '#fc8181',
      },
      { key: 'MC margin P50', value: `${formatP2PNumber(result.monteCarlo.marginP50)} dB`, color: '' },
      { key: 'MC margin P95', value: `${formatP2PNumber(result.monteCarlo.marginP95)} dB`, color: '' },
    );
  }
  rows.push(
    { key: 'Geometric LoS', value: _losLabel(result), color: null },
    { key: 'Fresnel clearance', value: _fresnelLabel(result), color: null },
  );
  return rows;
}

export function renderP2PResultPanelHtml(result: any): string {
  const tbody = buildP2PBudgetRows(result).map(row => {
    const val = row.color === null
      ? row.value
      : `<span style="color:${_escHtml(row.color)}">${_escHtml(row.value)}</span>`;
    return `<tr><td class="p2p-key">${_escHtml(row.key)}</td><td class="p2p-val">${val}</td></tr>`;
  }).join('');
  const warningHtml = result.warnings?.length
    ? `<div class="status-line warning">${result.warnings.map(_escHtml).join('<br>')}</div>`
    : '';

  return `
    <div class="p2p-inner-tabbar">
      <button class="p2p-inner-tab active" data-target="p2p-tab-budget">Budget</button>
      <button class="p2p-inner-tab" data-target="p2p-tab-profile">Profile</button>
    </div>
    <div id="p2p-tab-budget" class="p2p-inner-panel">
      ${warningHtml}
      <table class="p2p-table"><tbody>${tbody}</tbody></table>
    </div>
    <div id="p2p-tab-profile" class="p2p-inner-panel hidden">
      <div class="p2p-profile-preview">${result.profileSvg}</div>
      <div class="p2p-profile-actions">
        <button id="btn-fullscreen-profile" class="btn-secondary" type="button">Fullscreen</button>
        <button id="btn-save-profile" class="btn-secondary" type="button">Save PNG</button>
      </div>
    </div>`;
}

export function p2pResultStatusMessage(result: any): string {
  return result.margin >= 0
    ? `Link OK (+${formatP2PNumber(result.margin)} dB margin)`
    : `Link FAILED (${formatP2PNumber(result.margin)} dB short)`;
}

export function profileSvgForFullscreen(profileSvg: unknown): string {
  return String(profileSvg).replace(/p2p-above-los/g, 'p2p-above-los-fullscreen');
}

export function renderP2PProfileReportHtml(result: any, options: P2PProfileReportOptions = {}): string {
  const settings = result?._settings ?? {};
  const now = formatProfileReportDate(options.generatedAt ?? new Date());
  const aLat = pointLat(options.pointA);
  const aLon = pointLon(options.pointA);
  const bLat = pointLat(options.pointB);
  const bLon = pointLon(options.pointB);
  const marginColor = result.margin >= 10 ? '#4ade80' : (result.margin >= 0 ? '#facc15' : '#f87171');
  const fresnelLabel = result?.fresnelResult?.fresnelClear ? 'Clear' : (result?.geoResult?.geometricLos ? 'Partial' : 'Blocked');
  const geoLabel = result?.geoResult?.geometricLos ? 'Clear' : 'Blocked';

  return `
    <div class="profile-report-card">
      <div class="profile-report-title">Terrain LoS Profile Report</div>
      <div class="profile-report-subtitle">Exported ${_escHtml(now)} UTC</div>
      <div class="profile-report-metrics">
        <div class="profile-report-metric"><span>LINK MARGIN</span><strong style="color:${marginColor}">${_escHtml(formatP2PNumber(result.margin))} dB</strong></div>
        <div class="profile-report-metric"><span>RX POWER</span><strong>${_escHtml(formatP2PNumber(result.rxPower))} dBm</strong></div>
        <div class="profile-report-metric"><span>DISTANCE</span><strong>${_escHtml((result.distM / 1000).toFixed(2))} km</strong></div>
        <div class="profile-report-metric"><span>FREQUENCY</span><strong>${_escHtml(formatP2PNumber(settings.freqMHz ?? 0))} MHz</strong></div>
        <div class="profile-report-metric"><span>SAMPLES</span><strong>${_escHtml(String(result.sampleCount))}</strong></div>
      </div>
      <div class="profile-report-lines">
        <div>A (TX): ${_escHtml(aLat.toFixed(6))}, ${_escHtml(aLon.toFixed(6))}  ->  B (RX): ${_escHtml(bLat.toFixed(6))}, ${_escHtml(bLon.toFixed(6))}</div>
        <div>Path loss ${_escHtml(formatP2PNumber(result.pathLoss))} dB | Diffraction ${_escHtml(formatP2PNumber(result.diffractionLoss))} dB | Foliage ${_escHtml(formatP2PNumber(result.foliageLoss))} dB | Buildings ${_escHtml(formatP2PNumber(result.buildingLoss))} dB</div>
        <div>TX ${_escHtml(formatP2PNumber(settings.txPower ?? 0))} dBm + ${_escHtml(formatP2PNumber(settings.txGain ?? 0))} dBi | RX gain ${_escHtml(formatP2PNumber(settings.rxGain ?? 0))} dBi | TX/RX heights ${_escHtml(formatP2PNumber(settings.txHeight ?? 0))} / ${_escHtml(formatP2PNumber(settings.rxHeight ?? 0))} m</div>
        <div>LoS geometric: ${_escHtml(geoLabel)} | Fresnel: ${_escHtml(fresnelLabel)} | Required RX: ${_escHtml(formatP2PNumber(result.requiredRx ?? 0))} dBm</div>
        ${result.monteCarlo?.enabled
          ? `<div>Monte Carlo ${_escHtml(String(result.monteCarlo.trials))} trials | Outage ${_escHtml((result.monteCarlo.outageProbability * 100).toFixed(1))}% | Margin P05/P50/P95 ${_escHtml(formatP2PNumber(result.monteCarlo.marginP05))} / ${_escHtml(formatP2PNumber(result.monteCarlo.marginP50))} / ${_escHtml(formatP2PNumber(result.monteCarlo.marginP95))} dB</div>`
          : ''}
      </div>
    </div>`;
}

function _losLabel(result: any): string {
  return result.geoResult.geometricLos
    ? '<span style="color:#4ade80">Clear</span>'
    : '<span style="color:#fc8181">Blocked</span>';
}

function _fresnelLabel(result: any): string {
  if (result.fresnelResult.fresnelClear) return '<span style="color:#4ade80">Clear</span>';
  return result.geoResult.geometricLos
    ? '<span style="color:#facc15">Partial</span>'
    : '<span style="color:#fc8181">Blocked</span>';
}

function formatProfileReportDate(value: Date | string): string {
  const iso = value instanceof Date ? value.toISOString() : String(value);
  return iso.replace('T', ' ').slice(0, 19);
}

function pointLat(point: P2PProfileReportPoint): number {
  const value = Number(point?.lat ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function pointLon(point: P2PProfileReportPoint): number {
  const value = Number(point?.lng ?? point?.lon ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function _escHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
