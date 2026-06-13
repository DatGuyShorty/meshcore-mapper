const { test, expect } = require('@playwright/test');
const { launchApp } = require('./electron-app');
const { openTab, addRepeater } = require('./smoke-utils');

test('app starts and shows core workflow controls', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator('#map')).toBeVisible();

    await openTab(page, 'Map');
    await expect(page.locator('#foliage-opacity')).toBeVisible();
    await expect(page.locator('#building-opacity')).toBeVisible();
    for (const id of ['#layer-foliage', '#layer-buildings', '#layer-barriers']) {
      const layer = page.locator(id);
      if (await layer.isChecked()) await layer.uncheck();
    }

    await openTab(page, 'Coverage');
    await expect(page.locator('#btn-compute')).toBeVisible();
    await expect(page.locator('#coverage-overlay-mode')).toHaveText(/Margin.*RSSI.*SNR/s);
    await page.locator('summary', { hasText: 'Compute and Fetch Settings' }).click();
    await expect(page.locator('#compute-backend')).toBeVisible();
    await expect(page.locator('#compute-backend option')).toHaveText(['Auto (CUDA preferred)', 'Python CUDA preferred', 'CPU Workers']);
    await expect(page.locator('#backend-status')).toContainText(/Detecting|CUDA|CPU|backend/i, { timeout: 15000 });

    await addRepeater(page, { name: 'Smoke 3D Node', lat: '48.28625', lon: '18.50540' });
    await page.locator('#btn-view-3d').click();
    await expect(page.locator('#map3d')).toBeVisible();
    await expect(page.locator('#map3d')).toHaveAttribute('data-ready', /preview|terrain/, { timeout: 10000 });
    await expect(page.locator('#map3d')).toHaveAttribute('data-navigation', 'map-pan-tiling');
    await expect.poll(
      () => page.locator('#map3d').getAttribute('data-map-texture-loaded').then(Number),
      { timeout: 15000 }
    ).toBeGreaterThan(0);
    await expect(page.locator('#map3d')).toHaveAttribute('data-nodes-count', /[1-9]\d*/, { timeout: 15000 });

    await page.locator('#btn-view-2d').click();
    const mapWidthBefore = await page.locator('#map-container').evaluate(el => el.getBoundingClientRect().width);
    await page.locator('#btn-toggle-sidebar').click();
    await expect(page.locator('#app')).toHaveClass(/sidebar-collapsed/);
    const mapWidthAfter = await page.locator('#map-container').evaluate(el => el.getBoundingClientRect().width);
    expect(mapWidthAfter).toBeGreaterThan(mapWidthBefore);
    await page.locator('#btn-toggle-sidebar').click();

    await page.locator('#map').click({ position: { x: 420, y: 300 }, force: true });
    await expect(page.locator('.map-context-card')).toContainText('Map Point');
  } finally {
    await app.close();
  }
});

async function canvasHasVisiblePixels(page) {
  return page.locator('#map3d-canvas').evaluate((canvas) => {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl || canvas.width < 8 || canvas.height < 8) return false;
    const coords = [
      [0.5, 0.5],
      [0.35, 0.45],
      [0.65, 0.55],
      [0.5, 0.72],
    ];
    const pixel = new Uint8Array(4);
    for (const [xf, yf] of coords) {
      const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(canvas.width * xf)));
      const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(canvas.height * yf)));
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      if (pixel[0] + pixel[1] + pixel[2] > 8) return true;
    }
    return false;
  });
}
