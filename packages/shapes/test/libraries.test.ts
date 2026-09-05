import { describe, expect, it } from 'vitest';

import {
  evaluateShapeDefinition,
  validateShapeDefinition,
} from '../src/index.js';
import {
  getShapeLibraryEntry,
  listShapeLibraries,
  resolveLibraryShape,
  searchShapeLibraries,
  validateShapeLibraries,
} from '../src/libraries-index.js';

describe('shipped shape libraries', () => {
  it('validate, retain license metadata, and resolve a representative 1,000-shape corpus', () => {
    const libraries = listShapeLibraries();
    expect(libraries.map((library) => library.id)).toEqual([
      'basic',
      'generic',
      'flowchart',
      'bpmn',
      'uml',
      'erd',
      'integration',
      'network',
      'architecture',
      'orgchart',
      'mindmap',
      'aws',
      'azure',
      'gcp',
      'simple-icons',
      'phosphor',
    ]);
    expect(libraries.map((library) => library.entries.length)).toEqual([
      26, 10, 36, 42, 42, 22, 20, 31, 38, 6, 6, 50, 50, 50, 3_457, 1_512,
    ]);
    expect(libraries.slice(0, 14).reduce((total, library) => total + library.entries.length, 0)).toBe(429);
    expect(validateShapeLibraries()).toEqual([]);

    const postgresql = getShapeLibraryEntry('simple-icons', 'simple.postgresql');
    expect(postgresql?.provenance).toMatchObject({
      sourceUrl: 'https://wiki.postgresql.org/wiki/Logo',
      packageVersion: '16.29.0',
      packageLicense: 'CC0-1.0',
      guidelinesUrl: 'https://www.postgresql.org/about/policies/trademarks/',
      trademark: true,
    });
    expect(searchShapeLibraries('postgres', { limit: 1 })[0]?.entry.id).toBe(
      'simple.postgresql',
    );
    expect(
      getShapeLibraryEntry('simple-icons', 'simple.apachekafka')?.provenance
        .iconLicense,
    ).toEqual({ name: 'Apache-2.0' });

    const phosphorDatabase = getShapeLibraryEntry(
      'phosphor',
      'phosphor.database',
    );
    expect(phosphorDatabase?.kind).toBe('vector');
    if (phosphorDatabase?.kind !== 'vector') {
      throw new Error('Expected the Phosphor database vector entry');
    }
    expect(Object.keys(phosphorDatabase.variants)).toEqual([
      'thin',
      'light',
      'regular',
      'bold',
      'fill',
      'duotone',
    ]);
    const duotone = resolveLibraryShape('phosphor', 'phosphor.database', {
      variant: 'duotone',
      color: '#2563EB',
    });
    expect(duotone.ok).toBe(true);
    if (!duotone.ok) {
      throw new Error(JSON.stringify(duotone.diagnostics));
    }
    const duotoneGeometry = duotone.definition.geometry ?? [];
    expect(duotoneGeometry).toHaveLength(2);
    expect(duotoneGeometry[0]).toMatchObject({ fillOpacity: 0.2 });

    const entries = libraries.flatMap((library) =>
      library.entries.map((entry) => ({ libraryId: library.id, entry })),
    );
    const sampledLibraryIds = new Set<string>();
    for (let index = 0; index < 1_000; index += 1) {
      const candidate = entries[Math.floor((index * entries.length) / 1_000)];
      if (candidate === undefined) {
        throw new Error(`Missing sampled catalog entry ${index}`);
      }
      sampledLibraryIds.add(candidate.libraryId);
      const resolved = resolveLibraryShape(candidate.libraryId, candidate.entry.id);
      if (!resolved.ok) {
        throw new Error(
          `${candidate.entry.id}: ${JSON.stringify(resolved.diagnostics)}`,
        );
      }
      const validation = validateShapeDefinition(resolved.definition);
      if (!validation.ok) {
        throw new Error(
          `${candidate.entry.id}: ${JSON.stringify(validation.diagnostics)}`,
        );
      }
      const evaluated = evaluateShapeDefinition(resolved.definition, {
        frame: {
          x: index * 2,
          y: index,
          width: resolved.definition.defaultSize.width,
          height: resolved.definition.defaultSize.height,
        },
      });
      if (!evaluated.ok) {
        throw new Error(
          `${candidate.entry.id}: ${JSON.stringify(evaluated.diagnostics)}`,
        );
      }
      expect(evaluated.shape.geometry.length).toBeGreaterThan(0);
    }
    expect([...sampledLibraryIds]).toEqual([
      'basic',
      'generic',
      'flowchart',
      'bpmn',
      'uml',
      'erd',
      'integration',
      'network',
      'architecture',
      'orgchart',
      'mindmap',
      'aws',
      'azure',
      'gcp',
      'simple-icons',
      'phosphor',
    ]);
  });

  it('ships professional diagram families as editable declarative definitions', () => {
    const representatives = [
      ['basic', 'basic.note', 'path'],
      ['basic', 'basic.right-arrow', 'polygon'],
      ['basic', 'basic.callout', 'path'],
      ['basic', 'basic.chevron', 'polygon'],
      ['flowchart', 'flowchart.decision', 'polygon'],
      ['flowchart', 'flowchart.predefined-process', 'rect'],
      ['flowchart', 'flowchart.parallel-mode', 'polygon'],
      ['bpmn', 'bpmn.start-event', 'ellipse'],
      ['bpmn', 'bpmn.exclusive-gateway', 'polygon'],
      ['bpmn', 'bpmn.lane', 'rect'],
      ['bpmn', 'bpmn.message', 'rect'],
      ['uml', 'uml.class', 'rect'],
      ['uml', 'uml.component-node', 'rect'],
      ['uml', 'uml.deployment-node-3d', 'polygon'],
      ['uml', 'uml.choice', 'polygon'],
      ['uml', 'uml.lifeline', 'path'],
      ['erd', 'erd.entity', 'rect'],
      ['erd', 'erd.composite-attribute', 'ellipse'],
      ['erd', 'erd.one-many', 'polygon'],
      ['network', 'network.vpc', 'rect'],
      ['network', 'network.rack', 'rect'],
      ['architecture', 'architecture.region', 'rect'],
      ['architecture', 'architecture.trust-boundary', 'rect'],
      ['aws', 'aws.sqs', 'rect'],
      ['aws', 'aws.eks', 'rect'],
      ['azure', 'azure.load-balancer', 'rect'],
      ['azure', 'azure.aks', 'rect'],
      ['gcp', 'gcp.vpc', 'rect'],
      ['gcp', 'gcp.gke', 'rect'],
      ['orgchart', 'orgchart.executive', 'ellipse'],
      ['mindmap', 'mindmap.central-topic', 'ellipse'],
    ] as const;

    for (const [libraryId, entryId, geometryType] of representatives) {
      const resolved = resolveLibraryShape(libraryId, entryId);
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) continue;
      expect(resolved.definition.geometry?.some((geometry) => geometry.type === geometryType)).toBe(true);
      expect(resolved.definition.properties?.some((property) => property.name === 'Label')).toBe(true);
      expect(resolved.definition.ports).toHaveLength(4);
    }
  });

  it('covers the professional flowchart symbols and searchable cloud-provider service families', () => {
    const flowchartIds = new Set(
      listShapeLibraries().find((library) => library.id === 'flowchart')?.entries.map((entry) => entry.id),
    );
    for (const id of [
      'flowchart.terminator',
      'flowchart.process',
      'flowchart.decision',
      'flowchart.document',
      'flowchart.multiple-documents',
      'flowchart.data',
      'flowchart.manual-input',
      'flowchart.manual-operation',
      'flowchart.predefined-process',
      'flowchart.stored-data',
      'flowchart.internal-storage',
      'flowchart.sequential-data',
      'flowchart.direct-data',
      'flowchart.display',
      'flowchart.database',
      'flowchart.delay',
      'flowchart.merge',
      'flowchart.or',
      'flowchart.summing-junction',
      'flowchart.off-page-connector',
      'flowchart.on-page-connector',
    ]) {
      expect(flowchartIds.has(id), id).toBe(true);
    }

    expect(searchShapeLibraries('sqs queue', { limit: 5 }).some((result) => result.entry.id === 'aws.sqs')).toBe(true);
    expect(searchShapeLibraries('azure blob', { limit: 5 }).some((result) => result.entry.id === 'azure.blob-storage')).toBe(true);
    expect(searchShapeLibraries('google cloud pubsub', { limit: 5 }).some((result) => result.entry.id === 'gcp.pub-sub')).toBe(true);
    expect(searchShapeLibraries('aws kubernetes', { limit: 5 }).some((result) => result.entry.id === 'aws.eks')).toBe(true);
    expect(searchShapeLibraries('azure redis cache', { limit: 5 }).some((result) => result.entry.id === 'azure.redis-cache')).toBe(true);
    expect(searchShapeLibraries('gcp cloud run', { limit: 5 }).some((result) => result.entry.id === 'gcp.cloud-run')).toBe(true);
  });

  it('returns a structured failure for unsupported vector colors', () => {
    expect(
      resolveLibraryShape('simple-icons', 'simple.postgresql', {
        color: '#12345',
      }),
    ).toEqual({
      ok: false,
      diagnostics: [
        {
          code: 'COLOR_INVALID',
          path: 'options.color',
          message: 'Color "#12345" is not a supported solid color',
        },
      ],
    });
  });

  it('keeps technical glyph labels below their geometry', () => {
    for (const [libraryId, entryId] of [
      ['integration', 'integration.queue'],
      ['network', 'network.router'],
    ] as const) {
      const resolved = resolveLibraryShape(libraryId, entryId);
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) {
        continue;
      }
      const evaluated = evaluateShapeDefinition(resolved.definition);
      expect(evaluated.ok).toBe(true);
      if (!evaluated.ok) {
        continue;
      }
      const body = evaluated.shape.geometry.find((geometry) => geometry.id === 'body');
      const label = evaluated.shape.textAreas.find((textArea) => textArea.id === 'label');
      expect(body !== undefined && 'frame' in body).toBe(true);
      if (body === undefined || !('frame' in body) || label === undefined) {
        continue;
      }
      expect(label.frame.y).toBeGreaterThan(body.frame.y + body.frame.height);
    }
  });
});
