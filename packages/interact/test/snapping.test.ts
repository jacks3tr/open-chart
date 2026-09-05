import { describe, expect, test } from 'vitest';

import { snapBounds, type SnapCandidate } from '../src/index.js';

const candidate = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  onScreen = true,
): SnapCandidate => ({ id, bounds: { x, y, width, height }, onScreen });

describe('smart snapping', () => {
  test('normalizes each visible candidate once and keeps tie breaks independent of input order', () => {
    let widthReads = 0;
    const candidates = ['z', 'a'].map((id) => ({ id, onScreen: true,
      bounds: { x: 0, y: 0, get width() { widthReads += 1; return 20; }, height: 20 },
    }));
    const request = { movingId: 'moving', bounds: { x: 40, y: 0, width: 20, height: 20 },
      candidates, settings: { snapToObjects: true, snapToGrid: false,
        snapToGuides: false, threshold: 4 },
    };
    const first = snapBounds(request);
    // One validation/normalization pass, not a pass for every feedback axis.
    expect(widthReads).toBeLessThanOrEqual(6);
    expect(snapBounds({ ...request, candidates: [...candidates].reverse() })).toEqual(first);
    expect(first.distances[0]?.targetId).toBe('a');
  });

  test('emits Lucid-style center, edge, distance, and equal-spacing feedback', () => {
    const evenlySpaced = snapBounds({
      movingId: 'moving',
      bounds: { x: 40, y: 0, width: 20, height: 20 },
      candidates: [
        candidate('left', 0, 0, 20, 20),
        candidate('right', 80, 0, 20, 20),
      ],
      settings: {
        snapToGrid: false,
        snapToObjects: true,
        snapToGuides: false,
        threshold: 4,
      },
    });

    expect(evenlySpaced.delta).toEqual({ x: 0, y: 0 });
    expect(evenlySpaced.coordinates).toEqual({ x: 40, y: 0 });
    expect(evenlySpaced.alignmentGuides).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          axis: 'y',
          position: 10,
          kind: 'center',
          style: 'solid',
        }),
      ]),
    );
    expect(evenlySpaced.distances).toEqual([
      { axis: 'x', targetId: 'left', distance: 20, side: 'before' },
      { axis: 'x', targetId: 'right', distance: 20, side: 'after' },
    ]);
    expect(evenlySpaced.spacingGuides).toEqual([
      { axis: 'x', targetIds: ['left', 'right'], distance: 20 },
    ]);

    const edgeAligned = snapBounds({
      movingId: 'moving',
      bounds: { x: 19.5, y: 50, width: 20, height: 20 },
      candidates: [candidate('target', 40, 100, 30, 20)],
      settings: {
        snapToGrid: false,
        snapToObjects: true,
        snapToGuides: false,
        threshold: 2,
      },
    });
    expect(edgeAligned.bounds.x).toBe(20);
    expect(edgeAligned.alignmentGuides).toEqual([
      {
        axis: 'x',
        position: 40,
        kind: 'edge',
        style: 'dotted',
        targetIds: ['target'],
      },
    ]);
  });

  test('ignores off-screen objects and independently respects guide and grid toggles', () => {
    const snapped = snapBounds({
      movingId: 'moving',
      bounds: { x: 13, y: 17, width: 20, height: 20 },
      candidates: [candidate('offscreen', 14, 17, 20, 20, false)],
      userGuides: [{ id: 'guide.x', axis: 'x', position: 12 }],
      settings: {
        gridSize: 10,
        snapToGrid: true,
        snapToObjects: true,
        snapToGuides: true,
        threshold: 4,
      },
    });

    expect(snapped.bounds).toEqual({ x: 12, y: 20, width: 20, height: 20 });
    expect(snapped.alignmentGuides.map((guide) => [guide.axis, guide.kind])).toEqual([
      ['x', 'user'],
      ['y', 'grid'],
    ]);
    expect(snapped.alignmentGuides.flatMap((guide) => guide.targetIds)).not.toContain(
      'offscreen',
    );

    const unsnapped = snapBounds({
      movingId: 'moving',
      bounds: { x: 13, y: 17, width: 20, height: 20 },
      candidates: [candidate('onscreen', 14, 17, 20, 20)],
      userGuides: [{ id: 'guide.x', axis: 'x', position: 12 }],
      settings: {
        gridSize: 10,
        snapToGrid: false,
        snapToObjects: false,
        snapToGuides: false,
        threshold: 4,
      },
    });
    expect(unsnapped.bounds).toEqual({ x: 13, y: 17, width: 20, height: 20 });
    expect(unsnapped.alignmentGuides).toEqual([]);
  });
});
