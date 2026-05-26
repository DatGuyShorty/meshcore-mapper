# MeshCore Mapper - Codebase Summary

_Last updated: 25 May 2026._

## Purpose

MeshCore Mapper is an Electron desktop application for planning LoRa/mesh repeater coverage with realistic terrain, foliage, and building attenuation. It supports repeater placement, coverage heatmaps, point-to-point link budgets, and greedy placement optimization.

## Architecture

The app is split between an Electron main process and a renderer process:

- Main process: `main.js` handles lifecycle, creates `cache.db`, and registers IPC handlers.
- Renderer process: `app.js` loads the UI and feature modules in `src/`.
- Preload bridge: `preload.js` exposes `window.electronAPI` for safe IPC access.
- Compute backend: `scripts/cuda_coverage.py` provides CUDA-accelerated coverage/optimizer compute; JS Web Worker fallback is used otherwise.

```
Electron main  -> `main.js` -> `src/main/*` + `preload.js`
Renderer       -> `app.js` -> `src/*.js`
Compute        -> Python CUDA helper or JS Web Workers
```

## Startup and tooling

- `npm start` launches Electron.
- `npm run app` / `npm run setup` run `start-app.ps1` on Windows to install dependencies and provision Python CUDA support.
- `requirements-cuda.txt` lists Python CUDA helper dependencies.
- `npm run syntax` validates JS syntax.
- `npm run lint` runs ESLint.
- `npm test` runs Vitest unit tests.
- `npm run smoke` runs Playwright smoke tests.
- `npm run check` executes syntax, lint, tests, audit, and smoke.

## Major modules

### App shell

- `app.js` — renderer entry point that initializes feature modules in a fixed startup order and awaits preset loading.
- `index.html` — tabbed sidebar UI with dedicated panels for Nodes, Map, Coverage, Planning, and Settings.
- `style.css` — dark app theme, context menus, status indicators, tab panels, and mobile-friendly button layout.
- `src/ui.js` — status bar, progress overlay, cancellation handlers, button busy states, and shared DOM utilities.
- `src/map.js` — central Leaflet map instance, shared application state, coverage/obstacle layer management, marker and tile cleanup.
- `src/mapAdapter.js` — map viewport metrics, overlay tile placement, zoom-aware rendering, and viewport change hooks.
- `src/mapLayers.js` — base layer switching plus foliage/building/barrier overlay management, viewport-aware fetch, manual/auto refresh, abortable loads, and canvas polygon rendering.
- `src/map3d.js` — optional 3D terrain scene using Three.js, interactive camera controls, viewport syncing, dynamic terrain mesh refresh, node/link overlays, and building/foliage obstruction rendering.
- `src/mapContext.js` — coordinate transforms, map event wiring, and app-level map context events.
- `src/mapTileTexture.js` — image tile texture generation for higher-performance coverage overlay rendering.
- `src/terrain3dModel.js` — terrain tile grid utilities, lat/lon-to-meter projection, mesh generation, and 3D terrain coloring.
- `src/terrainProfileView.js` — SVG terrain profile rendering with obstruction bands, Fresnel/FoV overlays, and path annotations.

### Repeater and planning

- `src/repeaters.js` — add/edit repeater dialog, map click placement, marker drag, inline list rendering, visibility toggle, sort/filter, undo last removal, live WebSocket feed sync, and per-node context menu actions for info, P2P, coverage, optimization, and pathfinding.
  - Supports manual coordinate input and map-click placement.
  - Uses a reusable SVG marker icon palette and marker popups showing TX/antenna metadata.
  - Live WS feed accepts array payloads or Node-RED `{payload:[...]}` wrappers and persists WS nodes in SQLite.
  - WS sync updates existing nodes by key, removes stale feed nodes, and keeps manual undo state intact.
- `src/p2p.js` — point-to-point pick mode with draggable endpoint pins, a polyline overlay, real-time margin updates, and map callbacks for repeater selection.
  - Binds click events to repeater markers to start P2P picking from a node.
  - Keeps link state in `state.p2pLinks` for map rendering.
- `src/linkBudget.js` — calculates path loss, received power, link margin, diffraction, foliage, building loss, and optional Monte Carlo outage.
- `src/optimizerUI.js` — draw-mode rectangle selection, area bounds generation, candidate/evaluation grid creation, backend scoring, and result rendering.
  - Supports direct “Optimize Here” from a repeater context menu, building a centered search rectangle automatically.
  - Adds suggested location markers and list items with “Add as repeater” buttons.
  - Uses cancelable optimizer runs with progress updates.
- `src/optimizer.js` — grid-based candidate generation, terrain requirement checks, and greedy scoring of the best repeater placements.
- `src/optimizerBackend.js` — CUDA-first optimizer backend selection, progress reporting, and CPU worker fallback.
- `src/optimizerWorker.js` — worker-thread optimizer scoring using pure signal model loops and incremental coverage evaluation.
- `src/pathfinder.js` — radius-limited relay path search, projection of terrain profiles, and best-node path ranking by margin and hop count.
- `src/pathfinderUI.js` — planning tab relay path UI, repeater pick mode, source/destination selectors, and path rendering overlay.
- `src/config.js` — persistent app settings and node save/load, screenshot export, cache warming, and DB purge actions.
  - Config export includes both settings and repeater definitions.
  - Load protects invalid coordinates and preserves working UI state.
  - Offers warm-cache tooling: fetch terrain and obstacle tiles for the current viewport into local caches.
- `src/settings.js`, `src/settingsPersistence.js` — bind settings UI controls to persisted values, support legacy storage keys, and read/write shared persisted settings.
- `src/requestScheduler.js` — host-aware queued fetch scheduler used for OpenTopoData, OpenElevation, Overpass, and DEM tile requests.
- `src/signalModel.js` — low-level signal-to-point computation, terrain profile sampling, antenna pattern offsets, and combined obstacle loss evaluation.
- `src/signalOverlay.js` — coverage overlay mode mapping for margin, RSSI, and SNR with separate gradient palettes.
- `src/radioMetrics.js` — LoRa spreading factor inference, required SNR lookup, and derived noise floor metrics.
- `src/devConsole.js` — developer log panel with console interception.
- `src/presets.js` — loads `presets.yaml` from the main process and populates radio/antenna dropdowns.

### Coverage, propagation, and obstacles

- `src/coverage.js` — coverage orchestration, active node selection, dynamic grid sizing, elevation and obstacle payload preparation, backend compute, directional masking, and overlay tile rendering.
  - Dynamically derives grid resolution from map zoom and search radius.
  - Profiles grid elevation resolution and sample spacing for terrain profiles.
  - Provides per-node compute slices and combined progress reporting with ETA.
- `src/coverageBackend.js` — detects CUDA availability, chooses GPU-first or CPU fallback, forwards progress events, handles aborts, and validates returned buffers.
- `src/coverageWorkerPool.js` — creates a cancelable CPU worker pool, splits coverage rows into bands, and aggregates signals and RGBA output.
- `src/coverageWorker.js` — DOM-free coverage calculations for worker threads, signal evaluation, and environment-safe math.
- `src/coverageGrid.js` — computes coverage bounding boxes, elevation grid shapes, and helper functions for grid geometry.
- `src/coveragePoint.js` — per-grid point coverage helpers, including point-in-view and interpolation utilities.
- `src/propagation.js` — RF math: haversine distance, FSPL, 4/3 Earth curvature, Fresnel clearance, geometric and Deygout diffraction, antenna pattern offsets, shadow fading, bilinear elevation interpolation, polygon segment sampling, and RGBA heatmap colorization.
- `src/elevation.js` — multi-tier elevation retrieval using in-memory caching, SQLite point caching, DEM tile raster sampling, and API fallback.
  - Rounds lat/lon to 4-decimal precision for point cache keys.
  - Samples terrain from terrarium DEM tiles before falling back to open-elevation/opentopodata.
  - Keeps an in-memory LRU cache and a tile cache for repeated terrain requests.
- `src/foliage.js` — OSM vegetation fetch and signal attenuation model.
  - Caches foliage by 0.25° tiles and deduplicates across repeaters.
  - Classifies OSM tags into forest, wood, scrub, orchard, hedge, and other vegetation types.
  - Derives canopy heights from DSM-DEM datasets when enabled.
  - Builds a 16×16 tile spatial index and computes attenuation only where the ray passes below canopy top.
- `src/buildings.js` — OSM building fetch and building-loss model.
  - Caches building footprints by 0.25° tiles.
  - Infers heights from OSM tags, building types, roof shapes, floors, or DSM-DEM when enabled.
  - Supports building footprints, walls, barriers, and other man-made structures.
  - Computes loss for path segments passing through building polygons and adds wall-crossing penalty.
- `src/signalOverlay.js`, `src/signalModel.js`, `src/radioMetrics.js` — coverage color mapping, signal legend, modem metric derivations, sensitivity/fade calculations, and modem text rendering.
- `src/scenarios.js` — scenario application helpers used for preconfigured analysis or UI presets.

### Main-process support

- `src/main/cacheDb.js` — manages `cache.db` with `sql.js` (in-memory WASM SQLite), full `db.export()` writes debounced 2 s, and integrity checking on load. (WAL/synchronous pragmas are set but have no effect on the in-memory database.)
- `src/main/ipcHandlers.js` — IPC for file save/open, presets, screenshots, SQLite cache lookup/store, cache stats, purge operations, and WebSocket node persistence.
- `src/main/window.js` — creates the Electron browser window, loads `index.html`, and wires F12 DevTools toggle.
- `src/main/cudaCoverage.js` — Python CUDA probe/compute/optimizer IPC, temp-file payload orchestration, payload validation, cancellation, and progress events.
- `preload.js` — exposes `window.electronAPI` for file I/O, cache access, CUDA compute, progress subscriptions, screenshot export, and WS persistence.
- `scripts/cuda_coverage.py` — Python entrypoint for the `meshcore_cuda` helper package.
- `scripts/meshcore_cuda/engine.py` — CUDA backend implementation using CuPy, obstacle packing, kernel launch, and progress reporting.

## Coverage compute flow

1. Coverage analysis starts from the Coverage tab or a repeater context menu.
2. `coverage.js` selects visible repeaters, derives grid resolution from map zoom, and computes analysis radius bounds.
3. It builds a union bounding box over active repeaters and fetches obstacle payloads for foliage and buildings if enabled.
4. Terrain elevation is fetched in two stages:
   - TX elevation is resolved through the point cache / SQLite / DEM tile / API pipeline.
   - Grid elevations are sampled from DEM raster tiles first, with an API fallback for missing tiles.
5. Compute payloads include grid elevations, repeater metadata, effective sensitivity, sectional profile spacing, and obstacle tile payloads.
6. `coverageBackend.js` resolves `auto`, `cuda`, or `cpu` preference, probes CUDA availability, and preserves cancellation via `AbortController`.
7. The selected backend returns `Uint8ClampedArray` RGBA and `Float32Array` signal grid buffers, which are validated for expected length.
8. Coverage overlay tiles are generated from RGBA data and added to Leaflet with opacity control.

## Backend selection and CUDA

- CUDA is preferred when available (`auto` mode) and can be forced or disabled.
- `src/main/cudaCoverage.js` uses the Python helper for probe, compute, and optimizer workloads.
- Temporary float32 and JSON files carry payloads and outputs between Node and Python.
- The backend validates grid sizes, obstacle payloads, and candidate counts.
- Optimizer backend selection is mirrored in `src/optimizerBackend.js` with a CPU worker fallback.

## Cache and persistence

- Persistent cache is stored in `cache.db` under Electron `userData`.
- Tables:
  - `elevations`
  - `dem_tiles`
  - `foliage_cache`
  - `buildings_cache`
  - `ws_repeaters`
- `cache.db` is loaded into memory at startup (`sql.js`) and rewritten as a whole file on a 2 s debounced timer; WAL/journal pragmas are nominal only.
- UI provides cache statistics, per-table purge, and `VACUUM`.
- Live WebSocket repeater data is persisted and restored on startup.
- User UI settings are persisted via `localStorage` under `meshcoreMapper_settings`.
- Radio/hardware presets are defined in `presets.yaml` and loaded dynamically.

## Physics model summary

- FSPL: `20 * log10(d_m) + 20 * log10(f_Hz) - 147.55`
- Effective EIRP: `TX Power + Antenna Gain`
- Terrain diffraction: Fresnel-Kirchhoff ν with Deygout multi-edge knife-edge approximation.
- Earth curvature: 4/3 effective Earth radius correction.
- Foliage loss: configurable dB/m through OSM vegetation polygons, height-aware and capped.
- Building loss: attenuation through OSM building footprints.
- Coverage threshold: receiver sensitivity + fade margin.

## Features

### Nodes tab

- Add repeaters by form or by clicking the map, with draggable markers and marker popups showing TX power, antenna gain, frequency, and height.
- Inline repeater list supports filter-by-text and sorting by name.
- Toggle node visibility to exclude repeaters from coverage compute while keeping them in the node list.
- Right-click context menu on markers offers Info, P2P Link, Edit, Hide/Show, Run Coverage, Optimize Here, Best Path From..., and Remove.
- Undo last remove (F5) restores the most recently deleted repeater.
- WebSocket live feed connects to a remote source, imports repeater rows, syncs updates, removes stale feed nodes, and persists WS nodes in SQLite.

### Coverage tab

- Continuous RGBA heatmap overlay spans a 50 dB range above the receiver threshold and blends smoothly between red/orange/yellow/green.
- Grid resolution is derived from map zoom and analysis radius, with automatic clamping to avoid runaway memory usage.
- Terrain profiles are built from DEM raster tiles or API-sourced elevation points, plus a TX site elevation lookup.
- Link calculations incorporate free-space path loss, Fresnel or geometric LoS, and optional Deygout multi-edge diffraction.
- Foliage attenuation uses OSM vegetation polygons, canopy heights, tile-based cache, and height-aware ray intersection.
- Building attenuation uses OSM building footprints, walls/barriers, inferred heights, line-of-sight blockage, and wall/crossing penalties.
- Directional masking option can limit coverage to a subsector by bearing.
- Coverage compute reports progress by node slice, obstacle fetch progress, backend progress, and ETA.

### Planning tab

- Draw a rectangular search area on the map to define optimization bounds.
- “Optimize Here” builds a search rectangle centered on an existing repeater.
- Optimizer builds an evaluation grid and candidate grid using settings-specified resolutions.
- Fetches elevations for all candidate and evaluation points, optionally fetches foliage/buildings, and runs scoring on CUDA or CPU.
- Renders ranked suggested locations as numbered markers and list items, with “Add as repeater” buttons.
- Best-relay path search finds a multi-hop route through repeaters, ranks it by bottleneck margin and hop count, and renders path lines with per-hop tooltips.

### Point-to-point / link budget

- Supports picking two endpoints on the map, dragging endpoints to refine the line, and preserving source/repeater references.
- Computes distance, free-space loss, diffraction loss, foliage loss, building loss, total received power, and margin.
- Renders a tabbed results panel with budget details and terrain profile SVG.
- Fullscreen profile export is supported.
- Line color updates by margin and result severity.

### Settings tab and persistence

- Save/load project configuration JSON that includes repeater list and all persisted settings.
- Screenshot export captures the current map view via Electron page capture.
- Cache stats show counts for elevations, DEM tiles, foliage tiles, buildings tiles, and DB size.
- Cache controls purge elevations, DEM tiles, foliage, buildings, WS nodes, or the entire DB followed by VACUUM.
- Viewport cache warming pre-fetches terrain and obstacle data for the current map view.
- Developer console tab captures `console.log/warn/error/debug` inside the app.
- Presets are loaded from `presets.yaml` and populate radio and antenna dropdowns dynamically.

### Map and UI

- Multiple basemap options: OSM Streets, Esri Satellite, OpenTopoMap.
- Layer panel supports foliage and building/barrier overlay rendering with auto-refresh, manual refresh, cancelable loads, and opacity sliders.
- Optional 3D terrain view renders a Three.js mesh of the current viewport with dynamic terrain, node markers, link overlays, and obstructing buildings/foliage.
- Sidebar width is resizable and persisted.
- Status bar, inline status messages, progress overlays, and cancel buttons coordinate compute jobs.

## Testing and quality

- `tests/unit/` contains Vitest unit tests covering backend, coverage, foliage, buildings, optimizer, propagation, repeaters, and settings.
- `tests/smoke/` contains Playwright smoke tests for Electron startup and basic flows.
- `scripts/check-syntax.mjs` provides JavaScript syntax validation.

## Notes

- The codebase is modular and feature-driven: new UI features are typically added as `src/*` modules exposing `init()`.
- The app is designed to separate DOM/UI code from physics and compute logic.
- CUDA support is optional and gracefully falls back to CPU workers.
- `presets.yaml` is the main external configuration source for hardware/modem presets.
