import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { validateDocument } from '@openchart/ir';

import { buildSceneDescription, type SceneGroup, type SceneItem } from '../src/index.js';

const fixturePath = fileURLToPath(
  new URL('../../../examples/northstar-integration.openchart.json', import.meta.url),
);

function collectGroups(items: readonly SceneItem[]): readonly SceneGroup[] {
  const groups: SceneGroup[] = [];
  for (const item of items) {
    if (item.type !== 'group') {
      continue;
    }
    groups.push(item);
    groups.push(...collectGroups(item.children));
  }
  return groups;
}

function collectItems(items: readonly SceneItem[]): readonly SceneItem[] {
  return items.flatMap((item) =>
    item.type === 'group' ? [item, ...collectItems(item.children)] : [item],
  );
}

describe('buildSceneDescription', () => {
  it('does not assemble or normalize every obstacle for each fast preview edge', () => {
    const parsed = validateDocument(JSON.parse(readFileSync(fixturePath, 'utf8')));
    if (!parsed.ok) throw new Error('Invalid fixture');
    let reads = 0;
    const document = structuredClone(parsed.document);
    for (const node of Object.values(document.nodes)) {
      const container = node.container;
      Object.defineProperty(node, 'container', { get() { reads += 1; return container; } });
    }
    const edge = Object.values(document.edges)[0]!;
    document.edges = { [edge.id]: edge };
    buildSceneDescription(document, { routingStrategy: 'fast' });
    const baselineReads = reads;
    for (let index = 0; index < 80; index += 1) {
      const id = `edge.copy-${index}`;
      document.edges[id] = { ...edge, id, uid: String(index + 2000).padStart(26, '0') };
    }
    reads = 0;
    const scene = buildSceneDescription(document, { routingStrategy: 'fast' });
    expect(scene.connectors).toHaveLength(81);
    expect(reads).toBe(baselineReads);
  });

  it('resolves canonical IR into one deterministic, markup-free display list', () => {
    const input: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const validation = validateDocument(input);
    if (!validation.ok) {
      throw new Error(`Invalid visual fixture: ${JSON.stringify(validation.diagnostics)}`);
    }

    const scene = buildSceneDescription(validation.document);
    const groups = collectGroups(scene.items);
    const items = collectItems(scene.items);

    expect(scene).toEqual(buildSceneDescription(validation.document));
    expect(scene.version).toBe(1);
    expect(scene.bounds).toEqual({ x: 0, y: 0, width: 1440, height: 920 });
    expect(scene.title).toBe('Northstar order-to-production architecture');
    expect(groups.filter((group) => group.role === 'zone')).toHaveLength(3);
    expect(groups.filter((group) => group.role === 'node')).toHaveLength(6);
    expect(groups.filter((group) => group.role === 'edge')).toHaveLength(7);
    expect(items.find((item) => item.id === 'artboard-background')).toBeUndefined();
    expect(items.find((item) => item.id === 'artboard-dot-grid')).toBeUndefined();
    expect(scene.connectors).toHaveLength(7);
    expect(groups.find((group) => group.entityId === 'edge.ingress-audit')?.children).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'path' })]),
    );
    const notationDocument = structuredClone(validation.document);
    const notationEdge = notationDocument.edges['edge.ingress-audit'];
    if (notationEdge === undefined) {
      throw new Error('Expected connector fixture edge');
    }
    notationEdge.routing = {
      ...(notationEdge.routing ?? { mode: 'orthogonal' }),
      lineWidth: 4,
      lineStyle: 'dotted',
      startMarker: 'diamond',
      endMarker: 'crow-foot',
    };
    const notationGroup = collectGroups(buildSceneDescription(notationDocument).items).find(
      (group) => group.entityId === 'edge.ingress-audit',
    );
    expect(
      notationGroup?.children.find(
        (item) => item.type === 'path' && item.id.endsWith('-flow'),
      ),
    ).toMatchObject({
      strokeWidth: 4,
      dash: [2, 5],
      markerStart: { type: 'diamond' },
      markerEnd: { type: 'crow-foot' },
    });
    expect(JSON.stringify(scene)).not.toMatch(/<svg|<path|<text/);

    const accessibleDocument = structuredClone(validation.document);
    accessibleDocument.nodes['service.ingress']!.data = {
      ...accessibleDocument.nodes['service.ingress']!.data,
      altText: 'Public API gateway with contract validation and rate controls',
    };
    expect(
      collectGroups(buildSceneDescription(accessibleDocument).items).find(
        (group) => group.entityId === 'service.ingress',
      )?.ariaLabel,
    ).toBe('Public API gateway with contract validation and rate controls');

    const shapeDocument = structuredClone(validation.document);
    shapeDocument.nodes['shape.decision'] = {
      id: 'shape.decision',
      uid: 'D'.repeat(26),
      kind: 'control',
      label: 'Decision',
      pageId: 'page.architecture',
      layerId: 'layer.systems',
      styleId: 'style.operations',
      data: {
        shape: { libraryId: 'flowchart', entryId: 'flowchart.decision' },
      },
    };
    shapeDocument.layout.overrides['shape.decision'] = {
      x: 600,
      y: 600,
      width: 160,
      height: 120,
      pinned: true,
    };
    const shapeScene = buildSceneDescription(shapeDocument);
    expect(
      collectGroups(shapeScene.items).find((group) => group.entityId === 'shape.decision'),
    ).toMatchObject({ role: 'node', ariaLabel: 'Decision' });
    expect(
      collectItems(shapeScene.items).find(
        (item) => item.id === 'shape-shape.decision-geometry-body',
      ),
    ).toMatchObject({
      type: 'polygon',
      points: [
        { x: 680, y: 600 },
        { x: 760, y: 660 },
        { x: 680, y: 720 },
        { x: 600, y: 660 },
      ],
    });

    const customPaintDocument = structuredClone(shapeDocument);
    customPaintDocument.nodes['shape.decision']!.data = {
      ...customPaintDocument.nodes['shape.decision']!.data,
      fillColor: '#FFF7ED',
      borderColor: '#C2410C',
    };
    expect(
      collectItems(buildSceneDescription(customPaintDocument).items).find(
        (item) => item.id === 'shape-shape.decision-geometry-body',
      ),
    ).toMatchObject({ fill: '#FFF7ED', stroke: '#C2410C' });

    const rotatedDocument = structuredClone(validation.document);
    rotatedDocument.layout.overrides['service.ingress'] = {
      ...rotatedDocument.layout.overrides['service.ingress'],
      rotation: 15,
    };
    const rotatedGroups = collectGroups(buildSceneDescription(rotatedDocument).items);
    expect(rotatedGroups.find((group) => group.entityId === 'service.ingress')?.transform).toEqual({
      rotation: 15,
      origin: { x: 706, y: 273 },
    });

    rotatedDocument.nodes['group.processing'] = {
      id: 'group.processing',
      uid: 'ZZZZZZZZZZZZZZZZZZZZZZZZZZ',
      kind: 'group',
      label: 'Processing group',
      pageId: 'page.architecture',
      layerId: 'layer.systems',
      styleId: 'style.fabric',
      group: {},
      data: {},
    };
    rotatedDocument.nodes['service.ingress'] = {
      ...rotatedDocument.nodes['service.ingress']!,
      parentId: 'group.processing',
    };
    rotatedDocument.nodes['service.transform'] = {
      ...rotatedDocument.nodes['service.transform']!,
      parentId: 'group.processing',
    };
    rotatedDocument.layout.overrides['group.processing'] = {
      x: 536,
      y: 176,
      width: 340,
      height: 400,
      pinned: true,
    };
    const groupedScene = buildSceneDescription(rotatedDocument);
    const grouped = collectGroups(groupedScene.items).find(
      (group) => group.entityId === 'group.processing',
    );
    expect(grouped?.role).toBe('group');
    expect(
      collectGroups(grouped?.children ?? [])
        .filter((group) => group.role === 'node')
        .map((group) => group.entityId),
    ).toEqual(['service.ingress', 'service.transform']);

    const orderedDocument = structuredClone(validation.document);
    orderedDocument.pages['page.architecture']!.order = 1;
    orderedDocument.pages['page.priority'] = {
      id: 'page.priority',
      uid: 'YYYYYYYYYYYYYYYYYYYYYYYYYY',
      name: 'Priority page',
      order: 0,
      layerIds: ['layer.priority'],
    };
    orderedDocument.layers['layer.priority'] = {
      id: 'layer.priority',
      uid: 'XXXXXXXXXXXXXXXXXXXXXXXXXX',
      name: 'Base',
      pageId: 'page.priority',
      visible: true,
      locked: false,
    };
    expect(buildSceneDescription(orderedDocument).description).toContain('Priority page');

    const zOrderedDocument = structuredClone(validation.document);
    zOrderedDocument.layout.overrides['system.northstar'] = {
      ...zOrderedDocument.layout.overrides['system.northstar'],
      zIndex: 0,
    };
    zOrderedDocument.layout.overrides['service.ingress'] = {
      ...zOrderedDocument.layout.overrides['service.ingress'],
      zIndex: 10,
    };
    const zOrderedNodeIds = collectGroups(buildSceneDescription(zOrderedDocument).items)
      .filter((group) => group.role === 'node')
      .map((group) => group.entityId);
    expect(zOrderedNodeIds.indexOf('system.northstar')).toBeLessThan(
      zOrderedNodeIds.indexOf('service.ingress'),
    );

    const styledTextDocument = structuredClone(validation.document);
    styledTextDocument.nodes['service.ingress']!.data = {
      ...styledTextDocument.nodes['service.ingress']!.data,
      fontSize: 23,
      fontWeight: 400,
      fontStyle: 'italic',
      fontFamily: 'Georgia, serif',
      textAlign: 'center',
      textColor: '#7C3AED',
      underline: true,
      link: 'https://example.invalid/service',
    };
    const styledTitle = collectItems(buildSceneDescription(styledTextDocument).items).find(
      (item) => item.id === 'node-service.ingress-title',
    );
    expect(styledTitle).toMatchObject({
      type: 'text',
      fontSize: 23,
      fontWeight: 400,
      fontStyle: 'italic',
      fontFamily: 'Georgia, serif',
      anchor: 'middle',
      fill: '#7C3AED',
      underline: true,
    });
    if (styledTitle?.type !== 'text') {
      throw new Error('Expected styled node title');
    }
    expect(Number.isFinite(styledTitle.at.x)).toBe(true);
    expect(Number.isFinite(styledTitle.at.y)).toBe(true);

    const rightAlignedDocument = structuredClone(validation.document);
    rightAlignedDocument.nodes['service.ingress']!.data = {
      ...rightAlignedDocument.nodes['service.ingress']!.data,
      textAlign: 'right',
    };
    const rightAlignedTitle = collectItems(buildSceneDescription(rightAlignedDocument).items).find(
      (item) => item.id === 'node-service.ingress-title',
    );
    expect(rightAlignedTitle).toMatchObject({
      type: 'text',
      anchor: 'end',
    });

    const longTitleDocument = structuredClone(validation.document);
    longTitleDocument.nodes['system.northstar']!.label = 'Northstar ERP integration control plane';
    const longTitleItems = collectItems(buildSceneDescription(longTitleDocument).items);
    expect(longTitleItems.find((item) => item.id === 'node-system.northstar-title')).toMatchObject({
      type: 'text',
      value: 'Northstar ERP integration',
    });
    expect(longTitleItems.find((item) => item.id === 'node-system.northstar-title-2')).toMatchObject({
      type: 'text',
      value: 'control plane',
    });
    expect(longTitleItems.find((item) => item.id === 'node-system.northstar-subtitle')).toMatchObject({
      type: 'text',
      at: { y: 363 },
    });

    const overflowDocument = structuredClone(validation.document);
    overflowDocument.layout.overrides['system.northstar'] = {
      ...overflowDocument.layout.overrides['system.northstar'],
      x: 2_000,
      y: 1_200,
    };
    expect(buildSceneDescription(overflowDocument).bounds).toEqual({
      x: 0,
      y: 0,
      width: 2_382,
      height: 1_578,
    });

    const connectorDocument = structuredClone(validation.document);
    connectorDocument.ports['system.northstar.master-out']!.order = 10;
    connectorDocument.ports['system.northstar.transactions-in']!.order = 0;
    connectorDocument.edges['edge.master-ingress']!.routing = {
      mode: 'curved',
      avoidObstacles: false,
      jumpStyle: 'arc',
    };
    connectorDocument.layout.edgeOverrides = {
      'edge.master-ingress': {
        waypoints: [{ x: 500, y: 320 }],
        labelT: 0.25,
        labelPlacement: 'above',
        labelOffset: 8,
      },
    };
    const connectorItems = collectItems(buildSceneDescription(connectorDocument).items);
    const curvedFlow = connectorItems.find(
      (item) => item.id === 'edge-edge.master-ingress-flow',
    );
    expect(curvedFlow).toMatchObject({ type: 'path' });
    if (curvedFlow?.type !== 'path') {
      throw new Error('Expected curved connector path');
    }
    expect(curvedFlow.commands.some((command) => command.type === 'cubic')).toBe(true);
    expect(
      curvedFlow.commands.some(
        (command) => command.type === 'cubic' && command.to.x === 500 && command.to.y === 320,
      ),
    ).toBe(true);

    const transactionFlow = connectorItems.find(
      (item) => item.id === 'edge-edge.transactions-source-flow',
    );
    if (transactionFlow?.type !== 'path') {
      throw new Error('Expected transaction connector path');
    }
    const curvedStart = curvedFlow.commands[0];
    const transactionEnd = transactionFlow.commands.at(-1);
    expect(curvedStart?.type).toBe('move');
    expect(transactionEnd?.type).toBe('line');
    if (curvedStart?.type === 'move' && transactionEnd?.type === 'line') {
      expect(curvedStart.to.y).toBeGreaterThan(transactionEnd.to.y);
    }
  });

  it('uses derived frames while preserving explicit override fields', () => {
    const input: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const validation = validateDocument(input);
    if (!validation.ok) {
      throw new Error(`Invalid visual fixture: ${JSON.stringify(validation.diagnostics)}`);
    }
    const document = structuredClone(validation.document);
    document.layout.derived = {
      'system.northstar': { x: 900, y: 120, width: 240, height: 128 },
    };
    document.layout.overrides['system.northstar'] = { x: 104, pinned: true };

    const card = collectItems(buildSceneDescription(document).items).find(
      (item) => item.id === 'node-system.northstar-card',
    );
    expect(card).toMatchObject({
      type: 'rect',
      frame: { x: 104, y: 120, width: 240, height: 128 },
    });
  });

  it('renders a blank page without document chrome', () => {
    const input: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const validation = validateDocument(input);
    if (!validation.ok) {
      throw new Error(`Invalid visual fixture: ${JSON.stringify(validation.diagnostics)}`);
    }
    const document = structuredClone(validation.document);
    document.nodes = {};
    document.ports = {};
    document.edges = {};

    const items = collectItems(buildSceneDescription(document).items);
    expect(items.find((item) => item.id === 'artboard-header')).toBeUndefined();
    expect(items.find((item) => item.id === 'flow-legend')).toBeUndefined();
  });

  it('projects document theme tokens through the shared scene', () => {
    const input: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const validation = validateDocument(input);
    if (!validation.ok) {
      throw new Error(`Invalid visual fixture: ${JSON.stringify(validation.diagnostics)}`);
    }
    const document = structuredClone(validation.document);
    document.theme = {
      presetId: 'openchart-dark',
      tokens: {
        canvas: '#0B0F17', surface: '#131A25', surfaceAlt: '#182231',
        stroke: '#243040', textHi: '#E6EDF6', textMid: '#B7C3D4', textLo: '#8290A3',
        typeFloor: 10,
      },
    };

    const items = collectItems(buildSceneDescription(document).items);
    expect(items.find((item) => item.id === 'artboard-background')).toMatchObject({
      type: 'rect', fill: '#0B0F17',
    });
    expect(items.find((item) => item.id === 'header-title')).toMatchObject({
      type: 'text', fill: '#E6EDF6',
    });
    expect(items.filter((item) => item.type === 'text').every((item) => item.fontSize >= 10)).toBe(true);
  });

  it('preserves library shape dash when no border override is set', () => {
    const input: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const validation = validateDocument(input);
    if (!validation.ok) {
      throw new Error(`Invalid visual fixture: ${JSON.stringify(validation.diagnostics)}`);
    }
    const document = structuredClone(validation.document);
    const pageId = Object.keys(document.pages)[0] as string;
    const layerId = document.pages[pageId]?.layerIds[0] as string;
    const styleId = Object.keys(document.styles)[0] as string;
    document.nodes['test.dashed'] = {
      id: 'test.dashed',
      uid: '0'.repeat(25) + '1',
      kind: 'node',
      label: 'Ext',
      pageId,
      layerId,
      styleId,
      data: { shape: { libraryId: 'generic', entryId: 'generic.external-system' } },
    };
    document.layout.overrides['test.dashed'] = { x: 10, y: 10, width: 200, height: 120 };
    const body = collectItems(buildSceneDescription(document, { pageId }).items).find(
      (item) => item.id === 'shape-test.dashed-geometry-body',
    );
    expect(body).toMatchObject({ type: 'rect', dash: [6, 3] });
  });

  it('renders floating connector anchors as a single centered endpoint dot', () => {
    const input: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const validation = validateDocument(input);
    if (!validation.ok) {
      throw new Error(`Invalid visual fixture: ${JSON.stringify(validation.diagnostics)}`);
    }
    const document = structuredClone(validation.document);
    const pageId = Object.keys(document.pages)[0] as string;
    const layerId = document.pages[pageId]?.layerIds[0] as string;
    const styleId = Object.keys(document.styles)[0] as string;
    document.nodes['test.anchor'] = {
      id: 'test.anchor',
      uid: '1'.repeat(26),
      kind: 'connector-anchor',
      label: '',
      pageId,
      layerId,
      styleId,
      data: { connectorAnchor: true },
    };
    document.layout.overrides['test.anchor'] = { x: 500, y: 300, width: 0.01, height: 0.01 };
    const group = collectItems(buildSceneDescription(document, { pageId }).items).find(
      (item) => item.type === 'group' && item.entityId === 'test.anchor',
    );
    expect(group).toMatchObject({ type: 'group', role: 'node', entityId: 'test.anchor' });
    if (group?.type !== 'group') {
      throw new Error('Expected an anchor node group');
    }
    expect(group.children).toHaveLength(1);
    expect(group.children[0]).toMatchObject({
      type: 'circle',
      center: { x: 500.005, y: 300.005 },
      radius: 4,
    });
  });
});
