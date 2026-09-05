import type { SceneTextItem, SceneRect } from '@openchart/scene';

import {
  RasterCache,
  type RasterCacheStats,
  type RasterSurfaceFactory,
} from './raster-cache.js';
import type { CanvasPaintContext, CanvasRasterSurface } from './canvas.js';

/** The text metrics consumed by the Canvas renderer. */
export interface CanvasTextMeasurement {
  readonly width: number;
  readonly actualBoundingBoxLeft?: number;
  readonly actualBoundingBoxRight?: number;
  readonly actualBoundingBoxAscent?: number;
  readonly actualBoundingBoxDescent?: number;
}

interface ResolvedTextStyle {
  readonly value: string;
  readonly font: string;
  readonly fontSize: number;
  readonly fill: string;
  readonly underline: boolean;
  readonly letterSpacing: number;
  readonly anchor: 'start' | 'middle' | 'end';
}

interface ResolvedTextMetrics {
  readonly width: number;
  readonly leftExtent: number;
  readonly rightExtent: number;
  readonly ascent: number;
  readonly descent: number;
}

interface TextRasterSpec extends ResolvedTextStyle, ResolvedTextMetrics {
  readonly zoomBucket: number;
  readonly devicePixelRatio: number;
  readonly logicalWidth: number;
  readonly logicalHeight: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly key: string;
}

const TEXT_PADDING = 1;
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

function normalizeDevicePixelRatio(value: number | undefined): number {
  const dpr = value ?? 1;
  if (!Number.isFinite(dpr) || dpr <= 0) {
    throw new Error('Canvas text devicePixelRatio must be finite and positive');
  }
  return Math.min(dpr, 2);
}

function nextPowerOfTwo(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Canvas text zoom must be finite and positive');
  }
  const exponent = Math.ceil(Math.log2(value));
  const bucket = 2 ** exponent;
  if (!Number.isFinite(bucket) || bucket <= 0) {
    throw new RangeError('Canvas text zoom bucket must be finite and positive');
  }
  return bucket;
}

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Canvas text ${label} must be finite and positive`);
  }
  return value;
}

function measurementMetric(
  measurement: CanvasTextMeasurement,
  key: keyof CanvasTextMeasurement,
): number | undefined {
  const value = measurement[key];
  if (value !== undefined && !Number.isFinite(value)) {
    throw new Error(`Canvas text measurement ${String(key)} must be finite`);
  }
  return value;
}

function resolveMeasurement(
  measurement: CanvasTextMeasurement,
  fontSize: number,
): ResolvedTextMetrics {
  const width = measurementMetric(measurement, 'width');
  if (width === undefined || width < 0) {
    throw new Error('Canvas text measurement width must be finite and non-negative');
  }

  const left = measurementMetric(measurement, 'actualBoundingBoxLeft');
  const right = measurementMetric(measurement, 'actualBoundingBoxRight');
  const ascent = measurementMetric(measurement, 'actualBoundingBoxAscent');
  const descent = measurementMetric(measurement, 'actualBoundingBoxDescent');

  return {
    width,
    leftExtent: Math.max(0, left ?? 0),
    rightExtent: Math.max(0, right ?? 0),
    ascent: ascent !== undefined && ascent > 0 ? ascent : fontSize * 0.8,
    descent: descent !== undefined && descent > 0 ? descent : fontSize * 0.2,
  };
}

function textStyle(item: SceneTextItem): ResolvedTextStyle {
  const fontSize = positiveFinite(item.fontSize, 'fontSize');
  const letterSpacing = item.letterSpacing ?? 0;
  if (!Number.isFinite(letterSpacing)) {
    throw new Error('Canvas text letterSpacing must be finite');
  }
  return {
    value: item.value,
    font: `${item.fontStyle ?? 'normal'} ${item.fontWeight ?? 400} ${item.fontSize}px ${item.fontFamily}`,
    fontSize,
    fill: item.fill,
    underline: item.underline === true,
    letterSpacing,
    anchor: item.anchor === 'middle' ? 'middle' : (item.anchor ?? 'start'),
  };
}

function configureTextContext(
  context: CanvasPaintContext,
  style: ResolvedTextStyle,
  anchor: 'start' | 'middle' | 'end' = style.anchor,
): void {
  context.fillStyle = style.fill;
  context.font = style.font;
  context.textAlign = anchor === 'middle' ? 'center' : anchor;
  context.textBaseline = 'alphabetic';
  if ('letterSpacing' in context) {
    context.letterSpacing = `${style.letterSpacing}px`;
  }
}

function measurementKey(style: ResolvedTextStyle): string {
  return JSON.stringify([style.value, style.font, style.letterSpacing]);
}

function rasterKey(spec: TextRasterSpec): string {
  return JSON.stringify({
    text: spec.value,
    font: spec.font,
    fill: spec.fill,
    underline: spec.underline,
    letterSpacing: spec.letterSpacing,
    zoom: spec.zoomBucket,
    devicePixelRatio: spec.devicePixelRatio,
    logicalWidth: spec.logicalWidth,
    logicalHeight: spec.logicalHeight,
  });
}

function allocatePixels(value: number, label: string): number {
  const pixels = Math.ceil(value);
  if (!Number.isFinite(pixels) || !Number.isSafeInteger(pixels) || pixels <= 0) {
    throw new RangeError(`Canvas text ${label} must normalize to a positive safe integer`);
  }
  return pixels;
}

function destinationRect(spec: TextRasterSpec, item: SceneTextItem): SceneRect {
  const adjustedAdvance = spec.width + spec.letterSpacing * Math.max(0, spec.value.length - 1);
  const anchorOffset =
    spec.anchor === 'middle' ? adjustedAdvance / 2 : spec.anchor === 'end' ? adjustedAdvance : 0;
  const rasterScale = spec.zoomBucket * spec.devicePixelRatio;
  return {
    x: item.at.x - anchorOffset - spec.leftExtent - TEXT_PADDING,
    y: item.at.y - spec.ascent - TEXT_PADDING,
    width: spec.pixelWidth / rasterScale,
    height: spec.pixelHeight / rasterScale,
  };
}

function renderTextSurface(surface: CanvasRasterSurface, spec: TextRasterSpec): void {
  const context = surface.context;
  context.save();
  try {
    context.globalAlpha = 1;
    context.clearRect(0, 0, surface.width, surface.height);
    const rasterScale = spec.zoomBucket * spec.devicePixelRatio;
    context.scale(rasterScale, rasterScale);
    configureTextContext(context, spec, 'start');
    context.fillText(
      spec.value,
      TEXT_PADDING + spec.leftExtent,
      TEXT_PADDING + spec.ascent,
    );
    if (spec.underline && spec.value.length > 0) {
      const baselineY = TEXT_PADDING + spec.ascent;
      const underlineY = baselineY + Math.max(1, spec.fontSize * 0.1);
      const advance = spec.width + spec.letterSpacing * Math.max(0, spec.value.length - 1);
      context.beginPath();
      context.strokeStyle = spec.fill;
      context.lineWidth = Math.max(1, spec.fontSize / 16);
      context.moveTo(TEXT_PADDING + spec.leftExtent, underlineY);
      context.lineTo(TEXT_PADDING + spec.leftExtent + advance, underlineY);
      context.stroke();
    }
  } finally {
    context.restore();
  }
}

/**
 * Reuses measured text metrics and rasterized text pixels across frames.
 * The cache is deliberately DOM-free; callers provide a surface factory that
 * can create an OffscreenCanvas (or another CanvasRasterSurface) in their host.
 */
export class CanvasTextRasterCache {
  private readonly rasterCache: RasterCache<CanvasRasterSurface>;
  private readonly measurements = new Map<string, ResolvedTextMetrics>();

  public constructor(
    factory: RasterSurfaceFactory<CanvasRasterSurface>,
    maxBytes: number = DEFAULT_MAX_BYTES,
  ) {
    this.rasterCache = new RasterCache(factory, maxBytes);
  }

  public get stats(): RasterCacheStats {
    return this.rasterCache.stats;
  }

  public clear(): void {
    this.rasterCache.clear();
    this.measurements.clear();
  }

  public paintText(
    context: CanvasPaintContext,
    item: SceneTextItem,
    zoom: number,
    devicePixelRatio?: number,
  ): void {
    const style = textStyle(item);
    const normalizedDpr = normalizeDevicePixelRatio(devicePixelRatio);
    const zoomBucket = nextPowerOfTwo(zoom);

    configureTextContext(context, style);
    const metricsKey = measurementKey(style);
    let metrics = this.measurements.get(metricsKey);
    if (metrics === undefined) {
      metrics = resolveMeasurement(context.measureText(style.value), style.fontSize);
      this.measurements.set(metricsKey, metrics);
      if (this.measurements.size > 4096) {
        const oldest = this.measurements.keys().next().value;
        if (oldest !== undefined) this.measurements.delete(oldest);
      }
    }

    const adjustedAdvance = metrics.width + style.letterSpacing * Math.max(0, style.value.length - 1);
    const innerWidth = metrics.leftExtent + Math.max(adjustedAdvance, metrics.rightExtent);
    const logicalWidth = innerWidth + TEXT_PADDING * 2;
    const underlineAllowance = style.underline
      ? Math.max(metrics.descent, Math.max(1, style.fontSize * 0.1) + Math.max(1, style.fontSize / 16) / 2)
      : metrics.descent;
    const logicalHeight = metrics.ascent + underlineAllowance + TEXT_PADDING * 2;
    if (!Number.isFinite(logicalWidth) || logicalWidth <= 0) {
      throw new RangeError('Canvas text logical width must be finite and positive');
    }
    if (!Number.isFinite(logicalHeight) || logicalHeight <= 0) {
      throw new RangeError('Canvas text logical height must be finite and positive');
    }

    const pixelWidth = allocatePixels(logicalWidth * zoomBucket * normalizedDpr, 'pixel width');
    const pixelHeight = allocatePixels(logicalHeight * zoomBucket * normalizedDpr, 'pixel height');
    const spec: TextRasterSpec = {
      ...style,
      ...metrics,
      zoomBucket,
      devicePixelRatio: normalizedDpr,
      logicalWidth,
      logicalHeight,
      pixelWidth,
      pixelHeight,
      key: '',
    };
    const resolvedSpec = { ...spec, key: rasterKey(spec) };
    const surface = this.rasterCache.getOrCreate(
      resolvedSpec.key,
      resolvedSpec.pixelWidth,
      resolvedSpec.pixelHeight,
      (createdSurface) => renderTextSurface(createdSurface, resolvedSpec),
    );
    surface.blit(context, destinationRect(resolvedSpec, item));
  }
}
