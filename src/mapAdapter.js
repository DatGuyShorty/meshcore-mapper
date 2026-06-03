// @ts-check
import { map, state } from './map.js';

export function getMapViewportMetrics() {
  const center = map.getCenter();
  return {
    center,
    centerLat: center.lat,
    zoom: map.getZoom(),
  };
}

/**
 * @param {() => void} handler
 * @returns {() => void} unsubscribe
 */
export function onMapViewportChanged(handler) {
  map.on('zoomend moveend', handler);
  return () => map.off('zoomend moveend', handler);
}

/**
 * @param {{ blobUrl: string, bounds: any, opacity: number, repId: string | number }} args
 */
export function addCoverageOverlayTile({ blobUrl, bounds, opacity, repId }) {
  const overlay = L.imageOverlay(
    blobUrl,
    bounds,
    { opacity, interactive: false, pane: 'coveragePane' }
  ).addTo(map);
  overlay._repeaterId = repId;
  overlay._blobUrl = blobUrl;
  /** @type {any[]} */ (state.coverageLayers).push(overlay);
  return overlay;
}

/** @param {number} opacity */
export function setCoverageLayerOpacity(opacity) {
  /** @type {any[]} */ (state.coverageLayers).forEach((/** @type {any} */ layer) => layer.setOpacity(opacity));
}
