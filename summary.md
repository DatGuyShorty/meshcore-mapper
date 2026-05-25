# MeshCore Mapper - Codebase Summary

_Last updated: May 2026._

## Architecture

Electron app. The main process owns SQLite cache, file I/O, screenshots, and the Python CUDA helper IPC. The renderer process runs the UI as ES modules loaded from `app.js`.

```
Main process:  main.js -> preload.js -> Renderer
Renderer:      app.js -> src/*.js
Compute:       Python CUDA helper when available, CPU worker pool fallback
```

## Module Map

| File | Responsibility |
|------|----------------|
| `app.js` | Entry point; calls `init()` on feature modules |
| `src/map.js` | Leaflet singleton, shared `state`, coverage/obstacle layer cleanup |
| `src/mapAdapter.js` | Thin map abstraction for viewport metrics and coverage overlay tiles |
| `src/ui.js` | Progress overlay, status bar text, inline status, `yieldToUI`, `escHtml` |
| `src/repeaters.js` | Repeater CRUD, markers, undo-last-remove, WebSocket node sync |
| `src/coverage.js` | Coverage orchestration: fetch elevations/obstacles, run backend, render overlay |
| `src/coverageBackend.js` | CUDA-first coverage backend selection with CPU-worker fallback |
| `src/coverageGrid.js` | Shared coverage bbox and terrain-grid helpers |
| `src/coverageWorkerPool.js` | Splits CPU coverage work into row bands and aggregates progress/results |
| `src/coverageWorker.js` | CPU worker signal-computation inner loop |
| `src/optimizerUI.js` | Draw search area, run optimizer backend, display results |
| `src/optimizerBackend.js` | CUDA-first optimizer backend selection with CPU-worker fallback |
| `src/optimizer.js` | Pure optimizer helpers, including terrain requirement checks and grid generation |
| `src/p2p.js` | P2P link budget panel and map picking UI |
| `src/pathfinder.js` | Best relay path search through repeater graph |
| `src/config.js` | Save/load JSON config, settings persistence, screenshot, cache stats/purge |
| `src/settingsPersistence.js` | Safe persisted-setting read/write and change binding helpers |
| `src/devConsole.js` | In-app console panel |
| `src/presets.js` | Loads `presets.yaml` and populates radio/modem selects |
| `src/elevation.js` | SRTM DEM tile and API elevation fetch/caching |
| `src/foliage.js` | OSM vegetation fetch/cache/indexing and foliage loss helpers |
| `src/buildings.js` | OSM building fetch/cache/indexing and building loss helpers |
| `src/propagation.js` | Pure RF physics: FSPL, LoS/diffraction, interpolation, coverage color |
| `src/main/cudaCoverage.js` | Electron IPC handlers for CUDA probe, coverage, optimizer, and cancellation |
| `preload.js` | `contextBridge` API exposed to renderer |
| `index.html` | 5-tab sidebar layout: Nodes / Map / Coverage / Planning / Settings |
| `style.css` | Dark UI, tab system, map legend, panels, context menus |
| `presets.yaml` | Hardware and modem presets |

## Coverage Data Flow

```
User clicks "Compute Coverage"
  -> coverage.js reads UI settings
  -> fetch TX elevation and DEM terrain grid
  -> fetch shared foliage/building payloads when enabled
  -> computeCoverage()
       auto / CUDA preferred: Python CUDA helper via Electron IPC
       fallback / CPU selected: coverageWorkerPool row-band workers
       per grid point:
         FSPL + terrain diffraction + optional obstacle attenuation
         writePixel -> RGBA coverage buffer
  -> coverage.js tiles RGBA buffer into Leaflet image overlays
```

## Cache Notes

SQLite cache lives in Electron `userData` as `cache.db`.

| Data | Notes |
|------|-------|
| Elevation points | Rounded point cache plus DEM tile cache |
| Foliage tiles | OSM vegetation polygons, tile-based TTL cache |
| Building tiles | OSM building footprints/heights, tile-based TTL cache |
| WebSocket nodes | Persisted live-feed nodes |

The cache uses WAL mode, debounced saves, startup integrity checks, and purge/VACUUM controls in Settings.

## Physics Models

| Model | Implementation |
|-------|----------------|
| Free-space path loss | `20*log10(d_m) + 20*log10(f_Hz) - 147.55` |
| Terrain diffraction | Fresnel-Kirchhoff ν with Deygout multi-edge diffraction and ITU-R P.526-style knife-edge loss |
| Earth curvature | `d1*d2 / (2*Re_eff)` bulge, with `Re_eff = 6371*4/3 km` |
| Foliage attenuation | Configurable dB/m traversal loss capped by vegetation model; height-aware |
| Building attenuation | Configurable dB/m traversal loss through indexed footprints |
| Coverage threshold | Receiver sensitivity plus required fade margin |

## Key Conventions

- Feature modules export `init()` and are registered from `app.js`.
- Backend selection is CUDA-first by default, with CPU fallback for unavailable or unsupported CUDA payloads.
- IPC access stays in data/backend boundary modules: elevation, obstacle fetchers, config, presets, repeaters, and CUDA handlers.
- `propagation.js`, `coverageWorker.js`, and optimizer worker code stay DOM-free.
- `state.repeaters` elements carry `id`, radio parameters, visibility, marker, and color.
- CSS custom property `--sidebar-w` drives sidebar width.
- F12 opens Chromium DevTools; the in-app console mirrors runtime logs.
