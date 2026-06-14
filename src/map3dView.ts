export type Map3dDocumentLike = Pick<Document, 'getElementById'> & {
  fullscreenElement?: Element | null;
  exitFullscreen?: () => Promise<void> | void;
};

export type Map3dSceneStats = {
  buildings?: unknown;
  foliage?: unknown;
  nodes?: unknown;
  coverage?: unknown;
  links?: unknown;
};

export type SetButtonBusy = (id: string, busy: boolean, busyText?: string) => void;

export const MAP3D_REFRESH_BUTTON_IDS = ['btn-refresh-3d', 'btn-map3d-refresh'] as const;

export function applyMap3dModeView(active: boolean, doc: Map3dDocumentLike = document): void {
  const mapContainer = doc.getElementById('map-container');
  const panel = doc.getElementById('map3d');
  const btn2d = doc.getElementById('btn-view-2d');
  const btn3d = doc.getElementById('btn-view-3d');

  mapContainer?.classList.toggle('map3d-active', active);
  panel?.classList.toggle('hidden', !active);
  btn2d?.classList.toggle('active', !active);
  btn3d?.classList.toggle('active', active);
  btn2d?.setAttribute('aria-pressed', String(!active));
  btn3d?.setAttribute('aria-pressed', String(active));
}

export function setMap3dRefreshBusy(busy: boolean, setButtonBusy: SetButtonBusy): void {
  for (const id of MAP3D_REFRESH_BUTTON_IDS) {
    setButtonBusy(id, busy, busy ? 'Loading...' : undefined);
  }
}

export function writeMap3dFocusAttrs(
  { label, pointCount }: { label: string; pointCount: number },
  doc: Map3dDocumentLike = document,
): void {
  const panel = doc.getElementById('map3d');
  panel?.setAttribute('data-focus-label', label);
  panel?.setAttribute('data-focus-points', String(pointCount));
}

export function writeMap3dTerrainAttrs(
  {
    ready,
    tileCount,
    terrainSource,
  }: {
    ready: 'preview' | 'terrain';
    tileCount?: unknown;
    terrainSource?: unknown;
  },
  doc: Map3dDocumentLike = document,
): void {
  const panel = doc.getElementById('map3d');
  if (!panel) return;
  panel.setAttribute('data-ready', ready);
  if (tileCount !== undefined) panel.setAttribute('data-terrain-tiles', String(tileCount));
  if (terrainSource !== undefined) panel.setAttribute('data-terrain-source', String(terrainSource));
}

export function writeMap3dSceneStats(stats: Map3dSceneStats, doc: Map3dDocumentLike = document): void {
  const panel = doc.getElementById('map3d');
  if (!panel) return;
  panel.setAttribute('data-buildings-count', String(_count(stats.buildings)));
  panel.setAttribute('data-foliage-count', String(_count(stats.foliage)));
  panel.setAttribute('data-nodes-count', String(_count(stats.nodes)));
  panel.setAttribute('data-coverage-count', String(_count(stats.coverage)));
  panel.setAttribute('data-p2p-links-count', String(_count(stats.links)));
}

export function writeMap3dRetileCount(count: number, doc: Map3dDocumentLike = document): void {
  doc.getElementById('map3d')?.setAttribute('data-retile-count', String(Math.max(0, Math.round(count))));
}

export function toggleMap3dFullscreen(doc: Map3dDocumentLike = document): 'enter' | 'exit' | 'missing' {
  const host = doc.getElementById('map-container') as (HTMLElement & {
    requestFullscreen?: () => Promise<void> | void;
  }) | null;
  if (!host) return 'missing';
  if (doc.fullscreenElement) {
    void doc.exitFullscreen?.();
    return 'exit';
  }
  void host.requestFullscreen?.();
  return 'enter';
}

function _count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}
