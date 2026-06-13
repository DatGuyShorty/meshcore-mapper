const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function launchApp() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meshcore-smoke-'));
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    ignoreDefaultArgs: ['--remote-debugging-port=0'],
  });
  const close = app.close.bind(app);
  app.close = async () => {
    try {
      await close();
    } finally {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  };
  if (process.env.SMOKE_VERBOSE) {
    const win = await app.firstWindow();
    win.on('console', msg => console.log(`[renderer ${msg.type()}] ${msg.text()}`));
    win.on('pageerror', err => console.error('[pageerror]', err.message));
  }
  return app;
}

module.exports = { launchApp };
