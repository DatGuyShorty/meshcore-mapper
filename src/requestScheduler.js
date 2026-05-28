// @ts-check
/**
 * Per-host fetch queue. Each upstream host gets its own concurrency cap
 * (Overpass is single-shot, OpenTopoData/OpenElevation are single-shot,
 * S3 DEM tiles can run 8-wide). Requests over the limit queue and drain
 * as in-flight ones complete, with proper abort + timeout support.
 *
 * @typedef {Object} _QueueItem
 * @property {() => Promise<any>} task
 * @property {(value: any) => void} resolve
 * @property {(err: any) => void} reject
 * @property {AbortSignal | null | undefined} signal
 * @property {boolean} queued
 * @property {(() => void)} [onAbort]
 *
 * @typedef {Object} _HostQueue
 * @property {string} host
 * @property {number} limit
 * @property {number} active
 * @property {_QueueItem[]} items
 */

const HOST_LIMITS = new Map([
  ['api.opentopodata.org', 1],
  ['api.open-elevation.com', 1],
  ['s3.amazonaws.com', 8],
  ['overpass-api.de', 1],
  ['overpass.kumi.systems', 1],
]);

const DEFAULT_LIMIT = 4;
/** @type {Map<string, _HostQueue>} */
const queues = new Map();

/**
 * @param {string} url
 * @param {(RequestInit & { timeoutMs?: number }) | undefined} [init]
 * @returns {Promise<Response>}
 */
export function scheduledFetch(url, init = {}) {
  const { timeoutMs, signal, ...fetchInit } = init || {};
  const host = _hostFor(url);
  return _schedule(host, () => _fetchWithTimeout(url, fetchInit, signal ?? null, timeoutMs), signal ?? null);
}

export function getRequestSchedulerSnapshot() {
  return Array.from(queues.entries()).map(([host, q]) => ({
    host,
    active: q.active,
    queued: q.items.length,
    limit: q.limit,
  }));
}

/**
 * @template T
 * @param {string} host
 * @param {() => Promise<T>} task
 * @param {AbortSignal | null | undefined} signal
 * @returns {Promise<T>}
 */
function _schedule(host, task, signal) {
  if (signal?.aborted) return Promise.reject(_abortError());
  const queue = _queueFor(host);
  return new Promise((resolve, reject) => {
    /** @type {_QueueItem} */
    const item = { task, resolve, reject, signal, queued: true };
    const onAbort = () => {
      if (!item.queued) return;
      item.queued = false;
      const idx = queue.items.indexOf(item);
      if (idx !== -1) queue.items.splice(idx, 1);
      reject(_abortError());
    };
    item.onAbort = onAbort;
    signal?.addEventListener('abort', onAbort, { once: true });
    queue.items.push(item);
    _drain(queue);
  });
}

/**
 * @param {string} host
 * @returns {_HostQueue}
 */
function _queueFor(host) {
  let queue = queues.get(host);
  if (!queue) {
    queue = {
      host,
      limit: HOST_LIMITS.get(host) ?? DEFAULT_LIMIT,
      active: 0,
      items: [],
    };
    queues.set(host, queue);
  }
  return queue;
}

/** @param {_HostQueue} queue */
function _drain(queue) {
  while (queue.active < queue.limit && queue.items.length) {
    const item = /** @type {_QueueItem} */ (queue.items.shift());
    if (!item.queued) continue;
    item.queued = false;
    if (item.onAbort) item.signal?.removeEventListener('abort', item.onAbort);
    queue.active++;
    Promise.resolve()
      .then(item.task)
      .then(item.resolve, item.reject)
      .finally(() => {
        queue.active--;
        _drain(queue);
      });
  }
}

/** @param {string} url */
function _hostFor(url) {
  try {
    return new URL(url).host;
  } catch {
    return 'default';
  }
}

/**
 * @param {string} url
 * @param {RequestInit} init
 * @param {AbortSignal | null} signal
 * @param {number | undefined} timeoutMs
 */
function _fetchWithTimeout(url, init, signal, timeoutMs) {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) {
    return fetch(url, { ...init, signal: signal ?? undefined });
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), ms);

  return fetch(url, { ...init, signal: controller.signal })
    .finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    });
}

function _abortError() {
  const err = /** @type {Error & { cancelled?: boolean }} */ (new Error('Cancelled'));
  err.name = 'AbortError';
  err.cancelled = true;
  return err;
}
