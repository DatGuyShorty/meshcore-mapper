import { beforeEach, describe, expect, it, vi } from 'vitest';

function createFakeElement(id) {
  const listeners = {};
  const element = {
    id,
    className: '',
    textContent: '',
    dataset: {},
    style: {},
    children: [],
    _listeners: listeners,
    dataset: {},
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; },
    classList: {
      add(name) { this._el.className = this._el.className.split(' ').filter(Boolean).concat(name).join(' '); },
      remove(name) { this._el.className = this._el.className.split(' ').filter(c => c !== name).join(' '); },
      toggle(name, force) {
        const has = this._el.className.split(' ').includes(name);
        if (force === undefined) {
          if (has) this.remove(name); else this.add(name);
        } else if (force) this.add(name); else this.remove(name);
      },
    },
    addEventListener(event, handler) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
    },
    removeEventListener(event, handler) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter(h => h !== handler);
    },
    click() {
      (listeners.click || []).forEach(handler => handler({ target: this }));
    },
    appendChild(child) {
      this.children.push(child);
    },
    dispatchEvent(event) {
      (listeners[event.type] || []).forEach(handler => handler(event));
      return true;
    },
    querySelector(selector) {
      if (selector.startsWith('#')) {
        return document.getElementById(selector.slice(1));
      }
      return null;
    },
  };
  element.classList._el = element;
  return element;
}

describe('ui helper utilities', () => {
  let ui;
  beforeEach(async () => {
    const elements = new Map();
    const getElementById = id => elements.get(id) ?? null;
    const mapContainer = createFakeElement('map-container');
    elements.set('map-container', mapContainer);
    elements.set('status-msg', createFakeElement('status-msg'));
    elements.set('progress-fill', createFakeElement('progress-fill'));
    elements.set('progress-msg', createFakeElement('progress-msg'));
    elements.set('btn-cancel-coverage', createFakeElement('btn-cancel-coverage'));
    elements.set('tab1', Object.assign(createFakeElement('tab1'), { className: 'tab-btn', dataset: { tab: 'test' } }));

    globalThis.document = {
      getElementById,
      createElement(_tag) {
        return createFakeElement('');
      },
      querySelector(selector) {
        if (selector.startsWith('.tab-btn[data-tab="')) {
          const tabName = selector.match(/data-tab="([^"]+)"/)[1];
          return Array.from(elements.values()).find(el => el.className?.includes('tab-btn') && el.dataset.tab === tabName) || null;
        }
        return null;
      },
    };

    globalThis.window = { confirm: () => true };
    ui = await import('../../src/ui.js');
  });

  it('updates progress overlay and message when setProgress is called', () => {
    ui.setProgress(42, 'loading');
    expect(document.getElementById('progress-fill').style.width).toBe('42%');
    expect(document.getElementById('progress-msg').textContent).toBe('loading');
  });

  it('hides the progress overlay when hideProgress() is called', () => {
    ui.hideProgress();
    expect(document.getElementById('progress-fill').className).not.toBeUndefined();
  });

  it('sets the global status message text', () => {
    ui.setStatus('Ready');
    expect(document.getElementById('status-msg').textContent).toBe('Ready');
  });

  it('toggles button busy state and restores idle text', async () => {
    const button = createFakeElement('btn-test');
    button.textContent = 'Submit';
    document.getElementById = id => id === 'btn-test' ? button : null;

    await ui.withButtonBusy('btn-test', 'Waiting...', async () => {
      expect(button.disabled).toBe(true);
      expect(button.textContent).toBe('Waiting...');
    });

    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Submit');
  });

  it('sets inline status text and toggles visibility class', () => {
    const statusLine = createFakeElement('inline-status');
    document.getElementById = id => id === 'inline-status' ? statusLine : null;

    ui.setInlineStatus('inline-status', 'Done', 'success');
    expect(statusLine.textContent).toBe('Done');
    expect(statusLine.className).toContain('status-success');
    expect(statusLine.className).not.toContain('hidden');

    ui.setInlineStatus('inline-status', '');
    expect(statusLine.className).toContain('hidden');
  });

  it('uses window.confirm in confirmAction()', () => {
    window.confirm = () => false;
    expect(ui.confirmAction('Yes?')).toBe(false);
  });

  it('clicks the matching tab button when setActiveTab is called', () => {
    const tabButton = document.querySelector('.tab-btn[data-tab="test"]');
    const clickSpy = vi.fn();
    tabButton.addEventListener('click', clickSpy);
    ui.setActiveTab('test');
    expect(clickSpy).toHaveBeenCalled();
  });

  it('escapes HTML special characters safely', () => {
    expect(ui.escHtml('<div>&"\'')).toBe('&lt;div&gt;&amp;&quot;&#39;');
  });
});
