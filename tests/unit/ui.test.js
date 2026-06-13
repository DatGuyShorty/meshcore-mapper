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
  let nowMs;
  beforeEach(async () => {
    vi.resetModules();
    nowMs = 1000;
    Object.defineProperty(globalThis, 'performance', {
      configurable: true,
      value: { now: () => nowMs },
    });
    const elements = new Map();
    const getElementById = id => elements.get(id) ?? null;
    const mapContainer = createFakeElement('map-container');
    elements.set('map-container', mapContainer);
    elements.set('status-msg', createFakeElement('status-msg'));
    elements.set('progress-fill', createFakeElement('progress-fill'));
    elements.set('progress-msg', createFakeElement('progress-msg'));
    elements.set('btn-cancel-coverage', createFakeElement('btn-cancel-coverage'));
    elements.set('job-drawer', Object.assign(createFakeElement('job-drawer'), { className: 'job-drawer hidden' }));
    elements.set('job-drawer-state', createFakeElement('job-drawer-state'));
    elements.set('job-drawer-title', createFakeElement('job-drawer-title'));
    elements.set('job-drawer-message', createFakeElement('job-drawer-message'));
    elements.set('job-drawer-fill', createFakeElement('job-drawer-fill'));
    elements.set('job-drawer-history', Object.assign(createFakeElement('job-drawer-history'), { className: 'job-drawer-history hidden' }));
    elements.set('job-drawer-history-list', createFakeElement('job-drawer-history-list'));
    elements.set('btn-job-drawer-cancel', createFakeElement('btn-job-drawer-cancel'));
    elements.set('btn-job-drawer-dismiss', createFakeElement('btn-job-drawer-dismiss'));
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

  it('updates the job drawer and invokes the shared cancel handler', () => {
    const cancel = vi.fn();
    ui.setCancelHandler(cancel);
    ui.setProgress(42, 'loading');

    expect(document.getElementById('job-drawer').className).not.toContain('hidden');
    expect(document.getElementById('job-drawer').dataset.state).toBe('running');
    expect(document.getElementById('job-drawer-state').textContent).toBe('Running');
    expect(document.getElementById('job-drawer-message').textContent).toBe('loading | Elapsed: 0s');
    expect(document.getElementById('job-drawer-fill').style.width).toBe('42%');
    expect(document.getElementById('btn-job-drawer-cancel').disabled).toBe(false);

    document.getElementById('btn-job-drawer-cancel').click();
    expect(cancel).toHaveBeenCalled();
    expect(document.getElementById('job-drawer-state').textContent).toBe('Cancelling');
  });

  it('shows job drawer metadata for titled jobs', () => {
    ui.setProgress(64, 'computing', {
      title: 'Coverage: Alpha',
      backend: 'Auto backend',
      warningCount: 2,
    });

    expect(document.getElementById('job-drawer-title').textContent).toBe('Coverage: Alpha');
    expect(document.getElementById('job-drawer-message').textContent).toBe('computing | Elapsed: 0s | Backend: Auto backend | 2 warnings');

    nowMs += 1500;
    ui.hideProgress();
    expect(document.getElementById('job-drawer-title').textContent).toBe('Coverage: Alpha');
    expect(document.getElementById('job-drawer-message').textContent).toBe('computing | Elapsed: 1.5s | Backend: Auto backend | 2 warnings');
    expect(document.getElementById('job-drawer-history').className).not.toContain('hidden');
    expect(document.getElementById('job-drawer-history-list').innerHTML).toContain('Coverage: Alpha');
    expect(document.getElementById('job-drawer-history-list').innerHTML).toContain('2 warnings');
  });

  it('extracts ETA text into a stable job drawer detail', () => {
    ui.setProgress(36, 'terrain tiles 3/9 (ETA 12s)', {
      title: 'Coverage: Alpha',
      backend: 'Auto backend',
    });

    expect(document.getElementById('progress-msg').textContent).toBe('terrain tiles 3/9 (ETA 12s)');
    expect(document.getElementById('job-drawer-message').textContent)
      .toBe('terrain tiles 3/9 | ETA: 12s | Elapsed: 0s | Backend: Auto backend');

    nowMs += 2500;
    ui.hideProgress();
    expect(document.getElementById('job-drawer-message').textContent)
      .toBe('terrain tiles 3/9 | Elapsed: 2.5s | Backend: Auto backend');
  });

  it('keeps recent job history capped newest-first', () => {
    for (let i = 1; i <= 6; i++) {
      ui.setProgress(100, `done ${i}`, { title: `Job ${i}` });
      ui.hideProgress();
    }

    const html = document.getElementById('job-drawer-history-list').innerHTML;
    expect(html.indexOf('Job 6')).toBeLessThan(html.indexOf('Job 5'));
    expect(html).toContain('Job 2');
    expect(html).not.toContain('Job 1');
  });

  it('hides the progress overlay when hideProgress() is called', () => {
    ui.setProgress(100, 'done');
    ui.hideProgress();
    expect(document.getElementById('progress-fill').className).not.toBeUndefined();
    expect(document.getElementById('job-drawer').dataset.state).toBe('complete');
    expect(document.getElementById('job-drawer-state').textContent).toBe('Completed');
    expect(document.getElementById('job-drawer-message').textContent).toBe('done | Elapsed: 0s');
    expect(document.getElementById('btn-job-drawer-cancel').disabled).toBe(true);
  });

  it('dismisses the completed job drawer summary', () => {
    ui.setProgress(100, 'done');
    ui.hideProgress();
    document.getElementById('btn-job-drawer-dismiss').click();
    expect(document.getElementById('job-drawer').className).toContain('hidden');
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
