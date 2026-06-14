export type NodeHealthState = 'planned' | 'live' | 'stale' | 'missing';

export type NodeHealthInput = {
  fromWs?: boolean;
  lastSeen?: string | number | null;
};

export type NodeHealth = {
  state: NodeHealthState;
  label: string;
  detail: string;
  ageMs: number | null;
  className: string;
};

export type LiveHealthSummary = {
  planned: number;
  live: number;
  stale: number;
  missing: number;
  text: string;
  alert: boolean;
};

export type NodeHealthOptions = {
  now?: number | string | Date;
  staleAfterMs?: number;
};

const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000;

export function nodeHealth(node: NodeHealthInput | null | undefined, options: NodeHealthOptions = {}): NodeHealth {
  if (!node?.fromWs) {
    return health('planned', 'Planned', 'manual node', null);
  }

  const now = timeMs(options.now ?? Date.now());
  const seen = timeMs(node.lastSeen);
  if (!Number.isFinite(seen)) {
    return health('missing', 'Missing', 'no live timestamp', null);
  }

  const ageMs = Math.max(0, now - seen);
  const staleAfterMs = Number.isFinite(Number(options.staleAfterMs))
    ? Number(options.staleAfterMs)
    : DEFAULT_STALE_AFTER_MS;
  if (ageMs > staleAfterMs) {
    return health('stale', 'Stale', `seen ${formatAge(ageMs)} ago`, ageMs);
  }
  return health('live', 'Live', `seen ${formatAge(ageMs)} ago`, ageMs);
}

export function liveHealthSummary(nodes: NodeHealthInput[], options: NodeHealthOptions = {}): LiveHealthSummary {
  const counts = { planned: 0, live: 0, stale: 0, missing: 0 };
  for (const node of Array.isArray(nodes) ? nodes : []) {
    counts[nodeHealth(node, options).state] += 1;
  }
  const alert = counts.stale > 0 || counts.missing > 0;
  return {
    ...counts,
    alert,
    text: `${counts.live} live, ${counts.stale} stale, ${counts.missing} missing timestamp, ${counts.planned} planned`,
  };
}

function health(state: NodeHealthState, label: string, detail: string, ageMs: number | null): NodeHealth {
  return {
    state,
    label,
    detail,
    ageMs,
    className: `ri-${state}`,
  };
}

function timeMs(value: string | number | Date | null | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return timeMs(numeric);
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function formatAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
