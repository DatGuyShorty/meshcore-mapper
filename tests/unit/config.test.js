import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createFakeDocument(elements = {}) {
  return {
    getElementById(id) {
      return elements[id] ?? null;
    },
  };
}

function createFakeLocalStorage() {
  const store = Object.create(null);
  return {
    setItem(key, value) {
      store[key] = String(value);
    },
    getItem(key) {
      return store[key] ?? null;
    },
    clear() {
      Object.keys(store).forEach((key) => delete store[key]);
    },
  };
}

var mockReadPersistedSettingValue;
var mockWritePersistedSettingValue;
var mockConfirmAction;
var mockSetButtonBusy;
var mockSetStatus;

vi.mock('../../src/settings.js', () => ({
  PERSISTED_SETTING_IDS: ['setting-a', 'setting-b'],
}));

vi.mock('../../src/settingsPersistence.js', () => {
  mockReadPersistedSettingValue = vi.fn(el => el.value);
  mockWritePersistedSettingValue = vi.fn();
  return {
    bindPersistedSettingChanges: vi.fn(),
    readPersistedSettingValue: mockReadPersistedSettingValue,
    writePersistedSettingValue: mockWritePersistedSettingValue,
  };
});

vi.mock('../../src/map.js', () => ({ map: {}, state: {} }));
vi.mock('../../src/repeaters.js', () => ({
  addRepeater: vi.fn(),
  removeRepeater: vi.fn(),
  refreshRepeaterList: vi.fn(),
}));
vi.mock('../../src/repeaterRows.js', () => ({ parseConfigRepeaters: vi.fn() }));
vi.mock('../../src/elevation.js', () => ({ fetchElevationsFromTiles: vi.fn(async () => []) }));
vi.mock('../../src/foliage.js', () => ({ fetchFoliage: vi.fn(async () => null) }));
vi.mock('../../src/buildings.js', () => ({ fetchBuildings: vi.fn(async () => null) }));
vi.mock('../../src/ui.js', () => {
  mockConfirmAction = vi.fn();
  mockSetButtonBusy = vi.fn();
  mockSetStatus = vi.fn();
  return {
    confirmAction: mockConfirmAction,
    hideProgress: vi.fn(),
    setButtonBusy: mockSetButtonBusy,
    setCancelHandler: vi.fn(),
    setProgress: vi.fn(),
    setStatus: mockSetStatus,
    yieldToUI: vi.fn(async () => {}),
  };
});

import * as configModule from '../../src/config.js';

describe('config helpers', () => {
  beforeEach(() => {
    globalThis.document = createFakeDocument({
      'setting-a': { value: 'alpha' },
      'setting-b': { value: 'beta' },
      'cache-stats': { textContent: '' },
    });
    globalThis.localStorage = createFakeLocalStorage();
    globalThis.window = globalThis.window ?? {};
    mockReadPersistedSettingValue.mockClear();
    mockWritePersistedSettingValue.mockClear();
    mockConfirmAction.mockClear();
    mockSetButtonBusy.mockClear();
    mockSetStatus.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads persisted settings for known input ids', () => {
    const values = configModule.gatherSettings();

    expect(values).toEqual({
      'setting-a': 'alpha',
      'setting-b': 'beta',
    });
    expect(mockReadPersistedSettingValue).toHaveBeenCalledTimes(2);
  });

  it('applies settings only for configured settings ids', () => {
    const a = { value: 'alpha' };
    const b = { value: 'beta' };
    globalThis.document = createFakeDocument({ 'setting-a': a, 'setting-b': b, 'cache-stats': { textContent: '' } });

    configModule.applySettings({ 'setting-a': 'changed', 'setting-b': 'beta', extra: 123 }, { notify: true });

    expect(mockWritePersistedSettingValue).toHaveBeenCalledTimes(2);
    expect(mockWritePersistedSettingValue).toHaveBeenCalledWith(a, 'changed', { notify: true });
    expect(mockWritePersistedSettingValue).toHaveBeenCalledWith(b, 'beta', { notify: true });
  });

  it('persists gathering results into localStorage', () => {
    configModule.persistSettings();
    expect(JSON.parse(localStorage.getItem('meshcoreMapper_settings'))).toEqual({
      'setting-a': 'alpha',
      'setting-b': 'beta',
    });
  });

  it('generates viewport grid points in row-major order', () => {
    const points = configModule._viewportGridPoints(0, 2, 0, 2, 3);

    expect(points).toHaveLength(9);
    expect(points[0]).toEqual({ latitude: 2, longitude: 0 });
    expect(points[4]).toEqual({ latitude: 1, longitude: 1 });
    expect(points[8]).toEqual({ latitude: 0, longitude: 2 });
  });

  it('generates a single viewport point when resolution is one', () => {
    expect(configModule._viewportGridPoints(0, 2, 0, 2, 1)).toEqual([{ latitude: 2, longitude: 0 }]);
  });

  it('does not execute action when confirmation is declined', async () => {
    mockConfirmAction.mockReturnValue(false);
    const action = vi.fn(async () => {});

    await configModule.runConfirmedAction('btn-test', 'Proceed?', action, 'Done');

    expect(action).not.toHaveBeenCalled();
    expect(mockSetButtonBusy).not.toHaveBeenCalled();
    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  it('runs action and refreshes status when confirmed', async () => {
    mockConfirmAction.mockReturnValue(true);
    const action = vi.fn(async () => {});
    globalThis.window.electronAPI = { cacheGetStats: vi.fn(async () => ({ elevations: 0, demTiles: 0, foliage: 0, buildings: 0, sizeKb: 0 })) };

    await configModule.runConfirmedAction('btn-test', 'Proceed?', action, 'Done');

    expect(action).toHaveBeenCalled();
    expect(mockSetStatus).toHaveBeenCalledWith('Done');
    expect(mockSetButtonBusy).toHaveBeenCalledWith('btn-test', false);
  });

  it('reports failure when the confirmed action rejects', async () => {
    mockConfirmAction.mockReturnValue(true);
    const action = vi.fn(async () => { throw new Error('boom'); });

    await configModule.runConfirmedAction('btn-test', 'Proceed?', action, 'Done');

    expect(mockSetStatus).toHaveBeenCalledWith('Action failed: boom');
    expect(mockSetButtonBusy).toHaveBeenCalledWith('btn-test', false);
  });

  it('updates cache stats text on success', async () => {
    window.electronAPI = { cacheGetStats: vi.fn(async () => ({ elevations: 1234, demTiles: 2, foliage: 5, buildings: 6, sizeKb: 77 })) };

    await configModule.refreshCacheStats();

    expect(document.getElementById('cache-stats').textContent).toContain('Cache: 1,234 elevations');
  });

  it('falls back to unavailable text when cache stats fail', async () => {
    window.electronAPI = { cacheGetStats: vi.fn(async () => { throw new Error('fail'); }) };

    await configModule.refreshCacheStats();

    expect(document.getElementById('cache-stats').textContent).toBe('Cache: unavailable');
  });
});
