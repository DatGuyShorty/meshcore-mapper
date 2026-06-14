/**
 * map.ts — Leaflet map singleton and shared application state.
 * Import `map`, `state`, and `clearCoverageLayers` from here in any module that needs them.
 * L (Leaflet) is loaded as a global script before this module runs.
 */

import { createCoverageStore, type CoverageOverlayLayer } from './coverageStore.js';
import { createRepeaterStore } from './repeaterStore.js';

type AppState = {
  repeaters: any[];
  coverageLayers: CoverageOverlayLayer[];
  coverageResults: any[];
  p2pLinks: any[];
  pathLinks: any[];
  optimizerResults: any[];
  foliageLayers: any[];
  buildingLayers: any[];
  barrierLayers: any[];
  nextId: number;
};

type BaseLayerSpec = {
  url: string;
  options: Record<string, unknown>;
};

type TileLayer = {
  addTo(target: unknown): void;
};

type BaseLayerInfo = BaseLayerSpec & {
  name: string;
};

export const map = L.map('map', {
  center: [48.28625, 18.50540], // Tlmace Slovakia, a nice hilly area to test with
  zoom: 12,
  zoomControl: true,
});

// Dedicated pane for the coverage heatmap so it always draws ABOVE the
// foliage/building canvas (default overlayPane, z-index 400) yet stays below the
// node markers (markerPane, 600). A pane-level blur composites all coverage
// tiles together before filtering, smoothing the upscaled grid without
// introducing seams between adjacent tiles.
const _coveragePane = map.createPane('coveragePane');
_coveragePane.style.zIndex = '450';
_coveragePane.style.pointerEvents = 'none';
_coveragePane.style.filter = 'blur(2px)';
_coveragePane.style.willChange = 'filter';

let _activeBaseLayerName = 'Streets (OSM)';

// Track the URL template + options for each layer ourselves so callers don't
// depend on Leaflet's private `_url` field — that's undocumented API and has
// renamed between major Leaflet versions.
const baseLayerSpecs: Record<string, BaseLayerSpec> = {
  'Streets (OSM)': {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    },
  },
  'Satellite': {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: {
      attribution: 'Tiles © Esri — Source: Esri, Maxar, GeoEye, Earthstar Geographics',
      maxZoom: 19,
    },
  },
  'Terrain': {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    options: {
      attribution: '© <a href="https://opentopomap.org/">OpenTopoMap</a> (CC-BY-SA)',
      maxZoom: 17,
    },
  },
};

const baseLayers = Object.fromEntries(
  Object.entries(baseLayerSpecs).map(([name, spec]) => [name, L.tileLayer(spec.url, spec.options)])
) as Record<string, TileLayer>;

baseLayers['Streets (OSM)'].addTo(map);
L.control.layers(baseLayers, {}, { position: 'topright' }).addTo(map);
map.on('baselayerchange', (e: { name?: string }) => { _activeBaseLayerName = e.name || _activeBaseLayerName; });

export function getActiveBaseLayerInfo(): BaseLayerInfo {
  const spec = baseLayerSpecs[_activeBaseLayerName] || baseLayerSpecs['Streets (OSM)'];
  return {
    name: _activeBaseLayerName,
    url: spec.url,
    options: { ...spec.options },
  };
}

// U7: on first launch, centre the map on the user's real location.
// Subsequent launches restore the position saved in localStorage.
(function _initMapCenter() {
  const GEO_KEY = 'meshcoreMapper_mapCenter';
  const persistCenter = () => {
    const c = map.getCenter();
    localStorage.setItem(GEO_KEY, JSON.stringify({ lat: c.lat, lon: c.lng, zoom: map.getZoom() }));
  };
  map.on('moveend', persistCenter);

  const saved = localStorage.getItem(GEO_KEY);
  if (saved) {
    try {
      const { lat, lon, zoom } = JSON.parse(saved);
      map.setView([lat, lon], zoom);
      return;
    } catch {}
  }
  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(pos => {
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      map.setView([lat, lon], 10);
      localStorage.setItem(GEO_KEY, JSON.stringify({ lat, lon, zoom: 10 }));
    }, () => {}); // silently ignore if denied / unavailable
  }
})();

map.on('mousemove', (e: { latlng: { lat: number; lng: number } }) => {
  const el = document.getElementById('cursor-coords');
  if (el) el.textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
});

const repeaterStore = createRepeaterStore();
const coverageStore = createCoverageStore();

export const state: AppState = {
  get repeaters() { return repeaterStore.getRepeaters(); },       // { id, name, lat, lon, height, power, freq, marker, color }
  set repeaters(value) { repeaterStore.setRepeaters(value); },
  get coverageLayers() { return coverageStore.getCoverageLayers(); },  // Leaflet ImageOverlay per repeater
  set coverageLayers(value) { coverageStore.setCoverageLayers(value); },
  get coverageResults() { return coverageStore.getCoverageResults(); }, // point-inspection metadata per computed repeater coverage
  set coverageResults(value) { coverageStore.setCoverageResults(value); },
  p2pLinks: [],        // active ad-hoc point-to-point link overlays
  pathLinks: [],       // best relay path hop overlays
  optimizerResults: [], // latest suggested nodes from optimizer
  foliageLayers: [],   // Leaflet Polygon outlines for forest/wood areas
  buildingLayers: [],  // Leaflet Polygon outlines for building footprints
  barrierLayers: [],   // Leaflet Polygon outlines for walls/barriers/towers
  get nextId() { return repeaterStore.getNextId(); },
  set nextId(value) { repeaterStore.setNextId(value); },
};

/** Remove rendered coverage overlay tiles while keeping computed coverage metadata. */
export function clearCoverageOverlayTiles(): void {
  state.coverageLayers.forEach(l => {
    if (l._blobUrl) URL.revokeObjectURL(l._blobUrl); // B7: free blob memory
    map.removeLayer(l);
  });
  state.coverageLayers = [];
}

/** Remove all coverage overlays from the map and reset the state array. */
export function clearCoverageLayers(): void {
  clearCoverageOverlayTiles();
  state.coverageResults = [];
  _dispatchDocumentEvent('coverage:changed');
}

/** Remove all foliage polygon outlines from the map. */
export function clearFoliageLayers(): void {
  state.foliageLayers.forEach(l => map.removeLayer(l));
  state.foliageLayers = [];
}

/** Remove all building footprint polygons from the map. */
export function clearBuildingLayers(): void {
  state.buildingLayers.forEach(l => map.removeLayer(l));
  state.buildingLayers = [];
}

/** Remove all barrier/wall polygons from the map. */
export function clearBarrierLayers(): void {
  state.barrierLayers.forEach(l => map.removeLayer(l));
  state.barrierLayers = [];
}

function _dispatchDocumentEvent(name: string): void {
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent(name));
}
