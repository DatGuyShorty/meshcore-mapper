const { expect } = require('@playwright/test');

async function openTab(page, name) {
  const tab = page.getByRole('tab', { name });
  await tab.click();
  await expect(page.locator(`#tab-${name.toLowerCase()}`)).toBeVisible({ timeout: 10000 });
}

/**
 * Reset the node list to empty before a test exercises it.
 *
 * The app restores any WebSocket-feed repeaters persisted in the local
 * cache.db on launch, so a freshly-launched window is NOT guaranteed to have an
 * empty node list. Tests that assert exact counts, use `.first()`/`.nth()` on
 * the list, or check `Computing N visible node(s)` must start from a known
 * empty state or they break against whatever the developer's cache happens to
 * hold. "Clear Nodes" empties the in-memory list (and the persisted WS rows via
 * the disconnect path) for the duration of the session.
 */
async function clearAllNodes(page) {
  await openTab(page, 'Nodes');
  const clearBtn = page.locator('#btn-clear-nodes');
  if (await clearBtn.count() === 0) return;
  // Clear Nodes confirms via window.confirm — auto-accept it.
  // Only meaningful if there's something to clear; the button is always present.
  const itemCount = await page.locator('#repeater-list li.repeater-item').count();
  if (itemCount > 0) {
    page.once('dialog', dialog => dialog.accept());
    await clearBtn.click();
  }
  await expect(page.locator('#repeater-list li.repeater-item')).toHaveCount(0, { timeout: 10000 });
}

async function clearAllCoverage(page) {
  await openTab(page, 'Coverage');
  await page.locator('#btn-clear-coverage').click();
  await expect(page.locator('#coverage-status')).toContainText('All coverage layers cleared.', { timeout: 10000 });
  await expect(page.locator('#coverage-layer-list .coverage-layer-item')).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator('#coverage-network-summary')).toContainText('No combined coverage yet.');
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

/**
 * Pin the Leaflet map to a deterministic centre + zoom, and the analysis
 * radius, so coverage compute is bounded and reproducible.
 *
 * Coverage grid resolution is derived from the map's metres-per-pixel, i.e.
 * `156543·cos(lat)/2^zoom` (see src/coverage.js), times the analysis radius.
 * Both the map view and the radius persist to localStorage and are restored on
 * launch, so a test that computes coverage inherits whatever the developer's
 * cache holds. At high zoom / large radius the grid balloons (e.g. zoom 17 +
 * 50 km → 4096×4096 ≈ 16.7M px) and CPU compute can't finish within the test
 * timeout. We write the keys then reload so the app re-initialises the map at
 * the pinned zoom; the radius input is also set directly after reload.
 *
 * Must run BEFORE adding nodes — the reload clears in-memory (non-WS) nodes.
 */
async function setMapView(page, { lat = 48.28625, lon = 18.5054, zoom = 11, radiusKm = 5 } = {}) {
  await page.evaluate(
    ([la, lo, z, r]) => {
      try {
        // Map centre + zoom (read by src/map.js on launch).
        localStorage.setItem('meshcoreMapper_mapCenter', JSON.stringify({ lat: la, lon: lo, zoom: z }));
        // analysis-radius is a persisted setting under meshcoreMapper_settings,
        // restored by config.js restoreSettings() on launch. Merge it in so the
        // grid size is bounded without needing to touch the (collapsed) input.
        const KEY = 'meshcoreMapper_settings';
        let s = {};
        try { s = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { s = {}; }
        s['analysis-radius'] = String(r);
        localStorage.setItem(KEY, JSON.stringify(s));
      } catch { /* ignore */ }
    },
    [lat, lon, zoom, radiusKm],
  );
  await page.reload();
  await expect(page.locator('#map')).toBeVisible({ timeout: 10000 });
}

module.exports = { openTab, addRepeater, clearAllNodes, clearAllCoverage, setMapView };
