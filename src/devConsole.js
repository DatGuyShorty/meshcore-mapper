/**
 * devConsole.js — In-app developer console panel.
 * Intercepts console.log/warn/error/info and displays entries in the sidebar panel.
 * Exports: init
 */

const MAX_ENTRIES = 200;
const entries = [];
let _output = null;

const _orig = {
  log:   console.log.bind(console),
  warn:  console.warn.bind(console),
  error: console.error.bind(console),
  info:  console.info.bind(console),
  debug: console.debug.bind(console),
};

function formatArg(a) {
  if (a instanceof Error) return a.stack || a.message;
  if (typeof a === 'object' && a !== null) { try { return JSON.stringify(a); } catch {} }
  return String(a);
}

function timestamp() {
  return new Date().toTimeString().slice(0, 8);
}

function append(level, args) {
  const entry = { level, msg: args.map(formatArg).join(' '), time: timestamp() };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  if (_output) renderEntry(entry);
}

['log', 'warn', 'error', 'info', 'debug'].forEach(level => {
  console[level] = (...args) => {
    _orig[level](...args);
    append(level, args);
  };
});

function renderEntry(e) {
  const row = document.createElement('div');
  row.className = `dc-row dc-${e.level}`;
  row.textContent = `[${e.time}] ${e.msg}`;
  _output.appendChild(row);
  _output.scrollTop = _output.scrollHeight;
}

export function init() {
  _output = document.getElementById('dev-console-output');
  for (const e of entries) renderEntry(e); // replay entries logged before DOM ready

  document.getElementById('btn-dev-console-toggle').addEventListener('click', () => {
    const body = document.getElementById('dev-console-body');
    const btn  = document.getElementById('btn-dev-console-toggle');
    const collapsed = body.classList.toggle('hidden');
    btn.textContent = collapsed ? '▶' : '▼';
  });

  document.getElementById('btn-dev-console-clear').addEventListener('click', () => {
    entries.length = 0;
    _output.innerHTML = '';
  });
}
