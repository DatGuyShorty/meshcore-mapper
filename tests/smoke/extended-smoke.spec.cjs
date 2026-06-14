const { test, expect } = require('@playwright/test');
const { launchApp } = require('./electron-app');
const { openTab, addRepeater, clearAllNodes, clearAllCoverage, setMapView } = require('./smoke-utils');

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
    await expect(page.locator('#btn-export-gis-geojson-combined')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#btn-export-gis-geojson-per-node')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#btn-export-gis-kml-combined')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#btn-export-gis-kmz-combined')).toBeVisible({ timeout: 15000 });
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
    await expect(page.locator('#map3d')).toHaveAttribute('data-terrain-source', /dem|preview/, { timeout: 30000 });
    await expect(page.locator('#map3d')).toHaveAttribute('data-map-texture-downsampled', /true|false/, { timeout: 30000 });

    await page.locator('#btn-view-2d').click();
    await expect(page.locator('#map3d')).toBeHidden();
  } finally {
    await app.close();
  }
});

test('P2P pick mode creates a selectable link inspector and can be cleared', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });

    await setMapView(page, { lat: 48.28625, lon: 18.5054, zoom: 13, radiusKm: 5 });
    await clearAllCoverage(page);
    await clearAllNodes(page);
    await addRepeater(page, { name: 'Smoke P2P A', lat: '48.28625', lon: '18.50540' });
    await addRepeater(page, { name: 'Smoke P2P B', lat: '48.28900', lon: '18.51400' });
    await openTab(page, 'Planning');

    await page.locator('#btn-p2p-pick').click();
    await expect(page.locator('#p2p-pick-hint')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#btn-p2p-pick')).toBeDisabled();

    const repeaterMarkers = page.locator('.leaflet-marker-icon:has(svg)');
    await expect(repeaterMarkers).toHaveCount(2, { timeout: 10000 });
    await repeaterMarkers.nth(0).click({ force: true });
    await expect(page.locator('#p2p-pick-hint')).toContainText(/point B|receiver/i);
    await repeaterMarkers.nth(1).click({ force: true });
    await expect(page.locator('#p2p-status')).toContainText(/Link (OK|FAILED)/, { timeout: 60000 });

    await page.locator('.p2p-link-line').click({ force: true });
    await expect(page.locator('#selection-inspector')).toContainText('P2P Link', { timeout: 10000 });
    await expect(page.locator('.p2p-link-line')).toHaveClass(/map-object-selected/);
    await expect(page.locator('#selection-inspector')).toContainText('Smoke P2P A');
    await expect(page.locator('#selection-inspector')).toContainText('Smoke P2P B');
    await expect(page.locator('#selection-inspector')).toContainText('View 3D');
    await expect(page.locator('#selection-inspector')).toContainText('Profile');
    await expect(page.locator('#selection-inspector')).toContainText('Recompute');
    await page.locator('#selection-inspector [data-inspector-action="link-view-3d"]').click();
    await expect(page.locator('#map3d')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#map3d')).toHaveAttribute('data-focus-points', '2', { timeout: 30000 });
    await expect(page.locator('#map3d')).toHaveAttribute('data-focus-label', /P2P Link/);
    await page.locator('#btn-view-2d').click();
    await page.locator('#selection-inspector [data-inspector-action="link-p2p-profile"]').click();
    await expect(page.locator('#profile-fullscreen')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#profile-fullscreen')).toContainText('Terrain LoS Profile');
    await page.locator('#btn-close-profile-fullscreen').click();
    await expect(page.locator('#profile-fullscreen')).toBeHidden();

    await page.locator('#btn-p2p-clear').click();
    await expect(page.locator('#p2p-pick-hint')).toBeHidden({ timeout: 10000 });
    await expect(page.locator('#btn-p2p-pick')).toBeEnabled();
    await expect(page.locator('#selection-inspector')).toContainText('Project Summary');
  } finally {
    await app.close();
  }
});
