const path = require('path');
const { shell } = require('electron');

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
    if (_isSafeExternalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Block in-place navigation to anything other than the loaded file://
  // page. Same-document hash/path navigations on the loaded file are
  // allowed; external links open in the OS browser; everything else is
  // denied.
  win.webContents.on('will-navigate', (event, url) => {
    if (_isSameDocument(url, win.webContents.getURL())) return;
    event.preventDefault();
    if (_isSafeExternalUrl(url)) shell.openExternal(url);
  });

  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools();
    }
  });

  return win;
}

function _isSafeExternalUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function _isSameDocument(targetUrl, currentUrl) {
  try {
    const target = new URL(targetUrl);
    const current = new URL(currentUrl);
    return target.protocol === current.protocol
      && target.host === current.host
      && target.pathname === current.pathname;
  } catch {
    return false;
  }
}

module.exports = { createWindow };
