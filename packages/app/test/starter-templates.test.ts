import { describe, expect, it } from 'vitest';
import northstarInput from '../../../examples/northstar-integration.openchart.json';
import { createTransformTransaction, type TransformPreview } from '@openchart/interact';
import { validateDocument, type OpenChartDocument } from '@openchart/ir';
import { OperationEngine } from '@openchart/ops';
import { evaluateShapeDefinition } from '@openchart/shapes';
import { resolveLibraryShape } from '@openchart/shapes/libraries';

import {
  STARTER_TEMPLATES,
  createStarterTemplateTransaction,
  getStarterTemplate,
} from '../src/starter-templates.js';

function editableDocument(): OpenChartDocument {
  const validation = validateDocument(northstarInput);
  if (!validation.ok) {
    throw new Error(`Invalid app fixture: ${JSON.stringify(validation.diagnostics)}`);
  }
  return validation.document;
}

function targetPage(document: OpenChartDocument): {
  readonly pageId: string;
  readonly layerId: string;
} {
  const page = Object.values(document.pages)
    .toSorted((left, right) => (left.order ?? 0) - (right.order ?? 0))[0];
  const layerId = page?.layerIds.find((id) => document.layers[id]?.locked !== true);
  if (page === undefined || layerId === undefined) {
    throw new Error('Expected an editable page and layer in the app fixture');
  }
  return { pageId: page.id, layerId };
}

function pageSnapshot(document: OpenChartDocument, pageId: string): unknown {
  const nodes = Object.values(document.nodes)
    .filter((node) => node.pageId === pageId)
    .toSorted((left, right) => left.id.localeCompare(right.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const ports = Object.values(document.ports)
    .filter((port) => nodeIds.has(port.nodeId))
    .toSorted((left, right) => left.id.localeCompare(right.id));
  const portIds = new Set(ports.map((port) => port.id));
  const edges = Object.values(document.edges)
    .filter(
      (edge) =>
        edge.pageId === pageId ||
        portIds.has(edge.fromPortId) ||
        portIds.has(edge.toPortId),
    )
    .toSorted((left, right) => left.id.localeCompare(right.id));
  const edgeIds = new Set(edges.map((edge) => edge.id));
  return {
    nodes,
    ports,
    edges,
    overrides: Object.fromEntries(
      Object.entries(document.layout.overrides)
        .filter(([id]) => nodeIds.has(id))
        .toSorted(([left], [right]) => left.localeCompare(right)),
    ),
    edgeOverrides: Object.fromEntries(
      Object.entries(document.layout.edgeOverrides ?? {})
        .filter(([id]) => edgeIds.has(id))
        .toSorted(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

function pageCounts(document: OpenChartDocument, pageId: string): {
  readonly nodes: number;
  readonly edges: number;
} {
  return {
    nodes: Object.values(document.nodes).filter((node) => node.pageId === pageId).length,
    edges: Object.values(document.edges).filter((edge) => edge.pageId === pageId).length,
  };
}

describe('starter templates', () => {
  for (const template of STARTER_TEMPLATES) {
    it(`${template.name} applies through canonical ops and one undo restores the prior page`, () => {
      const source = editableDocument();
      const { pageId, layerId } = targetPage(source);
      const before = pageSnapshot(source, pageId);
      const transaction = createStarterTemplateTransaction(source, template, {
        txId: `tx.template.${template.id}`,
        pageId,
        layerId,
      });

      expect(
        transaction.envelope.ops.filter((operation) => operation.op === 'create_node'),
      ).toHaveLength(template.nodes.length);
      expect(
        transaction.envelope.ops.filter((operation) => operation.op === 'set_node_layout'),
      ).toHaveLength(template.nodes.length);
      expect(
        transaction.envelope.ops.filter((operation) => operation.op === 'create_port'),
      ).toHaveLength(template.edges.length * 2);
      expect(
        transaction.envelope.ops.filter((operation) => operation.op === 'create_edge'),
      ).toHaveLength(template.edges.length);

      for (const spec of template.nodes) {
        const resolved = resolveLibraryShape(spec.libraryId, spec.entryId);
        expect(resolved.ok, `${spec.libraryId}:${spec.entryId}`).toBe(true);
        if (!resolved.ok) continue;
        expect(resolved.definition.ports?.length ?? 0).toBeGreaterThan(0);
        const evaluated = evaluateShapeDefinition(resolved.definition);
        expect(evaluated.ok, `${spec.libraryId}:${spec.entryId}`).toBe(true);
        if (evaluated.ok) {
          expect(evaluated.shape.geometry.length).toBeGreaterThan(0);
        }
      }

      const engine = new OperationEngine(source);
      expect(engine.apply(transaction.envelope)).toMatchObject({ ok: true });
      expect(pageCounts(engine.document, pageId)).toEqual({
        nodes: template.nodes.length,
        edges: template.edges.length,
      });

      const insertedNodeIds = new Set(transaction.nodeIds);
      for (const edgeId of transaction.edgeIds) {
        const edge = engine.document.edges[edgeId];
        expect(edge).toBeDefined();
        if (edge === undefined) continue;
        const fromPort = engine.document.ports[edge.fromPortId];
        const toPort = engine.document.ports[edge.toPortId];
        expect(fromPort).toBeDefined();
        expect(toPort).toBeDefined();
        expect(engine.document.nodes[fromPort?.nodeId ?? '']).toBeDefined();
        expect(engine.document.nodes[toPort?.nodeId ?? '']).toBeDefined();
        expect(insertedNodeIds.has(fromPort?.nodeId ?? '')).toBe(true);
        expect(insertedNodeIds.has(toPort?.nodeId ?? '')).toBe(true);
      }

      expect(engine.undo()).toMatchObject({ ok: true });
      expect(pageSnapshot(engine.document, pageId)).toEqual(before);
    });
  }

  it('template insertion composes with a user move and ordered undo', () => {
    const source = editableDocument();
    const { pageId, layerId } = targetPage(source);
    const before = pageSnapshot(source, pageId);
    const template = getStarterTemplate('integration');
    const transaction = createStarterTemplateTransaction(source, template, {
      txId: 'tx.template.integration-compose',
      pageId,
      layerId,
    });
    const engine = new OperationEngine(source);
    expect(engine.apply(transaction.envelope)).toMatchObject({ ok: true });
    const templateState = pageSnapshot(engine.document, pageId);

    const nodeId = transaction.nodeIds[0];
    expect(nodeId).toBeDefined();
    if (nodeId === undefined) return;
    const layout = engine.document.layout.overrides[nodeId];
    expect(layout).toBeDefined();
    if (
      layout?.x === undefined ||
      layout.y === undefined ||
      layout.width === undefined ||
      layout.height === undefined
    ) {
      return;
    }
    const moved = {
      x: layout.x + 48,
      y: layout.y + 24,
      width: layout.width,
      height: layout.height,
      ...(layout.rotation === undefined ? {} : { rotation: layout.rotation }),
    };
    const movePreview: TransformPreview = {
      selectionBounds: moved,
      updates: { [nodeId]: moved },
    };
    expect(
      engine.apply(
        createTransformTransaction(engine.document, movePreview, {
          txId: 'tx.template.user-move',
        }),
      ),
    ).toMatchObject({ ok: true });
    expect(engine.document.layout.overrides[nodeId]?.x).toBe(layout.x + 48);

    expect(engine.undo()).toMatchObject({ ok: true });
    expect(pageSnapshot(engine.document, pageId)).toEqual(templateState);
    expect(engine.undo()).toMatchObject({ ok: true });
    expect(pageSnapshot(engine.document, pageId)).toEqual(before);
  });
});
