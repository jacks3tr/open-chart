import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import type { OpenChartDocument } from '@openchart/ir';

import { IncrementalRuleEngine, type ConditionalRule } from '../src/rules.js';

const RULE_COUNT = 1_000;
const BUDGET_MS = 16;
const SAMPLE_COUNT = 120;

const uid = (value: number): string => value.toString().padStart(26, '0');

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function documentFixture(): OpenChartDocument {
  return {
    schemaVersion: 1,
    documentId: 'document.rules-benchmark',
    uid: uid(1),
    title: 'Conditional rule benchmark',
    rev: 0,
    pages: { main: { id: 'main', uid: uid(2), name: 'Main', layerIds: ['base'] } },
    layers: {
      base: { id: 'base', uid: uid(3), name: 'Base', pageId: 'main', visible: true, locked: false },
    },
    nodes: {
      hot: {
        id: 'hot', uid: uid(4), kind: 'service', label: 'Hot node', pageId: 'main',
        layerId: 'base', styleId: 'style.normal', data: { score: 500 },
      },
    },
    ports: {},
    edges: {},
    styles: {
      'style.normal': { id: 'style.normal', uid: uid(5), role: 'service', tokens: {} },
      'style.highlight': { id: 'style.highlight', uid: uid(6), role: 'service/highlight', tokens: {} },
    },
    layout: { overrides: {}, derived: null },
    meta: { createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:00:00.000Z' },
  };
}

const rules: ConditionalRule[] = Array.from({ length: RULE_COUNT }, (_, index) => ({
  id: `rule.${index.toString().padStart(4, '0')}`,
  entity: 'node',
  entityIds: ['hot'],
  field: 'data.score',
  operator: 'gte',
  value: index,
  styleId: 'style.highlight',
}));

const document = documentFixture();
const engine = new IncrementalRuleEngine(rules);
engine.evaluateAll(document);
const samples: number[] = [];
let evaluatedRuleCount = 0;
for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
  document.nodes.hot!.data = { score: sample % RULE_COUNT };
  const started = performance.now();
  const result = engine.evaluateChanges(document, [
    { entity: 'node', entityId: 'hot', field: 'data.score' },
  ]);
  samples.push(performance.now() - started);
  evaluatedRuleCount = result.evaluatedRuleIds.length;
}

const report = {
  ruleCount: RULE_COUNT,
  evaluatedRuleCount,
  sampleCount: SAMPLE_COUNT,
  budgetMs: BUDGET_MS,
  p50Ms: percentile(samples, 0.5),
  p95Ms: percentile(samples, 0.95),
  maxMs: Math.max(...samples),
  passed: evaluatedRuleCount === RULE_COUNT && percentile(samples, 0.95) < BUDGET_MS,
};

const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0) {
  const requested = process.argv[outputIndex + 1];
  if (requested === undefined) {
    throw new Error('--output requires a path');
  }
  const outputPath = resolve(requested);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify(report, null, 2));
if (!report.passed) {
  process.exitCode = 1;
}
