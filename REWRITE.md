# MeshCore Mapper — Rewrite & Maintainability Plan

_Last updated: 2026-05-26._

This document captures the proposed direction for the next major iteration of the codebase. It is intentionally an **incremental** plan, not a big-bang rewrite — the existing app works, has 168 passing tests, a green security review, and active users. The goal is to make future changes faster, safer, and easier to onboard new contributors to.

---

## 1. Why change anything

The app reached its current shape by accretion: 41 modules across `src/`, ~11 850 lines of JS, plus the Electron main process and a Python CUDA helper. The pain points the review surfaced:

| Pain | Concrete symptom |
|---|---|
| **Bloated modules** | Top files: `map3d.js` (1224 lines), `coverage.js` (880), `elevation.js` (741), `p2p.js` (640), `buildings.js` (600), `repeaters.js` (599), `foliage.js` (601). Each mixes DOM, fetching, caching, and physics. |
| **Implicit dataflow** | A shared mutable `state` object in `map.js` is read and written across most modules; ordering between `init()` calls in `app.js` is load-bearing but undocumented. |
| **String-templated DOM** | ~18 `innerHTML` sites in `src/`. Every one is currently safe, but a single regression on the WebSocket feed is one bug away from XSS. The CSP added in this pass narrows the blast radius, but the pattern still rots. |
| **Runtime-only typing** | `BUGS.md` keeps logging "validate lat/lon", "validate frequency", "validate radius" issues — these are exactly the bugs a type checker catches once and forever. |
| **Compute backend selection** is spread across `coverage.js` + `coverageBackend.js` + `coverageWorkerPool.js` + `optimizerBackend.js` + `optimizerWorker.js` + `src/main/cudaCoverage.js`. A clear `JobRunner` interface would shrink this. |
| **IPC ad-hoc validation** | `src/main/ipcHandlers.js` validates each channel by hand (`_finiteNumber`, `_validLatLon`, `_safeWsRow`, …). One missed channel = one trust-boundary hole. |
| **No bundler** | The renderer loads ~40 ES modules via `<script type="module">`. Cold start is bearable on local file:// but each module loads with no tree-shaking or minification. Source maps for the CUDA temp-file flow are essentially non-existent. |
| **CUDA bridge via temp files** | `spawn('python', ['--compute', paramsPath])` writes/reads JSON+f32 to `os.tmpdir()` per job. Works, but startup cost is real (~hundreds of ms) for short jobs. |

What the rewrite is **not** trying to fix:

- The physics. `src/propagation.js`, `src/signalModel.js`, `src/coverageGrid.js`, `src/linkBudget.js`, `src/radioMetrics.js` are correct, well-tested, and pure. They are the crown jewels — keep, port, do not rewrite.
- The CUDA backend. `scripts/meshcore_cuda/engine.py` is well-factored; only the IPC surface changes.
- The product. No new features as part of the rewrite; one user-visible regression breaks the value proposition.

---

## 2. Principles

1. **Strangler fig, not big-bang.** Every phase ships green tests + a working app. The two codebases coexist for as long as it takes.
2. **Type-first.** TS migration is the spine of every other improvement — typed IPC, typed state, typed component props, typed worker payloads. JS modules can be migrated independently with `allowJs`.
3. **Layered modules.** A file's directory tells you what it can import:
   ```
   core/      ← pure functions, no DOM, no network, no Electron. Tested in pure Node.
   services/  ← I/O (HTTP, OSM, elevation tiles, cache). Knows about `core/`.
   compute/   ← CUDA + CPU worker backends behind a common interface.
   ui/        ← DOM + Leaflet + components. Imports `core/`, `services/` via a controller.
   electron/  ← main + preload + IPC handlers. Knows nothing about `ui/`.
   ```
   Linter rule (eslint-plugin-boundaries) enforces the layering.
4. **Components over `innerHTML`.** Lit (or Preact) for new UI; existing `innerHTML` hot-spots get rewritten when they need to change anyway.
5. **Schema-validated trust boundaries.** Every IPC channel, every WebSocket payload, every config file is parsed through Zod schemas. One source of truth shared between main + renderer.
6. **One concept per file.** A target ceiling of ~300 lines per file. The current 600–1200-line files split along the natural seams (fetch / cache / model / render).

---

## 3. Target architecture

```
meshcore-mapper/
├─ src/
│  ├─ core/                      # zero-dep, pure TS
│  │  ├─ propagation.ts          # haversine, FSPL, knife-edge, Deygout, RE_EFF
│  │  ├─ signalModel.ts          # computeSignalToPoint, profile sampling
│  │  ├─ linkBudget.ts           # P2P link calculation
│  │  ├─ coverageGrid.ts         # bbox + grid shape helpers
│  │  ├─ radioMetrics.ts         # LoRa SNR / noise-floor lookups
│  │  ├─ shadowFading.ts         # log-normal / Monte Carlo
│  │  ├─ osmGeometry.ts          # polygon / bbox math
│  │  └─ schemas/                # Zod schemas for repeaters, settings, WS rows, IPC
│  │
│  ├─ services/                  # I/O. Imports `core/`. No DOM.
│  │  ├─ elevation/              # tile loader + API fallback + caching policy
│  │  ├─ osm/                    # foliage + buildings + Overpass scheduler
│  │  ├─ cache/                  # SQLite client (typed wrappers around electronAPI)
│  │  └─ ws/                     # WebSocket feed normaliser
│  │
│  ├─ compute/                   # backend abstraction
│  │  ├─ JobRunner.ts            # interface: { run(payload, signal, onProgress): Promise<Result> }
│  │  ├─ cpu/                    # Worker pool implementation (was coverageWorkerPool.js)
│  │  ├─ cuda/                   # Electron-IPC wrapper (was cudaCoverage.js)
│  │  └─ select.ts               # auto / cuda / cpu preference resolution
│  │
│  ├─ ui/                        # Lit/Preact components + Leaflet
│  │  ├─ map/                    # Leaflet wrapper, tile layers, overlays
│  │  ├─ panels/                 # NodesPanel, CoveragePanel, PlanningPanel, SettingsPanel
│  │  ├─ p2p/                    # link budget panel + terrain profile
│  │  ├─ pathfinder/             # relay path UI
│  │  └─ controllers/            # CoverageController, OptimizerController, PathfinderController
│  │                             # (orchestrate services + compute, surface to UI as observable state)
│  │
│  ├─ state/                     # observable stores
│  │  ├─ repeaters.ts            # signal/observable list + undo stack
│  │  ├─ settings.ts             # persisted to localStorage with schema validation
│  │  ├─ coverage.ts             # job state machine: idle | fetching | computing | rendering | done
│  │  └─ wsFeed.ts               # connection state + last-seen snapshot
│  │
│  └─ electron/                  # main + preload, all CommonJS or TS-compiled CJS
│     ├─ main.ts                 # app lifecycle + session hardening (CSP, permissions, window handlers)
│     ├─ window.ts
│     ├─ preload.ts              # contextBridge surface, derived from schemas/ipc.ts
│     └─ ipc/                    # one file per handler group (cache, ws, cuda, presets)
│
├─ vendor/                       # leaflet (kept local, no CDN)
├─ tests/
│  ├─ unit/                      # Vitest, exists today, ports to TS as files migrate
│  ├─ component/                 # Lit/Preact + happy-dom (new)
│  └─ e2e/                       # Playwright + Electron (existing smoke promoted)
│
├─ scripts/                      # build scripts, CUDA helper, syntax check
└─ vite.config.ts                # one bundle for renderer, one for preload
```

---

## 4. Phased migration

Each phase: **green `npm run check` at start, green at end.** No phase is allowed to leave the app broken between merges.

### Phase 0a — TypeScript as a static checker (DONE)

- `typescript@^6` + `@types/node` added as devDeps.
- `tsconfig.json`: `strict: true`, `allowJs: true`, `checkJs: false`, `noEmit: true`. Files opt in to checking with `// @ts-check`.
- `npm run typecheck` runs `tsc -p tsconfig.json` over `src/` + entry scripts.
- `npm run check` now gates on typecheck (`syntax → lint → typecheck → test → audit → smoke`).
- Files annotated under `// @ts-check` with JSDoc types so far:
  - `src/repeaterRows.js` — config + WS row helpers, length clamping, URL normaliser
  - `src/radioMetrics.js` — LoRa modem metrics
  - `src/main/urlGuards.js` — `isSafeExternalUrl`, `isSameDocument`
  - `src/coverageGrid.js` — `coverageBbox`, `unionBbox`, `elevationGridShape`, `buildElevationGridPoints`
  - `src/coveragePoint.js` — `inspectCoverageAtPoint`
  - `src/signalModel.js` — `computeSignalToPoint`, `flatDistanceM`, `fsplBaseDb`, profile buffers
  - `src/propagation.js` — physics core: haversine, FSPL, Deygout, checkLoS, polygon-segment intervals, bilinear elev, shadow fading
  - `src/linkBudget.js` — P2P link budget calculation, Monte Carlo
  - `src/osmGeometry.js` — polygon math, multipolygon assembly, ring fingerprints, tile descriptors
  - `src/buildings.js` — OSM building fetch + `buildingLossDb`, height inference, structure classification
  - `src/foliage.js` — OSM vegetation fetch + `foliageLossDb`, Weissberger model, canopy classification
  - `src/elevation.js` — DEM tile pipeline, OpenElevation/OpenTopoData API, null-fill stats, Terrarium decode
  - `src/osmTilePipeline.js` — generic tile fetch worker pool
  - `src/requestScheduler.js` — per-host fetch queues with abort + timeout
  - `src/scenarios.js` — coverage-tab preset application
  - `src/signalOverlay.js` — RSSI / SNR / margin gradient + colorize
  - `src/optimizer.js` — greedy best-N repeater placement search
  - `src/pathfinder.js` — radius-limited multi-hop relay path search
  - `src/terrainProfileView.js` — `drawTerrainProfile` (annotated for cross-file inference; full `@ts-check` deferred)
- New `src/types/global.d.ts` ambient declaration: shape of `window.electronAPI` (the `preload.js` contextBridge surface), so renderer code type-checks IPC calls.
- No source files moved to `.ts` yet; that's Phase 0b once the bundler is in place. Adding `// @ts-check` to additional modules is incremental and risk-free.

### Phase 0b — Vite bundler (next)

- Add `vite`, `electron-vite` (or `vite-electron-plugin`) as devDeps.
- Vite dev server replaces `<script type="module">` loading. Production build bundles renderer + preload separately.
- Once Vite is in, port `src/repeaterRows.js` → `src/core/wsNormalize.ts` as the smallest example to prove the pipeline. Vite resolves `.ts` natively; Vitest already does.
- ESLint config: add `@typescript-eslint`, `eslint-plugin-boundaries` (initially permissive; rules tighten per phase).

**Verification:** existing `npm test`, `npm run lint`, `npm run typecheck`, `npm run smoke` all pass against the Vite build. Electron launches identically.

### Phase 1 — port pure core to TS (3–5 days, low risk)

In order, smallest dep graph first:

1. `osmGeometry.js` → `core/osmGeometry.ts`
2. `radioMetrics.js` → `core/radioMetrics.ts`
3. `repeaterRows.js` → `core/schemas/repeater.ts` (Zod) + `core/wsNormalize.ts`
4. `propagation.js` → `core/propagation.ts`
5. `coverageGrid.js` → `core/coverageGrid.ts`
6. `signalModel.js` → `core/signalModel.ts`
7. `linkBudget.js` → `core/linkBudget.ts`
8. `shadowFading*` extracted out of `propagation.ts` into `core/shadowFading.ts`

Each port:
- Keep the existing `*.js` adjacent until callers update their import path (or use a `core/index.ts` barrel that JS consumers can still hit).
- Add Zod schemas for any `{ lat, lon, ... }` interface that crosses a trust boundary (config files, WS rows, IPC payloads).
- Tests stay where they are; rename `.test.js` → `.test.ts` only when convenient.

**Verification:** test count strictly increases (new schema tests added); existing tests unchanged. Bundle size measurable before/after.

### Phase 2 — typed IPC contract (2–3 days, medium risk)

- Define every IPC channel in `electron/ipc/schemas.ts` (Zod schemas).
- Generate the TS types for `window.electronAPI` from those schemas; share the same types between `main` and `preload`.
- Replace per-channel `_finiteNumber` / `_validLatLon` validators in `src/main/ipcHandlers.js` with `schema.parse(payload)`. Invalid payloads throw → renderer sees a typed error.
- `preload.ts` becomes a thin wrapper that calls `ipcRenderer.invoke` and re-validates on the way back.

**Verification:** new unit tests cover every IPC channel's schema parse path. Manual smoke run: every UI feature works. Smoke tests now exercise the new preload bridge.

### Phase 3 — compute abstraction (2–3 days, medium risk)

- Define `interface JobRunner<TPayload, TResult>` with `run(payload, { signal, onProgress }): Promise<TResult>`.
- Two implementations: `CpuWorkerPoolRunner` (current `coverageWorkerPool.js` content), `CudaIpcRunner` (current `cudaCoverage.js`).
- `coverage.ts` and `optimizer.ts` ask `selectRunner(preference)` for a runner; they don't know which one they got.
- Cancellation, progress reporting, retries — all in the runner interface, removed from callers.

**Verification:** `coverageBackend.js` and `optimizerBackend.js` shrink to ~30 lines each. Tests cover runner-selection logic in isolation.

### Phase 4 — state + controllers (5–7 days, higher risk)

- Pick a tiny store library: `@preact/signals` (or `nanostores`). No Redux, no Zustand — too much ceremony for this size.
- Move the `state` object out of `map.js` into per-domain stores in `src/state/`.
- For each long-running job (coverage, optimizer, pathfinder), introduce an explicit state-machine store: `{ status: 'idle' | 'fetching' | 'computing' | 'rendering' | 'done' | 'error' | 'cancelled', progress, error }`.
- Controllers in `ui/controllers/` subscribe to settings, react to user actions, write back to job stores. Plain functions, no framework yet.

**Verification:** repeater CRUD, coverage compute, P2P, pathfinder all behave identically. New unit tests for each store's state transitions.

### Phase 5 — UI componentisation (1–2 weeks, highest risk, optional)

- Adopt Lit web components (smallest footprint, no virtual DOM). One component per existing panel.
- Migrate panels one at a time, **starting with the ones that have the most `innerHTML` churn**: `p2p.js`, `pathfinderUI.js`, `optimizerUI.js`, `repeaters.js` list renderer.
- Leaflet integration stays imperative — Lit hosts an `<x-leaflet-map>` whose internals are `map.js` essentially unchanged.
- `escHtml` becomes unnecessary inside components; the framework handles escaping.

**Verification:** Playwright tests grow to cover each migrated panel. UI screenshots before/after for diff review.

### Phase 6 (deferred, only if needed) — CUDA streaming bridge

- Replace per-job `spawn('python', ...)` with a long-running Python worker that owns a CUDA context.
- IPC over stdin/stdout (length-prefixed MessagePack frames).
- Cuts per-job startup from ~hundreds of ms to ~tens of ms; matters most for the optimizer (many small jobs).
- Skip this if profiling shows current CUDA path is fast enough.

**Verification:** profile coverage compute at gridRes=4096 before and after. Smoke test the helper crash-recovery (worker dies → renderer falls back to CPU).

---

## 5. What we keep

This list is as important as the changes. Do not "improve" these as part of the rewrite:

- **All physics modules** — port to TS, do not rewrite logic. `tests/unit/propagation.test.js` etc. are the regression net.
- **Electron security posture** as of the 2026-05-26 hardening — CSP, permission allowlist, window-open / will-navigate handlers, sandboxed renderer, WS payload clamping.
- **CUDA payload validation caps** in `src/main/cudaCoverage.js` (`MAX_CUDA_GRID_RES` etc.) — these prevent resource exhaustion. Port verbatim.
- **The OSM tile caching strategy** (0.25° tiles, 30d TTL, shared across repeaters) — load-bearing for usability over slow Overpass endpoints.
- **`presets.yaml`** as the external preset configuration source — works, no reason to move to TS or JSON.
- **The `cancel` UX** — Escape key, ✕ button on progress overlay. Wire it through the new `JobRunner` interface but don't change the user-facing behaviour.

---

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Rewrite stalls halfway → two codebases forever | Each phase has a finish line in the checklist. Phase 4 onwards is gated on Phase 0–3 being complete; if energy runs out, you stop at end of a phase, not mid-phase. |
| TS migration becomes a typing-bikeshed | Strict mode on, but **opt out per file with `// @ts-nocheck`** during the move. Tighten in a second pass. |
| Component migration breaks Leaflet integration | Leaflet stays imperative inside a single `<x-leaflet-map>` wrapper. We do not try to reactify map state. |
| Vite + Electron preload bundling pitfalls | `electron-vite` is the de-facto solution and has good docs. If it doesn't work, fall back to two `vite build` invocations + manual preload bundle. |
| New developer ramp-up time during transition | Keep `README.md`, `summary.md`, and this `REWRITE.md` updated. After Phase 1, write a `CONTRIBUTING.md` describing the new layout. |

---

## 7. Concrete first PR

If you want a single, mergeable first step to kick this off, it's:

**"Phase 0: introduce Vite + TS toolchain, no source changes."**

- Add `vite`, `electron-vite`, `typescript`, `@types/node` to devDeps.
- `tsconfig.json`, `vite.config.ts`.
- `package.json` scripts: `dev`, `build`, keep `start` for the Electron-only path during transition.
- One demo TS file (e.g. port `repeaterRows.js` → `core/wsNormalize.ts` as the smallest example) to prove the pipeline.
- Run `npm run check`, confirm 168/168 tests still pass.

That PR is reviewable in <30 minutes and unblocks everything in section 4.

---

## 8. Out of scope

To prevent scope creep, the rewrite explicitly does **not**:

- Change the data model on disk (`cache.db` schema stays).
- Change the WebSocket payload format consumed from Node-RED.
- Change the Electron packaging story (still electron-builder or whatever ships today).
- Migrate Python CUDA off CuPy.
- Replace Leaflet with MapLibre / Cesium / WebGL globe.
- Add multi-window support, mobile builds, or web (browser-only) builds.

Each of those is a defensible project on its own — none of them belong in this rewrite.
