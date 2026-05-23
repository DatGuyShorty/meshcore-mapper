/**
 * map.js — Leaflet map singleton and shared application state.
 * Import `map`, `state`, and `clearCoverageLayers` from here in any module that needs them.
 * L (Leaflet) is loaded as a global script before this module runs.
 */

export const map = L.map('map', {
  center: [48.28625, 18.50540], // Tlmace Slovakia, a nice hilly area to test with
  zoom: 12, 
  zoomControl: true,
});

const baseLayers = {
  'Streets (OSM)': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }),
  'Satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri — Source: Esri, Maxar, GeoEye, Earthstar Geographics',
    maxZoom: 19,
  }),
  'Terrain': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://opentopomap.org/">OpenTopoMap</a> (CC-BY-SA)',
    maxZoom: 17,
  }),
};

baseLayers['Streets (OSM)'].addTo(map);
L.control.layers(baseLayers, {}, { position: 'topright' }).addTo(map);

map.on('mousemove', (e) => {
  document.getElementById('cursor-coords').textContent =
    `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
});

export const state = {
  repeaters: [],       // { id, name, lat, lon, height, power, freq, marker, color }
  coverageLayers: [],  // Leaflet ImageOverlay per repeater
  foliageLayers: [],   // Leaflet Polygon outlines for forest/wood areas
  nextId: 1,
};

/** Remove all coverage overlays from the map and reset the state array. */
export function clearCoverageLayers() {
  state.coverageLayers.forEach(l => map.removeLayer(l));
  state.coverageLayers = [];
}

/** Remove all foliage polygon outlines from the map. */
export function clearFoliageLayers() {
  state.foliageLayers.forEach(l => map.removeLayer(l));
  state.foliageLayers = [];
}
