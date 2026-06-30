# MeshCore Mapper Improvement Roadmap

Last updated: 2026-06-30

This roadmap is for agents and contributors improving MeshCore Mapper across
functionality, UI/UX, architecture, and maintainability. It is intentionally
incremental: keep the current app working, ship visible product improvements,
and rewrite only the pieces that block future work.

## Assumptions

- The app should remain an Electron desktop planning tool.
- The RF/terrain physics core is valuable and should be preserved unless a
  specific defect is proven by tests or measurements.
- The safest path is not a big-bang rewrite. Improve product workflows first,
  then migrate architecture behind those workflows.
- Every phase should leave `npm run check` green unless a task explicitly
  narrows verification to a smaller command.

## Product Direction

MeshCore Mapper should become a map-first network planning workstation:

- Plan repeater networks.
- Understand why coverage succeeds or fails at a point.
- Compare scenarios and node/radio changes.
- Optimize placement under realistic constraints.
- Validate important point-to-point and relay links.
- Export useful maps, GIS data, and planning reports.
- Support cached/offline preparation for field work.

## Agent Guardrails

- Do not rewrite physics casually. Add failing tests first for any physics
  change.
- Prefer small, verifiable improvements over broad refactors.
- Keep UI changes consistent with a map-first planning workflow.
- Avoid adding speculative settings or abstractions without a concrete workflow.
- Preserve existing project data formats unless the task explicitly includes a
  migration plan.
- When touching trust boundaries, prefer schema validation over hand-rolled
  ad hoc checks.
- For every feature, define the user question it answers.

## Priority Ladder

If no more specific task is given, prioritize in this order:

1. Coverage click inspector with loss/explanation breakdown.
2. Coverage layer and scenario manager improvements.
3. Combined network coverage, gap, and redundancy analysis.
4. Optimizer V2 with real planning constraints.
5. Map-first redesign with contextual inspector and job drawer.
6. Typed core/state architecture migration.
7. Reports, offline preparation, and live network health.

## Progress Log

### 2026-06-30

- Continued Phase 6 incremental UI rewrite on branch
  `codex/phase-6-job-drawer-view`:
  - added `src/jobDrawerView.ts` as the typed view boundary for job drawer
    labels, history HTML, snapshot rendering, and cancel-button state
  - `src/ui.ts` now delegates job drawer DOM rendering to the helper while
    keeping the existing job store, progress overlay, and cancel/dismiss
    control wiring intact
  - added direct view-helper tests for escaped history rows, drawer snapshot
    updates, state labels, and history visibility
- Focused Phase 6 job-drawer verification passed:
  - `npx vitest run tests/unit/jobDrawerView.test.js tests/unit/ui.test.js`
  - `npm run typecheck`
  - `npm run lint`
- Full Phase 6 job-drawer verification passed:
  - `npm run check` (77 unit files, 441 unit tests, 15 smoke tests, 0
    production audit vulnerabilities)
- Continued Phase 6 incremental UI rewrite on branch
  `codex/phase-6-progress-overlay-view`:
  - added `src/progressOverlayView.ts` as the typed view boundary for the
    shared progress overlay shell, fill/message updates, and hide state
  - `src/ui.ts` now delegates progress overlay DOM rendering to the helper
    while keeping progress lifecycle, cancel wiring, and job-store integration
    intact
  - added direct view-helper tests for overlay creation, progress rendering,
    message preservation, and hide behavior
- Focused Phase 6 progress-overlay verification passed:
  - `npx vitest run tests/unit/progressOverlayView.test.js tests/unit/ui.test.js`
  - `npm run typecheck`
  - `npm run lint`
- Full Phase 6 progress-overlay verification passed:
  - `npm run check` (78 unit files, 445 unit tests, 15 smoke tests, 0
    production audit vulnerabilities)
- Continued Phase 4.1 contextual-inspector multi-selection on branch
  `codex/phase-4-marker-multi-select`:
  - added `src/nodeSelectionEvents.ts` as the shared click-selection helper
    for ordinary node selection and modifier-click multi-selection
  - marker clicks and node-list row clicks now use the same selection-event
    planner, so Shift/Ctrl/Cmd marker clicks can add/remove nodes from the
    selected-node set without opening the marker context menu
  - added direct helper tests for single-node selection, modifier multi-select,
    string-equivalent toggling, and missing-id handling
- Focused Phase 4.1 marker multi-selection verification passed:
  - `npx vitest run tests/unit/nodeSelectionEvents.test.js tests/unit/selectionStore.test.js tests/unit/nodeListView.test.js tests/unit/mapContext.test.js`
  - `npm run typecheck`
  - `npm run lint`
- Full Phase 4.1 marker multi-selection verification passed:
  - `npm run check` (79 unit files, 450 unit tests, 15 smoke tests, 0
    production audit vulnerabilities)
- Continued Phase 4.1 contextual-inspector multi-selection on branch
  `codex/phase-4-node-range-selection`:
  - node-list Shift-click now selects the visible sorted range from the current
    selection anchor while Ctrl/Cmd keeps toggling individual nodes
  - range selection uses `nodeListView` row ordering, so active filter and sort
    settings define the range users see
  - marker modifier-clicks keep the existing toggle behavior because map
    markers do not have a displayed list range
- Focused Phase 4.1 node-range verification passed:
  - `npx vitest run tests/unit/nodeSelectionEvents.test.js tests/unit/nodeListView.test.js tests/unit/selectionStore.test.js tests/unit/mapContext.test.js`
  - `npm run typecheck`
  - `npm run lint`
- Full Phase 4.1 node-range verification passed:
  - `npm run check` (79 unit files, 453 unit tests, 15 smoke tests, 0
    production audit vulnerabilities)
- Continued Phase 3.1 redundancy objective depth on branch
  `codex/phase-3-redundancy-coverage-counts`:
  - CPU optimizer scoring now tracks per-cell coverage counts instead of only
    boolean covered/uncovered state
  - Redundancy First still reports raw redundant area, but its score component
    weights first-backup coverage above repeatedly stacked backups on already
    multiply-covered cells
  - added a regression test where first-backup coverage beats a candidate that
    would only add another copy to a double-covered cell
- Focused Phase 3.1 redundancy-depth verification passed:
  - `npx vitest run tests/unit/optimizer.test.js tests/unit/optimizerResultDetails.test.js tests/unit/optimizerPanelView.test.js`
  - `npm run typecheck`
  - `npm run lint`
- Full Phase 3.1 redundancy-depth verification passed:
  - `npm run check` (79 unit files, 454 unit tests, 15 smoke tests, 0
    production audit vulnerabilities)
- Continued Phase 3.1 redundancy objective context on branch
  `codex/phase-3-redundancy-visible-context`:
  - added a shared optimizer helper for deciding when visible mesh coverage
    context is needed
  - Redundancy First now pulls visible existing-node context without requiring
    the separate Gap Aware toggle
  - core CPU scoring also initializes existing coverage for Redundancy First
    whenever existing nodes are supplied, matching the UI context decision
- Focused Phase 3.1 redundancy-context verification passed:
  - `npx vitest run tests/unit/optimizer.test.js tests/unit/optimizerBackend.test.js tests/unit/settings.test.js`
  - `npm run typecheck`
  - `npm run lint`
- Full Phase 3.1 redundancy-context verification passed:
  - `npm run check` (79 unit files, 456 unit tests, 15 smoke tests, 0
    production audit vulnerabilities)
- Continued Phase 6 incremental UI rewrite on branch
  `codex/phase-6-dev-console-view`:
  - added `src/devConsoleView.ts` as the typed view boundary for developer
    console row creation, output trimming, clear behavior, and collapse labels
  - `src/devConsole.ts` now keeps console capture/binding behavior while
    delegating DOM rendering and output state updates to the helper
  - added direct view-helper tests for row formatting, capped append/scroll,
    clearing, and collapsed-state labels
- Focused Phase 6 dev-console verification passed:
  - `npx vitest run tests/unit/devConsoleView.test.js tests/unit/devConsole.test.js`
  - `npm run typecheck`
  - `npm run lint`
- Full Phase 6 dev-console verification passed:
  - `npm run check` (80 unit files, 460 unit tests, 15 smoke tests, 0
    production audit vulnerabilities)
- Continued Phase 3.1 CUDA redundancy parity on branch
  `codex/phase-3-cuda-redundancy-depth`:
  - CUDA redundancy scoring now tracks coverage depth across placed CUDA
    suggestions instead of keeping only a boolean covered mask
  - CUDA Redundancy First weights first-backup coverage above repeatedly
    stacked backups for supported no-existing-node searches, matching the CPU
    redundancy-depth objective behavior
  - CUDA still reports raw redundant point counts/ratios while using the
    weighted redundancy score for candidate ranking
- Focused Phase 3.1 CUDA redundancy-depth verification passed:
  - `npx vitest run tests/unit/cudaKernelParity.test.js tests/unit/optimizerBackend.test.js`
  - `npm run typecheck`
  - `npm run lint`
- Full Phase 3.1 CUDA redundancy-depth verification passed:
  - `npm run check` (80 unit files, 460 unit tests, 15 smoke tests, 0
    production audit vulnerabilities)
- Continued Phase 3.1 CUDA redundancy-target parity on branch
  `codex/phase-3-cuda-redundancy-target`:
  - CUDA backend selection now allows `minRedundancyRatio` payloads when no
    existing-node diagnostics are required
  - CUDA optimizer scoring activates redundant-cell evaluation for either
    Redundancy First or a finite redundancy target, then filters candidates
    below the raw redundancy target
  - CUDA target filtering reports `rejectedByRedundancy`, candidate scoring
    counts, final coverage, and the clamped target in stats so no-result runs
    still explain themselves
  - target-only CUDA runs keep non-redundancy objectives scored by new
    coverage unless the selected objective is Redundancy First
- Focused Phase 3.1 CUDA redundancy-target verification passed:
  - `python -m py_compile scripts\meshcore_cuda\optimizer.py`
  - `npx vitest run tests/unit/cudaKernelParity.test.js tests/unit/optimizerBackend.test.js`
  - `npm run typecheck`
  - `npm run lint`
- Full Phase 3.1 CUDA redundancy-target verification passed:
  - `npm run check` (80 unit files, 461 unit tests, 15 smoke tests, 0
    production audit vulnerabilities)
- Continued Phase 6 incremental UI rewrite on branch
  `codex/phase-6-pathfinder-endpoints-view`:
  - added `src/pathfinderEndpointView.ts` as the typed view boundary for Best
    Relay Path endpoint select options, empty state, saved-selection restore,
    and FROM/TO de-duplication
  - `src/pathfinderUI.ts` now delegates endpoint select rendering to the helper
    while keeping path picking, map layers, and recompute behavior intact
  - added direct view-helper tests for sorted option models, no-node rendering,
    saved endpoint preservation, and duplicate-endpoint correction
- Focused Phase 6 pathfinder-endpoints verification passed:
  - `npx vitest run tests/unit/pathfinderEndpointView.test.js tests/unit/pathfinderResultView.test.js tests/unit/pathfinder.test.js`
  - `npm run typecheck`
  - `npm run lint`
- Full Phase 6 pathfinder-endpoints verification passed:
  - `npm run check` (81 unit files, 465 unit tests, 15 smoke tests, 0
    production audit vulnerabilities)

### 2026-06-16

- Continued Phase 4.1 contextual-inspector multi-selection on branch
  `codex/phase-4-multi-node-selection`:
  - the selection store now supports stable de-duplicated multi-node
    selections while preserving existing single-node selection details
  - node-list rows can highlight multiple selected nodes
  - modifier-clicking node-list rows emits multi-node selection events
  - the right inspector now renders a selected-nodes summary with visible/live
    counts, selected names, an Open Nodes action, a View 3D action, and Clear
  - repeaters keep marker/list highlights synchronized from both single-node
    and multi-node `selection:changed` events
- Focused Phase 4.1 multi-node selection verification passed:
  - `npx vitest run tests/unit/selectionStore.test.js tests/unit/nodeListView.test.js tests/unit/mapContext.test.js`
  - `npm run typecheck`
  - `npm run lint`
- Full Phase 4.1 multi-node selection verification passed:
  - `npm run check` (76 unit files, 437 unit tests, 15 smoke tests, 0
    production audit vulnerabilities)
- Completed the remaining Phase 1.2 warning-presentation acceptance slice on
  branch `codex/phase-1-warning-presentation`:
  - added `src/coverageWarnings.ts` as the shared presentation helper for
    normalizing coverage warning payloads, count labels, detail text, title
    lines, and warning detail rows
  - coverage metadata, layer-manager detail rows, and planning reports now use
    the same warning normalization and display text instead of local joins or
    ad hoc label checks
  - restored layers with string warnings and reports with blank/trimmed warning
    arrays now render consistently
- Focused Phase 1.2 warning-presentation verification passed:
  - `npx vitest run tests/unit/coverageWarnings.test.js tests/unit/coverageMetadata.test.js tests/unit/coverageLayerManagerView.test.js tests/unit/planningReport.test.js`
  - `npm run typecheck`
  - `npm run lint`
- Full Phase 1.2 warning-presentation verification passed:
  - `npm run check` (76 unit files, 434 unit tests, 15 smoke tests, 0
    production audit vulnerabilities)
- Continued Phase 3.1 CUDA objective parity on branch
  `codex/phase-3-cuda-redundancy-objective`:
  - the renderer optimizer backend now allows CUDA execution for the
    Redundancy First objective when CPU-only diagnostics are not required
  - CUDA still falls back to CPU for source-linked runs, existing-node
    gap-aware diagnostics, redundancy targets, exclusion zones, high-ground,
    road-adjacent, and minimum-elevation constraints
  - the CUDA optimizer kernel can score already-covered cells when redundancy
    scoring is active instead of always skipping them
  - the CUDA helper ranks redundancy candidates with weighted new/redundant
    coverage counts and returns coverage/redundancy ratios plus point counts
    for result panels and reports
  - the lockfile now resolves `js-yaml` to a patched production version after
    the release audit began flagging the prior resolved version
- Focused Phase 3.1 CUDA redundancy-objective verification passed:
  - `npx vitest run tests/unit/optimizerBackend.test.js tests/unit/cudaKernelParity.test.js`
  - `npm run typecheck`
  - `npm run lint`
  - `python -m py_compile scripts/meshcore_cuda/optimizer.py scripts/meshcore_cuda/optimizer_kernel_source.py`
- Full Phase 3.1 CUDA redundancy-objective verification passed:
  - `npm run check` (75 unit files, 432 unit tests, 15 smoke tests, 0
    production audit vulnerabilities)

### 2026-06-14

- Completed the remaining Phase 2.2 network-statistics acceptance slice on
  branch `codex/phase-2-network-contribution-stats`:
  - combined visible-network summaries now keep a complete per-node
    contribution breakdown keyed by source node, while preserving the compact
    top-serving headline
  - the Coverage panel's Network Stats details view now lists full node
    contributions, not only the top three serving nodes
  - report/GIS export metadata now includes the full `nodeContributions`
    snapshot alongside the existing `topServing` summary
  - planning reports format the node-contribution list as a readable
    network-stat row
- Focused Phase 2.2 network-contribution verification passed:
  - `npx vitest run tests/unit/coverageNetwork.test.js tests/unit/coverageNetworkSummaryView.test.js tests/unit/planningReport.test.js`
  - `npm run typecheck`
  - `npm run lint`
- Started Phase 6 incremental UI rewrite on branch
  `codex/phase-6-coverage-layer-manager`.
- Extracted the coverage layer manager view boundary:
  - added `src/coverageLayerManagerView.ts`
  - `coverage.ts` now delegates coverage-layer empty/group/layer row rendering,
    metadata details, warning row flags, and layer action control creation to
    the dedicated view helper
  - existing coverage workflow callbacks remain in `coverage.ts`, so layer
    visibility, opacity, rename, use-settings, recompute, and delete behavior
    are preserved
  - added `tests/unit/coverageLayerManagerView.test.js` for empty, grouped,
    legacy fallback, opacity/visibility, metadata title, detail-row, and
    warning states
- Focused Phase 6 coverage-layer manager verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/coverageLayerManagerView.test.js tests/unit/coverageMetadata.test.js tests/unit/coveragePersistence.test.js`
  - `npm run build`
- Full Phase 6 slice verification passed:
  - `npm run check` (62 unit files, 367 unit tests, 15 smoke tests, 0 audit
    vulnerabilities)
- Extracted the coverage inspector view boundary:
  - added `src/coverageInspectorView.ts`
  - `mapContext.ts` now supplies coverage-inspector input data while the new
    helper renders map-point popup content, right-inspector content, coverage
    rows, empty states, metric formatting, and modeled-loss breakdowns
  - selection-store transitions, inspector action dispatch, map popup wiring,
    and existing DOM action attributes remain in `mapContext.ts`
  - added `tests/unit/coverageInspectorView.test.js` for formatting, escaped
    weak-row output, empty states, visible coverage rows, and inspector actions
- Focused Phase 6 coverage-inspector verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/coverageInspectorView.test.js tests/unit/mapContext.test.js tests/unit/coveragePoint.test.js`
- Full Phase 6 coverage-inspector verification passed:
  - `npm run check` (63 unit files, 371 unit tests, 15 smoke tests, 0 audit
    vulnerabilities)
- Started the node list/editor migration with the node list rendering boundary:
  - added `src/nodeListView.ts`
  - `repeaters.ts` now delegates node-list empty/filter states, name sorting,
    live/manual row summaries, hidden/selected/editing row classes, and row
    action control markup to the dedicated view helper
  - repeater CRUD, map marker ownership, live WebSocket syncing, edit-mode
    form behavior, and delegated list actions remain in `repeaters.ts`
  - added `tests/unit/nodeListView.test.js` for empty, filtered-empty,
    sorting, hidden/selected/editing classes, live metadata, and filter fields
- Focused Phase 6 node-list verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/nodeListView.test.js tests/unit/repeaterRows.test.js tests/unit/mapContext.test.js`
- Full Phase 6 node-list verification passed:
  - `npm run check` (64 unit files, 376 unit tests, 15 smoke tests, 0 audit
    vulnerabilities)
- Completed the node list/editor migration boundary:
  - added `src/nodeEditorView.ts`
  - `repeaters.ts` now delegates edit-form value hydration, add/edit/placing
    button states, placement hint visibility, and editor-panel opening to the
    dedicated view helper
  - add/update validation, marker updates, map placement, live feed, undo,
    and event dispatching remain in `repeaters.ts`
  - added `tests/unit/nodeEditorView.test.js` for repeater-to-form values,
    stale preset clearing, add/edit/placing control states, and panel opening
- Focused Phase 6 node-editor verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/nodeEditorView.test.js tests/unit/nodeListView.test.js tests/unit/repeaterRows.test.js tests/unit/mapContext.test.js`
- Full Phase 6 node-editor verification passed:
  - `npm run check` (65 unit files, 380 unit tests, 15 smoke tests, 0 audit
    vulnerabilities)
- Extracted the P2P result-panel view boundary:
  - added `src/p2pResultView.ts`
  - `p2p.ts` now delegates budget row construction, warning markup,
    budget/profile tab shell markup, profile action markup, and link status
    text to the dedicated result-panel helper
  - P2P picking, endpoint dragging, active link state, tab click binding,
    fullscreen profile behavior, PNG export, and link-budget calculation remain
    in `p2p.ts`
  - added `tests/unit/p2pResultView.test.js` for budget rows, obstacle/shadow
    fading/Monte Carlo rows, escaped warnings, profile actions, and OK/failed
    status text
- Focused Phase 6 P2P result-panel verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/p2pResultView.test.js tests/unit/linkBudget.test.js tests/unit/terrainProfileView.test.js tests/unit/mapContext.test.js`
- Full Phase 6 P2P result-panel verification passed:
  - `npm run check` (66 unit files, 384 unit tests, 15 smoke tests, 0 audit
    vulnerabilities)
- Started the optimizer panel migration with the optimizer result-list
  boundary:
  - added `src/optimizerPanelView.ts`
  - `optimizerUI.ts` now delegates candidate row markup, marker popup markup,
    shared detail escaping, and diagnostic row markup to the dedicated panel
    helper
  - optimizer drawing, candidate markers, selection events, backhaul previews,
    suggested-node add actions, backend orchestration, and completion status
    remain in `optimizerUI.ts`
  - added `tests/unit/optimizerPanelView.test.js` for candidate rows, marker
    popup content, objective formulas, diagnostics, and clean-run diagnostic
    suppression
- Focused Phase 6 optimizer result-list verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/optimizerPanelView.test.js tests/unit/optimizerResultDetails.test.js tests/unit/optimizerDiagnostics.test.js tests/unit/mapContext.test.js`
- Full Phase 6 optimizer result-list verification passed:
  - `npm run check` (67 unit files, 388 unit tests, 15 smoke tests, 0 audit
    vulnerabilities)
- Started the settings/cache panel migration with the cache summary boundary:
  - added `src/cacheStatsView.ts`
  - `config.ts` now delegates cache count formatting and unavailable fallback
    text to the dedicated settings/cache view helper
  - cache IPC calls, warm/cancel behavior, purge actions, project save/load,
    and settings persistence remain in `config.ts`
  - added `tests/unit/cacheStatsView.test.js` for formatted cache counts,
    invalid/missing count normalization, and fallback text
- Focused Phase 6 settings/cache verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/cacheStatsView.test.js tests/unit/config.test.js tests/unit/settings.test.js`
- Full Phase 6 settings/cache verification passed:
  - `npm run check` (68 unit files, 391 unit tests, 15 smoke tests, 0 audit
    vulnerabilities)
- Extracted the 3D view controls boundary:
  - added `src/map3dView.ts`
  - `map3d.ts` now delegates 2D/3D mode classes, tab ARIA state,
    refresh-button busy state, focus metadata attributes, terrain panel
    attributes, retile count attributes, scene-stat attributes, and fullscreen
    routing to the dedicated view helper
  - Three.js scene ownership, camera control, terrain refresh, map texture
    loading, retile scheduling, and overlay rendering remain in `map3d.ts`
  - added `tests/unit/map3dView.test.js` for mode toggles, refresh busy
    state, smoke-facing panel attributes, stat normalization, retile count, and
    fullscreen routing
- Focused Phase 6 3D controls verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/map3dView.test.js tests/unit/terrain3dModel.test.js`
- Full Phase 6 3D controls verification passed:
  - `npm run check` (69 unit files, 396 unit tests, 15 smoke tests, 0 audit
    vulnerabilities)
- Extracted the coverage network-summary view boundary:
  - added `src/coverageNetworkSummaryView.ts`
  - `coverage.ts` now delegates combined-network summary view models, metric
    formatting, detailed stats rows, critical-node rows, simulation-banner
    markup, and simulation action rendering to the dedicated view helper
  - combined coverage math, simulated-offline state, tile visibility, and
    combined-overlay recompute ownership remain in `coverage.ts` and
    `coverageNetwork.ts`
  - added `tests/unit/coverageNetworkSummaryView.test.js` for empty/hidden
    states, ready metrics, top-serving rows, critical-node actions, simulation
    callbacks, stat fallbacks, and stable CSS classes
- Focused Phase 6 coverage network-summary verification passed:
  - `npm run typecheck`
  - `npm run lint`
  - `npx vitest run tests/unit/coverageNetworkSummaryView.test.js tests/unit/coverageNetwork.test.js tests/unit/coverageLayerManagerView.test.js`
- Full Phase 6 coverage network-summary verification passed:
  - `npm run check` (70 unit files, 401 unit tests, 15 smoke tests, 0 audit
    vulnerabilities)
- Extracted the relay path result view boundary:
  - added `src/pathfinderResultView.ts`
  - `pathfinderUI.ts` now delegates relay hop color selection, map-label
    formatting, result table markup, escaped node-name output, and path status
    text to the dedicated result helper
  - relay path search orchestration, Leaflet line/marker ownership, selected
    path-link dispatch, progress/cancel handling, and map fitting remain in
    `pathfinderUI.ts`
  - added `tests/unit/pathfinderResultView.test.js` for margin color
    thresholds, tooltip labels, escaped result rows, bottleneck styling, and
    success/marginal/blocked status text
- Focused Phase 6 relay path result verification passed:
  - `npm run typecheck`
  - `npm run lint`
  - `npx vitest run tests/unit/pathfinderResultView.test.js tests/unit/pathfinder.test.js tests/unit/mapContext.test.js`
- Full Phase 6 relay path result verification passed:
  - `npm run check` (71 unit files, 405 unit tests, 15 smoke tests, 0 audit
    vulnerabilities)
- Started Phase 7.1 planning reports on branch
  `codex/phase-7-planning-report`:
  - added `src/planningReport.ts` as a pure HTML report builder for
    reproducible planning summaries
  - Settings now has `Export Planning Report (HTML)` and
    `Export Planning Report (PDF)` actions that capture the current map
    screenshot, embed it into the report, and save through Electron IPC
  - reports include node tables, coverage/network statistics, weak-area
    metrics, active P2P and relay critical-link summaries, optimizer
    recommendations from the latest optimizer run, settings, and data-quality
    notes
  - added screenshot data-URL IPC and hidden-window PDF rendering for report
    exports without changing the existing PNG screenshot save workflow
  - added `tests/unit/planningReport.test.js` coverage for escaping, empty
    states, screenshot handling, coverage warnings, links, and optimizer rows
- Focused Phase 7.1 planning-report verification passed:
  - `npx vitest run tests/unit/planningReport.test.js tests/unit/ipcHandlers.test.js tests/unit/config.test.js`
  - `npm run typecheck`
  - `npm run lint`
- Full Phase 7.1 planning-report verification passed:
  - `npm run check` (72 unit files, 409 unit tests, 15 smoke tests, 0 audit
    vulnerabilities)
- Started Phase 7.2 GIS exports on branch `codex/phase-7-gis-exports`:
  - added `src/gisExport.ts` for bounded coverage polygon GeoJSON, KML, and
    KMZ generation
  - Settings now exposes combined-network polygon GeoJSON, per-node polygon
    GeoJSON, combined KML, and combined KMZ export actions while preserving the
    existing point GeoJSON export
  - added a generic binary export IPC path for KMZ bytes; text exports continue
    through the existing `exportFile` IPC path
  - GIS exports carry scope, source-layer count, stride/downsampling metadata,
    generation time, and visible-network stats
  - added `tests/unit/gisExport.test.js` for per-node polygons, combined
    strongest-source polygons, downsampling metadata, escaped KML, and KMZ ZIP
    structure
- Focused Phase 7.2 GIS-export verification passed:
  - `npx vitest run tests/unit/gisExport.test.js tests/unit/config.test.js tests/unit/ipcHandlers.test.js`
  - `npm run typecheck`
  - `npm run lint`
- Full Phase 7.2 GIS-export verification passed:
  - `npm run check` (73 unit files, 415 unit tests, 15 smoke tests, 0 audit
    vulnerabilities)
- Started Phase 7.3 offline area preparation on branch
  `codex/phase-7-offline-prep`:
  - added `src/offlinePrepView.ts` for selected-area formatting and
    data-type readiness text
  - Settings now has an Offline prep area block with Use Viewport, Prepare
    Area, and Cancel controls
  - Prepare Area prefetches DEM terrain, foliage, and building data for the
    chosen viewport area using the existing cache-backed fetch paths
  - readiness text now calls out terrain DEM, foliage, buildings, and map tiles
    separately; map tiles are explicitly marked online-only
  - added `tests/unit/offlinePrepView.test.js` and smoke coverage for the new
    Settings controls
- Focused Phase 7.3 offline-prep verification passed:
  - `npx vitest run tests/unit/offlinePrepView.test.js tests/unit/config.test.js tests/unit/cacheStatsView.test.js`
  - `npm run typecheck`
  - `npm run lint`
- Full Phase 7.3 offline-prep verification passed:
  - `npm run check` (74 unit files, 420 unit tests, 15 smoke tests, 0 audit
    vulnerabilities)
- Started Phase 7.4 live network health on branch `codex/phase-7-live-health`:
  - added `src/liveHealth.ts` for planned/live/stale/missing node health
    classification and live-feed summary counts
  - node rows now show health badges and live age text; stale and missing live
    nodes get distinct row classes
  - map marker strokes now indicate fresh live, stale, missing, and planned
    states while preserving selected-node highlighting
  - the live feed panel shows an aggregate health summary with alert styling
    when stale or missing live nodes exist
  - the persistent node inspector now includes live health details for selected
    live-feed nodes
  - added `tests/unit/liveHealth.test.js` plus updated node-list,
    map-context, and smoke coverage for the health UI
- Focused Phase 7.4 live-health verification passed:
  - `npx vitest run tests/unit/liveHealth.test.js tests/unit/nodeListView.test.js tests/unit/mapContext.test.js tests/unit/liveFeedStore.test.js`
  - `npm run typecheck`
  - `npm run lint`
- Full Phase 7.4 live-health verification passed:
  - `npm run check` (75 unit files, 427 unit tests, 15 smoke tests, 0 audit
    vulnerabilities)
- Continued Phase 5 schema hardening on the active branch
  `codex/phase-5-roadmap-typescript`.
- Extracted persisted settings schema helpers:
  - added `src/settingsSchema.ts`
  - `restoreSettings()` now parses localStorage settings through a pure schema
    helper before applying UI control values
  - saved project config parsing now reuses the same settings-record parser
  - unknown localStorage setting keys are ignored when an allowlist is supplied;
    malformed JSON and non-object roots are ignored rather than passed to UI
    writers
- Focused persisted-settings schema verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/settingsSchema.test.js tests/unit/configSchema.test.js tests/unit/config.test.js tests/unit/settings.test.js`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Extracted preset YAML schema helpers:
  - added `src/presetsSchema.ts`
  - `presets.ts` now validates IPC/YAML preset payloads before populating
    hardware, radio-mode, and antenna selects
  - malformed preset roots fall back completely; malformed or empty preset
    groups fall back independently so valid custom groups are preserved
  - direct schema tests cover non-object roots, per-group fallback, numeric
    coercion, and invalid optional radio frequencies
  - renderer initialization tests cover mixed valid/malformed custom preset
    payloads at the select/input wiring boundary
- Focused preset schema verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/presetsSchema.test.js tests/unit/presets.test.js tests/unit/settings.test.js`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Extracted CUDA payload schema helpers:
  - added `src/main/cudaSchemas.ts`
  - `cudaCoverage.ts` now delegates CUDA coverage/optimizer payload coercion,
    bounds checks, candidate coordinate packing, and foliage/building obstacle
    serialization to pure schema helpers
  - CUDA subprocess/file handling remains in `cudaCoverage.ts`, keeping Python
    progress/result parsing separate from request validation
  - direct schema tests cover coverage grid normalization, length mismatch
    rejection, optimizer candidate/bounds normalization, GPU scoring-pass size
    rejection, and obstacle payload serialization
  - existing CUDA payload-limit regression tests now read the schema module
    where packed-size caps live
- Focused CUDA schema verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/cudaSchemas.test.js tests/unit/cudaPayloadLimits.test.js tests/unit/cudaCoverageLineParser.test.js tests/unit/ipcHandlers.test.js`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Extracted an explicit active-job store:
  - added `src/jobStore.ts`
  - `ui.ts` now renders job drawer snapshots from the store instead of owning
    active job metadata, ETA parsing, elapsed-time formatting, completion
    summaries, and capped history directly
  - existing progress overlay and job drawer DOM IDs/text behavior remain
    unchanged
  - direct store tests cover elapsed formatting, ETA parsing, running/completed
    snapshots with metadata, and newest-first capped history
- Focused job-store verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/jobStore.test.js tests/unit/ui.test.js tests/unit/coveragePoint.test.js tests/unit/settings.test.js`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Extracted an explicit selected-object store:
  - added `src/selectionStore.ts`
  - `mapContext.ts` now uses store transitions for map point, node, P2P/relay
    link, optimizer candidate, and obstacle selection state
  - selection event detail derivation and stale link/node clearing now live in
    the store instead of scattered module-level fields
  - inspector rendering, existing DOM actions, and map popup behavior remain
    unchanged
  - direct store tests cover initial summary state, one-kind-at-a-time
    selection, candidate/obstacle details, and stale link/node clears
- Focused selected-object store verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/selectionStore.test.js tests/unit/mapContext.test.js tests/unit/ui.test.js tests/unit/coveragePoint.test.js`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Completed remaining Phase 5 store and runner extraction:
  - added `src/liveFeedStore.ts` for WebSocket connection and live-imported
    repeater ID state
  - added `src/settingsStore.ts` so settings gather/apply/persist/restore
    orchestration is explicit and localStorage parsing remains schema-backed
  - added `src/repeaterStore.ts` and `src/coverageStore.ts` as backing stores
    for `state.repeaters`, `state.nextId`, `state.coverageLayers`, and
    `state.coverageResults` while preserving the existing `state.*` API
  - added `src/jobRunner.ts` for shared CPU/CUDA fallback order, abort
    handling, unsupported-backend reporting, and all-backends-failed errors
  - `coverageBackend.ts` and `optimizerBackend.ts` now use the shared runner
    while keeping backend-specific validation and worker/CUDA calls unchanged
- Focused final Phase 5 verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/liveFeedStore.test.js tests/unit/repeaterRows.test.js tests/unit/config.test.js tests/unit/mapContext.test.js`
  - `npx vitest run tests/unit/settingsStore.test.js tests/unit/settingsSchema.test.js tests/unit/config.test.js tests/unit/settings.test.js`
  - `npx vitest run tests/unit/repeaterStore.test.js tests/unit/coverageStore.test.js tests/unit/map.test.js tests/unit/mapContext.test.js tests/unit/config.test.js tests/unit/coveragePersistence.test.js`
  - `npx vitest run tests/unit/jobRunner.test.js tests/unit/backend.test.js tests/unit/optimizer.test.js tests/unit/cudaSchemas.test.js tests/unit/coveragePoint.test.js`
  - `npm run build`
- Phase 5 acceptance verification passed:
  - `npm run check` (61 unit files, 363 unit tests, 15 smoke tests, 0 audit
    vulnerabilities)

### 2026-06-13

- Continued Phase 5 TypeScript migration on the active branch
  `codex/phase-5-roadmap-typescript`.
- Ported building/structure obstacle service helpers to TypeScript:
  - `src/buildings.js` is now `src/buildings.ts`
  - building tile indexes, tile payloads, OSM tags/elements/members,
    structure classifications, Overpass responses, DSM-DEM derivation samples,
    fetch options, and attenuation inputs are explicit TypeScript types
  - Overpass query construction, memory/SQLite tile cache behavior,
    multipolygon/linear-wall extraction, DSM-DEM building-height fallback,
    spatial indexing, and building attenuation behavior are unchanged
- Focused building migration verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/buildings.test.js tests/unit/signalModel.test.js tests/unit/linkBudget.test.js tests/unit/config.test.js`
  - `npx eslint tests/unit/buildings.test.js tests/unit/signalModel.test.js tests/unit/linkBudget.test.js tests/unit/config.test.js src/coverage.js src/optimizer.js src/p2p.js src/mapContext.js`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Ported map selection/context inspector helpers to TypeScript:
  - `src/mapContext.js` is now `src/mapContext.ts`
  - map point, node, obstacle, P2P/path link, optimizer candidate, selection
    event, and 3D focus payload shapes are explicit local TypeScript types
  - popup/inspector rendering, action dispatch, selection refresh, and stable
    `.js` imports from P2P/repeaters/optimizer/map-layer consumers are
    unchanged
- Focused map-context migration verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/mapContext.test.js tests/unit/ui.test.js tests/unit/pathfinder.test.js tests/unit/settings.test.js`
  - `npx eslint tests/unit/mapContext.test.js tests/unit/ui.test.js tests/unit/pathfinder.test.js tests/unit/settings.test.js src/p2p.js src/repeaters.js src/optimizerUI.js src/coverage.js src/map3d.js`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Ported repeater CRUD, marker, and live-feed helpers to TypeScript:
  - `src/repeaters.js` is now `src/repeaters.ts`
  - repeater records, Leaflet marker handles, live WebSocket rows, add/remove
    options, undo snapshots, marker/map click events, and refresh options are
    explicit TypeScript types
  - node CRUD, drag updates, selection highlighting, context-menu actions,
    live-feed sync/persistence, undo, visibility toggles, and stable `.js`
    imports from P2P/optimizer/config consumers are unchanged
- Focused repeater migration verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/config.test.js tests/unit/mapContext.test.js tests/unit/settings.test.js tests/unit/eirp.test.js`
  - `npx eslint tests/unit/config.test.js tests/unit/mapContext.test.js tests/unit/settings.test.js tests/unit/eirp.test.js src/p2p.js src/optimizerUI.js src/coverage.js src/map3d.js`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Ported P2P picking/profile UI helpers to TypeScript:
  - `src/p2p.js` is now `src/p2p.ts`
  - P2P endpoints, active link state, Leaflet marker/polyline handles,
    repeater endpoint payloads, abort errors, click events, and link-budget
    result rendering are explicit TypeScript types
  - point picking, draggable endpoints, active link selection, profile
    fullscreen/export, directional coverage dispatch, repeater-move refresh,
    and stable `.js` imports from repeaters/map-context consumers are
    unchanged
- Focused P2P migration verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/linkBudget.test.js tests/unit/settings.test.js tests/unit/mapContext.test.js tests/unit/pathfinder.test.js`
  - `npx eslint tests/unit/linkBudget.test.js tests/unit/settings.test.js tests/unit/mapContext.test.js tests/unit/pathfinder.test.js src/coverage.js src/optimizerUI.js src/map3d.js src/optimizer.js`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Ported optimizer scoring and objective helpers to TypeScript:
  - `src/optimizer.js` is now `src/optimizer.ts`
  - optimizer bounds, transmitter parameters, source/backhaul nodes, scoring
    options, objective definitions, scoring stats, coverage scores, backhaul
    scores, and breakdown inputs are explicit TypeScript types
  - objective normalization, grid/refined-grid generation, candidate scoring,
    source-link/backhaul checks, road-adjacency scoring, prominence scoring,
    and stable worker/UI `.js` imports are unchanged
- Focused optimizer migration verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/optimizer.test.js tests/unit/backend.test.js tests/unit/settings.test.js tests/unit/optimizerDiagnostics.test.js`
  - `npx eslint tests/unit/optimizer.test.js tests/unit/backend.test.js tests/unit/settings.test.js tests/unit/optimizerDiagnostics.test.js src/coverage.js src/optimizerUI.js src/map3d.js`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Ported the 3D terrain view shell to TypeScript:
  - `src/map3d.js` is now `src/map3d.ts`
  - added dev-only `@types/three` so the Three.js renderer, scene, geometry,
    texture, material, camera, controls, raycaster, and vector handles can use
    real declarations
  - terrain state, scene stats, camera view snapshots, focus events,
    obstruction polygons, projected polygons, coverage texture results, link
    overlays, retile centers, DOM control reads, and abort/error handling are
    explicit TypeScript types
  - 3D scene setup, terrain refresh, DEM fallback preview terrain, obstruction
    rendering, node/link/coverage overlays, mirrored map textures, retile
    behavior, and stable `.js` imports from app/map consumers are unchanged
- Focused 3D migration verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/terrain3dModel.test.js tests/unit/mapTileTexture.test.js tests/unit/mapContext.test.js`
  - `npx eslint tests/unit/terrain3dModel.test.js tests/unit/mapTileTexture.test.js tests/unit/mapContext.test.js src/coverage.js src/optimizerUI.js`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Ported optimizer planning UI bindings to TypeScript:
  - `src/optimizerUI.js` is now `src/optimizerUI.ts`
  - source nodes, candidate results, enriched optimizer options, drawn search /
    coverage / exclusion bounds, Leaflet layer handles, marker events, custom
    candidate/selection events, backhaul previews, progress callbacks, and
    abort/error handling are explicit TypeScript types
  - drawing search and coverage areas, exclusion zones, source-linked optimizer
    shortcuts, candidate list rendering, add-node actions, backhaul preview,
    backend selection, elevation/road/obstacle prefetching, diagnostics, and
    stable `.js` imports from the app shell are unchanged
- Focused optimizer UI migration verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/optimizer.test.js tests/unit/optimizerDiagnostics.test.js tests/unit/optimizerResultDetails.test.js tests/unit/settings.test.js tests/unit/mapContext.test.js`
  - `npx eslint tests/unit/optimizer.test.js tests/unit/optimizerDiagnostics.test.js tests/unit/optimizerResultDetails.test.js tests/unit/settings.test.js tests/unit/mapContext.test.js src/coverage.js`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Ported coverage analysis, rendering, and layer orchestration to TypeScript:
  - `src/coverage.js` is now `src/coverage.ts`
  - coverage run options, coverage results/layers, directional masks,
    coverage metrics, obstacle fetch progress, render-tile options, network
    summary rows, custom directional-coverage events, DOM helper boundaries,
    and abort/error handling are explicit TypeScript types
  - coverage computation orchestration, backend selection, tile rendering,
    persisted layer restore/rename/opacity/visibility, recompute-from-layer,
    combined-network summaries, simulated-offline views, directional masks,
    and stable `.js` imports from the app shell are unchanged
- Focused coverage migration verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/coveragePoint.test.js tests/unit/coverageNetwork.test.js tests/unit/coverageMetadata.test.js tests/unit/coveragePersistence.test.js tests/unit/settings.test.js`
  - `npx eslint tests/unit/coveragePoint.test.js tests/unit/coverageNetwork.test.js tests/unit/coverageMetadata.test.js tests/unit/coveragePersistence.test.js tests/unit/settings.test.js src/coverage.ts`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Ported the static shell boot script to TypeScript:
  - `src/shellInit.js` is now `src/shellInit.ts`
  - tab switching, drawer title updates, sidebar collapse, sidebar resize, and
    persisted sidebar width handling are explicit DOM/event TypeScript code
  - `index.html` now loads shell init as a module, and the electron-vite
    renderer static-assets plugin no longer copies/re-injects it as a classic
    script
- Boot-script migration verification passed:
  - `npm run typecheck`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Ported the root renderer app entry to TypeScript:
  - `app.js` is now `app.ts`
  - feature-module initialization order and stable `.js` import specifiers are
    unchanged
  - `index.html` now loads `app.ts`, and `tsconfig.json` includes the root
    renderer entry
  - `scripts/check-syntax.mjs` now checks only remaining JavaScript entrypoints;
    `app.ts` is covered by `npm run typecheck` and the renderer build
- Renderer entry migration verification passed:
  - `npm run typecheck`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Ported the Electron preload bridge to TypeScript:
  - `preload.js` is now `preload.ts`
  - IPC bridge progress subscriptions now have explicit payload-handler and
    wrapped-handler types while preserving payload-only callback behavior
  - `electron.vite.config.mjs` builds the TypeScript preload entry to CommonJS
    output for the sandboxed BrowserWindow
  - `src/types/global.d.ts`, `scripts/check-syntax.mjs`, and the preload IPC
    unit test now reference the TypeScript preload boundary
- Preload migration verification passed:
  - `npm run typecheck`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Ported the Electron main entry to TypeScript:
  - `main.js` is now `main.ts`
  - Electron startup, permission allowlist, cache initialization,
    IPC-handler registration, window creation, and cache shutdown behavior are
    unchanged
  - `electron.vite.config.mjs`, `tsconfig.json`, and `scripts/check-syntax.mjs`
    now point at the TypeScript main entry while the remaining `src/main/*.js`
    helpers continue to bundle through the CommonJS plugin
- Main-entry migration verification passed:
  - `npm run typecheck`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Ported small Electron main-process helpers to TypeScript:
  - `src/main/urlGuards.js` is now `src/main/urlGuards.ts`
  - `src/main/window.js` is now `src/main/window.ts`
  - `src/main/cacheDb.js` is now `src/main/cacheDb.ts`
  - external URL allowlisting, same-document navigation checks, BrowserWindow
    creation/navigation guards, cache DB lifecycle, sql.js WASM resolution, and
    cache schema setup are unchanged
  - `tests/unit/urlGuards.test.js` now imports the TypeScript URL guard module
    through the stable `.js` specifier
- Focused Electron-helper migration verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/urlGuards.test.js tests/unit/ipcHandlers.test.js`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Ported the remaining Electron main-process helpers to TypeScript:
  - `src/main/cudaCoverage.js` is now `src/main/cudaCoverage.ts`
  - `src/main/ipcHandlers.js` is now `src/main/ipcHandlers.ts`
  - Python CUDA probe/compute/optimizer orchestration, payload size guards,
    temp-file protocol, cancellation, progress parsing, file/preset/screenshot
    IPC, cache lookup/store/purge handlers, and WebSocket repeater persistence
    behavior are unchanged
  - CUDA and IPC unit tests now import/read the TypeScript modules
- Focused final Electron-helper migration verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/ipcHandlers.test.js tests/unit/urlGuards.test.js tests/unit/cudaCoverageLineParser.test.js tests/unit/cudaPayloadLimits.test.js`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Extracted first IPC trust-boundary schema helpers:
  - added `src/main/ipcSchemas.ts`
  - moved finite-number, lat/lon, bounded-integer, cache-source, blob-payload,
    and WebSocket repeater row sanitizers out of `ipcHandlers.ts`
  - `ipcHandlers.ts` now imports those schema helpers while preserving existing
    IPC behavior
  - added direct tests for coordinate bounds, bounded integers, safe cache
    source IDs, blob payload caps, and persisted WebSocket row clamping
- Focused IPC schema verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/ipcSchemas.test.js tests/unit/ipcHandlers.test.js tests/unit/repeaterRows.test.js`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Extracted saved project config schema helpers:
  - added `src/configSchema.ts`
  - `loadConfig()` now parses saved project JSON through a pure schema helper
    before applying settings or replacing repeaters
  - malformed JSON, non-object config roots, non-object settings blocks, and
    non-empty repeater arrays with no valid rows are handled explicitly
  - added direct schema tests for config root validation, settings shape,
    repeater normalization, skipped-row accounting, and all-invalid repeater
    imports
- Focused saved-config schema verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/configSchema.test.js tests/unit/config.test.js tests/unit/repeaterRows.test.js tests/unit/settings.test.js`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Extracted coverage layer persistence schema helpers:
  - added `src/coverageLayerSchema.ts`
  - `coveragePersistence.ts` now validates layer records before IndexedDB
    writes/restores and sanitizes localStorage layer preferences on read/write
  - coverage layer IDs are trimmed and required; opacity is clamped; labels are
    capped; invalid stored preference entries are ignored
  - added direct tests for layer record validation, preference sanitization,
    preference-map filtering, and persistence-level corrupt-pref reads
- Focused coverage-layer schema verification passed:
  - `npm run typecheck`
  - `npx vitest run tests/unit/coverageLayerSchema.test.js tests/unit/coveragePersistence.test.js tests/unit/coverageMetadata.test.js tests/unit/coverageNetwork.test.js`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- TypeScript source migration milestone:
  - no root or `src/**` application source files remain as `.js`
  - remaining JavaScript, if any, is limited to tests, scripts, or generated
    build output

### 2026-06-12

- Continued Phase 5 TypeScript migration on the active branch
  `codex/phase-5-roadmap-typescript`.
- Ported shared signal-model helpers to TypeScript:
  - `src/signalModel.js` is now `src/signalModel.ts`
  - bbox, transmitter specs, profile buffers, obstacle sets, signal
    breakdowns, point-signal results, facade rays, and helper argument shapes
    are explicit TypeScript types
  - coverage-worker LoS grid handling now explicitly falls back to `NaN` when
    optional Fresnel clearance is absent
  - coverage, optimizer, coverage-point, and worker consumers still import
    through stable `.js` specifiers
- Focused signal-model migration verification passed:
  - `npx vitest run tests/unit/signalModel.test.js tests/unit/propagationAccuracy.test.js tests/unit/coveragePoint.test.js`
  - `npx vitest run tests/unit/signalModel.test.js tests/unit/propagationAccuracy.test.js tests/unit/coveragePoint.test.js tests/unit/optimizer.test.js tests/unit/backend.test.js`
  - `npx eslint tests/unit/signalModel.test.js tests/unit/propagationAccuracy.test.js tests/unit/coveragePoint.test.js src/coverageWorker.js src/coverage.js src/optimizer.js`
  - `npm run typecheck`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Ported the CPU coverage worker entrypoint to TypeScript:
  - `src/coverageWorker.js` is now `src/coverageWorker.ts`
  - row-band payloads, progress messages, done messages, worker stats, and
    transfer-buffer outputs are explicit TypeScript types
  - the worker pool still launches through the stable
    `new URL('./coverageWorker.js', import.meta.url)` specifier
  - bundler verification confirms the worker chunk is still produced
- Focused coverage worker migration verification passed:
  - `npx vitest run tests/unit/coverageWorkerPool.test.js tests/unit/coverageBackend.test.js tests/unit/signalModel.test.js`
  - `npx vitest run tests/unit/coverageWorkerPool.test.js tests/unit/coverageBackend.test.js tests/unit/coveragePoint.test.js tests/unit/coverageNetwork.test.js tests/unit/config.test.js`
  - `npx eslint tests/unit/coverageWorkerPool.test.js tests/unit/coverageBackend.test.js src/coverage.js`
  - `npm run typecheck`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Ported the optimizer worker entrypoint to TypeScript:
  - `src/optimizerWorker.js` is now `src/optimizerWorker.ts`
  - worker payloads, progress messages, done messages, and optimizer scoring
    argument forwarding are explicit TypeScript types
  - the worker derives its scoring payload field types from
    `runOptimizerScoring` so the JS optimizer boundary remains consistent
  - optimizer backend still launches through the stable
    `new URL('./optimizerWorker.js', import.meta.url)` specifier
- Focused optimizer worker migration verification passed:
  - `npx vitest run tests/unit/optimizerBackend.test.js tests/unit/backend.test.js tests/unit/optimizer.test.js`
  - `npx vitest run tests/unit/optimizerBackend.test.js tests/unit/backend.test.js tests/unit/optimizer.test.js tests/unit/settings.test.js`
  - `npx eslint tests/unit/optimizerBackend.test.js tests/unit/backend.test.js tests/unit/optimizer.test.js src/optimizer.js src/optimizerUI.js`
  - `npm run typecheck`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Ported independent map-layer overlay helpers to TypeScript:
  - `src/mapLayers.js` is now `src/mapLayers.ts`
  - obstacle metadata, layer style objects, refresh options, worker/job
    progress metadata, selection events, and OSM foliage/building fetch
    boundaries are explicit TypeScript types
  - Leaflet polygon layers remain intentionally typed at a narrow local
    boundary while the larger map/UI modules continue migrating
- Focused map-layer migration verification passed:
  - `npx vitest run tests/unit/mapLayers.test.js`
  - `npx vitest run tests/unit/mapLayers.test.js tests/unit/mapContext.test.js tests/unit/config.test.js`
  - `npx eslint tests/unit/mapLayers.test.js src/config.js src/coverage.js src/mapContext.js src/map3d.js`
  - `npm run typecheck`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Ported core propagation math helpers to TypeScript:
  - `src/propagation.js` is now `src/propagation.ts`
  - polygons, bbox/tile indexes, facade reflection rays, coherent ray paths,
    antenna patterns, LoS/diffraction results, numeric array inputs, and
    gradient stops are explicit TypeScript types
  - the RF math, terrain interpolation, segment/polygon interval behavior, and
    coverage pixel writing are unchanged
- Focused propagation migration verification passed:
  - `npx vitest run tests/unit/propagation.test.js tests/unit/propagationAccuracy.test.js tests/unit/osmGeometry.test.js`
  - `npx vitest run tests/unit/propagation.test.js tests/unit/propagationAccuracy.test.js tests/unit/signalModel.test.js tests/unit/linkBudget.test.js tests/unit/coveragePoint.test.js`
  - `npx eslint tests/unit/propagation.test.js tests/unit/propagationAccuracy.test.js tests/unit/osmGeometry.test.js src/buildings.js src/foliage.js src/coverage.js src/p2p.js`
  - `npm run typecheck`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Ported project configuration helpers to TypeScript:
  - `src/config.js` is now `src/config.ts`
  - persisted setting records, repeater snapshots, saved config payloads,
    coverage GeoJSON export shapes, viewport grid points, cache-warm progress,
    and confirmed-action callbacks are explicit TypeScript types
  - save/load, settings persistence, cache warming, and coverage export
    behavior are unchanged
- Focused config migration verification passed:
  - `npx vitest run tests/unit/config.test.js`
  - `npx vitest run tests/unit/config.test.js tests/unit/settings.test.js tests/unit/coverageNetwork.test.js`
  - `npx vitest run tests/unit/config.test.js tests/unit/settings.test.js tests/unit/coverageNetwork.test.js tests/unit/mapLayers.test.js tests/unit/elevation.test.js`
  - `npx eslint tests/unit/config.test.js tests/unit/settings.test.js tests/unit/coverageNetwork.test.js src/coverage.js src/repeaters.js src/elevation.js src/foliage.js src/buildings.js`
  - `npm run typecheck`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Ported relay path UI helpers to TypeScript:
  - `src/pathfinderUI.js` is now `src/pathfinderUI.ts`
  - relay pick state, selection events, Leaflet path lines/markers, path link
    inspector rows, progress metadata, and abort errors are explicit
    TypeScript types
  - relay rendering, endpoint picking, recompute actions, and stable `.js`
    imports from `p2p`/`repeaters` are unchanged
- Focused relay path UI migration verification passed:
  - `npx vitest run tests/unit/pathfinder.test.js tests/unit/settings.test.js tests/unit/mapContext.test.js`
  - `npx vitest run tests/unit/pathfinder.test.js tests/unit/settings.test.js tests/unit/mapContext.test.js tests/unit/linkBudget.test.js`
  - `npx eslint tests/unit/pathfinder.test.js tests/unit/settings.test.js tests/unit/mapContext.test.js src/p2p.js src/repeaters.js src/mapContext.js`
  - `npm run typecheck`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Ported elevation service helpers to TypeScript:
  - `src/elevation.js` is now `src/elevation.ts`
  - elevation points, stats, API descriptors/responses, DEM tile samples,
    Terrarium tiles, cache rows, concurrency chunks, progress callbacks, and
    null-fill stats are explicit TypeScript types
  - DEM tile cache lookup, raster sampling, API retry/fallback behavior, and
    stable `.js` imports from coverage/P2P/optimizer/map services are
    unchanged
- Focused elevation migration verification passed:
  - `npx vitest run tests/unit/elevation.test.js`
  - `npx vitest run tests/unit/elevation.test.js tests/unit/linkBudget.test.js tests/unit/pathfinder.test.js tests/unit/config.test.js`
  - `npx vitest run tests/unit/elevation.test.js tests/unit/linkBudget.test.js tests/unit/pathfinder.test.js tests/unit/config.test.js tests/unit/terrain3dModel.test.js`
  - `npx eslint tests/unit/elevation.test.js tests/unit/linkBudget.test.js tests/unit/pathfinder.test.js tests/unit/config.test.js src/coverage.js src/buildings.js src/foliage.js src/map3d.js src/optimizer.js src/optimizerUI.js`
  - `npm run typecheck`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Ported foliage/vegetation service helpers to TypeScript:
  - `src/foliage.js` is now `src/foliage.ts`
  - foliage tile indexes, tile payloads, OSM tags/elements/members,
    classification results, Overpass responses, DSM-DEM derivation samples,
    fetch options, and attenuation inputs are explicit TypeScript types
  - Overpass query construction, tile cache merging, DSM-DEM canopy fallback,
    spatial indexing, and foliage attenuation behavior are unchanged
- Focused foliage migration verification passed:
  - `npx vitest run tests/unit/propagation.test.js tests/unit/linkBudget.test.js tests/unit/signalModel.test.js tests/unit/config.test.js`
  - `npx vitest run tests/unit/propagation.test.js tests/unit/linkBudget.test.js tests/unit/signalModel.test.js tests/unit/config.test.js tests/unit/mapLayers.test.js tests/unit/pathfinder.test.js`
  - `npx eslint tests/unit/propagation.test.js tests/unit/linkBudget.test.js tests/unit/signalModel.test.js tests/unit/config.test.js tests/unit/mapLayers.test.js src/coverage.js src/buildings.js src/optimizer.js src/p2p.js`
  - `npm run typecheck`
  - `npm run build`
- Full project verification passed:
  - `npm run check`

### 2026-06-11

- Continued Phase 5 TypeScript migration.
- Ported preset UI helpers to TypeScript:
  - `src/presets.js` is now `src/presets.ts`
  - hardware, radio-mode, antenna, select-option, and raw value assignment
    shapes are explicit TypeScript types
  - preset loading still falls back to built-in defaults when IPC loading fails
  - app and test consumers still import through stable `.js` specifiers
- Focused preset helper migration verification passed:
  - `npx vitest run tests/unit/presets.test.js`
  - `npx eslint tests/unit/presets.test.js app.js`
  - `npm run typecheck`
  - `npm run build`
- Ported map singleton helpers to TypeScript:
  - `src/map.js` is now `src/map.ts`
  - app state, coverage-layer cleanup, base-layer specs, and active base-layer
    info are explicit TypeScript types
  - the shared state arrays intentionally keep the old broad `any[]` surface
    while adjacent JS modules are still being migrated
  - app, renderer, and test consumers still import through stable `.js`
    specifiers
- Focused map singleton migration verification passed:
  - `npx vitest run tests/unit/map.test.js tests/unit/mapAdapter.test.js`
  - `npx eslint tests/unit/map.test.js tests/unit/mapAdapter.test.js src/coverage.js src/config.js src/repeaters.js src/mapContext.js`
  - `npm run typecheck`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Ported P2P link-budget calculation to TypeScript:
  - `src/linkBudget.js` is now `src/linkBudget.ts`
  - P2P endpoints, P2P settings, Monte Carlo shadow fading results, LoS result
    slices, calculation output, and calculation-log shapes are explicit
    TypeScript types
  - foliage/building payloads stay permissive at the JS data-source boundary
    while still using the typed terrain-profile payload shapes
  - P2P consumers still import through stable `.js` specifiers
- Focused link-budget migration verification passed:
  - `npx vitest run tests/unit/linkBudget.test.js tests/unit/terrainProfileView.test.js`
  - `npx vitest run tests/unit/linkBudget.test.js tests/unit/settings.test.js tests/unit/pathfinder.test.js`
  - `npx eslint tests/unit/linkBudget.test.js tests/unit/settings.test.js src/p2p.js src/pathfinderUI.js`
  - `npm run typecheck`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Ported relay pathfinder search to TypeScript:
  - `src/pathfinder.js` is now `src/pathfinder.ts`
  - relay nodes, obstacle sets, pathfinder scenarios, heap entries, candidate
    edges, adjacency edges, path steps, and path results are explicit
    TypeScript types
  - obstacle fetches and loss helpers stay compatible with the existing JS
    foliage/building data-source boundary
  - pathfinder UI consumers still import through stable `.js` specifiers,
    including the exported `PathResult` type
- Focused pathfinder migration verification passed:
  - `npx vitest run tests/unit/pathfinder.test.js tests/unit/linkBudget.test.js`
  - `npx vitest run tests/unit/pathfinder.test.js tests/unit/settings.test.js tests/unit/linkBudget.test.js tests/unit/optimizer.test.js`
  - `npx eslint tests/unit/pathfinder.test.js tests/unit/settings.test.js src/pathfinderUI.js src/p2p.js`
  - `npm run typecheck`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Ported settings parser helpers to TypeScript:
  - `src/settings.js` is now `src/settings.ts`
  - numeric, optional numeric, checkbox, selected-value, and clamped integer
    DOM parsing helpers are explicit TypeScript functions
  - coverage, P2P, optimizer, map-layer, and WebSocket persisted setting ID
    lists keep their existing exported `.js` import surface
  - returned settings objects intentionally stay structurally inferred while
    the larger JS consumers continue to migrate
- Focused settings parser migration verification passed:
  - `npx vitest run tests/unit/settings.test.js tests/unit/settingsPersistence.test.js`
  - `npx vitest run tests/unit/settings.test.js tests/unit/config.test.js tests/unit/optimizer.test.js tests/unit/linkBudget.test.js`
  - `npx eslint tests/unit/settings.test.js tests/unit/settingsPersistence.test.js src/config.js src/coverage.js src/p2p.js src/optimizerUI.js src/pathfinderUI.js`
  - `npm run typecheck`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Ported shared UI helpers to TypeScript:
  - `src/ui.js` is now `src/ui.ts`
  - cancel handlers, job drawer metadata/history, drawer states, progress
    updates, inline status, busy-button helpers, tab activation, and HTML
    escaping are explicit TypeScript contracts
  - progress overlay and job drawer behavior remains unchanged
  - app, renderer, and test consumers still import through stable `.js`
    specifiers
- Focused shared UI migration verification passed:
  - `npx vitest run tests/unit/ui.test.js tests/unit/uiDisclosure.test.js`
  - `npx vitest run tests/unit/ui.test.js tests/unit/config.test.js tests/unit/mapContext.test.js tests/unit/mapLayers.test.js`
  - `npx eslint tests/unit/ui.test.js tests/unit/config.test.js tests/unit/mapContext.test.js tests/unit/mapLayers.test.js src/config.js src/coverage.js src/mapContext.js src/mapLayers.js src/repeaters.js src/p2p.js src/optimizerUI.js`
  - `npm run typecheck`
  - `npm run build`
- Full project verification passed:
  - `npm run check`

### 2026-06-06

- Phase 5 started.
- Ported the first pure source module to TypeScript:
  - `src/coverageGrid.js` is now `src/coverageGrid.ts`
  - existing app/test import specifiers remain `.js`, relying on
    TypeScript/Vite bundler resolution to avoid downstream churn
  - exported bbox and elevation-grid point shapes are now explicit TypeScript
    types
  - runtime behavior is intended to be unchanged
- Ported radio metric helpers to TypeScript:
  - `src/radioMetrics.js` is now `src/radioMetrics.ts`
  - spreading factor and derived metric shapes are explicit TypeScript types
  - existing `.js` import specifiers remain stable for current consumers
  - runtime behavior is intended to be unchanged
- Ported repeater row boundary validation to TypeScript:
  - `src/repeaterRows.js` is now `src/repeaterRows.ts`
  - config repeater rows, WebSocket snapshot rows, and snapshot result shapes
    are explicit TypeScript types
  - live-feed rows now reach the add-node path as typed numeric coordinates
    after schema normalization
  - existing `.js` import specifiers remain stable for config and repeater UI
    consumers
- Ported settings persistence helpers to TypeScript:
  - `src/settingsPersistence.js` is now `src/settingsPersistence.ts`
  - persisted setting controls and settings-change binding root shapes are
    explicit TypeScript types
  - config and coverage consumers still import through stable `.js`
    specifiers
- Ported EIRP awareness helpers to TypeScript:
  - `src/eirp.js` is now `src/eirp.ts`
  - regulatory EIRP limit and hint binding shapes are explicit TypeScript
    types
  - Add Node, P2P, and optimizer UI consumers still import through stable
    `.js` specifiers
- Ported coverage signal overlay helpers to TypeScript:
  - `src/signalOverlay.js` is now `src/signalOverlay.ts`
  - coverage overlay mode, colorization options, and gradient-stop shapes are
    explicit TypeScript types
  - coverage rendering and 3D map consumers still import through stable `.js`
    specifiers
- Ported coverage metadata helpers to TypeScript:
  - `src/coverageMetadata.js` is now `src/coverageMetadata.ts`
  - persisted coverage run metadata, cache metadata, layer detail rows, and
    scenario grouping outputs are explicit TypeScript types
  - restored/legacy coverage layer inputs remain intentionally permissive
  - coverage layer manager consumers still import through stable `.js`
    specifiers
- Ported optimizer diagnostics helpers to TypeScript:
  - `src/optimizerDiagnostics.js` is now `src/optimizerDiagnostics.ts`
  - optimizer completion message, message kind, stats, and diagnostic line
    outputs are explicit TypeScript types
  - optimizer UI consumers still import through stable `.js` specifiers
- Ported optimizer result detail helpers to TypeScript:
  - `src/optimizerResultDetails.js` is now `src/optimizerResultDetails.ts`
  - optimizer candidate detail input and score-breakdown shapes are explicit
    TypeScript types
  - optimizer UI and map inspector consumers still import through stable `.js`
    specifiers
- Ported progressive disclosure helpers to TypeScript:
  - `src/uiDisclosure.js` is now `src/uiDisclosure.ts`
  - disclosure root/input handling is now typed while preserving generic DOM
    behavior
- Ported coverage persistence helpers to TypeScript:
  - `src/coveragePersistence.js` is now `src/coveragePersistence.ts`
  - coverage layer records, layer UI preferences, and preference maps are
    explicit TypeScript types
  - label persistence from Phase 3/4 layer-manager work is preserved
  - coverage layer manager consumers still import through stable `.js`
    specifiers
- Ported 3D map-tile texture helpers to TypeScript:
  - `src/mapTileTexture.js` is now `src/mapTileTexture.ts`
  - tile pixels, texture layout, selected texture layout, layer info, and
    canvas-result shapes are explicit TypeScript types
  - the source-zoom/downsample behavior added in Phase 4.3 is preserved
  - 3D map consumers still import through stable `.js` specifiers
- Ported 3D terrain model helpers to TypeScript:
  - `src/terrain3dModel.js` is now `src/terrain3dModel.ts`
  - bounds, lat/lon points, local projected points, terrain metrics, mesh
    arrays, and scene status outputs are explicit TypeScript types
  - selected-object 3D focus bounds and DEM-vs-preview terrain status behavior
    from Phase 4.3 are preserved
  - 3D map consumers still import through stable `.js` specifiers
- Ported road-access helpers to TypeScript:
  - `src/roads.js` is now `src/roads.ts`
  - road points, road lines, fetch results, fetch options, and OSM tile payloads
    are explicit TypeScript types
  - access-aware optimizer consumers still import through stable `.js`
    specifiers
- Ported coverage point inspection helpers to TypeScript:
  - `src/coveragePoint.js` is now `src/coveragePoint.ts`
  - coverage inspection rows and modeled loss breakdowns are explicit
    TypeScript types
  - map inspector consumers still import through stable `.js` specifiers
- Ported OSM geometry helpers to TypeScript:
  - `src/osmGeometry.js` is now `src/osmGeometry.ts`
  - bbox, normalized bbox, tile descriptor, ring, multipolygon member, and
    member-geometry shapes are explicit TypeScript types
  - antimeridian tiling, multipolygon assembly, dedupe keys, corridor rings,
    and hole containment behavior are preserved
  - foliage, building, roads, 3D, coverage, and propagation consumers still
    import through stable `.js` specifiers
- Ported combined coverage network helpers to TypeScript:
  - `src/coverageNetwork.js` is now `src/coverageNetwork.ts`
  - combined overlay modes, layer inputs, coverage summaries, node-failure
    impact summaries, and generated overlay outputs are explicit TypeScript
    types
  - combined coverage overlay behavior and config/coverage consumers still
    import through stable `.js` specifiers
- Ported OSM tile pipeline helpers to TypeScript:
  - `src/osmTilePipeline.js` is now `src/osmTilePipeline.ts`
  - tile batch progress, batch result, and batch option shapes are explicit
    TypeScript types
  - foliage/building data consumers still import through stable `.js`
    specifiers
- Ported request scheduler helpers to TypeScript:
  - `src/requestScheduler.js` is now `src/requestScheduler.ts`
  - timeout-aware fetch options, per-host queue items, host queues, and
    scheduler snapshots are explicit TypeScript types
  - elevation, foliage, and building data consumers still import through
    stable `.js` specifiers
- Ported coverage scenario preset helpers to TypeScript:
  - `src/scenarios.js` is now `src/scenarios.ts`
  - scenario preset maps and supported preset value shapes are explicit
    TypeScript types
  - coverage-tab consumers still import through stable `.js` specifiers
- Ported map adapter helpers to TypeScript:
  - `src/mapAdapter.js` is now `src/mapAdapter.ts`
  - map viewport metrics, coverage overlay tile arguments, and stored coverage
    tile layer metadata are explicit TypeScript types
  - coverage consumers still import through stable `.js` specifiers
- Ported CPU coverage worker pool helpers to TypeScript:
  - `src/coverageWorkerPool.js` is now `src/coverageWorkerPool.ts`
  - row bands, worker job/result/stats, worker-pool payloads, progress options,
    and worker messages are explicit TypeScript types
  - the existing `coverageWorker.js` worker entry remains on the current
    `.js` URL for bundler stability
- Ported coverage backend selection helpers to TypeScript:
  - `src/coverageBackend.js` is now `src/coverageBackend.ts`
  - CUDA probe/status, backend preference/order, progress payloads, run results,
    and backend payload shapes are explicit TypeScript types
  - coverage UI consumers still import through stable `.js` specifiers
- Ported developer console helpers to TypeScript:
  - `src/devConsole.js` is now `src/devConsole.ts`
  - console levels, captured console entries, and original console method
    bindings are explicit TypeScript types
  - startup import behavior and app UI consumers still import through stable
    `.js` specifiers
- Ported terrain profile view helpers to TypeScript:
  - `src/terrainProfileView.js` is now `src/terrainProfileView.ts`
  - profile points, obstacle bboxes, tile indexes, obstacle polygons, sampled
    obstacle heights, and legend item shapes are explicit TypeScript types
  - link-budget/P2P consumers still import through stable `.js` specifiers
- Ported optimizer backend selection helpers to TypeScript:
  - `src/optimizerBackend.js` is now `src/optimizerBackend.ts`
  - CUDA probe/capability, backend order, progress callback, worker messages,
    raw optimizer results, and normalized backend results are explicit
    TypeScript types
  - optimizer UI consumers still import through stable `.js` specifiers
- Hardened durable coverage layer persistence:
  - computed layers now await their IndexedDB write before the UI reports the
    layer as fully added
  - `Clear All` now awaits durable coverage storage cleanup before rendering
    the empty layer list
  - persisted raster grids are stored as copied `ArrayBuffer`s and rehydrated
    as `Float32Array`s on restore
  - coverage layers now use a v2 IndexedDB store to avoid legacy poisoned
    raster records
- Hardened smoke-test setup around persistent map/node state:
  - startup smoke disables obstacle layers before asserting a bare map-point
    click so OSM foliage/building polygons cannot validly intercept it
  - `clearAllNodes` only registers its confirm-dialog accept handler when it
    will actually click the clear button
  - workflow smoke now uses explicit checkbox `check`/`uncheck` actions for
    layer toggles
  - smoke app launches now use isolated temporary Electron user-data
    directories while still preserving reload behavior within each test
  - coverage smoke waits for durable clear completion, avoids racing a
    too-fast recompute progress message, and cancels pending layer refresh
    work before testing the 3D toggle
- Focused TypeScript migration verification passed:
  - `npx vitest run tests/unit/radioMetrics.test.js tests/unit/coverageGrid.test.js`
  - `npx eslint tests/unit/coverageGrid.test.js tests/unit/radioMetrics.test.js src/coverage.js src/coveragePoint.js src/settings.js`
  - `npm run typecheck`
  - `npm run build`
- Focused repeater-row boundary migration verification passed:
  - `npx vitest run tests/unit/repeaterRows.test.js`
  - `npx vitest run tests/unit/config.test.js tests/unit/repeaterRows.test.js`
  - `npx eslint tests/unit/repeaterRows.test.js src/config.js src/repeaters.js`
  - `npm run typecheck`
  - `npm run build`
- Focused settings persistence migration verification passed:
  - `npx vitest run tests/unit/settingsPersistence.test.js tests/unit/config.test.js`
  - `npx eslint tests/unit/settingsPersistence.test.js src/config.js src/coverage.js`
  - `npm run typecheck`
  - `npm run build`
- Focused EIRP helper migration verification passed:
  - `npx vitest run tests/unit/eirp.test.js`
  - `npx eslint tests/unit/eirp.test.js src/repeaters.js src/p2p.js src/optimizerUI.js`
  - `npm run typecheck`
  - `npm run build`
- Focused signal overlay migration verification passed:
  - `npx vitest run tests/unit/signalOverlay.test.js`
  - `npx vitest run tests/unit/signalOverlay.test.js tests/unit/coverageNetwork.test.js`
  - `npx eslint tests/unit/signalOverlay.test.js src/coverage.js src/map3d.js`
  - `npm run typecheck`
  - `npm run build`
- Focused coverage metadata migration verification passed:
  - `npx vitest run tests/unit/coverageMetadata.test.js`
  - `npx vitest run tests/unit/coverageMetadata.test.js tests/unit/coveragePersistence.test.js tests/unit/coverageNetwork.test.js`
  - `npx eslint tests/unit/coverageMetadata.test.js src/coverage.js`
  - `npm run typecheck`
  - `npm run build`
- Focused optimizer diagnostics migration verification passed:
  - `npx vitest run tests/unit/optimizerDiagnostics.test.js`
  - `npx vitest run tests/unit/optimizerDiagnostics.test.js tests/unit/optimizerResultDetails.test.js`
  - `npx eslint tests/unit/optimizerDiagnostics.test.js src/optimizerUI.js`
  - `npm run typecheck`
  - `npm run build`
- Focused optimizer detail/disclosure migration verification passed:
  - `npx vitest run tests/unit/optimizerResultDetails.test.js tests/unit/uiDisclosure.test.js`
  - `npx vitest run tests/unit/optimizerDiagnostics.test.js tests/unit/optimizerResultDetails.test.js tests/unit/uiDisclosure.test.js`
  - `npx eslint tests/unit/optimizerResultDetails.test.js tests/unit/uiDisclosure.test.js src/optimizerUI.js src/mapContext.js app.js`
  - `npm run typecheck`
  - `npm run build`
- Focused coverage persistence migration verification passed:
  - `npx vitest run tests/unit/coveragePersistence.test.js`
  - `npx vitest run tests/unit/coveragePersistence.test.js tests/unit/coverageMetadata.test.js`
  - `npx eslint tests/unit/coveragePersistence.test.js src/coverage.js`
  - `npm run typecheck`
  - `npm run build`
- Focused map-tile texture migration verification passed:
  - `npx vitest run tests/unit/mapTileTexture.test.js`
  - `npx vitest run tests/unit/mapTileTexture.test.js tests/unit/terrain3dModel.test.js`
  - `npx eslint tests/unit/mapTileTexture.test.js src/map3d.js`
  - `npm run typecheck`
  - `npm run build`
- Focused 3D terrain model migration verification passed:
  - `npx vitest run tests/unit/terrain3dModel.test.js`
  - `npx vitest run tests/unit/terrain3dModel.test.js tests/unit/mapTileTexture.test.js`
  - `npx eslint tests/unit/terrain3dModel.test.js src/map3d.js`
  - `npm run typecheck`
  - `npm run build`
- Focused road-access migration verification passed:
  - `npx vitest run tests/unit/roads.test.js`
  - `npx vitest run tests/unit/roads.test.js tests/unit/optimizer.test.js`
  - `npx eslint tests/unit/roads.test.js src/optimizerUI.js src/optimizer.js`
  - `npm run typecheck`
  - `npm run build`
- Focused coverage point inspection migration verification passed:
  - `npx vitest run tests/unit/coveragePoint.test.js`
  - `npx vitest run tests/unit/coveragePoint.test.js tests/unit/mapContext.test.js`
  - `npx eslint tests/unit/coveragePoint.test.js src/mapContext.js`
  - `npm run typecheck`
  - `npm run build`
- Focused OSM geometry migration verification passed:
  - `npx vitest run tests/unit/osmGeometry.test.js`
  - `npx vitest run tests/unit/osmGeometry.test.js tests/unit/roads.test.js tests/unit/mapTileTexture.test.js tests/unit/terrain3dModel.test.js tests/unit/coverageGrid.test.js`
  - `npx eslint tests/unit/osmGeometry.test.js src/foliage.js src/buildings.js`
  - `npm run typecheck`
  - `npm run build`
- Focused combined coverage network migration verification passed:
  - `npx vitest run tests/unit/coverageNetwork.test.js`
  - `npx vitest run tests/unit/coverageNetwork.test.js tests/unit/coverageMetadata.test.js tests/unit/config.test.js`
  - `npx eslint tests/unit/coverageNetwork.test.js src/coverage.js src/config.js`
  - `npm run typecheck`
  - `npm run build`
- Focused OSM tile pipeline/request scheduler migration verification passed:
  - `npx vitest run tests/unit/osmTilePipeline.test.js tests/unit/requestScheduler.test.js`
  - `npx vitest run tests/unit/osmTilePipeline.test.js tests/unit/requestScheduler.test.js tests/unit/elevation.test.js tests/unit/foliage.test.js tests/unit/buildings.test.js`
  - `npx eslint tests/unit/osmTilePipeline.test.js tests/unit/requestScheduler.test.js src/elevation.js src/foliage.js src/buildings.js`
  - `npm run typecheck`
  - `npm run build`
- Focused scenario preset migration verification passed:
  - `npx vitest run tests/unit/scenarios.test.js tests/unit/config.test.js`
  - `npx eslint tests/unit/scenarios.test.js src/coverage.js`
  - `npm run typecheck`
  - `npm run build`
- Focused map adapter migration verification passed:
  - `npx vitest run tests/unit/mapAdapter.test.js`
  - `npx vitest run tests/unit/mapAdapter.test.js tests/unit/coverageNetwork.test.js tests/unit/config.test.js`
  - `npx eslint tests/unit/mapAdapter.test.js src/coverage.js`
  - `npm run typecheck`
  - `npm run build`
- Focused CPU coverage worker/backend migration verification passed:
  - `npx vitest run tests/unit/coverageWorkerPool.test.js`
  - `npx vitest run tests/unit/coverageBackend.test.js tests/unit/coverageWorkerPool.test.js`
  - `npx vitest run tests/unit/coverageBackend.test.js tests/unit/coverageWorkerPool.test.js tests/unit/coverageNetwork.test.js tests/unit/config.test.js`
  - `npx eslint tests/unit/coverageBackend.test.js tests/unit/coverageWorkerPool.test.js src/coverage.js`
  - `npm run typecheck`
  - `npm run build`
- Focused dev console / terrain profile migration verification passed:
  - `npx vitest run tests/unit/devConsole.test.js`
  - `npx vitest run tests/unit/terrainProfileView.test.js tests/unit/devConsole.test.js`
  - `npx vitest run tests/unit/terrainProfileView.test.js tests/unit/linkBudget.test.js tests/unit/devConsole.test.js`
  - `npx eslint tests/unit/terrainProfileView.test.js tests/unit/devConsole.test.js src/linkBudget.js`
  - `npm run typecheck`
  - `npm run build`
- Focused optimizer backend migration verification passed:
  - `npx vitest run tests/unit/optimizerBackend.test.js tests/unit/backend.test.js`
  - `npx vitest run tests/unit/optimizerBackend.test.js tests/unit/backend.test.js tests/unit/optimizer.test.js`
  - `npx eslint tests/unit/optimizerBackend.test.js tests/unit/backend.test.js src/optimizerUI.js src/optimizer.js`
  - `npm run typecheck`
  - `npm run build`
- Full project verification passed:
  - `npm run check`
- Continued Phase 4.2 job drawer work.
- Added compact recent completed-job history:
  - the drawer now has a `Recent` disclosure that appears after at least one
    completed job
  - completed entries capture job title, final message, elapsed time, backend,
    and warning count where available
  - history is capped to the five newest jobs and renders newest-first
  - job text is escaped before rendering in the history list
- Focused job-history verification passed:
  - `npx vitest run tests/unit/ui.test.js`
  - `npx eslint src/ui.js tests/unit/ui.test.js`
  - `npm run typecheck`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "app loads and exposes core workflow tabs"`
- Added explicit ETA display for progress jobs:
  - the drawer now parses the existing `(ETA ...)` suffix from progress
    messages into a stable `ETA: ...` detail
  - the legacy progress overlay still receives the raw progress message
  - completed drawer summaries drop stale ETA text while preserving backend
    and warning details
- Focused ETA verification passed:
  - `npx vitest run tests/unit/ui.test.js`
  - `npx eslint src/ui.js tests/unit/ui.test.js`
  - `npm run typecheck`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "app loads and exposes core workflow tabs"`
- Added elapsed runtime display to the active/completed drawer summary:
  - running jobs now show `Elapsed: ...` beside ETA/backend/warning details
  - completed drawer summaries keep elapsed runtime visible without relying
    on the history disclosure
  - unit tests now use a deterministic performance clock for stable runtime
    assertions
- Focused runtime-detail verification passed:
  - `npx vitest run tests/unit/ui.test.js`
  - `npx eslint src/ui.js tests/unit/ui.test.js`
  - `npm run typecheck`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "app loads and exposes core workflow tabs"`
- Phase 4.3 started.
- Made the 3D terrain data source explicit:
  - final 3D status now preserves synthetic preview terrain as a warning
    instead of overwriting it with a generic success message
  - loaded 3D panels now expose `data-terrain-source="dem"` or
    `data-terrain-source="preview"` for UI/smoke verification
  - the final status copy distinguishes live DEM terrain from synthetic
    preview terrain while preserving object counts
- Focused 3D source-state verification passed:
  - `npx vitest run tests/unit/terrain3dModel.test.js`
  - `npx eslint src/map3d.js src/terrain3dModel.js tests/unit/terrain3dModel.test.js`
  - `npm run typecheck`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "app loads and exposes core workflow tabs"`
  - `npx eslint tests/smoke/extended-smoke.spec.cjs`
  - `npx playwright test tests/smoke/extended-smoke.spec.cjs -g "3D terrain view can be opened"`
- Added selected-object 3D focus actions:
  - map-point, node, link, and optimizer-candidate inspector states now expose
    `View 3D`
  - inspector actions dispatch one shared `map3d:focus` event with selected
    point(s), leaving Three.js ownership in `map3d.js`
  - the 3D view opens around selected points or link endpoints, exposes
    `data-focus-label` and `data-focus-points`, and refreshes terrain around
    that focused area
  - focus bounds preserve surrounding terrain context instead of zooming to a
    bare marker/line
- Focused selected-object 3D verification passed:
  - `npx vitest run tests/unit/mapContext.test.js tests/unit/terrain3dModel.test.js`
  - `npx eslint src/mapContext.js src/map3d.js src/terrain3dModel.js tests/unit/mapContext.test.js tests/unit/terrain3dModel.test.js`
  - `npm run typecheck`
  - `npm run build`
  - `npx eslint tests/smoke/extended-smoke.spec.cjs`
  - `npx playwright test tests/smoke/extended-smoke.spec.cjs -g "P2P pick mode"`
- Tightened 3D map texture fetch behavior:
  - map texture layout now lowers source tile zoom when the final texture would
    be heavily downsampled, instead of fetching high-zoom tiles only to shrink
    them
  - the layout still respects the existing maximum tile-request cap
  - the 3D panel exposes chosen texture zoom, scale, downsampled state, and
    final texture size for smoke/debug verification
- Focused 3D texture verification passed:
  - `npx vitest run tests/unit/mapTileTexture.test.js`
  - `npx eslint src/mapTileTexture.js src/map3d.js tests/unit/mapTileTexture.test.js`
  - `npm run typecheck`
  - `npm run build`
  - `npx eslint tests/smoke/extended-smoke.spec.cjs`
  - `npx playwright test tests/smoke/extended-smoke.spec.cjs -g "3D terrain view can be opened"`

### 2026-06-05

- Phase 4.1 started.
- Added a persistent right-side selection inspector:
  - default no-selection state shows project summary counts for nodes,
    coverage layers, P2P links, and relay paths
  - default state includes quick actions for Nodes, Coverage, and Planning
    workflows
  - map coverage-point selection mirrors the existing popup's visible coverage
    rows, serving node/layer labels, margins, LoS/Fresnel state, reasons, and
    modeled loss breakdown
  - coverage-point inspector includes `Add Node Here` and `Clear` actions
  - inspector refreshes on repeater, coverage, and P2P changes
- Kept the existing Leaflet popup as the map-local affordance while adding the
  persistent inspector for map-first workflows.
- Focused contextual-inspector verification passed:
  - `npx vitest run tests/unit/mapContext.test.js`
  - `npx eslint src/mapContext.js tests/unit/mapContext.test.js tests/smoke/workflow-smoke.spec.cjs`
  - `npm run typecheck`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "coverage compute runs to completion"`
- Added node selection to the persistent inspector:
  - clicking a node marker or node list row opens a node inspector state
  - node state shows name, coordinates, visibility, height, TX power/gain, and
    frequency
  - node state actions support edit, hide/show, run coverage, start P2P link,
    optimize here, delete, and clear selection
  - node inspector refreshes after visibility toggles, movement, and repeater
    list changes
- Focused node-inspector verification passed:
  - `npx vitest run tests/unit/mapContext.test.js`
  - `npx eslint src/mapContext.js src/repeaters.js tests/unit/mapContext.test.js tests/smoke/workflow-smoke.spec.cjs`
  - `npm run typecheck`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "node visibility toggle"`
- Added link selection to the persistent inspector:
  - P2P budget lines and relay-path hop lines can now be selected on the map
  - P2P link state includes endpoint labels, distance, margin, RX power, loss
    components, LoS/Fresnel state, and sample count when the budget result has
    those details
  - relay-hop state includes endpoint labels, hop index/total, distance,
    margin, and RX power
  - link inspector actions open the owning Planning panel and can trigger the
    existing recompute flow
  - P2P/path line renderers now use stable classes for smoke-test targeting
- Focused link-inspector verification passed:
  - `npx vitest run tests/unit/mapContext.test.js`
  - `npx eslint src/mapContext.js src/p2p.js src/pathfinderUI.js tests/unit/mapContext.test.js tests/smoke/extended-smoke.spec.cjs`
  - `npm run typecheck`
  - `npm run build`
  - `npx playwright test tests/smoke/extended-smoke.spec.cjs -g "P2P pick mode"`
- Added optimizer candidate selection to the persistent inspector:
  - candidate map markers and result-list rows dispatch the same selection
    event
  - the inspector reuses the shared candidate explanation rows already used by
    result rows and marker popups
  - candidate state shows rank, coordinates, score, coverage, elevation,
    margin, backhaul details, objective summary, and objective formula when
    present
  - candidate actions support Add Node, Open Optimizer, Show Backhaul, and Clear
  - clearing optimizer results also clears a selected candidate inspector state
- Focused optimizer-candidate inspector verification passed:
  - `npx vitest run tests/unit/mapContext.test.js tests/unit/optimizerResultDetails.test.js`
  - `npx eslint src/mapContext.js src/optimizerUI.js tests/unit/mapContext.test.js tests/smoke/workflow-smoke.spec.cjs`
  - `npm run typecheck`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "planning and coverage controls are interactive and stable"`
- Added obstacle selection to the persistent inspector:
  - vegetation, building, and barrier overlays are interactive map objects
  - selected obstacles show OSM type, height/canopy height, height source,
    effective attenuation rate, attenuation factor, data source, and geometry
  - obstacle clicks mark the original map event as handled so map-point
    selection does not overwrite the obstacle state
  - obstacle state includes Open Map Layers and Clear actions
- Focused obstacle-inspector verification passed:
  - `npx vitest run tests/unit/mapContext.test.js tests/unit/mapLayers.test.js`
  - `npx eslint src/mapContext.js src/mapLayers.js tests/unit/mapContext.test.js tests/unit/mapLayers.test.js tests/smoke/workflow-smoke.spec.cjs`
  - `npm run typecheck`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "map settings panel exposes all layer"`
- Added selected-object highlighting for the current inspector states:
  - `mapContext` now emits one shared `selection:changed` event after
    inspector selection changes
  - selected node markers receive a stronger pin outline and selected node
    list rows receive a persistent `ri-selected` class
  - selected P2P and relay-path lines receive a heavier stroke and shared
    `map-object-selected` class when their SVG path is available
  - selected optimizer candidate markers receive a stronger rank icon outline
    and selected result rows receive a persistent `ori-selected` class
  - selected obstacle overlays preserve fill opacity while brightening and
    thickening the polygon outline
- Focused selected-object highlight verification passed:
  - `npx vitest run tests/unit/mapContext.test.js tests/unit/mapLayers.test.js`
  - `npx eslint src/mapContext.js src/repeaters.js src/p2p.js src/pathfinderUI.js src/optimizerUI.js src/mapLayers.js tests/unit/mapContext.test.js tests/unit/mapLayers.test.js tests/smoke/workflow-smoke.spec.cjs tests/smoke/extended-smoke.spec.cjs`
  - `npm run typecheck`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs tests/smoke/extended-smoke.spec.cjs -g "node visibility toggle|P2P pick mode"`
- Added a deeper selected-link action for P2P terrain analysis:
  - selected P2P links now show a `Profile` action in the persistent inspector
  - the action opens the existing Planning > P2P terrain profile tab and
    fullscreen Terrain LoS Profile report for the last computed link budget
  - if no budget result exists, the P2P panel prompts the user to compute the
    link before opening the profile
- Focused P2P profile-action verification passed:
  - `npx vitest run tests/unit/mapContext.test.js`
  - `npx eslint src/mapContext.js src/p2p.js tests/unit/mapContext.test.js tests/smoke/extended-smoke.spec.cjs`
  - `npm run typecheck`
  - `npm run build`
  - `npx playwright test tests/smoke/extended-smoke.spec.cjs -g "P2P pick mode"`
- Added a deeper optimizer candidate backhaul action:
  - `Show Backhaul` now draws a visible dashed preview line from the selected
    candidate to its backhaul peer, even when the candidate came from inspector
    state rather than a currently rendered optimizer result
  - the preview line uses the existing selected-map-object emphasis and is
    cleared with optimizer results
  - the action still fits the map to both endpoints and reports status in the
    Planning panel
- Focused optimizer backhaul-action verification passed:
  - `npx eslint src/optimizerUI.js tests/smoke/workflow-smoke.spec.cjs`
  - `npm run typecheck`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "planning and coverage controls"`
- Added a deeper obstacle modeling action:
  - selected obstacles now include an `Edit Model` action in the persistent
    inspector
  - the action opens Coverage > Propagation Effects and focuses the relevant
    visible propagation toggle (`use-foliage` or `use-buildings`) without
    silently changing modeling settings
  - the action also opens the section containing obstacle height mode so the
    height-source assumption is reachable from the selected obstacle
- Focused obstacle model-action verification passed:
  - `npx vitest run tests/unit/mapContext.test.js`
  - `npx eslint src/mapContext.js tests/unit/mapContext.test.js tests/smoke/workflow-smoke.spec.cjs`
  - `npm run typecheck`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "map settings panel exposes all layer"`
- Phase 4.2 started.
- Added a bottom job drawer backed by the existing shared progress API:
  - `setProgress()` now mirrors active job percent and stage text into a
    bottom drawer while preserving the existing map progress overlay
  - `hideProgress()` leaves a completed last-job summary visible until the
    user dismisses it
  - the drawer uses the shared cancel handler, so coverage, optimizer, relay
    path, and cache warm jobs inherit the same cancel affordance
  - the drawer starts hidden and has a compact responsive layout for narrow
    viewports
- Extended the shared progress API with optional job metadata:
  - coverage jobs now label the drawer with the selected node count/name and
    the configured backend preference
  - optimizer jobs now label general vs source-linked runs, show backend
    preference while running, and switch to the actual backend at completion
  - coverage and optimizer propagate warning counts into the drawer when
    requested obstacle/road data is unavailable
  - relay path search and viewport cache warm jobs now show workflow-specific
    drawer titles
- Integrated map layer refresh jobs into the same drawer:
  - explicit Refresh Layers runs show a `Map Layers: ...` title, staged
    vegetation/structure progress, and the shared cancel handler
  - initial persisted layer restore stays silent so the drawer still starts
    hidden on app load
- Focused job-drawer verification passed:
  - `npx vitest run tests/unit/ui.test.js`
  - `npx vitest run tests/unit/mapLayers.test.js tests/unit/ui.test.js`
  - `npx eslint src/ui.js src/coverage.js src/optimizerUI.js src/pathfinderUI.js src/config.js tests/unit/ui.test.js`
  - `npx eslint src/mapLayers.js src/ui.js tests/unit/mapLayers.test.js tests/unit/ui.test.js`
  - `npm run typecheck`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "app loads and exposes core workflow tabs"`

### 2026-06-04

- Phase 1.1 started.
- Improved the existing map coverage popup rather than creating a separate
  inspector surface.
- Added an opt-in signal breakdown from `computeSignalToPoint()` for point
  inspection use:
  - FSPL
  - diffraction loss
  - foliage loss
  - building loss
  - reflection gain/loss
- Coverage point inspection rows now include:
  - modeled losses
  - primary explanation text
  - whether RSSI came from the stored grid or a fresh point computation
- Point inspection now scopes results to visible coverage layers and carries
  layer identity into each row:
  - layer id
  - layer label
  - visible layer ordinal/total
  - created timestamp when available
- Map point popup now shows coverage status, reason text, and a compact loss
  breakdown.
- Map point popup now explicitly labels visible coverage results, distinguishes
  heatmap-sampled RSSI from point-modeled RSSI, and explains when all coverage
  layers are hidden.
- Map point popup now shows Fresnel clearance when the point model provides it.
- Smoke coverage now clicks a computed coverage point and verifies the popup
  renders visible coverage details.
- Focused verification passed:
  - `npx vitest run tests/unit/signalModel.test.js tests/unit/coveragePoint.test.js tests/unit/mapContext.test.js`
  - `npm run typecheck`
- Follow-up verification passed:
  - `npx vitest run tests/unit/coveragePoint.test.js tests/unit/mapContext.test.js`
  - `npm run typecheck`
  - `npx eslint src/coveragePoint.js src/mapContext.js tests/unit/coveragePoint.test.js tests/unit/mapContext.test.js`
  - `npx eslint src/coveragePoint.js src/mapContext.js tests/unit/coveragePoint.test.js tests/unit/mapContext.test.js tests/smoke/workflow-smoke.spec.cjs`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "coverage compute runs to completion"`
- Phase 1.2 started.
- Added durable coverage run metadata for newly computed layers:
  - backend and backend label
  - grid size and radius
  - source node
  - compute timing
  - worker count and inside-point count
  - compact settings snapshot
  - terrain/foliage/building data-source flags
  - cache summary
  - durable warning text
- Coverage layer list now shows compact metadata under each layer label and
  exposes a detailed tooltip for restored/new layers.
- Focused metadata verification passed:
  - `npx vitest run tests/unit/coverageMetadata.test.js`
  - `npm run typecheck`
  - `npx eslint src/coverageMetadata.js src/coverage.js tests/unit/coverageMetadata.test.js tests/smoke/workflow-smoke.spec.cjs`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "coverage compute runs to completion"`
- Phase 1.3 started.
- Coverage layers can now be renamed directly in the layer list.
- Renamed layer labels persist through lightweight layer preferences instead
  of rewriting large IndexedDB raster records.
- Restored layers apply persisted custom labels.
- Coverage point inspection now tie-breaks equal-margin rows by newest layer,
  so recent reruns and renamed layers surface in the popup ahead of older
  equivalent layers.
- Focused layer-manager verification passed:
  - `npx vitest run tests/unit/coveragePoint.test.js tests/unit/coveragePersistence.test.js tests/unit/coverageMetadata.test.js`
  - `npm run typecheck`
  - `npx eslint src/coveragePoint.js src/coveragePersistence.js src/coverage.js tests/unit/coveragePoint.test.js tests/unit/coveragePersistence.test.js tests/smoke/workflow-smoke.spec.cjs`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "coverage compute runs to completion"`
- Coverage layer metadata now has an in-app expandable details view, covering:
  - source node
  - backend
  - grid and radius
  - compute time
  - workers and inside cells
  - scenario profile
  - data sources
  - cache summary
  - warnings
- Focused metadata-details verification passed:
  - `npx vitest run tests/unit/coverageMetadata.test.js tests/unit/coveragePersistence.test.js tests/unit/coveragePoint.test.js`
  - `npm run typecheck`
  - `npx eslint src/coverageMetadata.js src/coverage.js tests/unit/coverageMetadata.test.js tests/smoke/workflow-smoke.spec.cjs`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "coverage compute runs to completion"`
- Coverage layer list now groups layers by persisted scenario/profile label,
  with legacy layers grouped separately and the newest group shown last.
- Focused scenario-group verification passed:
  - `npx vitest run tests/unit/coverageMetadata.test.js tests/unit/coveragePersistence.test.js tests/unit/coveragePoint.test.js`
  - `npm run typecheck`
  - `npx eslint src/coverageMetadata.js src/coverage.js tests/unit/coverageMetadata.test.js tests/smoke/workflow-smoke.spec.cjs`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "coverage compute runs to completion"`
- Coverage layer rows now include a `Use` action that reloads the layer's
  stored compute settings into the Coverage controls so the run can be reviewed,
  tweaked, or recomputed.
- Coverage run metadata now stores round-trippable control values for:
  - reflection coefficients and corridor width
  - foliage/building loss rates
  - worker and fetch concurrency controls
  - obstacle height mode
- Layer settings restore applies the scenario preset first, then reapplies the
  exact stored run values so presets do not overwrite the saved radius, quality,
  backend, propagation, or worker controls.
- Focused layer settings restore verification passed:
  - `npx vitest run tests/unit/coverageMetadata.test.js`
  - `npm run typecheck`
  - `npx eslint src/coverageMetadata.js src/coverage.js tests/unit/coverageMetadata.test.js tests/smoke/workflow-smoke.spec.cjs`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "coverage compute runs to completion"`
- Coverage layer rows now include a `Run` action that reloads the layer's
  stored settings and recomputes coverage for the original source node, adding
  a fresh duplicate layer.
- Layer recompute resolves the source node by current id first, then by
  matching name and location when ids changed, and warns instead of computing
  when the source node is not present.
- Focused duplicate/recompute verification passed:
  - `npx vitest run tests/unit/coverageMetadata.test.js`
  - `npm run typecheck`
  - `npx eslint src/coverageMetadata.js src/coverage.js tests/unit/coverageMetadata.test.js tests/smoke/workflow-smoke.spec.cjs`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "coverage compute runs to completion"`
- Phase 2.1 started.
- Added an approximate combined visible-network summary built from existing
  computed coverage layers:
  - visible layer count
  - covered and uncovered area estimates
  - covered percentage
  - redundancy percentage
  - weak-margin percentage
  - median margin
  - top serving source labels
- The combined summary updates when layers are added, hidden, shown, deleted,
  restored, or cleared.
- Added a restore generation guard so stale persisted layers cannot reappear if
  Clear All is clicked while startup coverage restore is still in flight.
- Focused combined-summary verification passed:
  - `npx vitest run tests/unit/coverageNetwork.test.js tests/unit/coverageMetadata.test.js`
  - `npm run typecheck`
  - `npx eslint src/coverageNetwork.js src/coverage.js tests/unit/coverageNetwork.test.js tests/unit/coverageMetadata.test.js tests/smoke/workflow-smoke.spec.cjs tests/smoke/smoke-utils.js`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "coverage compute runs to completion"`
  - `npm run build`
- Added a persisted Network Overlay selector in the Coverage panel with map
  raster modes derived from visible computed layers:
  - combined best margin
  - uncovered gaps
  - overlap count
- Combined network overlays render as separate map tiles, refresh when visible
  coverage layers change, and preserve the existing individual layer overlays.
- Focused combined-overlay verification passed:
  - `npx vitest run tests/unit/coverageNetwork.test.js tests/unit/coverageMetadata.test.js`
  - `npm run typecheck`
  - `npx eslint src/coverageNetwork.js src/coverage.js src/settings.js tests/unit/coverageNetwork.test.js tests/unit/coverageMetadata.test.js tests/smoke/workflow-smoke.spec.cjs tests/smoke/smoke-utils.js`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "coverage compute runs to completion"`
- Completed the remaining combined Network Overlay modes:
  - strongest serving node, colored by source label
  - covered by at least N nodes, using a persisted `Min Nodes` control
- Focused strongest-node/covered-by-N verification passed:
  - `npx vitest run tests/unit/coverageNetwork.test.js tests/unit/coverageMetadata.test.js`
  - `npm run typecheck`
  - `npx eslint src/coverageNetwork.js src/coverage.js src/settings.js tests/unit/coverageNetwork.test.js tests/unit/coverageMetadata.test.js tests/smoke/workflow-smoke.spec.cjs tests/smoke/smoke-utils.js`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "coverage compute runs to completion"`
- Phase 2.2 started.
- Expanded the combined visible-network summary with an in-app Network Stats
  details view covering:
  - analysis area
  - covered and uncovered area
  - overlap and weak-margin area
  - average, median, and best margin
  - sample grid size
  - top serving source contribution
- Coverage GeoJSON export now includes a top-level `networkStats` metadata
  snapshot and exports visible coverage layers only, matching the visible
  network analysis surface.
- Focused network-stats/export verification passed:
  - `npx vitest run tests/unit/coverageNetwork.test.js tests/unit/config.test.js tests/unit/coverageMetadata.test.js`
  - `npm run typecheck`
  - `npx eslint src/coverageNetwork.js src/coverage.js src/config.js tests/unit/coverageNetwork.test.js tests/unit/config.test.js tests/unit/coverageMetadata.test.js tests/smoke/workflow-smoke.spec.cjs`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "coverage compute runs to completion"`
- Phase 2.3 started.
- Added Critical Nodes analysis to the combined visible-network summary:
  - estimates baseline covered area
  - ranks visible source nodes by coverage area lost if that source is removed
  - reports lost area as a share of the whole visible network
  - reports lost area as a share of that node's own covered area
- Node-failure analysis groups duplicate layers from the same source node so
  multiple runs for one node are not counted as independent redundancy.
- Focused node-failure verification passed:
  - `npx vitest run tests/unit/coverageNetwork.test.js tests/unit/config.test.js tests/unit/coverageMetadata.test.js`
  - `npm run typecheck`
  - `npx eslint src/coverageNetwork.js src/coverage.js tests/unit/coverageNetwork.test.js tests/unit/config.test.js tests/unit/coverageMetadata.test.js tests/smoke/workflow-smoke.spec.cjs`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "coverage compute runs to completion"`
- Critical Nodes rows now include a transient `Sim` action that excludes that
  source from combined summaries and combined overlays, and temporarily hides
  the source's coverage tiles without changing persisted layer or node
  visibility.
- Offline simulation shows an in-panel banner with a `Clear` action and
  restores the visible network view when cleared.
- Focused offline-simulation verification passed:
  - `npx vitest run tests/unit/coverageNetwork.test.js tests/unit/config.test.js tests/unit/coverageMetadata.test.js`
  - `npm run typecheck`
  - `npx eslint src/coverageNetwork.js src/coverage.js tests/unit/coverageNetwork.test.js tests/unit/config.test.js tests/unit/coverageMetadata.test.js tests/smoke/workflow-smoke.spec.cjs`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "coverage compute runs to completion"`
- Phase 3.1 started.
- Optimizer objective definitions now live in `src/optimizer.js` with explicit
  formulas and weights for the current objective modes:
  - Balanced
  - Coverage First
  - Robust Links
  - Backhaul First
- Optimizer candidate results now include a structured `scoreBreakdown`
  covering objective formula, coverage contribution, margin contribution,
  LoS/Fresnel contribution, source-backhaul contribution when applicable, and
  the fixed terrain-prominence tie-breaker.
- The Planning panel now shows the selected objective formula beside the
  optimization goal picker, and candidate result rows/popups show a compact
  "why" score contribution summary.
- Focused optimizer-objective verification passed:
  - `npx vitest run tests/unit/optimizer.test.js`
  - `npm run typecheck`
  - `npx eslint src/optimizer.js src/optimizerUI.js tests/unit/optimizer.test.js tests/smoke/workflow-smoke.spec.cjs`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "planning and coverage controls are interactive and stable"`
- Added the `Redundancy First` optimizer objective:
  - scores newly covered cells separately from already-covered cells
  - gives redundant coverage its own score contribution
  - can select a useful backup-coverage candidate even when it adds no new
    coverage cells
  - includes redundant coverage in candidate list/popup explanations
  - routes this objective through CPU scoring until CUDA optimizer parity exists
- Focused redundancy-objective verification passed:
  - `npx vitest run tests/unit/optimizer.test.js tests/unit/settings.test.js`
  - `npx eslint src/optimizer.js src/optimizerUI.js src/settings.js src/optimizerBackend.js tests/unit/optimizer.test.js tests/unit/settings.test.js tests/smoke/workflow-smoke.spec.cjs`
  - `npm run typecheck`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "planning and coverage controls are interactive and stable"`
- Added the `Min Repeaters To Target` optimizer objective:
  - adds a persisted target-coverage percentage control
  - uses a coverage-first scoring formula
  - stops early when the target coverage ratio is reached
  - reports target-reached completion separately from failed/no-result runs
  - routes this objective through CPU scoring until CUDA optimizer parity exists
- Focused target-coverage objective verification passed:
  - `npx vitest run tests/unit/optimizer.test.js tests/unit/settings.test.js`
  - `npx eslint src/optimizer.js src/optimizerUI.js src/settings.js src/optimizerBackend.js tests/unit/optimizer.test.js tests/unit/settings.test.js tests/smoke/workflow-smoke.spec.cjs`
  - `npm run typecheck`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "planning and coverage controls are interactive and stable"`
- Added shared optimizer diagnostics for empty results and target misses:
  - no-result runs now explain source-link rejections, LoS/Fresnel rejections,
    zero-new-coverage candidates, candidate scoring counts, and coverage state
  - target-coverage runs now warn when the target was not reached and show the
    final coverage ratio
  - the result list now renders a compact diagnostics row instead of staying
    empty when the optimizer cannot suggest a location
- Focused optimizer-diagnostics verification passed:
  - `npx vitest run tests/unit/optimizerDiagnostics.test.js tests/unit/optimizer.test.js`
  - `npx eslint src/optimizerDiagnostics.js src/optimizerUI.js src/optimizer.js tests/unit/optimizerDiagnostics.test.js tests/unit/optimizer.test.js`
  - `npm run typecheck`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "planning and coverage controls are interactive and stable"`
- Phase 3.2 started.
- Optimizer diagnostics now render for partial-success runs when constraints
  rejected other candidates, so successful source-linked runs can still explain:
  - below-margin source-link rejections
  - blocked source LoS rejections
  - blocked source Fresnel rejections
  - generic source-link rejections
- Source-link rejection summaries no longer double-count the generic backhaul
  rejection when a more specific margin/LoS/Fresnel reason is known.
- Focused partial-constraint diagnostics verification passed:
  - `npx vitest run tests/unit/optimizerDiagnostics.test.js`
  - `npx eslint src/optimizerDiagnostics.js src/optimizerUI.js tests/unit/optimizerDiagnostics.test.js`
  - `npm run typecheck`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "planning and coverage controls are interactive and stable"`
- Added a persisted `Prefer high ground` optimizer preference:
  - uses existing local elevation prominence as a configurable 6% tie-breaker
  - fetches terrain data when the preference is enabled
  - includes the terrain contribution in candidate score breakdowns
  - routes high-ground preference runs through CPU scoring until CUDA optimizer
    parity exists
- Focused high-ground preference verification passed:
  - `npx vitest run tests/unit/optimizer.test.js tests/unit/settings.test.js`
  - `npx eslint src/optimizer.js src/optimizerWorker.js src/optimizerBackend.js src/settings.js tests/unit/optimizer.test.js tests/unit/settings.test.js tests/smoke/workflow-smoke.spec.cjs`
  - `npm run typecheck`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "planning and coverage controls are interactive and stable"`
- Added an optional `Minimum Site Elevation` optimizer constraint:
  - persists a blank-or-number minimum elevation control
  - fetches terrain data when the constraint is set
  - rejects below-threshold candidates before source-link/RF scoring
  - reports below-minimum-elevation rejection counts in optimizer diagnostics
  - routes the constraint through CPU scoring until CUDA optimizer parity exists
- Focused minimum-elevation constraint verification passed:
  - `npx vitest run tests/unit/optimizer.test.js tests/unit/settings.test.js tests/unit/optimizerDiagnostics.test.js`
  - `npx eslint src/optimizer.js src/optimizerWorker.js src/optimizerBackend.js src/settings.js src/optimizerDiagnostics.js tests/unit/optimizer.test.js tests/unit/settings.test.js tests/unit/optimizerDiagnostics.test.js tests/smoke/workflow-smoke.spec.cjs`
  - `npm run typecheck`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "planning and coverage controls are interactive and stable"`
- Added map-drawn rectangular optimizer exclusion zones:
  - supports one or more session-local exclusion rectangles in Planning
  - clears exclusion zones together with search and coverage rectangles
  - rejects inside-zone candidates before elevation/source-link/RF scoring
  - reports inside-exclusion-zone rejection counts in optimizer diagnostics
  - routes exclusion-zone runs through CPU scoring until CUDA optimizer parity exists
- Focused exclusion-zone verification passed:
  - `npx vitest run tests/unit/optimizer.test.js tests/unit/optimizerDiagnostics.test.js`
  - `npx eslint src/optimizer.js src/optimizerUI.js src/optimizerWorker.js src/optimizerBackend.js src/optimizerDiagnostics.js tests/unit/optimizer.test.js tests/unit/optimizerDiagnostics.test.js tests/smoke/workflow-smoke.spec.cjs`
  - `npx eslint tests/smoke/planning-smoke.spec.cjs`
  - `npm run typecheck`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "planning and coverage controls are interactive and stable"`
  - `npx playwright test tests/smoke/planning-smoke.spec.cjs -g "opens planning tab and enables optimizer after drawing a search area"`
- Added an optional `Minimum Redundant Coverage` optimizer constraint:
  - persists a blank-or-percent redundancy target control
  - includes visible mesh nodes for redundancy-target runs even when gap-aware
    optimization is disabled
  - rejects candidates below the requested redundancy ratio after RF scoring
  - reports below-redundancy-target rejection counts in optimizer diagnostics
  - routes redundancy-target runs through CPU scoring until CUDA optimizer parity
    exists
- Focused redundancy-target verification passed:
  - `npx vitest run tests/unit/optimizer.test.js tests/unit/settings.test.js tests/unit/optimizerDiagnostics.test.js`
  - `npx eslint src/optimizer.js src/optimizerUI.js src/optimizerWorker.js src/optimizerBackend.js src/settings.js src/optimizerDiagnostics.js tests/unit/optimizer.test.js tests/unit/settings.test.js tests/unit/optimizerDiagnostics.test.js tests/smoke/workflow-smoke.spec.cjs`
  - `npm run typecheck`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "planning and coverage controls are interactive and stable"`
- Added an optional `Prefer road-adjacent sites` optimizer preference:
  - fetches accessible OSM highway ways for the search area when enabled
  - keeps road data memory-cached for the current session without widening IPC
    storage yet
  - blends up to 0.04 road-proximity contribution into candidate scoring while
    keeping RF quality primary
  - includes the access contribution in candidate score breakdowns
  - routes road-adjacent preference runs through CPU scoring until CUDA optimizer
    parity exists
- Focused road-adjacent preference verification passed:
  - `npx vitest run tests/unit/optimizer.test.js tests/unit/settings.test.js tests/unit/roads.test.js`
  - `npx eslint src/optimizer.js src/optimizerUI.js src/optimizerWorker.js src/optimizerBackend.js src/settings.js src/roads.js tests/unit/optimizer.test.js tests/unit/settings.test.js tests/unit/roads.test.js tests/smoke/workflow-smoke.spec.cjs`
  - `npm run typecheck`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "planning and coverage controls are interactive and stable"`
- Phase 3.3 current acceptance complete.
- Added shared optimizer candidate explanation rows:
  - list items and marker popups now use the same core detail formatter
  - shared rows include new coverage, score, elevation, average margin,
    redundancy, LoS/Fresnel ratios, backhaul margin/RX/distance, and the
    objective contribution summary
  - marker popups still add the full objective formula after the shared rows
  - explanation formatting is unit-tested outside the Leaflet UI
- Focused candidate-explanation verification passed:
  - `npx vitest run tests/unit/optimizerResultDetails.test.js tests/unit/optimizer.test.js`
  - `npx eslint src/optimizerResultDetails.js src/optimizerUI.js tests/unit/optimizerResultDetails.test.js`
  - `npm run typecheck`
  - `npm run build`
  - `npx playwright test tests/smoke/workflow-smoke.spec.cjs -g "planning and coverage controls are interactive and stable"`

## Phase 0: Audit And Product Definition

Target duration: 1 week

Goal: make the improvement path clear and remove stale guidance.

Work:

- Refresh `BUGS.md`, `summary.md`, and `README.md`.
- Remove or mark resolved stale bug entries.
- Define primary workflows:
  - add/import/live nodes
  - compute coverage
  - inspect weak spots
  - compare scenarios
  - optimize locations
  - validate P2P links
  - find relay paths
  - export results
- Define a scenario object concept:
  - nodes
  - settings
  - computed layers
  - data-quality metadata
  - timestamp and label
- Add or document lightweight per-run compute summaries:
  - backend used
  - grid size
  - runtime
  - cache hits/misses
  - DEM tiles fetched
  - OSM tiles fetched
  - warnings

Deliverables:

- Updated docs.
- Prioritized issue list.
- Workflow map.
- Acceptance criteria for phases 1-3.

Success criteria:

- No known stale bug entries remain unmarked.
- Each major workflow has a clear user outcome.
- Future agents can tell what to improve next without reading the entire codebase.

## Phase 1: Highest-Value UX Improvements

Target duration: 2-3 weeks

Goal: make current analysis results understandable without a full redesign.

### 1.1 Coverage Click Inspector

Status: Popup-level acceptance complete. The current implementation has a map
popup with modeled loss/reason details, visible multi-layer labels, Fresnel
status, and smoke coverage around a real map click. A fuller contextual
inspector remains deferred to Phase 4.1.

User question: "Why is this location covered or not covered?"

Work:

- Add map click inspection for computed coverage layers.
- Show the strongest serving node at that point.
- Show RSSI, margin, threshold, and distance.
- Show LoS/Fresnel status.
- Show diffraction loss, foliage loss, building loss, and shadow/reflection
  effects when available.
- Explain failed coverage:
  - outside radius
  - below threshold
  - terrain obstruction
  - foliage loss
  - building loss
  - no computed layer
- Support multiple layers and clearly identify which layer is being inspected.

Acceptance criteria:

- Clicking a covered point explains the serving node and margin.
- Clicking an uncovered point explains the likely reason.
- Existing map context interactions remain usable.
- Unit tests cover interpolation/inspection helpers.
- Smoke test covers at least one inspector interaction.

### 1.2 Coverage Run Metadata

Status: Current acceptance complete. Newly computed coverage layers persist run
metadata, the layer list shows a compact summary, and each layer has expandable
structured details. Coverage warnings now flow through a shared presentation
helper for persisted metadata, layer details, title text, count labels, and
planning-report notes, so current warning surfaces use the same normalized
strings and labels. Future warning work should attach to newly introduced
surfaces rather than adding local formatting.

User question: "How trustworthy and expensive was this result?"

Work:

- Persist metadata with each coverage layer:
  - settings snapshot
  - backend used
  - grid size
  - radius
  - created timestamp
  - data sources used
  - warnings
  - cache stats summary
- Show metadata from the layer list.
- Surface data-quality warnings consistently.

Acceptance criteria:

- A restored coverage layer still shows its metadata.
- Warnings do not disappear after a successful run.

### 1.3 Better Layer Manager

Status: Current acceptance complete. Layers support visibility, opacity, delete, compact
metadata, expandable details, direct persisted renaming, scenario/profile
grouping, reloading a layer's stored compute settings into the Coverage
controls, and one-click duplicate/recompute for the original source node. A
full drag/drop or multi-select manager remains deferred to the Phase 4 map-first
redesign.

User question: "Which result am I looking at?"

Work:

- Rename layers.
- Show timestamp and source node.
- Duplicate/recompute layer settings.
- Delete layers individually.
- Toggle layer visibility and opacity.
- Group layers by scenario label when scenarios exist.

Acceptance criteria:

- Users can distinguish two coverage runs with different settings.
- Layer state persists across app restart where applicable.

## Phase 2: Network-Level Analysis

Target duration: 3-4 weeks

Goal: move from per-node visual simulation to network planning.

### 2.1 Combined Coverage

Status: Overlay acceptance complete. The Coverage panel now has an approximate
combined visible-network summary and separate combined map overlays for best
margin, strongest node, uncovered gaps, overlap count, and covered-by-N, all
derived from visible computed layers.

User question: "What does the whole mesh cover?"

Work:

- Add combined network layer modes:
  - best margin
  - strongest node
  - uncovered gaps
  - overlap count
  - covered by at least N nodes
- Compute combined stats from existing coverage results where possible.
- Make layer mode independent of individual per-node coverage layers.

Acceptance criteria:

- User can see network-wide covered and uncovered areas.
- User can identify which node serves a point.
- Combined layer updates when source layers are hidden/deleted.

### 2.2 Network Statistics

Status: Current acceptance complete. The Coverage panel shows an expandable
Network Stats detail view for combined visible coverage with analysis,
covered/uncovered, overlap, weak-margin, average/median/best margin, sample-grid,
top-serving, and full per-node contribution rows. Coverage GeoJSON/GIS metadata
and planning reports include the same visible-network stats snapshot, including
full node contributions. Future refinements can add population/accessibility
weighted stats when those data sources exist.

User question: "How good is this network?"

Work:

- Covered area estimate.
- Uncovered area estimate within analysis bounds.
- Average and median margin.
- Weak-cell count.
- Overlap/redundancy percentage.
- Top serving nodes.
- Coverage by node contribution.

Acceptance criteria:

- Stats are visible for a combined network result.
- Export includes these stats.

### 2.3 Node-Failure Analysis

Status: Current acceptance complete. The Coverage panel includes Critical Nodes
impact ranking and a transient simulate-offline action that recalculates the
visible network without mutating node state or persisted layer visibility.
Richer ranking data such as population or accessibility weighting remains
future work when those data sources exist.

User question: "Which nodes are critical?"

Work:

- Show coverage lost if a node is removed.
- Rank critical nodes by lost area or lost population/proxy if later added.
- Add a "simulate node offline" toggle.

Acceptance criteria:

- User can identify the most critical node in a computed network.
- Node-failure view does not mutate actual node state.

## Phase 3: Optimizer V2

Target duration: 4-5 weeks

Goal: make optimizer useful for real planning constraints.

### 3.1 Objectives

Status: Current acceptance mostly complete for objective transparency. The
current objective modes now have exported scoring formulas, an in-panel formula
note, and per-candidate score breakdown data in the list and marker popup.
Redundancy First has first-pass CPU scoring that rewards backup coverage over
already-served cells; CUDA can now run the Redundancy First objective for
plain no-existing-node searches and report coverage/redundancy point counts
without falling back to CPU. Min Repeaters To Target can stop early once the
requested coverage target is reached. No-result and target-miss runs now show
diagnostics instead of leaving the result list empty. CPU Redundancy First now
tracks per-cell coverage counts so first-backup coverage is valued above
repeatedly stacked backups on already multiply-covered cells, and Redundancy
First now automatically requests visible existing-node context instead of
depending on the separate Gap Aware toggle. CUDA Redundancy First now tracks
coverage depth across placed suggestions for supported no-existing-node runs,
and CUDA can enforce target-only `minRedundancyRatio` filters with
`rejectedByRedundancy` diagnostics when no existing-node context is needed.
Remaining work is CUDA parity for objective paths that still need CPU-only
diagnostics, especially existing-node coverage context and redundancy targets
that depend on that context.

User question: "What should this optimization optimize for?"

Add objective modes:

- Maximize coverage.
- Maximize robust margin.
- Maximize backhaul quality.
- Maximize redundancy.
- Minimize repeater count for target coverage.
- Balanced planning objective.

Acceptance criteria:

- Each objective has a documented scoring formula.
- Optimizer result shows why the objective picked each candidate.

### 3.2 Constraints

Status: Current acceptance complete. Existing source-link constraints now
report aggregate rejection reasons in diagnostics for both no-result and
partial-success optimizer runs. The optimizer now has a configurable
high-ground preference built from local terrain prominence, an optional minimum
site elevation constraint, map-drawn rectangular exclusion zones, an optional
minimum redundancy target, and an optional road-adjacent preference. Future
refinements can add persistent road caching, road-type weighting, or hard
accessibility constraints.

User question: "Can this site actually work in my network?"

Add constraints:

- Require source/backhaul link.
- Require minimum backhaul margin.
- Require LoS and/or Fresnel clearance.
- Avoid exclusion zones.
- Prefer high elevation.
- Prefer accessible/road-adjacent areas if data is available.
- Require integration with visible existing mesh.
- Require redundancy target.

Acceptance criteria:

- Rejected candidates report reasons.
- Source-linked optimization remains cancelable and testable.
- Constraint settings do not silently invalidate all results without explanation.

### 3.3 Candidate Explanations

Status: Current acceptance complete. Optimizer candidate list rows and marker
popups now share the same core explanation details, and no-result or
partial-success optimizer runs render diagnostics. Future refinements can add a
full optimizer-candidate inspector and retained rejected-candidate samples.

User question: "Why is this a good or bad site?"

Work:

- Score breakdown per candidate:
  - new coverage
  - average margin
  - LoS/Fresnel ratio
  - backhaul margin
  - redundancy
  - rejection reason
- Improve map popups and result list.

Acceptance criteria:

- Candidate marker and list item show the same core score details.
- Result list can explain zero-result optimizer runs.

## Phase 4: Map-First UI Redesign

Target duration: 4-6 weeks

Goal: make the app feel like a planning workstation instead of a dense sidebar.

Recommended layout:

- Left rail: workflow icons.
- Left panel: controls for the active workflow.
- Center: dominant map canvas.
- Right inspector: details for selected object.
- Bottom job drawer: progress, warnings, logs, cancel controls.

Workflow groups:

- Build: add/import/live nodes.
- Analyze: coverage, layers, point inspection.
- Validate: P2P links and relay paths.
- Optimize: area search and candidate review.
- Export: reports, screenshots, GIS exports.
- Settings: defaults, cache, developer tools.

### 4.1 Contextual Inspector

Status: Started. The app now has a persistent right inspector with a
no-selection project summary, quick workflow actions, node marker/list
selection with core node actions, P2P/relay link selection with budget summary
actions, optimizer candidate selection with add/backhaul actions,
coverage-point selection that mirrors the popup's visible coverage/loss
breakdown, and obstacle selection with OSM/modeling assumptions. Current
selection-state acceptance, single selected-object highlighting, and initial
multi-node selection from the node list and map markers are covered, including
node-list Shift-click range selection. Remaining polish is any future bulk
edit/export/profile actions that prove necessary.

User question: "What am I looking at, and what can I do next?"

Inspector states:

- No selection: quick project summary and next actions.
- Node selected: radio config, visibility, coverage, P2P, optimize, delete.
- Coverage point selected: best node and loss breakdown.
- Link selected: budget, terrain profile, recompute/export.
- Optimizer candidate selected: score breakdown, add node, show backhaul.
- Obstacle selected: OSM type, height, attenuation assumptions.

Acceptance criteria:

- Selecting a map object opens the correct inspector.
- Inspector actions do not require hunting through unrelated tabs.

### 4.2 Job Drawer

Status: Implemented for current workflows. The bottom job drawer mirrors shared
progress jobs, exposes the shared cancel handler, preserves the last completed
job summary, and carries job metadata for coverage, optimizer, relay path,
cache-warm, and explicit map-layer refresh workflows. Initial persisted layer
restore remains silent so app launch does not look busy. Coverage and optimizer
surface backend context and warning counts where known. Recent completed jobs
are inspectable from the drawer and capped to the five newest entries. Progress
messages with existing `(ETA ...)` suffixes now render ETA as a stable drawer
detail, and running/completed summaries include elapsed runtime. Future polish:
Phase 5 added a typed active-job store; future polish can move individual
workflow progress emitters onto richer structured stage payloads.

User question: "What is running and can I cancel it?"

Work:

- Show coverage, optimizer, pathfinder, cache-warm, and layer-load jobs.
- Show percent, stage, ETA where known, backend, and warning count.
- Preserve recent completed job summaries.

Acceptance criteria:

- Long-running jobs have one consistent cancel surface.
- Job summaries are inspectable after completion.

### 4.3 3D As Analysis View

Status: Implemented for current scope. The 3D view keeps 2D primary while
making terrain source state explicit and adding a selected-object path into 3D.
Live DEM terrain and synthetic preview terrain now have distinct final status
messages, preview terrain remains a warning after scene rebuild, and the 3D
panel exposes `data-terrain-source` for verification. Map points, nodes, links,
and optimizer candidates can open 3D focused on their selected geometry through
one shared `map3d:focus` event. Map texture fetching now lowers source zoom
when the final texture would be heavily downsampled, while keeping tile request
caps and exposing texture zoom/scale metadata for verification. Future polish:
use the Phase 5 selected-object store for richer selected-object analysis
overlays in 3D.

User question: "How does terrain explain this result?"

Work:

- Keep 2D as primary.
- Use 3D for selected coverage/link analysis.
- Make fallback/synthetic terrain status obvious.
- Avoid over-fetching texture tiles when final texture is downscaled.

Acceptance criteria:

- 3D view clearly communicates data source state.
- 3D does not keep unnecessary hidden resources alive.

## Phase 5: Rewrite Foundation

Target duration: 3-5 weeks

Goal: prepare architecture without freezing product work.

Status: Current acceptance complete. `propagation`, `coverageGrid`, `radioMetrics`,
`repeaterRows`, `linkBudget`, `pathfinder`, `signalModel`, `settings`,
`settingsPersistence`, `eirp`, `signalOverlay`, `coverageMetadata`,
`optimizerDiagnostics`, `optimizerResultDetails`, `ui`, `uiDisclosure`,
`coveragePersistence`, `mapTileTexture`, `terrain3dModel`, `roads`,
`coveragePoint`, `osmGeometry`, `coverageNetwork`, `osmTilePipeline`,
`requestScheduler`, `scenarios`, `map`, `mapAdapter`, `coverageWorkerPool`,
`coverageWorker`, `coverageBackend`, `devConsole`, `terrainProfileView`,
`optimizerWorker`, `optimizerBackend`, `presets`, `mapLayers`, `config`,
`pathfinderUI`, `elevation`, `foliage`, `buildings`, `mapContext`,
`repeaters`, `p2p`, `optimizer`, `map3d`, `optimizerUI`, `coverage`,
`shellInit`, the root renderer `app` entry, the Electron preload bridge, and
the Electron main entry are the first source modules ported to TypeScript, with
existing `.js` imports left stable and build/typecheck verification passing.
Repeater config rows,
live WebSocket snapshot rows, P2P link-budget calculation, relay path search,
shared signal modeling, settings parsers, persisted setting controls, EIRP
hint bindings, coverage overlay colorization, persisted coverage metadata,
optimizer diagnostic/detail messages, shared progress/status UI helpers,
progressive disclosure bindings, coverage layer persistence, 3D texture
layout, 3D terrain geometry, road-access data, coverage point inspection, OSM
geometry, combined coverage summaries/overlays, OSM tile batching, per-host
request scheduling, scenario presets, map singleton state/base-layer helpers,
map coverage overlay tile adapters, CPU coverage worker pools, CPU coverage
worker row rendering, coverage backend selection, developer console capture,
terrain profile SVG rendering, optimizer worker scoring, optimizer backend
selection, preset UI population/bindings, independent OSM map-layer overlays,
core propagation math/geometry helpers, project config save/load/export
helpers, relay path UI bindings, elevation cache/API/DEM tile services,
foliage OSM/attenuation services, building/structure OSM attenuation services,
map selection/context inspector rendering, repeater CRUD/live-feed UI, P2P
picking/profile UI, optimizer scoring/objective helpers, 3D terrain view
state/overlays, coverage analysis/layer orchestration, shell boot wiring,
renderer app initialization, preload IPC bridge callbacks, Electron main
startup, window navigation guards, cache DB lifecycle, CUDA helper orchestration,
and IPC trust-boundary handlers now have explicit types. The TypeScript source
migration milestone is complete: no root or `src/**` application source files
remain as `.js`. First IPC schema helpers are extracted and directly tested for
cache/source/blob/WS-row payload boundaries. Saved project config parsing is
now isolated in a pure schema helper with direct tests for malformed JSON,
settings shape, and repeater import normalization. Coverage layer persistence
now validates restored layer records and sanitizes localStorage layer prefs.
Persisted settings restore now goes through a pure settings-record parser shared
by saved config parsing. Preset YAML payloads now validate and fall back per
group before populating the renderer preset controls. CUDA coverage/optimizer
request payloads now have pure schema helpers for array coercion, size bounds,
candidate packing, and obstacle serialization. The job drawer now renders from
a pure active-job store with typed metadata, ETA parsing, elapsed-time display,
completion summaries, and capped history. The selection inspector now uses a
pure selected-object store for map point, node, link, optimizer candidate, and
obstacle state transitions. Live-feed connection/imported-node state, settings
gather/apply/persist/restore, repeaters/next-id, and coverage layer/result
state now have explicit store modules. Coverage and optimizer backends share a
job runner abstraction for CPU/CUDA fallback, cancellation, unsupported backend
handling, and all-failed errors. Phase 5 acceptance is complete; future work
should move to Phase 6 UI/component migration or deeper domain-store ownership
changes only when tied to a concrete workflow.

Recommended module structure:

```text
core/
  Pure RF math, terrain profile math, OSM geometry, scoring.

services/
  Elevation, OSM/Overpass, cache, presets, WebSocket feed.

compute/
  CPU worker backend, CUDA backend, job runner abstraction.

state/
  Repeaters, settings, coverage layers, active jobs, selected object.

ui/
  Map shell, panels, inspector, layer manager, modals.

electron/
  Main process, preload, IPC schemas, cache DB, screenshots, CUDA bridge.
```

Work:

- Port pure modules to TypeScript first:
  - propagation
  - signal model
  - link budget
  - coverage grid
  - radio metrics
  - OSM geometry
- Add schemas for:
  - repeater
  - settings
  - config file
  - WebSocket row
  - coverage layer
  - IPC payloads
  - CUDA payloads
- Create explicit stores:
  - repeaters
  - settings
  - selected object
  - coverage layers
  - jobs
  - live feed
- Add shared job runner abstraction:
  - CPU worker runner
  - CUDA runner
  - progress/cancel/result interface

Acceptance criteria:

- Existing tests pass.
- Physics output remains unchanged except for intentional tested fixes.
- UI code no longer owns all core state directly.
- IPC/config/WS boundaries have schema tests.

## Phase 6: Incremental UI Rewrite

Target duration: 6-10 weeks

Goal: replace imperative DOM-heavy panels with maintainable components.

Status: Started. The coverage layer manager, coverage inspector, node
list/editor, P2P result panel, optimizer result list, settings/cache summary,
3D view controls, coverage network summary, relay path result panel, Best Relay
Path endpoint selects, job drawer, shared progress overlay, and developer
console now have dedicated typed view helpers and direct view tests for their
main UI states while keeping the existing DOM surface and workflow callbacks
intact. Next Phase 6 work should decide whether to introduce Preact/signals or
keep extracting smaller DOM-helper boundaries for remaining panels.

Recommended stack:

- Preact + signals for app UI/state.
- Keep Leaflet and Three.js imperative inside map components.

Alternative:

- Lit web components if a smaller incremental migration is preferred.

Migration order:

1. Coverage layer manager.
2. Coverage inspector.
3. Node list/editor.
4. P2P result panel.
5. Optimizer panel.
6. Settings/cache panel.
7. 3D view controls.
8. Coverage network summary.
9. Relay path result panel.

Acceptance criteria:

- No feature regression in migrated panels.
- String-built HTML is reduced in high-risk panels.
- Component tests cover migrated UI states.
- Playwright smoke tests cover primary workflows.

## Phase 7: Reports, Offline Prep, And Live Network Health

Target duration: 4-6 weeks

Goal: make the app useful beyond interactive simulation.

### 7.1 Planning Reports

Status: Current acceptance complete. The app can now export a self-contained
HTML or PDF planning report from the Settings panel with an embedded map
screenshot, node table, coverage/network statistics, weak-area metrics, active
P2P and relay critical-link summaries, latest optimizer recommendations,
settings, and data-quality notes. Future polish can add richer map annotations
and extra report sections discovered during field-style scenario testing.

Work:

- Export HTML/PDF report with:
  - map screenshot
  - node table
  - coverage stats
  - weak areas
  - P2P critical links
  - optimizer recommendations
  - settings and data-quality notes

Acceptance criteria:

- Report can be generated from a complete scenario.
- Report includes enough metadata to reproduce the run.

### 7.2 GIS Exports

Status: Current acceptance complete for bounded raster-derived exports. The
Settings panel now exports visible coverage as combined-network GeoJSON
polygons, per-node GeoJSON polygons, combined KML, and combined KMZ, with
downsampling metadata for large grids. Future polish can add true isoline
contours and richer GIS styling, but exports are no longer limited to point
clouds.

Work:

- Export GeoJSON polygons/contours, not only points.
- Add KML/KMZ export.
- Export combined network layers and per-node layers.

Acceptance criteria:

- Exports load cleanly in common GIS tools.
- Large exports are bounded or clearly downsampled.

### 7.3 Offline Area Preparation

Status: Current acceptance complete for viewport-defined prep areas. The
Settings panel can set the current viewport as an offline prep area, prefetch
DEM terrain, foliage, and building data for that area, cancel the job, and show
readiness by data type. Map tiles remain explicitly online-only until provider
terms and tile caching are designed.

Work:

- Define an offline preparation area.
- Pre-fetch DEM tiles.
- Pre-fetch OSM foliage/building tiles.
- Optionally prepare map tiles if allowed by provider terms.
- Show cache readiness by data type.

Acceptance criteria:

- User can prepare a known area before field work.
- App clearly indicates what is cached and what still needs internet.

### 7.4 Live Network Health

Status: Current acceptance complete for live-feed health visibility. Live and
planned nodes are visually distinct, stale/missing live nodes are highlighted in
the node list and map marker stroke, the live feed panel summarizes health
counts, and the node inspector exposes health detail. Current-live coverage can
be viewed by hiding stale/missing nodes and recomputing coverage; future work
can automate degraded-coverage scenarios and add movement trails.

Work:

- Last-seen age coloring.
- Stale/missing node alerts.
- Live vs planned node state.
- Degraded coverage when live nodes disappear.
- Optional movement/history trail.

Acceptance criteria:

- Live feed users can see stale nodes at a glance.
- Network coverage can be viewed in current-live state.

## Near-Term Sprint Plan

### Sprint 1

- Refresh docs and stale bug tracking.
- Add or formalize coverage run metadata.
- Design coverage inspector data model.
- Add tests for point inspection helpers.

### Sprint 2

- Implement coverage click inspector.
- Add loss/explanation breakdown.
- Add one smoke test for map inspection.

### Sprint 3

- Improve coverage layer manager.
- Add layer metadata, rename, duplicate/recompute settings.
- Add scenario labels.

### Sprint 4

- Build combined network coverage layer.
- Add strongest-node and uncovered-gap overlays.

### Sprint 5

- Add network stats.
- Add node-failure impact view.

## Verification Expectations

For documentation-only changes:

- Read the changed file for clarity and consistency.

For pure helper/model changes:

- Add or update Vitest unit tests.
- Run targeted unit tests first, then `npm test` when feasible.

For UI changes:

- Add unit tests for pure helpers.
- Add or update Playwright smoke tests for the workflow.
- Use the app/browser to visually verify desktop and narrow layouts where
  relevant.

For compute/backend changes:

- Add parity tests between CPU and CUDA payload paths where possible.
- Validate cancellation.
- Validate malformed payload handling.
- Check memory and grid-size limits.

For release-worthy changes:

- Run `npm run check`.

## Open Product Questions

- Should scenarios become a first-class persisted project object?
- Should combined network coverage be computed from stored per-node layers or
  via a new backend pass?
- What export format matters most to users: GeoJSON polygons, KML/KMZ, PDF, or
  HTML?
- Should optimizer support exclusion zones drawn by users before road/access
  preference work begins?
- Should live WebSocket nodes be treated as editable planned nodes, separate
  live nodes, or both?
