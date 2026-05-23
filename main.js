const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { createCacheDb } = require('./src/main/cacheDb');
const { registerIpcHandlers } = require('./src/main/ipcHandlers');
const { createWindow } = require('./src/main/window');

const APP_ROOT = __dirname;
const PRESETS_PATH = path.join(APP_ROOT, 'presets.yaml');

let cache = null;

app.whenReady().then(async () => {
  console.log('[main] app ready');
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
