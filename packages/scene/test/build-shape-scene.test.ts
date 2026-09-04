import { describe, expect, it } from 'vitest';

import {
  evaluateShapeDefinition,
  type ShapeDefinition,
} from '@openchart/shapes';

import { buildShapeSceneDescription } from '../src/shapes.js';

const adapterShape = {
  version: 1,
  id: 'integration.adapter',
  name: 'Integration adapter',
  defaultSize: { width: 200, height: 120 },
  composition: 'left',
  geometry: [
    {
      id: 'body',
      type: 'rect',
      radius: 12,
      fill: '#EFF6FF',
      stroke: '#2563EB',
      strokeWidth: 2,
    },
    {
      id: 'signal',
      type: 'path',
      commands: [
        { type: 'move', x: 0.1, y: 0.6 },
        {
          type: 'cubic',
          c1x: 0.3,
          c1y: 0.2,
          c2x: 0.7,
          c2y: 1,
          x: 0.9,
          y: 0.4,
        },
      ],
      fill: 'none',
      stroke: '#0F172A',
      strokeWidth: 2,
    },
  ],
  textAreas: [
    {
      id: 'label',
      bounds: { x: 0.2, y: 0.1, w: 0.6, h: 0.2 },
      text: 'Adapter',
    },
  ],
  clip: {
    geometry: [
      {
        id: 'window',
        type: 'ellipse',
        x: 0.02,
        y: 0.02,
        w: 0.96,
        h: 0.96,
      },
    ],
    stroke: '#2563EB',
    strokeWidth: 1,
  },
  shapes: [
    {
      id: 'rotor',
      bounds: {
        x: 0.75,
        y: 0.5,
        w: 0.25,
        h: 0.4,
        anchor: 'center',
        rotation: 30,
      },
      geometry: [
        {
          id: 'blade',
          type: 'polygon',
          points: [
            { x: 0.5, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
          ],
          fill: '#FF6A3D',
        },
      ],
    },
  ],
} satisfies ShapeDefinition;

describe('buildShapeSceneDescription', () => {
  it('adapts evaluated geometry, text, clipping, composition, and rotation', () => {
    const evaluated = evaluateShapeDefinition(adapterShape, {
      frame: { x: 40, y: 30, width: 200, height: 120 },
    });
    if (!evaluated.ok) {
      throw new Error(JSON.stringify(evaluated.diagnostics));
    }

    const scene = buildShapeSceneDescription(
      [{ id: 'adapter-1', shape: evaluated.shape }],
      {
        bounds: { x: 0, y: 0, width: 320, height: 220 },
        title: 'Shape adapter proof',
        description: 'One evaluated integration adapter.',
      },
    );

    expect(scene).toMatchObject({
      version: 1,
      bounds: { x: 0, y: 0, width: 320, height: 220 },
      title: 'Shape adapter proof',
      description: 'One evaluated integration adapter.',
    });
    const artboard = scene.items[0];
    expect(artboard).toMatchObject({ type: 'group', role: 'artboard' });
    if (artboard?.type !== 'group') {
      throw new Error('Expected a shape artboard group');
    }
    const shapeGroup = artboard.children[0];
    expect(shapeGroup).toMatchObject({
      type: 'group',
      role: 'shape',
      entityId: 'adapter-1',
      ariaLabel: 'Integration adapter',
      composition: 'left',
      clip: {
        items: [
          {
            type: 'ellipse',
            center: { x: 140, y: 90 },
            radiusX: 96,
            radiusY: 57.6,
          },
        ],
      },
    });
    if (shapeGroup?.type !== 'group') {
      throw new Error('Expected an evaluated shape group');
    }
    expect(shapeGroup.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'path',
        }),
        expect.objectContaining({
          type: 'text',
          value: 'Adapter',
          minZoom: 0.4,
          anchor: 'middle',
        }),
        expect.objectContaining({
          type: 'group',
          role: 'shape',
          transform: {
            rotation: 30,
            origin: { x: 190, y: 90 },
          },
        }),
      ]),
    );
    const signal = shapeGroup.children.find(
      (item) => item.type === 'path' && item.id.endsWith('geometry-signal'),
    );
    expect(signal?.type).toBe('path');
    if (signal?.type !== 'path') {
      throw new Error('Expected the adapted signal path');
    }
    expect(signal.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'cubic',
          control1: { x: 100, y: 54 },
          control2: { x: 180, y: 150 },
          to: { x: 220, y: 78 },
        }),
      ]),
    );
    expect(shapeGroup.children.at(-1)).toMatchObject({
      type: 'ellipse',
      fill: 'none',
      stroke: '#2563EB',
      strokeWidth: 1,
    });
  });

  it('rejects boolean operations the current scene contract cannot preserve', () => {
    const evaluated = evaluateShapeDefinition(
      {
        ...adapterShape,
        geometry: [
          {
            id: 'unsupported',
            type: 'boolean',
            operation: 'difference',
            geometry: [
              { id: 'outer', type: 'rect', fill: '#2563EB' },
              {
                id: 'inner',
                type: 'ellipse',
                x: 0.25,
                y: 0.25,
                w: 0.5,
                h: 0.5,
              },
            ],
          },
        ],
      },
      { frame: { x: 0, y: 0, width: 200, height: 120 } },
    );
    if (!evaluated.ok) {
      throw new Error(JSON.stringify(evaluated.diagnostics));
    }

    expect(() =>
      buildShapeSceneDescription([{ id: 'boolean-1', shape: evaluated.shape }]),
    ).toThrowError(
      'Shape scene adapter cannot represent boolean operation "difference" faithfully; only "union" may be flattened',
    );
  });
});
