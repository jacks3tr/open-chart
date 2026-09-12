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
  test.each(['overrides', 'derived'] as const)('moves internal connector bends with grouped shapes from %s', (source) => {
    const document = documentFixture();
    document.nodes['grouped.sibling'] = node('grouped.sibling', 15, 'layer.main', 'grouped');
    const connectedFrames = { ...frames, 'grouped.sibling': { x: 240, y: 144, width: 68, height: 32 } };
    document.layout[source] = connectedFrames;
    if (source === 'derived') document.layout.overrides['grouped.child'] = { ...frames['grouped.child'], x: 900, pinned: false };
    document.ports = {
      child: { id: 'child', uid: uid(30), nodeId: 'grouped.child', direction: 'out', side: 'south' },
      sibling: { id: 'sibling', uid: uid(31), nodeId: 'grouped.sibling', direction: 'in', side: 'north' },
      outside: { id: 'outside', uid: uid(32), nodeId: 'outside', direction: 'in', side: 'west' },
    };
    const edge = {
      id: 'internal', uid: uid(33), fromPortId: 'child', toPortId: 'sibling', label: 'Review', semantic: 'Request',
      pageId: 'page.main', layerId: 'layer.main', styleId: 'style.node', data: {},
    };
    document.edges = { internal: edge, external: { ...edge, id: 'external', uid: uid(34), toPortId: 'outside' } };
    document.layout.edgeOverrides = {
      internal: { waypoints: [{ x: 250, y: 136 }, { x: 274, y: 136 }], labelT: 0.6 },
      external: { waypoints: [{ x: 184, y: 112 }] },
    };
    const engine = new OperationEngine(document);
    const moved = translateSelection(document, connectedFrames, ['grouped'], { x: 8, y: 16 });
    expect(engine.apply(createTransformTransaction(document, moved, { txId: 'tx.move-group' }))).toMatchObject({ ok: true });
    expect(engine.document.layout.overrides['grouped.child']).toMatchObject({ x: 224, y: 112 });
    expect(engine.document.layout.edgeOverrides).toEqual({
      internal: { waypoints: [{ x: 258, y: 152 }, { x: 282, y: 152 }], labelT: 0.6 },
      external: { waypoints: [{ x: 184, y: 112 }] },
    });
    expect(engine.undo()).toMatchObject({ ok: true });
    expect(engine.document.layout.edgeOverrides).toEqual(document.layout.edgeOverrides);

    for (const preview of [
      translateSelection(document, connectedFrames, ['grouped.child'], { x: 8, y: 16 }),
      resizeSelection(document, connectedFrames, ['grouped'], 'south-east', { x: 20, y: 20 }),
      rotateSelection(document, connectedFrames, ['grouped.child', 'grouped.sibling'], 90),
    ]) {
      const separateEngine = new OperationEngine(document);
      expect(separateEngine.apply(createTransformTransaction(document, preview, { txId: 'tx.other-transform' }))).toMatchObject({ ok: true });
      expect(separateEngine.document.layout.edgeOverrides).toEqual(document.layout.edgeOverrides);
    }
  });

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
