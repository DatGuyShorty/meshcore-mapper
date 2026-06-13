import { describe, expect, it, vi } from 'vitest';
import { createSettingsStore } from '../../src/settingsStore.js';

function createInput(value = '') {
  return {
    type: 'text',
    value,
    dispatchEvent: vi.fn(),
  };
}

function createCheckbox(checked = false) {
  return {
    type: 'checkbox',
    checked,
    dispatchEvent: vi.fn(),
  };
}

function createStorage(initial = {}) {
  const values = { ...initial };
  return {
    getItem: vi.fn(key => values[key] ?? null),
    setItem: vi.fn((key, value) => {
      values[key] = String(value);
    }),
    values,
  };
}

describe('settings store', () => {
  it('gathers known setting controls', () => {
    const elements = {
      a: createInput('alpha'),
      b: createCheckbox(true),
    };
    const store = createSettingsStore({
      ids: ['a', 'b', 'missing'],
      storageKey: 'settings',
      root: () => ({ getElementById: id => elements[id] ?? null }),
      storage: () => createStorage(),
    });

    expect(store.gather()).toEqual({ a: 'alpha', b: true });
  });

  it('applies known setting values and optionally notifies controls', () => {
    const elements = {
      a: createInput('old'),
      b: createCheckbox(false),
    };
    const store = createSettingsStore({
      ids: ['a', 'b'],
      storageKey: 'settings',
      root: () => ({ getElementById: id => elements[id] ?? null }),
      storage: () => createStorage(),
    });

    store.apply({ a: 'new', b: true, extra: 'ignored' }, { notify: true });

    expect(elements.a.value).toBe('new');
    expect(elements.b.checked).toBe(true);
    expect(elements.a.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(elements.b.dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('persists gathered settings to storage', () => {
    const storage = createStorage();
    const elements = { a: createInput('alpha') };
    const store = createSettingsStore({
      ids: ['a'],
      storageKey: 'settings',
      root: () => ({ getElementById: id => elements[id] ?? null }),
      storage: () => storage,
    });

    store.persist();

    expect(storage.setItem).toHaveBeenCalledWith('settings', JSON.stringify({ a: 'alpha' }));
  });

  it('restores allowlisted settings from primary or legacy storage', () => {
    const storage = createStorage({
      legacy: JSON.stringify({ a: 'legacy', extra: 'ignored' }),
    });
    const elements = { a: createInput('old') };
    const store = createSettingsStore({
      ids: ['a'],
      storageKey: 'settings',
      legacyKey: 'legacy',
      root: () => ({ getElementById: id => elements[id] ?? null }),
      storage: () => storage,
    });

    store.restore();

    expect(elements.a.value).toBe('legacy');
  });

  it('ignores malformed restored settings', () => {
    const storage = createStorage({ settings: '[]' });
    const elements = { a: createInput('old') };
    const store = createSettingsStore({
      ids: ['a'],
      storageKey: 'settings',
      root: () => ({ getElementById: id => elements[id] ?? null }),
      storage: () => storage,
    });

    store.restore();

    expect(elements.a.value).toBe('old');
  });
});
