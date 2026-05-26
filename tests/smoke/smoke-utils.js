const { expect } = require('@playwright/test');

async function openTab(page, name) {
  const tab = page.getByRole('tab', { name });
  await tab.click();
  await expect(page.locator(`#tab-${name.toLowerCase()}`)).toBeVisible({ timeout: 10000 });
}

async function addRepeater(page, { name, lat, lon, power = '20', gain = '2', height = '10', freq = '869.525' }) {
  await openTab(page, 'Nodes');
  await page.locator('#repeater-name').fill(name);
  await page.locator('#repeater-lat').fill(lat);
  await page.locator('#repeater-lon').fill(lon);
  await page.locator('#repeater-height').fill(height);
  await page.locator('#repeater-power').fill(power);
  await page.locator('#repeater-gain').fill(gain);
  await page.locator('#repeater-freq').fill(freq);
  await page.locator('#btn-add-repeater').click();
  await expect(page.locator('#repeater-list')).toContainText(name, { timeout: 10000 });
}

module.exports = { openTab, addRepeater };
