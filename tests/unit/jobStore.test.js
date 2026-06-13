import { describe, expect, it } from 'vitest';
import { createJobStore, formatElapsed, parseJobProgressMessage } from '../../src/jobStore.js';

describe('job store helpers', () => {
  it('formats elapsed time for drawer details', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(250)).toBe('250ms');
    expect(formatElapsed(2500)).toBe('2.5s');
    expect(formatElapsed(12_000)).toBe('12s');
    expect(formatElapsed(65_000)).toBe('1m 5s');
  });

  it('extracts ETA suffixes from progress messages', () => {
    expect(parseJobProgressMessage('terrain tiles 3/9 (ETA 12s)')).toEqual({
      text: 'terrain tiles 3/9',
      eta: '12s',
    });
    expect(parseJobProgressMessage('plain message')).toEqual({ text: 'plain message', eta: '' });
  });

  it('creates running and completion snapshots with metadata', () => {
    let now = 1000;
    const store = createJobStore({ nowMs: () => now });

    const running = store.setProgress(42, 'loading (ETA 2s)', {
      title: 'Coverage: Alpha',
      backend: 'CPU worker',
      warningCount: 1,
    });

    expect(running).toMatchObject({
      state: 'running',
      pct: 42,
      title: 'Coverage: Alpha',
      message: 'loading | ETA: 2s | Elapsed: 0s | Backend: CPU worker | 1 warning',
    });

    now += 1500;
    const complete = store.complete(42);
    expect(complete).toMatchObject({
      state: 'complete',
      pct: 42,
      title: 'Coverage: Alpha',
      message: 'loading | Elapsed: 1.5s | Backend: CPU worker | 1 warning',
    });
    expect(store.history).toEqual([{
      title: 'Coverage: Alpha',
      message: 'loading',
      detail: 'Elapsed: 1.5s | Backend: CPU worker | 1 warning',
    }]);
  });

  it('caps history newest-first', () => {
    let now = 1000;
    const store = createJobStore({ nowMs: () => now, historyLimit: 3 });

    for (let i = 1; i <= 4; i++) {
      store.setProgress(100, `done ${i}`, { title: `Job ${i}` });
      now += 100;
      store.complete(100);
    }

    expect(store.history.map(entry => entry.title)).toEqual(['Job 4', 'Job 3', 'Job 2']);
  });
});
