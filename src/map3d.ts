/**
 * map3d.ts - Three.js terrain view for the current 2D map viewport.
 * Reuses app elevation, obstruction, and node state instead of maintaining a
 * separate map model.
 */
import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { getActiveBaseLayerInfo, map, state } from './map.js';
import { fetchElevationsFromTiles } from './elevation.js';
import { fetchBuildings } from './buildings.js';
import { fetchFoliage } from './foliage.js';
import { setButtonBusy, setInlineStatus, setStatus } from './ui.js';
import { buildMapTileCanvas, drawTexturePlaceholder } from './mapTileTexture.js';
import { normalizeCoverageOverlayMode, writeSignalOverlayPixel } from './signalOverlay.js';
import type { Bbox, LatLonPoint, TerrainMeshArrays } from './terrain3dModel.js';
import {
  boundsFromLeaflet,
  boundsCenteredOn,
  boundsForFocusPoints,
  boundsForTileGrid,
  buildTerrainGridPoints,
  buildTerrainMeshArrays,
  elevationStats,
  format3dSceneStatus,
  isLatLonInsideBounds,
  latLonFromMeters,
  nodeMarkerMetrics,
  projectLatLonToMeters,
  sampleTerrainElevation,
  terrainMetrics,
} from './terrain3dModel.js';

type TerrainSource = 'dem' | 'preview';

type TerrainState = {
  bounds: Bbox;
  viewBounds: Bbox;
  tileCount: number;
  elevations: Float32Array;
  res: number;
  verticalScale: number;
  terrainSource: TerrainSource;
};

type SceneStats = {
  buildings: number;
  foliage: number;
  nodes: number;
  coverage: number;
  links: number;
};

type CameraViewState = {
  cameraOffset: THREE.Vector3;
  targetY: number;
};

type Set3dOptions = {
  focusBounds?: Bbox | null;
};

type Refresh3dOptions = {
  force?: boolean;
  preserveView?: CameraViewState | null;
};

type FocusPoint = {
  lat?: unknown;
  lon?: unknown;
  lng?: unknown;
};

type Map3dFocusDetail = {
  point?: FocusPoint;
  points?: FocusPoint[];
  label?: unknown;
};

type AbortLikeError = {
  cancelled?: boolean;
  name?: string;
  message?: string;
};

type PolygonRing = Array<[number, number]>;

type ProjectedPolygon = {
  coords: Array<[number, number]>;
  points: THREE.Vector2[];
  centroidLat: number;
  centroidLon: number;
};

type PrioritizedPolygon = {
  index: number;
  projected: ProjectedPolygon;
  priority: number;
};

type ExtrudedPolygonOptions = {
  polygons?: PolygonRing[] | null;
  heights?: ArrayLike<number> | null;
  terrainState: TerrainState;
  meshArrays: TerrainMeshArrays;
  maxCount: number;
  minHeight: number;
  material: THREE.Material;
  edgeMaterial?: THREE.Material | null;
  baseMode?: 'centroid' | 'min' | 'max';
  heightScale?: number;
  priorityBounds?: Bbox | null;
};

type CoverageResult = {
  bounds?: Bbox;
  gridRes?: unknown;
  signalGrid?: Float32Array | number[];
  effectiveSens?: unknown;
  noiseFloorDbm?: unknown;
  requiredSnrWithMarginDb?: unknown;
  latMin?: unknown;
  latMax?: unknown;
  lonMin?: unknown;
  lonMax?: unknown;
};

type LinkPoint = {
  lat: number;
  lon: number;
};

type LinkOverlay = {
  pointA?: unknown;
  pointB?: unknown;
  kind?: string;
  color?: string;
  margin?: unknown;
};

type RetileCenter = {
  lat: number;
  lon: number;
};

function _isAbort(err: unknown): boolean {
  const abortErr = err as AbortLikeError;
  return Boolean(abortErr?.cancelled || abortErr?.name === 'AbortError');
}

function _errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function _inputValue(id: string): string {
  return (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
}

function _checked(id: string): boolean {
  return Boolean((document.getElementById(id) as HTMLInputElement | null)?.checked);
}

let _active = false;
let _scene: THREE.Scene | null = null;
let _camera: THREE.PerspectiveCamera | null = null;
let _renderer: THREE.WebGLRenderer | null = null;
let _controls: MapControls | null = null;
let _root: THREE.Group | null = null;
let _terrainMesh: THREE.Mesh | null = null;
let _terrainState: TerrainState | null = null;
let _meshArrays: TerrainMeshArrays | null = null;
let _coverageGroup: THREE.Group | null = null;
let _linkGroup: THREE.Group | null = null;
let _resizeObserver: ResizeObserver | null = null;
let _animationId: number | null = null;
let _abortController: AbortController | null = null;
let _refreshTimer: ReturnType<typeof setTimeout> | null = null;
let _raycaster: THREE.Raycaster | null = null;
let _pointer: THREE.Vector2 | null = null;
let _lastValidBounds: Bbox | null = null;
let _textureSerial = 0;
let _retileTimer: ReturnType<typeof setTimeout> | null = null;
let _refreshInFlight = false;
let _refreshSerial = 0;
let _syncing2dMap = false;
let _retileCount = 0;

const MAX_BUILDING_MESHES = 900;
const MAX_FOLIAGE_MESHES = 500;
const MAX_COVERAGE_TEXTURE_SIZE = 512;
const COVERAGE_SURFACE_RES = 72;
const LINK_SEGMENTS = 80;
const RETILE_TRIGGER_FRACTION = 0.18;
const TERRAIN_TILE_COLUMNS = 4;
const TERRAIN_TILE_ROWS = 4;
const TERRAIN_TILE_COUNT = TERRAIN_TILE_COLUMNS * TERRAIN_TILE_ROWS;
const MAP_TEXTURE_MAX_SIZE = 1536;

export function init(): void {
  document.getElementById('btn-view-2d')?.addEventListener('click', () => set3dMode(false));
  document.getElementById('btn-view-3d')?.addEventListener('click', () => set3dMode(true));
  document.getElementById('btn-refresh-3d')?.addEventListener('click', () => refresh3d({ force: true }));
  document.getElementById('btn-map3d-refresh')?.addEventListener('click', () => refresh3d({ force: true }));
  document.getElementById('btn-map3d-reset')?.addEventListener('click', () => _resetCamera());
  document.getElementById('btn-map3d-fullscreen')?.addEventListener('click', _toggleFullscreen);

  ['terrain3d-vertical-scale', 'terrain3d-grid-res', 'layer-buildings', 'layer-foliage'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', _scheduleRefresh);
    document.getElementById(id)?.addEventListener('input', _scheduleRefresh);
  });
  document.addEventListener('repeaters:changed', _scheduleRefresh);
  document.addEventListener('repeater:moved', _scheduleRefresh);
  document.addEventListener('coverage:changed', _refreshDynamicOverlays);
  document.addEventListener('p2p:changed', _refreshDynamicOverlays);
  document.addEventListener('map3d:focus', (event: Event) => _focus3dOnSelection((event as CustomEvent<Map3dFocusDetail>).detail));

  map.on('moveend', () => {
    if (_syncing2dMap) return;
    if (_active && _checked('layer-auto-refresh')) _scheduleRefresh();
  });
}

export function set3dMode(enabled: boolean, options: Set3dOptions = {}): void {
  _active = Boolean(enabled);
  const focusBounds = options?.focusBounds ?? null;
  
  // Capture map state BEFORE layout changes
  if (_active) {
    if (focusBounds) {
      _lastValidBounds = focusBounds;
    } else {
      try {
        _lastValidBounds = boundsFromLeaflet(map.getBounds());
        console.debug('[3d] captured bounds:', _lastValidBounds);
      } catch (e) {
        console.warn('[3d] failed to capture map state:', e);
      }
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
    _startLoop();
    _resize();
    _renderPreview();
    refresh3d({ force: true });
    setStatus('3D terrain view active.');
  } else {
    _abortController?.abort();
    if (_refreshTimer) clearTimeout(_refreshTimer);
    if (_retileTimer) clearTimeout(_retileTimer);
    _disposeScene();
    _lastValidBounds = null;
    map.invalidateSize();
    setStatus('2D map view active.');
  }
}

function _focus3dOnSelection(detail: Map3dFocusDetail = {}): void {
  const rawPoints = Array.isArray(detail?.points)
    ? detail.points
    : (detail?.point ? [detail.point] : []);
  let referenceBounds = _lastValidBounds;
  if (!referenceBounds) {
    try {
      referenceBounds = boundsFromLeaflet(map.getBounds());
    } catch {
      referenceBounds = null;
    }
  }
  if (!referenceBounds) return;
  const focusBounds = boundsForFocusPoints(rawPoints, referenceBounds);
  const label = String(detail?.label || 'selected object').trim();
  const panel = document.getElementById('map3d');
  panel?.setAttribute('data-focus-label', label);
  panel?.setAttribute('data-focus-points', String(rawPoints.length));
  set3dMode(true, { focusBounds });
  setStatus(`3D terrain focused on ${label}.`);
}

export async function refresh3d({ force = false, preserveView = null }: Refresh3dOptions = {}): Promise<void> {
  if (!_active && !force) return;
  _ensureScene();
  const refreshId = ++_refreshSerial;
  _refreshInFlight = true;
  _abortController?.abort();
  _abortController = new AbortController();
  const signal = _abortController.signal;
  setButtonBusy('btn-refresh-3d', true, 'Loading...');
  setButtonBusy('btn-map3d-refresh', true, 'Loading...');
  _set3dStatus('Loading 3D terrain...');

  try {
    const viewBounds = _getViewportBounds();
    if (!viewBounds) {
      _set3dStatus('3D view: Unable to determine map bounds', 'error');
      return;
    }
    const bounds = boundsForTileGrid(viewBounds, TERRAIN_TILE_COLUMNS, TERRAIN_TILE_ROWS);
    const res = _gridRes();
    const points = buildTerrainGridPoints(bounds, res);
    let elevations: ArrayLike<number> | null = null;
    let terrainSource: TerrainSource = 'dem';
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
      if (_isAbort(err)) throw err;
      console.warn('[3d] terrain fetch failed, using preview terrain:', err);
      elevations = _syntheticElevations(bounds, res);
      terrainSource = 'preview';
      _set3dStatus('Terrain source unavailable; showing preview terrain.', 'warning');
    }

    const terrainState = {
      bounds,
      viewBounds,
      tileCount: TERRAIN_TILE_COUNT,
      elevations: Float32Array.from(elevations),
      res,
      verticalScale: _verticalScale(),
      terrainSource,
    };

    const stats = await _rebuildScene(terrainState, signal, preserveView);
    _terrainState = terrainState;
    const status = format3dSceneStatus({ res, tileCount: TERRAIN_TILE_COUNT, stats, terrainSource });
    _set3dStatus(status.text, status.kind);
  } catch (err) {
      if (_isAbort(err)) return;
    console.warn('[3d] refresh failed:', err);
    _set3dStatus(`3D view failed: ${_errorMessage(err)}`, 'error');
  } finally {
    if (refreshId === _refreshSerial) {
      _refreshInFlight = false;
      setButtonBusy('btn-refresh-3d', false);
      setButtonBusy('btn-map3d-refresh', false);
    }
  }
}

function _ensureScene(): void {
  if (_renderer) return;
  const host = document.getElementById('map3d');
  const canvas = document.getElementById('map3d-canvas') as HTMLCanvasElement | null;
  if (!host || !canvas) return;
  _scene = new THREE.Scene();
  _scene.background = new THREE.Color(0x0b1014);
  _scene.fog = null;
  _camera = new THREE.PerspectiveCamera(48, 1, 1, 120000);
  _renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  _renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  _renderer.outputColorSpace = THREE.SRGBColorSpace;
  _controls = new MapControls(_camera, canvas);
  _controls.enableDamping = true;
  _controls.dampingFactor = 0.08;
  _controls.screenSpacePanning = false;
  _controls.enableRotate = true;
  _controls.mouseButtons = {
    LEFT: THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  _controls.touches = {
    ONE: THREE.TOUCH.PAN,
    TWO: THREE.TOUCH.DOLLY_ROTATE,
  };
  _controls.maxPolarAngle = Math.PI * 0.49;
  _controls.minDistance = 80;
  _controls.addEventListener('end', _scheduleRetileFromControls);
  host?.setAttribute('data-navigation', 'map-pan-tiling');
  host?.setAttribute('data-retile-count', String(_retileCount));

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

function _renderPreview(): void {
  if (_terrainMesh) return;
  const bounds = _getViewportBounds();
  if (!bounds) return;
  const res = Math.min(48, _gridRes());
  const terrainState: TerrainState = {
    bounds,
    viewBounds: bounds,
    tileCount: 1,
    elevations: _syntheticElevations(bounds, res),
    res,
    verticalScale: _verticalScale(),
    terrainSource: 'preview',
  };
  _rebuildTerrainOnly(terrainState);
  _terrainState = terrainState;
  document.getElementById('map3d')?.setAttribute('data-ready', 'preview');
  _set3dStatus('Preparing 3D terrain...');
}

async function _rebuildScene(
  terrainState: TerrainState,
  signal: AbortSignal,
  preserveView: CameraViewState | null = null
): Promise<SceneStats> {
  _clearRoot();
  const { meshArrays, terrainMesh } = _addTerrain(terrainState);
  _terrainMesh = terrainMesh;
  _meshArrays = meshArrays;
  const stats: SceneStats = { buildings: 0, foliage: 0, nodes: 0, coverage: 0, links: 0 };
  stats.coverage = _addCoverageOverlays(terrainState, meshArrays);
  stats.links = _addLinkOverlays(terrainState, meshArrays);
  stats.nodes = _addNodes(terrainState, meshArrays);
  _set3dStats(stats);
  await _addObstructions(terrainState, meshArrays, stats, signal);
  _set3dStats(stats);
  if (preserveView) _restoreCamera(meshArrays, terrainState.verticalScale, preserveView);
  else _resetCamera(meshArrays, terrainState.verticalScale);
  return stats;
}

function _rebuildTerrainOnly(terrainState: TerrainState): void {
  _clearRoot();
  const { meshArrays, terrainMesh } = _addTerrain(terrainState);
  _terrainMesh = terrainMesh;
  _meshArrays = meshArrays;
  const stats: SceneStats = { buildings: 0, foliage: 0, nodes: 0, coverage: 0, links: 0 };
  stats.coverage = _addCoverageOverlays(terrainState, meshArrays);
  stats.links = _addLinkOverlays(terrainState, meshArrays);
  _set3dStats(stats);
  _resetCamera(meshArrays, terrainState.verticalScale);
}

function _addTerrain(terrainState: TerrainState): { meshArrays: TerrainMeshArrays; terrainMesh: THREE.Mesh } {
  const meshArrays = buildTerrainMeshArrays(terrainState);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(meshArrays.positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(meshArrays.colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(meshArrays.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(meshArrays.indices, 1));
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    map: _createMirroredMapTexture(terrainState.bounds),
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'terrain';
  _root?.add(mesh);
  const panel = document.getElementById('map3d');
  panel?.setAttribute('data-ready', 'terrain');
  panel?.setAttribute('data-terrain-tiles', String(terrainState.tileCount ?? 1));
  panel?.setAttribute('data-terrain-source', terrainState.terrainSource ?? 'unknown');

  return { meshArrays, terrainMesh: mesh };
}

async function _addObstructions(
  terrainState: TerrainState,
  meshArrays: TerrainMeshArrays,
  stats: SceneStats,
  signal: AbortSignal
): Promise<void> {
  const bounds = terrainState.bounds;
  const deriveObstacleHeights = _inputValue('obstacle-height-mode') === 'dsm-dem';

  if (_checked('layer-buildings')) {
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
        minHeight: 8,
        baseMode: 'max',
        heightScale: Math.max(terrainState.verticalScale, 2.5),
        priorityBounds: terrainState.viewBounds,
        material: new THREE.MeshStandardMaterial({
          color: 0xf8fafc,
          emissive: 0x1f2937,
          emissiveIntensity: 0.18,
          roughness: 0.68,
          metalness: 0.03,
          transparent: true,
          opacity: 0.96,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -1,
        }),
        edgeMaterial: new THREE.LineBasicMaterial({
          color: 0x334155,
          transparent: true,
          opacity: 0.72,
        }),
      });
    } catch (err) {
      if (_isAbort(err)) throw err;
      console.warn('[3d] building load failed:', err);
    }
  }

  if (_checked('layer-foliage')) {
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
        baseMode: 'centroid',
        heightScale: terrainState.verticalScale,
        priorityBounds: terrainState.viewBounds,
        material: new THREE.MeshStandardMaterial({
          color: 0x22c55e,
          roughness: 0.95,
          metalness: 0,
          transparent: true,
          opacity: 0.34,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      });
    } catch (err) {
      if (_isAbort(err)) throw err;
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
  edgeMaterial = null,
  baseMode = 'centroid',
  heightScale = terrainState.verticalScale,
  priorityBounds = null,
}: ExtrudedPolygonOptions): number {
  let added = 0;
  const items = _prioritizedPolygonItems(polygons, terrainState.bounds, priorityBounds);
  for (const item of items) {
    if (added >= maxCount) break;
    const i = item.index;
    const projected = item.projected;
    if (!projected || _shapeArea(projected.points) < 20) continue;
    const baseElev = _obstructionBaseElevation(projected, terrainState, baseMode);
    const baseY = (baseElev - meshArrays.minElevation) * terrainState.verticalScale;
    const height = Math.max(minHeight, heights?.[i] ?? minHeight) * heightScale;

    try {
      const geometry = _buildPrismGeometry(projected.points, baseY + 0.25, height);
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, material);
      if (edgeMaterial) {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 18), edgeMaterial);
        mesh.add(edges);
      }
      _root?.add(mesh);
      added++;
    } catch (err) {
      console.debug('[3d] skipped obstruction polygon:', _errorMessage(err));
    }
  }
  return added;
}

function _addNodes(terrainState: TerrainState, meshArrays: TerrainMeshArrays): number {
  let count = 0;
  for (const rep of state.repeaters) {
    if (rep.visible === false) continue;
    if (!isLatLonInsideBounds(rep.lat, rep.lon, terrainState.bounds, 0.02)) continue;
    const { x, z } = projectLatLonToMeters(rep.lat, rep.lon, terrainState.bounds);
    const elev = sampleTerrainElevation(rep.lat, rep.lon, terrainState);
    const groundY = (elev - meshArrays.minElevation) * terrainState.verticalScale;
    const metrics = nodeMarkerMetrics(meshArrays.widthM, meshArrays.depthM, rep.height, terrainState.verticalScale);
    const color = new THREE.Color(rep.color || '#61dafb');
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(metrics.mastRadius, metrics.mastRadius, metrics.mastHeight, 12),
      new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        emissive: 0x111827,
        roughness: 0.45,
        depthTest: false,
      })
    );
    mast.position.set(x, groundY + metrics.mastHeight / 2, z);
    mast.renderOrder = 28;
    _root?.add(mast);

    const node = new THREE.Mesh(
      new THREE.SphereGeometry(metrics.radius, 24, 16),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.75,
        roughness: 0.4,
        depthTest: false,
      })
    );
    node.position.set(x, groundY + metrics.mastHeight + metrics.radius * 0.9, z);
    node.renderOrder = 30;
    _root?.add(node);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(metrics.ringRadius, metrics.ringTube, 10, 48),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.92,
        depthTest: false,
      })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, groundY + 3, z);
    ring.renderOrder = 29;
    _root?.add(ring);
    count++;
  }
  return count;
}

function _addCoverageOverlays(terrainState: TerrainState, meshArrays: TerrainMeshArrays): number {
  _clearCoverageGroup();
  const group = new THREE.Group();
  group.name = 'coverage-overlays';
  let count = 0;

  for (const result of state.coverageResults ?? []) {
    const resultBounds = _normalizeBounds(result?.bounds ?? result);
    if (!resultBounds) continue;
    const clippedBounds = _intersectBounds(resultBounds, terrainState.bounds);
    if (!clippedBounds) continue;

    const canvas = _buildCoverageTextureCanvas(result);
    if (!canvas) continue;
    const geometry = _buildCoverageSurfaceGeometry(clippedBounds, resultBounds, terrainState, meshArrays);
    if (!geometry) continue;

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: _coverageOpacity(),
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -5,
        polygonOffsetUnits: -5,
      })
    );
    mesh.name = 'coverage-overlay';
    mesh.renderOrder = 12;
    group.add(mesh);
    count++;
  }

  if (count > 0) {
    _root?.add(group);
    _coverageGroup = group;
  } else {
    _disposeObject(group);
    _coverageGroup = null;
  }
  return count;
}

function _buildCoverageTextureCanvas(result: CoverageResult): HTMLCanvasElement | null {
  const gridRes = Math.max(2, Math.floor(Number(result?.gridRes) || 0));
  const signalGrid = result?.signalGrid instanceof Float32Array
    ? result.signalGrid
    : new Float32Array(result?.signalGrid ?? []);
  if (signalGrid.length !== gridRes * gridRes) return null;

  const textureRes = Math.max(2, Math.min(MAX_COVERAGE_TEXTURE_SIZE, gridRes));
  const canvas = document.createElement('canvas');
  canvas.width = textureRes;
  canvas.height = textureRes;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const image = ctx.createImageData(textureRes, textureRes);
  const options = {
    mode: normalizeCoverageOverlayMode(_inputValue('coverage-overlay-mode')),
    effectiveSens: Number.isFinite(result.effectiveSens) ? Number(result.effectiveSens) : -133,
    noiseFloorDbm: Number.isFinite(result.noiseFloorDbm) ? Number(result.noiseFloorDbm) : -115.5,
    requiredSnrWithMarginDb: Number.isFinite(result.requiredSnrWithMarginDb)
      ? Number(result.requiredSnrWithMarginDb)
      : -17.5,
  };
  const dstDen = Math.max(1, textureRes - 1);
  const srcMax = gridRes - 1;
  for (let r = 0; r < textureRes; r++) {
    const srcR = Math.round((r / dstDen) * srcMax);
    for (let c = 0; c < textureRes; c++) {
      const srcC = Math.round((c / dstDen) * srcMax);
      writeSignalOverlayPixel(image.data, (r * textureRes + c) * 4, signalGrid[srcR * gridRes + srcC], options);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function _buildCoverageSurfaceGeometry(
  clippedBounds: Bbox,
  sourceBounds: Bbox,
  terrainState: TerrainState,
  meshArrays: TerrainMeshArrays
): THREE.BufferGeometry | null {
  const latSpan = clippedBounds.latMax - clippedBounds.latMin;
  const lonSpan = clippedBounds.lonMax - clippedBounds.lonMin;
  const sourceLatSpan = sourceBounds.latMax - sourceBounds.latMin;
  const sourceLonSpan = sourceBounds.lonMax - sourceBounds.lonMin;
  if (latSpan <= 0 || lonSpan <= 0 || sourceLatSpan <= 0 || sourceLonSpan <= 0) return null;

  const res = COVERAGE_SURFACE_RES;
  const vertexCount = res * res;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const lift = _surfaceLift(meshArrays);
  let p = 0;
  let u = 0;
  for (let r = 0; r < res; r++) {
    const rf = r / (res - 1);
    const lat = clippedBounds.latMax - rf * latSpan;
    for (let c = 0; c < res; c++) {
      const cf = c / (res - 1);
      const lon = clippedBounds.lonMin + cf * lonSpan;
      const { x, z } = projectLatLonToMeters(lat, lon, terrainState.bounds);
      const elev = sampleTerrainElevation(lat, lon, terrainState);
      positions[p++] = x;
      positions[p++] = (elev - meshArrays.minElevation) * terrainState.verticalScale + lift;
      positions[p++] = z;
      uvs[u++] = (lon - sourceBounds.lonMin) / sourceLonSpan;
      uvs[u++] = 1 - (sourceBounds.latMax - lat) / sourceLatSpan;
    }
  }

  const indices = new Uint32Array((res - 1) * (res - 1) * 6);
  let i = 0;
  for (let r = 0; r < res - 1; r++) {
    for (let c = 0; c < res - 1; c++) {
      const a = r * res + c;
      const b = a + 1;
      const d = (r + 1) * res + c;
      const e = d + 1;
      indices[i++] = a; indices[i++] = d; indices[i++] = b;
      indices[i++] = b; indices[i++] = d; indices[i++] = e;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

function _addLinkOverlays(terrainState: TerrainState, meshArrays: TerrainMeshArrays): number {
  _clearLinkGroup();
  const links = [...(state.pathLinks ?? []), ...(state.p2pLinks ?? [])] as LinkOverlay[];
  const group = new THREE.Group();
  group.name = 'link-overlays';
  let count = 0;

  for (const link of links) {
    const a = _normalizeLinkPoint(link.pointA);
    const b = _normalizeLinkPoint(link.pointB);
    if (!a || !b || !_linkTouchesBounds(a, b, terrainState.bounds)) continue;
    const points = _buildLinkPoints(a, b, link, terrainState, meshArrays);
    if (points.length < 2) continue;

    const color = new THREE.Color(_linkColor(link));
    const tubeRadius = _linkRadius(link, meshArrays);
    const curve = new THREE.CatmullRomCurve3(points);
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(curve, Math.max(8, points.length - 1), tubeRadius, 8, false),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: link.kind === 'path' ? 0.82 : 0.96,
        depthTest: false,
      })
    );
    mesh.name = link.kind === 'path' ? 'path-link' : 'p2p-link';
    mesh.renderOrder = 36;
    group.add(mesh);
    _addLinkEndpoint(group, points[0], color, tubeRadius);
    _addLinkEndpoint(group, points[points.length - 1], color, tubeRadius);
    count++;
  }

  if (count > 0) {
    _root?.add(group);
    _linkGroup = group;
  } else {
    _disposeObject(group);
    _linkGroup = null;
  }
  return count;
}

function _buildLinkPoints(
  a: LinkPoint,
  b: LinkPoint,
  link: LinkOverlay,
  terrainState: TerrainState,
  meshArrays: TerrainMeshArrays
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const lift = _linkLift(link, meshArrays);
  for (let i = 0; i <= LINK_SEGMENTS; i++) {
    const t = i / LINK_SEGMENTS;
    const lat = a.lat + (b.lat - a.lat) * t;
    const lon = a.lon + (b.lon - a.lon) * t;
    const { x, z } = projectLatLonToMeters(lat, lon, terrainState.bounds);
    const elev = sampleTerrainElevation(lat, lon, terrainState);
    const y = (elev - meshArrays.minElevation) * terrainState.verticalScale + lift;
    points.push(new THREE.Vector3(x, y, z));
  }
  return points;
}

function _addLinkEndpoint(group: THREE.Group, position: THREE.Vector3, color: THREE.Color, tubeRadius: number): void {
  const endpoint = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(tubeRadius * 2.4, 6), 16, 10),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    })
  );
  endpoint.position.copy(position);
  endpoint.renderOrder = 37;
  group.add(endpoint);
}

function _refreshDynamicOverlays(event: Event | null = null): void {
  if (!_active || !_terrainState || !_meshArrays || !_root) return;
  const panel = document.getElementById('map3d');
  if (!event || event.type === 'coverage:changed') {
    const coverage = _addCoverageOverlays(_terrainState, _meshArrays);
    panel?.setAttribute('data-coverage-count', String(coverage));
  }
  if (!event || event.type === 'p2p:changed') {
    const links = _addLinkOverlays(_terrainState, _meshArrays);
    panel?.setAttribute('data-p2p-links-count', String(links));
  }
  if (_renderer && _scene && _camera) _renderer.render(_scene, _camera);
}

function _coverageOpacity(): number {
  const raw = parseFloat(_inputValue('coverage-opacity'));
  return Number.isFinite(raw) ? Math.max(0.05, Math.min(1, raw / 100)) : 0.65;
}

function _surfaceLift(meshArrays: TerrainMeshArrays): number {
  return Math.max(2, Math.min(16, Math.max(meshArrays.widthM, meshArrays.depthM) * 0.0008));
}

function _linkLift(link: LinkOverlay, meshArrays: TerrainMeshArrays): number {
  const base = _surfaceLift(meshArrays);
  return base + (link.kind === 'path' ? 18 : 28);
}

function _linkRadius(link: LinkOverlay, meshArrays: TerrainMeshArrays): number {
  const size = Math.max(meshArrays.widthM, meshArrays.depthM);
  const factor = link.kind === 'path' ? 0.0011 : 0.0016;
  return Math.max(3, Math.min(18, size * factor));
}

function _linkColor(link: LinkOverlay): string {
  if (link?.color) return link.color;
  const margin = Number(link?.margin);
  if (!Number.isFinite(margin)) return '#facc15';
  if (margin >= 10) return '#4ade80';
  if (margin >= 0) return '#facc15';
  return '#f87171';
}

function _normalizeLinkPoint(point: unknown): LinkPoint | null {
  const raw = point as FocusPoint | null | undefined;
  const lat = Number(raw?.lat);
  const lon = Number(raw?.lon ?? raw?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function _normalizeBounds(bounds: CoverageResult | Bbox | null | undefined): Bbox | null {
  const latMin = Number(bounds?.latMin);
  const latMax = Number(bounds?.latMax);
  const lonMin = Number(bounds?.lonMin);
  const lonMax = Number(bounds?.lonMax);
  if (![latMin, latMax, lonMin, lonMax].every(Number.isFinite)) return null;
  return {
    latMin: Math.min(latMin, latMax),
    latMax: Math.max(latMin, latMax),
    lonMin: Math.min(lonMin, lonMax),
    lonMax: Math.max(lonMin, lonMax),
  };
}

function _intersectBounds(a: Bbox | null | undefined, b: Bbox | null | undefined): Bbox | null {
  if (!a || !b) return null;
  const bounds = {
    latMin: Math.max(a.latMin, b.latMin),
    latMax: Math.min(a.latMax, b.latMax),
    lonMin: Math.max(a.lonMin, b.lonMin),
    lonMax: Math.min(a.lonMax, b.lonMax),
  };
  if (bounds.latMax <= bounds.latMin || bounds.lonMax <= bounds.lonMin) return null;
  return bounds;
}

function _linkTouchesBounds(a: LinkPoint, b: LinkPoint, bounds: Bbox): boolean {
  const linkBounds = {
    latMin: Math.min(a.lat, b.lat),
    latMax: Math.max(a.lat, b.lat),
    lonMin: Math.min(a.lon, b.lon),
    lonMax: Math.max(a.lon, b.lon),
  };
  return Boolean(_intersectBounds(linkBounds, bounds));
}

function _clearCoverageGroup(): void {
  if (!_coverageGroup || !_root) return;
  _root.remove(_coverageGroup);
  _disposeObject(_coverageGroup);
  _coverageGroup = null;
}

function _clearLinkGroup(): void {
  if (!_linkGroup || !_root) return;
  _root.remove(_linkGroup);
  _disposeObject(_linkGroup);
  _linkGroup = null;
}

function _startLoop(): void {
  if (_animationId) return;
  const tick = () => {
    _animationId = requestAnimationFrame(tick);
    _controls?.update();
    if (_renderer && _scene && _camera) _renderer.render(_scene, _camera);
  };
  tick();
}

function _stopLoop(): void {
  if (!_animationId) return;
  cancelAnimationFrame(_animationId);
  _animationId = null;
}

function _resize(): void {
  const host = document.getElementById('map3d');
  if (!_renderer || !_camera || !host) return;
  const rect = host.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  _renderer.setSize(w, h, false);
  _camera.aspect = w / h;
  _camera.updateProjectionMatrix();
}

function _resetCamera(meshArrays: TerrainMeshArrays | null = null, verticalScale = _terrainState?.verticalScale ?? 1): void {
  if (!_camera || !_controls) return;
  const arrays = meshArrays ?? (_terrainState ? buildTerrainMeshArrays(_terrainState) : null);
  if (!arrays) return;
  const frameMetrics = _terrainState?.viewBounds ? terrainMetrics(_terrainState.viewBounds) : arrays;
  const size = Math.max(frameMetrics.widthM, frameMetrics.depthM);
  const height = Math.max(180, (arrays.maxElevation - arrays.minElevation) * verticalScale);
  _controls.target.set(0, height * 0.18, 0);
  _camera.position.set(size * 0.08, Math.max(size * 0.95, height * 3.2), size * 0.18);
  _camera.near = Math.max(0.5, size / 6000);
  _camera.far = Math.max(5000, size * 7);
  _camera.updateProjectionMatrix();
  _controls.update();
}

function _restoreCamera(meshArrays: TerrainMeshArrays | null, verticalScale: number, viewState: CameraViewState | null): void {
  if (!_camera || !_controls || !viewState?.cameraOffset) {
    _resetCamera(meshArrays, verticalScale);
    return;
  }
  const arrays = meshArrays ?? (_terrainState ? buildTerrainMeshArrays(_terrainState) : null);
  if (!arrays) return;
  const frameMetrics = _terrainState?.viewBounds ? terrainMetrics(_terrainState.viewBounds) : arrays;
  const size = Math.max(frameMetrics.widthM, frameMetrics.depthM);
  const height = Math.max(180, (arrays.maxElevation - arrays.minElevation) * verticalScale);
  const targetY = Number.isFinite(viewState.targetY) ? viewState.targetY : height * 0.18;
  _controls.target.set(0, targetY, 0);
  _camera.position.copy(_controls.target).add(viewState.cameraOffset);
  if (_camera.position.y < targetY + 20) _camera.position.y = targetY + 20;
  _camera.near = Math.max(0.5, size / 6000);
  _camera.far = Math.max(5000, size * 7);
  _camera.updateProjectionMatrix();
  _controls.update();
}

function _captureViewState(): CameraViewState | null {
  if (!_camera || !_controls) return null;
  return {
    cameraOffset: _camera.position.clone().sub(_controls.target),
    targetY: _controls.target.y,
  };
}

function _onPointerMove(event: PointerEvent): void {
  if (!_active || !_terrainMesh || !_renderer || !_terrainState || !_pointer || !_raycaster || !_camera) return;
  const rect = _renderer.domElement.getBoundingClientRect();
  _pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  _pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  _raycaster.setFromCamera(_pointer, _camera);
  const hit = _raycaster.intersectObject(_terrainMesh, false)[0];
  if (!hit) return;
  const minElevation = _meshArrays?.minElevation ?? elevationStats(_terrainState.elevations).min;
  const elev = hit.point.y / _terrainState.verticalScale + minElevation;
  const cursor = document.getElementById('map3d-cursor');
  if (cursor) cursor.textContent = `Terrain ${elev.toFixed(0)} m AMSL`;
}

function _clearRoot(): void {
  if (!_root) return;
  for (let i = _root.children.length - 1; i >= 0; i--) {
    const child = _root.children[i];
    _root.remove(child);
    _disposeObject(child);
  }
  _terrainMesh = null;
  _meshArrays = null;
  _coverageGroup = null;
  _linkGroup = null;
}

function _disposeObject(obj: THREE.Object3D): void {
  obj.traverse?.(child => {
    const mesh = child as THREE.Object3D & { geometry?: { dispose?: () => void }; material?: THREE.Material | THREE.Material[] };
    mesh.geometry?.dispose?.();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach(m => {
      (m as THREE.Material & { map?: THREE.Texture }).map?.dispose?.();
      m.dispose?.();
    });
    else {
      (mat as THREE.Material & { map?: THREE.Texture } | undefined)?.map?.dispose?.();
      mat?.dispose?.();
    }
  });
}

function _disposeScene(): void {
  _stopLoop();
  if (_refreshTimer) clearTimeout(_refreshTimer);
  if (_retileTimer) clearTimeout(_retileTimer);
  _textureSerial++;
  _resizeObserver?.disconnect();
  _resizeObserver = null;
  _controls?.removeEventListener?.('end', _scheduleRetileFromControls);
  _controls?.dispose?.();
  _controls = null;
  _renderer?.domElement?.removeEventListener?.('pointermove', _onPointerMove);
  _clearRoot();
  if (_root && _scene) _scene.remove(_root);
  _root = null;
  _terrainMesh = null;
  _terrainState = null;
  _meshArrays = null;
  _coverageGroup = null;
  _linkGroup = null;
  _raycaster = null;
  _pointer = null;
  _renderer?.dispose?.();
  _renderer = null;
  _camera = null;
  _scene = null;
}

function _gridRes(): number {
  const value = parseInt(_inputValue('terrain3d-grid-res'), 10);
  return Number.isFinite(value) ? Math.max(24, Math.min(128, value)) : 64;
}

function _verticalScale(): number {
  const value = parseFloat(_inputValue('terrain3d-vertical-scale'));
  return Number.isFinite(value) ? Math.max(1, Math.min(10, value)) : 3;
}

function _targetResolutionM(bounds: Bbox, res: number): number {
  const metrics = terrainMetrics(bounds);
  return Math.max(metrics.widthM, metrics.depthM) / Math.max(1, res - 1);
}

function _syntheticElevations(bounds: Bbox, res: number): Float32Array {
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

function _shapeArea(points: THREE.Vector2[]): number {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += points[j].x * points[i].y - points[i].x * points[j].y;
  }
  return Math.abs(area / 2);
}

function _projectObstructionRing(ring: PolygonRing, bounds: Bbox): ProjectedPolygon | null {
  if (!Array.isArray(ring)) return null;
  const coords: Array<[number, number]> = [];
  for (const point of ring) {
    const lat = Number(point?.[0]);
    const lon = Number(point?.[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) coords.push([lat, lon]);
  }
  if (coords.length > 3) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) coords.pop();
  }
  if (coords.length < 3) return null;

  const points: THREE.Vector2[] = [];
  let latSum = 0;
  let lonSum = 0;
  for (const [lat, lon] of coords) {
    const { x, z } = projectLatLonToMeters(lat, lon, bounds);
    points.push(new THREE.Vector2(x, z));
    latSum += lat;
    lonSum += lon;
  }
  return {
    coords,
    points,
    centroidLat: latSum / coords.length,
    centroidLon: lonSum / coords.length,
  };
}

function _prioritizedPolygonItems(
  polygons: PolygonRing[] | null | undefined,
  bounds: Bbox,
  priorityBounds: Bbox | null
): PrioritizedPolygon[] {
  const items: PrioritizedPolygon[] = [];
  for (let i = 0; i < (polygons?.length ?? 0); i++) {
    const ring = polygons?.[i];
    if (!ring) continue;
    const projected = _projectObstructionRing(ring, bounds);
    if (!projected) continue;
    const priority = priorityBounds && isLatLonInsideBounds(projected.centroidLat, projected.centroidLon, priorityBounds, 0.1) ? 0 : 1;
    items.push({ index: i, projected, priority });
  }
  items.sort((a, b) => a.priority - b.priority);
  return items;
}

function _obstructionBaseElevation(projected: ProjectedPolygon, terrainState: TerrainState, mode: 'centroid' | 'min' | 'max'): number {
  if (mode === 'centroid') {
    return sampleTerrainElevation(projected.centroidLat, projected.centroidLon, terrainState);
  }

  let selected = mode === 'min' ? Infinity : -Infinity;
  const coords = projected.coords ?? [];
  const step = Math.max(1, Math.floor(coords.length / 12));
  for (let i = 0; i < coords.length; i += step) {
    const [lat, lon] = coords[i];
    const elev = sampleTerrainElevation(lat, lon, terrainState);
    if (mode === 'min') selected = Math.min(selected, elev);
    else selected = Math.max(selected, elev);
  }
  const centroidElev = sampleTerrainElevation(projected.centroidLat, projected.centroidLon, terrainState);
  if (mode === 'min') selected = Math.min(selected, centroidElev);
  else selected = Math.max(selected, centroidElev);
  return Number.isFinite(selected) ? selected : centroidElev;
}

function _buildPrismGeometry(points: THREE.Vector2[], baseY: number, height: number): THREE.BufferGeometry | null {
  if (!points?.length || points.length < 3) return null;
  const triangles = THREE.ShapeUtils.triangulateShape(points, []);
  if (!triangles.length) return null;

  const topY = baseY + height;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const pt of points) {
    positions.push(pt.x, baseY, pt.y, pt.x, topY, pt.y);
  }

  for (const tri of triangles) {
    const [a, b, c] = tri;
    if (_topNormalY(points[a], points[b], points[c]) >= 0) {
      indices.push(a * 2 + 1, b * 2 + 1, c * 2 + 1);
    } else {
      indices.push(a * 2 + 1, c * 2 + 1, b * 2 + 1);
    }
  }

  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const bi = i * 2;
    const ti = bi + 1;
    const bj = j * 2;
    const tj = bj + 1;
    indices.push(bi, bj, ti, ti, bj, tj);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function _topNormalY(a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2): number {
  const abx = b.x - a.x;
  const abz = b.y - a.y;
  const acx = c.x - a.x;
  const acz = c.y - a.y;
  return abz * acx - abx * acz;
}

function _set3dStats(stats: SceneStats): void {
  const panel = document.getElementById('map3d');
  if (!panel) return;
  panel.setAttribute('data-buildings-count', String(stats.buildings ?? 0));
  panel.setAttribute('data-foliage-count', String(stats.foliage ?? 0));
  panel.setAttribute('data-nodes-count', String(stats.nodes ?? 0));
  panel.setAttribute('data-coverage-count', String(stats.coverage ?? 0));
  panel.setAttribute('data-p2p-links-count', String(stats.links ?? 0));
}

function _scheduleRetileFromControls(): void {
  if (!_active || !_terrainState || !_controls || _refreshInFlight) return;
  if (_retileTimer) clearTimeout(_retileTimer);
  _retileTimer = setTimeout(_retileFromControls, 160);
}

function _retileFromControls(): void {
  if (!_active || !_terrainState || !_controls || _refreshInFlight) return;
  const bounds = _terrainState.viewBounds ?? _terrainState.bounds;
  const metrics = terrainMetrics(bounds);
  const target = _controls.target;
  const xFraction = Math.abs(target.x) / Math.max(1, metrics.widthM);
  const zFraction = Math.abs(target.z) / Math.max(1, metrics.depthM);
  if (Math.max(xFraction, zFraction) < RETILE_TRIGGER_FRACTION) return;

  const center = latLonFromMeters(target.x, target.z, _terrainState.bounds);
  const nextBounds = boundsCenteredOn(center, bounds);
  _lastValidBounds = nextBounds;
  _sync2dMapCenter(center);
  const preserveView = _captureViewState();
  _retileCount++;
  document.getElementById('map3d')?.setAttribute('data-retile-count', String(_retileCount));
  refresh3d({ force: true, preserveView });
}

function _sync2dMapCenter(center: RetileCenter): void {
  _syncing2dMap = true;
  try {
    map.setView([center.lat, center.lon], map.getZoom(), { animate: false });
  } finally {
    setTimeout(() => { _syncing2dMap = false; }, 0);
  }
}

function _scheduleRefresh(): void {
  if (!_active) return;
  if (_refreshTimer) clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(() => refresh3d({ force: true }), 450);
}

function _set3dStatus(message: string, kind = 'info'): void {
  setInlineStatus('map3d-status', message, kind);
}

function _toggleFullscreen(): void {
  const host = document.getElementById('map-container');
  if (!host) return;
  if (document.fullscreenElement) document.exitFullscreen?.();
  else host.requestFullscreen?.();
}

function _createMirroredMapTexture(bounds: Bbox): THREE.CanvasTexture | null {
  const layerInfo = getActiveBaseLayerInfo();
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawTexturePlaceholder(ctx, canvas.width, canvas.height, layerInfo.name);
  const texture = _configureTerrainTexture(new THREE.CanvasTexture(canvas));

  const panel = document.getElementById('map3d');
  panel?.setAttribute('data-map-texture', 'loading');
  panel?.setAttribute('data-map-texture-loaded', '0');
  panel?.setAttribute('data-map-texture-total', '0');
  panel?.setAttribute('data-map-texture-downsampled', 'false');

  const serial = ++_textureSerial;
  const signal = _abortController?.signal;
  buildMapTileCanvas({
    bounds,
    zoom: map.getZoom(),
    layerInfo,
    signal,
    maxTextureSize: MAP_TEXTURE_MAX_SIZE,
  }).then(result => {
    if (signal?.aborted || serial !== _textureSerial) return;
    const mappedTexture = _configureTerrainTexture(new THREE.CanvasTexture(result.canvas));
    let applied = false;
    _root?.traverse?.(child => {
      const textured = child as THREE.Object3D & { material?: THREE.Material & { map?: THREE.Texture; needsUpdate?: boolean } };
      if (textured.material?.map !== texture) return;
      textured.material.map = mappedTexture;
      textured.material.needsUpdate = true;
      applied = true;
    });
    if (applied) texture.dispose();
    else mappedTexture.dispose();
    panel?.setAttribute('data-map-texture-loaded', String(result.loaded));
    panel?.setAttribute('data-map-texture-total', String(result.total));
    panel?.setAttribute('data-map-texture-size', `${result.canvas.width}x${result.canvas.height}`);
    panel?.setAttribute('data-map-texture-zoom', String(result.sourceZoom));
    panel?.setAttribute('data-map-texture-scale', result.layout.scale.toFixed(3));
    panel?.setAttribute('data-map-texture-downsampled', String(result.downsampled));
    if (result.loaded > 0) panel?.setAttribute('data-map-texture', layerInfo.name);
    else panel?.setAttribute('data-map-texture', 'fallback');
    if (_renderer && _scene && _camera) _renderer.render(_scene, _camera);
  }).catch((err: unknown) => {
    if (_isAbort(err)) return;
    console.warn('[3d] mirrored map texture failed:', err);
    _set3dStatus('3D terrain loaded, but matching map tiles could not be textured.', 'warning');
  });
  return texture;
}

function _configureTerrainTexture(texture: THREE.CanvasTexture): THREE.CanvasTexture {
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = Math.min(8, _renderer?.capabilities?.getMaxAnisotropy?.() ?? 1);
  texture.needsUpdate = true;
  return texture;
}

function _getViewportBounds(): Bbox | null {
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
