/**
 * config.js — Save/load project configuration to JSON, persist settings in localStorage.
 * Exports: init
 */
import { state } from './map.js';
import { addRepeater, removeRepeater } from './repeaters.js';
import { setStatus } from './ui.js';

const SETTINGS_IDS = [
  'rx-height', 'rx-sensitivity', 'fade-margin', 'analysis-radius', 'grid-res',
  'use-los', 'use-fresnel', 'use-foliage', 'foliage-loss-per-m', 'use-buildings', 'building-loss-per-m',
  'layer-foliage', 'layer-buildings', 'layer-auto-refresh',
];
const STORAGE_KEY = 'meshcoreMapper_settings';
const LEGACY_KEY  = 'loraMapper_settings'; // A2: migrate old key on first read

function gatherSettings() {
  const s = {};
  for (const id of SETTINGS_IDS) {
    const el = document.getElementById(id);
    s[id] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return s;
}

function applySettings(s) {
  for (const id of SETTINGS_IDS) {
    if (!(id in s)) continue;
    const el = document.getElementById(id);
    if (el.type === 'checkbox') el.checked = Boolean(s[id]);
    else el.value = s[id];
  }
}

function persistSettings() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(gatherSettings())); } catch {}
}

function restoreSettings() {
  try {
    // A2: try new key first, fall back to legacy key for existing users
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (raw) applySettings(JSON.parse(raw));
  } catch {}
}

async function saveConfig() {
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
  }
}

async function loadConfig() {
  let json;
  try {
    json = await window.electronAPI.openFile();
  } catch (e) {
    setStatus(`Load failed: ${e.message}`);
    return;
  }
  if (json === null) return; // user cancelled

  let config;
  try { config = JSON.parse(json); } catch {
    setStatus('Load failed: invalid JSON.');
    return;
  }

  if (config.settings) applySettings(config.settings);
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
}

export function init() {
  restoreSettings();
  document.getElementById('btn-save-config').addEventListener('click', saveConfig);
  document.getElementById('btn-load-config').addEventListener('click', loadConfig);
  for (const id of SETTINGS_IDS) {
    document.getElementById(id).addEventListener('change', persistSettings);
  }

  // F1: screenshot
  document.getElementById('btn-save-screenshot').addEventListener('click', async () => {
    try { await window.electronAPI.saveScreenshot(); }
    catch (e) { setStatus(`Screenshot failed: ${e.message}`); }
  });

  // F4: cache management
  async function refreshCacheStats() {
    try {
      const s = await window.electronAPI.cacheGetStats();
      document.getElementById('cache-stats').textContent =
        `Cache: ${s.elevations.toLocaleString()} elevations · ${s.foliage} foliage · ${s.buildings ?? 0} buildings · ${s.sizeKb} KB`;
    } catch {}
  }
  document.getElementById('btn-purge-elevations').addEventListener('click', async () => {
    await window.electronAPI.cachePurgeElevations();
    await refreshCacheStats();
    setStatus('Elevation cache cleared.');
  });
  document.getElementById('btn-purge-foliage').addEventListener('click', async () => {
    await window.electronAPI.cachePurgeFoliage();
    await refreshCacheStats();
    setStatus('Foliage cache cleared.');
  });
  document.getElementById('btn-purge-buildings').addEventListener('click', async () => {
    await window.electronAPI.cachePurgeBuildings();
    await refreshCacheStats();
    setStatus('Buildings cache cleared.');
  });
  document.getElementById('btn-purge-ws-nodes').addEventListener('click', async () => {
    await window.electronAPI.wsRepeatersClear();
    await refreshCacheStats();
    setStatus('WS nodes DB cleared.');
  });
  document.getElementById('btn-purge-all').addEventListener('click', async () => {
    await Promise.all([
      window.electronAPI.cachePurgeElevations(),
      window.electronAPI.cachePurgeFoliage(),
      window.electronAPI.cachePurgeBuildings(),
      window.electronAPI.wsRepeatersClear(),
      window.electronAPI.cacheVacuum(),
    ]);
    await refreshCacheStats();
    setStatus('Entire database cleared and vacuumed.');
  });
  refreshCacheStats();
}
