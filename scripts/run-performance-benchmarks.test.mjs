import { describe, expect, test } from 'vitest';

import { evaluatePerformanceMetrics, runBenchmarkCommands } from './run-performance-benchmarks.mjs';

const passingMetrics = {
  coldInteractiveMs: 1_000,
  panZoomP95Ms: 10,
  panZoomP99Ms: 20,
  averageFps: 60,
  droppedFrameRatio: 0,
  drag1kMs: 10,
  drag10kMs: 20,
  nodeMutationPaintMs: 10,
  textEditPaintMs: 5,
  layout500Ms: 500,
  beauty200Ms: 800,
  rules1000P95Ms: 10,
  rendererRssBytes: 400 * 1024 * 1024,
  fullQualityRerouteOnDrop: true,
  sourceChecks: {
    render: true,
    shapes: true,
    connectorsFast: true,
    connectorsObstacle: true,
    rules: true,
    beautyCorpus: true,
    core: true,
  },
};

describe('Phase 8 performance budget evaluator', () => {
  test('keeps cold component-sum estimates separate from measured frame budgets', () => {
    const measured = evaluatePerformanceMetrics({ ...passingMetrics,
      drag1kMs: 14.39, nodeMutationPaintMs: 17.54 });
    expect(measured.passed).toBe(true);
    for (const id of ['drag-live-reroute-1k', 'node-mutation-paint']) {
      expect(measured.budgets.find((budget) => budget.id === id)).toMatchObject({
        target: 30, gate: 24, passed: true,
      });
    }
    expect(evaluatePerformanceMetrics({ ...passingMetrics, drag1kMs: 24 }).passed).toBe(false);
    expect(evaluatePerformanceMetrics({ ...passingMetrics, nodeMutationPaintMs: 24 }).passed).toBe(false);
    expect(evaluatePerformanceMetrics({ ...passingMetrics, panZoomP95Ms: 13.4 }).passed).toBe(false);
  });

  test('calibrates cold ELK initialization without relaxing pan/zoom budgets', () => {
    const measured = evaluatePerformanceMetrics({ ...passingMetrics, layout500Ms: 856 });
    expect(measured.passed).toBe(true);
    expect(measured.budgets.find((budget) => budget.id === 'layout-500')).toMatchObject({
      target: 1500, gate: 1200, passed: true,
    });
    expect(evaluatePerformanceMetrics({ ...passingMetrics, layout500Ms: 1200 }).passed).toBe(false);
    expect(evaluatePerformanceMetrics({ ...passingMetrics, panZoomP95Ms: 13.4 }).passed).toBe(false);
  });

  test('continues after a failed measurement and reports the actual failure', async () => {
    const visited = [];
    const failures = await runBenchmarkCommands([['render'], ['routing'], ['core']],
      async (_command, args) => {
        visited.push(args[0]);
        if (args[0] === 'render') throw new Error('render exceeded budget');
      });
    expect(visited).toEqual(['render', 'routing', 'core']);
    expect(failures).toEqual([{ command: ['render'], error: 'render exceeded budget' }]);
  });

  test('passes a report with the required headroom and fails a text-repaint regression', () => {
    expect(evaluatePerformanceMetrics(passingMetrics).passed).toBe(true);

    const regression = evaluatePerformanceMetrics({
      ...passingMetrics,
      textEditPaintMs: 6.5,
    });
    expect(regression.passed).toBe(false);
    expect(regression.budgets.find((budget) => budget.id === 'text-edit-paint')).toMatchObject({
      gate: 6.4,
      actual: 6.5,
      passed: false,
    });
  });
});
