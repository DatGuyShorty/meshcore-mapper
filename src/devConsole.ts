export type ConsoleLevel = 'log' | 'warn' | 'error' | 'info' | 'debug';

export type ConsoleEntry = {
  level: ConsoleLevel;
  msg: string;
  time: string;
};

type ConsoleMethod = (...args: unknown[]) => void;

const MAX_ENTRIES = 200;
const entries: ConsoleEntry[] = [];
let _output: HTMLElement | null = null;

const _orig: Record<ConsoleLevel, ConsoleMethod> = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
  debug: console.debug.bind(console),
};

function formatArg(arg: unknown): string {
  if (arg instanceof Error) return arg.stack || arg.message;
  if (typeof arg === 'object' && arg !== null) {
    try {
      return JSON.stringify(arg);
    } catch {}
  }
  return String(arg);
}

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

function append(level: ConsoleLevel, args: unknown[]): void {
  const entry = { level, msg: args.map(formatArg).join(' '), time: timestamp() };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  if (_output) renderEntry(entry);
}

const LEVELS: ConsoleLevel[] = ['log', 'warn', 'error', 'info', 'debug'];
LEVELS.forEach(level => {
  console[level] = (...args: unknown[]) => {
    _orig[level](...args);
    append(level, args);
  };
});

function renderEntry(entry: ConsoleEntry): void {
  if (!_output) return;
  const row = document.createElement('div');
  row.className = `dc-row dc-${entry.level}`;
  row.textContent = `[${entry.time}] ${entry.msg}`;
  _output.appendChild(row);
  while (_output.childElementCount > MAX_ENTRIES && _output.firstChild) {
    _output.removeChild(_output.firstChild);
  }
  _output.scrollTop = _output.scrollHeight;
}

export function init(): void {
  _output = document.getElementById('dev-console-output');
  for (const entry of entries) renderEntry(entry);

  function toggle(): void {
    const body = document.getElementById('dev-console-body');
    const btn = document.getElementById('btn-dev-console-toggle');
    if (!body || !btn) return;
    const collapsed = body.classList.toggle('hidden');
    btn.textContent = collapsed ? 'Up' : 'Down';
    if (!collapsed && _output) _output.scrollTop = _output.scrollHeight;
  }

  document.getElementById('btn-dev-console-toggle')?.addEventListener('click', toggle);
  document.getElementById('dev-console-bar-header')?.addEventListener('click', event => {
    if ((event.target as HTMLElement | null)?.closest?.('button')) return;
    toggle();
  });

  document.getElementById('btn-dev-console-clear')?.addEventListener('click', () => {
    entries.length = 0;
    if (_output) _output.innerHTML = '';
  });
}
