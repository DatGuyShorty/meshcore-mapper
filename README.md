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

### Nodes tab
- Add repeaters by manual coordinates or by clicking the map; draggable markers
- Per-repeater: name, TX power, antenna gain, frequency, antenna height
- Radio and antenna presets from `presets.yaml`
- Active node list with inline edit and delete; **Undo Last Remove**
- Clear All Nodes

### Coverage tab
- **Coverage heatmap** — continuous gradient overlay (red → amber → yellow → green) showing received power as a smooth gradient over a 50 dB range above the sensitivity threshold
- **Terrain LoS** — 32-sample terrain profiles with knife-edge diffraction (ITU-R P.526-15)
- **Earth curvature correction** — standard atmosphere k = 4/3 effective Earth radius applied to each terrain sample; ~14 m correction at 15 km range
- **Fresnel zone clearance** — optional first-zone obstruction penalty
- **Foliage attenuation** — signal loss through OSM forest/wood/scrub/orchard polygons; configurable dB/m; height-aware (ray vs canopy top); 16×16 tile-grid index
- **Adaptive elevation resolution** — ELEV_RES = min(radiusKm × 2000 / 150, 256) ≈ 150 m/cell
- **Web Worker** — signal computation runs in a background thread; main thread stays responsive during compute
- System / fade margin, RX sensitivity, analysis radius, grid resolution controls
- Opacity slider for the coverage overlay

### Tools tab
- **Best Location Optimizer** — draw a search area on the map; greedy N-repeater placement by marginal coverage scoring; candidate grid 12–32 resolution
- **Link Budget (P2P)** — click two map points; fetches 64-point elevation profile; reports distance, FSPL, diffraction loss, received power, link margin (colour-coded), LoS status

### Settings tab
- **Save / Load configuration** — export all repeaters + settings to JSON, reload later
- **Screenshot export** — saves the current map view as PNG
- **Cache management** — shows SQLite cache stats (elevation points, foliage areas, disk size); purge buttons for elevations and foliage
- **Developer console** — collapsible log panel; intercepts console.log/warn/error/info/debug; F12 opens Chrome DevTools

### General
- Radio + antenna presets from `presets.yaml`; extend without touching code
- Persistent settings via `localStorage` (`meshcoreMapper_settings`)
- Drag-to-resize sidebar (220–600 px)
- Multiple basemaps: Streets (OSM), Satellite (Esri), Terrain (OpenTopoMap)

---

## Signal Level Legend

Signal levels are *effective received power* (TX EIRP − all path losses).

The overlay uses a **continuous gradient** — colours blend smoothly based on exact dB level:

| Colour | Signal level |
|---|---|
| Green | Strong (+40–50 dB above threshold) |
| Yellow-green | Good (+30–40 dB) |
| Yellow | Moderate (+20–30 dB) |
| Amber | Marginal (+10–20 dB) |
| Red-orange | Weak (+0–10 dB above threshold) |
| Dark red | Below threshold — no coverage |

**Effective threshold** = Receiver Sensitivity + System Fade Margin. With the defaults (−137 dBm + 10 dB), colours span from −127 dBm (red) to −77 dBm (green).

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
app.js               Entry point — imports and inits all feature modules

src/
  map.js             Leaflet map singleton, shared state, clearCoverageLayers/clearFoliageLayers
  ui.js              Progress overlay, status bar, yieldToUI, escHtml
  repeaters.js       Repeater CRUD, map markers, placement UI, undo-last-remove
  coverage.js        Coverage orchestration: fetch elevations/foliage, spawn Worker, render overlay
  coverageWorker.js  Web Worker — pure signal computation inner loop (no DOM)
  optimizerUI.js     Draw search area, run optimizer, display results
  optimizer.js       findBestLocations() — greedy grid search, no DOM
  p2p.js             P2P link budget panel — pick two points, full budget table
  config.js          saveConfig, loadConfig, screenshot, cache stats/purge
  devConsole.js      In-app log panel; intercepts all console.* methods
  presets.js         Loads presets.yaml via IPC; populates hardware/modem selects

  elevation.js       fetchElevations() — SRTM via open-elevation.com + opentopodata.org;
                     SQLite bbox-cache; batched 256-point requests with retries
  foliage.js         fetchFoliage() — OSM polygons via Overpass API; 8-entry mem cache +
                     SQLite 30-day cache; 16×16 tile-grid spatial index; foliageLossDb()
  propagation.js     haversine, fspl, checkLoS (ITU-R P.526-15 + Earth curvature k=4/3),
                     bilinearElev, writePixel (gradient); cached lambda/fracs

index.html           Layout, tab bar, sidebar panels, drag-resize handle
style.css            Dark-mode UI, tab system, gradient legend, DevConsole styles
main.js              Electron main — sql.js SQLite cache (WAL, debounced save,
                     integrity check on load); IPC handlers for cache + screenshots
preload.js           contextBridge — file I/O, cache IPC, screenshot
presets.yaml         Hardware and modem presets (extend freely, no code changes needed)
```

### Adding a new feature

1. Create `src/myFeature.js` — import from `map.js`, `ui.js`, `propagation.js` as needed.
2. Export `init()` that registers its event listeners.
3. Add one line to `app.js`: `import { init as initMyFeature } from './src/myFeature.js'; initMyFeature();`
4. Add HTML panels to the correct tab in `index.html` and styles to `style.css`.

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
| Terrain blockage | Fresnel-Kirchhoff ν; single dominant knife-edge (ITU-R P.526-15 approximation) |
| Earth curvature | Effective Earth radius Re = 6371 × 4/3 km (standard atmospheric refraction); applied as `d1·d2 / (2·Re)` bulge at each terrain sample |
| Foliage loss | Configurable dB/m × traversal depth through OSM vegetation polygons (default 0.3 dB/m; scrub/orchard use 0.5× multiplier); ray vs canopy-top height check |
| Coverage threshold | `Receiver Sensitivity + System Fade Margin` |
| Elevation data | SRTM 30 m via [open-elevation.com](https://open-elevation.com); [opentopodata.org](https://api.opentopodata.org) as fallback; adaptive grid ~150 m/cell; SQLite bbox cache (WAL) |

**Path loss model notes:**
- FSPL (free-space, n = 2) is accurate for clear LoS paths typical of hilltop relay nodes.
- Real-world excess loss of 2–6 dB above FSPL is common even for clear LoS links. Use the fade margin to account for this.
- Earth curvature correction is important for paths > 10 km (peak bulge ~14 m at 15 km).
- For NLOS/urban paths the diffraction loss term dominates; FSPL is not the limiting factor.
