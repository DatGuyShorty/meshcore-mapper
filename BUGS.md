# BUGS

This file collects the potential bugs discovered during the current review of the repository.

## Cache and reuse
- `src/buildings.js` / `src/foliage.js`: in-memory tile caches are capped with FIFO eviction, not true LRU, so recently used hot tiles can be evicted prematurely.
- `src/elevation.js`: point cache uses 4-decimal rounding while `fetchElevationsFromTiles()` checks the in-memory cache with 6-decimal rounding, causing cross-path cache misses.
- `src/main/cacheDb.js`: tile TTL cleanup is only enforced at lookup; stale OSM cache rows are not cleaned up elsewhere.

## OpenStreetMap / Overpass
- `src/buildings.js`: Overpass query does not request node-level building features such as `node["building"]` and `node["building:part"]`.
- ~~`src/buildings.js`: relation processing ignores `inner` members, so holes in multipolygon buildings are not modeled.~~ **Fixed** — both `buildings.js` and `foliage.js` assemble inner rings via `assembleMultipolygon()` and attach them with `holeCandidatesForOuter()`, then subtract them in `segmentPolygonIntervalsWithHoles()`.
- `src/buildings.js` / `src/foliage.js`: tile bbox loops assume `lonMin <= lonMax` and do not handle antimeridian-crossing bounds.
- ~~`src/buildings.js` / `src/foliage.js`: the 60s Overpass request timeout was a hand-rolled `setTimeout(() => controller.abort(), 60000)` started *before* `scheduledFetch`, so it counted time spent waiting behind the per-host Overpass concurrency cap (1). With a multi-tile viewport, queued tiles' timers burned down while idle and aborted with `signal is aborted without reason` before they ever fetched.~~ **Fixed** — both now pass `signal` + `timeoutMs: 60000` to `scheduledFetch`, whose timer starts only when the request is dequeued, so the budget covers real fetch time only.
- ~~`src/foliage.js`: relation member assembly still does not explicitly support holes.~~ **Fixed** — see above. Additionally, `holeCandidatesForOuter()` previously assigned a hole to any outer whose *bounding box* overlapped it; a C-shaped or disjoint outer sharing the bbox would wrongly inherit a clearing and punch a phantom gap. It now confirms true point-in-polygon containment of a representative interior point. Covered by `tests/unit/osmGeometry.test.js`.

## Input validation / grid generation
- `src/signalModel.js`: `_hasFiniteLatLon()` validated latitude but not longitude bounds — now fixed; `computeSignalToPoint()` still relies on caller for distance sanity.
- `src/linkBudget.js`: `calculateLinkBudget()` previously trusted endpoint coordinates without validation — now rejects invalid lat/lng before fetching elevations.

## Elevation / path sampling
- `src/elevation.js`: `fetchElevationsFromTiles()` bypasses the point DB entirely, which is a design choice but means point cache reuse is not leveraged for large raster queries.
- `src/elevation.js`: `_fillNulls()` silently forward/backfills missing API elevation results, which can mask data gaps and produce incorrect terrain values. *Partial mitigation:* now returns `{ filledFromNeighbour, defaultedToZero }` and increments `stats.elevationFilledFromNeighbour` / `stats.elevationDefaultedToZero` so callers can surface the count; user-facing summary still needs to display it.

## Coverage / rendering
- `src/coverage.js`: obstacle fetch failures are logged and skipped, but there is no strong user-facing signal that foliage/building losses were omitted from the coverage result.

## 3D terrain / visualization
- `src/map3d.js`: switching off 3D mode leaves the renderer, scene, and resize observer alive, which can retain stale state and keep hidden resources active.
- `src/map3d.js`: `_createMirroredMapTexture()` builds a full tile request list for viewport bounds even when the final texture is downscaled, causing unnecessary tile loads for large, low-zoom views.

## Miscellaneous
- `src/linkBudget.js`: fallback noise/SNR values are derived from `result.effectiveSens` when certain metadata is missing, which may produce misleading link-budget outputs instead of failing earlier.
- `src/repeaters.js`: `_wsKeyForRow()` may collapse distinct live feed rows into the same key when rows share the same coordinates and lack identifiers; `normalizeWsRepeaterSnapshot()` does count and report the collisions but rows are still dropped.
- ~~`src/repeaters.js`: `setEditMode()` assumes a repeater exists and can throw if called with an invalid ID, which can happen during stale UI interactions.~~ **Fixed** — early return with `clearEditMode()` and a warning; UI no longer crashes on stale edit clicks.
- ~~`src/main/cudaCoverage.js`: Python CUDA helper stdout parsing is brittle; any stray non-JSON output can cause the backend to fail even when the helper otherwise completes successfully.~~ **Fixed** — extracted `_consumePythonLines()` that tolerates stray non-JSON lines, logs them via `console.warn`, and resolves with the last valid JSON message rather than rejecting the whole job. Covered by `tests/unit/cudaCoverageLineParser.test.js`.

## Electron hardening (security review 2026-05-26)

- `src/main/window.js`: BrowserWindow had no `setWindowOpenHandler` or `will-navigate` handler — fixed; external links route through `shell.openExternal`, in-place cross-document navigation is blocked, same-document hash/pathname changes still allowed. `sandbox: true` added to `webPreferences`.
- `main.js`: no `setPermissionRequestHandler` / `setPermissionCheckHandler` — fixed; only `geolocation` is allowed (used once on first launch by `src/map.js`), everything else is denied.
- `index.html`: no Content-Security-Policy — fixed; meta CSP locks `default-src` to `'self'`, allowlists the OSM/Esri/OpenTopoMap tile hosts, the OpenElevation/OpenTopoData/Overpass APIs, and `ws:`/`wss:` for the WebSocket live feed. The only inline `<script>` retained is the three.js importmap, allowed via a `sha256-...` hash in `script-src` (no `'unsafe-inline'`).
- `index.html`: tab-switch + sidebar-resize IIFE extracted from inline `<script>` to new file `src/shellInit.js` so the renderer no longer needs `script-src 'unsafe-inline'`.
- `src/repeaterRows.js`: `normalizeWsRepeaterSnapshot()` now clamps `name`/`short`/`last_seen`/`wsKey` lengths to mirror `_safeWsRow()` in `src/main/ipcHandlers.js`, so a pathological WebSocket payload cannot freeze the renderer before reaching the DB clamp.
- `src/repeaters.js`: `connectLiveFeed()` previously accepted any URL string and let the `WebSocket` constructor reject unsupported schemes with an opaque error. New `normalizeWsUrl()` in `src/repeaterRows.js` validates and rewrites `http(s)`→`ws(s)` upfront, surfacing a clear status when the user types `ftp://`, `file://`, `javascript:`, or schemeless input.
- `src/main/cacheDb.js`: the `PRAGMA journal_mode=WAL` / `PRAGMA synchronous=NORMAL` calls have no effect on `sql.js`'s in-memory engine. Now annotated in code so readers don't assume they're load-bearing.
- `src/map.js`: `getActiveBaseLayerInfo()` previously reached into Leaflet's private `layer._url`. New `baseLayerSpecs` map owns the URL template + options, and `getActiveBaseLayerInfo()` reads from it. Removes a fragile dependency on Leaflet internals.
- `src/main/window.js`: URL safety helpers (`isSafeExternalUrl`, `isSameDocument`) extracted to new `src/main/urlGuards.js` so they can be unit-tested without Electron.

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
- `src/config.js`: `loadConfig()` now reports the count of skipped invalid repeaters alongside the loaded count.
- `src/elevation.js`: `fetchElevations()` and `fetchElevationsFromTiles()` now use the same 4-decimal rounding for in-memory cache keys.
- `src/repeaters.js`: live WS sync no longer purges all WS nodes when the feed sends an empty or all-invalid snapshot; only an explicit `{clear: true}` payload clears the set.
- `src/foliage.js`: multipolygon forests that previously rendered as empty (super-relations, fragmented members) now fall back to rendering outer-role member ways individually; Overpass query also uses deep recursion (`>>;`) so sub-relation members are fetched.
- `src/signalModel.js`: `_hasFiniteLatLon()` now also validates longitude bounds, preventing out-of-range longitudes from flowing into bearing/distance math.
- `src/linkBudget.js`: endpoint coordinates are validated up front; invalid lat/lng causes an immediate, descriptive error instead of NaN cascading through the budget.
- `src/coverageBackend.js` / `src/optimizerBackend.js`: duplicated `_hasObstacleHoles` helper extracted to `src/osmGeometry.js#obstacleLayerHasHoles`.
- `src/pathfinder.js`: obstacle bounding box now spans only nodes reachable from the source within the hop radius, avoiding unrelated foliage/building tile fetches.
- `src/terrain3dModel.js`: `sampleTerrainElevation()` now clamps row/col fractions through `clampedGridFractions`, so out-of-bounds lat/lon snaps to the nearest grid edge instead of extrapolating.
- `src/mapTileTexture.js`: `tileTextureLayout()` adds `worldPx` to the SE corner when the bounds cross the antimeridian, producing the correct pixel-space layout.
- `src/coveragePoint.js`: removed the magic `+ 17.5` fallback for noise-floor estimation; the constant now comes from `radioMetrics.LORA_REQUIRED_SNR_DB[11]`.
- Repo hygiene: `lora-config.json` (user-exported config), `test-results/.last-run.json` (Playwright artefact), and the in-history `node_modules/` (173 MB binary) are untracked; `.gitignore` covers all three plus `cache.db*` siblings and `.pr-body.md`. `node_modules/` was also stripped from history with `git filter-repo` so GitHub will accept pushes.
- `src/settings.js`: barrier layer controls are now included in persisted map-layer settings.

## Documentation / summary inconsistencies
- `src/mapTileTexture.js`: `summary.md` describes it as a higher-performance coverage overlay renderer, but in practice it is only used for 3D terrain map texturing in `src/map3d.js`.
- `src/repeaters.js`: `summary.md` says live WS sync removes stale feed nodes correctly, but an empty incoming feed list currently causes all WS repeaters to be removed and may hide stale-source detection issues.

---

Review status: ongoing. Additional code paths are still being scanned for functionality bugs beyond caching and OSM integration.
