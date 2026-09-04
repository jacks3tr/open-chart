import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  planBeautyPass,
  TOKEN_PRESET_IDS,
  type LayoutMode,
} from '@openchart/derive';
import type { LayoutFrame } from '@openchart/ir';
import { OperationEngine } from '@openchart/ops';
import { buildSceneDescription, type SceneItem } from '@openchart/scene';

import { createUglyBeautyDocument } from './beauty-corpus-fixture.js';

const MODES: readonly LayoutMode[] = ['layered', 'tree', 'radial', 'force'];

function intersects(left: LayoutFrame, right: LayoutFrame): boolean {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  );
}

function collectItems(items: readonly SceneItem[]): readonly SceneItem[] {
  return items.flatMap((item) =>
    item.type === 'group' ? [item, ...collectItems(item.children)] : [item],
  );
}

let overlapCount = 0;
let routingDiagnosticCount = 0;
let typeFloorViolationCount = 0;
let idempotentCount = 0;
let outOfBoundsCount = 0;
let unbalancedCompositionCount = 0;
const elapsedMs: number[] = [];
for (let seed = 1; seed <= 20; seed += 1) {
  const mode = MODES[(seed - 1) % MODES.length] ?? 'layered';
  const presetId = TOKEN_PRESET_IDS[(seed - 1) % TOKEN_PRESET_IDS.length] ?? 'openchart-light';
  const engine = new OperationEngine(createUglyBeautyDocument(seed));
  const started = performance.now();
  const plan = await planBeautyPass(engine.document, {
    pageId: 'page.architecture',
    layoutMode: mode,
    direction: 'RIGHT',
    presetId,
  });
  const result = engine.apply({
    txId: `benchmark.beauty-${seed}`,
    actor: 'user',
    origin: 'beauty',
    baseRev: 0,
    ops: plan.operations,
  });
  if (!result.ok) {
    throw new Error(`Beauty seed ${seed} failed: ${JSON.stringify(result.diagnostics)}`);
  }
  elapsedMs.push(performance.now() - started);
  const frames = Object.values(engine.document.layout.derived ?? {});
  for (let leftIndex = 0; leftIndex < frames.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < frames.length; rightIndex += 1) {
      if (intersects(frames[leftIndex]!, frames[rightIndex]!)) {
        overlapCount += 1;
      }
    }
  }
  const scene = buildSceneDescription(engine.document, { pageId: 'page.architecture' });
  const minX = Math.min(...frames.map((frame) => frame.x));
  const minY = Math.min(...frames.map((frame) => frame.y));
  const maxX = Math.max(...frames.map((frame) => frame.x + frame.width));
  const maxY = Math.max(...frames.map((frame) => frame.y + frame.height));
  outOfBoundsCount += frames.filter((frame) => (
    frame.x < 24 ||
    frame.y < 144 ||
    frame.x + frame.width > scene.bounds.width - 24 ||
    frame.y + frame.height > scene.bounds.height - 58
  )).length;
  if (
    Math.abs((minX - 72) - (scene.bounds.width - 72 - maxX)) > 8 ||
    Math.abs((minY - 168) - (scene.bounds.height - 96 - maxY)) > 8
  ) {
    unbalancedCompositionCount += 1;
  }
  const expectedConnectorCount = Object.values(engine.document.edges)
    .filter((edge) => edge.pageId === 'page.architecture').length;
  routingDiagnosticCount += expectedConnectorCount - (scene.connectors?.length ?? 0);
  typeFloorViolationCount += collectItems(scene.items)
    .filter((item) => item.type === 'text' && item.fontSize < 10).length;
  const repeated = await planBeautyPass(engine.document, {
    pageId: 'page.architecture',
    layoutMode: mode,
    direction: 'RIGHT',
    presetId,
  });
  if (repeated.operations.length === 0) {
    idempotentCount += 1;
  }
}

const report = {
  seedCount: 20,
  layoutModes: MODES,
  presetCount: TOKEN_PRESET_IDS.length,
  overlapCount,
  routingDiagnosticCount,
  typeFloorViolationCount,
  idempotentCount,
  outOfBoundsCount,
  unbalancedCompositionCount,
  averageMs: elapsedMs.reduce((total, value) => total + value, 0) / elapsedMs.length,
  maxMs: Math.max(...elapsedMs),
  passed:
    overlapCount === 0 &&
    routingDiagnosticCount === 0 &&
    typeFloorViolationCount === 0 &&
    idempotentCount === 20 &&
    outOfBoundsCount === 0 &&
    unbalancedCompositionCount === 0,
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
