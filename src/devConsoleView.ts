export type ConsoleLevel = 'log' | 'warn' | 'error' | 'info' | 'debug';

export type ConsoleEntry = {
  level: ConsoleLevel;
  msg: string;
  time: string;
};

type DevConsoleDocumentLike = Pick<Document, 'createElement'>;

export function createConsoleEntryRow(entry: ConsoleEntry, doc: DevConsoleDocumentLike = document): HTMLElement {
  const row = doc.createElement('div');
  row.className = `dc-row dc-${entry.level}`;
  row.textContent = `[${entry.time}] ${entry.msg}`;
  return row;
}

export function appendConsoleEntry(
  output: HTMLElement,
  entry: ConsoleEntry,
  maxEntries: number,
  doc: DevConsoleDocumentLike = document,
): void {
  output.appendChild(createConsoleEntryRow(entry, doc));
  while (output.childElementCount > maxEntries && output.firstChild) {
    output.removeChild(output.firstChild);
  }
  output.scrollTop = output.scrollHeight;
}

export function clearConsoleOutput(output: HTMLElement): void {
  output.innerHTML = '';
}

export function toggleDevConsoleCollapsed(body: HTMLElement, button: HTMLElement): boolean {
  const collapsed = body.classList.toggle('hidden');
  button.textContent = collapsed ? 'Up' : 'Down';
  return collapsed;
}
