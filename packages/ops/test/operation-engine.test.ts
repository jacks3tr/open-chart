import { describe, expect, it } from 'vitest';

import {
  validateDocument,
  type OpenChartDocument,
} from '@openchart/ir';

import { OperationEngine, type OperationEnvelope } from '../src/index.js';

const uid = (value: number): string => value.toString().padStart(26, '0');

function baseDocument(): OpenChartDocument {
  const result = validateDocument({
    schemaVersion: 1,
    documentId: 'document.main',
    uid: uid(1),
    title: 'Operation test',
    rev: 0,
    pages: {
      'page.main': {
        id: 'page.main',
        uid: uid(2),
        name: 'Architecture',
        layerIds: ['layer.main'],
      },
    },
    layers: {
      'layer.main': {
        id: 'layer.main',
        uid: uid(3),
        name: 'Systems',
        pageId: 'page.main',
        visible: true,
        locked: false,
      },
    },
    nodes: {},
    ports: {},
    edges: {},
    styles: {
      'style.service': {
        id: 'style.service',
        uid: uid(4),
        role: 'service/compute',
        tokens: {},
      },
    },
    layout: { overrides: {}, derived: null },
    meta: {
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    },
  });

  if (!result.ok) {
    throw new Error(`Invalid test fixture: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.document;
}

function createServiceEnvelope(): OperationEnvelope {
  return {
    txId: 'tx.create-api',
    actor: 'agent',
    origin: 'cli',
    baseRev: 0,
    idempotencyKey: 'fixture:create-api',
    ops: [
      {
        op: 'create_node',
        node: {
          id: 'service.api',
          uid: uid(10),
          kind: 'service',
          label: 'API',
          pageId: 'page.main',
          layerId: 'layer.main',
          styleId: 'style.service',
          data: {},
        },
      },
      {
        op: 'create_node',
        node: {
          id: 'database.orders',
          uid: uid(11),
          kind: 'database',
          label: 'Orders',
          pageId: 'page.main',
          layerId: 'layer.main',
          styleId: 'style.service',
          data: {},
        },
      },
      {
        op: 'create_port',
        port: {
          id: 'service.api.out',
          uid: uid(12),
          nodeId: 'service.api',
          direction: 'out',
          side: 'east',
        },
      },
      {
        op: 'create_port',
        port: {
          id: 'database.orders.in',
          uid: uid(13),
          nodeId: 'database.orders',
          direction: 'in',
          side: 'west',
        },
      },
      {
        op: 'create_edge',
        edge: {
          id: 'edge.api-orders',
          uid: uid(14),
          fromPortId: 'service.api.out',
          toPortId: 'database.orders.in',
          label: 'writes',
          semantic: 'request',
          pageId: 'page.main',
          layerId: 'layer.main',
          styleId: 'style.service',
          data: {},
        },
      },
    ],
  };
}

describe('OperationEngine', () => {
  it('deletion sees nodes, parents, ports and edges created earlier in the same batch', () => {
    const engine = new OperationEngine(baseDocument());
    const envelope = createServiceEnvelope();
    expect(engine.apply({ ...envelope, ops: [...envelope.ops,
      { op: 'set_node_parent', id: 'database.orders', parentId: 'service.api' },
      { op: 'delete_node', id: 'service.api' },
    ] })).toMatchObject({ ok: true });
    expect(Object.keys(engine.document.nodes)).toEqual(['database.orders']);
    expect(engine.document.nodes['database.orders']?.parentId).toBeUndefined();
    expect(Object.keys(engine.document.ports)).toEqual(['database.orders.in']);
    expect(engine.document.edges).toEqual({});
    expect(validateDocument(engine.document).ok).toBe(true);
    expect(engine.undo()).toMatchObject({ ok: true });
    expect(engine.document.nodes).toEqual({});
    expect(engine.redo()).toMatchObject({ ok: true });
    expect(Object.keys(engine.document.nodes)).toEqual(['database.orders']);
    expect(validateDocument(engine.document).ok).toBe(true);
  });

  it('port deletion removes edges introduced earlier in its transaction', () => {
    const engine = new OperationEngine(baseDocument());
    const envelope = createServiceEnvelope();
    expect(engine.apply({ ...envelope, ops: [...envelope.ops,
      { op: 'delete_port', id: 'service.api.out' },
    ] })).toMatchObject({ ok: true });
    expect(Object.keys(engine.document.nodes)).toHaveLength(2);
    expect(Object.keys(engine.document.ports)).toEqual(['database.orders.in']);
    expect(engine.document.edges).toEqual({});
    expect(validateDocument(engine.document).ok).toBe(true);
  });

  it('renames the document as an undoable operation', () => {
    const engine = new OperationEngine(baseDocument());

    expect(engine.apply({
      txId: 'tx.rename-document',
      actor: 'user',
      origin: 'gui',
      baseRev: 0,
      ops: [{ op: 'set_document_title', title: '  Renamed diagram  ' }],
    })).toMatchObject({ ok: true, rev: 1 });
    expect(engine.document.title).toBe('Renamed diagram');
    expect(engine.undo()).toMatchObject({ ok: true, rev: 0 });
    expect(engine.document.title).toBe('Operation test');
  });

  it('enforces commit, replay, revision-conflict, and undo lifecycle semantics', () => {
    const original = baseDocument();
    const engine = new OperationEngine(original);
    const envelope = createServiceEnvelope();

    const committed = engine.apply(envelope);
    expect(committed).toMatchObject({ ok: true, replayed: false, rev: 1 });
    expect(engine.document.nodes['service.api']?.label).toBe('API');
    expect(engine.document.edges['edge.api-orders']?.label).toBe('writes');

    const replayed = engine.apply(envelope);
    expect(replayed).toMatchObject({ ok: true, replayed: true, rev: 1 });
    expect(engine.document.rev).toBe(1);

    const stale = engine.apply({
      ...envelope,
      txId: 'tx.stale',
      idempotencyKey: 'fixture:stale',
      ops: [{ op: 'set_node_label', id: 'service.api', label: 'Stale' }],
    });
    expect(stale).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'BASE_REV_MISMATCH' })],
    });
    expect(engine.document.nodes['service.api']?.label).toBe('API');

    const undone = engine.undo();
    expect(undone).toMatchObject({ ok: true, rev: 0 });
    expect(engine.document).toEqual(original);

    expect(engine.redo()).toMatchObject({ ok: true, rev: 1 });
    expect(engine.document.nodes['service.api']?.label).toBe('API');
    expect(engine.undo()).toMatchObject({ ok: true, rev: 0 });
    expect(
      engine.apply({
        ...envelope,
        txId: 'tx.create-replacement',
        idempotencyKey: 'fixture:create-replacement',
      }),
    ).toMatchObject({ ok: true, rev: 1 });
    expect(engine.redo()).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'NOTHING_TO_REDO' })],
    });
  });

  it('rejects ID and UID collisions without applying any transaction member', () => {
    const original = baseDocument();
    const engine = new OperationEngine(original);
    const envelope = createServiceEnvelope();
    const duplicate = envelope.ops[0];
    if (duplicate?.op !== 'create_node') {
      throw new Error('Expected create_node fixture');
    }

    const result = engine.apply({
      ...envelope,
      ops: [
        duplicate,
        {
          op: 'create_node',
          node: {
            ...duplicate.node,
            uid: uid(11),
            label: 'Duplicate API',
          },
        },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({ code: 'ID_COLLISION', path: 'ops.1.node.id' }),
      ],
    });
    expect(engine.document).toEqual(original);

    const duplicateUid = engine.apply({
      ...envelope,
      txId: 'tx.duplicate-uid',
      idempotencyKey: 'fixture:duplicate-uid',
      ops: [
        duplicate,
        {
          op: 'create_node',
          node: { ...duplicate.node, id: 'service.duplicate', label: 'Duplicate UID' },
        },
      ],
    });
    expect(duplicateUid).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'DUPLICATE_UID' })],
    });
    expect(engine.document).toEqual(original);
  });

  it('mutates, renames, and safely removes authoritative container parents', () => {
    const engine = new OperationEngine(baseDocument());
    expect(engine.apply(createServiceEnvelope())).toMatchObject({ ok: true, rev: 1 });

    expect(
      engine.apply({
        txId: 'tx.container-parent',
        actor: 'user',
        origin: 'gui',
        baseRev: 1,
        ops: [
          {
            op: 'set_node_container',
            id: 'database.orders',
            container: {
              title: 'Orders boundary',
              assistedLayout: true,
              clip: true,
            },
          },
          {
            op: 'set_node_parent',
            id: 'service.api',
            parentId: 'database.orders',
          },
        ],
      }),
    ).toMatchObject({ ok: true, rev: 2 });
    expect(engine.document.nodes['service.api']?.parentId).toBe('database.orders');

    expect(
      engine.apply({
        txId: 'tx.rename-container',
        actor: 'user',
        origin: 'gui',
        baseRev: 2,
        ops: [
          {
            op: 'rename_node',
            id: 'database.orders',
            newId: 'container.orders',
          },
        ],
      }),
    ).toMatchObject({ ok: true, rev: 3 });
    expect(engine.document.nodes['service.api']?.parentId).toBe('container.orders');

    expect(
      engine.apply({
        txId: 'tx.delete-container',
        actor: 'user',
        origin: 'gui',
        baseRev: 3,
        ops: [{ op: 'delete_node', id: 'container.orders' }],
      }),
    ).toMatchObject({ ok: true, rev: 4 });
    expect(engine.document.nodes['service.api']?.parentId).toBeUndefined();
    expect(engine.document.nodes['container.orders']).toBeUndefined();
  });

  it('commits node layout overrides atomically and restores them with undo', () => {
    const engine = new OperationEngine(baseDocument());
    expect(engine.apply(createServiceEnvelope())).toMatchObject({ ok: true, rev: 1 });

    const result = engine.apply({
      txId: 'tx.layout-selection',
      actor: 'user',
      origin: 'gui',
      baseRev: 1,
      ops: [
        {
          op: 'set_node_layout',
          id: 'service.api',
          layout: { x: 24, y: 36, width: 180, height: 80, pinned: true },
        },
        {
          op: 'set_node_layout',
          id: 'database.orders',
          layout: { x: 264, y: 36, width: 180, height: 80, pinned: true },
        },
      ],
    } as unknown as OperationEnvelope);

    expect(result).toMatchObject({ ok: true, rev: 2 });
    expect(engine.document.layout.overrides).toEqual({
      'database.orders': { x: 264, y: 36, width: 180, height: 80, pinned: true },
      'service.api': { x: 24, y: 36, width: 180, height: 80, pinned: true },
    });

    expect(engine.undo()).toMatchObject({ ok: true, rev: 1 });
    expect(engine.document.layout.overrides).toEqual({});

    expect(
      engine.apply({
        txId: 'tx.rotate-container',
        actor: 'user',
        origin: 'gui',
        baseRev: 1,
        ops: [
          {
            op: 'set_node_container',
            id: 'database.orders',
            container: {},
          },
          {
            op: 'set_node_layout',
            id: 'database.orders',
            layout: { rotation: 15, pinned: true },
          },
        ],
      } as unknown as OperationEnvelope),
    ).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: 'INVALID_OPERATION',
          path: 'ops.1.layout.rotation',
        }),
      ],
    });
    expect(engine.document.nodes['database.orders']?.container).toBeUndefined();
    expect(engine.document.layout.overrides).toEqual({});
  });
});
