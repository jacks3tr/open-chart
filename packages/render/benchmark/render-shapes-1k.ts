import type { SceneDescription } from '@openchart/scene';

import type { CanvasPaintContext } from '../src/canvas.js';
import {
  SceneViewportRenderer,
  type CameraState,
} from '../src/viewport.js';

const SHAPE_COUNT = 1_000;
const VIEWPORT_WIDTH = 680;
const VIEWPORT_HEIGHT = 448;
const PAPER_COLOR = { red: 0xf4, green: 0xf7, blue: 0xfb };
const LOD_LEVELS = [
  { id: 'lod-detail', label: 'Detail', zoom: 1 },
  { id: 'lod-standard', label: 'Standard', zoom: 0.5 },
  { id: 'lod-compact', label: 'Compact', zoom: 0.25 },
  { id: 'lod-overview', label: 'Overview', zoom: 0.1 },
] as const;

export interface ShapeLodBenchmarkResult {
  readonly id: string;
  readonly label: string;
  readonly zoom: number;
  readonly totalIndexedGroups: number;
  readonly visibleIndexedGroups: number;
  readonly paintedTopLevelItems: number;
  readonly drawCallCount: number;
  readonly visibleEntityCount: number;
  readonly renderMs: number;
  readonly nonPaperPixels: number;
}

export interface ShapeBenchmarkResult {
  readonly passed: boolean;
  readonly shapeCount: number;
  readonly sceneBytes: number;
  readonly loadAndParseMs: number;
  readonly devicePixelRatio: number;
  readonly lods: readonly ShapeLodBenchmarkResult[];
  readonly userAgent: string;
}

function requiredElement<ElementType extends Element>(selector: string): ElementType {
  const element = globalThis.document.querySelector<ElementType>(selector);
  if (element === null) {
    throw new Error(`Shape benchmark element ${JSON.stringify(selector)} is missing`);
  }
  return element;
}

function assertScene(value: unknown): asserts value is SceneDescription {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('version' in value) ||
    value.version !== 1 ||
    !('bounds' in value) ||
    typeof value.bounds !== 'object' ||
    value.bounds === null ||
    !('items' in value) ||
    !Array.isArray(value.items)
  ) {
    throw new Error('Shape corpus did not contain a SceneDescription');
  }
}

function centeredCamera(scene: SceneDescription, zoom: number): CameraState {
  return {
    x: scene.bounds.x + scene.bounds.width / 2 - VIEWPORT_WIDTH / (2 * zoom),
    y: scene.bounds.y + scene.bounds.height / 2 - VIEWPORT_HEIGHT / (2 * zoom),
    zoom,
    viewportWidth: VIEWPORT_WIDTH,
    viewportHeight: VIEWPORT_HEIGHT,
  };
}

function countNonPaperPixels(context: CanvasRenderingContext2D): number {
  const pixels = context.getImageData(0, 0, context.canvas.width, context.canvas.height).data;
  let count = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] ?? 0;
    const difference =
      Math.abs((pixels[index] ?? 0) - PAPER_COLOR.red) +
      Math.abs((pixels[index + 1] ?? 0) - PAPER_COLOR.green) +
      Math.abs((pixels[index + 2] ?? 0) - PAPER_COLOR.blue);
    if (alpha > 0 && difference > 18) {
      count += 1;
    }
  }
  return count;
}

function paintLod(
  scene: SceneDescription,
  renderer: SceneViewportRenderer,
  lod: (typeof LOD_LEVELS)[number],
  devicePixelRatio: number,
): ShapeLodBenchmarkResult {
  const canvas = requiredElement<HTMLCanvasElement>(`#${lod.id}`);
  canvas.width = Math.ceil(VIEWPORT_WIDTH * devicePixelRatio);
  canvas.height = Math.ceil(VIEWPORT_HEIGHT * devicePixelRatio);
  const nativeContext = canvas.getContext('2d', { willReadFrequently: true });
  if (nativeContext === null) {
    throw new Error(`Unable to create the ${lod.label} benchmark canvas context`);
  }
  nativeContext.scale(devicePixelRatio, devicePixelRatio);
  const renderStart = performance.now();
  const stats = renderer.paint(
    nativeContext as unknown as CanvasPaintContext,
    centeredCamera(scene, lod.zoom),
    { devicePixelRatio },
  );
  const renderMs = performance.now() - renderStart;
  const nonPaperPixels = countNonPaperPixels(nativeContext);
  requiredElement<HTMLElement>(`[data-stats-for="${lod.id}"]`).textContent =
    `${stats.visibleIndexedGroups.toLocaleString()} visible · ${stats.drawCallCount.toLocaleString()} draws · ${renderMs.toFixed(2)} ms`;
  return {
    ...lod,
    totalIndexedGroups: stats.totalIndexedGroups,
    visibleIndexedGroups: stats.visibleIndexedGroups,
    paintedTopLevelItems: stats.paintedTopLevelItems,
    drawCallCount: stats.drawCallCount,
    visibleEntityCount: stats.visibleEntityIds.length,
    renderMs,
    nonPaperPixels,
  };
}

export async function runShapeBenchmark(): Promise<ShapeBenchmarkResult> {
  const loadStart = performance.now();
  const response = await fetch('/.openchart-benchmarks/shape-corpus.json', {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Unable to load shape corpus: HTTP ${response.status}`);
  }
  const source = await response.text();
  const parsed: unknown = JSON.parse(source);
  assertScene(parsed);
  const loadAndParseMs = performance.now() - loadStart;
  const renderer = new SceneViewportRenderer(parsed);
  const devicePixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
  const lods = LOD_LEVELS.map((lod) =>
    paintLod(parsed, renderer, lod, devicePixelRatio),
  );
  const passed =
    renderer.totalIndexedGroups === SHAPE_COUNT &&
    lods.every(
      (lod) =>
        lod.totalIndexedGroups === SHAPE_COUNT &&
        lod.visibleIndexedGroups > 0 &&
        lod.visibleEntityCount === lod.visibleIndexedGroups &&
        lod.drawCallCount > 0 &&
        lod.nonPaperPixels > 0,
    );
  return {
    passed,
    shapeCount: renderer.totalIndexedGroups,
    sceneBytes: new TextEncoder().encode(source).length,
    loadAndParseMs,
    devicePixelRatio,
    lods,
    userAgent: navigator.userAgent,
  };
}

const statusElement = requiredElement<HTMLElement>('#status');
const resultElement = requiredElement<HTMLElement>('#result');
const benchmarkWindow = globalThis as unknown as {
  __openChartBenchmark?: ShapeBenchmarkResult;
  __openChartBenchmarkError?: string;
};
statusElement.textContent = 'RENDERING';
void runShapeBenchmark().then(
  (result) => {
    benchmarkWindow.__openChartBenchmark = result;
    statusElement.textContent = result.passed ? 'PASS' : 'FAIL';
    resultElement.textContent = JSON.stringify(result, null, 2);
    globalThis.document.body.dataset.ready = 'true';
    globalThis.document.body.dataset.benchmark = result.passed ? 'pass' : 'fail';
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    benchmarkWindow.__openChartBenchmarkError = message;
    statusElement.textContent = 'ERROR';
    resultElement.textContent = message;
    globalThis.document.body.dataset.ready = 'true';
    globalThis.document.body.dataset.benchmark = 'fail';
  },
);
