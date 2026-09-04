import { describe, expect, test } from 'vitest';

import type { OpenChartDocument } from '@openchart/ir';
import { OperationEngine } from '@openchart/ops';

import {
  createClipboardPayload,
  createPasteStyleTransaction,
  createPasteTransaction,
  type ClipboardEntityKind,
  type TransformFrame,
} from '../src/index.js';

const uid = (value: number): string => value.toString().padStart(26, '0');

function documentFixture(): OpenChartDocument {
  return {
    schemaVersion: 1,
    documentId: 'document.main',
    uid: uid(1),
    title: 'Clipboard test',
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
        name: 'Base',
        pageId: 'page.main',
        visible: true,
        locked: false,
      },
    },
    nodes: {
      grouped: {
        id: 'grouped',
        uid: uid(10),
        kind: 'group',
        label: 'Grouped services',
        pageId: 'page.main',
        layerId: 'layer.main',
        styleId: 'style.primary',
        group: {},
        data: {},
      },
      'grouped.a': {
        id: 'grouped.a',
        uid: uid(11),
        kind: 'service',
        label: 'A',
        pageId: 'page.main',
        layerId: 'layer.main',
        styleId: 'style.primary',
        parentId: 'grouped',
        data: {},
      },
      'grouped.b': {
        id: 'grouped.b',
        uid: uid(12),
        kind: 'service',
        label: 'B',
        pageId: 'page.main',
        layerId: 'layer.main',
        styleId: 'style.secondary',
        parentId: 'grouped',
        data: {},
      },
    },
    ports: {
      'grouped.a.out': {
        id: 'grouped.a.out',
        uid: uid(13),
        nodeId: 'grouped.a',
        direction: 'out',
        side: 'east',
      },
      'grouped.b.in': {
        id: 'grouped.b.in',
        uid: uid(14),
        nodeId: 'grouped.b',
        direction: 'in',
        side: 'west',
      },
    },
    edges: {
      'edge.a-b': {
        id: 'edge.a-b',
        uid: uid(15),
        fromPortId: 'grouped.a.out',
        toPortId: 'grouped.b.in',
        label: 'calls',
        semantic: 'sync',
        pageId: 'page.main',
        layerId: 'layer.main',
        styleId: 'style.primary',
        data: {},
      },
    },
    styles: {
      'style.primary': {
        id: 'style.primary',
        uid: uid(20),
        role: 'primary',
        tokens: {},
      },
      'style.secondary': {
        id: 'style.secondary',
        uid: uid(21),
        role: 'secondary',
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
  grouped: { x: 0, y: 0, width: 200, height: 100 },
  'grouped.a': { x: 20, y: 30, width: 60, height: 40 },
  'grouped.b': { x: 120, y: 30, width: 60, height: 40 },
} as const satisfies Readonly<Record<string, TransformFrame>>;

describe('clipboard transactions', () => {
  test('copies a hierarchy with internal edges and pastes it as one remapped transaction', () => {
    const document = documentFixture();
    const payload = createClipboardPayload(document, ['grouped'], frames);
    expect(payload.rootNodeIds).toEqual(['grouped']);
    expect(Object.keys(payload.nodes)).toEqual(['grouped', 'grouped.a', 'grouped.b']);
    expect(Object.keys(payload.ports)).toHaveLength(2);
    expect(Object.keys(payload.edges)).toEqual(['edge.a-b']);

    let nextUid = 100;
    const pasted = createPasteTransaction(document, payload, {
      txId: 'tx.paste-group',
      pageId: 'page.main',
      layerId: 'layer.main',
      offset: { x: 24, y: 24 },
      allocateId: (kind: ClipboardEntityKind, sourceId: string) =>
        `copy-${kind}.${sourceId}`,
      allocateUid: () => uid(nextUid++),
    });
    expect(pasted.pastedNodeIds).toEqual([
      'copy-node.grouped',
      'copy-node.grouped.a',
      'copy-node.grouped.b',
    ]);
    expect(pasted.pastedRootNodeIds).toEqual(['copy-node.grouped']);

    const engine = new OperationEngine(document);
    expect(engine.apply(pasted.envelope)).toMatchObject({ ok: true, rev: 1 });
    expect(engine.document.nodes['copy-node.grouped.a']?.parentId).toBe(
      'copy-node.grouped',
    );
    expect(engine.document.edges['copy-edge.edge.a-b']).toMatchObject({
      fromPortId: 'copy-port.grouped.a.out',
      toPortId: 'copy-port.grouped.b.in',
    });
    expect(engine.document.layout.overrides['copy-node.grouped.a']).toMatchObject({
      x: 44,
      y: 54,
      width: 60,
      height: 40,
      pinned: true,
    });

    const styleEngine = new OperationEngine(document);
    expect(
      styleEngine.apply(
        createPasteStyleTransaction(document, 'grouped.a', ['grouped.b'], {
          txId: 'tx.paste-style',
        }),
      ),
    ).toMatchObject({ ok: true, rev: 1 });
    expect(styleEngine.document.nodes['grouped.b']?.styleId).toBe('style.primary');
  });

  test('rejects incomplete geometry and allocator collisions before creating an envelope', () => {
    const document = documentFixture();
    expect(() =>
      createClipboardPayload(document, ['grouped'], { grouped: frames.grouped }),
    ).toThrow('Missing clipboard frame');

    const payload = createClipboardPayload(document, ['grouped'], frames);
    expect(() =>
      createPasteTransaction(document, payload, {
        txId: 'tx.invalid-paste',
        pageId: 'page.main',
        layerId: 'layer.main',
        offset: { x: 0, y: 0 },
        allocateId: () => 'duplicate',
        allocateUid: () => uid(200),
      }),
    ).toThrow('allocated duplicate');
  });
});
