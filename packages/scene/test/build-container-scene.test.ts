import { describe, expect, it } from 'vitest';

import { validateDocument } from '@openchart/ir';

import {
  buildSceneDescription,
  type SceneGroup,
  type SceneItem,
} from '../src/index.js';

const uid = (value: number): string => value.toString().padStart(26, '0');

function collectGroups(items: readonly SceneItem[]): readonly SceneGroup[] {
  const groups: SceneGroup[] = [];
  for (const item of items) {
    if (item.type === 'group') {
      groups.push(item, ...collectGroups(item.children));
    }
  }
  return groups;
}

describe('container scenes', () => {
  it.each([false, true])('renders editable container chrome and nested content (swimlane: %s)', (swimlane) => {
    const validation = validateDocument({
      schemaVersion: 1,
      documentId: 'document.container-scene',
      uid: uid(1),
      title: 'Container scene',
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
      nodes: {
        'container.region': {
          id: 'container.region',
          uid: uid(10),
          kind: 'group',
          label: 'Production region',
          pageId: 'page.main',
          layerId: 'layer.main',
          styleId: 'style.default',
          container: { clip: true },
          data: swimlane ? {
            shape: { libraryId: 'architecture', entryId: 'architecture.swimlane' },
            fillColor: 'none', borderColor: '#CBD5E1', borderWidth: 1,
            textColor: '#53657A', fontSize: 16, fontWeight: 500, textAlign: 'center',
          } : {},
        },
        'service.api': {
          id: 'service.api',
          uid: uid(11),
          kind: 'service',
          label: 'API',
          pageId: 'page.main',
          layerId: 'layer.main',
          styleId: 'style.default',
          parentId: 'container.region',
          data: {},
        },
      },
      ports: {},
      edges: {},
      styles: {
        'style.default': {
          id: 'style.default',
          uid: uid(4),
          role: 'service/compute',
          tokens: {},
        },
      },
      layout: {
        overrides: {
          'container.region': { x: 100, y: 160, width: 400, height: 300 },
          'service.api': { x: 150, y: 240, width: 200, height: 100 },
        },
        derived: null,
      },
      meta: {
        createdAt: '2026-08-30T00:00:00.000Z',
        updatedAt: '2026-08-30T00:00:00.000Z',
      },
    });
    if (!validation.ok) {
      throw new Error(JSON.stringify(validation.diagnostics));
    }

    const scene = buildSceneDescription(validation.document, {
      width: 800,
      height: 600,
    });
    const groups = collectGroups(scene.items);
    const container = groups.find(
      (group) => group.role === 'container' && group.entityId === 'container.region',
    );
    expect(container).toMatchObject({
      type: 'group',
      role: 'container',
      ariaLabel: 'Production region',
    });
    if (container === undefined) {
      throw new Error('Expected a rendered container group');
    }
    const surface = container.children.find(
      (item) => item.type === 'rect' && item.id.endsWith('-surface'),
    );
    const title = container.children.find(
      (item) => item.type === 'text' && item.id.endsWith('-title'),
    );
    const content = container.children.find(
      (item) => item.type === 'group' && item.id.endsWith('-content'),
    );
    expect(surface).toMatchObject({
      type: 'rect',
      frame: { x: 100, y: 160, width: 400, height: 300 },
      ...(swimlane ? { fill: 'none' } : { radius: 12 }),
    });
    expect(title).toMatchObject({
      type: 'text',
      value: swimlane ? 'Production region' : 'PRODUCTION REGION',
      fontSize: swimlane ? 16 : 13,
    });
    if (swimlane) {
      expect(title).toMatchObject({ fill: '#53657A', fontWeight: 500, anchor: 'middle', at: { x: 300, y: 183 } });
      expect(container.children.find((item) => item.id.endsWith('-header-rule'))).toMatchObject({
        type: 'path', stroke: '#CBD5E1', strokeWidth: 1,
        commands: [{ type: 'move', to: { x: 100, y: 196 } }, { type: 'line', to: { x: 500, y: 196 } }],
      });
      const renamed = structuredClone(validation.document);
      renamed.nodes['container.region']!.label = 'Renamed lane';
      const renamedScene = buildSceneDescription(renamed, { width: 800, height: 600 });
      expect(collectGroups(renamedScene.items).find((group) => group.entityId === 'container.region')?.children)
        .toContainEqual(expect.objectContaining({ type: 'text', value: 'Renamed lane' }));
    }
    expect(content).toMatchObject({
      type: 'group',
      clip: {
        items: [
          expect.objectContaining({
            type: 'rect',
            frame: { x: 132, y: 228, width: 336, height: 200 },
          }),
        ],
      },
    });
    expect(groups.filter((group) => group.role === 'container')).toHaveLength(1);
    expect(groups.filter((group) => group.role === 'node')).toHaveLength(1);
    expect(groups.find((group) => group.role === 'node')?.entityId).toBe('service.api');
  });
});
