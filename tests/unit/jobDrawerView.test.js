import { describe, expect, it } from 'vitest';
import {
  jobDrawerHistoryHtml,
  jobDrawerStateLabel,
  renderJobDrawerHistory,
  renderJobDrawerSnapshot,
} from '../../src/jobDrawerView.js';

describe('job drawer view helpers', () => {
  it('maps job states to drawer labels', () => {
    expect(jobDrawerStateLabel('running')).toBe('Running');
    expect(jobDrawerStateLabel('complete')).toBe('Completed');
    expect(jobDrawerStateLabel('idle')).toBe('Idle');
  });

  it('renders escaped job history html', () => {
    const html = jobDrawerHistoryHtml([{
      title: '<Coverage>',
      message: 'done & ready',
      detail: 'Backend: "Auto"',
    }]);

    expect(html).toContain('&lt;Coverage&gt;');
    expect(html).toContain('done &amp; ready');
    expect(html).toContain('Backend: &quot;Auto&quot;');
  });

  it('updates drawer elements from a snapshot', () => {
    const elements = {
      drawer: fakeElement('job-drawer hidden'),
      state: fakeElement(),
      title: fakeElement(),
      message: fakeElement(),
      fill: fakeElement(),
      cancelButton: fakeButton(),
    };

    renderJobDrawerSnapshot(elements, {
      state: 'running',
      pct: 42,
      title: 'Coverage: Alpha',
      message: 'computing | Elapsed: 0s',
      history: [],
    }, true);

    expect(elements.drawer.className).not.toContain('hidden');
    expect(elements.drawer.dataset.state).toBe('running');
    expect(elements.state.textContent).toBe('Running');
    expect(elements.title.textContent).toBe('Coverage: Alpha');
    expect(elements.message.textContent).toBe('computing | Elapsed: 0s');
    expect(elements.fill.style.width).toBe('42%');
    expect(elements.cancelButton.disabled).toBe(false);

    renderJobDrawerSnapshot(elements, {
      state: 'complete',
      pct: 100,
      title: 'Coverage: Alpha',
      message: 'done | Elapsed: 1s',
      history: [],
    }, true);

    expect(elements.cancelButton.disabled).toBe(true);
    expect(elements.state.textContent).toBe('Completed');
  });

  it('toggles and writes history details', () => {
    const details = fakeElement('job-drawer-history hidden');
    const list = fakeElement();

    renderJobDrawerHistory(details, list, []);
    expect(details.className).toContain('hidden');
    expect(list.innerHTML).toBe('');

    renderJobDrawerHistory(details, list, [{
      title: 'Coverage',
      message: 'done',
      detail: 'Elapsed: 1s',
    }]);

    expect(details.className).not.toContain('hidden');
    expect(list.innerHTML).toContain('<strong>Coverage</strong>');
    expect(list.innerHTML).toContain('<em>Elapsed: 1s</em>');
  });

  function fakeButton() {
    return Object.assign(fakeElement(), { disabled: false });
  }

  function fakeElement(className = '') {
    const element = {
      className,
      textContent: '',
      innerHTML: '',
      dataset: {},
      style: {},
      classList: {
        remove(name) {
          const classes = element.className.split(/\s+/).filter(c => c && c !== name);
          element.className = classes.join(' ');
        },
        toggle(name, force) {
          const classes = new Set(element.className.split(/\s+/).filter(Boolean));
          if (force === undefined ? !classes.has(name) : force) classes.add(name);
          else classes.delete(name);
          element.className = [...classes].join(' ');
        },
      },
    };
    return element;
  }
});
