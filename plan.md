# MeshCore Mapper — Plan

Last reviewed: May 2026.

---

## Active

*(add new items here when work is in progress)*

---

## Backlog

rework map into 3D — needs scope clarification (Cesium? Mapbox GL? deck.gl overlay?). Major renderer change.
get existing repeaters for meshcore from web, cache and show on map layer — needs MeshCore public API endpoint URL.

---

## Done (summary)

| ID | What | How |
|----|------|-----|
| B1–B4 | Bug fixes (gain, foliage clear, multi-repeater cache, preset stale) | Various |
| A1–A3 | Architecture fixes (globals→delegation, storage key migration, elevation fallback) | Various |
| P1–P11 | Performance (pre-alloc, spatial index, flat-Earth dist, FSPL hoist, λ cache, typed arrays, batch SQL) | Various |
| P12 | Adaptive elevation resolution | `ELEV_RES = min(ceil(radiusKm×2000/150), 256)` in `coverage.js` |
| U1–U6 | UX (edit highlight, foliage toggle, clear coverage, preset sync, copy-to-optimizer, optimizer presets) | Various |
| F1 | Screenshot export | `capturePage()` → Save dialog in Configuration panel |
| F2 | P2P link budget panel | `src/p2p.js` — pick A→B, full link budget table |
| F4 | Cache management | Stats + purge buttons in Configuration panel |
| F5 | Undo last remove | Single-level snapshot in `repeaters.js` |
| F6 | Drag-to-resize sidebar | CSS `--sidebar-w` var + 5 px drag handle |
| Tabs UI | Sidebar reworked into 4 tabs (Nodes / Coverage / Tools / Settings) | `index.html`, `style.css` |
| Gradient overlay | Continuous 5-stop gradient replaces 4 flat colour buckets | `propagation.js writePixel` |
| DB fixes | WAL mode, debounced save, integrity check on load, cheap stats, dead handler removed | `main.js`, `preload.js` |
| Verbose logging | `console.info/debug` added to coverage, elevation, foliage, optimizer, p2p | 5 src files |
| Bug fixes | Dead `signalToRGBA` removed; `dc-log`/`dc-debug` CSS added | `propagation.js`, `style.css` |
| Earth curvature | k = 4/3 effective Earth radius bulge in `checkLoS` | `propagation.js` |
| Web Worker | Coverage inner loop moved to `coverageWorker.js`; main thread stays responsive | `coverage.js`, new `coverageWorker.js` |
| README + docs | README rewritten; `summary.md` created | `README.md`, `summary.md` |
| Repeater visibility | Per-repeater 👁 toggle hides marker + coverage overlay | `repeaters.js`, `coverage.js`, `style.css` |
| Repeater → P2P | Clicking repeater marker in pick mode sets it as TX point A/B | `p2p.js`, `repeaters.js` |
| P2P terrain profile | SVG cross-section with Fresnel zone + obstruction highlight | `p2p.js` |
| P2P diffraction fix | Separate geometric LoS vs Fresnel zone rows; correct ITU-R P.526 v calculation | `p2p.js` |
| Building detection | `buildings.js` — Overpass fetch, SQLite cache (30d TTL), `buildingLossDb()` | `src/buildings.js`, `main.js`, `preload.js` |
| Building map layer | Filled building footprints on map, height-coded color, togglable | `coverage.js`, `map.js`, `index.html` |
| Building propagation | Building attenuation wired into Web Worker alongside foliage | `coverageWorker.js` |
| Foliage filled render | Foliage polygons now filled (semi-transparent green) not just outlines | `coverage.js` |
