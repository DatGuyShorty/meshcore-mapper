const path = require('path');

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
      preload: path.join(appRoot, 'preload.js'),
    },
  });

  win.loadFile(path.join(appRoot, 'index.html'));

  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools();
    }
  });

  return win;
}

module.exports = { createWindow };
