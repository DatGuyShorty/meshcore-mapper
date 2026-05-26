import { map, state } from './map.js';
import { inspectCoverageAtPoint } from './coveragePoint.js';
import { escHtml } from './ui.js';

export function _fmtDb(v) {
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(1)} dB`;
}

export function _fmtDbm(v) {
  return `${v.toFixed(1)} dBm`;
}

export function _fmtDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

export function _coverageRow(row) {
  const ok = row.margin >= 0;
  const los = row.los
    ? (row.los.geometricLos ? 'LoS clear' : 'LoS blocked')
    : 'LoS not evaluated';
  return `<div class="map-context-coverage-row ${ok ? 'ok' : 'weak'}">
    <div>
      <strong>${escHtml(row.repName)}</strong>
      <span>${_fmtDistance(row.distM)} away</span>
    </div>
    <div class="map-context-metrics">
      <span>RSSI ${_fmtDbm(row.rxPower)}</span>
      <span>SNR ${_fmtDb(row.snrDb)}</span>
      <span>Margin ${_fmtDb(row.margin)}</span>
      <span>${escHtml(los)}</span>
    </div>
  </div>`;
}

export function _popupContent(latlng) {
  const rows = inspectCoverageAtPoint(latlng, state.coverageResults);
  const hasCoverage = state.coverageResults.length > 0;
  const coords = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
  const coverage = rows.length
    ? `<div class="map-context-section">
        <div class="map-context-heading">Coverage At Point</div>
        ${rows.map(_coverageRow).join('')}
      </div>`
    : `<div class="map-context-empty">${hasCoverage
        ? 'No computed coverage reaches this point.'
        : 'No coverage has been computed yet.'}</div>`;

  return `<div class="map-context-card">
    <div class="map-context-title">Map Point</div>
    <div class="map-context-coords">${escHtml(coords)}</div>
    ${coverage}
  </div>`;
}

export function _shouldIgnoreMapClick(event) {
  if (event.originalEvent?._meshcoreHandled) return true;
  return map.getContainer().style.cursor === 'crosshair';
}

export function init() {
  map.on('click', event => {
    if (_shouldIgnoreMapClick(event)) return;
    L.popup({
      className: 'map-context-popup',
      maxWidth: 330,
      autoPanPadding: [24, 24],
    })
      .setLatLng(event.latlng)
      .setContent(_popupContent(event.latlng))
      .openOn(map);
  });
}
