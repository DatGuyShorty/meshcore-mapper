import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRequestSchedulerSnapshot, scheduledFetch } from '../../src/requestScheduler.js';

describe('request scheduler', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('runs scheduled fetches and exposes queue state', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 }));

    const result = await scheduledFetch('not a valid url');
    await Promise.resolve();
    const snapshot = getRequestSchedulerSnapshot().find(q => q.host === 'default');

    expect(result).toEqual({ ok: true, status: 200 });
    expect(globalThis.fetch).toHaveBeenCalledWith('not a valid url', {});
    expect(snapshot).toMatchObject({ host: 'default', active: 0, queued: 0, limit: 4 });
  });

  it('rejects aborted requests before enqueueing work', async () => {
    globalThis.fetch = vi.fn();
    const controller = new AbortController();
    controller.abort();

    await expect(scheduledFetch('https://example.com', { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError', cancelled: true });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
