import { describe, expect, it } from 'vitest';
import { bindPersistedSettingChanges } from '../../src/settingsPersistence.js';

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
});
