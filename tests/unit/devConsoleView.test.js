import { describe, expect, it } from 'vitest';
import {
  appendConsoleEntry,
  clearConsoleOutput,
  createConsoleEntryRow,
  toggleDevConsoleCollapsed,
} from '../../src/devConsoleView.js';

describe('dev console view helpers', () => {
  it('creates console entry rows with level class and timestamped text', () => {
    const row = createConsoleEntryRow({
      level: 'warn',
      msg: 'terrain warning',
      time: '12:34:56',
    }, fakeDocument());

    expect(row.className).toBe('dc-row dc-warn');
    expect(row.textContent).toBe('[12:34:56] terrain warning');
  });

  it('appends, trims, and scrolls console output', () => {
    const output = fakeOutput();
    const doc = fakeDocument();

    appendConsoleEntry(output, { level: 'log', msg: 'one', time: '00:00:01' }, 2, doc);
    appendConsoleEntry(output, { level: 'info', msg: 'two', time: '00:00:02' }, 2, doc);
    appendConsoleEntry(output, { level: 'error', msg: 'three', time: '00:00:03' }, 2, doc);

    expect(output.childElementCount).toBe(2);
    expect(output.children.map(row => row.textContent)).toEqual([
      '[00:00:02] two',
      '[00:00:03] three',
    ]);
    expect(output.scrollTop).toBe(output.scrollHeight);
  });

  it('clears console output', () => {
    const output = fakeOutput();
    output.appendChild(fakeElement());

    clearConsoleOutput(output);

    expect(output.childElementCount).toBe(0);
    expect(output.innerHTML).toBe('');
  });

  it('toggles collapsed state and button label', () => {
    const body = fakeElement();
    const button = fakeElement();

    expect(toggleDevConsoleCollapsed(body, button)).toBe(true);
    expect(body.className).toContain('hidden');
    expect(button.textContent).toBe('Up');

    expect(toggleDevConsoleCollapsed(body, button)).toBe(false);
    expect(body.className).not.toContain('hidden');
    expect(button.textContent).toBe('Down');
  });

  function fakeDocument() {
    return {
      createElement() {
        return fakeElement();
      },
    };
  }

  function fakeOutput() {
    const output = {
      ...fakeElement(),
      children: [],
      childElementCount: 0,
      firstChild: undefined,
      scrollTop: 0,
      scrollHeight: 0,
      appendChild(child) {
        this.children.push(child);
        this.childElementCount = this.children.length;
        this.firstChild = this.children[0];
        this.scrollHeight = this.children.length * 20;
      },
      removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) this.children.splice(idx, 1);
        this.childElementCount = this.children.length;
        this.firstChild = this.children[0];
        this.scrollHeight = this.children.length * 20;
      },
    };
    Object.defineProperty(output, 'innerHTML', {
      get() {
        return this.children.map(child => child.textContent).join('');
      },
      set(_value) {
        this.children.length = 0;
        this.childElementCount = 0;
        this.firstChild = undefined;
        this.scrollHeight = 0;
      },
    });
    return output;
  }

  function fakeElement() {
    const element = {
      className: '',
      textContent: '',
      classList: {
        toggle(name) {
          const classes = new Set(element.className.split(/\s+/).filter(Boolean));
          const next = !classes.has(name);
          if (next) classes.add(name);
          else classes.delete(name);
          element.className = [...classes].join(' ');
          return next;
        },
      },
    };
    return element;
  }
});
