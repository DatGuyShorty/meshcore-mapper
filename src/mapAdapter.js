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
 * @param {{ blobUrl: string, bounds: any, opacity: number, repId: string | number, layerId?: string | null, visible?: boolean }} args
 */
export function addCoverageOverlayTile({ blobUrl, bounds, opacity, repId, layerId = null, visible = true }) {
  const overlay = L.imageOverlay(
    blobUrl,
    bounds,
    { opacity: visible ? opacity : 0, interactive: false, pane: 'coveragePane' }
  ).addTo(map);
  overlay._repeaterId = repId;
  overlay._layerId = layerId;
  overlay._baseOpacity = opacity;
  overlay._visible = visible;
  overlay._blobUrl = blobUrl;
  /** @type {any[]} */ (state.coverageLayers).push(overlay);
  return overlay;
}

/** @param {number} opacity */
export function setCoverageLayerOpacity(opacity) {
  /** @type {any[]} */ (state.coverageLayers).forEach((/** @type {any} */ layer) => layer.setOpacity(opacity));
}

/**
 * Set opacity for the tiles belonging to a single coverage layer.
 * @param {string} layerId
 * @param {number} opacity
 */
export function setCoverageTileOpacityByLayer(layerId, opacity) {
  /** @type {any[]} */ (state.coverageLayers).forEach((/** @type {any} */ layer) => {
    if (layer._layerId !== layerId) return;
    layer._baseOpacity = opacity;
    if (layer._visible) layer.setOpacity(opacity);
  });
}

/**
 * Show or hide the tiles belonging to a single coverage layer.
 * @param {string} layerId
 * @param {boolean} visible
 */
export function setCoverageTileVisibilityByLayer(layerId, visible) {
  /** @type {any[]} */ (state.coverageLayers).forEach((/** @type {any} */ layer) => {
    if (layer._layerId !== layerId) return;
    layer._visible = visible;
    layer.setOpacity(visible ? layer._baseOpacity : 0);
  });
}

/**
 * Remove the tiles belonging to a single coverage layer, freeing their blobs.
 * @param {string} layerId
 */
export function removeCoverageTilesByLayer(layerId) {
  /** @type {any[]} */
  const keep = [];
  /** @type {any[]} */ (state.coverageLayers).forEach((/** @type {any} */ layer) => {
    if (layer._layerId === layerId) {
      if (layer._blobUrl) URL.revokeObjectURL(layer._blobUrl);
      map.removeLayer(layer);
    } else {
      keep.push(layer);
    }
  });
  state.coverageLayers = keep;
}
