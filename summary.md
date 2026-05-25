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

- `app.js` — renderer entry point that initializes feature modules.
- `index.html` — sidebar layout with Nodes, Map, Coverage, Planning, and Settings tabs.
- `style.css` — dark UI theme, map legend, tab styles, context menu, and resize handle.
- `src/ui.js` — global UI helpers, status overlay, and DOM utilities.
- `src/map.js` — Leaflet singleton, map state, and layer cleanup.
- `src/mapAdapter.js` — viewport measurement and tile mapping helpers.
- `src/mapLayers.js` — base map and overlay layer management.
- `src/map3d.js` — 3D map rendering support using `three`.
- `src/mapContext.js` — map interaction and context synchronization.
- `src/mapTileTexture.js` — texture creation for map overlays.

### Repeater and planning

- `src/repeaters.js` — repeater CRUD, draggable markers, undo, visibility toggles, WS feed import, filter/sort, context menu.
- `src/p2p.js` — P2P endpoint picking, drag-able pins, line rendering, and state updates.
- `src/linkBudget.js` — path loss, Rx power, margin, and profile metrics.
- `src/optimizerUI.js` — draw search area, run optimizer, render results.
- `src/optimizer.js` — greedy placement search.
- `src/pathfinder.js`, `src/pathfinderUI.js` — best path search and UI integration.
- `src/config.js` — save/load config, screenshot export, cache stats and purge.
- `src/settings.js`, `src/settingsPersistence.js` — persisted user settings.
- `src/devConsole.js` — in-app developer console that captures console output.
- `src/presets.js` — loads `presets.yaml` via IPC and populates preset dropdowns.

### Coverage, propagation, and obstacles

- `src/coverage.js` — orchestrates coverage computation and rendering.
- `src/coverageBackend.js` — selects CUDA or CPU computing backend and handles cancellation.
- `src/coverageWorkerPool.js` — row-band CPU worker orchestration.
- `src/coverageWorker.js` — DOM-free CPU coverage computation.
- `src/coverageGrid.js` — shared terrain grid and bounding-box helpers.
- `src/coveragePoint.js` — per-grid point coverage helpers.
- `src/propagation.js` — RF physics utilities: FSPL, LoS, diffraction, interpolation, and color scaling.
- `src/elevation.js` — elevation API fetch, SRTM DEM tile cache, and SQLite point cache.
- `src/foliage.js` — OSM vegetation fetch, tile cache, spatial index, and foliage attenuation.
- `src/buildings.js` — OSM building footprint fetch, cache, and building attenuation.
- `src/signalOverlay.js`, `src/signalModel.js`, `src/radioMetrics.js` — signal display and metric helpers.
- `src/scenarios.js` — scenario-related helpers for saved states or test data.

### Main-process support

- `src/main/cacheDb.js` — creates and manages `cache.db` using `sql.js`, WAL mode, debounced saves, and integrity checks.
- `src/main/ipcHandlers.js` — IPC for config I/O, presets, screenshot export, SQLite cache CRUD, cache stats and purge, and WebSocket repeater persistence.
- `src/main/cudaCoverage.js` — Python CUDA probe/compute/optimizer handlers, payload validation, temp file orchestration, progress events, and cancellation.

## Coverage compute flow

1. UI triggers coverage analysis.
2. `coverage.js` builds the payload and loads terrain, foliage, and building data.
3. Elevation data is fetched from open-elevation or opentopodata and cached in SQLite.
4. Foliage and building obstacles are fetched from OSM and cached per 0.25° tile.
5. `coverageBackend.js` chooses between CUDA and CPU.
6. CUDA path uses `scripts/cuda_coverage.py` via IPC; CPU path uses `coverageWorkerPool.js` workers.
7. Results are validated and rendered as an RGBA heatmap overlay.

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
- The cache uses WAL mode and `PRAGMA synchronous=NORMAL`.
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

- Nodes tab: manual/repeater placement, draggable markers, live WS feed, undo remove, filter/sort, hide/show, context menu actions.
- Coverage tab: continuous heatmap gradient, terrain LoS, Fresnel and Deygout diffraction, foliage/building overlays, adaptive resolution, shared tile caching.
- Planning tab: greedy best-location optimizer and point-to-point link budget analysis with terrain profile.
- Settings tab: save/load config, screenshot export, cache cleanup, developer console.
- Multi-basemap support: OSM Streets, Esri Satellite, OpenTopoMap.

## Testing and quality

- `tests/unit/` contains Vitest unit tests covering backend, coverage, foliage, buildings, optimizer, propagation, repeaters, and settings.
- `tests/smoke/` contains Playwright smoke tests for Electron startup and basic flows.
- `scripts/check-syntax.mjs` provides JavaScript syntax validation.

## Notes

- The codebase is modular and feature-driven: new UI features are typically added as `src/*` modules exposing `init()`.
- The app is designed to separate DOM/UI code from physics and compute logic.
- CUDA support is optional and gracefully falls back to CPU workers.
- `presets.yaml` is the main external configuration source for hardware/modem presets.
