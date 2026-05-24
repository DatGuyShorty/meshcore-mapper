const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

async function createCacheDb(app) {
  let db = null;
  let dbPath = path.join(app.getPath('userData'), 'cache.db');
  let saveTimer = null;

  function saveDb() {
    if (!db || !dbPath) return;
    try {
      fs.writeFileSync(dbPath, Buffer.from(db.export()));
    } catch (err) {
      console.error('[cache] Failed to write cache.db:', err.message);
    }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDb, 2000);
  }

  function close() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (db) {
      saveDb();
      db.close();
      db = null;
      console.log('[cache] cache.db saved and closed');
    }
  }

  const wasmDir = path.dirname(require.resolve('sql.js'));
  const SQL = await initSqlJs({ locateFile: f => path.join(wasmDir, f) });
  if (fs.existsSync(dbPath)) {
    console.log('[cache] Loading existing cache.db');
    const fileData = fs.readFileSync(dbPath);
    db = new SQL.Database(fileData);
    try {
      const check = db.exec('PRAGMA integrity_check')[0]?.values[0][0];
      if (check !== 'ok') throw new Error(`integrity_check returned: ${check}`);
    } catch (intErr) {
      console.warn('[cache] DB corrupt - discarding and starting fresh:', intErr.message);
      db.close();
      db = new SQL.Database();
    }
  } else {
    console.log('[cache] Creating new cache.db');
    db = new SQL.Database();
  }

  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA synchronous=NORMAL');
  db.run(`
    CREATE TABLE IF NOT EXISTS elevations (
      lat  REAL NOT NULL,
      lon  REAL NOT NULL,
      elev REAL NOT NULL,
      PRIMARY KEY (lat, lon)
    );
    CREATE TABLE IF NOT EXISTS dem_tiles (
      source    TEXT NOT NULL,
      z         INTEGER NOT NULL,
      x         INTEGER NOT NULL,
      y         INTEGER NOT NULL,
      data      BLOB NOT NULL,
      cached_at INTEGER NOT NULL,
      PRIMARY KEY (source, z, x, y)
    );
    CREATE TABLE IF NOT EXISTS foliage_cache (
      bbox_key  TEXT PRIMARY KEY,
      data      TEXT NOT NULL,
      cached_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS buildings_cache (
      bbox_key  TEXT PRIMARY KEY,
      data      TEXT NOT NULL,
      cached_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ws_repeaters (
      id        INTEGER PRIMARY KEY,
      data      TEXT NOT NULL,
      saved_at  INTEGER NOT NULL
    );
  `);

  return {
    get db() { return db; },
    saveDb,
    scheduleSave,
    close,
  };
}

module.exports = { createCacheDb };
