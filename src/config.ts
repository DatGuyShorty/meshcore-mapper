/**
 * config.ts - Save/load project configuration to JSON, persist settings in localStorage.
 * Exports: init
 */
import { map, state, clearCoverageLayers } from './map.js';
import { addRepeater, removeRepeater, refreshRepeaterList } from './repeaters.js';
import { parseSavedConfigJson, type SettingsRecord } from './configSchema.js';
import { PERSISTED_SETTING_IDS } from './settings.js';
import { createSettingsStore } from './settingsStore.js';
import { bindPersistedSettingChanges } from './settingsPersistence.js';
import { fetchElevationsFromTiles } from './elevation.js';
import { fetchFoliage } from './foliage.js';
import { fetchBuildings } from './buildings.js';
import { coverageNetworkStatsForExport, summarizeCombinedCoverage } from './coverageNetwork.js';
import { confirmAction, hideProgress, setButtonBusy, setCancelHandler, setProgress, setStatus, yieldToUI } from './ui.js';
import { CACHE_UNAVAILABLE_TEXT, formatCacheStats } from './cacheStatsView.js';
import { buildPlanningReportHtml, type PlanningReportInput } from './planningReport.js';
import { buildCoverageKml, buildCoveragePolygonGeoJson, buildKmz, type GisExportScope } from './gisExport.js';

type AbortLikeError = Error & { cancelled?: boolean };
type RepeaterSnapshot = {
  id: number;
  name: string;
  lat: number;
  lon: number;
  height: number;
  power: number;
  freq: number;
  gain: number;
};
type CoverageBounds = {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
};
type CoverageExportResult = {
  visible?: boolean;
  signalGrid?: ArrayLike<number> | null;
  gridRes?: number;
  bounds?: CoverageBounds | null;
  effectiveSens?: number;
  rep?: { name?: string } | null;
};
type GeoJsonFeature = {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: { node: string; rssi_dbm: number; margin_db: number };
};
type CoverageFeatureCollection = {
  type: 'FeatureCollection';
  properties: {
    layerScope: 'visible';
    networkStats: Record<string, unknown>;
  };
  features: GeoJsonFeature[];
};
type CoverageGeoJsonResult = {
  fc: CoverageFeatureCollection;
  downsampled: boolean;
};
type ScreenshotCaptureResult = {
  dataUrl: string | null;
  error: string | null;
};
type PlanningReportFormat = 'html' | 'pdf';
type GisExportFormat = 'geojson' | 'kml' | 'kmz';
type ProgressMeta = {
  title: string;
};
type ViewportPoint = {
  latitude: number;
  longitude: number;
};
type CacheWarmProgress = {
  completed: number;
  total: number;
};
type ConfirmedAction = () => Promise<void>;

const SETTINGS_IDS = PERSISTED_SETTING_IDS;
const STORAGE_KEY = 'meshcoreMapper_settings';
const LEGACY_KEY = 'loraMapper_settings';
const settingsStore = createSettingsStore({
  ids: SETTINGS_IDS,
  storageKey: STORAGE_KEY,
  legacyKey: LEGACY_KEY,
});
let _cacheWarmAbort: AbortController | null = null;

export function gatherSettings(): SettingsRecord {
  return settingsStore.gather();
}

export function applySettings(s: SettingsRecord, { notify = false }: { notify?: boolean } = {}): void {
  settingsStore.apply(s, { notify });
}

export function persistSettings(): void {
  settingsStore.persist();
}

export function restoreSettings(): void {
  settingsStore.restore();
}

async function saveConfig(): Promise<void> {
  setButtonBusy('btn-save-config', true, 'Saving...');
  const config = {
    version: 1,
    settings: gatherSettings(),
    repeaters: (state.repeaters as RepeaterSnapshot[]).map(({ name, lat, lon, height, power, freq, gain }) =>
      ({ name, lat, lon, height, power, freq, gain })),
  };
  try {
    await window.electronAPI.saveFile(JSON.stringify(config, null, 2));
    setStatus('Configuration saved.');
  } catch (rawErr) {
    const e = rawErr as Error;
    setStatus(`Save failed: ${e.message}`);
  } finally {
    setButtonBusy('btn-save-config', false);
  }
}

async function loadConfig(): Promise<void> {
  setButtonBusy('btn-load-config', true, 'Loading...');
  let json: string | null | undefined;
  try {
    json = await window.electronAPI.openFile();
  } catch (rawErr) {
    const e = rawErr as Error;
    setStatus(`Load failed: ${e.message}`);
    setButtonBusy('btn-load-config', false);
    return;
  }

  try {
    if (json === null || json === undefined) return;

    const parsedConfig = parseSavedConfigJson(json);
    if (!parsedConfig.ok) {
      if (parsedConfig.reason === 'invalid-json') {
        setStatus('Load failed: invalid JSON.');
      } else if (parsedConfig.reason === 'invalid-config') {
        setStatus('Load failed: invalid configuration.');
      } else {
        setStatus('Load failed: no valid repeaters found; existing nodes left unchanged.');
      }
      return;
    }

    const config = parsedConfig.config;
    if (config.settings) applySettings(config.settings, { notify: true });
    const parsedRepeaters = config.repeaters;
    if (parsedRepeaters) {
      [...state.repeaters as RepeaterSnapshot[]].forEach(r => removeRepeater(r.id, {
        rememberUndo: false,
        render: false,
        clearCoverage: false,
        notify: false,
      }));
      for (const r of parsedRepeaters) {
        addRepeater(r.name, r.lat, r.lon, r.height, r.power, r.freq, r.gain, {
          render: false,
          notify: false,
        });
      }
      clearCoverageLayers();
      refreshRepeaterList({ clearUndo: true });
    }
    const skipped = config.inputRepeaterCount !== null ? config.inputRepeaterCount - (parsedRepeaters?.length ?? 0) : 0;
    setStatus(`Loaded ${parsedRepeaters?.length ?? 0} repeater(s)${skipped > 0 ? `; skipped ${skipped} invalid.` : '.'}`);
  } finally {
    setButtonBusy('btn-load-config', false);
  }
}

// Cap on emitted points per coverage layer per side, so a deliberate export of a
// large grid stays a sane file size. Layers denser than this are thinned by stride.
const EXPORT_MAX_SIDE = 400;

/**
 * Build a GeoJSON FeatureCollection of covered grid cells (received power at or
 * above the layer threshold) across visible coverage layers. Each covered cell
 * becomes a Point with rssi_dbm and margin_db. Returns { fc, downsampled }.
 */
export function buildCoverageGeoJson(): CoverageGeoJsonResult {
  const features: GeoJsonFeature[] = [];
  let downsampled = false;
  const visibleResults = ((state.coverageResults ?? []) as CoverageExportResult[]).filter(result => result?.visible !== false);
  const networkStats = coverageNetworkStatsForExport(summarizeCombinedCoverage(visibleResults));
  for (const result of visibleResults) {
    const { signalGrid, gridRes, bounds, effectiveSens, rep } = result;
    if (!signalGrid || !gridRes || !bounds || effectiveSens === undefined) continue;
    const { latMin, latMax, lonMin, lonMax } = bounds;
    const stride = Math.max(1, Math.ceil(gridRes / EXPORT_MAX_SIDE));
    if (stride > 1) downsampled = true;
    for (let r = 0; r < gridRes; r += stride) {
      const rf = gridRes > 1 ? r / (gridRes - 1) : 0;
      const lat = latMax - rf * (latMax - latMin);
      for (let c = 0; c < gridRes; c += stride) {
        const v = signalGrid[r * gridRes + c];
        if (!Number.isFinite(v) || v < effectiveSens) continue;
        const cf = gridRes > 1 ? c / (gridRes - 1) : 0;
        const lon = lonMin + cf * (lonMax - lonMin);
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [Number(lon.toFixed(6)), Number(lat.toFixed(6))] },
          properties: {
            node: rep?.name ?? '',
            rssi_dbm: Number(v.toFixed(1)),
            margin_db: Number((v - effectiveSens).toFixed(1)),
          },
        });
      }
    }
  }
  return {
    fc: {
      type: 'FeatureCollection',
      properties: {
        layerScope: 'visible',
        networkStats,
      },
      features,
    },
    downsampled,
  };
}

async function exportCoverageGeoJson(): Promise<void> {
  if (!state.coverageResults?.length) {
    setStatus('No coverage layers to export. Compute coverage first.');
    return;
  }
  setButtonBusy('btn-export-coverage', true, 'Exporting...');
  try {
    const { fc, downsampled } = buildCoverageGeoJson();
    if (!fc.features.length) {
      setStatus('No covered cells above threshold to export.');
      return;
    }
    const ok = await window.electronAPI.exportFile({
      content: JSON.stringify(fc),
      defaultName: 'coverage.geojson',
      filterName: 'GeoJSON',
      extensions: ['geojson', 'json'],
    });
    if (!ok) {
      setStatus('Coverage export cancelled.');
      return;
    }
    setStatus(`Exported ${fc.features.length.toLocaleString()} covered cells to GeoJSON${downsampled ? ' (downsampled for size)' : ''}.`);
  } catch (rawErr) {
    const e = rawErr as Error;
    setStatus(`Coverage export failed: ${e.message}`);
  } finally {
    setButtonBusy('btn-export-coverage', false);
  }
}

function buildCoverageGisGeoJson(scope: GisExportScope) {
  const visibleResults = ((state.coverageResults ?? []) as CoverageExportResult[]).filter(result => result?.visible !== false);
  return buildCoveragePolygonGeoJson(visibleResults, {
    scope,
    generatedAt: new Date().toISOString(),
    networkStats: coverageNetworkStatsForExport(summarizeCombinedCoverage(visibleResults)),
  });
}

async function exportCoverageGis(format: GisExportFormat, scope: GisExportScope): Promise<void> {
  if (!state.coverageResults?.length) {
    setStatus('No coverage layers to export. Compute coverage first.');
    return;
  }

  const btnId = `btn-export-gis-${format}-${scope}`;
  setButtonBusy(btnId, true, 'Exporting...');
  try {
    const { fc, downsampled } = buildCoverageGisGeoJson(scope);
    if (!fc.features.length) {
      setStatus('No covered polygons above threshold to export.');
      return;
    }

    const scopeName = scope === 'combined' ? 'combined' : 'per-node';
    let ok = false;
    if (format === 'geojson') {
      ok = await window.electronAPI.exportFile({
        content: JSON.stringify(fc),
        defaultName: `coverage-${scopeName}-polygons.geojson`,
        filterName: 'GeoJSON',
        extensions: ['geojson', 'json'],
      });
    } else {
      const kml = buildCoverageKml(fc, `MeshCore Coverage ${scopeName}`);
      if (format === 'kml') {
        ok = await window.electronAPI.exportFile({
          content: kml,
          defaultName: `coverage-${scopeName}.kml`,
          filterName: 'KML',
          extensions: ['kml'],
        });
      } else {
        ok = await window.electronAPI.exportBinaryFile({
          data: buildKmz(kml),
          defaultName: `coverage-${scopeName}.kmz`,
          filterName: 'KMZ',
          extensions: ['kmz'],
        });
      }
    }

    if (!ok) {
      setStatus('GIS export cancelled.');
      return;
    }
    setStatus(`Exported ${fc.features.length.toLocaleString()} ${scopeName} coverage polygon(s) to ${format.toUpperCase()}${downsampled ? ' (downsampled for size)' : ''}.`);
  } catch (rawErr) {
    const e = rawErr as Error;
    setStatus(`GIS export failed: ${e.message}`);
  } finally {
    setButtonBusy(btnId, false);
  }
}

export function buildPlanningReportSnapshot(
  screenshotDataUrl: string | null = null,
  generatedAt = new Date().toISOString(),
  screenshotError: string | null = null
): PlanningReportInput {
  const coverageResults = Array.isArray(state.coverageResults) ? state.coverageResults : [];
  return {
    generatedAt,
    screenshotDataUrl,
    screenshotError,
    settings: gatherSettings(),
    repeaters: Array.isArray(state.repeaters) ? [...state.repeaters] : [],
    coverageResults,
    p2pLinks: Array.isArray(state.p2pLinks) ? [...state.p2pLinks] : [],
    pathLinks: Array.isArray(state.pathLinks) ? [...state.pathLinks] : [],
    optimizerRecommendations: Array.isArray(state.optimizerResults) ? [...state.optimizerResults] : [],
    networkStats: coverageNetworkStatsForExport(summarizeCombinedCoverage(coverageResults)),
  };
}

async function capturePlanningScreenshot(): Promise<ScreenshotCaptureResult> {
  const capture = window.electronAPI.captureScreenshotDataUrl;
  if (typeof capture !== 'function') {
    return { dataUrl: null, error: 'screenshot capture is unavailable' };
  }
  try {
    return { dataUrl: await capture(), error: null };
  } catch (rawErr) {
    const e = rawErr as Error;
    return { dataUrl: null, error: e.message };
  }
}

async function exportPlanningReport(format: PlanningReportFormat): Promise<void> {
  const btnId = format === 'pdf' ? 'btn-export-report-pdf' : 'btn-export-report-html';
  setButtonBusy(btnId, true, 'Exporting...');
  try {
    const screenshot = await capturePlanningScreenshot();
    const html = buildPlanningReportHtml(buildPlanningReportSnapshot(
      screenshot.dataUrl,
      new Date().toISOString(),
      screenshot.error
    ));
    const ok = format === 'pdf'
      ? await window.electronAPI.exportPdfFile({
          content: html,
          defaultName: 'meshcore-planning-report.pdf',
        })
      : await window.electronAPI.exportFile({
          content: html,
          defaultName: 'meshcore-planning-report.html',
          filterName: 'HTML Report',
          extensions: ['html'],
        });
    if (!ok) {
      setStatus('Planning report export cancelled.');
      return;
    }
    setStatus(screenshot.error
      ? `Planning report ${format.toUpperCase()} exported without screenshot: ${screenshot.error}`
      : `Planning report ${format.toUpperCase()} exported.`);
  } catch (rawErr) {
    const e = rawErr as Error;
    setStatus(`Planning report export failed: ${e.message}`);
  } finally {
    setButtonBusy(btnId, false);
  }
}

export async function refreshCacheStats(): Promise<void> {
  const el = document.getElementById('cache-stats');
  if (!el) return;
  try {
    const s = await window.electronAPI.cacheGetStats();
    el.textContent = formatCacheStats(s);
  } catch {
    el.textContent = CACHE_UNAVAILABLE_TEXT;
  }
}

async function warmViewportCache(): Promise<void> {
  if (_cacheWarmAbort) return;
  _cacheWarmAbort = new AbortController();
  setCancelHandler(cancelCacheWarm);
  setButtonBusy('btn-warm-cache', true, 'Warming...');
  const cancelBtn = document.getElementById('btn-cancel-cache-warm') as HTMLButtonElement | null;
  if (cancelBtn) cancelBtn.disabled = false;
  const progressMeta: ProgressMeta = { title: 'Viewport Cache Warm' };

  try {
    const bounds = map.getBounds();
    const latMin = bounds.getSouth(), latMax = bounds.getNorth();
    const lonMin = bounds.getWest(), lonMax = bounds.getEast();
    const points = _viewportGridPoints(latMin, latMax, lonMin, lonMax, 64);
    setProgress(5, 'Warming terrain cache...', progressMeta);
    await fetchElevationsFromTiles(points, null, {
      signal: _cacheWarmAbort.signal,
      demTileConcurrency: 6,
      onProgress: ({ completed, total }: CacheWarmProgress) => {
        const pct = total ? 5 + 65 * completed / total : 70;
        setProgress(pct, `Warming terrain tiles ${completed}/${total}`, progressMeta);
      },
    });

    setProgress(75, 'Warming obstacle cache...', progressMeta);
    const deriveObstacleHeights = (document.getElementById('obstacle-height-mode') as HTMLSelectElement | null)?.value === 'dsm-dem';
    await Promise.all([
      fetchFoliage(latMin, latMax, lonMin, lonMax, {
        signal: _cacheWarmAbort.signal,
        deriveObstacleHeights,
      }).catch((e: AbortLikeError) => {
        if (e?.cancelled || e?.name === 'AbortError') throw e;
        console.warn('[cache] foliage warm failed:', e.message);
      }),
      fetchBuildings(latMin, latMax, lonMin, lonMax, {
        signal: _cacheWarmAbort.signal,
        deriveObstacleHeights,
      }).catch((e: AbortLikeError) => {
        if (e?.cancelled || e?.name === 'AbortError') throw e;
        console.warn('[cache] buildings warm failed:', e.message);
      }),
    ]);

    setProgress(100, 'Cache warmed.', progressMeta);
    await yieldToUI();
    setStatus('Viewport cache warmed.');
    await refreshCacheStats();
  } catch (rawErr) {
    const e = rawErr as AbortLikeError;
    if (e?.cancelled || e?.name === 'AbortError') setStatus('Cache warm cancelled.');
    else setStatus(`Cache warm failed: ${e.message}`);
  } finally {
    hideProgress();
    _cacheWarmAbort = null;
    setCancelHandler(null);
    setButtonBusy('btn-warm-cache', false);
    const btn = document.getElementById('btn-cancel-cache-warm') as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
  }
}

function cancelCacheWarm(): void {
  _cacheWarmAbort?.abort();
}

export function _viewportGridPoints(latMin: number, latMax: number, lonMin: number, lonMax: number, res: number): ViewportPoint[] {
  const points: ViewportPoint[] = [];
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

export async function runConfirmedAction(btnId: string, message: string, action: ConfirmedAction, doneMsg: string): Promise<void> {
  if (!confirmAction(message)) return;
  setButtonBusy(btnId, true, 'Clearing...');
  try {
    await action();
    await refreshCacheStats();
    setStatus(doneMsg);
  } catch (rawErr) {
    const e = rawErr as Error;
    setStatus(`Action failed: ${e.message}`);
  } finally {
    setButtonBusy(btnId, false);
  }
}

export function init(): void {
  restoreSettings();
  document.getElementById('btn-save-config')?.addEventListener('click', saveConfig);
  document.getElementById('btn-load-config')?.addEventListener('click', loadConfig);
  bindPersistedSettingChanges(SETTINGS_IDS, persistSettings);

  document.getElementById('btn-save-screenshot')?.addEventListener('click', async () => {
    setButtonBusy('btn-save-screenshot', true, 'Saving...');
    try {
      await window.electronAPI.saveScreenshot();
      setStatus('Screenshot saved.');
    } catch (rawErr) {
      const e = rawErr as Error;
      setStatus(`Screenshot failed: ${e.message}`);
    } finally {
      setButtonBusy('btn-save-screenshot', false);
    }
  });

  document.getElementById('btn-purge-elevations')?.addEventListener('click', () => runConfirmedAction(
    'btn-purge-elevations',
    'Clear cached elevation samples?',
    () => window.electronAPI.cachePurgeElevations(),
    'Elevation cache cleared.'
  ));

  document.getElementById('btn-purge-dem-tiles')?.addEventListener('click', () => runConfirmedAction(
    'btn-purge-dem-tiles',
    'Clear cached DEM raster tiles?',
    () => window.electronAPI.cachePurgeDemTiles(),
    'DEM tile cache cleared.'
  ));

  document.getElementById('btn-purge-foliage')?.addEventListener('click', () => runConfirmedAction(
    'btn-purge-foliage',
    'Clear cached foliage polygons?',
    () => window.electronAPI.cachePurgeFoliage(),
    'Foliage cache cleared.'
  ));

  document.getElementById('btn-purge-buildings')?.addEventListener('click', () => runConfirmedAction(
    'btn-purge-buildings',
    'Clear cached building footprints?',
    () => window.electronAPI.cachePurgeBuildings(),
    'Buildings cache cleared.'
  ));

  document.getElementById('btn-purge-ws-nodes')?.addEventListener('click', () => runConfirmedAction(
    'btn-purge-ws-nodes',
    'Clear stored WebSocket nodes from the local database?',
    () => window.electronAPI.wsRepeatersClear(),
    'WS nodes DB cleared.'
  ));

  document.getElementById('btn-purge-all')?.addEventListener('click', () => runConfirmedAction(
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

  document.getElementById('btn-export-coverage')?.addEventListener('click', exportCoverageGeoJson);
  document.getElementById('btn-export-gis-geojson-combined')?.addEventListener('click', () => exportCoverageGis('geojson', 'combined'));
  document.getElementById('btn-export-gis-geojson-per-node')?.addEventListener('click', () => exportCoverageGis('geojson', 'per-node'));
  document.getElementById('btn-export-gis-kml-combined')?.addEventListener('click', () => exportCoverageGis('kml', 'combined'));
  document.getElementById('btn-export-gis-kmz-combined')?.addEventListener('click', () => exportCoverageGis('kmz', 'combined'));
  document.getElementById('btn-export-report-html')?.addEventListener('click', () => exportPlanningReport('html'));
  document.getElementById('btn-export-report-pdf')?.addEventListener('click', () => exportPlanningReport('pdf'));

  refreshCacheStats();
  document.getElementById('btn-warm-cache')?.addEventListener('click', warmViewportCache);
  document.getElementById('btn-cancel-cache-warm')?.addEventListener('click', cancelCacheWarm);
}
