// @ts-check
/**
 * devConsole.js — In-app developer console panel.
 * Intercepts console.log/warn/error/info and displays entries in the sidebar panel.
 * Exports: init
 *
 * @typedef {'log' | 'warn' | 'error' | 'info' | 'debug'} ConsoleLevel
 * @typedef {{ level: ConsoleLevel, msg: string, time: string }} ConsoleEntry
 */

const MAX_ENTRIES = 200;
/** @type {ConsoleEntry[]} */
const entries = [];
/** @type {HTMLElement | null} */
let _output = null;

const _orig = {
  log:   console.log.bind(console),
  warn:  console.warn.bind(console),
  error: console.error.bind(console),
  info:  console.info.bind(console),
  debug: console.debug.bind(console),
};

/** @param {unknown} a */
function formatArg(a) {
  if (a instanceof Error) return a.stack || a.message;
  if (typeof a === 'object' && a !== null) { try { return JSON.stringify(a); } catch {} }
  return String(a);
}

function timestamp() {
  return new Date().toTimeString().slice(0, 8);
}

/**
 * @param {ConsoleLevel} level
 * @param {unknown[]} args
 */
function append(level, args) {
  /** @type {ConsoleEntry} */
  const entry = { level, msg: args.map(formatArg).join(' '), time: timestamp() };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  if (_output) renderEntry(entry);
}

/** @type {ConsoleLevel[]} */
const LEVELS = ['log', 'warn', 'error', 'info', 'debug'];
LEVELS.forEach(level => {
  console[level] = (/** @type {unknown[]} */ ...args) => {
    _orig[level](...args);
    append(level, args);
  };
});

/** @param {ConsoleEntry} e */
function renderEntry(e) {
  if (!_output) return;
  const row = document.createElement('div');
  row.className = `dc-row dc-${e.level}`;
  row.textContent = `[${e.time}] ${e.msg}`;
  _output.appendChild(row);
  // Keep DOM in sync with the capped entries array
  while (_output.childElementCount > MAX_ENTRIES && _output.firstChild) _output.removeChild(_output.firstChild);
  _output.scrollTop = _output.scrollHeight;
}

export function init() {
  _output = document.getElementById('dev-console-output');
  for (const e of entries) renderEntry(e); // replay entries logged before DOM ready

  function toggle() {
    const body = document.getElementById('dev-console-body');
    const btn  = document.getElementById('btn-dev-console-toggle');
    if (!body || !btn) return;
    const collapsed = body.classList.toggle('hidden');
    btn.textContent = collapsed ? 'Up' : 'Down';
    if (!collapsed && _output) _output.scrollTop = _output.scrollHeight;
  }

  document.getElementById('btn-dev-console-toggle')?.addEventListener('click', toggle);
  document.getElementById('dev-console-bar-header')?.addEventListener('click', e => {
    if (/** @type {HTMLElement} */ (e.target).closest('button')) return; // let Clear button work normally
    toggle();
  });

  document.getElementById('btn-dev-console-clear')?.addEventListener('click', () => {
    entries.length = 0;
    if (_output) _output.innerHTML = '';
  });
}
