import { describe, expect, it } from 'vitest';
import {
  createProgressOverlayElement,
  hideProgressOverlay,
  renderProgressOverlayProgress,
} from '../../src/progressOverlayView.js';

describe('progress overlay view helpers', () => {
  it('creates the shared progress overlay shell', () => {
    const overlay = createProgressOverlayElement(fakeDocument({}));

    expect(overlay.id).toBe('progress-overlay');
    expect(overlay.className).toBe('hidden');
    expect(overlay.innerHTML).toContain('id="progress-msg"');
    expect(overlay.innerHTML).toContain('id="progress-fill"');
    expect(overlay.innerHTML).toContain('id="btn-cancel-coverage"');
  });

  it('shows progress and writes fill/message state', () => {
    const overlay = fakeElement('hidden');
    const fill = fakeElement();
    const message = fakeElement();
    const doc = fakeDocument({
      'progress-fill': fill,
      'progress-msg': message,
    });

    renderProgressOverlayProgress(overlay, 42, 'loading', doc);

    expect(overlay.className).not.toContain('hidden');
    expect(fill.style.width).toBe('42%');
    expect(message.textContent).toBe('loading');
  });

  it('preserves the current message when no new message is provided', () => {
    const overlay = fakeElement('hidden');
    const message = Object.assign(fakeElement(), { textContent: 'previous' });
    const doc = fakeDocument({
      'progress-fill': fakeElement(),
      'progress-msg': message,
    });

    renderProgressOverlayProgress(overlay, 5, undefined, doc);

    expect(message.textContent).toBe('previous');
  });

  it('hides the progress overlay', () => {
    const overlay = fakeElement();

    hideProgressOverlay(overlay);

    expect(overlay.className).toContain('hidden');
  });

  function fakeDocument(elements) {
    return {
      createElement() {
        return fakeElement();
      },
      getElementById(id) {
        return elements[id] ?? null;
      },
    };
  }

  function fakeElement(className = '') {
    const element = {
      id: '',
      className,
      textContent: '',
      innerHTML: '',
      style: {},
      classList: {
        add(name) {
          const classes = new Set(element.className.split(/\s+/).filter(Boolean));
          classes.add(name);
          element.className = [...classes].join(' ');
        },
        remove(name) {
          const classes = element.className.split(/\s+/).filter(c => c && c !== name);
          element.className = classes.join(' ');
        },
      },
    };
    return element;
  }
});
