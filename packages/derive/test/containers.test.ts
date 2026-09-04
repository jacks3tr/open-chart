import { describe, expect, it } from 'vitest';

import { validateDocument, type OpenChartDocument } from '@openchart/ir';

import {
  findInnermostContainer,
  reconcileContainers,
  type ContainerFrame,
} from '../src/index.js';

const uid = (value: number): string => value.toString().padStart(26, '0');

function containerDocument(): OpenChartDocument {
  const nodes = {
    'container.region': {
      id: 'container.region',
      uid: uid(10),
      kind: 'group',
      label: 'Production region',
      pageId: 'page.main',
      layerId: 'layer.main',
      styleId: 'style.default',
      container: { title: 'Production region', padding: 20 },
      data: {},
    },
    'container.subnet': {
      id: 'container.subnet',
      uid: uid(11),
      kind: 'group',
      label: 'Private subnet',
      pageId: 'page.main',
      layerId: 'layer.main',
      styleId: 'style.default',
      parentId: 'container.region',
      container: {
        title: 'Private subnet',
        padding: 12,
        assistedLayout: true,
        clip: true,
      },
      data: {},
    },
    'service.api': {
      id: 'service.api',
      uid: uid(12),
      kind: 'service',
      label: 'API',
      pageId: 'page.main',
      layerId: 'layer.main',
      styleId: 'style.default',
      parentId: 'container.subnet',
      data: {},
    },
    'service.worker': {
      id: 'service.worker',
      uid: uid(13),
      kind: 'service',
      label: 'Worker',
      pageId: 'page.main',
      layerId: 'layer.main',
      styleId: 'style.default',
      parentId: 'container.subnet',
      data: {},
    },
    'service.gateway': {
      id: 'service.gateway',
      uid: uid(14),
      kind: 'service',
      label: 'Gateway',
      pageId: 'page.main',
      layerId: 'layer.main',
      styleId: 'style.default',
      parentId: 'container.region',
      data: {},
    },
    'container.fixed': {
      id: 'container.fixed',
      uid: uid(15),
      kind: 'group',
      label: 'Fixed boundary',
      pageId: 'page.main',
      layerId: 'layer.main',
      styleId: 'style.default',
      container: { autoGrow: false, padding: 16 },
      data: {},
    },
    'service.fixed': {
      id: 'service.fixed',
      uid: uid(16),
      kind: 'service',
      label: 'Fixed child',
      pageId: 'page.main',
      layerId: 'layer.main',
      styleId: 'style.default',
      parentId: 'container.fixed',
      data: {},
    },
  };
  const result = validateDocument({
    schemaVersion: 1,
    documentId: 'document.containers',
    uid: uid(1),
    title: 'Container proof',
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
    layout: { overrides: {}, derived: null },
    meta: {
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    },
  });
  if (!result.ok) {
    throw new Error(JSON.stringify(result.diagnostics));
  }
  return result.document;
}

const previousFrames = {
  'container.region': { x: 0, y: 0, width: 260, height: 180 },
  'container.subnet': { x: 20, y: 60, width: 120, height: 90 },
  'service.api': { x: 30, y: 110, width: 70, height: 40 },
  'service.worker': { x: 80, y: 110, width: 70, height: 40 },
  'service.gateway': { x: 200, y: 120, width: 60, height: 30 },
  'container.fixed': { x: 400, y: 50, width: 200, height: 160 },
  'service.fixed': { x: 650, y: 300, width: 80, height: 40 },
} satisfies Record<string, ContainerFrame>;

const movedFrames = {
  ...previousFrames,
  'container.region': { x: 100, y: 50, width: 260, height: 180 },
} satisfies Record<string, ContainerFrame>;

describe('container derivation', () => {
  it('reconciles nested translation, first-open grid, clipping, auto-grow, fit, and containment', () => {
    const document = containerDocument();
    const result = reconcileContainers(document, movedFrames, {
      previousFrames,
      firstOpen: true,
    });

    expect(result.frames['container.region']).toEqual({
      x: 100,
      y: 50,
      width: 260,
      height: 180,
    });
    expect(result.frames['service.gateway']).toEqual({
      x: 300,
      y: 170,
      width: 60,
      height: 30,
    });
    expect(result.frames['container.subnet']).toEqual({
      x: 120,
      y: 110,
      width: 180,
      height: 100,
    });
    expect(result.frames['service.api']).toEqual({
      x: 132,
      y: 158,
      width: 70,
      height: 40,
    });
    expect(result.frames['service.worker']).toEqual({
      x: 218,
      y: 158,
      width: 70,
      height: 40,
    });
    expect(result.frames['service.fixed']).toEqual({
      x: 504,
      y: 154,
      width: 80,
      height: 40,
    });
    expect(result.containers['container.subnet']).toMatchObject({
      title: 'Private subnet',
      clip: true,
      magnetize: true,
      autoGrow: true,
      childIds: ['service.api', 'service.worker'],
      titleFrame: { x: 120, y: 110, width: 180, height: 36 },
      contentFrame: { x: 132, y: 158, width: 156, height: 40 },
    });
    expect(result.assistedLayoutApplied).toEqual(['container.subnet']);
    expect(
      findInnermostContainer(document, result.frames, { x: 140, y: 170 }),
    ).toBe('container.subnet');
    expect(
      findInnermostContainer(document, result.frames, { x: 350, y: 80 }),
    ).toBe('container.region');
    expect(
      findInnermostContainer(
        document,
        result.frames,
        { x: 140, y: 170 },
        'container.region',
      ),
    ).toBeUndefined();

    const fitted = reconcileContainers(document, movedFrames, {
      fitContainerIds: ['container.fixed'],
    });
    expect(fitted.frames['container.fixed']).toEqual({
      x: 634,
      y: 248,
      width: 112,
      height: 108,
    });
    expect(fitted.frames['service.fixed']).toEqual(previousFrames['service.fixed']);
  });
});
