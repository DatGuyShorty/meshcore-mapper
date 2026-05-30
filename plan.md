# MeshCore Mapper — Plan

Last reviewed: May 2026.

---

## Active

*(add new items here when work is in progress)*

---

## Backlog

### Bugs

| ID | File | Issue | Fix |
|----|------|-------|-----|
| B5 | `coverage.js`, `map.js` | ~~`_polyRenderer` (Leaflet Canvas instance) is created once and never reset when `clearFoliageLayers()` / `clearBuildingLayers()` run — the backing canvas DOM element accumulates in the map container across runs~~ | **Done** — `_polyRenderer.remove()` + null reset at start of each `runCoverageAnalysis` |
| B6 | `p2p.js` | ~~Terrain profile SVG hardcodes `Re_eff = 8495000`; `propagation.js` derives `6371000 * 4/3 = 8494666.67` — 333 m discrepancy on long paths~~ | **Done** — exported `RE_EFF` from `propagation.js`; imported in `p2p.js` |
| B7 | `coverage.js` | ~~`canvas.toDataURL()` synchronously base64-encodes the full PNG per repeater overlay~~ | **Done** — replaced with `canvas.toBlob()` + `URL.createObjectURL()`; revoked in `clearCoverageLayers()` |
| B8 | `repeaters.js` | ~~Dragging a repeater marker updates `r.lat`/`r.lon` but does not update the marker's bound popup~~ | **Done** — `setPopupContent` added to `dragend` handler |

### Performance

| ID | File | Issue | Fix |
|----|------|-------|-----|
| P13 | `elevation.js` | ~~`_elevMem` grows without bound for the lifetime of the renderer process~~ | **Done** — `_elevMemSet()` helper caps at 500 000 entries; evicts oldest 25% when exceeded |
| P14 | `optimizer.js`, `optimizerUI.js` | ~~`findBestLocations` runs entirely on the main thread — at Fine (32×32 candidates) with LoS enabled this blocks the UI for several seconds~~ | **Done** — elevation fetch stays on main thread (IPC constraint); greedy scoring loop moved to `optimizerWorker.js`; `optimizerUI.js` spawns the worker with pre-fetched elevation data |
| P15 | `coverage.js` | ~~When `useLos=false`, `gridElevs` is already a `Float32Array`; it was being copied redundantly~~ | **Done** — `const gridElevsF32 = useLos ? new Float32Array(gridElevs) : gridElevs` |

### Features

| ID | Description | Detail |
|----|-------------|--------|
| F7 | ~~**Cancel in-flight coverage analysis**~~ | **Done** — `_cancelToken` + `_currentWorker` in `coverage.js`; ✕ Cancel button in progress overlay (ui.js); Escape key handler; cancelled error shown as status not exception |
| F8 | ~~**"Copy current node settings" copies only height**~~ | **Done** — optimizer already reads `repeater-power`/`freq`/`gain` live from the Nodes form; only `opt-height` needed its own copy (it had one). Comment updated to clarify |
| F9 | ~~**WS-imported node default radio params are hardcoded**~~ | **Done** — "WS Node Defaults" details panel added to Settings tab (height, power, freq, gain inputs); `_getWsDefaults()` helper in `repeaters.js` reads those inputs in both `_loadWsFromDb` and `_syncWsRepeaters` |

### UX

| ID | Description | Detail |
|----|-------------|--------|
| U7 | ~~**Map centres on Slovakia for every new user**~~ | **Done** — `map.js` requests geolocation on first launch; persists map centre in `localStorage` on `moveend` so subsequent launches restore the last viewed area |
| U8 | ~~**Foliage / building loss inputs visible even when feature is off**~~ | **Already done** — `coverage.js init()` already toggles those label rows via `display:none` |

---

## Done (summary)

---

## Done (summary)

| ID | What | How |
|----|------|-----|
| S1 | CSP meta tag in renderer | `index.html` `<meta http-equiv="Content-Security-Policy">` allowlisting tile/API/WS hosts; inline importmap allowed via SHA-256 hash, no `'unsafe-inline'` |
| S2 | `setWindowOpenHandler` + `will-navigate` | `src/main/window.js` — external links go through `shell.openExternal`, cross-document navigation blocked, same-document hash/path changes preserved; `sandbox: true` added |
| S3 | `setPermissionRequestHandler` + `setPermissionCheckHandler` | `main.js` — only `geolocation` allowed, used once on first launch by `src/map.js` |
| S4 | WS payload length clamping in renderer | `src/repeaterRows.js#normalizeWsRepeaterSnapshot` mirrors `_safeWsRow` caps (name 120, short/lastSeen 80, key 160) |
| S5 | Inline shell-init script extracted to file | New `src/shellInit.js`; `index.html` `<script>` block removed |
| C1 | `app.js` concatenated import split onto two lines | `app.js:12` |
| C2 | Stray `60` between section headers removed from `AGENTS.md` | `AGENTS.md:48` |
| C3 | `tests/` lint warnings (6 unused vars) renamed to `_`-prefixed | `tests/unit/map.test.js`, `tests/unit/mapAdapter.test.js`, `tests/unit/ui.test.js` |
| T1 | Playwright per-test timeout raised from 30s → 180s | `playwright.config.cjs` — coverage compute on a fresh terrain cache takes ~80s, so the 30s test timeout could never let inner 120s `expect` calls fire |
| T2 | Coverage smoke test now checks "≥1 image layer" instead of "exactly 1" | `tests/smoke/workflow-smoke.spec.cjs:187` — large grids render across multiple 1024px tiles; the strict `toHaveCount(1)` assertion failed for any radius/zoom producing >1024 cells |
| T3 | Multi-step smoke test uses Clear button instead of completing a two-click pick | `tests/smoke/workflow-smoke.spec.cjs:298–306` — the original `map.click()` × 2 path was brittle vs persisted map centre/zoom from prior tests; the completion path is exercised by other tests |
| T4 | Opt-in renderer console capture in smoke harness | `tests/smoke/electron-app.js` — `SMOKE_VERBOSE=1` pipes renderer console + page errors to stdout for diagnosis |
| D1 | Rewrite/maintainability plan | New `REWRITE.md` — phased TS migration, layered modules, typed IPC contract, component framework path, CUDA streaming bridge |
| M2 | WS URL scheme validated upfront | `normalizeWsUrl()` in `src/repeaterRows.js` rejects non-(ws/wss/http/https) URLs with a clear status message; `connectLiveFeed()` in `src/repeaters.js` uses it |
| M3 | `sql.js` no-op WAL pragmas annotated | `src/main/cacheDb.js` — comment explains the pragmas have no effect on the in-memory engine; kept for parity with a future native sqlite backend |
| M5 | Tile URL templates owned by `map.js`, not Leaflet's private `_url` | `src/map.js` — new `baseLayerSpecs` map; `getActiveBaseLayerInfo()` reads from it; `mapTileTexture.js` no longer depends on Leaflet internals |
| T5 | URL guard helpers extracted + tested | `src/main/urlGuards.js` (`isSafeExternalUrl`, `isSameDocument`) + `tests/unit/urlGuards.test.js`; consumed by `src/main/window.js` |
| T6 | WS payload clamping + URL normalisation under unit test | `tests/unit/repeaterRows.test.js` — +17 unit tests covering length caps, null preservation, scheme upgrades, rejection of `file:`/`javascript:` |
| B9 | `setEditMode` no longer throws on stale ids | `src/repeaters.js` — early return + `clearEditMode()` if the repeater was removed before the UI got the click |
| B10 | `cudaCoverage` tolerates stray non-JSON stdout | `src/main/cudaCoverage.js` — new `_consumePythonLines` helper logs strays and resolves with the last valid JSON result; the helper used to reject the whole job on a single bad trailing line |
| Q1 | `_fillNulls` returns interpolation stats | `src/elevation.js` — `{ filledFromNeighbour, defaultedToZero }` returned and tracked on the per-fetch `stats` object; sets up future user-facing data-quality reporting |
| T7 | Defensive code under unit test | `tests/unit/elevation.test.js` (+2 tests for fill stats) and new `tests/unit/cudaCoverageLineParser.test.js` (+5 tests for stdout parsing) |
| TS1 | Phase 0a of `REWRITE.md` — TypeScript as static checker | `tsconfig.json` (`strict`, `allowJs`, `checkJs: false`, `noEmit`), `npm run typecheck` script, `npm run check` now includes typecheck |
| TS2 | Pure modules opt into `// @ts-check` with JSDoc types | `src/repeaterRows.js`, `src/radioMetrics.js`, `src/main/urlGuards.js`, `src/coverageGrid.js` |
| TS3 | Physics + link-budget surface under `// @ts-check` | `src/coveragePoint.js`, `src/signalModel.js`, `src/propagation.js`, `src/linkBudget.js`. `src/terrainProfileView.js` exports annotated for cross-file inference |
| TS4 | OSM geometry + foliage + buildings + elevation under `// @ts-check` | `src/osmGeometry.js`, `src/buildings.js`, `src/foliage.js`, `src/elevation.js`, `src/osmTilePipeline.js`. `signalModel.js` casts dropped now that callees are typed |
| TS5 | Ambient `window.electronAPI` types | New `src/types/global.d.ts` describing the `preload.js` contextBridge surface so renderer IPC calls are type-checked |
| TS6 | Pure-ish compute/IO helpers under `// @ts-check` | `src/requestScheduler.js`, `src/scenarios.js`, `src/signalOverlay.js`, `src/optimizer.js`, `src/pathfinder.js` |
| TS7 | Renderer utilities + workers + backends + presets/settings + 3D terrain under `// @ts-check` | `src/ui.js`, `src/mapAdapter.js`, `src/mapContext.js`, `src/devConsole.js`, `src/settings.js`, `src/settingsPersistence.js`, `src/presets.js`, `src/coverageWorker.js`, `src/optimizerWorker.js`, `src/coverageWorkerPool.js`, `src/coverageBackend.js`, `src/optimizerBackend.js`, `src/mapTileTexture.js`, `src/terrain3dModel.js`. `tsconfig.json` switched to `module: ESNext` + `moduleResolution: bundler` + `moduleDetection: force` so renderer `new Worker(new URL(..., import.meta.url))` type-checks. Added ambient `const L: any;` to `src/types/global.d.ts` for the Leaflet global. |
| TS8 | UI panels + map singleton + config under `// @ts-check` | `src/map.js`, `src/shellInit.js`, `src/config.js`, `src/mapLayers.js`, `src/optimizerUI.js`, `src/pathfinderUI.js`, `src/repeaters.js`. `src/coverage.js` / `src/p2p.js` / `src/map3d.js` remain JS-only — deferred to Phase 0b TS conversion. |
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
| Compute backend | Coverage inner loop runs through CUDA-first backend selection with CPU worker fallback | `coverageBackend.js`, `coverageWorkerPool.js`, `coverageWorker.js` |
| README + docs | README rewritten; `summary.md` created | `README.md`, `summary.md` |
| Repeater visibility | Per-repeater 👁 toggle hides marker + coverage overlay | `repeaters.js`, `coverage.js`, `style.css` |
| Repeater → P2P | Clicking repeater marker in pick mode sets it as TX point A/B | `p2p.js`, `repeaters.js` |
| P2P terrain profile | SVG cross-section with Fresnel zone + obstruction highlight | `p2p.js` |
| P2P diffraction fix | Separate geometric LoS vs Fresnel zone rows; correct ITU-R P.526 v calculation | `p2p.js` |
| Building detection | `buildings.js` — Overpass fetch, SQLite cache (30d TTL), `buildingLossDb()` | `src/buildings.js`, `main.js`, `preload.js` |
| Building map layer | Filled building footprints on map, height-coded color, togglable | `coverage.js`, `map.js`, `index.html` |
| Building propagation | Building attenuation wired into the active compute backend alongside foliage | `coverageBackend.js`, `coverageWorker.js` |
| Foliage filled render | Foliage polygons now filled (semi-transparent green) not just outlines | `coverage.js` |
| Tile-based cache | Foliage + buildings cached on shared 0.25° grid tiles; nearby repeaters reuse tiles | `foliage.js`, `buildings.js` |
| Canvas renderer | All foliage + building polygons use `L.canvas()` not per-polygon SVG | `coverage.js` |
| WS live feed | WebSocket input imports repeater list from Node-RED; auto-connects + sends `{}` on open | `repeaters.js`, `index.html`, `style.css` |
| WS node schema | Payload fields `name`, `lat`, `lon`, `short`, `last_seen` mapped; popup shows ID + last seen | `repeaters.js` |
| WS persistence | WS repeaters saved to `ws_repeaters` SQLite table; restored on startup | `main.js`, `preload.js`, `repeaters.js` |
| WS disconnect fix | Disconnect removes markers; reconnect syncs cleanly without duplicates | `repeaters.js` |
| WS missing `let _ws` | Missing variable declaration restored (strict-mode ReferenceError) | `repeaters.js` |
| WS save error fix | `INSERT` used `r.id` (undefined); changed to autoincrement; `String(err)` for sql.js raw throws | `main.js` |
| Filter + sort | Name filter + sort dropdown (added / A→Z / Z→A) above node list | `repeaters.js`, `index.html`, `style.css` |
| Node context menu | Marker click opens ctx menu: Info, P2P Link, Edit, Hide/Show, Remove | `repeaters.js`, `p2p.js`, `style.css` |
| P2P startPickingFrom | `startPickingFrom(r)` sets repeater as point A and auto-switches to Planning tab | `p2p.js` |
| Hide/Show All | Button toggles all markers on/off | `repeaters.js`, `index.html` |
| Popup fix | Marker click awaited properly; popup opens when not in P2P pick mode | `repeaters.js` |
| Coverage – visible only | Analysis only runs for visible (unhidden) repeaters | `coverage.js` |
| DB clear buttons | “WS Nodes DB” and “Clear Entire DB” (+ VACUUM) buttons in Settings | `config.js`, `main.js`, `preload.js`, `index.html` |
| cacheVacuum exposed | `cacheVacuum` IPC bridged to renderer via `preload.js` | `preload.js` |
