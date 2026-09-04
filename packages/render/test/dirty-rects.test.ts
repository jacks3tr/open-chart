import { describe, expect, it } from 'vitest';

import { coalesceDirtyRects } from '../src/dirty-rects.js';

describe('coalesceDirtyRects', () => {
  it('pads and transitively merges overlap, then collapses more than four regions', () => {
    expect(
      coalesceDirtyRects(
        [
          { x: 0, y: 0, width: 10, height: 10 },
          { x: 18, y: 0, width: 10, height: 10 },
          { x: 100, y: 100, width: 5, height: 5 },
        ],
        { routingMargin: 2, shadowBleed: 3 },
      ),
    ).toEqual([
      { x: -5, y: -5, width: 38, height: 20 },
      { x: 95, y: 95, width: 15, height: 15 },
    ]);

    expect(
      coalesceDirtyRects([
        { x: 0, y: 0, width: 1, height: 1 },
        { x: 10, y: 10, width: 1, height: 1 },
        { x: 20, y: 20, width: 1, height: 1 },
        { x: 30, y: 30, width: 1, height: 1 },
        { x: 40, y: 40, width: 1, height: 1 },
      ]),
    ).toEqual([{ x: 0, y: 0, width: 41, height: 41 }]);
  });

  it('rejects malformed rectangles and margins instead of clearing the wrong area', () => {
    expect(() =>
      coalesceDirtyRects([{ x: 0, y: 0, width: -1, height: 4 }]),
    ).toThrow(/non-negative/);
    expect(() =>
      coalesceDirtyRects([{ x: 0, y: 0, width: 1, height: 1 }], {
        shadowBleed: Number.NaN,
      }),
    ).toThrow(/finite/);
    expect(() =>
      coalesceDirtyRects([
        { x: Number.MAX_VALUE, y: 0, width: Number.MAX_VALUE, height: 1 },
      ]),
    ).toThrow(/finite/);
  });
});
