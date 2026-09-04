import { describe, expect, test } from 'vitest';

import {
  catmullRomToCubicSegments,
  findOrthogonalCrossings,
  hitTestConnector,
  pointAtNormalizedDistance,
  routeConnector,
  segmentIntersectsRectInterior,
} from '../src/index.js';

describe('connector routing kernel', () => {
  test('routes fast and obstacle-safe paths and derives stable interaction geometry', () => {
    const fast = routeConnector({
      from: { x: 0, y: 40, side: 'east' },
      to: { x: 240, y: 140, side: 'west' },
      mode: 'orthogonal',
      strategy: 'fast',
      jetty: 12,
    });
    expect(fast).toMatchObject({ ok: true, strategy: 'fast' });
    if (!fast.ok) return;
    expect(fast.points[1]).toEqual({ x: 12, y: 40 });
    expect(fast.points.at(-2)).toEqual({ x: 228, y: 140 });

    expect(
      routeConnector({
        from: { x: 0, y: 0 },
        to: { x: 100, y: 100 },
        mode: 'straight',
      }),
    ).toMatchObject({
      ok: true,
      points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
    });

    const obstacle = { id: 'blocker', x: 80, y: 20, width: 80, height: 120 };
    const avoided = routeConnector({
      from: { x: 0, y: 80, side: 'east' },
      to: { x: 240, y: 80, side: 'west' },
      mode: 'orthogonal',
      strategy: 'obstacle',
      obstacles: [obstacle],
      clearance: 10,
      jetty: 12,
    });
    expect(avoided).toMatchObject({ ok: true, strategy: 'obstacle' });
    if (!avoided.ok) return;
    expect(
      avoided.points.slice(1).some((point, index) => {
        const previous = avoided.points[index];
        return previous !== undefined && segmentIntersectsRectInterior(previous, point, obstacle);
      }),
    ).toBe(false);
    const midpoint = pointAtNormalizedDistance(avoided.points, 0.5);
    expect(midpoint).toMatchObject({ t: 0.5 });
    if (midpoint === undefined) {
      throw new Error('Expected connector midpoint');
    }
    expect(hitTestConnector(avoided.points, midpoint, 4)).toBe(true);

    const curves = catmullRomToCubicSegments([
      { x: 0, y: 0 }, { x: 60, y: 0 }, { x: 120, y: 80 }, { x: 200, y: 80 },
    ]);
    expect(curves).toHaveLength(3);
    expect(curves.every((segment) => Number.isFinite(segment.control1.x + segment.control2.y))).toBe(true);

    expect(
      findOrthogonalCrossings([
        { id: 'horizontal', uid: 'b', zIndex: 1, points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] },
        { id: 'vertical', uid: 'a', zIndex: 2, points: [{ x: 40, y: 0 }, { x: 40, y: 100 }] },
      ]),
    ).toEqual([
      expect.objectContaining({ overEdgeId: 'vertical', underEdgeId: 'horizontal', point: { x: 40, y: 50 } }),
    ]);
  });

  test('returns a specific diagnostic when obstacle routing has no valid endpoint', () => {
    expect(
      routeConnector({
        from: { x: 10, y: 10, side: 'east' },
        to: { x: 200, y: 10, side: 'west' },
        mode: 'orthogonal',
        strategy: 'obstacle',
        obstacles: [{ id: 'sealed', x: 0, y: 0, width: 40, height: 40 }],
      }),
    ).toEqual({
      ok: false,
      diagnostic: {
        code: 'UNROUTABLE',
        message: 'Connector endpoint intersects obstacle "sealed"',
      },
    });
  });
});
