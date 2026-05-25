import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyScenarioProfile } from '../../src/scenarios.js';

describe('scenario profiles', () => {
  const originalDocument = globalThis.document;
  let elements;

  beforeEach(() => {
    elements = new Map();
    globalThis.document = {
      getElementById: id => elements.get(id) ?? null,
    };
    for (const id of [
      'grid-res',
      'obstacle-height-mode',
      'compute-backend',
      'compute-worker-count',
      'dataset-batch-concurrency',
      'dem-tile-concurrency',
      'foliage-tile-concurrency',
      'building-tile-concurrency',
    ]) {
      elements.set(id, control(''));
    }
    for (const id of ['use-los', 'use-fresnel', 'use-foliage', 'use-buildings']) {
      elements.set(id, control(false, 'checkbox'));
    }
  });

  afterEach(() => {
    globalThis.document = originalDocument;
  });

  it('keeps the offline profile CUDA-first through auto backend selection', () => {
    elements.get('compute-backend').value = 'cpu';

    applyScenarioProfile('offline');

    expect(elements.get('compute-backend').value).toBe('auto');
  });

  function control(value, type = 'select') {
    return {
      type,
      value,
      checked: Boolean(value),
      dispatchEvent() {},
    };
  }
});
