import { describe, expect, it } from 'vitest';

import {
  RenderStatsCollector,
  paintRenderStatsOverlay,
  type CanvasPaintContext,
  type RasterCacheStats,
} from '../src/index.js';

function cacheStats(hits: number, misses: number, bytes: number): RasterCacheStats {
  return {
    entries: 1,
    bytes,
    maxBytes: 1024,
    hits,
    misses,
    evictions: 0,
  };
}

function overlayContext(): {
  readonly context: CanvasPaintContext;
  readonly text: string[];
  readonly rects: Array<readonly [number, number, number, number]>;
} {
  const text: string[] = [];
  const rects: Array<readonly [number, number, number, number]> = [];
  const properties = new Map<PropertyKey, unknown>([['globalAlpha', 1]]);
  const context = new Proxy(
    {},
    {
      get: (_target, property) => {
        if (property === 'fillText') {
          return (value: string) => text.push(value);
        }
        if (property === 'rect') {
          return (x: number, y: number, width: number, height: number) => {
            rects.push([x, y, width, height]);
          };
        }
        return properties.get(property) ?? (() => undefined);
      },
      has: (_target, property) => properties.has(property),
      set: (_target, property, value: unknown) => {
        properties.set(property, value);
        return true;
      },
    },
  ) as CanvasPaintContext;
  return { context, text, rects };
}

describe('render stats overlay', () => {
  it('keeps a bounded frame window and renders the current performance summary', () => {
    const collector = new RenderStatsCollector(3);
    collector.record({ frameTimeMs: 5, drawCallCount: 100, dirtyRectCount: 0 });
    collector.record({ frameTimeMs: 10, drawCallCount: 110, dirtyRectCount: 1 });
    collector.record({ frameTimeMs: 20, drawCallCount: 120, dirtyRectCount: 1 });
    collector.record({
      frameTimeMs: 40,
      drawCallCount: 140,
      dirtyRectCount: 2,
      workerLatencyMs: 3.2,
      memoryBytes: 512 * 1024 * 1024,
      caches: [cacheStats(9, 1, 100), cacheStats(4, 1, 50)],
    });

    const snapshot = collector.snapshot();
    expect(snapshot).toMatchObject({
      totalFrames: 4,
      sampledFrames: 3,
      lastFrameTimeMs: 40,
      p95FrameTimeMs: 40,
      p99FrameTimeMs: 40,
      drawCallCount: 140,
      dirtyRectCount: 2,
      workerLatencyMs: 3.2,
      memoryBytes: 512 * 1024 * 1024,
      cacheBytes: 150,
    });
    expect(snapshot.averageFrameTimeMs).toBeCloseTo(70 / 3);
    expect(snapshot.estimatedFramesPerSecond).toBeCloseTo(3000 / 70);
    expect(snapshot.cacheHitRate).toBeCloseTo(13 / 15);

    const overlay = overlayContext();
    paintRenderStatsOverlay(overlay.context, snapshot, { x: 8, y: 12 });

    expect(overlay.rects).toHaveLength(1);
    expect(overlay.text).toEqual([
      'OPENCHART · RENDER',
      'FRAME 40.0 ms  P95 40.0 ms',
      'P99 40.0 ms  42.9 fps',
      'DRAWS 140  DIRTY 2',
      'CACHE 86.7%  150 B',
      'WORKER 3.2 ms  MEM 512.0 MB',
    ]);

    collector.record({ frameTimeMs: 16, drawCallCount: 150, dirtyRectCount: 0 });
    expect(collector.snapshot()).toMatchObject({
      workerLatencyMs: 3.2,
      memoryBytes: 512 * 1024 * 1024,
      cacheBytes: 150,
      cacheHits: 13,
      cacheMisses: 2,
    });
  });
});
