import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createFakeOutput() {
  const children = [];
  return {
    children,
    childElementCount: 0,
    scrollTop: 0,
    scrollHeight: 0,
    appendChild(child) {
      children.push(child);
      this.childElementCount = children.length;
      this.firstChild = children[0];
      this.scrollHeight = children.length * 20;
    },
    removeChild(child) {
      const idx = children.indexOf(child);
      if (idx !== -1) children.splice(idx, 1);
      this.childElementCount = children.length;
      this.firstChild = children[0];
      this.scrollHeight = children.length * 20;
    },
    get innerHTML() {
      return children.map(c => c.textContent).join('');
    },
    set innerHTML(value) {
      children.length = 0;
      this.childElementCount = 0;
      this.firstChild = undefined;
    },
  };
}

function createFakeElement(id) {
  const listeners = {};
  return {
    id,
    className: '',
    textContent: '',
    style: {},
    dataset: {},
    addEventListener(event, handler) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
    },
    dispatchEvent(event) {
      (listeners[event.type] || []).forEach(handler => handler(event));
      return true;
    },
  };
}

describe('devConsole UI integration', () => {
  let origConsole;
  let fakeConsole;
  let originalConsoleSpies;
  let devConsole;
  let output;
  let elements;

  beforeEach(async () => {
    origConsole = globalThis.console;
    originalConsoleSpies = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
    fakeConsole = {
      log: originalConsoleSpies.log,
      warn: originalConsoleSpies.warn,
      error: originalConsoleSpies.error,
      info: originalConsoleSpies.info,
      debug: originalConsoleSpies.debug,
    };
    globalThis.console = fakeConsole;

    output = createFakeOutput();
    const toggleBtn = createFakeElement('btn-dev-console-toggle');
    const body = createFakeElement('dev-console-body');
    const header = createFakeElement('dev-console-bar-header');
    const clearBtn = createFakeElement('btn-dev-console-clear');

    elements = new Map([
      ['dev-console-output', output],
      ['btn-dev-console-toggle', toggleBtn],
      ['dev-console-body', body],
      ['dev-console-bar-header', header],
      ['btn-dev-console-clear', clearBtn],
    ]);

    globalThis.document = {
      getElementById: id => elements.get(id) || null,
      createElement: () => createFakeElement(''),
      body: { appendChild: vi.fn() },
    };

    devConsole = await import('../../src/devConsole.js');
    devConsole.init();
  });

  afterEach(() => {
    globalThis.console = origConsole;
  });

  it('appends console entries to the dev console output', () => {
    console.log('test message');

    expect(output.childElementCount).toBe(1);
    expect(output.children[0].textContent).toContain('test message');
    expect(originalConsoleSpies.log).toHaveBeenCalledWith('test message');
  });

  it('clears output when the clear button is clicked', () => {
    console.log('first');
    expect(output.childElementCount).toBe(1);

    const clearBtn = elements.get('btn-dev-console-clear');
    clearBtn.dispatchEvent({ type: 'click' });

    expect(output.childElementCount).toBe(0);
    expect(output.innerHTML).toBe('');
  });
});
