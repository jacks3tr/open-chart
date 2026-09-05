import { describe, expect, it } from 'vitest';
import northstarInput from '../../../examples/northstar-integration.openchart.json';
import { validateDocument, type Node, type OpenChartDocument } from '@openchart/ir';
import { OperationEngine } from '@openchart/ops';
import { exportDocumentToD2, exportDocumentToMermaid } from '@openchart/serialize';
import { evaluateShapeDefinition } from '@openchart/shapes';
import { listShapeLibraries as listBuiltinShapeLibraries } from '@openchart/shapes/libraries-core';

import { createShapeInsertionTransaction, type CatalogShapeRef } from '../src/openchart-editor.js';
import {
  loadBrowserTextExport,
  loadFullShapeCatalog,
  loadStarterTemplates,
} from '../src/lazy-features.js';

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

function deterministicUidFactory(start = 7000): () => string {
  let next = start;
  return () => String(next++).padStart(26, '0');
}

function insertionNode(document: OpenChartDocument, ref: CatalogShapeRef): Node {
  const { pageId, layerId } = targetPage(document);
  const styleId = Object.keys(document.styles)[0];
  if (styleId === undefined) throw new Error('Expected a style in the app fixture');
  return {
    id: 'node.lazy.decorative',
    uid: '8'.repeat(26),
    kind: 'service',
    label: 'PostgreSQL',
    pageId,
    layerId,
    styleId,
    data: { shape: { libraryId: ref.libraryId, entryId: ref.entryId } },
  };
}

describe('lazy feature loading', () => {
  it('keeps the startup catalog built-in-only and resolves/inserts decorative shapes after lazy loading', async () => {
    const builtins = listBuiltinShapeLibraries();
    expect(builtins.reduce((total, library) => total + library.entries.length, 0)).toBe(429);
    expect(builtins.some((library) => library.id === 'simple-icons' || library.id === 'phosphor')).toBe(false);

    const catalog = await loadFullShapeCatalog();
    const result = catalog.searchShapeLibraries('simple postgres', { limit: 10 })
      .find((candidate) => candidate.libraryId === 'simple-icons' && candidate.entry.id === 'simple.postgresql');
    expect(result).toBeDefined();
    if (result === undefined) return;

    const resolved = catalog.resolveLibraryShape(result.libraryId, result.entry.id);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(evaluateShapeDefinition(resolved.definition).ok).toBe(true);

    const source = editableDocument();
    const node = insertionNode(source, { libraryId: result.libraryId, entryId: result.entry.id });
    const frame = { x: 420, y: 260, width: 96, height: 96 };
    const envelope = createShapeInsertionTransaction(source, {
      txId: 'tx.lazy.decorative',
      node,
      frame,
    });
    expect(envelope.ops.map((operation) => operation.op)).toEqual(['create_node', 'set_node_layout']);

    const engine = new OperationEngine(source);
    expect(engine.apply(envelope)).toMatchObject({ ok: true });
    expect(engine.document.nodes[node.id]?.data.shape).toEqual({
      libraryId: 'simple-icons',
      entryId: 'simple.postgresql',
    });
    expect(engine.undo()).toMatchObject({ ok: true });
    expect(engine.document.nodes[node.id]).toBeUndefined();
  });

  it('applies a lazily loaded starter through one canonical OperationEngine transaction and undo', async () => {
    const templates = await loadStarterTemplates();
    const source = editableDocument();
    const { pageId, layerId } = targetPage(source);
    const beforeNodeIds = Object.values(source.nodes)
      .filter((node) => node.pageId === pageId)
      .map((node) => node.id)
      .sort();
    const transaction = templates.createStarterTemplateTransaction(
      source,
      templates.getStarterTemplate('flowchart'),
      {
        txId: 'tx.lazy.template',
        pageId,
        layerId,
        makeUid: deterministicUidFactory(),
      },
    );
    expect(transaction.envelope.ops.some((operation) => operation.op === 'create_node')).toBe(true);
    expect(transaction.envelope.ops.some((operation) => operation.op === 'create_edge')).toBe(true);

    const engine = new OperationEngine(source);
    expect(engine.apply(transaction.envelope)).toMatchObject({ ok: true });
    expect(Object.values(engine.document.nodes).filter((node) => node.pageId === pageId)).toHaveLength(8);
    expect(engine.undo()).toMatchObject({ ok: true });
    expect(Object.values(engine.document.nodes)
      .filter((node) => node.pageId === pageId)
      .map((node) => node.id)
      .sort()).toEqual(beforeNodeIds);
  });

  it('keeps D2 and Mermaid output identical through the lazy browser export module', async () => {
    const templates = await loadStarterTemplates();
    const source = editableDocument();
    const { pageId, layerId } = targetPage(source);
    const transaction = templates.createStarterTemplateTransaction(
      source,
      templates.getStarterTemplate('flowchart'),
      {
        txId: 'tx.lazy.export-fixture',
        pageId,
        layerId,
        makeUid: deterministicUidFactory(8000),
      },
    );
    const engine = new OperationEngine(source);
    expect(engine.apply(transaction.envelope)).toMatchObject({ ok: true });

    const browserExport = await loadBrowserTextExport();
    const lazyD2 = browserExport.createBrowserTextExport(engine.document, 'd2', pageId);
    const directD2 = exportDocumentToD2(engine.document, { pageId });
    expect(lazyD2.content).toBe(directD2.content);
    expect(lazyD2.losses).toEqual(directD2.losses);

    const lazyMermaid = browserExport.createBrowserTextExport(engine.document, 'mermaid', pageId);
    const directMermaid = exportDocumentToMermaid(engine.document, { pageId });
    expect(lazyMermaid.content).toBe(directMermaid.content);
    expect(lazyMermaid.losses).toEqual(directMermaid.losses);
  });
});

