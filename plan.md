# MeshCore Mapper — Remaining Work

Last reviewed: May 2026. All 22 items from the initial sprint (B1–B4, A1–A3, P1–P11, U1–U6) are **complete**.

---

## Active

### U5 · No "Copy to Optimizer" shortcut
**Files:** `src/optimizerUI.js`, `index.html`

Users typically want to run the optimizer with the same radio settings as the repeaters they are configuring. There is no way to transfer values across.

**Fix:** a small "← Use current settings" button below the optimizer form header that copies `#repeater-power`, `#repeater-gain`, `#repeater-freq`, `#repeater-height` into the corresponding optimizer fields (`#opt-power`, `#opt-gain`, `#opt-freq`, `#opt-height`).

```html
<button id="btn-copy-to-opt" class="btn-secondary full-width">← Use current node settings</button>
```

```js
// in optimizerUI.js init()
document.getElementById('btn-copy-to-opt').addEventListener('click', () => {
  document.getElementById('opt-power').value  = document.getElementById('repeater-power').value;
  document.getElementById('opt-gain').value   = document.getElementById('repeater-gain').value;
  document.getElementById('opt-freq').value   = document.getElementById('repeater-freq').value;
  document.getElementById('opt-height').value = document.getElementById('repeater-height').value;
});
```

---

## Roadmap (out of sprint scope)

| ID | Feature | Notes |
|----|---------|-------|
| F1 | Export coverage heatmap as PNG | Canvas is already rendered; `canvas.toBlob()` → `electronAPI.saveImage()` |
| F2 | Point-to-point link budget panel | Click two map points; show FSPL, diffraction loss, received power |
| F4 | Cache management panel | Show DB size; button to purge entries older than N days |
| F5 | Undo last removed repeater | Single-level undo via saved repeater snapshot |
| F6 | Drag-to-resize sidebar | `ResizeObserver` + CSS variable for sidebar width |

Rework RF signal propagation accoring to LoS and foliage coverace. Currently foliage coverage blocks unrealistically high amount of signal in simulation. try to implement a foliage calculation with line of sight combined, where there are different foliage types and they just block signal only up to a average height of that foliage.

Have as accurate as possible height data, and instead of decreasing resolution with bigger simulation radius, batch it into multiple higher density subgrids.

---

## Completed (reference)

All items below are implemented and verified in the current codebase.

| ID | Item |
|----|------|
| B1 | `addRepeater` gain arg missing in optimizer results → fixed |
| B2 | Foliage layers not cleared on repeater delete → fixed |
| B3 | Single-slot foliage cache fails with multiple repeaters → Map-based 8-entry cache |
| B4 | Preset selects stale in edit mode → reset to blank on `setEditMode` |
| A1 | `window.removeRepeater` / `window.editRepeater` globals → event delegation |
| A2 | Storage key `loraMapper_settings` → `meshcoreMapper_settings` with legacy migration |
| A3 | No elevation API fallback → opentopodata.org fallback added |
| P1 | Per-cell `profile = []` allocation → pre-allocated `Float32Array` |
| P2 | Linear polygon scan in foliageLossDb → 16×16 tile-grid spatial index |
| P3 | `haversine` in inner loop → flat-Earth distance (`mPerLat`/`mPerLon`) |
| P4 | `fspl` constant recomputed per cell → `fsplBase` hoisted outside loop |
| P5 | λ and fracs recomputed in every `checkLoS` call → lazy `Map` caches |
| P6 | `signalToRGBA` allocates array per pixel → `writePixel` writes directly to buffer |
| P7 | Optimizer re-signals winning candidate → cached `Float32Array` from scoring pass |
| P8 | 400 ms batch delay on cache hits → delay only inside `_fetchFromAPI` |
| P9 | `gridPoints` object array → parallel `Float64Array` for lat/lon |
| P10 | Elevation grid matched to signal grid → capped at `ELEV_RES = min(gridRes, 128)` |
| P11 | 65 536 per-point SQL queries → single bbox `SELECT … WHERE lat BETWEEN` |
| U1 | No edit-mode visual feedback → `.editing` CSS class on active list item |
| U2 | Forest Loss field always visible → hidden when foliage checkbox is off |
| U3 | Only "Clear All" available → "Clear Coverage" button added |
| U4 | Radio/antenna presets don't sync to optimizer → `opt-power`/`opt-gain` updated |
| U6 | Optimizer panel had no presets → Radio + Antenna presets added |