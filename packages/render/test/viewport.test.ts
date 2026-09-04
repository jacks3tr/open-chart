import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { validateDocument } from '@openchart/ir';
import { buildSceneDescription, type SceneDescription } from '@openchart/scene';

import { type CanvasPaintContext, SceneViewportRenderer } from '../src/index.js';

const fixturePath = fileURLToPath(
  new URL('../../../examples/northstar-integration.openchart.json', import.meta.url),
);

function recordingContext(
  calls: string[],
  recordedRects: Array<readonly [number, number, number, number]> = [],
): CanvasPaintContext {
  const properties = new Map<PropertyKey, unknown>([['globalAlpha', 1]]);
  return new Proxy(
    {},
    {
      get: (_target, property) => {
        if (property === 'rect') {
          return (x: number, y: number, width: number, height: number) => {
            calls.push('rect');
            recordedRects.push([x, y, width, height]);
          };
        }
        return properties.get(property) ?? (() => {
          calls.push(String(property));
        });
      },
      has: (_target, property) => properties.has(property),
      set: (_target, property, value: unknown) => {
        properties.set(property, value);
        return true;
      },
    },
  ) as CanvasPaintContext;
}

describe('SceneViewportRenderer', () => {
  it('indexes resolved groups and paints only the camera-visible subset in z-order', () => {
    const input: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const validation = validateDocument(input);
    if (!validation.ok) {
      throw new Error(`Invalid visual fixture: ${JSON.stringify(validation.diagnostics)}`);
    }

    const renderer = new SceneViewportRenderer(buildSceneDescription(validation.document));
    const leftGroups = renderer.query({ x: 40, y: 180, width: 430, height: 420 });

    expect(renderer.totalIndexedGroups).toBe(16);
    expect(leftGroups.map((group) => group.entityId)).toContain('system.northstar');
    expect(leftGroups.map((group) => group.entityId)).not.toContain('system.forge');

    const calls: string[] = [];
    const stats = renderer.paint(recordingContext(calls), {
      x: 40,
      y: 180,
      zoom: 1,
      viewportWidth: 430,
      viewportHeight: 420,
    });

    expect(stats.visibleIndexedGroups).toBeLessThan(stats.totalIndexedGroups);
    expect(stats.drawCallCount).toBeGreaterThan(0);
    expect(stats.visibleEntityIds).toContain('system.northstar');
    expect(stats.visibleEntityIds).not.toContain('system.forge');
    expect(calls).toContain('clearRect');
    expect(calls).toContain('scale');
    expect(calls).toContain('translate');
    expect(calls).toContain('fillText');

    const lowDetailCalls: string[] = [];
    renderer.paint(recordingContext(lowDetailCalls), {
      x: 0,
      y: 0,
      zoom: 0.25,
      viewportWidth: 430,
      viewportHeight: 420,
    });
    expect(lowDetailCalls).not.toContain('fillText');

    const dirtyCalls: string[] = [];
    const dirtyStats = renderer.paintDirty(
      recordingContext(dirtyCalls),
      {
        x: 40,
        y: 180,
        zoom: 1,
        viewportWidth: 430,
        viewportHeight: 420,
      },
      [{ x: 40, y: 180, width: 430, height: 420 }],
      { layer: 'main' },
    );
    expect(dirtyStats.dirtyRectCount).toBe(1);
    expect(dirtyStats.visibleEntityIds).toContain('system.northstar');
    expect(dirtyStats.visibleEntityIds).not.toContain('system.forge');
    expect(dirtyStats.drawCallCount).toBeGreaterThan(0);
    expect(dirtyCalls).toContain('rect');
    expect(dirtyCalls).toContain('clip');
    expect(dirtyCalls).toContain('clearRect');
    expect(dirtyCalls).toContain('fillText');

    const fractionalRects: Array<readonly [number, number, number, number]> = [];
    renderer.paintDirty(
      recordingContext([], fractionalRects),
      {
        x: 40,
        y: 180,
        zoom: 1,
        viewportWidth: 430,
        viewportHeight: 420,
      },
      [{ x: 40.1, y: 180.1, width: 10, height: 10 }],
      { layer: 'main', devicePixelRatio: 1.25 },
    );
    expect(fractionalRects).toEqual([[0, 0, 10.4, 10.4]]);
  });

  it('keeps screen-sized minimal-detail markers when the base path is just off-screen', () => {
    const scene: SceneDescription = {
      version: 1,
      bounds: { x: -200, y: -200, width: 400, height: 400 },
      title: 'Marker culling probe',
      description: 'A short connector whose low-zoom arrow reaches the viewport.',
      items: [
        {
          type: 'group',
          id: 'artboard',
          role: 'artboard',
          children: [
            {
              type: 'group',
              id: 'edge-probe',
              role: 'edge',
              entityId: 'edge.probe',
              children: [
                {
                  type: 'path',
                  id: 'edge-probe-flow',
                  commands: [
                    { type: 'move', to: { x: 10, y: -50 } },
                    { type: 'line', to: { x: 20, y: -50 } },
                  ],
                  stroke: '#000000',
                  strokeWidth: 2.4,
                  markerEnd: { type: 'arrow', size: 7, fill: '#000000' },
                  lowZoomStrokeWidth: 1,
                },
              ],
            },
          ],
        },
      ],
    };
    const renderer = new SceneViewportRenderer(scene);
    const calls: string[] = [];
    const stats = renderer.paint(recordingContext(calls), {
      x: 0,
      y: 0,
      zoom: 0.02,
      viewportWidth: 2,
      viewportHeight: 2,
    });

    expect(stats.visibleEntityIds).toContain('edge.probe');
  });

  it('indexes clipped shape groups at their transformed bounds', () => {
    const scene: SceneDescription = {
      version: 1,
      bounds: { x: -40, y: -20, width: 100, height: 80 },
      title: 'Transformed shape probe',
      description: 'A clipped shape rotated into the negative x axis.',
      items: [
        {
          id: 'artboard',
          type: 'group',
          role: 'artboard',
          children: [
            {
              id: 'shape-probe',
              type: 'group',
              role: 'shape',
              entityId: 'shape.probe',
              transform: { rotation: 90, origin: { x: 0, y: 0 } },
              clip: {
                items: [
                  {
                    id: 'shape-clip',
                    type: 'rect',
                    frame: { x: 0, y: 0, width: 10, height: 10 },
                  },
                ],
              },
              children: [
                {
                  id: 'shape-body',
                  type: 'rect',
                  frame: { x: 0, y: 0, width: 30, height: 10 },
                  fill: '#2563EB',
                },
              ],
            },
          ],
        },
      ],
    };
    const renderer = new SceneViewportRenderer(scene);

    expect(renderer.totalIndexedGroups).toBe(1);
    expect(
      renderer.query({ x: -11, y: -1, width: 12, height: 12 }).map((group) =>
        group.entityId,
      ),
    ).toEqual(['shape.probe']);
    expect(renderer.query({ x: 15, y: 0, width: 10, height: 10 })).toEqual([]);
  });
});
