import { map, state } from './map.js';

export type MapViewportMetrics = {
  center: { lat: number; lng: number };
  centerLat: number;
  zoom: number;
};

export type CoverageOverlayTileArgs = {
  blobUrl: string;
  bounds: unknown;
  opacity: number;
  repId: string | number;
  layerId?: string | null;
  visible?: boolean;
};

type CoverageTileLayer = {
  _repeaterId?: string | number;
  _layerId?: string | null;
  _baseOpacity?: number;
  _visible?: boolean;
  _blobUrl?: string;
  setOpacity(opacity: number): void;
};

export function getMapViewportMetrics(): MapViewportMetrics {
  const center = map.getCenter();
  return {
    center,
    centerLat: center.lat,
    zoom: map.getZoom(),
  };
}

export function onMapViewportChanged(handler: () => void): () => void {
  map.on('zoomend moveend', handler);
  return () => map.off('zoomend moveend', handler);
}

export function addCoverageOverlayTile({
  blobUrl,
  bounds,
  opacity,
  repId,
  layerId = null,
  visible = true,
}: CoverageOverlayTileArgs): CoverageTileLayer {
  const overlay = L.imageOverlay(
    blobUrl,
    bounds,
    { opacity: visible ? opacity : 0, interactive: false, pane: 'coveragePane' },
  ).addTo(map) as CoverageTileLayer;
  overlay._repeaterId = repId;
  overlay._layerId = layerId;
  overlay._baseOpacity = opacity;
  overlay._visible = visible;
  overlay._blobUrl = blobUrl;
  (state.coverageLayers as CoverageTileLayer[]).push(overlay);
  return overlay;
}

export function setCoverageLayerOpacity(opacity: number): void {
  (state.coverageLayers as CoverageTileLayer[]).forEach(layer => layer.setOpacity(opacity));
}

export function setCoverageTileOpacityByLayer(layerId: string, opacity: number): void {
  (state.coverageLayers as CoverageTileLayer[]).forEach(layer => {
    if (layer._layerId !== layerId) return;
    layer._baseOpacity = opacity;
    if (layer._visible) layer.setOpacity(opacity);
  });
}

export function setCoverageTileVisibilityByLayer(layerId: string, visible: boolean): void {
  (state.coverageLayers as CoverageTileLayer[]).forEach(layer => {
    if (layer._layerId !== layerId) return;
    layer._visible = visible;
    layer.setOpacity(visible ? layer._baseOpacity ?? 0 : 0);
  });
}

export function removeCoverageTilesByLayer(layerId: string): void {
  const keep: CoverageTileLayer[] = [];
  (state.coverageLayers as CoverageTileLayer[]).forEach(layer => {
    if (layer._layerId === layerId) {
      if (layer._blobUrl) URL.revokeObjectURL(layer._blobUrl);
      map.removeLayer(layer);
    } else {
      keep.push(layer);
    }
  });
  state.coverageLayers = keep;
}
