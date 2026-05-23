# MeshCore Mapper — Codebase Summary

_Last updated: May 2026._

---

## Architecture

Electron app. Main process (`main.js`) handles SQLite cache and file I/O.
Renderer process runs the UI: ES modules loaded from `app.js` via `<script type="module">`.
All IPC crosses via `contextBridge` in `preload.js`.

```
Main process:  main.js ──IPC──> preload.js ──contextBridge──> Renderer
Renderer:      app.js → src/*.js (ES modules)
Worker thread: src/coverageWorker.js (spawned by coverage.js per compute run)
```

---

## Module Map

| File | Responsibility |
|------|---------------|
| `app.js` | Entry point; calls `init()` on every feature module |
| `src/map.js` | Leaflet singleton, shared `state` (repeaters, layers), `clearCoverageLayers` |
| `src/ui.js` | Progress overlay, status bar text, `yieldToUI`, `escHtml` |
| `src/repeaters.js` | Add/edit/remove repeaters; map markers; undo-last-remove snapshot |
| `src/coverage.js` | Orchestrates coverage run: fetch elevations + foliage, spawn Worker, render overlay |
| `src/coverageWorker.js` | **Web Worker** — pure signal-computation inner loop (no DOM, no IPC) |
| `src/optimizerUI.js` | Draw search area, invoke `findBestLocations`, display results on map |
| `src/optimizer.js` | Pure grid-search optimizer; no DOM; greedy marginal-coverage, flat-Earth dist |
| `src/p2p.js` | P2P link budget panel; pick A→B on map; 64-sample elevation profile; full budget table |
| `src/config.js` | Save/load JSON config; screenshot via `capturePage()`; cache stats/purge |
| `src/devConsole.js` | Intercepts all `console.*` methods; renders timestamped rows in sidebar panel |
| `src/presets.js` | Loads `presets.yaml` via IPC; populates hardware + modem `<select>` elements |
| `src/elevation.js` | `fetchElevations()` — SRTM via open-elevation + opentopodata; SQLite bbox cache |
| `src/foliage.js` | `fetchFoliage()` — OSM polygons via Overpass; 8-entry mem cache + SQLite 30-day cache |
| `src/propagation.js` | Pure physics: `haversine`, `fspl`, `checkLoS` (ITU-R P.526-15 + Earth curvature), `bilinearElev`, `writePixel` (gradient) |
| `main.js` | SQLite (WAL, debounced save, integrity check); IPC handlers for cache + screenshot |
| `preload.js` | `contextBridge` — file dialogs, all cache IPC, screenshot |
| `index.html` | 4-tab sidebar layout: Nodes / Coverage / Tools / Settings |
| `style.css` | Dark theme, tab system, gradient legend, DevConsole styles |
| `presets.yaml` | Hardware + modem presets; extend without code changes |

---

## Data Flow — Coverage Computation

```
User clicks "Compute Coverage"
  → coverage.js: read UI settings
  → fetchElevations(TX point)              [elevation.js → IPC → SQLite or API]
  → fetchElevations(ELEV_RES × ELEV_RES grid)  [same path, bbox cache hit likely]
  → fetchFoliage(bbox)                     [foliage.js → mem cache / SQLite / Overpass]
  → new Worker(coverageWorker.js)
      receives: gridLats/gridLons/gridElevs (ArrayBuffer transfer), rep, foliageData
      for each grid point:
        flat-Earth dist → FSPL
        bilinearElev → terrain profile
        checkLoS → diffractionLossDb (ITU-R P.526-15; Earth curvature k=4/3)
        foliageLossDb → canopy traversal attenuation
        → signalGrid[idx]
      postMessage { type:'done', signalGrid } (ArrayBuffer transfer back)
  → coverage.js: writePixel gradient → canvas → ImageOverlay on Leaflet map
```

---

## SQLite Cache (`cache.db` in Electron userData)

| Table | Key | Value | Notes |
|-------|-----|-------|-------|
| `elevations` | `(lat REAL, lon REAL)` | `elev REAL` | SRTM 30m, rounded to 4 dp (~11m grid) |
| `foliage_cache` | `bbox_key TEXT` | `data TEXT (JSON)` | OSM polygons; 30-day TTL |

- **Journal mode:** WAL (`PRAGMA journal_mode=WAL`)  
- **Save strategy:** debounced 2 s after each store; flushed synchronously on `before-quit`  
- **Load:** integrity check on startup; resets to empty DB if corrupt  
- **Elevation lookup:** single bbox SQL query (`BETWEEN`) instead of N per-point queries  

---

## Physics Models

| Model | Implementation |
|-------|---------------|
| Free-space path loss | `20·log10(d_m) + 20·log10(f_Hz) − 147.55` |
| Terrain diffraction | Fresnel-Kirchhoff single dominant edge, ITU-R P.526-15 continuous approximation |
| Earth curvature | `d1·d2 / (2 · Re_eff)` bulge added per sample; Re_eff = 6371 × 4/3 km |
| Foliage attenuation | Configurable dB/m × traversal depth; height-aware (ray vs canopy top); per-type factors |
| Signal gradient | 5-stop linear interpolation over 50 dB range above sensitivity threshold |

---

## Key Conventions

- All modules export `init()` registered in `app.js`.
- No module accesses `window.electronAPI` except `elevation.js`, `foliage.js`, `config.js`, `presets.js`.
- `propagation.js` and `coverageWorker.js` are pure — safe to import in Workers.
- `state.repeaters` elements: `{ id, name, lat, lon, height, power, freq, gain, marker, color }`.
- CSS custom property `--sidebar-w` drives sidebar width; drag handle writes it directly.
- DevConsole is initialised in `app.js` before all other modules so it captures early logs.
