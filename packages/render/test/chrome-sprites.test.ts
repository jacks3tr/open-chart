import { describe, expect, it } from 'vitest';

import type { SceneDescription, SceneRect } from '@openchart/scene';

import {
  RasterCache,
  SceneViewportRenderer,
  type CanvasPaintContext,
  type CanvasRasterSurface,
} from '../src/index.js';

interface RecordingContext extends CanvasPaintContext {
  readonly calls: string[];
  readonly scales: Array<readonly [number, number]>;
}

function recordingContext(): RecordingContext {
  const calls: string[] = [];
  const scales: Array<readonly [number, number]> = [];
  const properties = new Map<PropertyKey, unknown>([['globalAlpha', 1]]);
  const context = new Proxy(
    { calls, scales },
    {
      get: (target, property) =>
        property === 'calls'
          ? target.calls
          : property === 'scales'
            ? target.scales
          : property === 'scale'
            ? (x: number, y: number) => {
                calls.push('scale');
                scales.push([x, y]);
              }
            : (properties.get(property) ?? (() => calls.push(String(property)))),
      has: (_target, property) => properties.has(property),
      set: (_target, property, value: unknown) => {
        properties.set(property, value);
        return true;
      },
    },
  );
  return context as RecordingContext;
}

function chromeScene(): SceneDescription {
  const node = (
    id: string,
    frame: SceneRect,
    chromeCacheKey: string,
  ): SceneDescription['items'][number] => ({
    type: 'group',
    id,
    role: 'node',
    entityId: id,
    children: [
      {
        type: 'rect',
        id: `${id}-card`,
        frame,
        radius: 10,
        fill: '#ffffff',
        stroke: '#2563eb',
        strokeWidth: 1.5,
        chromeCacheKey,
      },
    ],
  });

  return {
    version: 1,
    bounds: { x: 0, y: 0, width: 300, height: 150 },
    title: 'Chrome cache probe',
    description: 'Two reusable cards and one one-off card.',
    items: [
      {
        type: 'group',
        id: 'artboard',
        role: 'artboard',
        children: [
          node('node-a', { x: 10, y: 10, width: 101, height: 53 }, 'service'),
          node('node-b', { x: 130, y: 10, width: 103, height: 55 }, 'service'),
          node('node-one-off', { x: 10, y: 90, width: 40, height: 40 }, 'database'),
        ],
      },
    ],
  };
}

describe('Canvas chrome sprites', () => {
  it('caches repeated chrome by quantized size, zoom, style, and capped DPR', () => {
    const createdSizes: Array<readonly [number, number]> = [];
    const offscreenCalls: string[][] = [];
    const blits: SceneRect[] = [];
    const cache = new RasterCache<CanvasRasterSurface>((width, height) => {
      createdSizes.push([width, height]);
      const context = recordingContext();
      offscreenCalls.push(context.calls);
      return {
        width,
        height,
        context,
        blit: (_target, destination) => blits.push(destination),
      };
    });
    const renderer = new SceneViewportRenderer(chromeScene());
    const target = recordingContext();
    const camera = {
      x: 0,
      y: 0,
      zoom: 0.75,
      viewportWidth: 300,
      viewportHeight: 150,
    } as const;

    renderer.paint(target, camera, { chromeCache: cache, devicePixelRatio: 3 });

    expect(createdSizes).toEqual([[211, 115]]);
    expect(blits).toHaveLength(2);
    expect(blits[0]?.x).toBeLessThan(10);
    expect(blits[0]?.width).toBeGreaterThan(101);
    expect(offscreenCalls[0]?.filter((call) => call === 'fill')).toHaveLength(1);
    expect(target.calls.filter((call) => call === 'fill')).toHaveLength(1);
    expect(cache.stats).toMatchObject({ entries: 1, hits: 1, misses: 1 });

    renderer.paintDirty(
      target,
      camera,
      [{ x: 0, y: 0, width: 115, height: 70 }],
      { chromeCache: cache, devicePixelRatio: 3 },
    );

    expect(createdSizes).toEqual([[211, 115]]);
    expect(blits).toHaveLength(3);
    expect(target.calls.filter((call) => call === 'fill')).toHaveLength(1);
    expect(cache.stats).toMatchObject({ entries: 1, hits: 2, misses: 1 });

    const fractionalSizes: Array<readonly [number, number]> = [];
    const fractionalContexts: RecordingContext[] = [];
    const fractionalCache = new RasterCache<CanvasRasterSurface>((width, height) => {
      fractionalSizes.push([width, height]);
      const context = recordingContext();
      fractionalContexts.push(context);
      return { width, height, context, blit: () => undefined };
    });
    renderer.paint(recordingContext(), camera, {
      chromeCache: fractionalCache,
      devicePixelRatio: 1.25,
    });

    expect(fractionalSizes).toEqual([[132, 72]]);
    expect(fractionalContexts[0]?.scales).toEqual([[132 / 105.5, 72 / 57.5]]);
  });

  it('rejects a non-positive device-pixel ratio', () => {
    const cache = new RasterCache<CanvasRasterSurface>((width, height) => ({
      width,
      height,
      context: recordingContext(),
      blit: () => undefined,
    }));

    expect(() =>
      new SceneViewportRenderer(chromeScene()).paint(
        recordingContext(),
        { x: 0, y: 0, zoom: 1, viewportWidth: 300, viewportHeight: 150 },
        { chromeCache: cache, devicePixelRatio: 0 },
      ),
    ).toThrow(/devicePixelRatio.*positive/);
  });
});
