import { describe, expect, it } from 'vitest';
import { createRepeaterStore } from '../../src/repeaterStore.js';

describe('repeater store', () => {
  it('tracks repeater rows and allocates ids', () => {
    const store = createRepeaterStore(10);

    expect(store.getRepeaters()).toEqual([]);
    expect(store.getNextId()).toBe(10);
    expect(store.allocateId()).toBe(10);
    expect(store.getNextId()).toBe(11);

    const rows = [{ id: 10, name: 'A' }];
    store.setRepeaters(rows);
    expect(store.getRepeaters()).toBe(rows);

    store.reset();
    expect(store.getRepeaters()).toEqual([]);
    expect(store.getNextId()).toBe(10);
  });

  it('falls back to the initial id when nextId is invalid', () => {
    const store = createRepeaterStore(3);

    store.setNextId(Number.NaN);
    expect(store.getNextId()).toBe(3);
  });
});
