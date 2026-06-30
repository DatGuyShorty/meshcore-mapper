import { describe, expect, it } from 'vitest';
import {
  nodeSelectionEventForClick,
  toggleNodeSelectionId,
} from '../../src/nodeSelectionEvents.js';

describe('node selection click events', () => {
  it('plans a single-node selection for ordinary clicks', () => {
    expect(nodeSelectionEventForClick(7, {}, {
      selectedNodeId: 3,
      selectedNodeIds: [3, 4],
    })).toEqual({
      type: 'node:selected',
      detail: { id: 7 },
    });
  });

  it('plans a multi-node selection for modifier clicks', () => {
    expect(nodeSelectionEventForClick(7, { ctrlKey: true }, {
      selectedNodeId: 3,
      selectedNodeIds: [3, 4],
    })).toEqual({
      type: 'nodes:selected',
      detail: { ids: ['3', '4', '7'] },
    });
  });

  it('toggles existing selected ids by string-equivalent id', () => {
    expect(toggleNodeSelectionId('4', {
      selectedNodeId: 3,
      selectedNodeIds: [3, 4, 5],
    })).toEqual(['3', '5']);
  });

  it('supports shift and command modifier clicks', () => {
    expect(nodeSelectionEventForClick('9', { shiftKey: true }, {})).toEqual({
      type: 'nodes:selected',
      detail: { ids: ['9'] },
    });
    expect(nodeSelectionEventForClick('9', { metaKey: true }, {})).toEqual({
      type: 'nodes:selected',
      detail: { ids: ['9'] },
    });
  });

  it('ignores missing ids', () => {
    expect(nodeSelectionEventForClick(null, { ctrlKey: true }, {})).toBeNull();
    expect(nodeSelectionEventForClick(undefined, {}, {})).toBeNull();
  });
});
