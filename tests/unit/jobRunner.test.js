import { describe, expect, it, vi } from 'vitest';
import { createAbortError, isAbortLikeError, runFallbackJob } from '../../src/jobRunner.js';

function runnerOptions(overrides = {}) {
  return {
    backends: ['cuda', 'cpu'],
    isUnsupported: result => result?.unsupported === true,
    describeUnsupported: (backend, result) => `${backend}: ${result.message}`,
    describeError: (backend, error) => `${backend}: ${error.message}`,
    allFailedMessage: errors => `all failed: ${errors.join('; ')}`,
    ...overrides,
  };
}

describe('job runner', () => {
  it('returns the first supported backend result', async () => {
    const runBackend = vi.fn(async backend => backend === 'cuda'
      ? { unsupported: true, message: 'not supported' }
      : { ok: true, backend });

    await expect(runFallbackJob(runnerOptions({ runBackend }))).resolves.toEqual({
      ok: true,
      backend: 'cpu',
    });
    expect(runBackend).toHaveBeenCalledTimes(2);
  });

  it('collects unsupported and failed backend messages', async () => {
    const onBackendError = vi.fn();
    const runBackend = vi.fn(async backend => {
      if (backend === 'cuda') return { unsupported: true, message: 'not supported' };
      throw new Error('worker failed');
    });

    await expect(runFallbackJob(runnerOptions({ runBackend, onBackendError })))
      .rejects.toThrow('all failed: cuda: not supported; cpu: worker failed');
    expect(onBackendError).toHaveBeenCalledWith('cpu', expect.any(Error));
  });

  it('throws a shared abort error before launching backends', async () => {
    const controller = new AbortController();
    controller.abort();
    const runBackend = vi.fn();

    await expect(runFallbackJob(runnerOptions({ signal: controller.signal, runBackend })))
      .rejects.toMatchObject({ name: 'AbortError', cancelled: true });
    expect(runBackend).not.toHaveBeenCalled();
  });

  it('detects abort-like errors', () => {
    expect(isAbortLikeError(createAbortError())).toBe(true);
    expect(isAbortLikeError(Object.assign(new Error('x'), { cancelled: true }))).toBe(true);
    expect(isAbortLikeError(new Error('x'))).toBe(false);
  });
});
