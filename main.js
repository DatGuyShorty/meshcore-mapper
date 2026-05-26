const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');
const { createCacheDb } = require('./src/main/cacheDb');
const { registerIpcHandlers } = require('./src/main/ipcHandlers');
const { createWindow } = require('./src/main/window');

const APP_ROOT = __dirname;
const PRESETS_PATH = path.join(APP_ROOT, 'presets.yaml');

// Allowlist of web permissions the renderer is allowed to use.
// Geolocation is used once on first launch to centre the map (src/map.js).
const ALLOWED_PERMISSIONS = new Set(['geolocation']);

let cache = null;

app.whenReady().then(async () => {
  console.log('[main] app ready');
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return ALLOWED_PERMISSIONS.has(permission);
  });
  cache = await createCacheDb(app);
  registerIpcHandlers({ ipcMain, dialog, cache, presetsPath: PRESETS_PATH });
  createWindow(BrowserWindow, APP_ROOT);
}).catch(err => {
  console.error('[main] Startup error:', err);
  app.quit();
});

app.on('before-quit', () => {
  if (cache) {
    cache.close();
    cache = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow(BrowserWindow, APP_ROOT);
});
