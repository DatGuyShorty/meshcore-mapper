# BUGS

This file collects the potential bugs discovered during the current review of the repository.

## Cache and reuse
- `src/buildings.js` / `src/foliage.js`: in-memory tile caches are capped with FIFO eviction, not true LRU, so recently used hot tiles can be evicted prematurely.
- `src/elevation.js`: point cache uses 4-decimal rounding while `fetchElevationsFromTiles()` checks the in-memory cache with 6-decimal rounding, causing cross-path cache misses.
- `src/main/cacheDb.js`: tile TTL cleanup is only enforced at lookup; stale OSM cache rows are not cleaned up elsewhere.

## OpenStreetMap / Overpass
- `src/buildings.js`: Overpass query does not request node-level building features such as `node["building"]` and `node["building:part"]`.
- `src/buildings.js` / `src/foliage.js`: tile bbox loops assume `lonMin <= lonMax` and do not handle antimeridian-crossing bounds.

## Input validation / grid generation
- `src/signalModel.js`: `_hasFiniteLatLon()` validated latitude but not longitude bounds — now fixed; `computeSignalToPoint()` still relies on caller for distance sanity.
- `src/linkBudget.js`: `calculateLinkBudget()` previously trusted endpoint coordinates without validation — now rejects invalid lat/lng before fetching elevations.

## Elevation / path sampling
- `src/elevation.js`: `fetchElevationsFromTiles()` bypasses the point DB entirely, which is a design choice but means point cache reuse is not leveraged for large raster queries.
- `src/elevation.js`: `_fillNulls()` silently forward/backfills missing API elevation results, which can mask data gaps and produce incorrect terrain values. *Resolved:* returns `{ filledFromNeighbour, defaultedToZero }` and increments `stats.elevationFilledFromNeighbour` / `stats.elevationDefaultedToZero`; `src/coverage.js#_formatDataQualityNote` now surfaces the counts in the coverage status line as a warning when non-zero.

## Coverage / rendering
- `src/coverage.js`: obstacle fetch failures are logged and skipped. *Resolved:* the obstacle warnings are now folded into the persistent end-of-run coverage status (`_formatDataQualityNote`) with `warning` severity, instead of being clobbered by the success summary.

## 3D terrain / visualization
- `src/map3d.js`: switching off 3D mode leaves the renderer, scene, and resize observer alive, which can retain stale state and keep hidden resources active.
- `src/map3d.js`: `_createMirroredMapTexture()` builds a full tile request list for viewport bounds even when the final texture is downscaled, causing unnecessary tile loads for large, low-zoom views.

## Miscellaneous
- `src/linkBudget.js`: fallback noise/SNR values are derived from `result.effectiveSens` when certain metadata is missing, which may produce misleading link-budget outputs instead of failing earlier.
- `src/repeaters.js`: `_wsKeyForRow()` may collapse distinct live feed rows into the same key when rows share the same coordinates and lack identifiers; `normalizeWsRepeaterSnapshot()` does count and report the collisions but rows are still dropped.

## Documentation / summary inconsistencies
- `src/mapTileTexture.js`: `summary.md` describes it as a higher-performance coverage overlay renderer, but in practice it is only used for 3D terrain map texturing in `src/map3d.js`.
- `src/repeaters.js`: live WS sync removes stale feed nodes. *Resolved:* an empty incoming feed list no longer wipes all WS repeaters — `_syncWsRepeaters` guards on `!snapshot.explicitClear && rows.length === 0` and skips the removal pass (a transient empty message is ignored).

---

Review status: ongoing. Additional code paths are still being scanned for functionality bugs beyond caching and OSM integration.
