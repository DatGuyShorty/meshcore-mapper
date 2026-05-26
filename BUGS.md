# BUGS

This file collects the potential bugs discovered during the current review of the repository.

## Cache and reuse
- `src/buildings.js` / `src/foliage.js`: in-memory tile caches are capped with FIFO eviction, not true LRU, so recently used hot tiles can be evicted prematurely.
- `src/elevation.js`: point cache uses 4-decimal rounding while `fetchElevationsFromTiles()` checks the in-memory cache with 6-decimal rounding, causing cross-path cache misses.
- `src/main/cacheDb.js`: tile TTL cleanup is only enforced at lookup; stale OSM cache rows are not cleaned up elsewhere.

## OpenStreetMap / Overpass
- `src/buildings.js`: Overpass query does not request node-level building features such as `node["building"]` and `node["building:part"]`.
- `src/buildings.js`: relation processing ignores `inner` members, so holes in multipolygon buildings are not modeled.
- `src/buildings.js` / `src/foliage.js`: tile bbox loops assume `lonMin <= lonMax` and do not handle antimeridian-crossing bounds.
- `src/foliage.js`: relation member assembly still does not explicitly support holes.

## Input validation / grid generation
- `src/config.js`: `loadConfig()` reports the count of `config.repeaters` from the file even when some entries are skipped for invalid coords or malformed repeater data.
- `src/signalModel.js`: `computeSignalToPoint()` does not validate TX/RX coordinates or computed distance, so invalid inputs can produce NaN signal values and corrupt later scoring or link-budget results.

## Elevation / path sampling
- `src/elevation.js`: `fetchElevationsFromTiles()` bypasses the point DB entirely, which is a design choice but means point cache reuse is not leveraged for large raster queries.
- `src/elevation.js`: `_fillNulls()` silently forward/backfills missing API elevation results, which can mask data gaps and produce incorrect terrain values.

## Coverage / rendering
- `src/coverage.js`: obstacle fetch failures are logged and skipped, but there is no strong user-facing signal that foliage/building losses were omitted from the coverage result.

## 3D terrain / visualization
- `src/map3d.js`: switching off 3D mode leaves the renderer, scene, and resize observer alive, which can retain stale state and keep hidden resources active.
- `src/map3d.js`: `_createMirroredMapTexture()` builds a full tile request list for viewport bounds even when the final texture is downscaled, causing unnecessary tile loads for large, low-zoom views.
- `src/mapTileTexture.js`: `tileTextureLayout()` does not handle antimeridian-crossing bounds, so bounds spanning the ±180° meridian can yield incorrect tile ranges or layout dimensions.
- `src/terrain3dModel.js`: `sampleTerrainElevation()` does not clamp interpolation weights for out-of-bounds coordinates, allowing extrapolated elevations when sampling slightly outside the terrain grid.

## Miscellaneous
- `src/linkBudget.js`: fallback noise/SNR values are derived from `result.effectiveSens` when certain metadata is missing, which may produce misleading link-budget outputs instead of failing earlier.
- `src/repeaters.js`: live WebSocket feed sync treats an empty incoming node list as an instruction to remove all WS repeaters, which may purge nodes during a transient feed glitch.
- `src/repeaters.js`: `_wsKeyForRow()` may collapse distinct live feed rows into the same key when rows share the same coordinates, which can hide duplicate WS sources or incorrectly merge entries.
- `src/repeaters.js`: `setEditMode()` assumes a repeater exists and can throw if called with an invalid ID, which can happen during stale UI interactions.
- `src/main/cudaCoverage.js`: Python CUDA helper stdout parsing is brittle; any stray non-JSON output can cause the backend to fail even when the helper otherwise completes successfully.

## Resolved in current cleanup pass
- `src/foliage.js`: large same-id multipolygon fragments from different OSM tiles could be deduped away; fixed by geometry-aware dedupe and shared OSM geometry helpers.
- `src/foliage.js`: node-based hedges are now queried.
- `src/buildings.js`: split relation outer members are now assembled consistently with foliage.
- `src/buildings.js`: explicit `building:height` is parsed.
- `src/settings.js` / `src/optimizer.js`: optimizer candidate resolution is clamped and `buildGrid()` handles low values without NaN coordinates.
- `src/coveragePoint.js`: coverage inspection now skips invalid radius metadata.
- `src/terrainProfileView.js`: degenerate profiles now render finite SVG.
- `src/main/ipcHandlers.js`: cache stats count only fresh foliage/building rows.
- `src/map3d.js`: the 3D render loop is stopped when returning to 2D mode.
- `index.html`: sidebar width is now persisted to `localStorage`.
- `src/settings.js`: barrier layer controls are now included in persisted map-layer settings.

## Documentation / summary inconsistencies
- `src/mapTileTexture.js`: `summary.md` describes it as a higher-performance coverage overlay renderer, but in practice it is only used for 3D terrain map texturing in `src/map3d.js`.
- `src/repeaters.js`: `summary.md` says live WS sync removes stale feed nodes correctly, but an empty incoming feed list currently causes all WS repeaters to be removed and may hide stale-source detection issues.

---

Review status: ongoing. Additional code paths are still being scanned for functionality bugs beyond caching and OSM integration.
