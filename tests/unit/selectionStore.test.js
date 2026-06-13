import { describe, expect, it } from 'vitest';
import { createSelectionStore } from '../../src/selectionStore.js';

describe('selection store', () => {
  it('starts with a summary selection', () => {
    const store = createSelectionStore();
    expect(store.currentDetail()).toEqual({ kind: 'summary' });
    expect(store.snapshot()).toMatchObject({
      point: null,
      nodeId: null,
      link: null,
      optimizerCandidate: null,
      obstacle: null,
    });
  });

  it('selects one object kind at a time', () => {
    const store = createSelectionStore();

    store.selectPoint({ lat: 48, lng: 18 });
    expect(store.currentDetail()).toEqual({ kind: 'point', latlng: { lat: 48, lng: 18 } });

    store.selectNode(7);
    expect(store.currentDetail()).toEqual({ kind: 'node', id: 7 });
    expect(store.snapshot().point).toBeNull();

    store.selectLink('p2p', 'active-p2p');
    expect(store.currentDetail()).toEqual({ kind: 'link', linkKind: 'p2p', id: 'active-p2p' });
    expect(store.snapshot().nodeId).toBeNull();
  });

  it('derives candidate and obstacle details with the expected priority', () => {
    const store = createSelectionStore();

    const candidate = { rank: 2, lat: 48, lon: 18 };
    store.selectOptimizerCandidate(candidate);
    expect(store.currentDetail()).toEqual({
      kind: 'optimizer-candidate',
      id: 2,
      rank: 2,
      candidate,
    });

    const obstacle = { id: 'building:1', category: 'building' };
    store.selectObstacle(obstacle);
    expect(store.currentDetail()).toEqual({
      kind: 'obstacle',
      id: 'building:1',
      obstacle,
    });
    expect(store.snapshot().optimizerCandidate).toBeNull();
  });

  it('clears stale link and node selections independently', () => {
    const store = createSelectionStore();

    store.selectLink('path', 'relay-1');
    store.clearLink();
    expect(store.currentDetail()).toEqual({ kind: 'summary' });

    store.selectNode('node-a');
    store.clearNode();
    expect(store.currentDetail()).toEqual({ kind: 'summary' });
  });
});
