const { _electron: electron } = require('@playwright/test');

async function launchApp() {
  return electron.launch({
    args: ['.'],
    ignoreDefaultArgs: ['--remote-debugging-port=0'],
  });
}

module.exports = { launchApp };
