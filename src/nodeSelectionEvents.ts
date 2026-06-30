export type NodeSelectionId = string | number;

export type NodeSelectionClickState = {
  selectedNodeId?: NodeSelectionId | null;
  selectedNodeIds?: NodeSelectionId[] | null;
  selectionAnchorId?: NodeSelectionId | null;
  orderedNodeIds?: NodeSelectionId[] | null;
};

export type NodeSelectionClickEvent = {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
} | null | undefined;

export type NodeSelectionEventPlan =
  | { type: 'node:selected'; detail: { id: NodeSelectionId } }
  | { type: 'nodes:selected'; detail: { ids: string[] } };

export function nodeSelectionEventForClick(
  id: NodeSelectionId | null | undefined,
  event: NodeSelectionClickEvent,
  state: NodeSelectionClickState = {},
): NodeSelectionEventPlan | null {
  if (id === null || id === undefined) return null;
  if (!_isModifierClick(event)) return { type: 'node:selected', detail: { id } };
  if (event?.shiftKey) {
    const rangeIds = rangeNodeSelectionIds(id, state);
    if (rangeIds.length) {
      return {
        type: 'nodes:selected',
        detail: { ids: rangeIds },
      };
    }
  }
  return {
    type: 'nodes:selected',
    detail: { ids: toggleNodeSelectionId(id, state) },
  };
}

export function toggleNodeSelectionId(
  id: NodeSelectionId,
  { selectedNodeId = null, selectedNodeIds = [] }: NodeSelectionClickState = {},
): string[] {
  const selected = new Set<string>();
  if (selectedNodeId !== null && selectedNodeId !== undefined) selected.add(String(selectedNodeId));
  for (const selectedId of selectedNodeIds ?? []) selected.add(String(selectedId));
  const key = String(id);
  if (selected.has(key)) selected.delete(key);
  else selected.add(key);
  return [...selected];
}

export function rangeNodeSelectionIds(
  id: NodeSelectionId,
  { selectionAnchorId = null, orderedNodeIds = [] }: NodeSelectionClickState = {},
): string[] {
  if (selectionAnchorId === null || selectionAnchorId === undefined) return [];
  const ordered = (orderedNodeIds ?? []).map(String);
  const anchorIndex = ordered.indexOf(String(selectionAnchorId));
  const targetIndex = ordered.indexOf(String(id));
  if (anchorIndex === -1 || targetIndex === -1) return [];
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return ordered.slice(start, end + 1);
}

function _isModifierClick(event: NodeSelectionClickEvent): boolean {
  return Boolean(event?.shiftKey || event?.ctrlKey || event?.metaKey);
}
