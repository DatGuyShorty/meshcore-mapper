const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const yaml = require('js-yaml');
const initSqlJs = require('sql.js');

const PRESETS_PATH = path.join(__dirname, 'presets.yaml');

let db       = null;
let dbPath   = null;
let _saveTimer = null;

function saveDb() {
  if (!db || !dbPath) return;
  try {
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
  } catch (err) {
    console.error('[cache] Failed to write cache.db:', err.message);
  }
}

// Debounced save — avoids blocking IPC on every store; flushes within 2 s.
function scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveDb, 2000);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'MeshCore Coverage Mapper',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadFile('index.html');

  // F12 toggles DevTools
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools();
    }
  });
}

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

// ─── Cache IPC handlers ──────────────────────────────────────────
// P11: bulk bbox lookup — replaces N individual per-point queries with one SQL statement
ipcMain.handle('cache-elevations-lookup-bbox', (_e, { latMin, latMax, lonMin, lonMax }) => {
  if (!db) return [];
  let stmt;
  try {
    stmt = db.prepare(
      'SELECT lat, lon, elev FROM elevations WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?'
    );
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

ipcMain.handle('cache-elevations-store', (_e, entries) => {
  if (!db || !entries.length) return;
  const stmt = db.prepare('INSERT OR REPLACE INTO elevations (lat, lon, elev) VALUES (?, ?, ?)');
  try {
    db.run('BEGIN');
    for (const e of entries) stmt.run([e.lat, e.lon, e.elev]);
    db.run('COMMIT');
    scheduleSave();
  } catch (err) {
    console.error('[cache] elevations-store error:', err.message);
    try { db.run('ROLLBACK'); } catch {}
  } finally {
    stmt.free();
  }
});

ipcMain.handle('get-presets', () => {
  try {
    const raw = fs.readFileSync(PRESETS_PATH, 'utf8');
    return yaml.load(raw);
  } catch (err) {
    console.error('[presets] Failed to load presets.yaml:', err.message);
    return null;
  }
});

ipcMain.handle('cache-foliage-lookup', (_e, key) => {
  if (!db) return null;
  try {
    const stmt = db.prepare('SELECT data, cached_at FROM foliage_cache WHERE bbox_key = ?');
    try {
      stmt.bind([key]);
      if (!stmt.step()) return null;
      const row = stmt.getAsObject();
      if (Date.now() - row.cached_at > 30 * 24 * 60 * 60 * 1000) return null; // 30-day TTL
      try {
        return JSON.parse(row.data);
      } catch {
        console.warn('[cache] foliage row corrupt for key:', key);
        return null;
      }
    } finally {
      stmt.free();
    }
  } catch (err) {
    console.error('[cache] foliage-lookup error:', err.message);
    return null;
  }
});

ipcMain.handle('cache-foliage-store', (_e, key, data) => {
  if (!db) return;
  try {
    db.run('INSERT OR REPLACE INTO foliage_cache (bbox_key, data, cached_at) VALUES (?, ?, ?)',
      [key, JSON.stringify(data), Date.now()]);
    scheduleSave();
  } catch (err) {
    console.error('[cache] foliage-store error:', err.message);
  }
});

ipcMain.handle('cache-buildings-lookup', (_e, key) => {
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
  if (!db) return;
  try {
    db.run('INSERT OR REPLACE INTO buildings_cache (bbox_key, data, cached_at) VALUES (?, ?, ?)',
      [key, JSON.stringify(data), Date.now()]);
    scheduleSave();
  } catch (err) {
    console.error('[cache] buildings-store error:', err.message);
  }
});

ipcMain.handle('cache-get-stats', () => {
  if (!db) return { elevations: 0, foliage: 0, buildings: 0, sizeKb: 0 };
  try {
    const elevCount  = db.exec('SELECT COUNT(*) FROM elevations')[0]?.values[0][0] ?? 0;
    const folCount   = db.exec('SELECT COUNT(*) FROM foliage_cache')[0]?.values[0][0] ?? 0;
    const bldgCount  = db.exec('SELECT COUNT(*) FROM buildings_cache')[0]?.values[0][0] ?? 0;
    const pageSize   = db.exec('PRAGMA page_size')[0]?.values[0][0] ?? 4096;
    const pageCount  = db.exec('PRAGMA page_count')[0]?.values[0][0] ?? 0;
    const sizeKb     = Math.round(pageSize * pageCount / 1024);
    return { elevations: elevCount, foliage: folCount, buildings: bldgCount, sizeKb };
  } catch (err) {
    console.error('[cache] get-stats error:', err.message);
    return { elevations: 0, foliage: 0, buildings: 0, sizeKb: 0 };
  }
});

ipcMain.handle('cache-purge-elevations', () => {
  if (!db) return;
  try { db.run('DELETE FROM elevations'); saveDb(); }
  catch (err) { console.error('[cache] purge-elevations error:', err.message); }
});

ipcMain.handle('cache-purge-foliage', () => {
  if (!db) return;
  try { db.run('DELETE FROM foliage_cache'); saveDb(); }
  catch (err) { console.error('[cache] purge-foliage error:', err.message); }
});

ipcMain.handle('cache-purge-buildings', () => {
  if (!db) return;
  try { db.run('DELETE FROM buildings_cache'); saveDb(); }
  catch (err) { console.error('[cache] purge-buildings error:', err.message); }
});

ipcMain.handle('cache-vacuum', () => {
  if (!db) return;
  try { db.run('VACUUM'); saveDb(); }
  catch (err) { console.error('[cache] vacuum error:', err.message); }
});

// ─── WS repeaters persistence ─────────────────────────────────────
ipcMain.handle('ws-repeaters-save', (_e, rows) => {
  if (!db) return;
  try {
    db.run('BEGIN');
    db.run('DELETE FROM ws_repeaters');
    if (rows && rows.length) {
      const stmt = db.prepare('INSERT INTO ws_repeaters (data, saved_at) VALUES (?, ?)');
      const now  = Date.now();
      for (const r of rows) stmt.run([JSON.stringify(r), now]);
      stmt.free();
    }
    db.run('COMMIT');
    scheduleSave();
  } catch (err) {
    try { db.run('ROLLBACK'); } catch {}
    console.error('[ws] save error:', String(err));
  }
});

ipcMain.handle('ws-repeaters-load', () => {
  if (!db) return [];
  try {
    const stmt = db.prepare('SELECT data FROM ws_repeaters ORDER BY id');
    const rows = [];
    while (stmt.step()) {
      try { rows.push(JSON.parse(stmt.getAsObject().data)); } catch {}
    }
    stmt.free();
    return rows;
  } catch (err) { console.error('[ws] load error:', String(err)); return []; }
});

ipcMain.handle('ws-repeaters-clear', () => {
  if (!db) return;
  try { db.run('DELETE FROM ws_repeaters'); scheduleSave(); }
  catch (err) { console.error('[ws] clear error:', String(err)); }
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

app.whenReady().then(async () => {
  console.log('[main] app ready');
  dbPath = path.join(app.getPath('userData'), 'cache.db');
  const wasmDir = path.dirname(require.resolve('sql.js'));
  const SQL = await initSqlJs({ locateFile: f => path.join(wasmDir, f) });
  if (fs.existsSync(dbPath)) {
    console.log('[cache] Loading existing cache.db');
    const fileData = fs.readFileSync(dbPath);
    db = new SQL.Database(fileData);
    // Verify integrity; reset to fresh DB if corrupt
    try {
      const check = db.exec('PRAGMA integrity_check')[0]?.values[0][0];
      if (check !== 'ok') throw new Error(`integrity_check returned: ${check}`);
    } catch (intErr) {
      console.warn('[cache] DB corrupt — discarding and starting fresh:', intErr.message);
      db.close();
      db = new SQL.Database();
    }
  } else {
    console.log('[cache] Creating new cache.db');
    db = new SQL.Database();
  }
  // Enable WAL for better write performance and crash safety
  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA synchronous=NORMAL');
  db.run(`
    CREATE TABLE IF NOT EXISTS elevations (
      lat  REAL NOT NULL,
      lon  REAL NOT NULL,
      elev REAL NOT NULL,
      PRIMARY KEY (lat, lon)
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
  // Belt-and-suspenders: ensure ws_repeaters exists even on DBs created before this table was added
  db.run('CREATE TABLE IF NOT EXISTS ws_repeaters (id INTEGER PRIMARY KEY, data TEXT NOT NULL, saved_at INTEGER NOT NULL)');
  createWindow();
}).catch(err => {
  console.error('[main] Startup error:', err);
  app.quit();
});

app.on('before-quit', () => {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  if (db) {
    saveDb();
    db.close();
    db = null;
    console.log('[cache] cache.db saved and closed');
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
