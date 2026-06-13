export type JobMeta = {
  title?: string;
  backend?: string;
  warningCount?: number;
};

export type JobState = 'idle' | 'running' | 'complete';

export type JobHistoryEntry = {
  title: string;
  message: string;
  detail: string;
};

export type JobSnapshot = {
  state: JobState;
  pct: number;
  title: string;
  message: string;
  history: JobHistoryEntry[];
};

type JobStoreOptions = {
  nowMs?: () => number;
  historyLimit?: number;
};

const DEFAULT_HISTORY_LIMIT = 5;

function defaultNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function parseJobProgressMessage(msg: string | undefined): { text: string; eta: string } {
  const text = String(msg ?? '').trim();
  const match = text.match(/\s*\(ETA\s+([^)]+)\)\s*$/i);
  if (!match) return { text, eta: '' };
  return {
    text: text.slice(0, match.index).trim(),
    eta: match[1].trim(),
  };
}

export function createJobStore({ nowMs = defaultNowMs, historyLimit = DEFAULT_HISTORY_LIMIT }: JobStoreOptions = {}) {
  let active = false;
  let hasSummary = false;
  let meta: JobMeta = {};
  let baseMessage = '';
  let eta = '';
  let startedAtMs = 0;
  const history: JobHistoryEntry[] = [];

  function resetForNewJob(): void {
    meta = {};
    baseMessage = '';
    eta = '';
    startedAtMs = nowMs();
  }

  function mergeMeta(nextMeta: JobMeta | null | undefined): void {
    if (!nextMeta) return;
    if (Object.prototype.hasOwnProperty.call(nextMeta, 'title')) meta.title = String(nextMeta.title ?? '').trim();
    if (Object.prototype.hasOwnProperty.call(nextMeta, 'backend')) meta.backend = String(nextMeta.backend ?? '').trim();
    if (Object.prototype.hasOwnProperty.call(nextMeta, 'warningCount')) {
      const n = Number(nextMeta.warningCount);
      meta.warningCount = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    }
  }

  function detailsFor(state: JobState): string[] {
    const details: string[] = [];
    if (state === 'running' && eta) details.push(`ETA: ${eta}`);
    if (state !== 'idle' && startedAtMs) details.push(`Elapsed: ${formatElapsed(nowMs() - startedAtMs)}`);
    if (meta.backend) details.push(`Backend: ${meta.backend}`);
    if (meta.warningCount) {
      details.push(`${meta.warningCount} warning${meta.warningCount === 1 ? '' : 's'}`);
    }
    return details;
  }

  function displayMessage(state: JobState, msg: string): string {
    const base = msg || (state === 'running' ? 'Working...' : 'No recent job summary.');
    const details = detailsFor(state);
    return details.length ? `${base} | ${details.join(' | ')}` : base;
  }

  function snapshot(state: JobState, pct: number, msg = ''): JobSnapshot {
    return {
      state,
      pct: Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0)),
      title: meta.title || (state === 'running' ? 'Active Job' : 'Last Job'),
      message: displayMessage(state, msg),
      history: history.slice(),
    };
  }

  function setProgress(pct: number, msg?: string, nextMeta?: JobMeta): JobSnapshot {
    if (!active) resetForNewJob();
    active = true;
    hasSummary = true;
    mergeMeta(nextMeta);
    const parsed = parseJobProgressMessage(msg);
    eta = parsed.eta;
    const message = parsed.text || msg || '';
    if (message) baseMessage = message;
    return snapshot('running', pct, message);
  }

  function complete(pct: number): JobSnapshot | null {
    if (!hasSummary) {
      active = false;
      return null;
    }
    if (active) {
      const title = meta.title || 'Job';
      const message = baseMessage || 'Completed.';
      history.unshift({ title, message, detail: detailsFor('complete').join(' | ') });
      history.splice(historyLimit);
    }
    active = false;
    return snapshot('complete', pct, baseMessage);
  }

  return {
    setProgress,
    complete,
    get history(): JobHistoryEntry[] {
      return history.slice();
    },
  };
}
