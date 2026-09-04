import type { CanvasPaintContext } from './canvas.js';
import type { RasterCacheStats } from './raster-cache.js';

const DEFAULT_SAMPLE_WINDOW = 120;
const MAX_SAMPLE_WINDOW = 600;
const BYTES_PER_KIB = 1024;
const BYTES_PER_MIB = BYTES_PER_KIB * 1024;
const BYTES_PER_GIB = BYTES_PER_MIB * 1024;

/** A single completed render frame recorded by {@link RenderStatsCollector}. */
export interface RenderStatsSample {
  readonly frameTimeMs: number;
  readonly drawCallCount: number;
  readonly dirtyRectCount: number;
  readonly workerLatencyMs?: number;
  readonly memoryBytes?: number;
  readonly caches?: readonly RasterCacheStats[];
}

/** The bounded performance summary consumed by the stats overlay. */
export interface RenderStatsSnapshot {
  readonly totalFrames: number;
  readonly sampledFrames: number;
  readonly lastFrameTimeMs: number;
  readonly averageFrameTimeMs: number;
  readonly p95FrameTimeMs: number;
  readonly p99FrameTimeMs: number;
  readonly estimatedFramesPerSecond: number;
  readonly drawCallCount: number;
  readonly dirtyRectCount: number;
  readonly workerLatencyMs: number;
  readonly memoryBytes: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly cacheHitRate: number;
  readonly cacheBytes: number;
}

/** Placement options for {@link paintRenderStatsOverlay}. */
export interface RenderStatsOverlayOptions {
  readonly x?: number;
  readonly y?: number;
}

interface CurrentCacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly bytes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNonNegative(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a finite non-negative number`);
  }
  return value;
}

function safeNonNegativeInteger(value: unknown, label: string): number {
  const normalized = finiteNonNegative(value, label);
  if (!Number.isSafeInteger(normalized)) {
    throw new RangeError(`${label} must be a safe integer`);
  }
  return normalized;
}

function addSafe(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`${label} must remain a safe integer`);
  }
  return result;
}

function readCacheStats(value: unknown, index: number): CurrentCacheStats {
  if (!isRecord(value)) {
    throw new TypeError(`Render cache stats at index ${index} must be an object`);
  }
  const hits = safeNonNegativeInteger(value.hits, `Render cache stats[${index}].hits`);
  const misses = safeNonNegativeInteger(value.misses, `Render cache stats[${index}].misses`);
  const bytes = safeNonNegativeInteger(value.bytes, `Render cache stats[${index}].bytes`);
  // Validate the remainder of RasterCacheStats as well. They are not displayed
  // here, but malformed cache snapshots should never enter a render summary.
  safeNonNegativeInteger(value.entries, `Render cache stats[${index}].entries`);
  safeNonNegativeInteger(value.maxBytes, `Render cache stats[${index}].maxBytes`);
  safeNonNegativeInteger(value.evictions, `Render cache stats[${index}].evictions`);
  return { hits, misses, bytes };
}

function aggregateCaches(caches: unknown): CurrentCacheStats {
  if (caches === undefined) {
    return { hits: 0, misses: 0, bytes: 0 };
  }
  if (!Array.isArray(caches)) {
    throw new TypeError('Render cache stats must be an array');
  }

  let hits = 0;
  let misses = 0;
  let bytes = 0;
  caches.forEach((cache, index) => {
    const stats = readCacheStats(cache, index);
    hits = addSafe(hits, stats.hits, 'Render cache hits');
    misses = addSafe(misses, stats.misses, 'Render cache misses');
    bytes = addSafe(bytes, stats.bytes, 'Render cache bytes');
  });
  return { hits, misses, bytes };
}

function percentile(samples: readonly number[], fraction: number): number {
  if (samples.length === 0) {
    return 0;
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(sorted.length * fraction));
  return sorted[rank - 1] ?? 0;
}

function validateSnapshot(snapshot: RenderStatsSnapshot): void {
  if (!isRecord(snapshot)) {
    throw new TypeError('Render stats snapshot must be an object');
  }
  safeNonNegativeInteger(snapshot.totalFrames, 'Render stats totalFrames');
  safeNonNegativeInteger(snapshot.sampledFrames, 'Render stats sampledFrames');
  finiteNonNegative(snapshot.lastFrameTimeMs, 'Render stats lastFrameTimeMs');
  finiteNonNegative(snapshot.averageFrameTimeMs, 'Render stats averageFrameTimeMs');
  finiteNonNegative(snapshot.p95FrameTimeMs, 'Render stats p95FrameTimeMs');
  finiteNonNegative(snapshot.p99FrameTimeMs, 'Render stats p99FrameTimeMs');
  finiteNonNegative(snapshot.estimatedFramesPerSecond, 'Render stats estimatedFramesPerSecond');
  safeNonNegativeInteger(snapshot.drawCallCount, 'Render stats drawCallCount');
  safeNonNegativeInteger(snapshot.dirtyRectCount, 'Render stats dirtyRectCount');
  finiteNonNegative(snapshot.workerLatencyMs, 'Render stats workerLatencyMs');
  safeNonNegativeInteger(snapshot.memoryBytes, 'Render stats memoryBytes');
  safeNonNegativeInteger(snapshot.cacheHits, 'Render stats cacheHits');
  safeNonNegativeInteger(snapshot.cacheMisses, 'Render stats cacheMisses');
  finiteNonNegative(snapshot.cacheHitRate, 'Render stats cacheHitRate');
  if (snapshot.cacheHitRate > 1) {
    throw new RangeError('Render stats cacheHitRate must be at most 1');
  }
  safeNonNegativeInteger(snapshot.cacheBytes, 'Render stats cacheBytes');
}

/** Collects frame timing and the latest renderer counters with bounded history. */
export class RenderStatsCollector {
  private readonly sampleWindow: number;
  private readonly frameTimes: number[] = [];
  private totalFrameCount = 0;
  private latestFrameTimeMs = 0;
  private latestDrawCallCount = 0;
  private latestDirtyRectCount = 0;
  private latestWorkerLatencyMs = 0;
  private latestMemoryBytes = 0;
  private latestCaches: CurrentCacheStats = { hits: 0, misses: 0, bytes: 0 };

  public constructor(sampleWindow = DEFAULT_SAMPLE_WINDOW) {
    const normalizedWindow = safeNonNegativeInteger(sampleWindow, 'Render stats sampleWindow');
    if (normalizedWindow === 0 || normalizedWindow > MAX_SAMPLE_WINDOW) {
      throw new RangeError(
        `Render stats sampleWindow must be between 1 and ${MAX_SAMPLE_WINDOW}`,
      );
    }
    this.sampleWindow = normalizedWindow;
  }

  public record(sample: RenderStatsSample): void {
    if (!isRecord(sample)) {
      throw new TypeError('Render stats sample must be an object');
    }
    const frameTimeMs = finiteNonNegative(sample.frameTimeMs, 'Render stats frameTimeMs');
    const drawCallCount = safeNonNegativeInteger(
      sample.drawCallCount,
      'Render stats drawCallCount',
    );
    const dirtyRectCount = safeNonNegativeInteger(
      sample.dirtyRectCount,
      'Render stats dirtyRectCount',
    );
    const workerLatencyMs =
      sample.workerLatencyMs === undefined
        ? this.latestWorkerLatencyMs
        : finiteNonNegative(sample.workerLatencyMs, 'Render stats workerLatencyMs');
    const memoryBytes =
      sample.memoryBytes === undefined
        ? this.latestMemoryBytes
        : safeNonNegativeInteger(sample.memoryBytes, 'Render stats memoryBytes');
    const caches = sample.caches === undefined ? this.latestCaches : aggregateCaches(sample.caches);

    if (this.totalFrameCount >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError('Render stats totalFrames exceeded the safe integer limit');
    }
    this.totalFrameCount += 1;
    this.frameTimes.push(frameTimeMs);
    if (this.frameTimes.length > this.sampleWindow) {
      this.frameTimes.shift();
    }
    this.latestDrawCallCount = drawCallCount;
    this.latestFrameTimeMs = frameTimeMs;
    this.latestDirtyRectCount = dirtyRectCount;
    this.latestWorkerLatencyMs = workerLatencyMs;
    this.latestMemoryBytes = memoryBytes;
    this.latestCaches = caches;
  }

  public snapshot(): RenderStatsSnapshot {
    const sampledFrames = this.frameTimes.length;
    const totalFrameTimeMs = this.frameTimes.reduce((sum, value) => sum + value, 0);
    const averageFrameTimeMs = sampledFrames === 0 ? 0 : totalFrameTimeMs / sampledFrames;
    const cacheOperations = this.latestCaches.hits + this.latestCaches.misses;
    const cacheHitRate = cacheOperations === 0 ? 0 : this.latestCaches.hits / cacheOperations;
    const snapshot: RenderStatsSnapshot = {
      totalFrames: this.totalFrameCount,
      sampledFrames,
      lastFrameTimeMs: this.latestFrameTimeMs,
      averageFrameTimeMs,
      p95FrameTimeMs: percentile(this.frameTimes, 0.95),
      p99FrameTimeMs: percentile(this.frameTimes, 0.99),
      estimatedFramesPerSecond: averageFrameTimeMs > 0 ? 1000 / averageFrameTimeMs : 0,
      drawCallCount: this.latestDrawCallCount,
      dirtyRectCount: this.latestDirtyRectCount,
      workerLatencyMs: this.latestWorkerLatencyMs,
      memoryBytes: this.latestMemoryBytes,
      cacheHits: this.latestCaches.hits,
      cacheMisses: this.latestCaches.misses,
      cacheHitRate,
      cacheBytes: this.latestCaches.bytes,
    };
    return Object.freeze(snapshot);
  }
}

function formatFixed(value: number): string {
  return value.toFixed(1);
}

function formatBytes(bytes: number): string {
  if (bytes < BYTES_PER_KIB) {
    return `${bytes} B`;
  }
  if (bytes < BYTES_PER_MIB) {
    return `${(bytes / BYTES_PER_KIB).toFixed(1)} KB`;
  }
  if (bytes < BYTES_PER_GIB) {
    return `${(bytes / BYTES_PER_MIB).toFixed(1)} MB`;
  }
  return `${(bytes / BYTES_PER_GIB).toFixed(1)} GB`;
}

/** Paint a compact, DOM-free performance panel on the supplied canvas context. */
export function paintRenderStatsOverlay(
  context: CanvasPaintContext,
  snapshot: RenderStatsSnapshot,
  options: RenderStatsOverlayOptions = {},
): void {
  const x = options.x ?? 16;
  const y = options.y ?? 16;
  finiteNonNegative(x, 'Render stats overlay x');
  finiteNonNegative(y, 'Render stats overlay y');
  validateSnapshot(snapshot);

  const lines = [
    'OPENCHART · RENDER',
    `FRAME ${formatFixed(snapshot.lastFrameTimeMs)} ms  P95 ${formatFixed(snapshot.p95FrameTimeMs)} ms`,
    `P99 ${formatFixed(snapshot.p99FrameTimeMs)} ms  ${formatFixed(snapshot.estimatedFramesPerSecond)} fps`,
    `DRAWS ${snapshot.drawCallCount}  DIRTY ${snapshot.dirtyRectCount}`,
    `CACHE ${formatFixed(snapshot.cacheHitRate * 100)}%  ${formatBytes(snapshot.cacheBytes)}`,
    `WORKER ${formatFixed(snapshot.workerLatencyMs)} ms  MEM ${formatBytes(snapshot.memoryBytes)}`,
  ];

  context.save();
  try {
    context.globalAlpha = 0.96;
    context.fillStyle = '#10213A';
    context.beginPath();
    context.rect(x, y, 236, 132);
    context.fill();

    context.globalAlpha = 1;
    context.fillStyle = '#F4F7FB';
    context.font = '600 11px "Cascadia Code", Consolas, monospace';
    context.textAlign = 'start';
    context.textBaseline = 'alphabetic';
    if ('letterSpacing' in context) {
      context.letterSpacing = '0px';
    }
    lines.forEach((line, index) => {
      context.fillText(line, x + 14, y + 19 + index * 20);
    });
  } finally {
    context.restore();
  }
}
