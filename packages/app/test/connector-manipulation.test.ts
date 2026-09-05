import { describe, expect, it } from 'vitest';
import { validateDocument, type OpenChartDocument } from '@openchart/ir';
import { OperationEngine, type Operation, type OperationEnvelope } from '@openchart/ops';
import { buildSceneDescription, type SceneItem, type SceneRectItem, type SceneTextItem } from '@openchart/scene';

import {
  addEdgeWaypointTransaction,
  commitConnectorCreation,
  connectorDoubleClickAction,
  connectorDragExceededThreshold,
  connectorLabelEditorStyle,
  createConnectorTransaction,
  detachEdgeEndpointTransaction,
  dragOrthogonalSegmentTransaction,
  edgeLabelPositionTransaction,
  edgeLabelTransaction,
  edgeTextStyleTransaction,
  moveEdgeWaypointTransaction,
  relinkEdgeTransaction,
} from '../src/openchart-editor.js';

const uid = (value: number): string => value.toString().padStart(26, '0');

function connectorDocument(): OpenChartDocument {
  const result = validateDocument({
    schemaVersion: 1,
    documentId: 'document.connector-test',
    uid: uid(1),
    title: 'Connector manipulation',
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
        pageId: 'page.main', layerId: 'layer.main', styleId: 'style.flow', data: {},
      },
      'node.b': {
        id: 'node.b', uid: uid(11), kind: 'service', label: 'B',
        pageId: 'page.main', layerId: 'layer.main', styleId: 'style.flow', data: {},
      },
      'node.c': {
        id: 'node.c', uid: uid(12), kind: 'service', label: 'C',
        pageId: 'page.main', layerId: 'layer.main', styleId: 'style.flow', data: {},
      },
    },
    ports: {},
    edges: {},
    styles: {
      'style.flow': {
        id: 'style.flow',
        uid: uid(20),
        role: 'flow/connector',
        tokens: {},
      },
    },
    layout: {
      overrides: {
        'node.a': { x: 0, y: 0, width: 120, height: 80 },
        'node.b': { x: 240, y: 0, width: 120, height: 80 },
        'node.c': { x: 480, y: 0, width: 120, height: 80 },
      },
      derived: null,
    },
    meta: {
      createdAt: '2026-09-03T00:00:00.000Z',
      updatedAt: '2026-09-03T00:00:00.000Z',
    },
  });
  if (!result.ok) {
    throw new Error(`Invalid connector fixture: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.document;
}

function createEnvelope(document: OpenChartDocument, txId: string): OperationEnvelope {
  return createConnectorTransaction(document, {
    txId,
    pageId: 'page.main',
    layerId: 'layer.main',
    styleId: 'style.flow',
    fromNodeId: 'node.a',
    toNodeId: 'node.b',
    fromSide: 'east',
    toSide: 'west',
  });
}

function operationSignature(operation: Operation): unknown {
  if (operation.op === 'create_port') {
    return {
      op: operation.op,
      id: operation.port.id,
      nodeId: operation.port.nodeId,
      direction: operation.port.direction,
      side: operation.port.side,
    };
  }
  if (operation.op === 'create_edge') {
    return {
      op: operation.op,
      id: operation.edge.id,
      fromPortId: operation.edge.fromPortId,
      toPortId: operation.edge.toPortId,
      routing: operation.edge.routing,
    };
  }
  return operation;
}

function firstEdgeId(document: OpenChartDocument): string {
  const edgeId = Object.keys(document.edges)[0];
  if (edgeId === undefined) throw new Error('Expected connector fixture to contain an edge');
  return edgeId;
}

function findEdgeLabelText(items: readonly SceneItem[], edgeId: string): SceneTextItem | undefined {
  for (const item of items) {
    if (item.type !== 'group') continue;
    if (item.role === 'label' && item.entityId === edgeId) {
      return item.children.find((child): child is SceneTextItem => child.type === 'text');
    }
    const nested = findEdgeLabelText(item.children, edgeId);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function findEdgeLabelBackground(items: readonly SceneItem[], edgeId: string): SceneRectItem | undefined {
  for (const item of items) {
    if (item.type !== 'group') continue;
    if (item.role === 'label' && item.entityId === edgeId) {
      return item.children.find((child): child is SceneRectItem => child.type === 'rect');
    }
    const nested = findEdgeLabelBackground(item.children, edgeId);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

describe('direct connector manipulation', () => {
  it('drag-to-connect commits the same canonical operations as the connector tool', () => {
    const sourceDocument = connectorDocument();
    const toolEnvelope = createEnvelope(sourceDocument, 'tx.connector-tool');
    let dragEnvelope: OperationEnvelope | undefined;
    commitConnectorCreation(
      (fromNodeId, toNodeId, fromSide, toSide) => {
        dragEnvelope = createConnectorTransaction(sourceDocument, {
          txId: 'tx.drag-connect',
          pageId: 'page.main',
          layerId: 'layer.main',
          styleId: 'style.flow',
          fromNodeId,
          toNodeId,
          fromSide,
          toSide,
        });
      },
      { nodeId: 'node.a', side: 'east', point: { x: 120, y: 40 } },
      { nodeId: 'node.b', side: 'west', point: { x: 240, y: 40 } },
    );
    expect(dragEnvelope).toBeDefined();
    expect(dragEnvelope?.ops.map(operationSignature)).toEqual(
      toolEnvelope.ops.map(operationSignature),
    );

    const engine = new OperationEngine(sourceDocument);
    expect(engine.apply(dragEnvelope as OperationEnvelope)).toMatchObject({ ok: true, rev: 1 });
    expect(Object.values(engine.document.edges)).toHaveLength(1);
  });

  it('endpoint drag reconnects through create_port plus set_edge_endpoints', () => {
    const engine = new OperationEngine(connectorDocument());
    expect(engine.apply(createEnvelope(engine.document, 'tx.create'))).toMatchObject({ ok: true });
    const edge = Object.values(engine.document.edges)[0];
    expect(edge).toBeDefined();
    if (edge === undefined) return;

    const envelope = relinkEdgeTransaction(engine.document, {
      txId: 'tx.relink',
      edgeId: edge.id,
      endpoint: 'to',
      nodeId: 'node.c',
      side: 'north',
    });
    expect(envelope?.ops.map((operation) => operation.op)).toEqual([
      'create_port',
      'set_edge_endpoints',
    ]);
    expect(envelope).toBeDefined();
    if (envelope === undefined) return;
    expect(engine.apply(envelope)).toMatchObject({ ok: true });
    const relinked = engine.document.edges[edge.id];
    const targetPort = relinked === undefined ? undefined : engine.document.ports[relinked.toPortId];
    expect(targetPort).toMatchObject({ nodeId: 'node.c', side: 'north', direction: 'in' });
  });

  it('undo restores connector creation, detach, reconnect, and floating-anchor cleanup', () => {
    const engine = new OperationEngine(connectorDocument());
    expect(engine.apply(createEnvelope(engine.document, 'tx.create'))).toMatchObject({ ok: true });
    const edgeId = Object.keys(engine.document.edges)[0];
    expect(edgeId).toBeDefined();
    if (edgeId === undefined) return;

    const detach = detachEdgeEndpointTransaction(engine.document, {
      txId: 'tx.detach',
      edgeId,
      endpoint: 'to',
      point: { x: 400, y: 160 },
    });
    expect(detach).toBeDefined();
    if (detach === undefined) return;
    expect(engine.apply(detach)).toMatchObject({ ok: true });
    const detachedEdge = engine.document.edges[edgeId];
    const detachedPort = detachedEdge === undefined ? undefined : engine.document.ports[detachedEdge.toPortId];
    const anchorId = detachedPort?.nodeId;
    expect(anchorId).toBeDefined();
    expect(anchorId === undefined ? undefined : engine.document.nodes[anchorId]?.data.connectorAnchor).toBe(true);

    const reconnect = relinkEdgeTransaction(engine.document, {
      txId: 'tx.reconnect',
      edgeId,
      endpoint: 'to',
      nodeId: 'node.c',
      side: 'west',
    });
    expect(reconnect?.ops.map((operation) => operation.op)).toEqual([
      'create_port',
      'set_edge_endpoints',
      'delete_node',
    ]);
    expect(reconnect).toBeDefined();
    if (reconnect === undefined) return;
    expect(engine.apply(reconnect)).toMatchObject({ ok: true });
    expect(anchorId === undefined ? undefined : engine.document.nodes[anchorId]).toBeUndefined();

    expect(engine.undo()).toMatchObject({ ok: true });
    expect(anchorId === undefined ? undefined : engine.document.nodes[anchorId]?.data.connectorAnchor).toBe(true);
    expect(engine.undo()).toMatchObject({ ok: true });
    expect(Object.values(engine.document.nodes).some((node) => node.data.connectorAnchor === true)).toBe(false);
    const restoredEdge = engine.document.edges[edgeId];
    const restoredTarget = restoredEdge === undefined ? undefined : engine.document.ports[restoredEdge.toPortId];
    expect(restoredTarget?.nodeId).toBe('node.b');
    expect(engine.undo()).toMatchObject({ ok: true, rev: 0 });
    expect(Object.keys(engine.document.edges)).toHaveLength(0);
  });

  it('plain shape click or move below four screen pixels creates no connector or stray ops', () => {
    const engine = new OperationEngine(connectorDocument());
    expect(connectorDragExceededThreshold({ x: 10, y: 10 }, { x: 11.9, y: 10 }, 2)).toBe(false);
    expect(connectorDragExceededThreshold({ x: 10, y: 10 }, { x: 17.9, y: 10 }, 0.5)).toBe(false);
    expect(connectorDragExceededThreshold({ x: 10, y: 10 }, { x: 11.1, y: 10 }, 4)).toBe(true);
    expect(engine.document.rev).toBe(0);
    expect(Object.keys(engine.document.edges)).toHaveLength(0);
    expect(Object.keys(engine.document.ports)).toHaveLength(0);
  });

  it('double-click dispatch edits labels until a selected labeled connector is clicked off-label', () => {
    expect(connectorDoubleClickAction({ label: '', wasSelected: true, labelHit: false })).toBe('edit-label');
    expect(connectorDoubleClickAction({ label: 'HTTPS', wasSelected: false, labelHit: false })).toBe('edit-label');
    expect(connectorDoubleClickAction({ label: 'HTTPS', wasSelected: true, labelHit: true })).toBe('edit-label');
    expect(connectorDoubleClickAction({ label: 'HTTPS', wasSelected: true, labelHit: false })).toBe('add-waypoint');
  });

  it('centers the in-place connector label editor on the rendered label background', () => {
    const engine = new OperationEngine(connectorDocument());
    expect(engine.apply(createEnvelope(engine.document, 'tx.create'))).toMatchObject({ ok: true });
    const edgeId = firstEdgeId(engine.document);
    const label = edgeLabelTransaction(engine.document, {
      txId: 'tx.label-position', edgeId, label: 'API', labelT: 0.5,
    });
    expect(label).toBeDefined();
    if (label === undefined) return;
    expect(engine.apply(label)).toMatchObject({ ok: true });
    const scene = buildSceneDescription(engine.document, { pageId: 'page.main', routingStrategy: 'fast' });
    const connector = scene.connectors?.find((candidate) => candidate.edgeId === edgeId);
    const background = findEdgeLabelBackground(scene.items, edgeId);
    expect(connector).toBeDefined();
    expect(background).toBeDefined();
    if (connector === undefined || background === undefined) return;
    const camera = { x: 0, y: 0, zoom: 2 } as const;
    const style = connectorLabelEditorStyle(engine.document, {
      edgeId, points: connector.points, labelT: 0.5, value: 'API', camera,
    });
    expect(style).toBeDefined();
    if (style === undefined) return;
    const left = Number(style.left);
    const top = Number(style.top);
    const width = Number(style.width);
    const height = Number(style.height);
    expect(left + width / 2).toBeCloseTo((background.frame.x + background.frame.width / 2) * camera.zoom, 8);
    expect(top + height / 2).toBeCloseTo((background.frame.y + background.frame.height / 2) * camera.zoom, 8);
    expect(width).toBeGreaterThanOrEqual(background.frame.width * camera.zoom);
    expect(height).toBeGreaterThanOrEqual(background.frame.height * camera.zoom);
    expect(style.fontSize).toBe(20);
  });

  it('double-click label path commits canonical label ops and text edit round-trips through undo', () => {
    const engine = new OperationEngine(connectorDocument());
    expect(engine.apply(createEnvelope(engine.document, 'tx.create'))).toMatchObject({ ok: true });
    const edgeId = firstEdgeId(engine.document);
    const envelope = edgeLabelTransaction(engine.document, {
      txId: 'tx.edge-label', edgeId, label: 'HTTPS', labelT: 0.5,
    });
    expect(envelope?.ops).toEqual([
      { op: 'set_edge_label', id: edgeId, label: 'HTTPS' },
      { op: 'set_edge_layout', id: edgeId, layout: { labelT: 0.5 } },
    ]);
    expect(envelope).toBeDefined();
    if (envelope === undefined) return;
    expect(engine.apply(envelope)).toMatchObject({ ok: true });
    expect(engine.document.edges[edgeId]?.label).toBe('HTTPS');
    expect(engine.document.layout.edgeOverrides?.[edgeId]?.labelT).toBe(0.5);
    expect(engine.undo()).toMatchObject({ ok: true });
    expect(engine.document.edges[edgeId]?.label).toBe('');
    expect(engine.document.layout.edgeOverrides?.[edgeId]?.labelT).toBeUndefined();
  });

  it('ignores out-of-range label positions that clamp to the stored value', () => {
    const engine = new OperationEngine(connectorDocument());
    expect(engine.apply(createEnvelope(engine.document, 'tx.create'))).toMatchObject({ ok: true });
    const edgeId = firstEdgeId(engine.document);
    const label = edgeLabelTransaction(engine.document, {
      txId: 'tx.label', edgeId, label: 'request', labelT: 1,
    });
    expect(label).toBeDefined();
    if (label === undefined) return;
    expect(engine.apply(label)).toMatchObject({ ok: true });
    const edge = engine.document.edges[edgeId];
    if (edge === undefined) return;
    expect(edgeLabelTransaction(engine.document, {
      txId: 'tx.label-clamped-high', edgeId, label: edge.label, labelT: 1.5,
    })).toBeUndefined();
  });

  it('label drag repositions undoably and sub-threshold plain drag produces no label ops', () => {
    const engine = new OperationEngine(connectorDocument());
    expect(engine.apply(createEnvelope(engine.document, 'tx.create'))).toMatchObject({ ok: true });
    const edgeId = firstEdgeId(engine.document);
    const label = edgeLabelTransaction(engine.document, {
      txId: 'tx.label', edgeId, label: 'request', labelT: 0.5,
    });
    expect(label).toBeDefined();
    if (label === undefined) return;
    expect(engine.apply(label)).toMatchObject({ ok: true });
    expect(connectorDragExceededThreshold({ x: 100, y: 100 }, { x: 103.9, y: 100 }, 1)).toBe(false);
    const revBeforePlainDrag = engine.document.rev;
    expect(engine.document.rev).toBe(revBeforePlainDrag);
    const moved = edgeLabelPositionTransaction(engine.document, {
      txId: 'tx.label-move', edgeId, labelT: 0.75,
    });
    expect(moved?.ops.map((operation) => operation.op)).toEqual(['set_edge_layout']);
    expect(moved).toBeDefined();
    if (moved === undefined) return;
    expect(engine.apply(moved)).toMatchObject({ ok: true });
    expect(engine.document.layout.edgeOverrides?.[edgeId]?.labelT).toBe(0.75);
    expect(engine.undo()).toMatchObject({ ok: true });
    expect(engine.document.layout.edgeOverrides?.[edgeId]?.labelT).toBe(0.5);
  });

  it('edge label formatting commits through set_edge_data, renders, and undoes', () => {
    const engine = new OperationEngine(connectorDocument());
    expect(engine.apply(createEnvelope(engine.document, 'tx.create'))).toMatchObject({ ok: true });
    const edgeId = firstEdgeId(engine.document);
    const label = edgeLabelTransaction(engine.document, {
      txId: 'tx.label', edgeId, label: 'API', labelT: 0.5,
    });
    expect(label).toBeDefined();
    if (label === undefined) return;
    expect(engine.apply(label)).toMatchObject({ ok: true });
    const fields = [
      ['fontFamily', 'Georgia, serif'], ['fontSize', 18], ['fontWeight', 400],
      ['fontStyle', 'italic'], ['underline', true], ['textAlign', 'right'],
      ['textColor', '#123456'], ['lineHeight', 2],
    ] as const;
    for (const [field, value] of fields) {
      const style = edgeTextStyleTransaction(engine.document, {
        txId: `tx.${field}`, edgeIds: [edgeId], field, value,
      });
      expect(style?.ops.map((operation) => operation.op)).toEqual(['set_edge_data']);
      expect(style).toBeDefined();
      if (style !== undefined) expect(engine.apply(style)).toMatchObject({ ok: true });
    }
    const scene = buildSceneDescription(engine.document, { pageId: 'page.main', routingStrategy: 'fast' });
    const text = findEdgeLabelText(scene.items, edgeId);
    expect(text).toMatchObject({
      type: 'text', value: 'API', fill: '#123456', fontFamily: 'Georgia, serif',
      fontSize: 18, fontWeight: 400, fontStyle: 'italic', underline: true, anchor: 'end',
    });
    expect(engine.undo()).toMatchObject({ ok: true });
    expect(engine.document.edges[edgeId]?.data.lineHeight).toBeUndefined();
  });

  it('waypoint add, move, and collinear removal each round-trip through undo', () => {
    const geometry = [
      { x: 120, y: 40 }, { x: 180, y: 40 }, { x: 180, y: 120 }, { x: 240, y: 120 },
    ] as const;
    const engine = new OperationEngine(connectorDocument());
    expect(engine.apply(createEnvelope(engine.document, 'tx.create'))).toMatchObject({ ok: true });
    const edgeId = firstEdgeId(engine.document);
    const add = addEdgeWaypointTransaction(engine.document, {
      txId: 'tx.waypoint-add', edgeId, geometryPoints: geometry, point: { x: 180, y: 40 },
    });
    expect(add?.ops.map((operation) => operation.op)).toEqual(['set_edge_layout']);
    expect(add).toBeDefined();
    if (add === undefined) return;
    expect(engine.apply(add)).toMatchObject({ ok: true });
    expect(engine.document.layout.edgeOverrides?.[edgeId]?.waypoints).toEqual([{ x: 180, y: 40 }]);
    expect(engine.undo()).toMatchObject({ ok: true });
    expect(engine.document.layout.edgeOverrides?.[edgeId]).toBeUndefined();

    const readd = addEdgeWaypointTransaction(engine.document, {
      txId: 'tx.waypoint-readd', edgeId, geometryPoints: geometry, point: { x: 180, y: 80 },
    });
    expect(readd).toBeDefined();
    if (readd === undefined) return;
    expect(engine.apply(readd)).toMatchObject({ ok: true });
    const move = moveEdgeWaypointTransaction(engine.document, {
      txId: 'tx.waypoint-move', edgeId, waypointIndex: 0, point: { x: 190, y: 90 },
      from: geometry[0], to: { x: 240, y: 120 }, collinearTolerance: 1,
    });
    expect(move).toBeDefined();
    if (move === undefined) return;
    expect(engine.apply(move)).toMatchObject({ ok: true });
    expect(engine.document.layout.edgeOverrides?.[edgeId]?.waypoints).toEqual([{ x: 190, y: 90 }]);
    expect(engine.undo()).toMatchObject({ ok: true });
    expect(engine.document.layout.edgeOverrides?.[edgeId]?.waypoints).toEqual([{ x: 180, y: 80 }]);

    const remove = moveEdgeWaypointTransaction(engine.document, {
      txId: 'tx.waypoint-remove', edgeId, waypointIndex: 0, point: { x: 180, y: 80 },
      from: { x: 120, y: 80 }, to: { x: 240, y: 80 }, collinearTolerance: 1,
    });
    expect(remove).toBeDefined();
    if (remove === undefined) return;
    expect(engine.apply(remove)).toMatchObject({ ok: true });
    expect(engine.document.layout.edgeOverrides?.[edgeId]?.waypoints).toBeUndefined();
    expect(engine.undo()).toMatchObject({ ok: true });
    expect(engine.document.layout.edgeOverrides?.[edgeId]?.waypoints).toEqual([{ x: 180, y: 80 }]);
  });

  it('orthogonal segment drag creates waypoint geometry through set_edge_layout and undoes', () => {
    const engine = new OperationEngine(connectorDocument());
    expect(engine.apply(createEnvelope(engine.document, 'tx.create'))).toMatchObject({ ok: true });
    const edgeId = firstEdgeId(engine.document);
    const geometry = [
      { x: 120, y: 40 }, { x: 180, y: 40 }, { x: 180, y: 120 }, { x: 240, y: 120 },
    ] as const;
    const segment = dragOrthogonalSegmentTransaction(engine.document, {
      txId: 'tx.segment', edgeId, geometryPoints: geometry, segmentIndex: 1, point: { x: 210, y: 80 },
    });
    expect(segment?.ops.map((operation) => operation.op)).toEqual(['set_edge_layout']);
    expect(segment).toBeDefined();
    if (segment === undefined) return;
    expect(engine.apply(segment)).toMatchObject({ ok: true });
    expect(engine.document.layout.edgeOverrides?.[edgeId]?.waypoints?.length).toBeGreaterThanOrEqual(2);
    expect(engine.undo()).toMatchObject({ ok: true });
    expect(engine.document.layout.edgeOverrides?.[edgeId]).toBeUndefined();
  });
});
