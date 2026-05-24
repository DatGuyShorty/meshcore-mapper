import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCoverageSettings } from '../../src/settings.js';

describe('coverage settings parsing', () => {
  const originalDocument = globalThis.document;
  let elements;

  beforeEach(() => {
    elements = new Map();
    globalThis.document = {
      getElementById: id => elements.get(id) ?? null,
    };
  });

  afterEach(() => {
    globalThis.document = originalDocument;
  });

  it('parses backend and obstacle-height controls', () => {
    setValue('scenario-profile', 'urban');
    setValue('compute-backend', 'cuda');
    setValue('obstacle-height-mode', 'dsm-dem');
    setValue('grid-res', '2');
    setValue('rx-height', '1.5');
    setValue('rx-sensitivity', '-137');
    setValue('fade-margin', '10');
    setValue('analysis-radius', '15');
    setChecked('use-los', true);
    setChecked('use-fresnel', true);
    setChecked('use-foliage', true);
    setChecked('use-buildings', true);
    setValue('foliage-loss-per-m', '0.3');
    setValue('building-loss-per-m', '0.5');
    setValue('compute-worker-count', '9');
    setValue('dataset-batch-concurrency', '3');
    setValue('dem-tile-concurrency', '8');
    setValue('foliage-tile-concurrency', '4');
    setValue('building-tile-concurrency', '4');

    const settings = getCoverageSettings();
    expect(settings.computeBackend).toBe('cuda');
    expect(settings.deriveObstacleHeights).toBe(true);
    expect(settings.computeWorkerCount).toBe(8);
    expect(settings.qualityMult).toBe(2);
  });

  function setValue(id, value) {
    elements.set(id, { value });
  }

  function setChecked(id, checked) {
    elements.set(id, { checked });
  }
});
