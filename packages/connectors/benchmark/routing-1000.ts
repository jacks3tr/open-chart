import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  routeConnector,
  segmentIntersectsRectInterior,
  type Rect,
} from '../src/index.js';

const FAST_ROUTE_COUNT = 1_000;
const FRAME_BUDGET_MS = 16.7;
const outputArgument = process.argv.indexOf('--output');
const outputPath = resolve(
  outputArgument >= 0 && process.argv[outputArgument + 1] !== undefined
    ? process.argv[outputArgument + 1]!
    : '.openchart-benchmarks/connectors-1000.json',
);

const fastCases = Array.from({ length: FAST_ROUTE_COUNT }, (_, index) => ({
  from: {
    x: (index % 20) * 48,
    y: Math.floor(index / 20) * 22,
    side: index % 2 === 0 ? 'east' as const : 'south' as const,
  },
  to: {
    x: 1_200 - (index % 17) * 31,
    y: 160 + ((index * 37) % 760),
    side: index % 3 === 0 ? 'north' as const : 'west' as const,
  },
}));

function runFastCorpus(): number {
  let pointCount = 0;
  for (const routeCase of fastCases) {
    const route = routeConnector({
      ...routeCase,
      mode: 'orthogonal',
      strategy: 'fast',
      jetty: 12,
    });
    if (!route.ok) {
      throw new Error(`${route.diagnostic.code}: ${route.diagnostic.message}`);
    }
    pointCount += route.points.length;
  }
  return pointCount;
}

for (let warmup = 0; warmup < 5; warmup += 1) {
  runFastCorpus();
}

const samples: number[] = [];
let fastPointCount = 0;
for (let sample = 0; sample < 30; sample += 1) {
  const started = performance.now();
  fastPointCount = runFastCorpus();
  samples.push(performance.now() - started);
}
samples.sort((left, right) => left - right);
const percentile = (fraction: number): number =>
  samples[Math.min(samples.length - 1, Math.floor(samples.length * fraction))] ?? 0;
const p50Ms = percentile(0.5);
const p95Ms = percentile(0.95);
const maxMs = samples.at(-1) ?? 0;

const obstacleCorpus = Array.from({ length: 100 }, (_, index) => {
  const y = index * 14;
  const obstacles: readonly Rect[] = [
    { id: `blocker-a-${index}`, x: 180, y: y - 34, width: 110, height: 68 },
    { id: `blocker-b-${index}`, x: 360, y: y - 58, width: 105, height: 68 },
  ];
  return {
    from: { x: 0, y, side: 'east' as const },
    to: { x: 640, y, side: 'west' as const },
    obstacles,
  };
});

let obstacleRouteCount = 0;
for (const routeCase of obstacleCorpus) {
  const route = routeConnector({
    ...routeCase,
    mode: 'orthogonal',
    strategy: 'obstacle',
    clearance: 10,
    jetty: 12,
  });
  if (!route.ok) {
    throw new Error(`${route.diagnostic.code}: ${route.diagnostic.message}`);
  }
  for (let index = 1; index < route.points.length; index += 1) {
    const from = route.points[index - 1];
    const to = route.points[index];
    if (from === undefined || to === undefined) {
      continue;
    }
    const overlap = routeCase.obstacles.find((obstacle) =>
      segmentIntersectsRectInterior(from, to, obstacle),
    );
    if (overlap !== undefined) {
      throw new Error(`Obstacle route overlaps ${overlap.id ?? 'an unnamed obstacle'}`);
    }
  }
  obstacleRouteCount += 1;
}

const report = {
  fast: {
    routeCount: FAST_ROUTE_COUNT,
    pointCount: fastPointCount,
    frameBudgetMs: FRAME_BUDGET_MS,
    p50Ms,
    p95Ms,
    maxMs,
    passed: p95Ms <= FRAME_BUDGET_MS,
  },
  obstacle: {
    routeCount: obstacleRouteCount,
    overlappingSegments: 0,
    passed: obstacleRouteCount === obstacleCorpus.length,
  },
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (!report.fast.passed || !report.obstacle.passed) {
  process.exitCode = 1;
}
