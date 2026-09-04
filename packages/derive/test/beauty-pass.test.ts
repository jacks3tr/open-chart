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
    const engine = new OperationEngine(ugly);
    const original = engine.document;

    const plan = await planBeautyPass(engine.document, {
      pageId: 'page.architecture',
      layoutMode: 'layered',
      direction: 'RIGHT',
      presetId: 'openchart-light',
    });
    expect(plan.steps).toHaveLength(11);
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
