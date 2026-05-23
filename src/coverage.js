/**
 * coverage.js — Coverage analysis and heatmap rendering.
 * Exports: init
 */
import { map, state, clearCoverageLayers, clearFoliageLayers } from './map.js';
import { setProgress, hideProgress, setStatus, yieldToUI } from './ui.js';
import { fetchElevations } from './elevation.js';
import { checkLoS, writePixel, bilinearElev } from './propagation.js';
import { fetchFoliage, foliageLossDb } from './foliage.js';

const PROFILE_SAMPLES = 32; // terrain samples per path for LoS check
let _isRunning = false;

async function runCoverageAnalysis() {
  if (_isRunning) return;
  if (state.repeaters.length === 0) {
    setStatus('Add at least one repeater first.');
    return;
  }
  _isRunning = true;

  const rxHeight   = parseFloat(document.getElementById('rx-height').value) || 1.5;
  const rxSens     = parseFloat(document.getElementById('rx-sensitivity').value) || -137;
  const fadeMargin = parseFloat(document.getElementById('fade-margin').value) || 0;
  const effectiveSens = rxSens + fadeMargin;
  const radiusKm   = parseFloat(document.getElementById('analysis-radius').value) || 15;
  const gridRes    = parseInt(document.getElementById('grid-res').value) || 128;
  const useLos         = document.getElementById('use-los').checked;
  const useFresnel     = document.getElementById('use-fresnel').checked;
  const useFoliage     = document.getElementById('use-foliage').checked;
  const foliageLossPerM = parseFloat(document.getElementById('foliage-loss-per-m').value) || 0.3;

  clearCoverageLayers();
  clearFoliageLayers();
  setProgress(2, 'Initialising grid…');

  try {
    for (let ri = 0; ri < state.repeaters.length; ri++) {
      const rep = state.repeaters[ri];
      setProgress(5, `Fetching TX elevation for ${rep.name}…`);

      const [txElev] = await fetchElevations([{ latitude: rep.lat, longitude: rep.lon }]);
      if (typeof txElev !== 'number' || isNaN(txElev)) throw new Error(`Could not fetch elevation for ${rep.name}.`);

      const degPerKmLat = 1 / 110.574;
      const degPerKmLon = 1 / (111.320 * Math.cos(rep.lat * Math.PI / 180));
      const latMin = rep.lat - radiusKm * degPerKmLat;
      const latMax = rep.lat + radiusKm * degPerKmLat;
      const lonMin = rep.lon - radiusKm * degPerKmLon;
      const lonMax = rep.lon + radiusKm * degPerKmLon;

      // P10: elevation grid capped at 128×128 — SRTM native resolution is ~90 m,
      // so fetching more points only yields interpolated data not real accuracy gains
      const ELEV_RES = Math.min(gridRes, 128);
      const elevGridPoints = [];
      for (let r = 0; r < ELEV_RES; r++) {
        for (let c = 0; c < ELEV_RES; c++) {
          elevGridPoints.push({
            latitude:  latMax - r * (latMax - latMin) / (ELEV_RES - 1),
            longitude: lonMin + c * (lonMax - lonMin) / (ELEV_RES - 1),
          });
        }
      }

      setProgress(10, `Fetching ${elevGridPoints.length.toLocaleString()} elevation points…`);
      const gridElevs = useLos ? await fetchElevations(elevGridPoints) : new Float32Array(ELEV_RES * ELEV_RES);

      // P9: flat typed arrays for the signal grid — better cache locality than object array
      const gridLats = new Float64Array(gridRes * gridRes);
      const gridLons = new Float64Array(gridRes * gridRes);
      for (let r = 0; r < gridRes; r++) {
        for (let c = 0; c < gridRes; c++) {
          const i = r * gridRes + c;
          gridLats[i] = latMax - r * (latMax - latMin) / (gridRes - 1);
          gridLons[i] = lonMin + c * (lonMax - lonMin) / (gridRes - 1);
        }
      }

      let foliageData = null;
      if (useFoliage) {
        try {
          setProgress(55, `Fetching forest polygons for ${rep.name}…`);
          foliageData = await fetchFoliage(latMin, latMax, lonMin, lonMax);
          for (const poly of foliageData.polygons) {
            const layer = L.polygon(poly, {
              color: '#22c55e', weight: 1.5, opacity: 0.7,
              fill: false, interactive: false,
            }).addTo(map);
            state.foliageLayers.push(layer);
          }
        } catch (e) {
          console.warn('Foliage fetch failed, skipping:', e);
        }
      }

      setProgress(60, `Computing signal levels for ${rep.name}…`);
      const signalGrid = new Float32Array(gridRes * gridRes);
      const totalPts   = gridRes * gridRes;

      // P3: pre-compute flat-Earth scale once per repeater (< 0.3% error within 50 km)
      const mPerLat = 110574;
      const mPerLon = 111320 * Math.cos(rep.lat * Math.PI / 180);

      // P4: hoist frequency-constant part of FSPL outside the loop
      const fsplBase = 20 * Math.log10(rep.freq * 1e6) - 147.55;

      // P1: pre-allocate profile buffer — reused for every grid point
      const profile = new Float32Array(PROFILE_SAMPLES);

      for (let idx = 0; idx < totalPts; idx++) {
        const ptLat = gridLats[idx];
        const ptLon = gridLons[idx];

        // P3: flat-Earth distance replaces haversine in the inner loop
        const dLat = (ptLat - rep.lat) * mPerLat;
        const dLon = (ptLon - rep.lon) * mPerLon;
        const dist = Math.sqrt(dLat * dLat + dLon * dLon);

        if (dist > radiusKm * 1000) { signalGrid[idx] = -200; continue; }

        // P4: inline FSPL with hoisted constant
        let rxPower = rep.power + (rep.gain ?? 0) - (20 * Math.log10(Math.max(1, dist)) + fsplBase);

        if (useLos && dist > 50) {
          const profileLatLons = useFoliage ? [] : null;
          // P1: fill pre-allocated profile in-place; P10: use ELEV_RES for bilinear lookup
          for (let s = 0; s < PROFILE_SAMPLES; s++) {
            const t = s / (PROFILE_SAMPLES - 1);
            const sLat = rep.lat + (ptLat - rep.lat) * t;
            const sLon = rep.lon + (ptLon - rep.lon) * t;
            profile[s] = bilinearElev(sLat, sLon, gridElevs, ELEV_RES, latMin, latMax, lonMin, lonMax);
            if (profileLatLons) profileLatLons.push([sLat, sLon]);
          }
          // P10: use bilinearElev instead of direct index for rx elevation
          const rxElev = bilinearElev(ptLat, ptLon, gridElevs, ELEV_RES, latMin, latMax, lonMin, lonMax);
          const los = checkLoS(txElev, rxElev, profile, rep.height, rxHeight, dist, rep.freq, useFresnel);
          rxPower -= los.diffractionLossDb;
          if (!los.los && los.diffractionLossDb > 60) rxPower = Math.min(rxPower, effectiveSens - 10);
          if (useFoliage && foliageData) {
            rxPower -= foliageLossDb(profileLatLons, foliageData.polygons, foliageData.bboxes, foliageData.factors, foliageData.tileIndex, dist, foliageLossPerM);
          }
        } else if (useFoliage && foliageData && dist > 50) {
          const profileLatLons = [];
          for (let s = 0; s < PROFILE_SAMPLES; s++) {
            const t = s / (PROFILE_SAMPLES - 1);
            profileLatLons.push([
              rep.lat + (ptLat - rep.lat) * t,
              rep.lon + (ptLon - rep.lon) * t,
            ]);
          }
          rxPower -= foliageLossDb(profileLatLons, foliageData.polygons, foliageData.bboxes, foliageData.factors, foliageData.tileIndex, dist, foliageLossPerM);
        }

        signalGrid[idx] = rxPower;

        if (idx % 4096 === 0) {
          const pct = 60 + 35 * ((ri + idx / totalPts) / state.repeaters.length);
          setProgress(pct, `${rep.name}: computing… ${Math.round(idx / totalPts * 100)}%`);
          await yieldToUI();
        }
      }

      // Render signal grid to canvas image overlay
      const canvas = document.createElement('canvas');
      canvas.width = gridRes; canvas.height = gridRes;
      const ctx = canvas.getContext('2d');
      const imageData = ctx.createImageData(gridRes, gridRes);
      // P6: writePixel writes directly into buffer — no per-pixel array allocation
      for (let idx = 0; idx < totalPts; idx++) {
        writePixel(imageData.data, idx * 4, signalGrid[idx], effectiveSens);
      }
      ctx.putImageData(imageData, 0, 0);

      const opacitySlider = document.getElementById('coverage-opacity');
      const opacity = opacitySlider ? parseFloat(opacitySlider.value) / 100 : 0.65;
      const overlay = L.imageOverlay(
        canvas.toDataURL(),
        [[latMin, lonMin], [latMax, lonMax]],
        { opacity, interactive: false }
      ).addTo(map);
      state.coverageLayers.push(overlay);
    }

    setProgress(100, 'Done!');
    await yieldToUI();
    hideProgress();
    setStatus(`Coverage computed for ${state.repeaters.length} repeater(s). Elevation data via open-elevation.com`);
  } catch (err) {
    hideProgress();
    setStatus(`Error: ${err.message}`);
    console.error(err);
  } finally {
    _isRunning = false;
  }
}

export function init() {
  document.getElementById('btn-compute').addEventListener('click', runCoverageAnalysis);

  document.getElementById('coverage-opacity').addEventListener('input', e => {
    const opacity = parseFloat(e.target.value) / 100;
    state.coverageLayers.forEach(l => l.setOpacity(opacity));
  });

  // U2: show/hide the Forest Loss row based on whether foliage is enabled
  const foliageToggle = document.getElementById('use-foliage');
  const foliageRow    = document.getElementById('foliage-loss-per-m').closest('label');
  const toggleFoliageRow = () => { foliageRow.style.display = foliageToggle.checked ? '' : 'none'; };
  foliageToggle.addEventListener('change', (e) => {
    if (!e.target.checked) clearFoliageLayers();
    toggleFoliageRow();
  });
  toggleFoliageRow();

  // U3: clear coverage without removing repeaters
  document.getElementById('btn-clear-coverage').addEventListener('click', () => {
    clearCoverageLayers();
    clearFoliageLayers();
    setStatus('Coverage cleared.');
  });
}
