export type RepeaterPopupInput = {
  name: unknown;
  power: unknown;
  gain: unknown;
  freq: unknown;
  height: unknown;
};

export function repeaterPopupHtml({ name, power, gain, freq, height }: RepeaterPopupInput): string {
  return `<b>${_escHtml(name)}</b><br>TX: ${_escHtml(power)} dBm + ${_escHtml(gain)} dBi @ ${_escHtml(freq)} MHz<br>Ant. height: ${_escHtml(height)} m`;
}

export function wsRepeaterPopupHtml(row: Record<string, any>, name: unknown): string {
  const short = row.short ?? null;
  const lastSeen = row.last_seen ?? row.lastSeen ?? null;
  return [
    `<b>${_escHtml(name)}</b>`,
    short ? `ID: <code>${_escHtml(short)}</code>` : null,
    lastSeen ? `Last seen: ${_escHtml(lastSeen)}` : null,
  ].filter(Boolean).join('<br>');
}

export function repeaterContextMenuHtml(): string {
  return `
    <div class="ctx-item" data-ctx="info">Info</div>
    <div class="ctx-item" data-ctx="p2p">P2P Link</div>
    <div class="ctx-item" data-ctx="edit">Edit</div>
    <div class="ctx-item" data-ctx="vis"></div>
    <div class="ctx-separator"></div>
    <div class="ctx-item" data-ctx="coverage">Run Coverage</div>
    <div class="ctx-item" data-ctx="optimize">Optimize Here</div>
    <div class="ctx-item" data-ctx="pathfrom">Best Path From...</div>
    <div class="ctx-separator"></div>
    <div class="ctx-item ctx-danger" data-ctx="delete">Remove</div>
  `;
}

function _escHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
