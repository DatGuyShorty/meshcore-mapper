export type NodeSelectionId = string | number;

export type NodeSelectionClickState = {
  selectedNodeId?: NodeSelectionId | null;
  selectedNodeIds?: NodeSelectionId[] | null;
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

function _isModifierClick(event: NodeSelectionClickEvent): boolean {
  return Boolean(event?.shiftKey || event?.ctrlKey || event?.metaKey);
}
