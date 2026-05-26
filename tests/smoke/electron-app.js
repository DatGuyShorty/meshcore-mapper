const { _electron: electron } = require('@playwright/test');

async function launchApp() {
  const app = await electron.launch({
    args: ['.'],
    ignoreDefaultArgs: ['--remote-debugging-port=0'],
  });
  if (process.env.SMOKE_VERBOSE) {
    const win = await app.firstWindow();
    win.on('console', msg => console.log(`[renderer ${msg.type()}] ${msg.text()}`));
    win.on('pageerror', err => console.error('[pageerror]', err.message));
  }
  return app;
}

module.exports = { launchApp };
