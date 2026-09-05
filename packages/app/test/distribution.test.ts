import { describe, expect, it } from 'vitest';
import { validateDocument, type OpenChartDocument } from '@openchart/ir';
import {
  createTransformTransaction,
  translateSelection,
  type TransformFrame,
} from '@openchart/interact';
import { OperationEngine, type OperationEnvelope } from '@openchart/ops';

import {
  distributeSelectionPreview,
  reorderSiblingNodes,
  type DistributionMode,
} from '../src/openchart-editor.js';

const uid = (value: number): string => value.toString().padStart(26, '0');
const IDS = ['node.a', 'node.b', 'node.c', 'node.d'] as const;

function distributionDocument(): OpenChartDocument {
  const result = validateDocument({
    schemaVersion: 1,
    documentId: 'document.distribution-test',
    uid: uid(1),
    title: 'Distribution',
    rev: 0,
    pages: {
      'page.main': {
        id: 'page.main',
        uid: uid(2),
        name: 'Main',
        layerIds: ['layer.main'],
      },
    },
    layers: {
      'layer.main': {
        id: 'layer.main',
        uid: uid(3),
        name: 'Diagram',
        pageId: 'page.main',
        visible: true,
        locked: false,
      },
    },
    nodes: {
      'node.a': {
        id: 'node.a', uid: uid(10), kind: 'service', label: 'A',
        pageId: 'page.main', layerId: 'layer.main', styleId: 'style.node', data: {},
      },
      'node.b': {
        id: 'node.b', uid: uid(11), kind: 'service', label: 'B',
        pageId: 'page.main', layerId: 'layer.main', styleId: 'style.node', data: {},
      },
      'node.c': {
        id: 'node.c', uid: uid(12), kind: 'service', label: 'C',
        pageId: 'page.main', layerId: 'layer.main', styleId: 'style.node', data: {},
      },
      'node.d': {
        id: 'node.d', uid: uid(13), kind: 'service', label: 'D',
        pageId: 'page.main', layerId: 'layer.main', styleId: 'style.node', data: {},
      },
    },
    ports: {},
    edges: {},
    styles: {
      'style.node': {
        id: 'style.node', uid: uid(20), role: 'node/default', tokens: {},
      },
    },
    layout: {
      overrides: {
        'node.a': { x: 0, y: 0, width: 40, height: 30 },
        'node.b': { x: 90, y: 40, width: 80, height: 50 },
        'node.c': { x: 240, y: 120, width: 30, height: 60 },
        'node.d': { x: 360, y: 200, width: 50, height: 70 },
      },
      derived: null,
    },
    meta: {
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
    },
  });
  if (!result.ok) {
    throw new Error(`Invalid distribution fixture: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.document;
}

function framesFromDocument(
  document: OpenChartDocument,
  ids: readonly string[] = IDS,
): Record<string, TransformFrame> {
  const frames: Record<string, TransformFrame> = {};
  for (const id of ids) {
    const layout = document.layout.overrides[id];
    if (
      layout === undefined ||
      typeof layout.x !== 'number' ||
      typeof layout.y !== 'number' ||
      typeof layout.width !== 'number' ||
      typeof layout.height !== 'number'
    ) {
      throw new Error(`Missing transform frame for ${id}`);
    }
    frames[id] = {
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
      ...(typeof layout.rotation === 'number' ? { rotation: layout.rotation } : {}),
    };
  }
  return frames;
}

function coordinate(document: OpenChartDocument, id: string, key: 'x' | 'y'): number {
  const value = document.layout.overrides[id]?.[key];
  if (typeof value !== 'number') throw new Error(`Missing ${key} for ${id}`);
  return value;
}

function size(document: OpenChartDocument, id: string, axis: 'x' | 'y'): number {
  const key = axis === 'x' ? 'width' : 'height';
  const value = document.layout.overrides[id]?.[key];
  if (typeof value !== 'number') throw new Error(`Missing ${key} for ${id}`);
  return value;
}

function gaps(document: OpenChartDocument, ids: readonly string[], axis: 'x' | 'y'): number[] {
  const key = axis === 'x' ? 'x' : 'y';
  const ordered = [...ids].sort(
    (left, right) => coordinate(document, left, key) - coordinate(document, right, key),
  );
  return ordered.slice(1).map((id, index) => {
    const previous = ordered[index];
    if (previous === undefined) throw new Error('Missing previous distribution item');
    return coordinate(document, id, key) -
      (coordinate(document, previous, key) + size(document, previous, axis));
  });
}

function distributionEnvelope(
  document: OpenChartDocument,
  ids: readonly string[],
  mode: DistributionMode,
  txId: string,
): OperationEnvelope | undefined {
  const preview = distributeSelectionPreview(
    document,
    framesFromDocument(document, ids),
    ids,
    mode,
  );
  return preview === undefined
    ? undefined
    : createTransformTransaction(document, preview, { txId });
}

describe('distribution commands', () => {
  it('distribute-horizontal produces equal gaps and one undo restores the prior frames', () => {
    const engine = new OperationEngine(distributionDocument());
    const originalB = coordinate(engine.document, 'node.b', 'x');
    const originalC = coordinate(engine.document, 'node.c', 'x');
    const envelope = distributionEnvelope(engine.document, IDS, 'horizontal', 'tx.distribute-horizontal');
    expect(envelope).toBeDefined();
    if (envelope === undefined) return;
    expect(envelope.ops.every((operation) => operation.op === 'set_node_layout')).toBe(true);
    expect(engine.apply(envelope)).toMatchObject({ ok: true });
    const resultGaps = gaps(engine.document, IDS, 'x');
    expect(resultGaps).toHaveLength(3);
    expect(resultGaps[0]).toBeCloseTo(resultGaps[1] ?? Number.NaN);
    expect(resultGaps[1]).toBeCloseTo(resultGaps[2] ?? Number.NaN);
    expect(engine.undo()).toMatchObject({ ok: true });
    expect(coordinate(engine.document, 'node.b', 'x')).toBe(originalB);
    expect(coordinate(engine.document, 'node.c', 'x')).toBe(originalC);
  });

  it('distribute-vertical produces equal gaps and one undo restores the prior frames', () => {
    const engine = new OperationEngine(distributionDocument());
    const originalB = coordinate(engine.document, 'node.b', 'y');
    const envelope = distributionEnvelope(engine.document, IDS, 'vertical', 'tx.distribute-vertical');
    expect(envelope).toBeDefined();
    if (envelope === undefined) return;
    expect(engine.apply(envelope)).toMatchObject({ ok: true });
    const resultGaps = gaps(engine.document, IDS, 'y');
    expect(resultGaps).toHaveLength(3);
    expect(resultGaps[0]).toBeCloseTo(resultGaps[1] ?? Number.NaN);
    expect(resultGaps[1]).toBeCloseTo(resultGaps[2] ?? Number.NaN);
    expect(engine.undo()).toMatchObject({ ok: true });
    expect(coordinate(engine.document, 'node.b', 'y')).toBe(originalB);
  });

  it('equal-spacing uses current outer bounds and mixed object sizes on the dominant axis', () => {
    const engine = new OperationEngine(distributionDocument());
    const before = framesFromDocument(engine.document);
    const outerStart = Math.min(...IDS.map((id) => before[id]?.x ?? Number.POSITIVE_INFINITY));
    const outerEnd = Math.max(...IDS.map((id) => {
      const frame = before[id];
      return frame === undefined ? Number.NEGATIVE_INFINITY : frame.x + frame.width;
    }));
    const totalObjectSize = IDS.reduce((total, id) => total + (before[id]?.width ?? 0), 0);
    const expectedGap = (outerEnd - outerStart - totalObjectSize) / (IDS.length - 1);

    const envelope = distributionEnvelope(engine.document, IDS, 'equal-spacing', 'tx.equal-spacing');
    expect(envelope).toBeDefined();
    if (envelope === undefined) return;
    expect(engine.apply(envelope)).toMatchObject({ ok: true });
    for (const gap of gaps(engine.document, IDS, 'x')) {
      expect(gap).toBeCloseTo(expectedGap, 8);
    }
    expect(coordinate(engine.document, 'node.b', 'x')).toBeCloseTo(110);
    expect(coordinate(engine.document, 'node.c', 'x')).toBeCloseTo(260);
    expect(engine.undo()).toMatchObject({ ok: true });
    expect(coordinate(engine.document, 'node.b', 'x')).toBe(90);
  });

  it('single and empty selections produce no preview, transaction, revision, or stray operations', () => {
    const engine = new OperationEngine(distributionDocument());
    const frames = framesFromDocument(engine.document);
    expect(distributeSelectionPreview(engine.document, frames, [], 'horizontal')).toBeUndefined();
    expect(distributeSelectionPreview(engine.document, frames, ['node.a'], 'vertical')).toBeUndefined();
    expect(distributionEnvelope(engine.document, [], 'equal-spacing', 'tx.none')).toBeUndefined();
    expect(engine.document.rev).toBe(0);
    expect(coordinate(engine.document, 'node.a', 'x')).toBe(0);
    expect(coordinate(engine.document, 'node.b', 'x')).toBe(90);
  });

  it('distribution composes cleanly with move and undo ordering', () => {
    const engine = new OperationEngine(distributionDocument());
    const move = translateSelection(
      engine.document,
      framesFromDocument(engine.document),
      ['node.b'],
      { x: 30, y: 0 },
    );
    expect(engine.apply(
      createTransformTransaction(engine.document, move, { txId: 'tx.move-before-distribute' }),
    )).toMatchObject({ ok: true });
    expect(coordinate(engine.document, 'node.b', 'x')).toBe(120);

    const distribution = distributionEnvelope(
      engine.document,
      IDS,
      'horizontal',
      'tx.distribute-after-move',
    );
    expect(distribution).toBeDefined();
    if (distribution === undefined) return;
    expect(engine.apply(distribution)).toMatchObject({ ok: true });
    expect(coordinate(engine.document, 'node.b', 'x')).toBeCloseTo(110);

    expect(engine.undo()).toMatchObject({ ok: true });
    expect(coordinate(engine.document, 'node.b', 'x')).toBe(120);
    expect(engine.undo()).toMatchObject({ ok: true });
    expect(coordinate(engine.document, 'node.b', 'x')).toBe(90);
  });

  it('reports no reorder when the selection is already in position', () => {
    const document = distributionDocument();
    const siblings = IDS.map((id) => {
      const node = document.nodes[id];
      if (node === undefined) throw new Error(`Missing fixture node ${id}`);
      return node;
    });
    expect(reorderSiblingNodes(siblings, ['node.c', 'node.d'], 'front')).toBeUndefined();
    expect(reorderSiblingNodes(siblings, ['node.a', 'node.b'], 'back')).toBeUndefined();
    expect(reorderSiblingNodes(siblings, ['node.b'], 'forward')?.map((node) => node.id))
      .toEqual(['node.a', 'node.c', 'node.b', 'node.d']);
    expect(reorderSiblingNodes(siblings, ['node.c'], 'backward')?.map((node) => node.id))
      .toEqual(['node.a', 'node.c', 'node.b', 'node.d']);
    expect(reorderSiblingNodes(siblings, ['node.a', 'node.c'], 'front')?.map((node) => node.id))
      .toEqual(['node.b', 'node.d', 'node.a', 'node.c']);
  });
});
