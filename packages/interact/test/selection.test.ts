import { describe, expect, test } from 'vitest';

import {
  clearSelection,
  createSelectionState,
  enterSelectionScope,
  exitSelectionScope,
  selectAll,
  selectAt,
  selectLasso,
  selectMarquee,
  type SelectableItem,
} from '../src/index.js';

const items = [
  {
    id: 'systems',
    kind: 'container',
    bounds: { x: 0, y: 0, width: 120, height: 120 },
    paintOrder: 1,
  },
  {
    id: 'outside',
    kind: 'node',
    bounds: { x: 150, y: 0, width: 30, height: 30 },
    paintOrder: 2,
  },
  {
    id: 'inside-a',
    kind: 'node',
    bounds: { x: 10, y: 10, width: 20, height: 20 },
    paintOrder: 3,
    parentId: 'systems',
  },
  {
    id: 'inside-b',
    kind: 'node',
    bounds: { x: 60, y: 60, width: 20, height: 20 },
    paintOrder: 4,
    parentId: 'systems',
  },
] as const satisfies readonly SelectableItem[];

describe('selection state', () => {
  test('applies root and drilled selection semantics deterministically', () => {
    let state = createSelectionState();

    state = selectAt(state, items, { x: 15, y: 15 });
    expect(state).toEqual({ scopeId: null, selectedIds: ['systems'] });

    state = selectAt(state, items, { x: 160, y: 10 }, { toggle: true });
    expect(state.selectedIds).toEqual(['systems', 'outside']);

    state = selectAt(state, items, { x: 15, y: 15 }, { toggle: true });
    expect(state.selectedIds).toEqual(['outside']);

    state = selectMarquee(state, items, { x: 5, y: 5, width: -10, height: -10 });
    expect(state.selectedIds).toEqual(['systems']);

    state = enterSelectionScope(state, items);
    expect(state).toEqual({ scopeId: 'systems', selectedIds: [] });

    state = selectAt(state, items, { x: 15, y: 15 });
    expect(state.selectedIds).toEqual(['inside-a']);

    state = selectMarquee(state, items, { x: 25, y: 25, width: 50, height: 50 });
    expect(state.selectedIds).toEqual(['inside-a', 'inside-b']);

    state = selectLasso(state, items, [
      { x: 5, y: 5 },
      { x: 50, y: 5 },
      { x: 50, y: 50 },
      { x: 5, y: 50 },
    ]);
    expect(state.selectedIds).toEqual(['inside-a']);

    state = selectAll(state, items);
    expect(state.selectedIds).toEqual(['inside-a', 'inside-b']);

    state = clearSelection(state);
    expect(state).toEqual({ scopeId: 'systems', selectedIds: [] });

    state = exitSelectionScope(state, items);
    expect(state).toEqual({ scopeId: null, selectedIds: [] });
  });

  test('excludes hidden, locked, and out-of-scope items', () => {
    const guardedItems = [
      {
        id: 'eligible',
        kind: 'node',
        bounds: { x: 0, y: 0, width: 30, height: 30 },
        paintOrder: 1,
      },
      {
        id: 'locked',
        kind: 'node',
        bounds: { x: 0, y: 0, width: 30, height: 30 },
        paintOrder: 3,
        locked: true,
      },
      {
        id: 'hidden',
        kind: 'node',
        bounds: { x: 0, y: 0, width: 30, height: 30 },
        paintOrder: 4,
        hidden: true,
      },
      {
        id: 'nested',
        kind: 'node',
        bounds: { x: 0, y: 0, width: 30, height: 30 },
        paintOrder: 5,
        parentId: 'some-container',
      },
    ] as const satisfies readonly SelectableItem[];
    const initial = createSelectionState();

    expect(selectAt(initial, guardedItems, { x: 10, y: 10 }).selectedIds).toEqual([
      'eligible',
    ]);
    expect(
      selectMarquee(initial, guardedItems, { x: -1, y: -1, width: 32, height: 32 })
        .selectedIds,
    ).toEqual(['eligible']);
    expect(
      selectLasso(initial, guardedItems, [
        { x: -1, y: -1 },
        { x: 31, y: -1 },
        { x: 31, y: 31 },
        { x: -1, y: 31 },
      ]).selectedIds,
    ).toEqual(['eligible']);
    expect(selectAll(initial, guardedItems).selectedIds).toEqual(['eligible']);
  });
});
