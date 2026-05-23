# MeshCore Coverage Mapper

Desktop app (Electron) for visualising MeshCore / Meshtastic repeater coverage with real terrain line-of-sight and foliage attenuation, and for finding optimal repeater placement locations.

## Quick Start

```
npm install
npm start
```

Requires internet access for the elevation API (open-elevation.com + opentopodata.org fallback).

---

## Features

- **Coverage heatmap** — per-repeater signal-strength overlay rendered to a Leaflet image layer
- **Terrain LoS** — 32-sample terrain profiles with knife-edge diffraction (ITU-R P.526-15)
- **Fresnel zone clearance** — optional first-zone obstruction penalty
- **Foliage attenuation** — signal loss through OSM forest/wood/scrub/orchard polygons (Overpass API); configurable dB/m; 16×16 tile-grid index for fast lookup
- **Antenna gain** — per-repeater gain (dBi) applied to effective TX EIRP
- **System / fade margin** — link margin subtracted from coverage threshold so the map shows *reliable* coverage, not theoretical maximum range
- **Radio + antenna presets** — quick-fill dropdowns for common MeshCore / Meshtastic hardware; presets sync between the main panel and the optimizer panel
- **Optimizer** — draw a search area, find the best N repeater placements by greedy marginal-coverage scoring; uses cached winner signals and flat-Earth distance for speed
- **Save / Load configuration** — export all repeaters + propagation settings to JSON, reload in a later session
- **Persistent settings** — propagation settings auto-saved to `localStorage` under `meshcoreMapper_settings` (legacy `loraMapper_settings` migrated automatically)
- **Clear Coverage button** — removes coverage + foliage overlays without touching repeater markers
- **In-app developer console** — collapsible log panel in the sidebar; F12 opens Chrome DevTools
- **Drag-to-reposition** repeater markers
- **Map layers** — Streets, Satellite, and Terrain basemaps via Leaflet

---

## Signal Level Legend

Signal levels are *effective received power* (TX power + antenna gain − all losses).

| Colour | Received power |
|---|---|
| Green | > −90 dBm (strong) |
| Yellow-green | −90 to −110 dBm (good) |
| Amber | −110 to −125 dBm (marginal) |
| Orange-red | −125 dBm to effective threshold (weak) |
| Dark red | Below threshold — no coverage |

**Effective threshold** = Receiver Sensitivity + System Fade Margin. With the defaults (−137 dBm + 10 dB), anything below −127 dBm shows as no coverage.

---

## MeshCore / Meshtastic Modem Presets

Common sensitivity values for the SX1262 chip:

| Preset | SF | BW (kHz) | Sensitivity (dBm) | TX Power |
|---|---|---|---|---|
| Long Slow (max range) | SF12 | 125 | −137 | 20–22 dBm |
| Long Fast (MeshCore default) | SF11 | 250 | −133 | 20–22 dBm |
| Medium Slow | SF10 | 125 | −132 | 20–22 dBm |
| Medium Fast | SF9 | 250 | −129 | 20–22 dBm |
| Short Slow | SF8 | 125 | −126 | 20–22 dBm |
| Short Fast | SF7 | 250 | −120 | 20–22 dBm |

**Recommended settings for reliable mesh routing:**
- Set *Receiver Sensitivity* to match your modem preset.
- Set *System / Fade Margin* to **10 dB** minimum (15 dB for critical links).
- Set *Antenna Gain* to the dBi of the actual antenna — typically 2 dBi for a rubber duck, 3–5 dBi for a fibreglass omni, 6–12 dBi for a high-gain omni or Yagi.

**Regulatory note:** EU 868 MHz is typically limited to 25 mW EIRP (14 dBm) or 500 mW (27 dBm) at 1% duty cycle. US 915 MHz allows up to 30 dBm EIRP. The TX Power field is raw TX output; effective EIRP = TX Power + Antenna Gain − cable losses.

---

## Project Structure

```
app.js           Entry point — imports and inits all feature modules

src/
  map.js         Leaflet map singleton, shared state, clearCoverageLayers/clearFoliageLayers
  ui.js          Progress overlay, status bar, yieldToUI, escHtml
  repeaters.js   Repeater CRUD, map markers, placement UI; event-delegated list
  coverage.js    Coverage analysis + heatmap rendering; Float64/Float32 grids; writePixel
  optimizerUI.js Draw search area, run optimizer, display results
  optimizer.js   findBestLocations() — greedy grid search, no DOM; cached winner signals
  config.js      saveConfig(), loadConfig(), settings persistence (meshcoreMapper_settings)
  devConsole.js  In-app log panel; intercepts console.log/warn/error/info

  elevation.js   fetchElevations() — SRTM via open-elevation.com + opentopodata.org fallback;
                 SQLite bbox-cache warm-up; batched 256-point requests
  foliage.js     fetchFoliage() — OSM polygons via Overpass API; Map-based 8-entry session
                 cache; 16×16 tile-grid spatial index; foliageLossDb()
  propagation.js haversine, fspl, checkLoS (ITU-R P.526-15), signalToRGBA,
                 bilinearElev, writePixel; lazy lambda/fracs caches

index.html       Layout and sidebar controls
style.css        Dark-mode UI styles
main.js          Electron main process; SQLite elevation + foliage caches via sql.js
preload.js       contextBridge — saveFile, openFile, cache IPC to renderer
```

### Adding a new feature

1. Create `src/myFeature.js` — import from `map.js`, `ui.js`, `propagation.js` as needed.
2. Export `init()` that registers its event listeners.
3. Add one line to `app.js`: `import { init as initMyFeature } from './src/myFeature.js'; initMyFeature();`
4. Add HTML panels to `index.html` and styles to `style.css`.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| F12 | Toggle Chrome DevTools |

---

## Physics

| Model | Detail |
|---|---|
| Path loss | Free-Space Path Loss: `FSPL = 20·log10(d_m) + 20·log10(f_Hz) − 147.55` (dB) |
| Effective EIRP | `TX Power (dBm) + Antenna Gain (dBi)` applied per repeater |
| Terrain blockage | Fresnel-Kirchhoff ν; single knife-edge diffraction loss (ITU-R P.526-15) |
| Foliage loss | Configurable dB/m × traversal depth through OSM forest/scrub polygons (default 0.3 dB/m @ 868 MHz; scrub/orchard use 0.5× multiplier) |
| Coverage threshold | `Receiver Sensitivity + System Fade Margin` |
| Elevation data | SRTM 30 m via [open-elevation.com](https://open-elevation.com); [opentopodata.org](https://api.opentopodata.org) as fallback; grid capped at 128×128 per repeater; SQLite bbox cache |

**Path loss model notes:**
- FSPL (free-space, n = 2) is accurate for clear LoS paths typical of hilltop relay nodes.
- Real-world excess loss of 2–6 dB above FSPL is common even for clear LoS links. Use the fade margin to account for this rather than guessing a path-loss exponent.
- For NLOS/urban paths the diffraction loss term dominates; FSPL is not the limiting factor.
