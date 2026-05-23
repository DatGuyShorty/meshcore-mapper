const fs = require('fs');
const yaml = require('js-yaml');

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
}

function registerCacheHandlers(ipcMain, cache) {
  ipcMain.handle('cache-elevations-lookup-bbox', (_e, { latMin, latMax, lonMin, lonMax }) => {
    const db = cache.db;
    if (!db) return [];
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
        if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lon)) continue;
        insertStmt.run([p.lat, p.lon]);
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
    if (!db || !entries.length) return;
    const stmt = db.prepare('INSERT OR REPLACE INTO elevations (lat, lon, elev) VALUES (?, ?, ?)');
    try {
      db.run('BEGIN');
      for (const e of entries) stmt.run([e.lat, e.lon, e.elev]);
      db.run('COMMIT');
      cache.scheduleSave();
    } catch (err) {
      console.error('[cache] elevations-store error:', err.message);
      try { db.run('ROLLBACK'); } catch {}
    } finally {
      stmt.free();
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
    if (!db) return { elevations: 0, foliage: 0, buildings: 0, sizeKb: 0 };
    try {
      const elevCount = db.exec('SELECT COUNT(*) FROM elevations')[0]?.values[0][0] ?? 0;
      const folCount = db.exec('SELECT COUNT(*) FROM foliage_cache')[0]?.values[0][0] ?? 0;
      const bldgCount = db.exec('SELECT COUNT(*) FROM buildings_cache')[0]?.values[0][0] ?? 0;
      const pageSize = db.exec('PRAGMA page_size')[0]?.values[0][0] ?? 4096;
      const pageCount = db.exec('PRAGMA page_count')[0]?.values[0][0] ?? 0;
      return { elevations: elevCount, foliage: folCount, buildings: bldgCount, sizeKb: Math.round(pageSize * pageCount / 1024) };
    } catch (err) {
      console.error('[cache] get-stats error:', err.message);
      return { elevations: 0, foliage: 0, buildings: 0, sizeKb: 0 };
    }
  });

  ipcMain.handle('cache-purge-elevations', () => _deleteAndSave(cache, 'DELETE FROM elevations', '[cache] purge-elevations error:'));
  ipcMain.handle('cache-purge-foliage', () => _deleteAndSave(cache, 'DELETE FROM foliage_cache', '[cache] purge-foliage error:'));
  ipcMain.handle('cache-purge-buildings', () => _deleteAndSave(cache, 'DELETE FROM buildings_cache', '[cache] purge-buildings error:'));
  ipcMain.handle('cache-vacuum', () => _deleteAndSave(cache, 'VACUUM', '[cache] vacuum error:'));
}

function registerWsHandlers(ipcMain, cache) {
  ipcMain.handle('ws-repeaters-save', (_e, rows) => {
    const db = cache.db;
    if (!db) return;
    try {
      db.run('BEGIN');
      db.run('DELETE FROM ws_repeaters');
      if (rows && rows.length) {
        const stmt = db.prepare('INSERT INTO ws_repeaters (data, saved_at) VALUES (?, ?)');
        const now = Date.now();
        for (const r of rows) stmt.run([JSON.stringify(r), now]);
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
        try { rows.push(JSON.parse(stmt.getAsObject().data)); } catch {}
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

module.exports = { registerIpcHandlers };
