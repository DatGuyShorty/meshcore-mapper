/**
 * map3d.js - Three.js terrain view for the current 2D map viewport.
 * Reuses app elevation, obstruction, and node state instead of maintaining a
 * separate map model.
 */
import * as THREE from 'three';
import { OrbitControls } from '../node_modules/three/examples/jsm/controls/OrbitControls.js';
import { map, state } from './map.js';
import { fetchElevationsFromTiles } from './elevation.js';
import { fetchBuildings } from './buildings.js';
import { fetchFoliage } from './foliage.js';
import { setButtonBusy, setInlineStatus, setStatus } from './ui.js';
import {
  boundsFromLeaflet,
  buildTerrainGridPoints,
  buildTerrainMeshArrays,
  elevationStats,
  projectLatLonToMeters,
  sampleTerrainElevation,
  terrainMetrics,
} from './terrain3dModel.js';

let _active = false;
let _scene = null;
let _camera = null;
let _renderer = null;
let _controls = null;
let _root = null;
let _terrainMesh = null;
let _terrainState = null;
let _resizeObserver = null;
let _animationId = null;
let _abortController = null;
let _refreshTimer = null;
let _raycaster = null;
let _pointer = null;
let _lastValidBounds = null;

const MAX_BUILDING_MESHES = 900;
const MAX_FOLIAGE_MESHES = 500;

export function init() {
  document.getElementById('btn-view-2d')?.addEventListener('click', () => set3dMode(false));
  document.getElementById('btn-view-3d')?.addEventListener('click', () => set3dMode(true));
  document.getElementById('btn-refresh-3d')?.addEventListener('click', () => refresh3d({ force: true }));
  document.getElementById('btn-map3d-refresh')?.addEventListener('click', () => refresh3d({ force: true }));
  document.getElementById('btn-map3d-reset')?.addEventListener('click', _resetCamera);
  document.getElementById('btn-map3d-fullscreen')?.addEventListener('click', _toggleFullscreen);

  ['terrain3d-vertical-scale', 'terrain3d-grid-res', 'layer-buildings', 'layer-foliage'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', _scheduleRefresh);
    document.getElementById(id)?.addEventListener('input', _scheduleRefresh);
  });

  map.on('moveend', () => {
    if (_active && document.getElementById('layer-auto-refresh')?.checked) _scheduleRefresh();
  });
}

export function set3dMode(enabled) {
  _active = Boolean(enabled);
  
  // Capture map state BEFORE layout changes
  if (_active) {
    try {
      _lastValidBounds = boundsFromLeaflet(map.getBounds());
      console.debug('[3d] captured bounds:', _lastValidBounds);
    } catch (e) {
      console.warn('[3d] failed to capture map state:', e);
    }
  }
  
  const mapContainer = document.getElementById('map-container');
  const panel = document.getElementById('map3d');
  const btn2d = document.getElementById('btn-view-2d');
  const btn3d = document.getElementById('btn-view-3d');

  mapContainer?.classList.toggle('map3d-active', _active);
  panel?.classList.toggle('hidden', !_active);
  btn2d?.classList.toggle('active', !_active);
  btn3d?.classList.toggle('active', _active);
  btn2d?.setAttribute('aria-pressed', String(!_active));
  btn3d?.setAttribute('aria-pressed', String(_active));

  if (_active) {
    _ensureScene();
    _resize();
    _renderPreview();
    refresh3d({ force: true });
    setStatus('3D terrain view active.');
  } else {
    _abortController?.abort();
    clearTimeout(_refreshTimer);
    _lastValidBounds = null;
    map.invalidateSize();
    setStatus('2D map view active.');
  }
}

export async function refresh3d({ force = false } = {}) {
  if (!_active && !force) return;
  _ensureScene();
  _abortController?.abort();
  _abortController = new AbortController();
  const signal = _abortController.signal;
  setButtonBusy('btn-refresh-3d', true, 'Loading...');
  setButtonBusy('btn-map3d-refresh', true, 'Loading...');
  _set3dStatus('Loading 3D terrain...');

  try {
    const bounds = _getViewportBounds();
    if (!bounds) {
      _set3dStatus('3D view: Unable to determine map bounds', 'error');
      return;
    }
    const res = _gridRes();
    const points = buildTerrainGridPoints(bounds, res);
    let elevations = null;
    try {
      elevations = await fetchElevationsFromTiles(points, null, {
        signal,
        demTileConcurrency: 6,
        targetResolutionM: _targetResolutionM(bounds, res),
        onProgress: ({ completed, total }) => {
          if (total) _set3dStatus(`Loading terrain tiles ${completed}/${total}...`);
        },
      });
    } catch (err) {
      if (err?.cancelled || err?.name === 'AbortError') throw err;
      console.warn('[3d] terrain fetch failed, using preview terrain:', err);
      elevations = _syntheticElevations(bounds, res);
      _set3dStatus('Terrain source unavailable; showing preview terrain.', 'warning');
    }

    const terrainState = {
      bounds,
      elevations: Float32Array.from(elevations),
      res,
      verticalScale: _verticalScale(),
    };

    const stats = await _rebuildScene(terrainState, signal);
    _terrainState = terrainState;
    _set3dStatus(
      `3D terrain ${res}x${res}; ${stats.buildings} buildings, ${stats.foliage} vegetation areas, ${stats.nodes} nodes.`,
      'success'
    );
  } catch (err) {
    if (err?.cancelled || err?.name === 'AbortError') return;
    console.warn('[3d] refresh failed:', err);
    _set3dStatus(`3D view failed: ${err.message}`, 'error');
  } finally {
    setButtonBusy('btn-refresh-3d', false);
    setButtonBusy('btn-map3d-refresh', false);
  }
}

function _ensureScene() {
  if (_renderer) return;
  const host = document.getElementById('map3d');
  const canvas = document.getElementById('map3d-canvas');
  _scene = new THREE.Scene();
  _scene.background = new THREE.Color(0x0b1014);
  _scene.fog = new THREE.Fog(0x0b1014, 1200, 18000);
  _camera = new THREE.PerspectiveCamera(48, 1, 1, 120000);
  _renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  _renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  _renderer.outputColorSpace = THREE.SRGBColorSpace;
  _controls = new OrbitControls(_camera, canvas);
  _controls.enableDamping = true;
  _controls.dampingFactor = 0.08;
  _controls.screenSpacePanning = true;
  _controls.maxPolarAngle = Math.PI * 0.49;
  _controls.minDistance = 80;

  _raycaster = new THREE.Raycaster();
  _pointer = new THREE.Vector2();
  canvas.addEventListener('pointermove', _onPointerMove);

  _scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x172016, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-3000, 5000, 2400);
  _scene.add(sun);

  _root = new THREE.Group();
  _scene.add(_root);
  _resizeObserver = new ResizeObserver(_resize);
  _resizeObserver.observe(host);
  _startLoop();
}

function _renderPreview() {
  if (_terrainMesh) return;
  const bounds = _getViewportBounds();
  if (!bounds) return;
  const res = Math.min(48, _gridRes());
  const terrainState = {
    bounds,
    elevations: _syntheticElevations(bounds, res),
    res,
    verticalScale: _verticalScale(),
  };
  _rebuildTerrainOnly(terrainState);
  _terrainState = terrainState;
  document.getElementById('map3d')?.setAttribute('data-ready', 'preview');
  _set3dStatus('Preparing 3D terrain...');
}

async function _rebuildScene(terrainState, signal) {
  _clearRoot();
  const { meshArrays, terrainMesh } = _addTerrain(terrainState);
  _terrainMesh = terrainMesh;
  const stats = { buildings: 0, foliage: 0, nodes: 0 };
  await _addObstructions(terrainState, meshArrays, stats, signal);
  stats.nodes = _addNodes(terrainState, meshArrays);
  _resetCamera(meshArrays, terrainState.verticalScale);
  return stats;
}

function _rebuildTerrainOnly(terrainState) {
  _clearRoot();
  const { meshArrays, terrainMesh } = _addTerrain(terrainState);
  _terrainMesh = terrainMesh;
  _resetCamera(meshArrays, terrainState.verticalScale);
}

function _addTerrain(terrainState) {
  const meshArrays = buildTerrainMeshArrays(terrainState);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(meshArrays.positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(meshArrays.colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(meshArrays.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(meshArrays.indices, 1));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.88,
    metalness: 0.02,
    side: THREE.DoubleSide,
    map: _loadSatelliteTexture(terrainState.bounds),
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'terrain';
  _root.add(mesh);
  document.getElementById('map3d')?.setAttribute('data-ready', 'terrain');

  const grid = new THREE.GridHelper(
    Math.max(meshArrays.widthM, meshArrays.depthM),
    12,
    0x40616d,
    0x263a40
  );
  grid.position.y = -2;
  grid.material.opacity = 0.25;
  grid.material.transparent = true;
  _root.add(grid);

  return { meshArrays, terrainMesh: mesh };
}

async function _addObstructions(terrainState, meshArrays, stats, signal) {
  const bounds = terrainState.bounds;
  const deriveObstacleHeights = document.getElementById('obstacle-height-mode')?.value === 'dsm-dem';

  if (document.getElementById('layer-buildings')?.checked) {
    try {
      _set3dStatus('Loading 3D buildings...');
      const buildings = await fetchBuildings(bounds.latMin, bounds.latMax, bounds.lonMin, bounds.lonMax, {
        signal,
        deriveObstacleHeights,
        tileConcurrency: 3,
      });
      stats.buildings = _addExtrudedPolygons({
        polygons: buildings.polygons,
        heights: buildings.heights,
        terrainState,
        meshArrays,
        maxCount: MAX_BUILDING_MESHES,
        minHeight: 2,
        material: new THREE.MeshStandardMaterial({
          color: 0x9ca3af,
          roughness: 0.78,
          metalness: 0.03,
          transparent: true,
          opacity: 0.88,
        }),
      });
    } catch (err) {
      if (err?.cancelled || err?.name === 'AbortError') throw err;
      console.warn('[3d] building load failed:', err);
    }
  }

  if (document.getElementById('layer-foliage')?.checked) {
    try {
      _set3dStatus('Loading 3D vegetation...');
      const foliage = await fetchFoliage(bounds.latMin, bounds.latMax, bounds.lonMin, bounds.lonMax, {
        signal,
        deriveObstacleHeights,
        tileConcurrency: 3,
      });
      stats.foliage = _addExtrudedPolygons({
        polygons: foliage.polygons,
        heights: foliage.canopyHeights,
        terrainState,
        meshArrays,
        maxCount: MAX_FOLIAGE_MESHES,
        minHeight: 0.8,
        material: new THREE.MeshStandardMaterial({
          color: 0x22c55e,
          roughness: 0.95,
          metalness: 0,
          transparent: true,
          opacity: 0.34,
          side: THREE.DoubleSide,
        }),
      });
    } catch (err) {
      if (err?.cancelled || err?.name === 'AbortError') throw err;
      console.warn('[3d] foliage load failed:', err);
    }
  }
}

function _addExtrudedPolygons({
  polygons,
  heights,
  terrainState,
  meshArrays,
  maxCount,
  minHeight,
  material,
}) {
  let added = 0;
  for (let i = 0; i < (polygons?.length ?? 0) && added < maxCount; i++) {
    const ring = polygons[i];
    if (!ring || ring.length < 3) continue;
    const shapePts = [];
    let latSum = 0;
    let lonSum = 0;
    for (const [lat, lon] of ring) {
      const { x, z } = projectLatLonToMeters(lat, lon, terrainState.bounds);
      shapePts.push(new THREE.Vector2(x, -z));
      latSum += lat;
      lonSum += lon;
    }
    if (_shapeArea(shapePts) < 20) continue;
    const centroidLat = latSum / ring.length;
    const centroidLon = lonSum / ring.length;
    const baseElev = sampleTerrainElevation(centroidLat, centroidLon, terrainState);
    const baseY = (baseElev - meshArrays.minElevation) * terrainState.verticalScale;
    const height = Math.max(minHeight, heights?.[i] ?? minHeight) * terrainState.verticalScale;

    try {
      const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(shapePts), {
        depth: height,
        bevelEnabled: false,
      });
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, baseY + 0.25, 0);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, material);
      _root.add(mesh);
      added++;
    } catch (err) {
      console.debug('[3d] skipped obstruction polygon:', err.message);
    }
  }
  return added;
}

function _addNodes(terrainState, meshArrays) {
  let count = 0;
  for (const rep of state.repeaters) {
    if (rep.visible === false) continue;
    const { x, z } = projectLatLonToMeters(rep.lat, rep.lon, terrainState.bounds);
    const elev = sampleTerrainElevation(rep.lat, rep.lon, terrainState);
    const groundY = (elev - meshArrays.minElevation) * terrainState.verticalScale;
    const mastH = Math.max(3, Number(rep.height) || 10) * terrainState.verticalScale;
    const color = new THREE.Color(rep.color || '#61dafb');
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 1.4, mastH, 8),
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.55 })
    );
    mast.position.set(x, groundY + mastH / 2, z);
    _root.add(mast);

    const node = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(7, mastH * 0.18), 18, 12),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25 })
    );
    node.position.set(x, groundY + mastH + 8, z);
    _root.add(node);
    count++;
  }
  return count;
}

function _startLoop() {
  if (_animationId) return;
  const tick = () => {
    _animationId = requestAnimationFrame(tick);
    _controls?.update();
    if (_renderer && _scene && _camera) _renderer.render(_scene, _camera);
  };
  tick();
}

function _resize() {
  const host = document.getElementById('map3d');
  if (!_renderer || !host) return;
  const rect = host.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  _renderer.setSize(w, h, false);
  _camera.aspect = w / h;
  _camera.updateProjectionMatrix();
}

function _resetCamera(meshArrays = null, verticalScale = _terrainState?.verticalScale ?? 1) {
  if (!_camera || !_controls) return;
  const arrays = meshArrays ?? (_terrainState ? buildTerrainMeshArrays(_terrainState) : null);
  if (!arrays) return;
  const size = Math.max(arrays.widthM, arrays.depthM);
  const height = Math.max(180, (arrays.maxElevation - arrays.minElevation) * verticalScale);
  _controls.target.set(0, height * 0.26, 0);
  _camera.position.set(size * 0.34, Math.max(size * 0.42, height * 2.2), size * 0.58);
  _camera.near = Math.max(0.5, size / 6000);
  _camera.far = Math.max(5000, size * 7);
  _camera.updateProjectionMatrix();
  _controls.update();
}

function _onPointerMove(event) {
  if (!_active || !_terrainMesh || !_renderer || !_terrainState) return;
  const rect = _renderer.domElement.getBoundingClientRect();
  _pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  _pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  _raycaster.setFromCamera(_pointer, _camera);
  const hit = _raycaster.intersectObject(_terrainMesh, false)[0];
  if (!hit) return;
  const elev = hit.point.y / _terrainState.verticalScale + elevationStats(_terrainState.elevations).min;
  document.getElementById('map3d-cursor').textContent = `Terrain ${elev.toFixed(0)} m AMSL`;
}

function _clearRoot() {
  if (!_root) return;
  for (let i = _root.children.length - 1; i >= 0; i--) {
    const child = _root.children[i];
    _root.remove(child);
    _disposeObject(child);
  }
  _terrainMesh = null;
}

function _disposeObject(obj) {
  obj.traverse?.(child => {
    child.geometry?.dispose?.();
    const mat = child.material;
    if (Array.isArray(mat)) mat.forEach(m => m.dispose?.());
    else mat?.dispose?.();
  });
}

function _gridRes() {
  const value = parseInt(document.getElementById('terrain3d-grid-res')?.value, 10);
  return Number.isFinite(value) ? Math.max(24, Math.min(128, value)) : 64;
}

function _verticalScale() {
  const value = parseFloat(document.getElementById('terrain3d-vertical-scale')?.value);
  return Number.isFinite(value) ? Math.max(1, Math.min(10, value)) : 3;
}

function _targetResolutionM(bounds, res) {
  const metrics = terrainMetrics(bounds);
  return Math.max(metrics.widthM, metrics.depthM) / Math.max(1, res - 1);
}

function _syntheticElevations(bounds, res) {
  const out = new Float32Array(res * res);
  const metrics = terrainMetrics(bounds);
  const base = 180 + Math.abs(metrics.latMid % 1) * 120;
  for (let r = 0; r < res; r++) {
    const y = res > 1 ? r / (res - 1) : 0;
    for (let c = 0; c < res; c++) {
      const x = res > 1 ? c / (res - 1) : 0;
      const ridge = Math.sin((x * 2.4 + y * 1.2) * Math.PI) * 42;
      const hill = Math.exp(-((x - 0.62) ** 2 + (y - 0.42) ** 2) / 0.055) * 95;
      out[r * res + c] = base + ridge + hill + y * 70;
    }
  }
  return out;
}

function _shapeArea(points) {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += points[j].x * points[i].y - points[i].x * points[j].y;
  }
  return Math.abs(area / 2);
}

function _scheduleRefresh() {
  if (!_active) return;
  clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(() => refresh3d({ force: true }), 450);
}

function _set3dStatus(message, kind = 'info') {
  setInlineStatus('map3d-status', message, kind);
}

function _toggleFullscreen() {
  const host = document.getElementById('map-container');
  if (!host) return;
  if (document.fullscreenElement) document.exitFullscreen?.();
  else host.requestFullscreen?.();
}

function _loadSatelliteTexture(bounds) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Create a placeholder gradient while tile loads
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#2d5a2d');
  gradient.addColorStop(0.5, '#4a7c4a');
  gradient.addColorStop(1, '#3a6b3a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);

  // Load OSM satellite tiles asynchronously
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;

  _loadOsmSatelliteTile(bounds, texture);
  return texture;
}

function _loadOsmSatelliteTile(bounds, texture) {
  const bbox = [bounds.lonMin, bounds.latMin, bounds.lonMax, bounds.latMax].join(',');
  const size = 1024;
  const url = `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${bbox}&bboxSR=4326&imageSR=4326&size=${size},${size}&format=jpg&f=image`;

  console.debug('[3d] loading satellite image for bounds:', { bounds, url });

  const textureLoader = new THREE.TextureLoader();
  textureLoader.setCrossOrigin('anonymous');
  textureLoader.load(
    url,
    (loadedTexture) => {
      loadedTexture.magFilter = THREE.LinearFilter;
      loadedTexture.minFilter = THREE.LinearMipmapLinearFilter;
      loadedTexture.wrapS = THREE.ClampToEdgeWrapping;
      loadedTexture.wrapT = THREE.ClampToEdgeWrapping;
      texture.image = loadedTexture.image;
      texture.needsUpdate = true;
      if (_renderer && _scene && _camera) _renderer.render(_scene, _camera);
      console.debug('[3d] satellite texture loaded for viewport');
    },
    undefined,
    (err) => {
      console.warn('[3d] satellite tile load failed:', err.message);
    }
  );
}

function _getViewportBounds() {
  if (_lastValidBounds) return _lastValidBounds;
  try {
    const bounds = boundsFromLeaflet(map.getBounds());
    _lastValidBounds = bounds;
    return bounds;
  } catch (e) {
    console.warn('[3d] failed to get viewport bounds:', e);
    return null;
  }
}
