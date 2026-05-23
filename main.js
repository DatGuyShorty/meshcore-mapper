const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const yaml = require('js-yaml');
const initSqlJs = require('sql.js');

const PRESETS_PATH = path.join(__dirname, 'presets.yaml');

let db     = null;
let dbPath = null;

function saveDb() {
  if (!db || !dbPath) return;
  try {
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
  } catch (err) {
    console.error('[cache] Failed to write cache.db:', err.message);
  }
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
ipcMain.handle('cache-elevations-lookup', (_e, points) => {
  if (!db) return points.map(() => null);
  try {
    const stmt = db.prepare('SELECT elev FROM elevations WHERE lat = ? AND lon = ?');
    let results;
    try {
      results = points.map(p => {
        stmt.bind([p.lat, p.lon]);
        if (stmt.step()) return stmt.getAsObject().elev;
        return null;
      });
    } finally {
      stmt.free();
    }
    return results;
  } catch (err) {
    console.error('[cache] elevations-lookup error:', err.message);
    return points.map(() => null);
  }
});

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
    saveDb();
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
    saveDb();
  } catch (err) {
    console.error('[cache] foliage-store error:', err.message);
  }
});

app.whenReady().then(async () => {
  console.log('[main] app ready');
  dbPath = path.join(app.getPath('userData'), 'cache.db');
  const wasmDir = path.dirname(require.resolve('sql.js'));
  const SQL = await initSqlJs({ locateFile: f => path.join(wasmDir, f) });
  if (fs.existsSync(dbPath)) {
    console.log('[cache] Loading existing cache.db');
    db = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    console.log('[cache] Creating new cache.db');
    db = new SQL.Database();
  }
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
  `);
  createWindow();
}).catch(err => {
  console.error('[main] Startup error:', err);
  app.quit();
});

app.on('before-quit', () => {
  if (db) {
    saveDb();
    db.close();
    db = null;
    console.log('[cache] cache.db closed');
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
