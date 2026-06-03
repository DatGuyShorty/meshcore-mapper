// @ts-check
/**
 * map.js — Leaflet map singleton and shared application state.
 * Import `map`, `state`, and `clearCoverageLayers` from here in any module that needs them.
 * L (Leaflet) is loaded as a global script before this module runs.
 *
 * @typedef {Object} AppState
 * @property {any[]} repeaters
 * @property {any[]} coverageLayers
 * @property {any[]} coverageResults
 * @property {any[]} p2pLinks
 * @property {any[]} pathLinks
 * @property {any[]} foliageLayers
 * @property {any[]} buildingLayers
 * @property {any[]} barrierLayers
 * @property {number} nextId
 */

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

/**
 * @typedef {{ url: string, options: Record<string, any> }} BaseLayerSpec
 * @type {Record<string, BaseLayerSpec>}
 */

// Track the URL template + options for each layer ourselves so callers don't
// depend on Leaflet's private `_url` field — that's undocumented API and has
// renamed between major Leaflet versions.
const baseLayerSpecs = {
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

/** @type {Record<string, any>} */
const baseLayers = Object.fromEntries(
  Object.entries(baseLayerSpecs).map(([name, spec]) => [name, L.tileLayer(spec.url, spec.options)])
);

baseLayers['Streets (OSM)'].addTo(map);
L.control.layers(baseLayers, {}, { position: 'topright' }).addTo(map);
map.on('baselayerchange', (/** @type {any} */ e) => { _activeBaseLayerName = e.name || _activeBaseLayerName; });

export function getActiveBaseLayerInfo() {
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

map.on('mousemove', (/** @type {any} */ e) => {
  const el = document.getElementById('cursor-coords');
  if (el) el.textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
});

/** @type {AppState} */
export const state = {
  repeaters: [],       // { id, name, lat, lon, height, power, freq, marker, color }
  coverageLayers: [],  // Leaflet ImageOverlay per repeater
  coverageResults: [], // point-inspection metadata per computed repeater coverage
  p2pLinks: [],        // active ad-hoc point-to-point link overlays
  pathLinks: [],       // best relay path hop overlays
  foliageLayers: [],   // Leaflet Polygon outlines for forest/wood areas
  buildingLayers: [],  // Leaflet Polygon outlines for building footprints
  barrierLayers: [],   // Leaflet Polygon outlines for walls/barriers/towers
  nextId: 1,
};

/** Remove rendered coverage overlay tiles while keeping computed coverage metadata. */
export function clearCoverageOverlayTiles() {
  state.coverageLayers.forEach((/** @type {any} */ l) => {
    if (l._blobUrl) URL.revokeObjectURL(l._blobUrl); // B7: free blob memory
    map.removeLayer(l);
  });
  state.coverageLayers = [];
}

/** Remove all coverage overlays from the map and reset the state array. */
export function clearCoverageLayers() {
  clearCoverageOverlayTiles();
  state.coverageResults = [];
  _dispatchDocumentEvent('coverage:changed');
}

/** Remove all foliage polygon outlines from the map. */
export function clearFoliageLayers() {
  state.foliageLayers.forEach((/** @type {any} */ l) => map.removeLayer(l));
  state.foliageLayers = [];
}

/** Remove all building footprint polygons from the map. */
export function clearBuildingLayers() {
  state.buildingLayers.forEach((/** @type {any} */ l) => map.removeLayer(l));
  state.buildingLayers = [];
}

/** Remove all barrier/wall polygons from the map. */
export function clearBarrierLayers() {
  state.barrierLayers.forEach((/** @type {any} */ l) => map.removeLayer(l));
  state.barrierLayers = [];
}

/** @param {string} name */
function _dispatchDocumentEvent(name) {
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent(name));
}
