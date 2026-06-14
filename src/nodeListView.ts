import { nodeHealth, type NodeHealthState } from './liveHealth.js';

export type NodeListRow =
  | { kind: 'empty'; text: string }
  | {
    kind: 'node';
    repeater: any;
    id: string;
    className: string;
    color: string;
    name: string;
    subText: string;
    healthState: NodeHealthState;
    healthLabel: string;
    visible: boolean;
    visibilityTitle: string;
    visibilityText: string;
  };

export type NodeListOptions = {
  filterText?: string;
  sortMode?: string;
  selectedNodeId?: string | number | null;
  editingId?: string | number | null;
  now?: number | string | Date;
};

export function buildNodeListRows(repeaters: any[], options: NodeListOptions = {}): NodeListRow[] {
  const nodes = Array.isArray(repeaters) ? repeaters : [];
  const filterText = String(options.filterText ?? '').trim().toLowerCase();
  const sortMode = options.sortMode ?? 'name-az';
  const visibleRows = nodes
    .filter(repeater => _matchesFilter(repeater, filterText))
    .sort((a, b) => {
      if (sortMode === 'name-az') return String(a?.name ?? '').localeCompare(String(b?.name ?? ''));
      if (sortMode === 'name-za') return String(b?.name ?? '').localeCompare(String(a?.name ?? ''));
      return 0;
    });

  if (visibleRows.length === 0) {
    return [{
      kind: 'empty',
      text: nodes.length === 0 ? 'No repeaters added yet.' : 'No nodes match the filter.',
    }];
  }

  return visibleRows.map(repeater => _nodeRow(repeater, options));
}

export function renderNodeList(container: HTMLElement, repeaters: any[], options: NodeListOptions = {}): void {
  container.innerHTML = buildNodeListRows(repeaters, options)
    .map(row => row.kind === 'empty' ? _emptyRowHtml(row) : _nodeRowHtml(row))
    .join('');
}

function _matchesFilter(repeater: any, filterText: string): boolean {
  if (!filterText) return true;
  return [
    repeater?.name,
    `${_fixed(repeater?.lat, 5)}, ${_fixed(repeater?.lon, 5)}`,
    `${repeater?.height} ${repeater?.power} ${repeater?.freq} ${repeater?.gain}`,
    repeater?.short ?? '',
    repeater?.lastSeen ?? '',
  ].join(' ').toLowerCase().includes(filterText);
}

function _nodeRow(repeater: any, options: NodeListOptions): Extract<NodeListRow, { kind: 'node' }> {
  const visible = repeater?.visible !== false;
  const id = String(repeater?.id ?? '');
  const classes = ['repeater-item'];
  if (!visible) classes.push('ri-hidden');
  if (_sameId(options.selectedNodeId, repeater?.id)) classes.push('ri-selected');
  if (_sameId(options.editingId, repeater?.id)) classes.push('editing');
  const health = nodeHealth(repeater, { now: options.now });
  classes.push(health.className);
  return {
    kind: 'node',
    repeater,
    id,
    className: classes.join(' '),
    color: String(repeater?.color ?? '#61dafb'),
    name: String(repeater?.name ?? 'Node'),
    subText: _nodeSubText(repeater, health.detail),
    healthState: health.state,
    healthLabel: health.label,
    visible,
    visibilityTitle: visible ? 'Hide' : 'Show',
    visibilityText: visible ? 'On' : 'Off',
  };
}

function _nodeSubText(repeater: any, healthDetail: string): string {
  if (repeater?.fromWs && repeater?.lastSeen) {
    return `${_fixed(repeater?.lat, 4)}, ${_fixed(repeater?.lon, 4)} \u00b7 ${healthDetail}`;
  }
  if (repeater?.fromWs) return `${_fixed(repeater?.lat, 4)}, ${_fixed(repeater?.lon, 4)} \u00b7 ${healthDetail}`;
  return `${_fixed(repeater?.lat, 4)}, ${_fixed(repeater?.lon, 4)} \u00b7 ${repeater?.height}m \u00b7 ${repeater?.power}dBm+${repeater?.gain}dBi \u00b7 ${repeater?.freq}MHz`;
}

function _emptyRowHtml(row: Extract<NodeListRow, { kind: 'empty' }>): string {
  return `<li class="empty-msg">${_escHtml(row.text)}</li>`;
}

function _nodeRowHtml(row: Extract<NodeListRow, { kind: 'node' }>): string {
  return `
    <li class="${_escHtml(row.className)}" data-id="${_escHtml(row.id)}">
      <div class="ri-color" style="background:${_escHtml(row.color)}"></div>
      <div class="ri-info">
        <div class="ri-name">${_escHtml(row.name)}</div>
        <div class="ri-coords">${_escHtml(row.subText)}</div>
      </div>
      <span class="ri-health" data-health="${_escHtml(row.healthState)}">${_escHtml(row.healthLabel)}</span>
      <button class="ri-vis" data-action="toggle-vis" data-id="${_escHtml(row.id)}" title="${_escHtml(row.visibilityTitle)}">${_escHtml(row.visibilityText)}</button>
      <button class="ri-edit" data-action="edit" data-id="${_escHtml(row.id)}" title="Edit">\u270e</button>
      <button class="ri-del"  data-action="delete" data-id="${_escHtml(row.id)}" title="Remove">\u00d7</button>
    </li>`;
}

function _fixed(value: unknown, digits: number): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : 'NaN';
}

function _sameId(left: unknown, right: unknown): boolean {
  return left !== null && left !== undefined && right !== null && right !== undefined
    && String(left) === String(right);
}

function _escHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
