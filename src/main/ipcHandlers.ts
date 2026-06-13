import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Dialog, IpcMain } from 'electron';
import { registerCudaCoverageHandlers } from './cudaCoverage.js';
import {
  boundedInteger as _boundedInteger,
  finiteNumber as _finiteNumber,
  safeSource as _safeSource,
  safeWsRow as _safeWsRow,
  validBlobPayload as _validBlobPayload,
  validLatLon as _validLatLon,
  type SafeWsRow,
} from './ipcSchemas.js';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml') as { load(raw: string): unknown };

type AnyRecord = Record<string, any>;
type SqlExecResult = { values: any[][] };
type SqlStatement = {
  bind(values: any[]): void;
  step(): boolean;
  getAsObject(): AnyRecord;
  run(values: any[]): void;
  free(): void;
};
type SqlDb = {
  prepare(sql: string): SqlStatement;
  run(sql: string, params?: any[]): void;
  exec(sql: string): SqlExecResult[];
};
type CacheLike = {
  db: SqlDb | null;
  saveDb(): void;
  scheduleSave(): void;
};
type RegisterIpcArgs = {
  ipcMain: IpcMain;
  dialog: Dialog;
  cache: CacheLike;
  presetsPath: string;
};
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerIpcHandlers({ ipcMain, dialog, cache, presetsPath }: RegisterIpcArgs): void {
  ipcMain.handle('save-file', async (_event, jsonStr: string) => {
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Save Configuration',
      defaultPath: 'lora-config.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return;
    fs.writeFileSync(filePath, jsonStr, 'utf8');
  });

  ipcMain.handle('open-file', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'Open Configuration',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    const filePath = filePaths[0];
    if (canceled || !filePath) return null;
    return fs.readFileSync(filePath, 'utf8');
  });

  ipcMain.handle('export-file', async (_event, payload: AnyRecord | null | undefined) => {
    const content = typeof payload?.content === 'string' ? payload.content : '';
    // basename() strips any directory/traversal the renderer might suggest; the
    // real write path comes from the user-chosen dialog result below.
    const defaultName = typeof payload?.defaultName === 'string'
      ? path.basename(payload.defaultName).slice(0, 120)
      : 'export.txt';
    const extensions = Array.isArray(payload?.extensions)
      ? payload.extensions.filter((e: unknown) => typeof e === 'string' && /^[a-z0-9]+$/i.test(e)).slice(0, 4)
      : ['txt'];
    const filterName = typeof payload?.filterName === 'string' ? payload.filterName.slice(0, 40) : 'File';
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Export',
      defaultPath: defaultName,
      filters: extensions.length ? [{ name: filterName, extensions }] : undefined,
    });
    if (canceled || !filePath) return false;
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  });

  ipcMain.handle('get-presets', () => {
    try {
      const raw = fs.readFileSync(presetsPath, 'utf8');
      return yaml.load(raw);
    } catch (err) {
      console.error('[presets] Failed to load presets.yaml:', errorMessage(err));
      return null;
    }
  });

  ipcMain.handle('save-screenshot', async (event) => {
    const img = await event.sender.capturePage();
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Save Screenshot',
      defaultPath: 'map-screenshot.png',
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    });
    if (canceled || !filePath) return;
    fs.writeFileSync(filePath, img.toPNG());
  });

  registerCacheHandlers(ipcMain, cache);
  registerWsHandlers(ipcMain, cache);
  registerCudaCoverageHandlers(ipcMain, path.dirname(presetsPath));
}

function registerCacheHandlers(ipcMain: IpcMain, cache: CacheLike): void {
  ipcMain.handle('cache-elevations-lookup-bbox', (_e, bbox: AnyRecord | null | undefined = {}) => {
    bbox = bbox ?? {};
    const db = cache.db;
    if (!db) return [];
    const latMin = _finiteNumber(bbox.latMin);
    const latMax = _finiteNumber(bbox.latMax);
    const lonMin = _finiteNumber(bbox.lonMin);
    const lonMax = _finiteNumber(bbox.lonMax);
    if (![latMin, latMax, lonMin, lonMax].every(Number.isFinite)) return [];
    let stmt: SqlStatement | null = null;
    try {
      stmt = db.prepare('SELECT lat, lon, elev FROM elevations WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?');
      const rows: AnyRecord[] = [];
      stmt.bind([latMin, latMax, lonMin, lonMax]);
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } catch (err) {
      console.error('[cache] elevations-lookup-bbox error:', errorMessage(err));
      return [];
    } finally {
      if (stmt) stmt.free();
    }
  });

  ipcMain.handle('cache-elevations-lookup-many', (_e, points: unknown) => {
    const db = cache.db;
    if (!db || !Array.isArray(points) || points.length === 0) return [];
    let insertStmt: SqlStatement | null = null;
    try {
      db.run(`
        CREATE TEMP TABLE IF NOT EXISTS elevation_lookup_points (
          lat REAL NOT NULL,
          lon REAL NOT NULL,
          PRIMARY KEY (lat, lon)
        )
      `);
      db.run('DELETE FROM elevation_lookup_points');
      insertStmt = db.prepare('INSERT OR IGNORE INTO elevation_lookup_points (lat, lon) VALUES (?, ?)');
      db.run('BEGIN');
      for (const p of points) {
        if (!_validLatLon(p?.lat, p?.lon)) continue;
        insertStmt.run([Number(p.lat), Number(p.lon)]);
      }
      db.run('COMMIT');

      const rows: AnyRecord[] = [];
      const result = db.exec(`
        SELECT e.lat, e.lon, e.elev
        FROM elevations e
        JOIN elevation_lookup_points p ON p.lat = e.lat AND p.lon = e.lon
      `);
      const values = result[0]?.values ?? [];
      for (const [lat, lon, elev] of values) rows.push({ lat, lon, elev });
      return rows;
    } catch (err) {
      try { db.run('ROLLBACK'); } catch {}
      console.error('[cache] elevations-lookup-many error:', errorMessage(err));
      return [];
    } finally {
      if (insertStmt) insertStmt.free();
    }
  });

  ipcMain.handle('cache-elevations-store', (_e, entries: unknown) => {
    const db = cache.db;
    if (!db || !Array.isArray(entries) || !entries.length) return;
    const validEntries = entries.filter(e => _validLatLon(e?.lat, e?.lon) && Number.isFinite(Number(e?.elev)));
    if (!validEntries.length) return;
    const stmt = db.prepare('INSERT OR REPLACE INTO elevations (lat, lon, elev) VALUES (?, ?, ?)');
    try {
      db.run('BEGIN');
      for (const e of validEntries) stmt.run([Number(e.lat), Number(e.lon), Number(e.elev)]);
      db.run('COMMIT');
      cache.scheduleSave();
    } catch (err) {
      console.error('[cache] elevations-store error:', errorMessage(err));
      try { db.run('ROLLBACK'); } catch {}
    } finally {
      stmt.free();
    }
  });

  ipcMain.handle('cache-dem-tile-get', (_e, tile: AnyRecord | null | undefined = {}) => {
    tile = tile ?? {};
    const db = cache.db;
    const source = _safeSource(tile.source);
    const z = _boundedInteger(tile.z, 0, 30);
    const x = _boundedInteger(tile.x, 0, Number.MAX_SAFE_INTEGER);
    const y = _boundedInteger(tile.y, 0, Number.MAX_SAFE_INTEGER);
    if (!db || !source || z === null || x === null || y === null) return null;
    let stmt: SqlStatement | null = null;
    try {
      stmt = db.prepare('SELECT data FROM dem_tiles WHERE source = ? AND z = ? AND x = ? AND y = ?');
      stmt.bind([source, z, x, y]);
      if (!stmt.step()) return null;
      const row = stmt.getAsObject();
      return row.data ?? null;
    } catch (err) {
      console.error('[cache] dem-tile-get error:', errorMessage(err));
      return null;
    } finally {
      if (stmt) stmt.free();
    }
  });

  ipcMain.handle('cache-dem-tile-store', (_e, tile: AnyRecord | null | undefined = {}) => {
    tile = tile ?? {};
    const db = cache.db;
    const source = _safeSource(tile.source);
    const z = _boundedInteger(tile.z, 0, 30);
    const x = _boundedInteger(tile.x, 0, Number.MAX_SAFE_INTEGER);
    const y = _boundedInteger(tile.y, 0, Number.MAX_SAFE_INTEGER);
    const data = _validBlobPayload(tile.data);
    if (!db || !source || z === null || x === null || y === null || !data) return;
    try {
      db.run(
        'INSERT OR REPLACE INTO dem_tiles (source, z, x, y, data, cached_at) VALUES (?, ?, ?, ?, ?, ?)',
        [source, z, x, y, data, Date.now()]
      );
      cache.scheduleSave();
    } catch (err) {
      console.error('[cache] dem-tile-store error:', errorMessage(err));
    }
  });

  ipcMain.handle('cache-foliage-lookup', (_e, key: string) => {
    const db = cache.db;
    if (!db) return null;
    try {
      const stmt = db.prepare('SELECT data, cached_at FROM foliage_cache WHERE bbox_key = ?');
      try {
        stmt.bind([key]);
        if (!stmt.step()) return null;
        const row = stmt.getAsObject();
        if (Date.now() - row.cached_at > 30 * 24 * 60 * 60 * 1000) return null;
        try { return JSON.parse(row.data); }
        catch { console.warn('[cache] foliage row corrupt for key:', key); return null; }
      } finally {
        stmt.free();
      }
    } catch (err) {
      console.error('[cache] foliage-lookup error:', errorMessage(err));
      return null;
    }
  });

  ipcMain.handle('cache-foliage-store', (_e, key: string, data: unknown) => {
    const db = cache.db;
    if (!db) return;
    try {
      db.run('INSERT OR REPLACE INTO foliage_cache (bbox_key, data, cached_at) VALUES (?, ?, ?)',
        [key, JSON.stringify(data), Date.now()]);
      cache.scheduleSave();
    } catch (err) {
      console.error('[cache] foliage-store error:', errorMessage(err));
    }
  });

  ipcMain.handle('cache-buildings-lookup', (_e, key: string) => {
    const db = cache.db;
    if (!db) return null;
    try {
      const stmt = db.prepare('SELECT data, cached_at FROM buildings_cache WHERE bbox_key = ?');
      try {
        stmt.bind([key]);
        if (!stmt.step()) return null;
        const row = stmt.getAsObject();
        if (Date.now() - row.cached_at > 30 * 24 * 60 * 60 * 1000) return null;
        try { return JSON.parse(row.data); } catch { return null; }
      } finally { stmt.free(); }
    } catch (err) {
      console.error('[cache] buildings-lookup error:', errorMessage(err));
      return null;
    }
  });

  ipcMain.handle('cache-buildings-store', (_e, key: string, data: unknown) => {
    const db = cache.db;
    if (!db) return;
    try {
      db.run('INSERT OR REPLACE INTO buildings_cache (bbox_key, data, cached_at) VALUES (?, ?, ?)',
        [key, JSON.stringify(data), Date.now()]);
      cache.scheduleSave();
    } catch (err) {
      console.error('[cache] buildings-store error:', errorMessage(err));
    }
  });

  ipcMain.handle('cache-get-stats', () => {
    const db = cache.db;
    if (!db) return { elevations: 0, demTiles: 0, foliage: 0, buildings: 0, sizeKb: 0 };
    try {
      const osmFreshCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const elevCount = db.exec('SELECT COUNT(*) FROM elevations')[0]?.values[0]?.[0] ?? 0;
      const demTileCount = db.exec('SELECT COUNT(*) FROM dem_tiles')[0]?.values[0]?.[0] ?? 0;
      const folCount = db.exec(`SELECT COUNT(*) FROM foliage_cache WHERE cached_at >= ${osmFreshCutoff}`)[0]?.values[0]?.[0] ?? 0;
      const bldgCount = db.exec(`SELECT COUNT(*) FROM buildings_cache WHERE cached_at >= ${osmFreshCutoff}`)[0]?.values[0]?.[0] ?? 0;
      const pageSize = db.exec('PRAGMA page_size')[0]?.values[0]?.[0] ?? 4096;
      const pageCount = db.exec('PRAGMA page_count')[0]?.values[0]?.[0] ?? 0;
      return {
        elevations: elevCount,
        demTiles: demTileCount,
        foliage: folCount,
        buildings: bldgCount,
        sizeKb: Math.round(pageSize * pageCount / 1024),
      };
    } catch (err) {
      console.error('[cache] get-stats error:', errorMessage(err));
      return { elevations: 0, demTiles: 0, foliage: 0, buildings: 0, sizeKb: 0 };
    }
  });

  ipcMain.handle('cache-purge-elevations', () => _deleteAndSave(cache, 'DELETE FROM elevations', '[cache] purge-elevations error:'));
  ipcMain.handle('cache-purge-dem-tiles', () => _deleteAndSave(cache, 'DELETE FROM dem_tiles', '[cache] purge-dem-tiles error:'));
  ipcMain.handle('cache-purge-foliage', () => _deleteAndSave(cache, 'DELETE FROM foliage_cache', '[cache] purge-foliage error:'));
  ipcMain.handle('cache-purge-buildings', () => _deleteAndSave(cache, 'DELETE FROM buildings_cache', '[cache] purge-buildings error:'));
  ipcMain.handle('cache-vacuum', () => _deleteAndSave(cache, 'VACUUM', '[cache] vacuum error:'));
}

function registerWsHandlers(ipcMain: IpcMain, cache: CacheLike): void {
  ipcMain.handle('ws-repeaters-save', (_e, rows: unknown) => {
    const db = cache.db;
    if (!db || !Array.isArray(rows)) return;
    const safeRows = rows.map(_safeWsRow).filter((row): row is SafeWsRow => Boolean(row));
    try {
      db.run('BEGIN');
      db.run('DELETE FROM ws_repeaters');
      if (safeRows.length) {
        const stmt = db.prepare('INSERT INTO ws_repeaters (data, saved_at) VALUES (?, ?)');
        const now = Date.now();
        for (const r of safeRows) stmt.run([JSON.stringify(r), now]);
        stmt.free();
      }
      db.run('COMMIT');
      cache.scheduleSave();
    } catch (err) {
      try { db.run('ROLLBACK'); } catch {}
      console.error('[ws] save error:', String(err));
    }
  });

  ipcMain.handle('ws-repeaters-load', () => {
    const db = cache.db;
    if (!db) return [];
    try {
      const stmt = db.prepare('SELECT data FROM ws_repeaters ORDER BY id');
      const rows: SafeWsRow[] = [];
      while (stmt.step()) {
        try {
          const row = _safeWsRow(JSON.parse(stmt.getAsObject().data));
          if (row) rows.push(row);
        } catch {}
      }
      stmt.free();
      return rows;
    } catch (err) {
      console.error('[ws] load error:', String(err));
      return [];
    }
  });

  ipcMain.handle('ws-repeaters-clear', () => {
    const db = cache.db;
    if (!db) return;
    try { db.run('DELETE FROM ws_repeaters'); cache.scheduleSave(); }
    catch (err) { console.error('[ws] clear error:', String(err)); }
  });
}

function _deleteAndSave(cache: CacheLike, sql: string, label: string): void {
  const db = cache.db;
  if (!db) return;
  try {
    db.run(sql);
    cache.saveDb();
  } catch (err) {
    console.error(label, errorMessage(err));
  }
}
