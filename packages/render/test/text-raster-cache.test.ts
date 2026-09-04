import { describe, expect, it } from 'vitest';

import type { SceneDescription, SceneRect } from '@openchart/scene';

import {
  CanvasTextRasterCache,
  SceneViewportRenderer,
  type CanvasPaintContext,
  type CanvasRasterSurface,
  type CanvasTextMeasurement,
} from '../src/index.js';

interface ContextRecording {
  readonly calls: string[];
  readonly scales: Array<readonly [number, number]>;
  readonly context: CanvasPaintContext;
  readonly measurementCount: () => number;
}

function recordingContext(measurement: CanvasTextMeasurement): ContextRecording {
  const calls: string[] = [];
  const scales: Array<readonly [number, number]> = [];
  const properties = new Map<PropertyKey, unknown>([['globalAlpha', 1]]);
  let measurements = 0;
  const context = new Proxy(
    {},
    {
      get: (_target, property) => {
        if (property === 'measureText') {
          return () => {
            measurements += 1;
            return measurement;
          };
        }
        if (property === 'scale') {
          return (x: number, y: number) => {
            calls.push('scale');
            scales.push([x, y]);
          };
        }
        return properties.get(property) ?? (() => calls.push(String(property)));
      },
      has: (_target, property) => properties.has(property),
      set: (_target, property, value: unknown) => {
        properties.set(property, value);
        return true;
      },
    },
  ) as CanvasPaintContext;
  return { calls, scales, context, measurementCount: () => measurements };
}

function textScene(): SceneDescription {
  const label = (id: string, x: number): SceneDescription['items'][number] => ({
    type: 'group',
    id,
    role: 'node',
    entityId: id,
    children: [
      {
        type: 'text',
        id: `${id}-label`,
        value: 'AB',
        at: { x, y: 50 },
        fill: '#0f172a',
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: 10,
        fontWeight: 600,
        underline: true,
        letterSpacing: 1,
        anchor: 'middle',
      },
    ],
  });

  return {
    version: 1,
    bounds: { x: 0, y: 0, width: 300, height: 100 },
    title: 'Text cache probe',
    description: 'Two repeated labels.',
    items: [
      {
        type: 'group',
        id: 'artboard',
        role: 'artboard',
        children: [label('node-a', 100), label('node-b', 200)],
      },
    ],
  };
}

describe('CanvasTextRasterCache', () => {
  it('reuses measured metrics and text pixels across full and dirty paints', () => {
    const measurement: CanvasTextMeasurement = {
      width: 40,
      actualBoundingBoxLeft: 1,
      actualBoundingBoxRight: 39,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
    };
    const target = recordingContext(measurement);
    const createdSizes: Array<readonly [number, number]> = [];
    const offscreen: ContextRecording[] = [];
    const blits: SceneRect[] = [];
    const cache = new CanvasTextRasterCache((width, height): CanvasRasterSurface => {
      createdSizes.push([width, height]);
      const surfaceContext = recordingContext(measurement);
      offscreen.push(surfaceContext);
      return {
        width,
        height,
        context: surfaceContext.context,
        blit: (_target, destination) => blits.push(destination),
      };
    });
    const renderer = new SceneViewportRenderer(textScene());
    const camera = {
      x: 0,
      y: 0,
      zoom: 0.75,
      viewportWidth: 300,
      viewportHeight: 100,
    } as const;

    renderer.paint(target.context, camera, { textCache: cache, devicePixelRatio: 1.25 });

    expect(target.measurementCount()).toBe(1);
    expect(createdSizes).toEqual([[55, 15]]);
    expect(offscreen[0]?.calls.filter((call) => call === 'fillText')).toHaveLength(1);
    expect(offscreen[0]?.calls.filter((call) => call === 'stroke')).toHaveLength(1);
    expect(offscreen[0]?.scales).toEqual([[1.25, 1.25]]);
    expect(target.calls).not.toContain('fillText');
    expect(blits).toEqual([
      { x: 77.5, y: 41, width: 44, height: 12 },
      { x: 177.5, y: 41, width: 44, height: 12 },
    ]);
    expect(cache.stats).toMatchObject({ entries: 1, hits: 1, misses: 1 });

    renderer.paintDirty(
      target.context,
      camera,
      [{ x: 70, y: 35, width: 60, height: 30 }],
      { textCache: cache, devicePixelRatio: 1.25 },
    );

    expect(target.measurementCount()).toBe(1);
    expect(createdSizes).toEqual([[55, 15]]);
    expect(blits).toHaveLength(3);
    expect(cache.stats).toMatchObject({ entries: 1, hits: 2, misses: 1 });
  });

  it('preserves the requested raster scale when pixel allocation rounds up', () => {
    const measurement: CanvasTextMeasurement = {
      width: 40.2,
      actualBoundingBoxLeft: 1,
      actualBoundingBoxRight: 39.2,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
    };
    const target = recordingContext(measurement);
    const createdSizes: Array<readonly [number, number]> = [];
    const offscreen: ContextRecording[] = [];
    const blits: SceneRect[] = [];
    const cache = new CanvasTextRasterCache((width, height): CanvasRasterSurface => {
      createdSizes.push([width, height]);
      const surfaceContext = recordingContext(measurement);
      offscreen.push(surfaceContext);
      return {
        width,
        height,
        context: surfaceContext.context,
        blit: (_target, destination) => blits.push(destination),
      };
    });

    new SceneViewportRenderer(textScene()).paint(
      target.context,
      { x: 0, y: 0, zoom: 1, viewportWidth: 300, viewportHeight: 100 },
      { textCache: cache, devicePixelRatio: 1.25 },
    );

    expect(createdSizes).toEqual([[56, 15]]);
    expect(offscreen[0]?.scales).toEqual([[1.25, 1.25]]);
    expect(blits[0]).toEqual({ x: 77.4, y: 41, width: 44.8, height: 12 });
  });

  it('rejects a non-finite text measurement', () => {
    const invalidTarget = recordingContext({ width: Number.NaN });
    const cache = new CanvasTextRasterCache((width, height) => ({
      width,
      height,
      context: recordingContext({ width: 1 }).context,
      blit: () => undefined,
    }));

    expect(() =>
      new SceneViewportRenderer(textScene()).paint(
        invalidTarget.context,
        { x: 0, y: 0, zoom: 1, viewportWidth: 300, viewportHeight: 100 },
        { textCache: cache },
      ),
    ).toThrow(/text measurement.*finite/i);
  });
});
