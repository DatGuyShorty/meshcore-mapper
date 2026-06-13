const { test, expect } = require('@playwright/test');
const { launchApp } = require('./electron-app');
const { openTab, addRepeater, clearAllNodes, clearAllCoverage, setMapView } = require('./smoke-utils');

test('app loads and exposes core workflow tabs', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator('#map')).toBeVisible();
    await expect(page.locator('#job-drawer')).toBeHidden();

    await page.getByRole('tab', { name: 'Map' }).click();
    await expect(page.locator('#foliage-opacity')).toBeVisible();
    await expect(page.locator('#building-opacity')).toBeVisible();
    await expect(page.locator('#btn-view-3d')).toBeVisible();

    await page.locator('#layer-foliage').uncheck();
    await expect(page.locator('#layer-foliage')).not.toBeChecked();
    await page.locator('#layer-buildings').uncheck();
    await expect(page.locator('#layer-buildings')).not.toBeChecked();
    await page.locator('#layer-foliage').check();
    await page.locator('#layer-buildings').check();

    await page.getByRole('tab', { name: 'Coverage' }).click();
    await expect(page.locator('#btn-compute')).toBeVisible();
    await expect(page.locator('#coverage-overlay-mode')).toBeVisible();
    await expect(page.locator('#compute-backend')).toHaveText(/Auto \(CUDA preferred\)/);
    await expect(page.locator('#backend-status')).toContainText(/Detecting|CUDA|CPU|backend/i, { timeout: 15000 });

    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.locator('#cache-stats')).toBeVisible();
    await expect(page.locator('#btn-warm-cache')).toBeVisible();
    await expect(page.locator('#btn-purge-all')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('repeater node lifecycle works with add, delete, undo, and filtering', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });

    await clearAllNodes(page);
    await page.locator('#repeater-name').fill('Smoke Workflow Node');
    await page.locator('#repeater-lat').fill('48.28625');
    await page.locator('#repeater-lon').fill('18.50540');
    await page.locator('#btn-add-repeater').click();

    await expect(page.locator('#repeater-list')).toContainText('Smoke Workflow Node', { timeout: 10000 });
    await expect(page.locator('#repeater-list')).toContainText('48.2863', { timeout: 10000 });

    const deleteButton = page.locator('#repeater-list button[data-action="delete"]').first();
    await deleteButton.click();
    await expect(page.locator('#repeater-list')).not.toContainText('Smoke Workflow Node');

    await expect(page.locator('#btn-undo-remove')).toBeEnabled();
    await page.locator('#btn-undo-remove').click();
    await expect(page.locator('#repeater-list')).toContainText('Smoke Workflow Node', { timeout: 10000 });

    await page.locator('#node-filter').fill('Workflow');
    await expect(page.locator('#repeater-list')).toContainText('Smoke Workflow Node');
    await page.locator('#node-filter').fill('missing-name');
    await expect(page.locator('#repeater-list')).toContainText('No nodes match the filter.');
  } finally {
    await app.close();
  }
});

test('node tab full workflow covers add, edit, filter, toggle, delete, undo, and clear', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });

    await clearAllNodes(page);

    await page.locator('#radio-preset').selectOption('');
    await page.locator('#antenna-preset').selectOption('omni8');
    await page.locator('#repeater-name').fill('Smoke Full Node 1');
    await page.locator('#repeater-lat').fill('48.28625');
    await page.locator('#repeater-lon').fill('18.50540');
    await page.locator('#repeater-height').fill('12');
    await page.locator('#repeater-power').fill('22');
    await page.locator('#repeater-gain').fill('8');
    await page.locator('#repeater-freq').fill('869.525');
    await page.locator('#btn-add-repeater').click();

    await page.locator('#repeater-name').fill('Smoke Full Node 2');
    await page.locator('#repeater-lat').fill('48.29000');
    await page.locator('#repeater-lon').fill('18.51000');
    await page.locator('#repeater-height').fill('15');
    await page.locator('#repeater-power').fill('18');
    await page.locator('#repeater-gain').fill('5');
    await page.locator('#repeater-freq').fill('870.000');
    await page.locator('#btn-add-repeater').click();

    await expect(page.locator('#repeater-list li.repeater-item')).toHaveCount(2);
    await page.locator('#node-sort').selectOption('name-za');
    await expect(page.locator('#repeater-list .ri-name').first()).toContainText('Smoke Full Node 2');

    await page.locator('#node-filter').fill('Full Node 1');
    await expect(page.locator('#repeater-list')).toContainText('Smoke Full Node 1');
    await expect(page.locator('#repeater-list')).not.toContainText('Smoke Full Node 2');
    await page.locator('#node-filter').fill('');
    await expect(page.locator('#repeater-list li.repeater-item')).toHaveCount(2);

    const editButton = page.locator('#repeater-list button[data-action="edit"]').first();
    await editButton.click();
    await expect(page.locator('#repeater-name')).toHaveValue('Smoke Full Node 2');
    await expect(page.locator('#repeater-power')).toHaveValue('18');
    await page.locator('#repeater-name').fill('Smoke Full Node 2 Edited');
    await page.locator('#repeater-power').fill('20');
    await page.locator('#btn-add-repeater').click();

    await expect(page.locator('#repeater-list li.repeater-item .ri-name').first()).toHaveText('Smoke Full Node 2 Edited');

    const toggleButton = page.locator('#repeater-list button[data-action="toggle-vis"]').first();
    await toggleButton.click();
    await expect(page.locator('#repeater-list li.repeater-item').first()).toHaveClass(/ri-hidden/);
    await toggleButton.click();
    await expect(page.locator('#repeater-list li.repeater-item').first()).not.toHaveClass(/ri-hidden/);

    const deleteButton = page.locator('#repeater-list button[data-action="delete"]').nth(1);
    await deleteButton.click();
    await expect(page.locator('#repeater-list')).not.toContainText('Smoke Full Node 1');

    await expect(page.locator('#btn-undo-remove')).toBeEnabled();
    await page.locator('#btn-undo-remove').click();
    await expect(page.locator('#repeater-list')).toContainText('Smoke Full Node 1');

    page.once('dialog', dialog => dialog.accept());
    await page.locator('#btn-clear-nodes').click();
    await expect(page.locator('#repeater-list li.empty-msg')).toBeVisible();
    await expect(page.locator('#repeater-list')).toContainText('No repeaters added yet.');
    await expect(page.locator('#btn-undo-remove')).toBeDisabled();
  } finally {
    await app.close();
  }
});

test('coverage tab overlay mode and backend selection are present', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });

    await openTab(page, 'Coverage');
    await expect(page.locator('#coverage-overlay-mode')).toBeVisible();
    await page.locator('#coverage-overlay-mode').selectOption('rssi');
    await expect(page.locator('#coverage-overlay-mode')).toHaveValue('rssi');
    await page.locator('summary', { hasText: 'Compute and Fetch Settings' }).click();
    await expect(page.locator('#compute-backend')).toBeVisible();
    await page.locator('#compute-backend').selectOption('cpu');
    await expect(page.locator('#compute-backend')).toHaveValue('cpu');
    await expect(page.locator('#btn-compute')).toBeVisible();
    await expect(page.locator('#coverage-status')).toContainText(/Idle|coverage uses visible nodes/i);
  } finally {
    await app.close();
  }
});

test('coverage compute runs to completion and renders overlay tiles', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });

    // Pin a low zoom + small radius so the CPU grid is bounded and the compute
    // finishes deterministically regardless of the cached map view.
    await setMapView(page, { zoom: 11, radiusKm: 5 });
    await clearAllNodes(page);
    await addRepeater(page, { name: 'Smoke Coverage Node', lat: '48.28625', lon: '18.50540' });
    await openTab(page, 'Coverage');
    await clearAllCoverage(page);

    await page.locator('#scenario-profile').selectOption('quick');
    await expect(page.locator('#scenario-profile')).toHaveValue('quick');
    await page.locator('#coverage-overlay-mode').selectOption('margin');
    await expect(page.locator('#coverage-overlay-mode')).toHaveValue('margin');

    await page.locator('summary', { hasText: 'Compute and Fetch Settings' }).click();
    await page.locator('#compute-backend').selectOption('cpu');
    await expect(page.locator('#compute-backend')).toHaveValue('cpu');

    await page.locator('#btn-compute').click();
    await expect(page.locator('#coverage-status')).toContainText(/Computing 1 visible node/i, { timeout: 15000 });
    await expect(page.locator('#coverage-status')).toContainText(/Total /, { timeout: 120000 });
    await expect(page.locator('#coverage-status')).toHaveClass(/status-success/, { timeout: 120000 });

    // Coverage may render across several 1024px tiles for large grids — check
    // that at least one image layer is attached rather than asserting an exact
    // count.
    await expect(page.locator('#map img.leaflet-image-layer').first()).toBeAttached({ timeout: 120000 });
    await expect(page.locator('#btn-compute')).toBeEnabled({ timeout: 120000 });
    await expect(page.locator('#coverage-network-summary')).toContainText('Combined Visible Network');
    await expect(page.locator('#coverage-network-summary')).toContainText('1 visible layer');
    await expect(page.locator('#coverage-network-summary')).toContainText('Covered area');
    const networkStatsDetails = page.locator('#coverage-network-summary details', { hasText: 'Network stats' });
    await networkStatsDetails.locator('summary').click();
    await expect(networkStatsDetails).toContainText('Average margin');
    await expect(networkStatsDetails).toContainText('Top serving');
    await page.locator('#coverage-network-summary .coverage-network-critical summary').click();
    await expect(page.locator('#coverage-network-summary .coverage-network-critical')).toContainText('Baseline covered');
    await expect(page.locator('#coverage-network-summary .coverage-network-critical')).toContainText('Smoke Coverage Node');
    await page.locator('#coverage-network-summary .coverage-network-critical button', { hasText: 'Sim' }).first().click();
    await expect(page.locator('#coverage-network-summary .coverage-network-sim')).toContainText('Smoke Coverage Node offline');
    await expect(page.locator('#coverage-status')).toContainText(/Simulating Smoke Coverage Node offline/);
    await page.locator('#coverage-network-summary .coverage-network-sim button', { hasText: 'Clear' }).click();
    await expect(page.locator('#coverage-network-summary')).toContainText('Combined Visible Network');
    const imageCountBeforeNetworkOverlay = await page.locator('#map img.leaflet-image-layer').count();
    await page.locator('#coverage-network-overlay').selectOption('best-margin');
    await expect(page.locator('#coverage-network-overlay')).toHaveValue('best-margin');
    await expect.poll(async () => page.locator('#map img.leaflet-image-layer').count(), { timeout: 15000 })
      .toBeGreaterThan(imageCountBeforeNetworkOverlay);

    const computedLayer = page.locator('#coverage-layer-list .coverage-layer-item').last();
    await expect(computedLayer.locator('.cov-layer-name-input')).toHaveValue(/Smoke Coverage Node/);
    await expect(computedLayer.locator('.cov-layer-meta')).toContainText(/CPU worker/i);
    await expect(computedLayer.locator('.cov-layer-meta')).toContainText(/\d+x\d+/);
    await expect(computedLayer.locator('.cov-layer-meta')).toContainText(/5\.0 km/);
    await expect(page.locator('#coverage-layer-list .coverage-layer-group').last()).toContainText('quick');
    await computedLayer.locator('.cov-layer-details summary').click();
    await expect(computedLayer.locator('.cov-layer-details')).toContainText('Backend');
    await expect(computedLayer.locator('.cov-layer-details')).toContainText('Scenario');
    await expect(computedLayer.locator('.cov-layer-details')).toContainText('quick');
    await page.locator('#analysis-radius').fill('9');
    await page.locator('#grid-res').selectOption('2');
    await page.locator('#compute-backend').selectOption('auto');
    await computedLayer.locator('.cov-layer-use').click();
    await expect(page.locator('#coverage-status')).toContainText(/Loaded settings from/);
    await expect(page.locator('#scenario-profile')).toHaveValue('quick');
    await expect(page.locator('#analysis-radius')).toHaveValue('5');
    await expect(page.locator('#grid-res')).toHaveValue('0.5');
    await expect(page.locator('#compute-backend')).toHaveValue('cpu');
    const layerCountBeforeRun = await page.locator('#coverage-layer-list .coverage-layer-item').count();
    await computedLayer.locator('.cov-layer-recompute').click();
    await expect(page.locator('#coverage-status')).toContainText(/Total /, { timeout: 120000 });
    await expect(page.locator('#coverage-status')).toHaveClass(/status-success/, { timeout: 120000 });
    await expect(page.locator('#coverage-layer-list .coverage-layer-item')).toHaveCount(layerCountBeforeRun + 1);
    await expect(page.locator('#coverage-network-summary')).toContainText('2 visible layers');
    await page.locator('#coverage-network-overlay').selectOption('overlap');
    await expect(page.locator('#coverage-network-overlay')).toHaveValue('overlap');
    await page.locator('#coverage-network-overlay').selectOption('strongest-node');
    await expect(page.locator('#coverage-network-overlay')).toHaveValue('strongest-node');
    await page.locator('#coverage-min-count').fill('2');
    await page.locator('#coverage-network-overlay').selectOption('covered-by-n');
    await expect(page.locator('#coverage-network-overlay')).toHaveValue('covered-by-n');
    await expect(page.locator('#coverage-min-count')).toHaveValue('2');
    await page.locator('#coverage-layer-list .coverage-layer-item').first().locator('.cov-layer-vis').uncheck();
    await expect(page.locator('#coverage-network-summary')).toContainText('1 visible layer');
    await page.locator('#coverage-layer-list .coverage-layer-item').first().locator('.cov-layer-vis').check();
    await expect(page.locator('#coverage-network-summary')).toContainText('2 visible layers');

    const recomputedLayer = page.locator('#coverage-layer-list .coverage-layer-item').last();
    await expect(recomputedLayer.locator('.cov-layer-name-input')).toHaveValue(/Smoke Coverage Node/);
    await recomputedLayer.locator('.cov-layer-name-input').fill('Smoke Renamed Coverage');
    await recomputedLayer.locator('.cov-layer-name-input').press('Enter');
    await expect(recomputedLayer.locator('.cov-layer-name-input')).toHaveValue('Smoke Renamed Coverage');

    await page.reload();
    await expect(page.locator('#map')).toBeVisible({ timeout: 10000 });
    await openTab(page, 'Coverage');
    await expect(page.locator('#coverage-layer-list .coverage-layer-item').last().locator('.cov-layer-name-input'))
      .toHaveValue('Smoke Renamed Coverage', { timeout: 30000 });

    const map = page.locator('#map');
    const mapBox = await map.boundingBox();
    expect(mapBox).not.toBeNull();
    if (mapBox) {
      await map.click({ position: { x: mapBox.width / 2 + 60, y: mapBox.height / 2 }, force: true });
    }
    await expect(page.locator('.map-context-card')).toContainText('Visible Coverage At Point', { timeout: 15000 });
    await expect(page.locator('.map-context-card')).toContainText('Smoke Coverage Node');
    await expect(page.locator('.map-context-card')).toContainText('Smoke Renamed Coverage');
    await expect(page.locator('.map-context-card')).toContainText(/Layer \d+\/\d+/);
    await expect(page.locator('#selection-inspector')).toContainText('Map Point');
    await expect(page.locator('#selection-inspector')).toContainText('Visible Coverage At Point');
    await expect(page.locator('#selection-inspector')).toContainText('Smoke Coverage Node');
    await expect(page.locator('#selection-inspector')).toContainText('Smoke Renamed Coverage');
  } finally {
    await app.close();
  }
});

test('map settings panel exposes all layer, 3D, and refresh controls', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });

    await openTab(page, 'Map');
    await expect(page.locator('#layer-foliage')).toBeVisible();
    await expect(page.locator('#layer-buildings')).toBeVisible();
    await expect(page.locator('#layer-barriers')).toBeVisible();
    await expect(page.locator('#layer-auto-refresh')).toBeVisible();

    await page.locator('#layer-foliage').uncheck();
    await expect(page.locator('#layer-foliage')).not.toBeChecked();
    await page.locator('#layer-buildings').uncheck();
    await expect(page.locator('#layer-buildings')).not.toBeChecked();
    await page.locator('#layer-barriers').uncheck();
    await expect(page.locator('#layer-barriers')).not.toBeChecked();
    await page.locator('#layer-foliage').check();
    await page.locator('#layer-buildings').check();
    await page.locator('#layer-barriers').check();

    await page.locator('#layer-auto-refresh').uncheck();
    await expect(page.locator('#layer-auto-refresh')).not.toBeChecked();
    await page.locator('#layer-auto-refresh').check();
    await expect(page.locator('#layer-auto-refresh')).toBeChecked();

    await page.locator('#foliage-opacity').evaluate(el => { el.value = '35'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect(page.locator('#foliage-opacity')).toHaveValue('35');
    await page.locator('#building-opacity').evaluate(el => { el.value = '50'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect(page.locator('#building-opacity')).toHaveValue('50');
    await page.locator('#barrier-opacity').evaluate(el => { el.value = '20'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect(page.locator('#barrier-opacity')).toHaveValue('20');

    await expect(page.locator('#btn-refresh-layers')).toBeVisible();
    await expect(page.locator('#btn-cancel-layers')).toBeVisible();
    await expect(page.locator('#layer-status')).toBeVisible();

    await openTab(page, 'Coverage');
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('obstacle:selected', {
        detail: {
          obstacle: {
            id: 'building:smoke-way',
            category: 'building',
            title: 'Building',
            source: 'OpenStreetMap structures',
            rawOsmType: 'building:residential',
            heightM: 8,
            heightLabel: 'Structure height',
            heightSource: 'OSM tags and local defaults',
            attenuationDbPerM: 0.5,
            attenuationFactor: 1,
            attenuationLabel: 'Building/barrier loss',
            geometry: 'Polygon',
          },
        },
      }));
    });
    await expect(page.locator('#selection-inspector')).toContainText('Obstacle', { timeout: 10000 });
    await expect(page.locator('#selection-inspector')).toContainText('building:residential');
    await expect(page.locator('#selection-inspector')).toContainText('0.50 dB/m');
    await page.locator('#selection-inspector [data-inspector-action="obstacle-open-map"]').click();
    await expect(page.locator('#tab-map')).toBeVisible();
    await page.locator('#selection-inspector [data-inspector-action="obstacle-edit-model"]').click();
    await expect(page.locator('#tab-coverage')).toBeVisible();
    await expect(page.locator('#use-buildings')).toBeVisible();
    await expect(page.locator('#use-buildings')).toBeFocused();
    await expect(page.locator('#obstacle-height-mode')).toBeVisible();
    await openTab(page, 'Map');

    await expect(page.locator('#terrain3d-grid-res')).toBeVisible();
    await page.locator('#terrain3d-grid-res').selectOption('96');
    await expect(page.locator('#terrain3d-grid-res')).toHaveValue('96');
    await page.locator('#terrain3d-vertical-scale').evaluate(el => { el.value = '5'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect(page.locator('#terrain3d-vertical-scale')).toHaveValue('5');

    await expect(page.locator('#btn-refresh-3d')).toBeVisible();

    await page.locator('#btn-cancel-layers').click();
    await expect(page.locator('#progress-overlay')).toBeHidden({ timeout: 30000 });
    await page.locator('#btn-view-3d').click();
    await expect(page.locator('#map3d')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#btn-view-3d')).toHaveClass(/active/);
    await expect(page.locator('#btn-map3d-refresh')).toBeVisible();
    await expect(page.locator('#btn-map3d-reset')).toBeVisible();
    await expect(page.locator('#btn-map3d-fullscreen')).toBeVisible();
    await page.locator('#btn-view-2d').click();
    await expect(page.locator('#map3d')).toBeHidden();
  } finally {
    await app.close();
  }
});

test('node visibility toggle hides and shows repeaters in the list', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });

    await clearAllNodes(page);
    await addRepeater(page, { name: 'Smoke Visibility Node', lat: '48.28625', lon: '18.50540' });
    await openTab(page, 'Nodes');

    await expect(page.locator('#repeater-list li.repeater-item')).toHaveCount(1);
    await page.locator('.leaflet-marker-icon').first().click({ force: true });
    await expect(page.locator('#selection-inspector')).toContainText('Smoke Visibility Node', { timeout: 10000 });
    await expect(page.locator('#repeater-list li.repeater-item').first()).toHaveClass(/ri-selected/);
    await expect(page.locator('#selection-inspector')).toContainText('20.0 dBm + 2.0 dBi');
    await expect(page.locator('#selection-inspector')).toContainText('Run Coverage');
    await page.locator('#selection-inspector [data-inspector-action="node-toggle-visibility"]').click();
    await expect(page.locator('#repeater-list li.repeater-item').first()).toHaveClass(/ri-hidden/);
    await expect(page.locator('#selection-inspector')).toContainText('Hidden');
    await page.locator('#selection-inspector [data-inspector-action="node-toggle-visibility"]').click();
    await expect(page.locator('#repeater-list li.repeater-item').first()).not.toHaveClass(/ri-hidden/);
  } finally {
    await app.close();
  }
});

test('multi-step repeater, P2P, coverage, and settings workflow', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });

    await clearAllNodes(page);
    await addRepeater(page, { name: 'Smoke Workflow A', lat: '48.28625', lon: '18.50540' });
    await addRepeater(page, { name: 'Smoke Workflow B', lat: '48.29000', lon: '18.51000' });

    await openTab(page, 'Nodes');
    await expect(page.locator('#repeater-list li.repeater-item')).toHaveCount(2);
    await page.locator('#btn-toggle-all-vis').click();
    await expect(page.locator('#repeater-list li.repeater-item').first()).toHaveClass(/ri-hidden/);
    await page.locator('#btn-toggle-all-vis').click();
    await expect(page.locator('#repeater-list li.repeater-item').first()).not.toHaveClass(/ri-hidden/);

    await openTab(page, 'Planning');
    await page.locator('#btn-p2p-pick').click();
    await expect(page.locator('#p2p-pick-hint')).toBeVisible({ timeout: 10000 });
    const map = page.locator('#map');
    const mapBox = await map.boundingBox();
    expect(mapBox).not.toBeNull();
    // Cancel pick mode with the Clear button rather than trying to complete a
    // two-click pick. The completion path is exercised by other tests; clicking
    // map positions deterministically across persisted map-centre state is
    // brittle, and clicking through repeater markers is timing-sensitive when
    // run mid-suite.
    void mapBox;
    await page.locator('#btn-p2p-clear').click();
    await expect(page.locator('#p2p-pick-hint')).toBeHidden({ timeout: 15000 });
    await expect(page.locator('#btn-p2p-pick')).toBeEnabled();

    await openTab(page, 'Coverage');
    await page.locator('summary', { hasText: 'Compute and Fetch Settings' }).click();
    await page.locator('#compute-backend').selectOption('cpu');
    await expect(page.locator('#compute-backend')).toHaveValue('cpu');
    await page.locator('#coverage-overlay-mode').selectOption('snr');
    await expect(page.locator('#coverage-overlay-mode')).toHaveValue('snr');

    await openTab(page, 'Settings');
    await page.locator('summary', { hasText: 'WS Node Defaults' }).click();
    await page.locator('#ws-default-height').fill('15');
    await page.locator('#ws-default-power').fill('18');
    await page.locator('#ws-default-freq').fill('870');
    await expect(page.locator('#ws-default-height')).toHaveValue('15');
    await expect(page.locator('#ws-default-power')).toHaveValue('18');
    await expect(page.locator('#ws-default-freq')).toHaveValue(/870/);
  } finally {
    await app.close();
  }
});

test('planning and coverage controls are interactive and stable', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.getByRole('tab', { name: 'Coverage' }).click();
    await page.locator('#coverage-overlay-mode').selectOption('rssi');
    await expect(page.locator('#coverage-overlay-mode')).toHaveValue('rssi');
    await expect(page.locator('#btn-compute')).toBeVisible();

    await page.getByRole('tab', { name: 'Planning' }).click();
    await page.locator('#tab-planning summary', { hasText: 'Best Location Optimizer' }).click();
    await expect(page.locator('#btn-draw-area')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#opt-objective-note')).toContainText(/coverage/i);
    await page.locator('#opt-objective').selectOption('robust');
    await expect(page.locator('#opt-objective-note')).toContainText(/Fresnel/i);
    await page.locator('#opt-objective').selectOption('min-repeaters');
    await expect(page.locator('#opt-objective-note')).toContainText(/target coverage/i);
    await page.locator('#opt-target-coverage').fill('75');
    await expect(page.locator('#opt-target-coverage')).toHaveValue('75');
    await page.locator('#opt-objective').selectOption('redundancy');
    await expect(page.locator('#opt-objective-note')).toContainText(/redundant coverage/i);
    await page.locator('#opt-prefer-high-ground').check();
    await expect(page.locator('#opt-prefer-high-ground')).toBeChecked();
    await page.locator('#opt-min-candidate-elev-m').fill('250');
    await expect(page.locator('#opt-min-candidate-elev-m')).toHaveValue('250');
    await page.locator('#opt-min-redundancy-target').fill('40');
    await expect(page.locator('#opt-min-redundancy-target')).toHaveValue('40');
    await page.locator('#opt-prefer-road-adjacent').check();
    await expect(page.locator('#opt-prefer-road-adjacent')).toBeChecked();
    await expect(page.locator('#opt-exclusion-status')).toContainText(/No exclusion zones/i);
    await page.locator('#btn-draw-exclusion-zone').click();
    await expect(page.locator('#draw-exclusion-hint')).toBeVisible({ timeout: 10000 });
    await page.locator('#btn-clear-area').click();
    await expect(page.locator('#opt-exclusion-status')).toContainText(/No exclusion zones/i);
    await page.locator('#btn-draw-area').click();
    await expect(page.locator('#draw-hint')).toBeVisible({ timeout: 10000 });
    await page.locator('#btn-clear-area').click();
    await expect(page.locator('#opt-status')).toContainText(/draw a search area/i);

    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('optimizer:candidate-selected', {
        detail: {
          candidate: {
            rank: 8,
            lat: 48.28625,
            lon: 18.5054,
            score: 0.64,
            coverageRatio: 0.52,
            elevM: 315,
            avgMarginDb: 9.2,
            backhaulPeerName: 'Smoke Source',
            backhaulMarginDb: 11.4,
            backhaulRxPowerDbm: -94.2,
            backhaulDistanceM: 1200,
            backhaulLos: true,
            backhaulFresnelClear: true,
            backhaulPeerLat: 48.29,
            backhaulPeerLon: 18.51,
            txParams: { height: 12, power: 18, freq: 869.525, gain: 4 },
            scoreBreakdown: { formula: 'coverage + margin' },
          },
        },
      }));
    });
    await expect(page.locator('#selection-inspector')).toContainText('Suggested #8', { timeout: 10000 });
    await expect(page.locator('#selection-inspector')).toContainText('Backhaul to Smoke Source');
    await expect(page.locator('#selection-inspector')).toContainText('Show Backhaul');
    await page.locator('#selection-inspector [data-inspector-action="optimizer-show-backhaul"]').click();
    await expect(page.locator('.optimizer-backhaul-preview')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#opt-status')).toContainText(/Backhaul shown/i);
    await page.locator('#selection-inspector [data-inspector-action="optimizer-add"]').click();
    await openTab(page, 'Nodes');
    await expect(page.locator('#repeater-list')).toContainText('Suggested 8', { timeout: 10000 });
  } finally {
    await app.close();
  }
});
