import { describe, expect, it } from 'vitest';
import { createTransformTransaction, type TransformPreview } from '@openchart/interact';
import { validateDocument, type OpenChartDocument } from '@openchart/ir';
import { OperationEngine } from '@openchart/ops';

import {
  createConnectorVisualStyleTransaction,
  createSelectionTextStyleTransaction,
  createShapeVisualStyleTransaction,
} from '../src/selection-styling.js';

const uid = (value: number): string => value.toString().padStart(26, '0');

function stylingDocument(): OpenChartDocument {
  const result = validateDocument({
    schemaVersion: 1,
    documentId: 'document.selection-styling',
    uid: uid(1),
    title: 'Selection styling',
    rev: 0,
    pages: {
      'page.main': { id: 'page.main', uid: uid(2), name: 'Main', layerIds: ['layer.main'] },
    },
    layers: {
      'layer.main': {
        id: 'layer.main', uid: uid(3), name: 'Diagram', pageId: 'page.main', visible: true, locked: false,
      },
    },
    nodes: {
      'node.a': {
        id: 'node.a', uid: uid(10), kind: 'service', label: 'Service A',
        pageId: 'page.main', layerId: 'layer.main', styleId: 'style.node', data: {},
      },
      'node.b': {
        id: 'node.b', uid: uid(11), kind: 'text', label: 'Standalone text',
        pageId: 'page.main', layerId: 'layer.main', styleId: 'style.node', data: {},
      },
    },
    ports: {
      'port.a.out': { id: 'port.a.out', uid: uid(20), nodeId: 'node.a', direction: 'out', side: 'east' },
      'port.b.in': { id: 'port.b.in', uid: uid(21), nodeId: 'node.b', direction: 'in', side: 'west' },
    },
    edges: {
      'edge.ab': {
        id: 'edge.ab', uid: uid(30), fromPortId: 'port.a.out', toPortId: 'port.b.in',
        label: 'API', semantic: 'Flow', pageId: 'page.main', layerId: 'layer.main', styleId: 'style.flow',
        routing: { mode: 'orthogonal', avoidObstacles: true, endMarker: 'arrow' }, data: {},
      },
    },
    styles: {
      'style.node': {
        id: 'style.node', uid: uid(40), role: 'node/default',
        tokens: { surface: '#FFFFFF', accent: '#64748B' },
      },
      'style.flow': {
        id: 'style.flow', uid: uid(41), role: 'flow/default', tokens: { stroke: '#64748B' },
      },
    },
    layout: {
      overrides: {
        'node.a': { x: 80, y: 100, width: 180, height: 100, pinned: true },
        'node.b': { x: 380, y: 100, width: 180, height: 100, pinned: true },
      },
      edgeOverrides: {},
      derived: null,
    },
    meta: {
      createdAt: '2026-09-04T00:00:00.000Z', updatedAt: '2026-09-04T00:00:00.000Z',
    },
  });
  if (!result.ok) {
    throw new Error(`Invalid styling fixture: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.document;
}

function frame(document: OpenChartDocument, id: string) {
  const layout = document.layout.overrides[id];
  if (
    layout === undefined ||
    typeof layout.x !== 'number' ||
    typeof layout.y !== 'number' ||
    typeof layout.width !== 'number' ||
    typeof layout.height !== 'number'
  ) {
    throw new Error(`Missing frame for ${id}`);
  }
  return {
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
    ...(typeof layout.rotation === 'number' ? { rotation: layout.rotation } : {}),
  };
}

describe('selection styling transactions', () => {
  it('commits shape appearance as one canonical set_node_data operation and undo restores it', () => {
    const source = stylingDocument();
    const envelope = createShapeVisualStyleTransaction(
      source,
      ['node.a'],
      {
        fillColor: '#DBEAFE',
        borderColor: '#2563EB',
        borderWidth: 3,
        borderStyle: 'dashed',
        cornerRadius: 18,
        shadowEnabled: true,
        shadowStrength: 0.6,
        opacity: 0.8,
      },
      { txId: 'tx.shape-style' },
    );
    expect(envelope).toBeDefined();
    if (envelope === undefined) return;
    expect(envelope).toMatchObject({
      txId: 'tx.shape-style', actor: 'user', origin: 'gui', baseRev: 0,
    });
    expect(envelope.ops).toEqual([{
      op: 'set_node_data',
      id: 'node.a',
      data: {
        fillColor: '#DBEAFE', borderColor: '#2563EB', borderWidth: 3,
        borderStyle: 'dashed', cornerRadius: 18, shadowEnabled: true,
        shadowStrength: 0.6, opacity: 0.8,
      },
    }]);

    const engine = new OperationEngine(source);
    expect(engine.apply(envelope)).toMatchObject({ ok: true });
    expect(engine.document.nodes['node.a']?.data).toMatchObject({
      fillColor: '#DBEAFE', borderColor: '#2563EB', borderWidth: 3,
      borderStyle: 'dashed', cornerRadius: 18, shadowEnabled: true,
      shadowStrength: 0.6, opacity: 0.8,
    });
    expect(engine.undo()).toMatchObject({ ok: true });
    expect(engine.document.nodes['node.a']?.data).toEqual({});
  });

  it('applies one shape style change to every selected shape', () => {
    const source = stylingDocument();
    const envelope = createShapeVisualStyleTransaction(
      source,
      ['node.a', 'node.b'],
      { fillColor: '#DCFCE7', borderStyle: 'dotted' },
      { txId: 'tx.multi-shape-style' },
    );
    expect(envelope?.ops.map((operation) => operation.op)).toEqual(['set_node_data', 'set_node_data']);
    expect(envelope?.ops.map((operation) => 'id' in operation ? operation.id : undefined)).toEqual(['node.a', 'node.b']);

    const engine = new OperationEngine(source);
    if (envelope === undefined) throw new Error('Expected a multi-selection style transaction');
    expect(engine.apply(envelope)).toMatchObject({ ok: true });
    for (const id of ['node.a', 'node.b']) {
      expect(engine.document.nodes[id]?.data).toMatchObject({ fillColor: '#DCFCE7', borderStyle: 'dotted' });
    }
    expect(engine.undo()).toMatchObject({ ok: true });
    expect(engine.document.nodes['node.a']?.data).toEqual({});
    expect(engine.document.nodes['node.b']?.data).toEqual({});
  });

  it('styles connectors through set_edge_data plus set_edge_routing and undo restores both', () => {
    const source = stylingDocument();
    const envelope = createConnectorVisualStyleTransaction(
      source,
      ['edge.ab'],
      {
        strokeColor: '#7C3AED', lineWidth: 4, lineStyle: 'dashed',
        startMarker: 'circle', endMarker: 'arrow', mode: 'curved', cornerRadius: 20,
      },
      { txId: 'tx.connector-style' },
    );
    expect(envelope?.ops.map((operation) => operation.op)).toEqual(['set_edge_data', 'set_edge_routing']);
    const routingOp = envelope?.ops.find((operation) => operation.op === 'set_edge_routing');
    expect(routingOp).toMatchObject({
      op: 'set_edge_routing', id: 'edge.ab',
      routing: {
        mode: 'curved', avoidObstacles: true, lineWidth: 4, lineStyle: 'dashed',
        startMarker: 'circle', endMarker: 'arrow', cornerRadius: 20,
      },
    });

    const engine = new OperationEngine(source);
    if (envelope === undefined) throw new Error('Expected a connector style transaction');
    expect(engine.apply(envelope)).toMatchObject({ ok: true });
    expect(engine.document.edges['edge.ab']?.data.strokeColor).toBe('#7C3AED');
    expect(engine.document.edges['edge.ab']?.routing).toMatchObject({
      mode: 'curved', lineWidth: 4, lineStyle: 'dashed', startMarker: 'circle', endMarker: 'arrow', cornerRadius: 20,
    });
    expect(engine.undo()).toMatchObject({ ok: true });
    expect(engine.document.edges['edge.ab']?.data).toEqual({});
    expect(engine.document.edges['edge.ab']?.routing).toEqual({ mode: 'orthogonal', avoidObstacles: true, endMarker: 'arrow' });
  });

  it('applies shared text formatting to shape text and connector labels through canonical data ops', () => {
    const source = stylingDocument();
    const envelope = createSelectionTextStyleTransaction(
      source,
      ['node.b', 'edge.ab'],
      'fontFamily',
      'Georgia, serif',
      { txId: 'tx.text-style' },
    );
    expect(envelope?.ops.map((operation) => operation.op)).toEqual(['set_node_data', 'set_edge_data']);
    const engine = new OperationEngine(source);
    if (envelope === undefined) throw new Error('Expected a text style transaction');
    expect(engine.apply(envelope)).toMatchObject({ ok: true });
    expect(engine.document.nodes['node.b']?.data.fontFamily).toBe('Georgia, serif');
    expect(engine.document.edges['edge.ab']?.data.fontFamily).toBe('Georgia, serif');
    expect(engine.undo()).toMatchObject({ ok: true });
    expect(engine.document.nodes['node.b']?.data.fontFamily).toBeUndefined();
    expect(engine.document.edges['edge.ab']?.data.fontFamily).toBeUndefined();
  });

  it('keeps style and transform undo ordering independent and clean', () => {
    const engine = new OperationEngine(stylingDocument());
    const style = createShapeVisualStyleTransaction(
      engine.document,
      ['node.a'],
      { borderColor: '#DC2626', borderWidth: 4 },
      { txId: 'tx.style-before-move' },
    );
    if (style === undefined) throw new Error('Expected a style transaction');
    expect(engine.apply(style)).toMatchObject({ ok: true });

    const beforeMove = frame(engine.document, 'node.a');
    const moved = { ...beforeMove, x: beforeMove.x + 72, y: beforeMove.y + 28 };
    const preview: TransformPreview = { selectionBounds: moved, updates: { 'node.a': moved } };
    const move = createTransformTransaction(engine.document, preview, { txId: 'tx.move-after-style' });
    expect(engine.apply(move)).toMatchObject({ ok: true });
    expect(frame(engine.document, 'node.a')).toMatchObject({ x: moved.x, y: moved.y });
    expect(engine.document.nodes['node.a']?.data).toMatchObject({ borderColor: '#DC2626', borderWidth: 4 });

    expect(engine.undo()).toMatchObject({ ok: true });
    expect(frame(engine.document, 'node.a')).toEqual(beforeMove);
    expect(engine.document.nodes['node.a']?.data).toMatchObject({ borderColor: '#DC2626', borderWidth: 4 });

    expect(engine.undo()).toMatchObject({ ok: true });
    expect(frame(engine.document, 'node.a')).toEqual(beforeMove);
    expect(engine.document.nodes['node.a']?.data).toEqual({});
  });
});