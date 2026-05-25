import { describe, expect, it } from 'vitest';
import {
  bindPersistedSettingChanges,
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
});
