import type { SceneDescription, SceneItem } from '@openchart/scene';

import type { CanvasPaintContext, CanvasRasterSurface } from '../src/canvas.js';
import { RenderFrameScheduler } from '../src/frame-scheduler.js';
import { RasterCache, type RasterCacheStats } from '../src/raster-cache.js';
import { RenderStatsCollector, paintRenderStatsOverlay } from '../src/stats-overlay.js';
import { CanvasTextRasterCache } from '../src/text-raster-cache.js';
import { SceneViewportRenderer, type CameraState } from '../src/viewport.js';

const NODE_COUNT = 10_000;
const COLUMNS = 100;
const CELL_WIDTH = 140;
const CELL_HEIGHT = 92;
const CARD_WIDTH = 112;
const CARD_HEIGHT = 64;
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;
const WARMUP_FRAMES = 30;
const MEASURED_FRAMES = 240;
const MAX_MEMORY_BYTES = 600 * 1024 * 1024;

interface ChromiumPerformance extends Performance {
  readonly memory?: { readonly usedJSHeapSize: number };
}

export interface RenderBenchmarkResult {
  readonly passed: boolean;
  readonly nodeCount: number;
  readonly primitiveCount: number;
  readonly measuredFrames: number;
  readonly coldInteractiveMs: number;
  readonly averageRenderMs: number;
  readonly p95RenderMs: number;
  readonly p99RenderMs: number;
  readonly averageFrameIntervalMs: number;
  readonly p95FrameIntervalMs: number;
  readonly averageFps: number;
  readonly droppedFrameRatio: number;
  readonly memoryBytes: number;
  readonly devicePixelRatio: number;
  readonly initialVisibleGroups: number;
  readonly latestDrawCallCount: number;
  readonly chromeCache: RasterCacheStats;
  readonly textCache: RasterCacheStats;
  readonly userAgent: string;
}

declare global {
  interface Window {
    __openChartBenchmark?: RenderBenchmarkResult;
    __openChartBenchmarkError?: string;
  }
}

function requiredElement<ElementType extends Element>(selector: string): ElementType {
  const element = globalThis.document.querySelector<ElementType>(selector);
  if (element === null) {
    throw new Error(`Benchmark element ${JSON.stringify(selector)} is missing`);
  }
  return element;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function currentMemoryBytes(): number {
  return (performance as ChromiumPerformance).memory?.usedJSHeapSize ?? 0;
}

export function createRenderBenchmarkScene(): SceneDescription {
  const children: SceneItem[] = [
    {
      type: 'rect',
      id: 'benchmark-background',
      layer: 'background',
      frame: { x: 0, y: 0, width: COLUMNS * CELL_WIDTH, height: COLUMNS * CELL_HEIGHT },
      fill: '#F4F7FB',
    },
  ];

  for (let index = 0; index < NODE_COUNT; index += 1) {
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const x = column * CELL_WIDTH + 14;
    const y = row * CELL_HEIGHT + 14;
    const accent = index % 3 === 0 ? '#00A7A5' : index % 3 === 1 ? '#2D62E8' : '#FF6A3D';
    children.push({
      type: 'group',
      id: `benchmark-node-${index}`,
      role: 'node',
      entityId: `node.${index}`,
      children: [
        {
          type: 'rect',
          id: `benchmark-node-${index}-card`,
          frame: { x, y, width: CARD_WIDTH, height: CARD_HEIGHT },
          radius: 8,
          fill: '#FFFFFF',
          stroke: '#9AA8BA',
          strokeWidth: 1,
          chromeCacheKey: 'benchmark-card',
        },
        {
          type: 'rect',
          id: `benchmark-node-${index}-accent`,
          frame: { x, y, width: 4, height: CARD_HEIGHT },
          radius: 2,
          fill: accent,
          minZoom: 0.15,
        },
        {
          type: 'text',
          id: `benchmark-node-${index}-label`,
          value: `NODE ${String(index + 1).padStart(5, '0')}`,
          at: { x: x + 14, y: y + 28 },
          fill: '#10213A',
          fontFamily: 'Segoe UI, Arial, sans-serif',
          fontSize: 12,
          fontWeight: 700,
          minZoom: 0.75,
        },
        {
          type: 'text',
          id: `benchmark-node-${index}-kind`,
          value: index % 2 === 0 ? 'SERVICE' : 'SYSTEM',
          at: { x: x + 14, y: y + 47 },
          fill: accent,
          fontFamily: 'Cascadia Code, Consolas, monospace',
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: 0.6,
          minZoom: 0.75,
        },
      ],
    });
  }

  return {
    version: 1,
    bounds: { x: 0, y: 0, width: COLUMNS * CELL_WIDTH, height: COLUMNS * CELL_HEIGHT },
    title: 'OpenChart 10,000-node benchmark',
    description: 'Generated renderer performance corpus.',
    items: [{ type: 'group', id: 'artboard', role: 'artboard', children }],
  };
}

function createSurface(width: number, height: number): CanvasRasterSurface {
  const bitmap = new OffscreenCanvas(width, height);
  const context = bitmap.getContext('2d');
  if (context === null) {
    throw new Error('Unable to create benchmark OffscreenCanvas context');
  }
  return {
    width,
    height,
    context: context as unknown as CanvasPaintContext,
    blit(target, destination) {
      (target as unknown as CanvasRenderingContext2D).drawImage(
        bitmap,
        destination.x,
        destination.y,
        destination.width,
        destination.height,
      );
    },
  };
}

export function runRenderBenchmark(): Promise<RenderBenchmarkResult> {
  return new Promise((resolve, reject) => {
    if (typeof OffscreenCanvas !== 'function') {
      reject(new Error('OffscreenCanvas is required for the render benchmark'));
      return;
    }

    try {
      const coldStart = performance.now();
      const scene = createRenderBenchmarkScene();
      const renderer = new SceneViewportRenderer(scene);
      const chromeCache = new RasterCache(createSurface);
      const textCache = new CanvasTextRasterCache(createSurface);
      const canvas = requiredElement<HTMLCanvasElement>('#canvas');
      const devicePixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
      canvas.width = Math.ceil(VIEWPORT_WIDTH * devicePixelRatio);
      canvas.height = Math.ceil(VIEWPORT_HEIGHT * devicePixelRatio);
      const nativeContext = canvas.getContext('2d');
      if (nativeContext === null) {
        throw new Error('Unable to create benchmark canvas context');
      }
      nativeContext.scale(devicePixelRatio, devicePixelRatio);
      const context = nativeContext as unknown as CanvasPaintContext;
      let camera: CameraState = {
        x: 0,
        y: 0,
        zoom: 0.85,
        viewportWidth: VIEWPORT_WIDTH,
        viewportHeight: VIEWPORT_HEIGHT,
      };
      const initialStats = renderer.paint(context, camera, {
        chromeCache,
        textCache,
        devicePixelRatio,
      });
      const coldInteractiveMs = performance.now() - coldStart;
      const statsCollector = new RenderStatsCollector(600);
      const renderDurations: number[] = [];
      const frameIntervals: number[] = [];
      let previousTimestamp: number | undefined;
      let frameIndex = 0;

      const scheduler = new RenderFrameScheduler(
        {
          requestFrame: (callback) => globalThis.requestAnimationFrame(callback),
          cancelFrame: (handle) => globalThis.cancelAnimationFrame(handle),
        },
        ({ timestamp }) => {
          try {
            if (previousTimestamp !== undefined && frameIndex > WARMUP_FRAMES) {
              frameIntervals.push(timestamp - previousTimestamp);
            }
            previousTimestamp = timestamp;
            const measuredIndex = Math.max(0, frameIndex - WARMUP_FRAMES);
            const progress = measuredIndex / Math.max(1, MEASURED_FRAMES - 1);
            const phase = progress * Math.PI * 2;
            const zoom = 0.55 + (Math.sin(phase * 2) + 1) * 0.35;
            const maxX = Math.max(0, scene.bounds.width - VIEWPORT_WIDTH / zoom);
            const maxY = Math.max(0, scene.bounds.height - VIEWPORT_HEIGHT / zoom);
            camera = {
              x: (maxX * (Math.sin(phase - Math.PI / 2) + 1)) / 2,
              y: (maxY * (Math.sin(phase * 1.5) + 1)) / 2,
              zoom,
              viewportWidth: VIEWPORT_WIDTH,
              viewportHeight: VIEWPORT_HEIGHT,
            };

            const renderStart = performance.now();
            const paintStats = renderer.paint(context, camera, {
              chromeCache,
              textCache,
              devicePixelRatio,
            });
            const renderDuration = performance.now() - renderStart;
            if (frameIndex >= WARMUP_FRAMES) {
              renderDurations.push(renderDuration);
            }
            statsCollector.record({
              frameTimeMs: renderDuration,
              drawCallCount: paintStats.drawCallCount,
              dirtyRectCount: 0,
              memoryBytes: currentMemoryBytes(),
              caches: [chromeCache.stats, textCache.stats],
            });
            paintRenderStatsOverlay(context, statsCollector.snapshot(), { x: 16, y: 16 });

            frameIndex += 1;
            if (frameIndex < WARMUP_FRAMES + MEASURED_FRAMES) {
              scheduler.requestFull();
              return;
            }

            scheduler.dispose();
            const p95RenderMs = percentile(renderDurations, 0.95);
            const p99RenderMs = percentile(renderDurations, 0.99);
            const averageIntervalMs = average(frameIntervals);
            const averageFps = averageIntervalMs > 0 ? 1000 / averageIntervalMs : 0;
            const droppedFrameRatio =
              frameIntervals.filter((duration) => duration > 25).length /
              Math.max(1, frameIntervals.length);
            const memoryBytes = currentMemoryBytes();
            const snapshot = statsCollector.snapshot();
            resolve({
              passed:
                coldInteractiveMs < 1500 &&
                p95RenderMs < 16.7 &&
                p99RenderMs < 33 &&
                averageFps >= 58 &&
                droppedFrameRatio <= 0.05 &&
                (memoryBytes === 0 || memoryBytes < MAX_MEMORY_BYTES),
              nodeCount: NODE_COUNT,
              primitiveCount: 1 + NODE_COUNT * 4,
              measuredFrames: renderDurations.length,
              coldInteractiveMs,
              averageRenderMs: average(renderDurations),
              p95RenderMs,
              p99RenderMs,
              averageFrameIntervalMs: averageIntervalMs,
              p95FrameIntervalMs: percentile(frameIntervals, 0.95),
              averageFps,
              droppedFrameRatio,
              memoryBytes,
              devicePixelRatio,
              initialVisibleGroups: initialStats.visibleIndexedGroups,
              latestDrawCallCount: snapshot.drawCallCount,
              chromeCache: chromeCache.stats,
              textCache: textCache.stats,
              userAgent: navigator.userAgent,
            });
          } catch (error) {
            scheduler.dispose();
            reject(toError(error));
          }
        },
      );
      scheduler.requestFull();
    } catch (error) {
      reject(toError(error));
    }
  });
}

const statusElement = requiredElement<HTMLElement>('#status');
const resultElement = requiredElement<HTMLElement>('#result');
const benchmarkWindow = globalThis as typeof globalThis & Window;
statusElement.textContent = 'RUNNING';
void runRenderBenchmark().then(
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
