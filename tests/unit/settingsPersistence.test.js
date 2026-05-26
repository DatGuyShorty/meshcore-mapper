import { describe, expect, it, vi } from 'vitest';
import {
  bindPersistedSettingChanges,
  readPersistedSettingValue,
  writePersistedSettingValue,
} from '../../src/settingsPersistence.js';

describe('settings persistence bindings', () => {
  it('skips missing persisted controls without throwing', () => {
    const calls = [];
    const root = {
      getElementById(id) {
        if (id !== 'present') return null;
        return {
          addEventListener(event, handler) {
            calls.push({ event, handler });
          },
        };
      },
    };
    const handler = () => {};

    expect(() => bindPersistedSettingChanges(['missing', 'present'], handler, root)).not.toThrow();
    expect(calls).toEqual([{ event: 'change', handler }]);
  });

  it('reads checkbox checked values and regular input values', () => {
    expect(readPersistedSettingValue({ type: 'checkbox', checked: true })).toBe(true);
    expect(readPersistedSettingValue({ type: 'text', value: 'hello' })).toBe('hello');
  });

  it('keeps select defaults when a saved value no longer exists', () => {
    const events = [];
    const select = {
      value: 'auto',
      options: [{ value: 'auto' }, { value: 'cuda' }, { value: 'cpu' }],
      dispatchEvent: event => events.push(event.type),
    };

    expect(writePersistedSettingValue(select, 'removed-backend', { notify: true })).toBe(false);
    expect(select.value).toBe('auto');
    expect(events).toEqual([]);
  });

  it('applies valid select values and dispatches changes when requested', () => {
    const events = [];
    const select = {
      value: 'auto',
      options: [{ value: 'auto' }, { value: 'cuda' }, { value: 'cpu' }],
      dispatchEvent: event => events.push(event.type),
    };

    expect(writePersistedSettingValue(select, 'cuda', { notify: true })).toBe(true);
    expect(select.value).toBe('cuda');
    expect(events).toEqual(['change']);
  });

  it('writes checkbox values correctly for false string and booleans', () => {
    const checkbox = {
      type: 'checkbox',
      checked: true,
      dispatchEvent: vi.fn(),
    };

    expect(writePersistedSettingValue(checkbox, 'false')).toBe(true);
    expect(checkbox.checked).toBe(false);
    expect(writePersistedSettingValue(checkbox, true)).toBe(true);
    expect(checkbox.checked).toBe(true);
    expect(checkbox.dispatchEvent).not.toHaveBeenCalled();
  });

  it('returns false when target element is missing', () => {
    expect(writePersistedSettingValue(null, 'any')).toBe(false);
  });
});
