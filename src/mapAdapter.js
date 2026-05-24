import { map, state } from './map.js';

export function getMapViewportMetrics() {
  const center = map.getCenter();
  return {
    center,
    centerLat: center.lat,
    zoom: map.getZoom(),
  };
}

export function onMapViewportChanged(handler) {
  map.on('zoomend moveend', handler);
  return () => map.off('zoomend moveend', handler);
}

export function addCoverageOverlayTile({ blobUrl, bounds, opacity, repId }) {
  const overlay = L.imageOverlay(
    blobUrl,
    bounds,
    { opacity, interactive: false }
  ).addTo(map);
  overlay._repeaterId = repId;
  overlay._blobUrl = blobUrl;
  state.coverageLayers.push(overlay);
  return overlay;
}

export function setCoverageLayerOpacity(opacity) {
  state.coverageLayers.forEach(layer => layer.setOpacity(opacity));
}
