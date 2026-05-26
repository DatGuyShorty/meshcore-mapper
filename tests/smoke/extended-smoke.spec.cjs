const { test, expect } = require('@playwright/test');
const { launchApp } = require('./electron-app');
const { openTab, addRepeater } = require('./smoke-utils');

test('settings tab exposes cache and persistence controls', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });

    await openTab(page, 'Settings');

    await expect(page.locator('#cache-stats')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#btn-warm-cache')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#btn-purge-elevations')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#btn-purge-dem-tiles')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#btn-purge-all')).toHaveText(/Clear Entire DB/, { timeout: 15000 });

    await page.locator('summary', { hasText: 'WS Node Defaults' }).click();
    await expect(page.locator('#ws-default-height')).toBeVisible({ timeout: 10000 });
    await page.locator('#ws-default-height').fill('12');
    await page.locator('#ws-default-power').fill('22');
    await page.locator('#ws-default-freq').fill('869');
    await expect(page.locator('#ws-default-height')).toHaveValue('12');
    await expect(page.locator('#ws-default-power')).toHaveValue('22');
    await expect(page.locator('#ws-default-freq')).toHaveValue(/869/);
  } finally {
    await app.close();
  }
});

test('3D terrain view can be opened and toggled back to 2D', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });

    await addRepeater(page, { name: 'Smoke 3D Test', lat: '48.28625', lon: '18.50540' });
    await openTab(page, 'Map');

    await page.locator('#btn-view-3d').click();
    await expect(page.locator('#map3d')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#map3d')).toHaveAttribute('data-ready', /preview|terrain/, { timeout: 30000 });

    await page.locator('#btn-view-2d').click();
    await expect(page.locator('#map3d')).toBeHidden();
  } finally {
    await app.close();
  }
});

test('P2P pick mode toggles hint state and can be cleared', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });

    await addRepeater(page, { name: 'Smoke P2P Node', lat: '48.28625', lon: '18.50540' });
    await openTab(page, 'Planning');

    await page.locator('#btn-p2p-pick').click();
    await expect(page.locator('#p2p-pick-hint')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#btn-p2p-pick')).toBeDisabled();

    await page.locator('#btn-p2p-clear').click();
    await expect(page.locator('#p2p-pick-hint')).toBeHidden({ timeout: 10000 });
    await expect(page.locator('#btn-p2p-pick')).toBeEnabled();
  } finally {
    await app.close();
  }
});
