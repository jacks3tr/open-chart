import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const REPORT_DIRECTORY = resolve(REPOSITORY_ROOT, '.openchart-benchmarks');
const OUTPUT_PATH = resolve(REPORT_DIRECTORY, 'performance-budget.json');
const MEBIBYTE = 1024 * 1024;

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
  return value;
}

function requiredBoolean(value, label) {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function maximumCheck(id, scenario, actual, target, unit, headroom = 0.2) {
  const gate = target * (1 - headroom);
  return {
    id,
    scenario,
    comparison: '<',
    target,
    gate,
    actual,
    unit,
    headroom,
    passed: actual < gate,
  };
}

function minimumCheck(id, scenario, actual, target, gate, unit, note) {
  return {
    id,
    scenario,
    comparison: '>=',
    target,
    gate,
    actual,
    unit,
    headroom: null,
    note,
    passed: actual >= gate,
  };
}

export function evaluatePerformanceMetrics(metrics) {
  const budgets = [
    maximumCheck(
      'cold-open-10k',
      'Cold open, 10,000-shape document',
      metrics.coldInteractiveMs,
      1_500,
      'ms',
    ),
    maximumCheck(
      'pan-zoom-p95-10k',
      'Pan and zoom, 10,000 shapes, p95 render work',
      metrics.panZoomP95Ms,
      16.7,
      'ms',
    ),
    maximumCheck(
      'pan-zoom-p99-10k',
      'Pan and zoom, 10,000 shapes, p99 render work',
      metrics.panZoomP99Ms,
      33,
      'ms',
    ),
    minimumCheck(
      'pan-zoom-fps-10k',
      'Pan and zoom, 10,000 shapes, sustained refresh',
      metrics.averageFps,
      60,
      58,
      'fps',
      'A 60 Hz runner is refresh-capped; 20% compute headroom is enforced by p95 and p99 render work.',
    ),
    maximumCheck(
      'pan-zoom-dropped-frames-10k',
      'Pan and zoom, 10,000 shapes, dropped-frame ratio',
      metrics.droppedFrameRatio,
      0.05,
      'ratio',
    ),
    maximumCheck(
      'drag-live-reroute-1k',
      'Drag a node among 1,000 shapes with live rerouting',
      metrics.drag1kMs,
      16.7,
      'ms',
    ),
    maximumCheck(
      'drag-10k',
      'Drag a node among 10,000 shapes',
      metrics.drag10kMs,
      1_000 / 30,
      'ms',
    ),
    maximumCheck(
      'node-mutation-paint',
      'Create, delete, or style a node through paint',
      metrics.nodeMutationPaintMs,
      16.7,
      'ms',
    ),
    maximumCheck(
      'text-edit-paint',
      'Text edit keystroke through repaint',
      metrics.textEditPaintMs,
      8,
      'ms',
    ),
    maximumCheck(
      'layout-500',
      'Cold auto-layout, 500 nodes (including ELK initialization)',
      metrics.layout500Ms,
      1_500,
      'ms',
    ),
    maximumCheck(
      'beauty-200',
      'Beauty Pass, 200 nodes',
      metrics.beauty200Ms,
      1_200,
      'ms',
    ),
    maximumCheck(
      'rules-1000',
      'Incremental rule evaluation, 1,000 rules',
      metrics.rules1000P95Ms,
      16,
      'ms',
    ),
    maximumCheck(
      'memory-10k',
      'Memory, 10,000-shape renderer process',
      metrics.rendererRssBytes,
      600 * MEBIBYTE,
      'bytes',
    ),
  ];
  const integrity = Object.entries(metrics.sourceChecks).map(([id, passed]) => ({
    id,
    passed,
  }));
  const quality = [
    {
      id: 'full-quality-reroute-on-drop',
      passed: metrics.fullQualityRerouteOnDrop,
    },
  ];
  return {
    budgets,
    integrity,
    quality,
    passed:
      budgets.every((budget) => budget.passed) &&
      integrity.every((check) => check.passed) &&
      quality.every((check) => check.passed),
  };
}

async function readJson(fileName) {
  const path = resolve(REPORT_DIRECTORY, fileName);
  const value = JSON.parse(await readFile(path, 'utf8'));
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fileName} must contain a JSON object`);
  }
  return value;
}

async function collectMetrics() {
  const [render, shapes, connectors, rules, beautyCorpus, core] = await Promise.all([
    readJson('render-10k.json'),
    readJson('render-shapes-1k.json'),
    readJson('connectors-1000.json'),
    readJson('conditional-rules-1000.json'),
    readJson('beauty-corpus-20.json'),
    readJson('phase8-core.json'),
  ]);
  if (!Array.isArray(shapes.lods) || shapes.lods.length === 0) {
    throw new Error('render-shapes-1k.json must contain LOD measurements');
  }
  const shapeRenderTimes = shapes.lods.map((lod, index) =>
    finiteNumber(lod?.renderMs, `shapes.lods[${index}].renderMs`),
  );
  const detailLod = shapes.lods.find((lod) => lod?.id === 'lod-detail');
  if (detailLod === undefined) {
    throw new Error('render-shapes-1k.json is missing the detail LOD');
  }
  const shapeWorstRenderMs = Math.max(...shapeRenderTimes);
  const shapeDetailRenderMs = finiteNumber(detailLod.renderMs, 'shapes.detail.renderMs');
  const connectorP95Ms = finiteNumber(connectors.fast?.p95Ms, 'connectors.fast.p95Ms');
  const renderP95Ms = finiteNumber(render.p95RenderMs, 'render.p95RenderMs');
  const operationP95Ms = Math.max(
    finiteNumber(core.operations?.create?.p95Ms, 'core.operations.create.p95Ms'),
    finiteNumber(core.operations?.delete?.p95Ms, 'core.operations.delete.p95Ms'),
    finiteNumber(core.operations?.style?.p95Ms, 'core.operations.style.p95Ms'),
  );
  const textP95Ms = finiteNumber(core.operations?.text?.p95Ms, 'core.operations.text.p95Ms');

  return {
    coldInteractiveMs: finiteNumber(render.coldInteractiveMs, 'render.coldInteractiveMs'),
    panZoomP95Ms: renderP95Ms,
    panZoomP99Ms: finiteNumber(render.p99RenderMs, 'render.p99RenderMs'),
    averageFps: finiteNumber(render.averageFps, 'render.averageFps'),
    droppedFrameRatio: finiteNumber(render.droppedFrameRatio, 'render.droppedFrameRatio'),
    drag1kMs: connectorP95Ms + shapeWorstRenderMs,
    drag10kMs: connectorP95Ms + renderP95Ms,
    nodeMutationPaintMs: operationP95Ms + shapeWorstRenderMs,
    textEditPaintMs: textP95Ms + shapeDetailRenderMs,
    layout500Ms: finiteNumber(core.layout?.elapsedMs, 'core.layout.elapsedMs'),
    beauty200Ms: finiteNumber(core.beauty?.elapsedMs, 'core.beauty.elapsedMs'),
    rules1000P95Ms: finiteNumber(rules.p95Ms, 'rules.p95Ms'),
    rendererRssBytes: finiteNumber(
      render.rendererRssBytes,
      'render.rendererRssBytes',
    ),
    processTreeWorkingSetBytes: finiteNumber(
      render.processTreeWorkingSetBytes,
      'render.processTreeWorkingSetBytes',
    ),
    processTreePrivateBytes: finiteNumber(
      render.processTreePrivateBytes,
      'render.processTreePrivateBytes',
    ),
    fullQualityRerouteOnDrop:
      requiredBoolean(connectors.obstacle?.passed, 'connectors.obstacle.passed') &&
      finiteNumber(
        connectors.obstacle?.overlappingSegments,
        'connectors.obstacle.overlappingSegments',
      ) === 0,
    sourceChecks: {
      render: requiredBoolean(render.passed, 'render.passed'),
      shapes: requiredBoolean(shapes.passed, 'shapes.passed'),
      connectorsFast: requiredBoolean(connectors.fast?.passed, 'connectors.fast.passed'),
      connectorsObstacle: requiredBoolean(
        connectors.obstacle?.passed,
        'connectors.obstacle.passed',
      ),
      rules: requiredBoolean(rules.passed, 'rules.passed'),
      beautyCorpus: requiredBoolean(beautyCorpus.passed, 'beautyCorpus.passed'),
      core: requiredBoolean(core.passed, 'core.passed'),
    },
  };
}

function run(command, arguments_) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, arguments_, {
      cwd: REPOSITORY_ROOT,
      windowsHide: true,
      stdio: 'inherit',
    });
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(
        new Error(
          `${command} ${arguments_.join(' ')} failed with ${
            signal === null ? `exit ${String(code)}` : `signal ${signal}`
          }`,
        ),
      );
    });
  });
}

/** Run every independent measurement, retaining failures instead of hiding later diagnostics. */
export async function runBenchmarkCommands(commands, execute = run) {
  const failures = [];
  for (const arguments_ of commands) {
    try {
      await execute(process.execPath, arguments_);
    } catch (error) {
      failures.push({ command: arguments_, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return failures;
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('OpenChart performance acceptance requires Windows and Microsoft Edge');
  }
  const tsxCli = resolve(REPOSITORY_ROOT, 'node_modules/tsx/dist/cli.mjs');
  const npmCli = process.env.npm_execpath;
  if (npmCli === undefined || npmCli.length === 0) {
    throw new Error('Run the aggregate benchmark through npm so npm_execpath is available');
  }
  await access(tsxCli);
  await access(npmCli);
  await mkdir(REPORT_DIRECTORY, { recursive: true });
  await Promise.all(['render-10k.json', 'render-shapes-1k.json', 'connectors-1000.json',
    'conditional-rules-1000.json', 'beauty-corpus-20.json', 'phase8-core.json',
    'shape-corpus.json', 'performance-budget.json', 'command-failures.json']
    .map((name) => rm(resolve(REPORT_DIRECTORY, name), { force: true })));
  await run(process.execPath, [npmCli, 'run', 'build']);
  const commandFailures = await runBenchmarkCommands([
    [
    'scripts/run-render-benchmark.mjs',
    '--output',
    '.openchart-benchmarks/render-10k.json',
    ],
    [
    tsxCli,
    'packages/connectors/benchmark/routing-1000.ts',
    '--output',
    '.openchart-benchmarks/connectors-1000.json',
    ],
    [
    tsxCli,
    'packages/derive/benchmark/conditional-rules-1000.ts',
    '--output',
    '.openchart-benchmarks/conditional-rules-1000.json',
    ],
    [
    tsxCli,
    'packages/app/benchmark/beauty-corpus-20.ts',
    '--output',
    '.openchart-benchmarks/beauty-corpus-20.json',
    ],
    [
    tsxCli,
    'packages/derive/benchmark/phase8-core.ts',
    '--output',
    '.openchart-benchmarks/phase8-core.json',
    ],
    [
    tsxCli,
    'packages/scene/benchmark/generate-shape-corpus.ts',
    '--output',
    '.openchart-benchmarks/shape-corpus.json',
    ],
    [
    'scripts/run-render-benchmark.mjs',
    '--benchmark-path',
    '/packages/render/benchmark/render-shapes-1k.html',
    '--output',
    '.openchart-benchmarks/render-shapes-1k.json',
    ],
  ]);

  await writeFile(resolve(REPORT_DIRECTORY, 'command-failures.json'),
    `${JSON.stringify({ commandFailures }, null, 2)}\n`, 'utf8');
  const metrics = await collectMetrics();
  const evaluation = evaluatePerformanceMetrics(metrics);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    coverage: 'docs/OPENCHART_PLAN.md section 17.1',
    metrics,
    ...evaluation,
    commandFailures,
    passed: evaluation.passed && commandFailures.length === 0,
  };
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) {
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`OpenChart performance benchmark failed: ${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
