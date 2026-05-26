const path = require('path');
const { shell } = require('electron');
const { isSafeExternalUrl, isSameDocument } = require('./urlGuards');

function createWindow(BrowserWindow, appRoot) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'MeshCore Coverage Mapper',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(appRoot, 'preload.js'),
    },
  });

  win.loadFile(path.join(appRoot, 'index.html'));

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

module.exports = { createWindow };
