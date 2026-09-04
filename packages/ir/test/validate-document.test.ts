import { describe, expect, it } from 'vitest';

import { validateDocument } from '../src/index.js';

const uid = (value: number): string => value.toString().padStart(26, '0');

function validDocument(): Record<string, unknown> {
  const nodes = Object.fromEntries(
    Array.from({ length: 50 }, (_, index) => {
      const id = `service.${index}`;
      return [
        id,
        {
          id,
          uid: uid(index + 10),
          kind: 'service',
          label: `Service ${index}`,
          pageId: 'page.main',
          layerId: 'layer.main',
          styleId: 'style.service',
          data: {},
        },
      ];
    }),
  );

  return {
    schemaVersion: 1,
    documentId: 'document.main',
    uid: uid(1),
    title: 'Integration architecture',
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
    nodes,
    ports: {
      'service.0.out': {
        id: 'service.0.out',
        uid: uid(4),
        nodeId: 'service.0',
        direction: 'out',
        side: 'east',
      },
      'service.1.in': {
        id: 'service.1.in',
        uid: uid(5),
        nodeId: 'service.1',
        direction: 'in',
        side: 'west',
      },
    },
    edges: {
      'edge.request': {
        id: 'edge.request',
        uid: uid(6),
        fromPortId: 'service.0.out',
        toPortId: 'service.1.in',
        label: 'HTTPS',
        semantic: 'sync-call',
        pageId: 'page.main',
        layerId: 'layer.main',
        styleId: 'style.edge',
        data: {},
      },
    },
    styles: {
      'style.service': {
        id: 'style.service',
        uid: uid(7),
        role: 'service/compute',
        tokens: {},
      },
      'style.edge': {
        id: 'style.edge',
        uid: uid(8),
        role: 'connector/sync',
        tokens: {},
      },
    },
    layout: {
      overrides: {},
      derived: null,
    },
    meta: {
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    },
  };
}

describe('validateDocument', () => {
  it('accepts a versioned 50-node semantic document with resolved references', () => {
    const input = validDocument();
    const nodes = input.nodes as Record<string, Record<string, unknown>>;
    const ports = input.ports as Record<string, Record<string, unknown>>;
    const edges = input.edges as Record<string, Record<string, unknown>>;
    const layout = input.layout as Record<string, unknown>;
    nodes['service.2'] = { ...nodes['service.2'], group: {} };
    nodes['service.3'] = { ...nodes['service.3'], parentId: 'service.2' };
    ports['service.0.out'] = {
      ...ports['service.0.out'],
      side: 'auto',
      order: 2,
    };
    edges['edge.request'] = {
      ...edges['edge.request'],
      routing: {
        mode: 'orthogonal',
        avoidObstacles: true,
        cornerRadius: 8,
        jumpStyle: 'arc',
        lineWidth: 3.5,
        lineStyle: 'dashed',
        startMarker: 'diamond',
        endMarker: 'crow-foot',
      },
    };
    layout.edgeOverrides = {
      'edge.request': {
        waypoints: [{ x: 320, y: 180 }],
        labelT: 0.65,
        labelPlacement: 'above',
        labelOffset: 6,
      },
    };
    const result = validateDocument(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.document.nodes)).toHaveLength(50);
      expect(result.document.schemaVersion).toBe(1);
      expect(result.document.edges['edge.request']?.toPortId).toBe('service.1.in');
      expect(result.document.edges['edge.request']?.routing).toMatchObject({
        lineWidth: 3.5,
        lineStyle: 'dashed',
        startMarker: 'diamond',
        endMarker: 'crow-foot',
      });
      expect(result.document.layout.edgeOverrides?.['edge.request']?.labelT).toBe(0.65);
    }
  });

  it('reports duplicate immutable identities and dangling references together', () => {
    const input = validDocument();
    const nodes = input.nodes as Record<string, Record<string, unknown>>;
    const ports = input.ports as Record<string, Record<string, unknown>>;

    nodes['service.1'] = {
      ...nodes['service.1'],
      uid: nodes['service.0']?.uid,
    };
    ports['service.1.in'] = {
      ...ports['service.1.in'],
      nodeId: 'service.missing',
    };
    ports['service.0.out'] = {
      ...ports['service.0.out'],
      direction: 'in',
    };

    const result = validateDocument(input);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'DUPLICATE_UID',
            path: 'nodes.service.1.uid',
          }),
          expect.objectContaining({
            code: 'DANGLING_NODE_REFERENCE',
            path: 'ports.service.1.in.nodeId',
          }),
          expect.objectContaining({
            code: 'INVALID_PORT_DIRECTION',
            path: 'edges.edge.request.fromPortId',
          }),
        ]),
      );
    }
  });

  it('rejects dangling, non-container, and cyclic parent references together', () => {
    const input = validDocument();
    const nodes = input.nodes as Record<string, Record<string, unknown>>;
    nodes['service.0'] = {
      ...nodes['service.0'],
      parentId: 'service.1',
      container: {},
      group: {},
    };
    nodes['service.1'] = {
      ...nodes['service.1'],
      parentId: 'service.0',
      container: {},
    };
    nodes['service.2'] = {
      ...nodes['service.2'],
      parentId: 'service.3',
    };
    nodes['service.4'] = {
      ...nodes['service.4'],
      parentId: 'service.missing',
    };
    const layout = input.layout as {
      overrides: Record<string, Record<string, unknown>>;
    };
    layout.overrides['service.0'] = { rotation: 15 };

    const result = validateDocument(input);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PARENT_CYCLE',
            path: 'nodes.service.0.parentId',
          }),
          expect.objectContaining({
            code: 'INVALID_PARENT_REFERENCE',
            path: 'nodes.service.2.parentId',
          }),
          expect.objectContaining({
            code: 'DANGLING_NODE_REFERENCE',
            path: 'nodes.service.4.parentId',
          }),
          expect.objectContaining({
            code: 'INVALID_LAYOUT_OVERRIDE',
            path: 'layout.overrides.service.0.rotation',
          }),
          expect.objectContaining({
            code: 'INVALID_NODE_ROLE',
            path: 'nodes.service.0.group',
          }),
        ]),
      );
    }
  });
});
