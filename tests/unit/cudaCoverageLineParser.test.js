import { describe, expect, it, vi } from 'vitest';
import { _consumePythonLines } from '../../src/main/cudaCoverage.js';

describe('_consumePythonLines', () => {
  it('routes progress messages to onProgress and keeps the last non-progress message', () => {
    const onProgress = vi.fn();
    const onStrayLine = vi.fn();
    const state = { lastMessage: null };

    _consumePythonLines([
      JSON.stringify({ type: 'progress', stage: 'fetch', pct: 0.2 }),
      JSON.stringify({ type: 'progress', stage: 'compute', pct: 0.6 }),
      JSON.stringify({ ok: true, summary: 'done' }),
    ], state, { onProgress, onStrayLine });

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, expect.objectContaining({ pct: 0.2 }));
    expect(onStrayLine).not.toHaveBeenCalled();
    expect(state.lastMessage).toEqual({ ok: true, summary: 'done' });
  });

  it('tolerates stray non-JSON lines without abandoning a valid lastMessage', () => {
    const onProgress = vi.fn();
    const onStrayLine = vi.fn();
    const state = { lastMessage: null };

    _consumePythonLines([
      JSON.stringify({ ok: true, summary: 'first valid' }),
      'Traceback (most recent call last):',
      '  File "...", line 42, in main',
      JSON.stringify({ ok: true, summary: 'second valid' }),
      '[INFO] benign log noise',
    ], state, { onProgress, onStrayLine });

    expect(onProgress).not.toHaveBeenCalled();
    expect(onStrayLine).toHaveBeenCalledTimes(3);
    // Final non-progress JSON wins.
    expect(state.lastMessage).toEqual({ ok: true, summary: 'second valid' });
  });

  it('skips blank / whitespace-only lines silently', () => {
    const onProgress = vi.fn();
    const onStrayLine = vi.fn();
    const state = { lastMessage: null };

    _consumePythonLines(['', '   ', '\t', JSON.stringify({ ok: true })], state, {
      onProgress,
      onStrayLine,
    });

    expect(onStrayLine).not.toHaveBeenCalled();
    expect(state.lastMessage).toEqual({ ok: true });
  });

  it('works without callbacks', () => {
    const state = { lastMessage: null };
    expect(() => _consumePythonLines([
      JSON.stringify({ type: 'progress', pct: 0.5 }),
      'stray',
      JSON.stringify({ ok: true }),
    ], state)).not.toThrow();
    expect(state.lastMessage).toEqual({ ok: true });
  });

  it('keeps the lastMessage from before stray lines if no later JSON appears', () => {
    const state = { lastMessage: null };
    _consumePythonLines([
      JSON.stringify({ ok: true, summary: 'kept' }),
      'random debug output appended after the real result',
    ], state);
    expect(state.lastMessage).toEqual({ ok: true, summary: 'kept' });
  });
});
