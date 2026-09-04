import { describe, expect, it } from 'vitest';

import {
  evaluateShapeDefinition,
  type ShapeDefinition,
} from '../src/index.js';

const serviceShape = {
  version: 1,
  id: 'integration.service',
  name: 'Integration service',
  defaultSize: { width: 240, height: 120 },
  composition: 'above',
  properties: [
    { name: 'Label', type: 'string', default: 'Mapping service' },
    {
      name: 'Progress',
      type: 'number',
      default: 0.6,
      constraints: [
        {
          condition: '=@Progress >= 0 && @Progress <= 1',
          resolution: '=1',
          message: 'Progress must be between zero and one',
        },
      ],
    },
    { name: 'Enabled', type: 'boolean', default: true },
    { name: 'Rows', type: 'number', default: 3 },
  ],
  defs: [
    { name: 'Inset', value: 0.08 },
    { name: 'ContentWidth', value: '=1 - @Inset * 2' },
  ],
  textAreas: [
    {
      id: 'label',
      bounds: {
        x: '=@Inset',
        y: 0.16,
        w: '=@ContentWidth',
        h: 0.24,
      },
      text: '=@Label',
    },
  ],
  linkPoints: [{ id: 'east-link', x: '=1 - @Inset', y: 0.5 }],
  ports: [
    { id: 'in', direction: 'in', side: 'west', x: 0, y: 0.5 },
    { id: 'out', direction: 'out', side: 'east', x: 1, y: 0.5 },
  ],
  geometry: [
    {
      id: 'body',
      type: 'rect',
      x: '=@Inset',
      y: 0.08,
      w: '=@ContentWidth',
      h: 0.84,
      radius: 8,
      fill: '#F0FBFA',
      stroke: '#00A7A5',
      strokeWidth: 1.5,
    },
    {
      id: 'progress',
      type: 'rect',
      condition: '=@Enabled',
      x: '=@Inset',
      y: 0.84,
      w: '=@ContentWidth * @Progress',
      h: 0.04,
      fill: '#00A7A5',
    },
    {
      id: 'row-dot',
      type: 'ellipse',
      repeat: { type: 'for', min: 0, max: '=@Rows - 1', index: 'Row' },
      x: '=0.3 + @Row * 0.2',
      y: 0.64,
      w: 0.04,
      h: 0.08,
      fill: '#10213A',
    },
    {
      id: 'signal',
      type: 'path',
      stroke: '#10213A',
      strokeWidth: 2,
      commands: [
        { type: 'move', x: 0.16, y: 0.55 },
        { type: 'line', x: 0.25, y: 0.55 },
        { type: 'quadratic', cx: 0.28, cy: 0.55, x: 0.28, y: 0.62 },
      ],
    },
  ],
  shapes: [
    {
      id: 'status',
      condition: '=@Enabled',
      bounds: {
        x: 1,
        y: 0,
        w: 24,
        h: 24,
        absolute: 'wh',
        anchor: 'top-right',
      },
      geometry: [
        {
          id: 'ring',
          type: 'ellipse',
          fill: '#FFFFFF',
          stroke: '#00A7A5',
          strokeWidth: 2,
        },
      ],
    },
  ],
} satisfies ShapeDefinition;

describe('evaluateShapeDefinition', () => {
  it('evaluates the declarative phases into deterministic absolute geometry', () => {
    const result = evaluateShapeDefinition(serviceShape, {
      frame: { x: 10, y: 20, width: 240, height: 120 },
      data: { Label: 'Forge mapping', Progress: 0.75 },
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) {
      throw new Error(JSON.stringify(result.diagnostics));
    }

    expect(result.shape.composition).toBe('above');
    expect(result.shape.data).toEqual({
      Label: 'Forge mapping',
      Progress: 0.75,
      Enabled: true,
      Rows: 3,
    });
    expect(result.shape.geometry.map((geometry) => geometry.id)).toEqual([
      'body',
      'progress',
      'row-dot[0]',
      'row-dot[1]',
      'row-dot[2]',
      'signal',
    ]);
    expect(result.shape.geometry[0]).toMatchObject({
      type: 'rect',
      frame: { x: 29.2, y: 29.6, width: 201.6, height: 100.8 },
    });
    expect(result.shape.geometry[2]).toMatchObject({
      type: 'ellipse',
      frame: { x: 82, y: 96.8, width: 9.6, height: 9.6 },
    });
    expect(result.shape.textAreas).toEqual([
      {
        id: 'label',
        frame: { x: 29.2, y: 39.2, width: 201.6, height: 28.8 },
        text: 'Forge mapping',
        editable: true,
      },
    ]);
    expect(result.shape.linkPoints).toEqual([
      { id: 'east-link', point: { x: 230.8, y: 80 } },
    ]);
    expect(result.shape.ports).toEqual([
      { id: 'in', direction: 'in', side: 'west', point: { x: 10, y: 80 } },
      { id: 'out', direction: 'out', side: 'east', point: { x: 250, y: 80 } },
    ]);
    expect(result.shape.children[0]).toMatchObject({
      id: 'status',
      bounds: { x: 226, y: 20, width: 24, height: 24, rotation: 0 },
      geometry: [
        {
          id: 'status.ring',
          type: 'ellipse',
          frame: { x: 226, y: 20, width: 24, height: 24 },
        },
      ],
    });
  });

  it('returns a precise diagnostic instead of executing unsupported formulas', () => {
    const result = evaluateShapeDefinition(
      {
        ...serviceShape,
        defs: [{ name: 'Inset', value: '=globalThis.process.exit()' }],
      },
      { frame: { x: 0, y: 0, width: 240, height: 120 } },
    );

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          code: 'FORMULA_INVALID',
          path: 'defs.0.value',
          message: 'Unexpected token "globalThis" at offset 0',
        },
      ],
    });
  });
});
