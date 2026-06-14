export type OfflinePrepArea = {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
};

export type OfflinePrepReadinessState = 'needs-prep' | 'running' | 'ready' | 'warning' | 'skipped';

export type OfflinePrepReadiness = {
  terrain: OfflinePrepReadinessState;
  foliage: OfflinePrepReadinessState;
  buildings: OfflinePrepReadinessState;
  mapTiles: OfflinePrepReadinessState;
};

export type OfflinePrepReadinessRow = {
  label: string;
  value: string;
};

const READINESS_TEXT: Record<OfflinePrepReadinessState, string> = {
  'needs-prep': 'needs prep',
  running: 'preparing',
  ready: 'ready',
  warning: 'needs internet',
  skipped: 'online only',
};

export const DEFAULT_OFFLINE_PREP_READINESS: OfflinePrepReadiness = {
  terrain: 'needs-prep',
  foliage: 'needs-prep',
  buildings: 'needs-prep',
  mapTiles: 'skipped',
};

export function normalizeOfflinePrepArea(value: Partial<OfflinePrepArea> | null | undefined): OfflinePrepArea | null {
  const latMin = Number(value?.latMin);
  const latMax = Number(value?.latMax);
  const lonMin = Number(value?.lonMin);
  const lonMax = Number(value?.lonMax);
  if (![latMin, latMax, lonMin, lonMax].every(Number.isFinite)) return null;
  if (latMax <= latMin || lonMax <= lonMin) return null;
  return { latMin, latMax, lonMin, lonMax };
}

export function formatOfflinePrepArea(area: OfflinePrepArea | null | undefined): string {
  if (!area) return 'Area: choose current viewport';
  return `Area: ${formatCoord(area.latMin)} to ${formatCoord(area.latMax)} lat, ${formatCoord(area.lonMin)} to ${formatCoord(area.lonMax)} lon`;
}

export function offlinePrepReadinessRows(readiness: OfflinePrepReadiness = DEFAULT_OFFLINE_PREP_READINESS): OfflinePrepReadinessRow[] {
  return [
    { label: 'Terrain DEM', value: READINESS_TEXT[readiness.terrain] },
    { label: 'Foliage', value: READINESS_TEXT[readiness.foliage] },
    { label: 'Buildings', value: READINESS_TEXT[readiness.buildings] },
    { label: 'Map tiles', value: READINESS_TEXT[readiness.mapTiles] },
  ];
}

export function formatOfflinePrepReadiness(readiness: OfflinePrepReadiness = DEFAULT_OFFLINE_PREP_READINESS): string {
  return offlinePrepReadinessRows(readiness)
    .map(row => `${row.label}: ${row.value}`)
    .join(' | ');
}

export function offlinePrepSummary(area: OfflinePrepArea | null | undefined, readiness: OfflinePrepReadiness): string {
  return `${formatOfflinePrepArea(area)}. ${formatOfflinePrepReadiness(readiness)}`;
}

function formatCoord(value: number): string {
  return value.toFixed(5);
}
