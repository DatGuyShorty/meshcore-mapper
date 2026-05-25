const HOST_LIMITS = new Map([
  ['api.opentopodata.org', 1],
  ['api.open-elevation.com', 1],
  ['s3.amazonaws.com', 8],
  ['overpass-api.de', 1],
  ['overpass.kumi.systems', 1],
]);

const DEFAULT_LIMIT = 4;
const queues = new Map();

export function scheduledFetch(url, init = {}) {
  const { timeoutMs, signal, ...fetchInit } = init || {};
  const host = _hostFor(url);
  return _schedule(host, () => _fetchWithTimeout(url, fetchInit, signal, timeoutMs), signal);
}

export function getRequestSchedulerSnapshot() {
  return Array.from(queues.entries()).map(([host, q]) => ({
    host,
    active: q.active,
    queued: q.items.length,
    limit: q.limit,
  }));
}

function _schedule(host, task, signal) {
  if (signal?.aborted) return Promise.reject(_abortError());
  const queue = _queueFor(host);
  return new Promise((resolve, reject) => {
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

function _drain(queue) {
  while (queue.active < queue.limit && queue.items.length) {
    const item = queue.items.shift();
    if (!item.queued) continue;
    item.queued = false;
    item.signal?.removeEventListener('abort', item.onAbort);
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

function _hostFor(url) {
  try {
    return new URL(url).host;
  } catch {
    return 'default';
  }
}

function _fetchWithTimeout(url, init, signal, timeoutMs) {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) {
    return fetch(url, { ...init, signal });
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
  const err = new Error('Cancelled');
  err.name = 'AbortError';
  err.cancelled = true;
  return err;
}
