import { describe, expect, it } from 'vitest';
import { createLiveFeedStore } from '../../src/liveFeedStore.js';

describe('live feed store', () => {
  it('tracks the active connection handle', () => {
    const store = createLiveFeedStore();
    const connection = { close() {} };

    expect(store.hasConnection()).toBe(false);
    expect(store.getConnection()).toBeNull();

    store.setConnection(connection);
    expect(store.hasConnection()).toBe(true);
    expect(store.getConnection()).toBe(connection);

    store.clearConnection();
    expect(store.hasConnection()).toBe(false);
  });

  it('tracks live repeater ids without exposing the mutable set', () => {
    const store = createLiveFeedStore();

    store.addRepeaterId(2);
    store.addRepeaterId(3);
    store.addRepeaterId(2);

    expect(store.getRepeaterIds()).toEqual([2, 3]);
    expect(store.getRepeaterCount()).toBe(2);

    const ids = store.getRepeaterIds();
    ids.push(4);
    expect(store.getRepeaterIds()).toEqual([2, 3]);

    store.deleteRepeaterId(2);
    expect(store.getRepeaterIds()).toEqual([3]);

    store.clearRepeaterIds();
    expect(store.getRepeaterIds()).toEqual([]);
  });
});
