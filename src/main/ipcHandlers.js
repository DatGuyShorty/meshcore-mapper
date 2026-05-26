const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { registerCudaCoverageHandlers } = require('./cudaCoverage');

function registerIpcHandlers({ ipcMain, dialog, cache, presetsPath }) {
  ipcMain.handle('save-file', async (_event, jsonStr) => {
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
    if (canceled || filePaths.length === 0) return null;
    return fs.readFileSync(filePaths[0], 'utf8');
  });

  ipcMain.handle('get-presets', () => {
    try {
      const raw = fs.readFileSync(presetsPath, 'utf8');
      return yaml.load(raw);
    } catch (err) {
      console.error('[presets] Failed to load presets.yaml:', err.message);
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

function registerCacheHandlers(ipcMain, cache) {
  ipcMain.handle('cache-elevations-lookup-bbox', (_e, bbox = {}) => {
    bbox = bbox ?? {};
    const db = cache.db;
    if (!db) return [];
    const latMin = _finiteNumber(bbox.latMin);
    const latMax = _finiteNumber(bbox.latMax);
    const lonMin = _finiteNumber(bbox.lonMin);
    const lonMax = _finiteNumber(bbox.lonMax);
    if (![latMin, latMax, lonMin, lonMax].every(Number.isFinite)) return [];
    let stmt;
    try {
      stmt = db.prepare('SELECT lat, lon, elev FROM elevations WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?');
      const rows = [];
      stmt.bind([latMin, latMax, lonMin, lonMax]);
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } catch (err) {
      console.error('[cache] elevations-lookup-bbox error:', err.message);
      return [];
    } finally {
      if (stmt) stmt.free();
    }
  });

  ipcMain.handle('cache-elevations-lookup-many', (_e, points) => {
    const db = cache.db;
    if (!db || !Array.isArray(points) || points.length === 0) return [];
    let insertStmt;
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

      const rows = [];
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
      console.error('[cache] elevations-lookup-many error:', err.message);
      return [];
    } finally {
      if (insertStmt) insertStmt.free();
    }
  });

  ipcMain.handle('cache-elevations-store', (_e, entries) => {
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
      console.error('[cache] elevations-store error:', err.message);
      try { db.run('ROLLBACK'); } catch {}
    } finally {
      stmt.free();
    }
  });

  ipcMain.handle('cache-dem-tile-get', (_e, tile = {}) => {
    tile = tile ?? {};
    const db = cache.db;
    const source = _safeSource(tile.source);
    const z = _boundedInteger(tile.z, 0, 30);
    const x = _boundedInteger(tile.x, 0, Number.MAX_SAFE_INTEGER);
    const y = _boundedInteger(tile.y, 0, Number.MAX_SAFE_INTEGER);
    if (!db || !source || z === null || x === null || y === null) return null;
    let stmt;
    try {
      stmt = db.prepare('SELECT data FROM dem_tiles WHERE source = ? AND z = ? AND x = ? AND y = ?');
      stmt.bind([source, z, x, y]);
      if (!stmt.step()) return null;
      const row = stmt.getAsObject();
      return row.data ?? null;
    } catch (err) {
      console.error('[cache] dem-tile-get error:', err.message);
      return null;
    } finally {
      if (stmt) stmt.free();
    }
  });

  ipcMain.handle('cache-dem-tile-store', (_e, tile = {}) => {
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
      console.error('[cache] dem-tile-store error:', err.message);
    }
  });

  ipcMain.handle('cache-foliage-lookup', (_e, key) => {
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
      console.error('[cache] foliage-lookup error:', err.message);
      return null;
    }
  });

  ipcMain.handle('cache-foliage-store', (_e, key, data) => {
    const db = cache.db;
    if (!db) return;
    try {
      db.run('INSERT OR REPLACE INTO foliage_cache (bbox_key, data, cached_at) VALUES (?, ?, ?)',
        [key, JSON.stringify(data), Date.now()]);
      cache.scheduleSave();
    } catch (err) {
      console.error('[cache] foliage-store error:', err.message);
    }
  });

  ipcMain.handle('cache-buildings-lookup', (_e, key) => {
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
      console.error('[cache] buildings-lookup error:', err.message);
      return null;
    }
  });

  ipcMain.handle('cache-buildings-store', (_e, key, data) => {
    const db = cache.db;
    if (!db) return;
    try {
      db.run('INSERT OR REPLACE INTO buildings_cache (bbox_key, data, cached_at) VALUES (?, ?, ?)',
        [key, JSON.stringify(data), Date.now()]);
      cache.scheduleSave();
    } catch (err) {
      console.error('[cache] buildings-store error:', err.message);
    }
  });

  ipcMain.handle('cache-get-stats', () => {
    const db = cache.db;
    if (!db) return { elevations: 0, demTiles: 0, foliage: 0, buildings: 0, sizeKb: 0 };
    try {
      const osmFreshCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const elevCount = db.exec('SELECT COUNT(*) FROM elevations')[0]?.values[0][0] ?? 0;
      const demTileCount = db.exec('SELECT COUNT(*) FROM dem_tiles')[0]?.values[0][0] ?? 0;
      const folCount = db.exec(`SELECT COUNT(*) FROM foliage_cache WHERE cached_at >= ${osmFreshCutoff}`)[0]?.values[0][0] ?? 0;
      const bldgCount = db.exec(`SELECT COUNT(*) FROM buildings_cache WHERE cached_at >= ${osmFreshCutoff}`)[0]?.values[0][0] ?? 0;
      const pageSize = db.exec('PRAGMA page_size')[0]?.values[0][0] ?? 4096;
      const pageCount = db.exec('PRAGMA page_count')[0]?.values[0][0] ?? 0;
      return {
        elevations: elevCount,
        demTiles: demTileCount,
        foliage: folCount,
        buildings: bldgCount,
        sizeKb: Math.round(pageSize * pageCount / 1024),
      };
    } catch (err) {
      console.error('[cache] get-stats error:', err.message);
      return { elevations: 0, demTiles: 0, foliage: 0, buildings: 0, sizeKb: 0 };
    }
  });

  ipcMain.handle('cache-purge-elevations', () => _deleteAndSave(cache, 'DELETE FROM elevations', '[cache] purge-elevations error:'));
  ipcMain.handle('cache-purge-dem-tiles', () => _deleteAndSave(cache, 'DELETE FROM dem_tiles', '[cache] purge-dem-tiles error:'));
  ipcMain.handle('cache-purge-foliage', () => _deleteAndSave(cache, 'DELETE FROM foliage_cache', '[cache] purge-foliage error:'));
  ipcMain.handle('cache-purge-buildings', () => _deleteAndSave(cache, 'DELETE FROM buildings_cache', '[cache] purge-buildings error:'));
  ipcMain.handle('cache-vacuum', () => _deleteAndSave(cache, 'VACUUM', '[cache] vacuum error:'));
}

function registerWsHandlers(ipcMain, cache) {
  ipcMain.handle('ws-repeaters-save', (_e, rows) => {
    const db = cache.db;
    if (!db || !Array.isArray(rows)) return;
    const safeRows = rows.map(_safeWsRow).filter(Boolean);
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
      const rows = [];
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

function _deleteAndSave(cache, sql, label) {
  const db = cache.db;
  if (!db) return;
  try {
    db.run(sql);
    cache.saveDb();
  } catch (err) {
    console.error(label, err.message);
  }
}

function _finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function _validLatLon(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  return Number.isFinite(la)
    && Number.isFinite(lo)
    && la >= -90
    && la <= 90
    && lo >= -180
    && lo <= 180;
}

function _boundedInteger(value, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function _safeSource(source) {
  if (typeof source !== 'string') return null;
  const trimmed = source.trim();
  return /^[a-z0-9:_-]{1,48}$/i.test(trimmed) ? trimmed : null;
}

function _validBlobPayload(data) {
  if (!data) return null;
  if (data instanceof Uint8Array || data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) return data;
  if (Array.isArray(data) && data.length <= 8 * 1024 * 1024) return data;
  return null;
}

function _safeWsRow(row) {
  const lat = Number(row?.lat);
  const lon = Number(row?.lon);
  if (!_validLatLon(lat, lon)) return null;
  return {
    name: String(row?.name ?? 'Unknown').slice(0, 120),
    lat,
    lon,
    short: row?.short === undefined || row?.short === null ? null : String(row.short).slice(0, 80),
    lastSeen: row?.lastSeen === undefined || row?.lastSeen === null ? null : String(row.lastSeen).slice(0, 80),
    wsKey: row?.wsKey === undefined || row?.wsKey === null ? null : String(row.wsKey).slice(0, 160),
  };
}

module.exports = { registerIpcHandlers };
