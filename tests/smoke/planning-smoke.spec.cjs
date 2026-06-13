const { test, expect } = require('@playwright/test');
const { launchApp } = require('./electron-app');
const { openTab } = require('./smoke-utils');

test('opens planning tab and enables optimizer after drawing a search area', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 800 });

    await openTab(page, 'Planning');
    await page.locator('#tab-planning details.panel summary').first().click();
    await expect(page.locator('#btn-draw-area')).toBeVisible({ timeout: 10000 });
    await page.locator('#btn-draw-area').click();

    const map = page.locator('#map');
    const mapBox = await map.boundingBox();
    expect(mapBox).not.toBeNull();
    if (mapBox) {
      await map.click({ position: { x: mapBox.width * 0.25, y: mapBox.height * 0.35 }, force: true });
      await map.click({ position: { x: mapBox.width * 0.70, y: mapBox.height * 0.60 }, force: true });
    }

    await expect(page.locator('#btn-optimize')).toBeEnabled({ timeout: 15000 });
    await expect(page.locator('#opt-status')).toContainText(/Search area ready/i);

    await page.locator('#btn-draw-exclusion-zone').click();
    await expect(page.locator('#draw-exclusion-hint')).toBeVisible({ timeout: 10000 });
    if (mapBox) {
      await map.click({ position: { x: mapBox.width * 0.35, y: mapBox.height * 0.40 }, force: true });
      await map.click({ position: { x: mapBox.width * 0.45, y: mapBox.height * 0.50 }, force: true });
    }
    await expect(page.locator('#opt-exclusion-status')).toContainText(/1 exclusion zone/i);
    await page.locator('#btn-clear-area').click();
    await expect(page.locator('#opt-exclusion-status')).toContainText(/No exclusion zones/i);
  } finally {
    await app.close();
  }
});

test('adds a repeater node and confirms it appears in the list', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 800 });

    await openTab(page, 'Nodes');
    await page.locator('#repeater-name').fill('Smoke Test Node');
    await page.locator('#repeater-lat').fill('48.28625');
    await page.locator('#repeater-lon').fill('18.50540');
    await page.locator('#btn-add-repeater').click();

    await expect(page.locator('#repeater-list')).toContainText('Smoke Test Node', { timeout: 10000 });
    await expect(page.locator('#repeater-list')).toContainText(/48\.286/, { timeout: 10000 });
  } finally {
    await app.close();
  }
});
