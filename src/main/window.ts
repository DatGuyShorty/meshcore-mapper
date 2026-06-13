import path from 'node:path';
import { BrowserWindow, shell } from 'electron';
import { isSafeExternalUrl, isSameDocument } from './urlGuards.js';

// `appRoot` is the project root (app.getAppPath()) for resolving project files.
// The preload and renderer, however, are emitted by electron-vite next to this
// compiled main module (out/main, out/preload, out/renderer), so they are
// resolved relative to __dirname, which is out/main at runtime.
export function createWindow(BrowserWindowCtor: typeof BrowserWindow, _appRoot: string): BrowserWindow {
  const win = new BrowserWindowCtor({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'MeshCore Coverage Mapper',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });

  // electron-vite dev server URL when running `electron-vite dev`, otherwise
  // the built renderer on file://.
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Route any window.open() / target="_blank" through the OS browser
  // instead of opening a new Electron BrowserWindow.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Block in-place navigation to anything other than the loaded file://
  // page. Same-document hash/path navigations on the loaded file are
  // allowed; external links open in the OS browser; everything else is
  // denied.
  win.webContents.on('will-navigate', (event, url) => {
    if (isSameDocument(url, win.webContents.getURL())) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) shell.openExternal(url);
  });

  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools();
    }
  });

  return win;
}
