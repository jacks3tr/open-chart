import { describe, expect, test } from 'vitest';

import type { OpenChartDocument } from '@openchart/ir';

import { OperationEngine, type OperationEnvelope } from '../src/index.js';

const uid = (value: number): string => value.toString().padStart(26, '0');

function documentFixture(): OpenChartDocument {
  return {
    schemaVersion: 1,
    documentId: 'document.main',
    uid: uid(1),
    title: 'Structure test',
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
      root: {
        id: 'root',
        uid: uid(4),
        kind: 'service',
        label: 'Root',
        pageId: 'page.main',
        layerId: 'layer.main',
        styleId: 'style.node',
        data: {},
      },
    },
    ports: {},
    edges: {},
    styles: {
      'style.node': {
        id: 'style.node',
        uid: uid(5),
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

describe('page and layer operations', () => {
  test('edits connector intent and geometry atomically while rejecting reversed endpoints', () => {
    const engine = new OperationEngine(documentFixture());
    expect(
      engine.apply({
        txId: 'tx.connector-create',
        actor: 'user',
        origin: 'gui',
        baseRev: 0,
        ops: [
          {
            op: 'create_node',
            node: {
              id: 'target', uid: uid(20), kind: 'service', label: 'Target',
              pageId: 'page.main', layerId: 'layer.main', styleId: 'style.node', data: {},
            },
          },
          {
            op: 'create_port',
            port: {
              id: 'root.out', uid: uid(21), nodeId: 'root', direction: 'out',
              side: 'auto', order: 1,
            },
          },
          {
            op: 'create_port',
            port: {
              id: 'target.in', uid: uid(22), nodeId: 'target', direction: 'in',
              side: 'west',
            },
          },
          {
            op: 'create_edge',
            edge: {
              id: 'edge.root-target', uid: uid(23), fromPortId: 'root.out',
              toPortId: 'target.in', label: 'HTTPS', semantic: 'sync-call',
              pageId: 'page.main', layerId: 'layer.main', styleId: 'style.node',
              routing: { mode: 'orthogonal', avoidObstacles: true }, data: {},
            },
          },
          { op: 'set_port_order', id: 'root.out', order: 3 },
          { op: 'set_edge_label', id: 'edge.root-target', label: 'REST' },
          { op: 'set_edge_semantic', id: 'edge.root-target', semantic: 'request-response' },
          {
            op: 'set_edge_routing', id: 'edge.root-target',
            routing: { mode: 'curved', avoidObstacles: false, jumpStyle: 'arc' },
          },
          {
            op: 'set_edge_layout', id: 'edge.root-target',
            layout: {
              waypoints: [{ x: 180, y: 120 }], labelT: 0.4,
              labelPlacement: 'above', labelOffset: 8,
            },
          },
        ],
      } as unknown as OperationEnvelope),
    ).toMatchObject({ ok: true, rev: 1 });
    expect(engine.document.ports['root.out']?.order).toBe(3);
    expect(engine.document.edges['edge.root-target']).toMatchObject({
      label: 'REST',
      semantic: 'request-response',
      routing: { mode: 'curved', avoidObstacles: false, jumpStyle: 'arc' },
    });
    expect(engine.document.layout.edgeOverrides?.['edge.root-target']?.labelT).toBe(0.4);

    const accepted = engine.document;
    const rejected = engine.apply({
      txId: 'tx.connector-reverse',
      actor: 'user',
      origin: 'gui',
      baseRev: 1,
      ops: [{
        op: 'set_edge_endpoints', id: 'edge.root-target',
        fromPortId: 'target.in', toPortId: 'root.out',
      }],
    } as unknown as OperationEnvelope);
    expect(rejected.ok).toBe(false);
    if (rejected.ok) {
      throw new Error('Expected invalid connector direction to be rejected');
    }
    expect(rejected.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'INVALID_PORT_DIRECTION',
    );
    expect(engine.document).toEqual(accepted);
  });

  test('stores explicit node paint order through the atomic operation boundary', () => {
    const engine = new OperationEngine(documentFixture());

    expect(
      engine.apply({
        txId: 'tx.node-order',
        actor: 'user',
        origin: 'gui',
        baseRev: 0,
        ops: [
          { op: 'set_node_z_index', id: 'root', zIndex: 4 },
        ],
      } as unknown as OperationEnvelope),
    ).toMatchObject({ ok: true, rev: 1 });
    expect(engine.document.layout.overrides.root?.zIndex).toBe(4);
  });

  test('stores derived layout and style tokens as one undoable transaction', () => {
    const engine = new OperationEngine(documentFixture());
    const original = engine.document;

    expect(
      engine.apply({
        txId: 'tx.beauty-result',
        actor: 'user',
        origin: 'beauty',
        baseRev: 0,
        ops: [
          {
            op: 'set_derived_layout',
            engine: 'elk.layered',
            derivedVersion: 'elkjs@0.12.0',
            frames: {
              root: { x: 80, y: 96, width: 240, height: 120 },
            },
          },
          {
            op: 'set_style_tokens',
            id: 'style.node',
            tokens: { accent: '#2563EB', surface: '#EFF6FF' },
          },
          {
            op: 'set_theme',
            theme: {
              presetId: 'openchart-light',
              tokens: { canvas: '#FBFCFE', textHi: '#0F172A' },
            },
          },
        ],
      } as unknown as OperationEnvelope),
    ).toMatchObject({ ok: true, rev: 1 });
    expect(engine.document.layout).toMatchObject({
      engine: 'elk.layered',
      derivedVersion: 'elkjs@0.12.0',
      derived: { root: { x: 80, y: 96, width: 240, height: 120 } },
    });
    expect(engine.document.styles['style.node']?.tokens).toEqual({
      accent: '#2563EB',
      surface: '#EFF6FF',
    });
    expect(engine.document.theme).toEqual({
      presetId: 'openchart-light',
      tokens: { canvas: '#FBFCFE', textHi: '#0F172A' },
    });

    expect(engine.undo()).toMatchObject({ ok: true, rev: 0 });
    expect(engine.document).toEqual(original);
  });

  test('creates, edits, and safely deletes page-scoped structure', () => {
    const engine = new OperationEngine(documentFixture());
    const created = engine.apply({
      txId: 'tx.create-secondary-page',
      actor: 'user',
      origin: 'gui',
      baseRev: 0,
      ops: [
        {
          op: 'create_page',
          page: {
            id: 'page.secondary',
            uid: uid(10),
            name: 'Secondary',
            order: 1,
            layerIds: ['layer.secondary'],
          },
          baseLayer: {
            id: 'layer.secondary',
            uid: uid(11),
            name: 'Base',
            pageId: 'page.secondary',
            visible: true,
            locked: false,
          },
        },
        {
          op: 'create_layer',
          layer: {
            id: 'layer.overlay',
            uid: uid(12),
            name: 'Overlay',
            pageId: 'page.secondary',
            visible: true,
            locked: false,
          },
        },
        {
          op: 'create_layer',
          layer: {
            id: 'layer.notes',
            uid: uid(14),
            name: 'Notes',
            pageId: 'page.secondary',
            visible: true,
            locked: false,
          },
        },
        {
          op: 'create_node',
          node: {
            id: 'service.overlay',
            uid: uid(13),
            kind: 'service',
            label: 'Overlay service',
            pageId: 'page.secondary',
            layerId: 'layer.overlay',
            styleId: 'style.node',
            data: {},
          },
        },
        { op: 'rename_page', id: 'page.secondary', name: 'Deployment' },
        { op: 'set_page_color', id: 'page.secondary', color: '#E8F0FF' },
        { op: 'set_page_order', id: 'page.main', order: 1 },
        { op: 'set_page_order', id: 'page.secondary', order: 0 },
        { op: 'set_layer_visibility', id: 'layer.overlay', visible: false },
        { op: 'set_layer_locked', id: 'layer.overlay', locked: true },
        { op: 'rename_layer', id: 'layer.overlay', name: 'Annotations' },
        {
          op: 'reorder_layers',
          pageId: 'page.secondary',
          layerIds: ['layer.secondary', 'layer.notes', 'layer.overlay'],
        },
        { op: 'save_layer_view', pageId: 'page.secondary' },
      ],
    } as unknown as OperationEnvelope);

    expect(created).toMatchObject({ ok: true, rev: 1 });
    expect(engine.document.pages['page.secondary']).toMatchObject({
      name: 'Deployment',
      color: '#E8F0FF',
      order: 0,
      layerIds: ['layer.secondary', 'layer.notes', 'layer.overlay'],
    });
    expect(engine.document.layers['layer.overlay']).toMatchObject({
      name: 'Annotations',
      visible: false,
      defaultVisible: false,
      locked: true,
    });
    expect(engine.document.layers['layer.notes']?.defaultVisible).toBe(true);

    expect(
      engine.apply({
        txId: 'tx.delete-overlay-layer',
        actor: 'user',
        origin: 'gui',
        baseRev: 1,
        ops: [{ op: 'delete_layer', id: 'layer.overlay' }],
      } as unknown as OperationEnvelope),
    ).toMatchObject({ ok: true, rev: 2 });
    expect(engine.document.nodes['service.overlay']?.layerId).toBe('layer.secondary');
    expect(engine.document.layers['layer.overlay']).toBeUndefined();

    expect(
      engine.apply({
        txId: 'tx.delete-main-page',
        actor: 'user',
        origin: 'gui',
        baseRev: 2,
        ops: [{ op: 'delete_page', id: 'page.main' }],
      } as unknown as OperationEnvelope),
    ).toMatchObject({ ok: true, rev: 3 });
    expect(engine.document.pages['page.main']).toBeUndefined();
    expect(engine.document.layers['layer.main']).toBeUndefined();
    expect(engine.document.nodes.root).toBeUndefined();
  });

  test('keeps the base layer unlocked and refuses to delete the last page atomically', () => {
    const original = documentFixture();
    const engine = new OperationEngine(original);

    expect(
      engine.apply({
        txId: 'tx.lock-base',
        actor: 'user',
        origin: 'gui',
        baseRev: 0,
        ops: [
          { op: 'set_page_color', id: 'page.main', color: '#FFFFFF' },
          { op: 'set_layer_locked', id: 'layer.main', locked: true },
        ],
      } as unknown as OperationEnvelope),
    ).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: 'INVALID_OPERATION',
          path: 'ops.1.locked',
        }),
      ],
    });
    expect(engine.document).toEqual(original);

    expect(
      engine.apply({
        txId: 'tx-invalid-layer-order',
        actor: 'user',
        origin: 'gui',
        baseRev: 0,
        ops: [
          {
            op: 'reorder_layers',
            pageId: 'page.main',
            layerIds: ['layer.missing'],
          },
        ],
      } as unknown as OperationEnvelope),
    ).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: 'INVALID_OPERATION',
          path: 'ops.0.layerIds',
        }),
      ],
    });
    expect(engine.document).toEqual(original);

    expect(
      engine.apply({
        txId: 'tx.delete-last-page',
        actor: 'user',
        origin: 'gui',
        baseRev: 0,
        ops: [{ op: 'delete_page', id: 'page.main' }],
      } as unknown as OperationEnvelope),
    ).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: 'INVALID_OPERATION',
          path: 'ops.0.id',
        }),
      ],
    });
    expect(engine.document).toEqual(original);
  });
});
