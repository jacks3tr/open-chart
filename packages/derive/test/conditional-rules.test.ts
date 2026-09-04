import { describe, expect, test } from 'vitest';

import type { OpenChartDocument } from '@openchart/ir';

import {
  IncrementalRuleEngine,
  type ConditionalRule,
} from '../src/index.js';

const uid = (value: number): string => value.toString().padStart(26, '0');

function documentFixture(): OpenChartDocument {
  return {
    schemaVersion: 1,
    documentId: 'document.rules',
    uid: uid(1),
    title: 'Rules',
    rev: 0,
    pages: {
      main: { id: 'main', uid: uid(2), name: 'Main', layerIds: ['base'] },
    },
    layers: {
      base: { id: 'base', uid: uid(3), name: 'Base', pageId: 'main', visible: true, locked: false },
    },
    nodes: {
      api: { id: 'api', uid: uid(4), kind: 'service', label: 'API', pageId: 'main', layerId: 'base', styleId: 'style.normal', data: { status: 'healthy' } },
      store: { id: 'store', uid: uid(5), kind: 'database', label: 'Store', pageId: 'main', layerId: 'base', styleId: 'style.normal', data: { status: 'healthy' } },
    },
    ports: {},
    edges: {},
    styles: {
      'style.normal': { id: 'style.normal', uid: uid(6), role: 'service', tokens: {} },
      'style.danger': { id: 'style.danger', uid: uid(7), role: 'service/error', tokens: {} },
    },
    layout: { overrides: {}, derived: null },
    meta: { createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:00:00.000Z' },
  };
}

describe('IncrementalRuleEngine', () => {
  test('re-evaluates only rules that depend on a changed entity field', () => {
    const rules: readonly ConditionalRule[] = [
      {
        id: 'rule.api-status', entity: 'node', entityIds: ['api'], field: 'data.status',
        operator: 'eq', value: 'failed', styleId: 'style.danger',
      },
      {
        id: 'rule.store-status', entity: 'node', entityIds: ['store'], field: 'data.status',
        operator: 'eq', value: 'failed', styleId: 'style.danger',
      },
    ];
    const engine = new IncrementalRuleEngine(rules);
    const document = documentFixture();

    expect(engine.evaluateAll(document).matches).toEqual([]);
    document.nodes.api!.data = { status: 'failed' };
    const result = engine.evaluateChanges(document, [
      { entity: 'node', entityId: 'api', field: 'data.status' },
    ]);

    expect(result.evaluatedRuleIds).toEqual(['rule.api-status']);
    expect(result.matches).toEqual([
      { ruleId: 'rule.api-status', entity: 'node', entityId: 'api', styleId: 'style.danger' },
    ]);
    expect(() => new IncrementalRuleEngine([...rules, rules[0]!])).toThrow(/Duplicate rule id/);
  });
});
