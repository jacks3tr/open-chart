import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { validateDocument } from '@openchart/ir';
import { buildSceneDescription, type SceneDescription } from '@openchart/scene';

import {
  paintSceneLayerToCanvas,
  paintSceneToCanvas,
  type CanvasPaintContext,
} from '../src/canvas.js';

const fixturePath = fileURLToPath(
  new URL('../../../examples/northstar-integration.openchart.json', import.meta.url),
);

interface PaintRecording {
  readonly calls: string[];
  readonly strokeWidths: number[];
}

function recordingContext(recording: PaintRecording): CanvasPaintContext {
  const properties = new Map<PropertyKey, unknown>([['globalAlpha', 1]]);
  return new Proxy(
    {},
    {
      get: (_target, property) => {
        if (property === 'measureText') {
          return () => {
            recording.calls.push('measureText');
            return { width: 40 };
          };
        }
        if (property === 'stroke') {
          return () => {
            recording.calls.push('stroke');
            recording.strokeWidths.push(Number(properties.get('lineWidth')));
          };
        }
        return properties.get(property) ?? (() => recording.calls.push(String(property)));
      },
      has: (_target, property) => properties.has(property),
      set: (_target, property, value: unknown) => {
        properties.set(property, value);
        return true;
      },
    },
  ) as CanvasPaintContext;
}

describe('paintSceneToCanvas', () => {
  it('paints the resolved scene without reading document semantics', () => {
    const input: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const validation = validateDocument(input);
    if (!validation.ok) {
      throw new Error(`Invalid visual fixture: ${JSON.stringify(validation.diagnostics)}`);
    }

    const scene = buildSceneDescription(validation.document);
    const full: PaintRecording = { calls: [], strokeWidths: [] };
    const compact: PaintRecording = { calls: [], strokeWidths: [] };
    const chrome: PaintRecording = { calls: [], strokeWidths: [] };
    const minimal: PaintRecording = { calls: [], strokeWidths: [] };
    const background: PaintRecording = { calls: [], strokeWidths: [] };
    const main: PaintRecording = { calls: [], strokeWidths: [] };
    const overlay: PaintRecording = { calls: [], strokeWidths: [] };

    paintSceneToCanvas(scene, recordingContext(full), { zoom: 1 });
    paintSceneToCanvas(scene, recordingContext(compact), { zoom: 0.5 });
    paintSceneToCanvas(scene, recordingContext(chrome), { zoom: 0.25 });
    paintSceneToCanvas(scene, recordingContext(minimal), { zoom: 0.1 });
    paintSceneLayerToCanvas(scene, 'background', recordingContext(background));
    paintSceneLayerToCanvas(scene, 'main', recordingContext(main));
    paintSceneLayerToCanvas(scene, 'overlay', recordingContext(overlay));

    const fullTextCount = full.calls.filter((call) => call === 'fillText').length;
    const compactTextCount = compact.calls.filter((call) => call === 'fillText').length;
    expect(full.calls).toContain('quadraticCurveTo');
    expect(full.calls).toContain('ellipse');
    expect(fullTextCount).toBeGreaterThan(20);
    expect(compactTextCount).toBeGreaterThan(0);
    expect(compactTextCount).toBeLessThan(fullTextCount);
    expect(chrome.calls).not.toContain('fillText');
    expect(minimal.calls).not.toContain('fillText');
    expect(minimal.strokeWidths).toContain(10);
    expect(background.calls).not.toContain('arc');
    expect(background.calls).not.toContain('fillText');
    expect(main.calls.filter((call) => call === 'fillText').length).toBeGreaterThan(20);
    expect(overlay.calls).not.toContain('beginPath');
    expect(overlay.calls).not.toContain('fillText');
  });

  it('applies shape rotation and clipping before tracing cubic paths', () => {
    const scene: SceneDescription = {
      version: 1,
      bounds: { x: 0, y: 0, width: 100, height: 80 },
      title: 'Shape features',
      description: 'Cubic path, rotation, and clip proof.',
      items: [
        {
          id: 'artboard',
          type: 'group',
          role: 'artboard',
          children: [
            {
              id: 'shape-group',
              type: 'group',
              role: 'shape',
              transform: { rotation: 30, origin: { x: 40, y: 30 } },
              clip: {
                items: [
                  {
                    id: 'clip-window',
                    type: 'rect',
                    frame: { x: 10, y: 10, width: 60, height: 40 },
                    radius: 8,
                  },
                ],
              },
              children: [
                {
                  id: 'curve',
                  type: 'path',
                  commands: [
                    { type: 'move', to: { x: 20, y: 20 } },
                    {
                      type: 'cubic',
                      control1: { x: 30, y: 10 },
                      control2: { x: 50, y: 30 },
                      to: { x: 60, y: 20 },
                    },
                  ],
                  fill: 'none',
                  stroke: '#2563EB',
                  strokeWidth: 2,
                },
              ],
            },
          ],
        },
      ],
    };
    const recording: PaintRecording = { calls: [], strokeWidths: [] };

    paintSceneToCanvas(scene, recordingContext(recording));

    expect(recording.calls).toEqual(
      expect.arrayContaining([
        'translate',
        'rotate',
        'clip',
        'bezierCurveTo',
        'stroke',
      ]),
    );
    expect(recording.calls.indexOf('rotate')).toBeLessThan(
      recording.calls.indexOf('clip'),
    );
    expect(recording.calls.indexOf('clip')).toBeLessThan(
      recording.calls.indexOf('bezierCurveTo'),
    );
  });

  it('paints distinct start and end connector markers', () => {
    const scene: SceneDescription = {
      version: 1,
      bounds: { x: 0, y: 0, width: 120, height: 80 },
      title: 'Connector notation',
      description: 'Start and end marker proof.',
      items: [
        {
          id: 'notation-line',
          type: 'path',
          commands: [
            { type: 'move', to: { x: 20, y: 40 } },
            { type: 'line', to: { x: 100, y: 40 } },
          ],
          fill: 'none',
          stroke: '#2563EB',
          strokeWidth: 2,
          markerStart: { type: 'diamond', size: 7, fill: '#2563EB' },
          markerEnd: { type: 'crow-foot', size: 7, fill: '#2563EB' },
        },
      ],
    };
    const recording: PaintRecording = { calls: [], strokeWidths: [] };

    const stats = paintSceneToCanvas(scene, recordingContext(recording));

    expect(stats.drawCallCount).toBeGreaterThanOrEqual(3);
    expect(recording.calls).toContain('fill');
    expect(recording.calls.filter((call) => call === 'stroke').length).toBeGreaterThanOrEqual(2);
  });

  it('paints underlined scene text with a measured baseline rule', () => {
    const scene: SceneDescription = {
      version: 1,
      bounds: { x: 0, y: 0, width: 160, height: 80 },
      title: 'Underlined text',
      description: 'Canvas underline proof.',
      items: [{
        type: 'text',
        id: 'underlined-label',
        value: 'OpenChart',
        at: { x: 80, y: 40 },
        fill: '#7C3AED',
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: 16,
        underline: true,
        anchor: 'middle',
      }],
    };
    const recording: PaintRecording = { calls: [], strokeWidths: [] };

    paintSceneToCanvas(scene, recordingContext(recording));

    expect(recording.calls).toEqual(expect.arrayContaining([
      'fillText',
      'measureText',
      'beginPath',
      'moveTo',
      'lineTo',
      'stroke',
    ]));
    expect(recording.strokeWidths).toContain(1);
  });
});
