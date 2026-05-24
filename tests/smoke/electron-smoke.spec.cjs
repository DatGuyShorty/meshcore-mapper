const { test, expect, _electron: electron } = require('@playwright/test');

test('app starts and shows core workflow controls', async () => {
  const app = await electron.launch({ args: ['.'] });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('#map')).toBeVisible();
    await page.getByRole('tab', { name: 'Coverage' }).click();
    await expect(page.locator('#btn-compute')).toBeVisible();
    await expect(page.locator('#compute-backend')).toBeVisible();
    await expect(page.locator('#backend-status')).toContainText(/CUDA|WebGPU|backend|unavailable/i, { timeout: 15000 });
  } finally {
    await app.close();
  }
});
