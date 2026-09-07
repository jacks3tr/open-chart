import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { validateDocument } from '@openchart/ir';
import { OperationEngine } from '@openchart/ops';

import { planBeautyPass } from '../src/index.js';

const fixturePath = fileURLToPath(
  new URL('../../../examples/northstar-integration.openchart.json', import.meta.url),
);

describe('planBeautyPass', () => {
  test('page cleanup preserves styles referenced by locked objects', async () => {
    const validation = validateDocument(JSON.parse(readFileSync(fixturePath, 'utf8')));
    if (!validation.ok) throw new Error('Invalid beauty fixture');
    const source = structuredClone(validation.document);
    const node = Object.values(source.nodes)[0]!;
    source.layers['layer.locked'] = { ...source.layers[node.layerId]!, id: 'layer.locked', uid: '99999999999999999999999999', locked: true };
    source.pages[node.pageId]!.layerIds.push('layer.locked');
    node.layerId = 'layer.locked';
    const plan = await planBeautyPass(source, { pageId: node.pageId });
    const engine = new OperationEngine(source);
    expect(engine.apply({ txId: 'protected-beauty', actor: 'user', origin: 'beauty', baseRev: source.rev, ops: plan.operations }).ok).toBe(true);
    expect(engine.document.theme).toEqual(source.theme);
    expect(engine.document.styles[node.styleId]).toEqual(source.styles[node.styleId]);
    expect(engine.document.nodes[node.id]).toEqual(node);
  });

  test('previews a selection without mutating the source, preserves pinned shapes and leaves other objects untouched', async () => {
    const validation = validateDocument(JSON.parse(readFileSync(fixturePath, 'utf8')));
    if (!validation.ok) throw new Error('Invalid beauty fixture');
    const source = structuredClone(validation.document);
    const ids = Object.keys(source.nodes);
    const moving = ids[0]!;
    const pinned = ids[1]!;
    source.layout.overrides[moving] = { ...source.layout.overrides[moving], pinned: false };
    const original = structuredClone(source);
    const plan = await planBeautyPass(source, { pageId: 'page.architecture', nodeIds: [moving, pinned] });
    expect(source).toEqual(original);
    const engine = new OperationEngine(source);
    expect(engine.apply({ txId: 'selected-beauty', actor: 'user', origin: 'beauty', baseRev: source.rev, ops: plan.operations }).ok).toBe(true);
    expect(engine.document.layout.overrides[pinned]).toEqual(source.layout.overrides[pinned]);
    for (const id of ids.slice(2)) {
      expect(engine.document.nodes[id]).toEqual(source.nodes[id]);
      expect(engine.document.layout.overrides[id]).toEqual(source.layout.overrides[id]);
    }
    expect(engine.document.layout.derived).toEqual(source.layout.derived);
    expect(engine.document.theme).toEqual(source.theme);
    expect(engine.document.styles).toEqual(source.styles);
    expect(engine.undo().ok).toBe(true);
    expect(engine.document).toEqual(original);
  });

  test('rejects a selection that is not on the requested page', async () => {
    const validation = validateDocument(JSON.parse(readFileSync(fixturePath, 'utf8')));
    if (!validation.ok) throw new Error('Invalid beauty fixture');
    await expect(planBeautyPass(validation.document, {
      pageId: 'page.architecture', nodeIds: ['missing-shape'],
    })).rejects.toThrow('selection must contain shapes on the current page');
  });

  test('compiles all steps into one undoable, idempotent operation list', async () => {
    const input: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const validation = validateDocument(input);
    if (!validation.ok) {
      throw new Error(`Invalid beauty fixture: ${JSON.stringify(validation.diagnostics)}`);
    }
    const ugly = structuredClone(validation.document);
    for (const [index, nodeId] of Object.keys(ugly.nodes).sort().entries()) {
      const frame = ugly.layout.overrides[nodeId];
      ugly.layout.overrides[nodeId] = {
        x: 120 + (index % 2) * 36,
        y: 180 + index * 28,
        width: frame?.width ?? 240,
        height: frame?.height ?? 120,
        pinned: false,
      };
    }
    ugly.layout.derived = null;
    ugly.edges['edge.ingress-audit'] = {
      ...ugly.edges['edge.ingress-audit']!,
      routing: { mode: 'straight', lineWidth: 5, lineStyle: 'dotted', startMarker: 'diamond', endMarker: 'arrow' },
    };
    const engine = new OperationEngine(ugly);
    const original = engine.document;

    const plan = await planBeautyPass(engine.document, {
      pageId: 'page.architecture',
      layoutMode: 'layered',
      direction: 'RIGHT',
      presetId: 'openchart-light',
    });
    expect(plan.steps).toHaveLength(7);
    expect(plan.operations.some((operation) => operation.op === 'set_derived_layout')).toBe(true);
    expect(plan.operations.some((operation) => operation.op === 'set_theme')).toBe(true);
    expect(plan.operations.some((operation) => operation.op === 'set_port_side')).toBe(true);
    expect(plan.fitBounds.width).toBeGreaterThan(0);

    expect(
      engine.apply({
        txId: 'tx.beauty-pass', actor: 'user', origin: 'beauty', baseRev: 0,
        ops: plan.operations,
      }),
    ).toMatchObject({ ok: true, rev: 1 });
    expect(Object.values(engine.document.edges).every(
      (edge) => edge.routing?.mode === 'orthogonal' && edge.routing.avoidObstacles === true,
    )).toBe(true);
    expect(engine.document.theme?.presetId).toBe('openchart-light');
    expect(plan.operations.some((operation) => operation.op === 'set_style_tokens')).toBe(true);
    expect(engine.document.edges['edge.ingress-audit']?.routing).toMatchObject({
      lineWidth: 5, lineStyle: 'dotted', startMarker: 'diamond', endMarker: 'arrow',
    });
    const frames = Object.values(engine.document.layout.derived ?? {});
    const minY = Math.min(...frames.map((frame) => frame.y));
    const maxY = Math.max(...frames.map((frame) => frame.y + frame.height));
    expect(minY).toBeGreaterThanOrEqual(168);
    expect(Math.abs((minY - 168) - (920 - 96 - maxY))).toBeLessThanOrEqual(8);
    expect((await planBeautyPass(engine.document, {
      pageId: 'page.architecture', layoutMode: 'layered', direction: 'RIGHT',
      presetId: 'openchart-light',
    })).operations).toEqual([]);

    expect(engine.undo()).toMatchObject({ ok: true, rev: 0 });
    expect(engine.document).toEqual(original);
  });
});
