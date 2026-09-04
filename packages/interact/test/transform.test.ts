import { describe, expect, test } from 'vitest';

import type { Node, OpenChartDocument } from '@openchart/ir';
import { OperationEngine } from '@openchart/ops';

import {
  createTransformTransaction,
  resizeSelection,
  rotateSelection,
  translateSelection,
  type TransformFrame,
} from '../src/index.js';

const uid = (value: number): string => value.toString().padStart(26, '0');

function node(
  id: string,
  uidValue: number,
  layerId: string,
  parentId?: string,
): Node {
  return {
    id,
    uid: uid(uidValue),
    kind: 'service',
    label: id,
    pageId: 'page.main',
    layerId,
    styleId: 'style.node',
    ...(parentId === undefined ? {} : { parentId }),
    data: {},
  };
}

function documentFixture(): OpenChartDocument {
  return {
    schemaVersion: 1,
    documentId: 'document.main',
    uid: uid(1),
    title: 'Transform test',
    rev: 0,
    pages: {
      'page.main': {
        id: 'page.main',
        uid: uid(2),
        name: 'Main',
        layerIds: ['layer.main', 'layer.locked'],
      },
    },
    layers: {
      'layer.main': {
        id: 'layer.main',
        uid: uid(3),
        name: 'Main',
        pageId: 'page.main',
        visible: true,
        locked: false,
      },
      'layer.locked': {
        id: 'layer.locked',
        uid: uid(4),
        name: 'Locked',
        pageId: 'page.main',
        visible: true,
        locked: true,
      },
    },
    nodes: {
      systems: {
        ...node('systems', 10, 'layer.main'),
        container: { magnetize: true },
      },
      'systems.api': node('systems.api', 11, 'layer.locked', 'systems'),
      outside: node('outside', 12, 'layer.main'),
      grouped: {
        ...node('grouped', 13, 'layer.main'),
        group: {},
      },
      'grouped.child': node('grouped.child', 14, 'layer.main', 'grouped'),
    },
    ports: {},
    edges: {},
    styles: {
      'style.node': {
        id: 'style.node',
        uid: uid(20),
        role: 'service',
        tokens: {},
      },
    },
    layout: { overrides: {}, derived: null },
    meta: {
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    },
  };
}

const frames = {
  systems: { x: 0, y: 0, width: 120, height: 120 },
  'systems.api': { x: 16, y: 48, width: 72, height: 32 },
  outside: { x: 200, y: 0, width: 72, height: 32 },
  grouped: { x: 200, y: 80, width: 100, height: 80 },
  'grouped.child': { x: 216, y: 96, width: 68, height: 32 },
} as const satisfies Readonly<Record<string, TransformFrame>>;

describe('transform transactions', () => {
  test('previews and commits proportional container transforms', () => {
    const document = documentFixture();
    const preview = translateSelection(document, frames, ['systems'], {
      x: 24,
      y: 36,
    });

    expect(preview).toEqual({
      selectionBounds: { x: 24, y: 36, width: 120, height: 120 },
      updates: {
        systems: { x: 24, y: 36, width: 120, height: 120 },
        'systems.api': { x: 40, y: 84, width: 72, height: 32 },
      },
    });

    const envelope = createTransformTransaction(document, preview, {
      txId: 'tx.move-systems',
    });
    expect(envelope.ops.map((operation) => ('id' in operation ? operation.id : ''))).toEqual([
      'systems',
      'systems.api',
    ]);

    const engine = new OperationEngine(document);
    expect(engine.apply(envelope)).toMatchObject({ ok: true, rev: 1 });
    expect(engine.document.layout.overrides).toEqual({
      systems: { x: 24, y: 36, width: 120, height: 120, pinned: true },
      'systems.api': { x: 40, y: 84, width: 72, height: 32, pinned: true },
    });
    expect(engine.document.layout.overrides.outside).toBeUndefined();

    expect(resizeSelection(document, frames, ['systems'], 'east', { x: 60, y: 0 })).toEqual({
      selectionBounds: { x: 0, y: 0, width: 180, height: 120 },
      updates: {
        systems: { x: 0, y: 0, width: 180, height: 120 },
        'systems.api': { x: 24, y: 48, width: 108, height: 32 },
      },
    });

    expect(
      resizeSelection(
        document,
        frames,
        ['systems'],
        'south-east',
        { x: 30, y: 10 },
        { fromCenter: true, keepAspectRatio: true },
      ),
    ).toEqual({
      selectionBounds: { x: -30, y: -30, width: 180, height: 180 },
      updates: {
        systems: { x: -30, y: -30, width: 180, height: 180 },
        'systems.api': { x: -6, y: 42, width: 108, height: 48 },
      },
    });

    const rotated = rotateSelection(document, frames, ['outside'], 22, {
      snapIncrement: 15,
    });
    expect(rotated).toEqual({
      selectionBounds: { x: 200, y: 0, width: 72, height: 32, rotation: 15 },
      updates: {
        outside: { x: 200, y: 0, width: 72, height: 32, rotation: 15 },
      },
    });
    const rotationEngine = new OperationEngine(document);
    expect(
      rotationEngine.apply(
        createTransformTransaction(document, rotated, { txId: 'tx.rotate-outside' }),
      ),
    ).toMatchObject({ ok: true, rev: 1 });
    expect(rotationEngine.document.layout.overrides.outside).toEqual({
      x: 200,
      y: 0,
      width: 72,
      height: 32,
      rotation: 15,
      pinned: true,
    });

    expect(
      translateSelection(document, frames, ['grouped'], { x: 10, y: 20 }).updates,
    ).toEqual({
      grouped: { x: 210, y: 100, width: 100, height: 80 },
      'grouped.child': { x: 226, y: 116, width: 68, height: 32 },
    });
  });

  test('enforces direct-layer locks and the container magnetize boundary', () => {
    expect(() =>
      translateSelection(documentFixture(), frames, ['systems.api'], { x: 1, y: 1 }),
    ).toThrow('locked layer');

    const unmagnetized = documentFixture();
    unmagnetized.nodes.systems = {
      ...unmagnetized.nodes.systems!,
      container: { magnetize: false },
    };
    expect(
      translateSelection(unmagnetized, frames, ['systems'], { x: 1, y: 1 }).updates,
    ).toEqual({
      systems: { x: 1, y: 1, width: 120, height: 120 },
    });

    expect(
      resizeSelection(unmagnetized, frames, ['systems'], 'west', { x: 200, y: 0 })
        .selectionBounds,
    ).toEqual({ x: 104, y: 0, width: 16, height: 120 });

    expect(() => rotateSelection(unmagnetized, frames, ['systems'], 15)).toThrow(
      'Containers cannot be rotated',
    );
    expect(() => rotateSelection(unmagnetized, frames, ['grouped'], 15)).toThrow(
      'Groups cannot be rotated',
    );
  });
});
