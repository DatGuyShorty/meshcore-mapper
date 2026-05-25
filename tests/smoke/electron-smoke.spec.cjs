const { test, expect, _electron: electron } = require('@playwright/test');

test('app starts and shows core workflow controls', async () => {
  const app = await electron.launch({ args: ['.'] });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator('#map')).toBeVisible();
    await page.getByRole('tab', { name: 'Map' }).click();
    await expect(page.locator('#foliage-opacity')).toBeVisible();
    await expect(page.locator('#building-opacity')).toBeVisible();
    await page.getByRole('tab', { name: 'Coverage' }).click();
    await expect(page.locator('#btn-compute')).toBeVisible();
    await expect(page.locator('#coverage-overlay-mode')).toHaveText(/Margin.*RSSI.*SNR/s);
    await page.getByText('Compute and Fetch Settings').click();
    await expect(page.locator('#compute-backend')).toBeVisible();
    await expect(page.locator('#compute-backend option')).toHaveText(['Auto (CUDA preferred)', 'Python CUDA preferred', 'CPU Workers']);
    await expect(page.locator('#backend-status')).toContainText(/CUDA|CPU|backend|unavailable/i, { timeout: 15000 });
    await page.getByRole('tab', { name: 'Nodes' }).click();
    await page.locator('#repeater-name').fill('Smoke 3D Node');
    await page.locator('#repeater-lat').fill('48.28625');
    await page.locator('#repeater-lon').fill('18.50540');
    await page.locator('#btn-add-repeater').click();
    await expect(page.locator('#repeater-list')).toContainText('Smoke 3D Node');
    await page.evaluate(async () => {
      const { map } = await import('./src/map.js');
      map.setView([48.28625, 18.50540], 14, { animate: false });
    });
    await page.locator('#btn-view-3d').click();
    await expect(page.locator('#map3d')).toHaveAttribute('data-ready', /preview|terrain/, { timeout: 10000 });
    await expect(page.locator('#map3d')).toHaveAttribute('data-navigation', 'map-pan-tiling');
    await expect(page.locator('#map3d')).toHaveAttribute('data-terrain-tiles', '16', { timeout: 15000 });
    await expect(page.locator('#map3d')).toHaveAttribute('data-map-texture', /Streets \(OSM\)/, { timeout: 15000 });
    await expect.poll(
      () => page.locator('#map3d').getAttribute('data-map-texture-loaded').then(Number),
      { timeout: 15000 }
    ).toBeGreaterThan(0);
    await expect.poll(
      () => page.locator('#map3d').getAttribute('data-map-texture-total').then(Number),
      { timeout: 15000 }
    ).toBeGreaterThan(1);
    await expect(page.locator('#map3d')).toHaveAttribute('data-nodes-count', /[1-9]\d*/, { timeout: 15000 });
    await expect(page.locator('#map3d')).toHaveAttribute('data-coverage-count', /\d+/);
    await expect(page.locator('#map3d')).toHaveAttribute('data-p2p-links-count', /\d+/);
    expect(await canvasHasVisiblePixels(page)).toBe(true);
    expect((await page.screenshot()).length).toBeGreaterThan(1000);
    await page.setViewportSize({ width: 430, height: 760 });
    await page.waitForTimeout(400);
    expect(await canvasHasVisiblePixels(page)).toBe(true);
    expect((await page.screenshot()).length).toBeGreaterThan(1000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(250);
    await page.locator('#btn-view-2d').click();
    const mapWidthBefore = await page.locator('#map-container').evaluate(el => el.getBoundingClientRect().width);
    await page.locator('#btn-toggle-sidebar').click();
    await expect(page.locator('#app')).toHaveClass(/sidebar-collapsed/);
    const mapWidthAfter = await page.locator('#map-container').evaluate(el => el.getBoundingClientRect().width);
    expect(mapWidthAfter).toBeGreaterThan(mapWidthBefore);
    await page.locator('#btn-toggle-sidebar').click();
    await page.locator('#map').click({ position: { x: 420, y: 300 } });
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
