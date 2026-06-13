export type ScheduledFetchOptions = RequestInit & {
  timeoutMs?: number;
};

export type RequestSchedulerSnapshot = {
  host: string;
  active: number;
  queued: number;
  limit: number;
};

type QueueItem = {
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
  signal: AbortSignal | null | undefined;
  queued: boolean;
  onAbort?: () => void;
};

type HostQueue = {
  host: string;
  limit: number;
  active: number;
  items: QueueItem[];
};

type CancelledError = Error & {
  cancelled?: boolean;
};

const HOST_LIMITS = new Map<string, number>([
  ['api.opentopodata.org', 1],
  ['api.open-elevation.com', 1],
  ['s3.amazonaws.com', 8],
  ['overpass-api.de', 1],
  ['overpass.kumi.systems', 1],
]);

const DEFAULT_LIMIT = 4;
const queues = new Map<string, HostQueue>();

export function scheduledFetch(url: string, init: ScheduledFetchOptions = {}): Promise<Response> {
  const { timeoutMs, signal, ...fetchInit } = init || {};
  const host = _hostFor(url);
  return _schedule(host, () => _fetchWithTimeout(url, fetchInit, signal ?? null, timeoutMs), signal ?? null);
}

export function getRequestSchedulerSnapshot(): RequestSchedulerSnapshot[] {
  return Array.from(queues.entries()).map(([host, q]) => ({
    host,
    active: q.active,
    queued: q.items.length,
    limit: q.limit,
  }));
}

function _schedule<T>(host: string, task: () => Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  if (signal?.aborted) return Promise.reject(_abortError());
  const queue = _queueFor(host);
  return new Promise((resolve, reject) => {
    const item: QueueItem = {
      task,
      resolve: resolve as (value: unknown) => void,
      reject,
      signal,
      queued: true,
    };
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

function _queueFor(host: string): HostQueue {
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

function _drain(queue: HostQueue): void {
  while (queue.active < queue.limit && queue.items.length) {
    const item = queue.items.shift();
    if (!item) return;
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

function _hostFor(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'default';
  }
}

function _fetchWithTimeout(
  url: string,
  init: RequestInit,
  signal: AbortSignal | null,
  timeoutMs: number | undefined,
): Promise<Response> {
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

function _abortError(): CancelledError {
  const err = new Error('Cancelled') as CancelledError;
  err.name = 'AbortError';
  err.cancelled = true;
  return err;
}
