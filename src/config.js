/**
 * config.js - Save/load project configuration to JSON, persist settings in localStorage.
 * Exports: init
 */
import { map, state } from './map.js';
import { addRepeater, removeRepeater } from './repeaters.js';
import { PERSISTED_SETTING_IDS } from './settings.js';
import {
  bindPersistedSettingChanges,
  readPersistedSettingValue,
  writePersistedSettingValue,
} from './settingsPersistence.js';
import { fetchElevationsFromTiles } from './elevation.js';
import { fetchFoliage } from './foliage.js';
import { fetchBuildings } from './buildings.js';
import { confirmAction, hideProgress, setButtonBusy, setCancelHandler, setProgress, setStatus, yieldToUI } from './ui.js';

const SETTINGS_IDS = PERSISTED_SETTING_IDS;
const STORAGE_KEY = 'meshcoreMapper_settings';
const LEGACY_KEY = 'loraMapper_settings';
let _cacheWarmAbort = null;

function gatherSettings() {
  const s = {};
  for (const id of SETTINGS_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    s[id] = readPersistedSettingValue(el);
  }
  return s;
}

function applySettings(s, { notify = false } = {}) {
  for (const id of SETTINGS_IDS) {
    if (!(id in s)) continue;
    const el = document.getElementById(id);
    writePersistedSettingValue(el, s[id], { notify });
  }
}

function persistSettings() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(gatherSettings())); } catch {}
}

function restoreSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (raw) applySettings(JSON.parse(raw));
  } catch {}
}

async function saveConfig() {
  setButtonBusy('btn-save-config', true, 'Saving...');
  const config = {
    version: 1,
    settings: gatherSettings(),
    repeaters: state.repeaters.map(({ name, lat, lon, height, power, freq, gain }) =>
      ({ name, lat, lon, height, power, freq, gain })),
  };
  try {
    await window.electronAPI.saveFile(JSON.stringify(config, null, 2));
    setStatus('Configuration saved.');
  } catch (e) {
    setStatus(`Save failed: ${e.message}`);
  } finally {
    setButtonBusy('btn-save-config', false);
  }
}

async function loadConfig() {
  setButtonBusy('btn-load-config', true, 'Loading...');
  let json;
  try {
    json = await window.electronAPI.openFile();
  } catch (e) {
    setStatus(`Load failed: ${e.message}`);
    setButtonBusy('btn-load-config', false);
    return;
  }

  try {
    if (json === null) return;

    let config;
    try { config = JSON.parse(json); } catch {
      setStatus('Load failed: invalid JSON.');
      return;
    }

    if (config.settings) applySettings(config.settings, { notify: true });
    if (Array.isArray(config.repeaters)) {
      [...state.repeaters].forEach(r => removeRepeater(r.id));
      for (const r of config.repeaters) {
        const lat = parseFloat(r.lat), lon = parseFloat(r.lon);
        const height = parseFloat(r.height), power = parseFloat(r.power), freq = parseFloat(r.freq);
        const gain = isFinite(parseFloat(r.gain)) ? parseFloat(r.gain) : 2;
        if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
        if (!isFinite(height) || !isFinite(power) || !isFinite(freq)) continue;
        addRepeater(r.name || 'Unnamed', lat, lon, height, power, freq, gain);
      }
    }
    setStatus(`Loaded ${config.repeaters?.length ?? 0} repeater(s).`);
  } finally {
    setButtonBusy('btn-load-config', false);
  }
}

async function refreshCacheStats() {
  try {
    const s = await window.electronAPI.cacheGetStats();
    document.getElementById('cache-stats').textContent =
      `Cache: ${s.elevations.toLocaleString()} elevations, ${s.demTiles ?? 0} DEM tiles, ${s.foliage} foliage, ${s.buildings ?? 0} buildings, ${s.sizeKb} KB`;
  } catch {
    document.getElementById('cache-stats').textContent = 'Cache: unavailable';
  }
}

async function warmViewportCache() {
  if (_cacheWarmAbort) return;
  _cacheWarmAbort = new AbortController();
  setCancelHandler(cancelCacheWarm);
  setButtonBusy('btn-warm-cache', true, 'Warming...');
  document.getElementById('btn-cancel-cache-warm').disabled = false;

  try {
    const bounds = map.getBounds();
    const latMin = bounds.getSouth(), latMax = bounds.getNorth();
    const lonMin = bounds.getWest(), lonMax = bounds.getEast();
    const points = _viewportGridPoints(latMin, latMax, lonMin, lonMax, 64);
    setProgress(5, 'Warming terrain cache...');
    await fetchElevationsFromTiles(points, null, {
      signal: _cacheWarmAbort.signal,
      demTileConcurrency: 6,
      onProgress: ({ completed, total }) => {
        const pct = total ? 5 + 65 * completed / total : 70;
        setProgress(pct, `Warming terrain tiles ${completed}/${total}`);
      },
    });

    setProgress(75, 'Warming obstacle cache...');
    const deriveObstacleHeights = document.getElementById('obstacle-height-mode')?.value === 'dsm-dem';
    await Promise.all([
      fetchFoliage(latMin, latMax, lonMin, lonMax, {
        signal: _cacheWarmAbort.signal,
        deriveObstacleHeights,
      }).catch(e => {
        if (e?.cancelled || e?.name === 'AbortError') throw e;
        console.warn('[cache] foliage warm failed:', e.message);
      }),
      fetchBuildings(latMin, latMax, lonMin, lonMax, {
        signal: _cacheWarmAbort.signal,
        deriveObstacleHeights,
      }).catch(e => {
        if (e?.cancelled || e?.name === 'AbortError') throw e;
        console.warn('[cache] buildings warm failed:', e.message);
      }),
    ]);

    setProgress(100, 'Cache warmed.');
    await yieldToUI();
    setStatus('Viewport cache warmed.');
    await refreshCacheStats();
  } catch (e) {
    if (e?.cancelled || e?.name === 'AbortError') setStatus('Cache warm cancelled.');
    else setStatus(`Cache warm failed: ${e.message}`);
  } finally {
    hideProgress();
    _cacheWarmAbort = null;
    setCancelHandler(null);
    setButtonBusy('btn-warm-cache', false);
    document.getElementById('btn-cancel-cache-warm').disabled = true;
  }
}

function cancelCacheWarm() {
  _cacheWarmAbort?.abort();
}

function _viewportGridPoints(latMin, latMax, lonMin, lonMax, res) {
  const points = [];
  for (let r = 0; r < res; r++) {
    const rf = res > 1 ? r / (res - 1) : 0;
    for (let c = 0; c < res; c++) {
      const cf = res > 1 ? c / (res - 1) : 0;
      points.push({
        latitude: latMax - rf * (latMax - latMin),
        longitude: lonMin + cf * (lonMax - lonMin),
      });
    }
  }
  return points;
}

async function runConfirmedAction(btnId, message, action, doneMsg) {
  if (!confirmAction(message)) return;
  setButtonBusy(btnId, true, 'Clearing...');
  try {
    await action();
    await refreshCacheStats();
    setStatus(doneMsg);
  } catch (e) {
    setStatus(`Action failed: ${e.message}`);
  } finally {
    setButtonBusy(btnId, false);
  }
}

export function init() {
  restoreSettings();
  document.getElementById('btn-save-config').addEventListener('click', saveConfig);
  document.getElementById('btn-load-config').addEventListener('click', loadConfig);
  bindPersistedSettingChanges(SETTINGS_IDS, persistSettings);

  document.getElementById('btn-save-screenshot').addEventListener('click', async () => {
    setButtonBusy('btn-save-screenshot', true, 'Saving...');
    try {
      await window.electronAPI.saveScreenshot();
      setStatus('Screenshot saved.');
    } catch (e) {
      setStatus(`Screenshot failed: ${e.message}`);
    } finally {
      setButtonBusy('btn-save-screenshot', false);
    }
  });

  document.getElementById('btn-purge-elevations').addEventListener('click', () => runConfirmedAction(
    'btn-purge-elevations',
    'Clear cached elevation samples?',
    () => window.electronAPI.cachePurgeElevations(),
    'Elevation cache cleared.'
  ));

  document.getElementById('btn-purge-dem-tiles').addEventListener('click', () => runConfirmedAction(
    'btn-purge-dem-tiles',
    'Clear cached DEM raster tiles?',
    () => window.electronAPI.cachePurgeDemTiles(),
    'DEM tile cache cleared.'
  ));

  document.getElementById('btn-purge-foliage').addEventListener('click', () => runConfirmedAction(
    'btn-purge-foliage',
    'Clear cached foliage polygons?',
    () => window.electronAPI.cachePurgeFoliage(),
    'Foliage cache cleared.'
  ));

  document.getElementById('btn-purge-buildings').addEventListener('click', () => runConfirmedAction(
    'btn-purge-buildings',
    'Clear cached building footprints?',
    () => window.electronAPI.cachePurgeBuildings(),
    'Buildings cache cleared.'
  ));

  document.getElementById('btn-purge-ws-nodes').addEventListener('click', () => runConfirmedAction(
    'btn-purge-ws-nodes',
    'Clear stored WebSocket nodes from the local database?',
    () => window.electronAPI.wsRepeatersClear(),
    'WS nodes DB cleared.'
  ));

  document.getElementById('btn-purge-all').addEventListener('click', () => runConfirmedAction(
    'btn-purge-all',
    'Clear the entire local database, including elevations, foliage, buildings, and stored WebSocket nodes?',
    async () => {
      await window.electronAPI.cachePurgeElevations();
      await window.electronAPI.cachePurgeDemTiles();
      await window.electronAPI.cachePurgeFoliage();
      await window.electronAPI.cachePurgeBuildings();
      await window.electronAPI.wsRepeatersClear();
      await window.electronAPI.cacheVacuum();
    },
    'Entire database cleared and vacuumed.'
  ));

  refreshCacheStats();
  document.getElementById('btn-warm-cache').addEventListener('click', warmViewportCache);
  document.getElementById('btn-cancel-cache-warm').addEventListener('click', cancelCacheWarm);
}
