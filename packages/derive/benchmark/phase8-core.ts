import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  validateDocument,
  type Edge,
  type Node,
  type OpenChartDocument,
  type Port,
} from '@openchart/ir';
import { OperationEngine, type Operation } from '@openchart/ops';

import { layoutDocument, planBeautyPass } from '../src/index.js';

const OPERATION_NODE_COUNT = 1_000;
const LAYOUT_NODE_COUNT = 500;
const BEAUTY_NODE_COUNT = 200;
const WARMUP_SAMPLES = 10;
const MEASURED_SAMPLES = 120;

function uid(value: number): string {
  return String(value).padStart(26, '0');
}

function nodeId(index: number): string {
  return `node.${String(index).padStart(4, '0')}`;
}

function createBenchmarkDocument(nodeCount: number): OpenChartDocument {
  const nodes: Record<string, Node> = {};
  const ports: Record<string, Port> = {};
  const edges: Record<string, Edge> = {};
  const overrides: OpenChartDocument['layout']['overrides'] = {};
  const kinds = ['service', 'system', 'database', 'control'] as const;

  for (let index = 0; index < nodeCount; index += 1) {
    const id = nodeId(index);
    const inputPortId = `${id}.in`;
    const outputPortId = `${id}.out`;
    nodes[id] = {
      id,
      uid: uid(1_000 + index),
      kind: kinds[index % kinds.length] ?? 'service',
      label: `Workload ${String(index + 1).padStart(4, '0')}`,
      pageId: 'page.main',
      layerId: 'layer.main',
      styleId: index % 2 === 0 ? 'style.primary' : 'style.secondary',
      data: { tier: index % 10, status: index % 7 === 0 ? 'WATCH' : 'READY' },
    };
    ports[inputPortId] = {
      id: inputPortId,
      uid: uid(10_000 + index * 2),
      nodeId: id,
      direction: 'in',
      side: 'west',
    };
    ports[outputPortId] = {
      id: outputPortId,
      uid: uid(10_001 + index * 2),
      nodeId: id,
      direction: 'out',
      side: 'east',
    };
    overrides[id] = {
      x: 80 + (index % 25) * 190,
      y: 160 + Math.floor(index / 25) * 132,
      width: 160,
      height: 92,
      pinned: false,
    };

    if (index > 0) {
      const edgeId = `edge.${String(index - 1).padStart(4, '0')}`;
      edges[edgeId] = {
        id: edgeId,
        uid: uid(30_000 + index),
        fromPortId: `${nodeId(index - 1)}.out`,
        toPortId: inputPortId,
        label: 'Flow',
        semantic: 'benchmark',
        pageId: 'page.main',
        layerId: 'layer.main',
        styleId: 'style.flow',
        data: {},
      };
    }
  }

  const candidate: OpenChartDocument = {
    schemaVersion: 1,
    documentId: `document.phase8-${nodeCount}`,
    uid: uid(1),
    title: `OpenChart Phase 8 ${nodeCount}-node workload`,
    rev: 0,
    pages: {
      'page.main': {
        id: 'page.main',
        uid: uid(2),
        name: 'Main',
        layerIds: ['layer.main'],
      },
    },
    layers: {
      'layer.main': {
        id: 'layer.main',
        uid: uid(3),
        name: 'Architecture',
        pageId: 'page.main',
        visible: true,
        locked: false,
      },
    },
    nodes,
    ports,
    edges,
    styles: {
      'style.primary': {
        id: 'style.primary',
        uid: uid(4),
        role: 'service/primary',
        tokens: { accent: '#00A7A5', surface: '#F0FBFA' },
      },
      'style.secondary': {
        id: 'style.secondary',
        uid: uid(5),
        role: 'service/secondary',
        tokens: { accent: '#2D62E8', surface: '#F4F7FF' },
      },
      'style.flow': {
        id: 'style.flow',
        uid: uid(6),
        role: 'flow/benchmark',
        tokens: { stroke: '#64748B' },
      },
    },
    layout: {
      engine: 'benchmark-source',
      options: {
        canvasWidth: 5_000,
        canvasHeight: Math.max(1_200, Math.ceil(nodeCount / 25) * 132 + 320),
      },
      overrides,
      derived: null,
    },
    meta: {
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    },
  };
  const validation = validateDocument(candidate);
  if (!validation.ok) {
    throw new Error(`Invalid Phase 8 benchmark document: ${JSON.stringify(validation.diagnostics)}`);
  }
  return validation.document;
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function samplesReport(values: readonly number[]): {
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
} {
  return {
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: Math.max(...values),
  };
}

function applyMeasured(
  engine: OperationEngine,
  txId: string,
  operation: Operation,
): number {
  const started = performance.now();
  const result = engine.apply({
    txId,
    actor: 'user',
    origin: 'gui',
    baseRev: engine.document.rev,
    ops: [operation],
  });
  const elapsedMs = performance.now() - started;
  if (!result.ok) {
    throw new Error(`${txId} failed: ${JSON.stringify(result.diagnostics)}`);
  }
  return elapsedMs;
}

function benchmarkOperations(): {
  readonly nodeCount: number;
  readonly sampleCount: number;
  readonly create: ReturnType<typeof samplesReport>;
  readonly delete: ReturnType<typeof samplesReport>;
  readonly style: ReturnType<typeof samplesReport>;
  readonly text: ReturnType<typeof samplesReport>;
  readonly passed: boolean;
} {
  const engine = new OperationEngine(createBenchmarkDocument(OPERATION_NODE_COUNT));
  const createSamples: number[] = [];
  const deleteSamples: number[] = [];
  const styleSamples: number[] = [];
  const textSamples: number[] = [];
  const totalSamples = WARMUP_SAMPLES + MEASURED_SAMPLES;

  for (let sample = 0; sample < totalSamples; sample += 1) {
    const temporaryId = `node.temporary-${String(sample).padStart(3, '0')}`;
    const createMs = applyMeasured(engine, `benchmark.create-${sample}`, {
      op: 'create_node',
      node: {
        id: temporaryId,
        uid: uid(100_000 + sample),
        kind: 'service',
        label: 'Temporary benchmark node',
        pageId: 'page.main',
        layerId: 'layer.main',
        styleId: 'style.primary',
        data: {},
      },
    });
    const deleteMs = applyMeasured(engine, `benchmark.delete-${sample}`, {
      op: 'delete_node',
      id: temporaryId,
    });
    const styleMs = applyMeasured(engine, `benchmark.style-${sample}`, {
      op: 'set_node_style',
      id: nodeId(0),
      styleId: sample % 2 === 0 ? 'style.secondary' : 'style.primary',
    });
    const textMs = applyMeasured(engine, `benchmark.text-${sample}`, {
      op: 'set_node_label',
      id: nodeId(0),
      label: `Edited workload ${sample}`,
    });
    if (sample >= WARMUP_SAMPLES) {
      createSamples.push(createMs);
      deleteSamples.push(deleteMs);
      styleSamples.push(styleMs);
      textSamples.push(textMs);
    }
  }

  const validation = validateDocument(engine.document);
  if (!validation.ok || Object.keys(engine.document.nodes).length !== OPERATION_NODE_COUNT) {
    throw new Error('Operation benchmark left the document in an invalid state');
  }
  const create = samplesReport(createSamples);
  const deletion = samplesReport(deleteSamples);
  const style = samplesReport(styleSamples);
  const text = samplesReport(textSamples);
  return {
    nodeCount: OPERATION_NODE_COUNT,
    sampleCount: MEASURED_SAMPLES,
    create,
    delete: deletion,
    style,
    text,
    passed:
      Math.max(create.p95Ms, deletion.p95Ms, style.p95Ms) < 16.7 &&
      text.p95Ms < 8,
  };
}

async function benchmarkLayout(): Promise<{
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly elapsedMs: number;
  readonly frameCount: number;
  readonly passed: boolean;
}> {
  const document = createBenchmarkDocument(LAYOUT_NODE_COUNT);
  const started = performance.now();
  const result = await layoutDocument(document, {
    pageId: 'page.main',
    mode: 'layered',
    direction: 'RIGHT',
    spacing: 48,
  });
  const elapsedMs = performance.now() - started;
  const frameCount = Object.keys(result.frames).length;
  return {
    nodeCount: LAYOUT_NODE_COUNT,
    edgeCount: Object.keys(document.edges).length,
    elapsedMs,
    frameCount,
    passed: frameCount === LAYOUT_NODE_COUNT && elapsedMs < 800,
  };
}

async function benchmarkBeauty(): Promise<{
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly operationCount: number;
  readonly elapsedMs: number;
  readonly passed: boolean;
}> {
  const engine = new OperationEngine(createBenchmarkDocument(BEAUTY_NODE_COUNT));
  const started = performance.now();
  const plan = await planBeautyPass(engine.document, {
    pageId: 'page.main',
    layoutMode: 'layered',
    direction: 'RIGHT',
    presetId: 'openchart-light',
  });
  const result = engine.apply({
    txId: 'benchmark.beauty-200',
    actor: 'user',
    origin: 'beauty',
    baseRev: engine.document.rev,
    ops: plan.operations,
  });
  const elapsedMs = performance.now() - started;
  if (!result.ok) {
    throw new Error(`Beauty benchmark failed: ${JSON.stringify(result.diagnostics)}`);
  }
  const validation = validateDocument(engine.document);
  const operationCount = plan.operations.length;
  return {
    nodeCount: BEAUTY_NODE_COUNT,
    edgeCount: Object.keys(engine.document.edges).length,
    operationCount,
    elapsedMs,
    passed: validation.ok && operationCount > 0 && elapsedMs < 1_200,
  };
}

const outputIndex = process.argv.indexOf('--output');
const requestedOutput = outputIndex === -1 ? undefined : process.argv[outputIndex + 1];
if (outputIndex !== -1 && requestedOutput === undefined) {
  throw new Error('--output requires a path');
}

const operations = benchmarkOperations();
const layout = await benchmarkLayout();
const beauty = await benchmarkBeauty();
const report = {
  operations,
  layout,
  beauty,
  passed: operations.passed && layout.passed && beauty.passed,
};

if (requestedOutput !== undefined) {
  const outputPath = resolve(requestedOutput);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify(report, null, 2));
if (!report.passed) {
  process.exitCode = 1;
}
