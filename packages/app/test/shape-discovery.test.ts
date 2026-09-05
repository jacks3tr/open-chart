import { describe, expect, it } from 'vitest';
import northstarInput from '../../../examples/northstar-integration.openchart.json';
import { validateDocument, type Node, type OpenChartDocument } from '@openchart/ir';
import { OperationEngine } from '@openchart/ops';
import { evaluateShapeDefinition } from '@openchart/shapes';
import {
  listShapeLibraries,
  resolveLibraryShape,
  searchShapeLibraries,
} from '@openchart/shapes/libraries';

import {
  createShapeInsertionTransaction,
  parseEditorPreferences,
  recordRecentCatalogShape,
  serializeEditorPreferences,
  toggleFavoriteCatalogShape,
  type CatalogShapeRef,
  type EditorPreferences,
} from '../src/openchart-editor.js';

function editableDocument(): OpenChartDocument {
  const result = validateDocument(northstarInput);
  if (!result.ok) {
    throw new Error(`Invalid app fixture: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.document;
}

function insertionNode(
  document: OpenChartDocument,
  ref: CatalogShapeRef,
  id = 'node.catalog-test',
): Node {
  const page = Object.values(document.pages)[0];
  const layerId = page?.layerIds[0];
  const styleId = Object.keys(document.styles)[0];
  if (page === undefined || layerId === undefined || styleId === undefined) {
    throw new Error('Expected the app fixture to contain a page, layer, and style');
  }
  return {
    id,
    uid: '7'.repeat(26),
    kind: 'service',
    label: ref.entryId,
    pageId: page.id,
    layerId,
    styleId,
    data: { shape: { libraryId: ref.libraryId, entryId: ref.entryId } },
  };
}

describe('shape discovery and insertion', () => {
  it('uses the canonical insertion transaction and OperationEngine undo', () => {
    const source = editableDocument();
    const node = insertionNode(source, { libraryId: 'aws', entryId: 'aws.ec2' });
    const frame = { x: 320, y: 240, width: 180, height: 112 };
    const envelope = createShapeInsertionTransaction(source, {
      txId: 'tx.shape-insert',
      node,
      frame,
    });

    expect(envelope.ops).toEqual([
      { op: 'create_node', node },
      { op: 'set_node_layout', id: node.id, layout: { ...frame, pinned: true } },
    ]);

    const engine = new OperationEngine(source);
    expect(engine.apply(envelope)).toMatchObject({ ok: true });
    expect(engine.document.nodes[node.id]?.data.shape).toEqual({
      libraryId: 'aws',
      entryId: 'aws.ec2',
    });
    expect(engine.document.layout.overrides[node.id]).toMatchObject({ ...frame, pinned: true });
    expect(engine.undo()).toMatchObject({ ok: true });
    expect(engine.document.nodes[node.id]).toBeUndefined();
    expect(engine.document.layout.overrides[node.id]).toBeUndefined();
  });

  it('tracks recent shapes in bounded MRU order with deduplication', () => {
    const aws = listShapeLibraries().find((library) => library.id === 'aws');
    expect(aws).toBeDefined();
    if (aws === undefined) return;
    const refs = aws.entries.map((entry) => ({ libraryId: aws.id, entryId: entry.id }));
    let recent: readonly CatalogShapeRef[] = [];
    for (const ref of refs) {
      recent = recordRecentCatalogShape(recent, ref);
    }
    expect(recent).toHaveLength(12);
    expect(recent[0]).toEqual(refs.at(-1));
    const repeated = refs[5];
    expect(repeated).toBeDefined();
    if (repeated === undefined) return;
    recent = recordRecentCatalogShape(recent, repeated);
    expect(recent[0]).toEqual(repeated);
    expect(recent.filter((candidate) => candidate.entryId === repeated.entryId)).toHaveLength(1);
  });

  it('persists favorite toggles through the editor preference storage format', () => {
    const favorite = { libraryId: 'gcp', entryId: 'gcp.pub-sub' } as const;
    const base: EditorPreferences = {
      exportFormat: 'png',
      exportScale: 2,
      canvasNavigation: false,
      recentShapes: [],
      favoriteShapes: [],
    };
    const favoriteShapes = toggleFavoriteCatalogShape(base.favoriteShapes, favorite);
    const restored = parseEditorPreferences(serializeEditorPreferences({ ...base, favoriteShapes }));
    expect(restored.favoriteShapes).toEqual([favorite]);
    expect(toggleFavoriteCatalogShape(restored.favoriteShapes, favorite)).toEqual([]);
  });

  it('filters multi-term searches across diagram shapes and decorative icons', () => {
    expect(
      searchShapeLibraries('sqs queue', { limit: 10 }).some(
        (result) => result.libraryId === 'aws' && result.entry.id === 'aws.sqs',
      ),
    ).toBe(true);
    expect(
      searchShapeLibraries('phosphor database', { limit: 10 }).some(
        (result) => result.libraryId === 'phosphor' && result.entry.id === 'phosphor.database',
      ),
    ).toBe(true);
    expect(
      searchShapeLibraries('simple postgres', { limit: 10 }).some(
        (result) => result.libraryId === 'simple-icons' && result.entry.id === 'simple.postgresql',
      ),
    ).toBe(true);
  });

  it('ships broad native cloud families with current service search coverage', () => {
    for (const libraryId of ['aws', 'azure', 'gcp'] as const) {
      const library = listShapeLibraries().find((candidate) => candidate.id === libraryId);
      expect(library?.entries).toHaveLength(50);
    }
    for (const [query, libraryId, entryId] of [
      ['bedrock generative ai', 'aws', 'aws.bedrock'],
      ['foundry generative ai', 'azure', 'azure.ai-foundry'],
      ['vertex ai generative', 'gcp', 'gcp.vertex-ai'],
      ['cloud armor waf', 'gcp', 'gcp.cloud-armor'],
      ['entra identity', 'azure', 'azure.entra-id'],
      ['eventbridge event bus', 'aws', 'aws.eventbridge'],
    ] as const) {
      expect(searchShapeLibraries(query, { limit: 20 }).some(
        (result) => result.libraryId === libraryId && result.entry.id === entryId,
      ), `${libraryId}:${entryId}`).toBe(true);
    }
  });

  it('resolves professional cloud, UML, and ERD entries with real geometry and ports', () => {
    for (const [libraryId, entryId] of [
      ['architecture', 'architecture.api-gateway'],
      ['aws', 'aws.ec2'],
      ['azure', 'azure.functions'],
      ['gcp', 'gcp.pub-sub'],
      ['uml', 'uml.class'],
      ['uml', 'uml.interface'],
      ['uml', 'uml.package'],
      ['uml', 'uml.comment'],
      ['erd', 'erd.entity'],
      ['erd', 'erd.relationship'],
    ] as const) {
      const resolved = resolveLibraryShape(libraryId, entryId);
      expect(resolved.ok, `${libraryId}:${entryId}`).toBe(true);
      if (!resolved.ok) continue;
      expect(resolved.definition.ports).toHaveLength(4);
      const evaluated = evaluateShapeDefinition(resolved.definition);
      expect(evaluated.ok, `${libraryId}:${entryId}`).toBe(true);
      if (evaluated.ok) {
        expect(evaluated.shape.geometry.length).toBeGreaterThan(0);
      }
    }
  });
});
