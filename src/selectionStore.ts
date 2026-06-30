export type SelectionId = number | string;

export type LatLngPoint = {
  lat: number;
  lng: number;
};

export type SelectedLink = {
  kind: string;
  id: SelectionId;
};

export type OptimizerCandidate = Record<string, any>;
export type Obstacle = Record<string, any>;

export type SelectionDetail =
  | { kind: 'obstacle'; id: SelectionId | null; obstacle: Obstacle }
  | { kind: 'optimizer-candidate'; id: SelectionId | null; rank: SelectionId | null; candidate: OptimizerCandidate }
  | { kind: 'link'; linkKind: string; id: SelectionId }
  | { kind: 'nodes'; ids: SelectionId[] }
  | { kind: 'node'; id: SelectionId | null }
  | { kind: 'point'; latlng: LatLngPoint }
  | { kind: 'summary' };

export type SelectionSnapshot = {
  point: LatLngPoint | null;
  nodeId: SelectionId | null;
  nodeIds: SelectionId[];
  link: SelectedLink | null;
  optimizerCandidate: OptimizerCandidate | null;
  obstacle: Obstacle | null;
};

export function createSelectionStore() {
  let point: LatLngPoint | null = null;
  let nodeId: SelectionId | null = null;
  let nodeIds: SelectionId[] = [];
  let link: SelectedLink | null = null;
  let optimizerCandidate: OptimizerCandidate | null = null;
  let obstacle: Obstacle | null = null;

  function clear(): void {
    point = null;
    nodeId = null;
    nodeIds = [];
    link = null;
    optimizerCandidate = null;
    obstacle = null;
  }

  function snapshot(): SelectionSnapshot {
    return { point, nodeId, nodeIds: [...nodeIds], link, optimizerCandidate, obstacle };
  }

  function currentDetail(): SelectionDetail {
    if (obstacle) return { kind: 'obstacle', id: obstacle.id ?? null, obstacle };
    if (optimizerCandidate) {
      return {
        kind: 'optimizer-candidate',
        id: optimizerCandidate.rank ?? null,
        rank: optimizerCandidate.rank ?? null,
        candidate: optimizerCandidate,
      };
    }
    if (link) return { kind: 'link', linkKind: link.kind, id: link.id };
    if (nodeIds.length > 1) return { kind: 'nodes', ids: [...nodeIds] };
    if (nodeId !== null) return { kind: 'node', id: nodeId };
    if (point) return { kind: 'point', latlng: point };
    return { kind: 'summary' };
  }

  function selectPoint(latlng: LatLngPoint | null): void {
    clear();
    point = latlng;
  }

  function selectNode(id: SelectionId | null): void {
    clear();
    nodeId = id;
    nodeIds = id === null ? [] : [id];
  }

  function selectNodes(ids: SelectionId[] | null | undefined): void {
    clear();
    nodeIds = _uniqueIds(ids ?? []);
    nodeId = nodeIds.length === 1 ? nodeIds[0] : null;
  }

  function selectLink(kind: string, id: SelectionId): void {
    clear();
    link = { kind, id };
  }

  function selectOptimizerCandidate(candidate: OptimizerCandidate | null): void {
    clear();
    optimizerCandidate = candidate;
  }

  function selectObstacle(nextObstacle: Obstacle | null): void {
    clear();
    obstacle = nextObstacle;
  }

  function clearLink(): void {
    link = null;
  }

  function clearNode(): void {
    nodeId = null;
    nodeIds = [];
  }

  return {
    snapshot,
    currentDetail,
    selectPoint,
    selectNode,
    selectNodes,
    selectLink,
    selectOptimizerCandidate,
    selectObstacle,
    clearLink,
    clearNode,
  };
}

function _uniqueIds(ids: SelectionId[]): SelectionId[] {
  const seen = new Set<string>();
  const out: SelectionId[] = [];
  for (const id of ids) {
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}
