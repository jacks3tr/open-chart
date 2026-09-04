import { describe, expect, it } from 'vitest';
import northstarInput from '../../../examples/northstar-integration.openchart.json';
import { createTransformTransaction, type TransformPreview } from '@openchart/interact';
import { validateDocument, type OpenChartDocument } from '@openchart/ir';
import { OperationEngine } from '@openchart/ops';

import { createBrowserTextExport } from '../src/openchart-editor.js';
import {
  parseDesktopDocument,
  serializeOpenChartDocument,
} from '../src/desktop-file.js';
import { createOpenChartPageImportTransaction } from '../src/document-import.js';
import {
  createBlankInitialDocument,
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

function deterministicUidFactory(start = 1000): () => string {
  let next = start;
  return () => String(next++).padStart(26, '0');
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

function createApprovalFlowchartDocument(): {
  readonly document: OpenChartDocument;
  readonly pageId: string;
  readonly layerId: string;
} {
  const base = createBlankInitialDocument(editableDocument());
  const { pageId, layerId } = targetPage(base);
  const transaction = createStarterTemplateTransaction(base, getStarterTemplate('flowchart'), {
    txId: 'tx.fixture.approval-flowchart',
    pageId,
    layerId,
    makeUid: deterministicUidFactory(),
  });
  const engine = new OperationEngine(base);
  const applied = engine.apply(transaction.envelope);
  if (!applied.ok) {
    throw new Error(`Unable to build Approval flowchart fixture: ${JSON.stringify(applied.diagnostics)}`);
  }
  return { document: engine.document, pageId, layerId };
}

function requiredFrame(document: OpenChartDocument, nodeId: string): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation?: number;
} {
  const layout = document.layout.overrides[nodeId];
  if (
    layout === undefined ||
    typeof layout.x !== 'number' ||
    typeof layout.y !== 'number' ||
    typeof layout.width !== 'number' ||
    typeof layout.height !== 'number'
  ) {
    throw new Error(`Expected explicit frame for ${nodeId}`);
  }
  return {
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
    ...(layout.rotation === undefined ? {} : { rotation: layout.rotation }),
  };
}

describe('import/export fidelity', () => {
  it('exports the Approval flowchart to D2 and Mermaid with explicit projection loss notices', () => {
    const { document, pageId } = createApprovalFlowchartDocument();
    const d2 = createBrowserTextExport(document, 'd2', pageId);
    const mermaid = createBrowserTextExport(document, 'mermaid', pageId);

    expect(d2.extension).toBe('d2');
    expect(mermaid.extension).toBe('mmd');
    expect(d2.mimeType).toBe('text/plain;charset=utf-8');
    expect(mermaid.mimeType).toBe('text/plain;charset=utf-8');

    expect(d2.content).toContain('# openchart-d2-v1');
    expect(d2.content).toContain('Request received');
    expect(d2.content).toContain('Meets policy?');
    expect(d2.content).toContain('Approve request');
    expect(d2.content).toContain('Yes');
    expect(d2.content).toContain('->');

    expect(mermaid.content).toContain('flowchart LR');
    expect(mermaid.content).toContain('Request received');
    expect(mermaid.content).toContain('Meets policy?');
    expect(mermaid.content).toContain('Approve request');
    expect(mermaid.content).toContain('Yes');
    expect(mermaid.content).toContain('-->');

    for (const exported of [d2, mermaid]) {
      const lossCodes = exported.losses.map((loss) => loss.code);
      expect(lossCodes).toContain('LAYOUT_OMITTED');
      expect(lossCodes).toContain('STYLE_METADATA_OMITTED');
      expect(lossCodes).toContain('ROUTING_OMITTED');
    }
  });

  it('round-trips canonical OpenChart JSON without losing entities, geometry, labels, data, or routing', () => {
    const { document } = createApprovalFlowchartDocument();
    const parsed = parseDesktopDocument(serializeOpenChartDocument(document));

    expect(parsed.nodes).toEqual(document.nodes);
    expect(parsed.ports).toEqual(document.ports);
    expect(parsed.edges).toEqual(document.edges);
    expect(parsed.layout.overrides).toEqual(document.layout.overrides);
    expect(parsed.layout.edgeOverrides).toEqual(document.layout.edgeOverrides);
    expect(
      Object.values(parsed.nodes).map((node) => ({ id: node.id, label: node.label, data: node.data })),
    ).toEqual(
      Object.values(document.nodes).map((node) => ({ id: node.id, label: node.label, data: node.data })),
    );
    expect(
      Object.values(parsed.edges).map((edge) => ({
        id: edge.id,
        label: edge.label,
        data: edge.data,
        routing: edge.routing,
      })),
    ).toEqual(
      Object.values(document.edges).map((edge) => ({
        id: edge.id,
        label: edge.label,
        data: edge.data,
        routing: edge.routing,
      })),
    );
    expect(parsed).toEqual(document);
  });

  it('imports a JSON page as one canonical transaction and one undo restores the prior page', () => {
    const target = editableDocument();
    const { pageId, layerId } = targetPage(target);
    const before = pageSnapshot(target, pageId);
    const source = createApprovalFlowchartDocument().document;
    const imported = createOpenChartPageImportTransaction(target, source, {
      txId: 'tx.import.approval-flowchart',
      targetPageId: pageId,
      targetLayerId: layerId,
      makeUid: deterministicUidFactory(2000),
    });

    const operationKinds = imported.envelope.ops.map((operation) => operation.op);
    expect(operationKinds).toEqual(expect.arrayContaining([
      'delete_node',
      'create_node',
      'set_node_layout',
      'create_port',
      'create_edge',
      'set_edge_layout',
    ]));

    const engine = new OperationEngine(target);
    expect(engine.apply(imported.envelope)).toMatchObject({ ok: true });
    expect(engine.history.undoStack).toHaveLength(1);

    const importedNodes = imported.nodeIds.map((id) => engine.document.nodes[id]);
    expect(importedNodes.every((node) => node !== undefined)).toBe(true);
    expect(importedNodes).toHaveLength(getStarterTemplate('flowchart').nodes.length);
    expect(imported.edgeIds).toHaveLength(getStarterTemplate('flowchart').edges.length);
    expect(importedNodes.map((node) => node?.label).sort()).toEqual(
      Object.values(source.nodes).map((node) => node.label).sort(),
    );

    for (const node of importedNodes) {
      if (node === undefined) continue;
      const sourceNode = Object.values(source.nodes).find((candidate) => candidate.label === node.label);
      expect(sourceNode).toBeDefined();
      if (sourceNode !== undefined) {
        expect(engine.document.layout.overrides[node.id]).toEqual(source.layout.overrides[sourceNode.id]);
      }
    }

    for (const edgeId of imported.edgeIds) {
      const edge = engine.document.edges[edgeId];
      expect(edge).toBeDefined();
      if (edge === undefined) continue;
      const fromPort = engine.document.ports[edge.fromPortId];
      const toPort = engine.document.ports[edge.toPortId];
      expect(fromPort).toBeDefined();
      expect(toPort).toBeDefined();
      expect(engine.document.nodes[fromPort?.nodeId ?? '']).toBeDefined();
      expect(engine.document.nodes[toPort?.nodeId ?? '']).toBeDefined();
    }
    expect(imported.edgeIds.some((id) => engine.document.edges[id]?.label === 'Yes')).toBe(true);

    expect(engine.undo()).toMatchObject({ ok: true });
    expect(pageSnapshot(engine.document, pageId)).toEqual(before);
  });

  it('composes import with a real transform and preserves ordered undo', () => {
    const target = editableDocument();
    const { pageId, layerId } = targetPage(target);
    const before = pageSnapshot(target, pageId);
    const source = createApprovalFlowchartDocument().document;
    const imported = createOpenChartPageImportTransaction(target, source, {
      txId: 'tx.import.compose',
      targetPageId: pageId,
      targetLayerId: layerId,
      makeUid: deterministicUidFactory(3000),
    });
    const engine = new OperationEngine(target);
    expect(engine.apply(imported.envelope)).toMatchObject({ ok: true });
    const importedState = pageSnapshot(engine.document, pageId);

    const nodeId = imported.nodeIds[0];
    if (nodeId === undefined) throw new Error('Expected an imported node');
    const frame = requiredFrame(engine.document, nodeId);
    const movedFrame = { ...frame, x: frame.x + 80, y: frame.y + 24 };
    const preview: TransformPreview = {
      selectionBounds: movedFrame,
      updates: { [nodeId]: movedFrame },
    };
    expect(
      engine.apply(
        createTransformTransaction(engine.document, preview, { txId: 'tx.import.compose-move' }),
      ),
    ).toMatchObject({ ok: true });
    expect(engine.document.layout.overrides[nodeId]?.x).toBe(frame.x + 80);

    expect(engine.undo()).toMatchObject({ ok: true });
    expect(pageSnapshot(engine.document, pageId)).toEqual(importedState);
    expect(engine.undo()).toMatchObject({ ok: true });
    expect(pageSnapshot(engine.document, pageId)).toEqual(before);
  });
});
