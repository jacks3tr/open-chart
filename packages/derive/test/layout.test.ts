import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { validateDocument, type LayoutFrame } from '@openchart/ir';

import { layoutDocument, type LayoutMode } from '../src/index.js';

const fixturePath = fileURLToPath(
  new URL('../../../examples/northstar-integration.openchart.json', import.meta.url),
);

function intersects(left: LayoutFrame, right: LayoutFrame): boolean {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  );
}

describe('layoutDocument', () => {
  test('places radial branches around their parent instead of flattening port-connected nodes into a row', async () => {
    const validation = validateDocument(JSON.parse(readFileSync(fixturePath, 'utf8')));
    if (!validation.ok) throw new Error('Invalid layout fixture');
    const document = structuredClone(validation.document);
    document.nodes = {};
    document.ports = {};
    document.edges = {};
    document.layout = { overrides: {}, derived: null };
    for (const [index, id] of ['center', 'north', 'east', 'south', 'west'].entries()) {
      document.nodes[id] = {
        id, uid: String(100 + index).padStart(26, '0'), kind: 'service', label: id,
        pageId: 'page.architecture', layerId: 'layer.systems', styleId: 'style.fabric', data: {},
      };
      document.layout.overrides[id] = { x: index * 120, y: 200, width: 80, height: 80, pinned: false };
      document.ports[id] = {
        id, uid: String(200 + index).padStart(26, '0'), nodeId: id, side: 'auto', direction: 'both',
      };
      if (id !== 'center') document.edges[id] = {
        id, uid: String(300 + index).padStart(26, '0'), fromPortId: 'center', toPortId: id,
        label: '', semantic: 'Request', pageId: 'page.architecture', layerId: 'layer.systems', styleId: 'style.fabric', data: {},
      };
    }
    const { frames } = await layoutDocument(document, { pageId: 'page.architecture', mode: 'radial' });
    const center = frames.center;
    if (center === undefined) throw new Error('Radial layout omitted the center node');
    const branches = Object.entries(frames).filter(([id]) => id !== 'center').map(([, frame]) => frame);
    expect(branches).toHaveLength(4);
    expect(branches.some((frame) => frame.y + frame.height <= center.y)).toBe(true);
    expect(branches.some((frame) => frame.y >= center.y + center.height)).toBe(true);
    expect(branches.some((frame) => frame.x + frame.width <= center.x)).toBe(true);
    expect(branches.some((frame) => frame.x >= center.x + center.width)).toBe(true);
  });

  test('is deterministic, supports every promised mode, and preserves explicit pins', async () => {
    const input: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const validation = validateDocument(input);
    if (!validation.ok) {
      throw new Error(`Invalid layout fixture: ${JSON.stringify(validation.diagnostics)}`);
    }
    const document = structuredClone(validation.document);
    for (const [nodeId, override] of Object.entries(document.layout.overrides)) {
      document.layout.overrides[nodeId] = { ...override, pinned: false };
    }
    document.layout.overrides['system.northstar'] = {
      x: 86,
      y: 258,
      width: 310,
      height: 282,
      pinned: true,
    };
    document.layout.derived = null;

    const options = {
      pageId: 'page.architecture',
      mode: 'layered' as const,
      direction: 'RIGHT' as const,
    };
    const first = await layoutDocument(document, options);
    const second = await layoutDocument(document, options);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      engine: 'elk.layered',
      derivedVersion: 'elkjs@0.12.0/openchart-2',
    });
    expect(first.frames['system.northstar']).toEqual({
      x: 86,
      y: 258,
      width: 310,
      height: 282,
    });
    expect(Object.keys(first.frames).sort()).toEqual(Object.keys(document.nodes).sort());

    const unpinnedFrames = Object.entries(first.frames)
      .filter(([nodeId]) => nodeId !== 'system.northstar')
      .map(([, frame]) => frame);
    for (const frame of unpinnedFrames) {
      expect(Number.isFinite(frame.x) && Number.isFinite(frame.y)).toBe(true);
      expect(frame.x % 8).toBe(0);
      expect(frame.y % 8).toBe(0);
    }
    for (let leftIndex = 0; leftIndex < unpinnedFrames.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < unpinnedFrames.length; rightIndex += 1) {
        expect(intersects(unpinnedFrames[leftIndex]!, unpinnedFrames[rightIndex]!)).toBe(false);
      }
    }

    const modes: readonly LayoutMode[] = ['tree', 'radial', 'force'];
    for (const mode of modes) {
      const result = await layoutDocument(document, {
        pageId: 'page.architecture',
        mode,
        direction: 'RIGHT',
      });
      const repeated = await layoutDocument(document, {
        pageId: 'page.architecture',
        mode,
        direction: 'RIGHT',
      });
      expect(result).toEqual(repeated);
      expect(Object.keys(result.frames)).toHaveLength(6);
      expect(result.frames['system.northstar']).toEqual(first.frames['system.northstar']);
    }

    const nested = structuredClone(document);
    nested.nodes['service.ingress'] = {
      ...nested.nodes['service.ingress']!,
      parentId: 'system.northstar',
    };
    nested.layout.overrides['system.northstar'] = {
      x: 1_200,
      y: 800,
      width: 1_200,
      height: 800,
      pinned: true,
    };
    const nestedResult = await layoutDocument(nested, options);
    const parentFrame = nestedResult.frames['system.northstar']!;
    const childFrame = nestedResult.frames['service.ingress']!;
    expect(childFrame.x).toBeGreaterThanOrEqual(parentFrame.x);
    expect(childFrame.y).toBeGreaterThanOrEqual(parentFrame.y);
    expect(childFrame.x + childFrame.width).toBeLessThanOrEqual(parentFrame.x + parentFrame.width);
    expect(childFrame.y + childFrame.height).toBeLessThanOrEqual(parentFrame.y + parentFrame.height);
  });
});
