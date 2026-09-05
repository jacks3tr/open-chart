import type {
  SceneDescription,
  SceneClipItem,
  SceneItem,
  ScenePathCommand,
  ScenePathItem,
  SceneLayer,
  ScenePoint,
  SceneRect,
  SceneRectItem,
} from '@openchart/scene';

import type { RasterCache, RasterSurface } from './raster-cache.js';
import type { CanvasTextMeasurement, CanvasTextRasterCache } from './text-raster-cache.js';

export interface CanvasPaintContext {
  globalAlpha: number;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'bevel' | 'miter' | 'round';
  font: string;
  textAlign: 'start' | 'center' | 'end';
  textBaseline: 'alphabetic';
  letterSpacing?: string;
  save(): void;
  restore(): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  rect(x: number, y: number, width: number, height: number): void;
  clip(): void;
  scale(x: number, y: number): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(controlX: number, controlY: number, x: number, y: number): void;
  bezierCurveTo(
    control1X: number,
    control1Y: number,
    control2X: number,
    control2Y: number,
    x: number,
    y: number,
  ): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
  ): void;
  fill(): void;
  stroke(): void;
  setLineDash(segments: number[]): void;
  measureText(value: string): CanvasTextMeasurement;
  fillText(value: string, x: number, y: number): void;
}

export interface CanvasRasterSurface extends RasterSurface {
  readonly context: CanvasPaintContext;
  blit(target: CanvasPaintContext, destinationRect: SceneRect): void;
}

export interface CanvasPaintOptions {
  readonly zoom?: number;
  readonly layer?: SceneLayer;
  readonly chromeCache?: RasterCache<CanvasRasterSurface>;
  readonly devicePixelRatio?: number;
  readonly textCache?: CanvasTextRasterCache;
  /**
   * Optional complete scene population used to decide whether a chrome sprite
   * is worth caching. The population and its items must be immutable; reuse the
   * array across paints to reuse prepared sprite specifications. Painting still
   * visits only the `items` argument.
   */
  readonly chromePopulation?: readonly SceneItem[];
  /** World-space viewport; only untransformed background grids use this bound. */
  readonly worldViewport?: SceneRect;
}

export interface CanvasPaintStats {
  readonly drawCallCount: number;
}

interface ResolvedRectStyle {
  readonly fill: string;
  readonly fillOpacity: number;
  readonly stroke: string;
  readonly strokeOpacity: number;
  readonly strokeWidth: number;
  readonly dash: readonly number[];
  readonly radius: number;
}

interface ChromeSpriteSpec {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly bleed: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly style: ResolvedRectStyle;
}

interface ChromeCandidates {
  readonly specs: ReadonlyMap<SceneRectItem, ChromeSpriteSpec>;
  readonly counts: ReadonlyMap<string, number>;
}

// Weak ownership releases replaced scenes; cap variants across zoom, DPR and layer.
const preparedChrome = new WeakMap<readonly SceneItem[], Map<string, ChromeCandidates>>();
const EMPTY_CHROME: ChromeCandidates = { specs: new Map(), counts: new Map() };
const MAX_CHROME_VARIANTS = 4;

function preparedChromeCandidates(
  population: readonly SceneItem[], zoom: number, layer: SceneLayer | undefined, dpr: number,
): ChromeCandidates {
  const zoomBucket = nextPowerOfTwo(zoom);
  const key = `${zoomBucket}:${dpr}:${layer ?? 'all'}`;
  let variants = preparedChrome.get(population);
  const cached = variants?.get(key);
  if (cached !== undefined) {
    variants?.delete(key);
    variants?.set(key, cached);
    return cached;
  }
  // LOD only changes visibility, not sprite pixels. Count all LODs so fractional
  // zoom changes within a bucket do not re-prepare the complete population.
  const candidates = collectChromeCandidates(population, zoomBucket, layer, dpr, false);
  if (variants === undefined) {
    variants = new Map();
    preparedChrome.set(population, variants);
  }
  variants.set(key, candidates);
  if (variants.size > MAX_CHROME_VARIANTS) {
    const oldest = variants.keys().next().value;
    if (oldest !== undefined) variants.delete(oldest);
  }
  return candidates;
}

interface PaintRuntime {
  readonly zoom: number;
  readonly devicePixelRatio: number;
  readonly requestedLayer: SceneLayer | undefined;
  readonly chromeCache: RasterCache<CanvasRasterSurface> | undefined;
  readonly textCache: CanvasTextRasterCache | undefined;
  readonly chromeCandidates: ChromeCandidates;
  readonly worldViewport: SceneRect | undefined;
}

function normalizeDevicePixelRatio(value: number | undefined): number {
  const dpr = value ?? 1;
  if (!Number.isFinite(dpr) || dpr <= 0) {
    throw new Error('Canvas devicePixelRatio must be finite and positive');
  }
  return Math.min(dpr, 2);
}

function nextPowerOfTwo(value: number): number {
  const exponent = Math.ceil(Math.log2(value));
  const bucket = 2 ** exponent;
  if (!Number.isFinite(bucket) || bucket <= 0) {
    throw new RangeError('Canvas zoom bucket must be finite and positive');
  }
  return bucket;
}

function quantizeWorldSize(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  const bucket = Math.ceil(value / 8) * 8;
  return Number.isSafeInteger(bucket) && bucket > 0 ? bucket : undefined;
}

function quantizePixelSize(worldSize: number, zoomBucket: number, dpr: number): number | undefined {
  const pixels = Math.ceil(worldSize * zoomBucket * dpr);
  return Number.isSafeInteger(pixels) && pixels > 0 ? pixels : undefined;
}

function strokeBleed(style: ResolvedRectStyle): number {
  return style.stroke !== 'none' && Number.isFinite(style.strokeWidth) && style.strokeWidth > 0
    ? style.strokeWidth / 2
    : 0;
}

function resolvedRectStyle(item: SceneRectItem): ResolvedRectStyle {
  const radiusValue = item.radius ?? 0;
  const maxRadius = Math.max(0, Math.min(item.frame.width / 2, item.frame.height / 2));
  const radius = Number.isFinite(radiusValue) ? Math.max(0, Math.min(radiusValue, maxRadius)) : 0;
  return {
    fill: item.fill ?? 'none',
    fillOpacity: item.fillOpacity ?? 1,
    stroke: item.stroke ?? 'none',
    strokeOpacity: item.strokeOpacity ?? 1,
    strokeWidth: item.strokeWidth ?? 1,
    dash: [...(item.dash ?? [])],
    radius,
  };
}

function chromeSpriteSpec(
  item: SceneRectItem,
  zoomBucket: number,
  dpr: number,
): ChromeSpriteSpec | undefined {
  const shapeKind = item.chromeCacheKey;
  if (shapeKind === undefined || shapeKind.length === 0) {
    return undefined;
  }
  const width = quantizeWorldSize(item.frame.width);
  const height = quantizeWorldSize(item.frame.height);
  if (width === undefined || height === undefined) {
    return undefined;
  }
  const style = resolvedRectStyle(item);
  const bleed = strokeBleed(style);
  const spriteWidth = width + bleed * 2;
  const spriteHeight = height + bleed * 2;
  const allocatedPixelWidth = quantizePixelSize(spriteWidth, zoomBucket, dpr);
  const allocatedPixelHeight = quantizePixelSize(spriteHeight, zoomBucket, dpr);
  if (allocatedPixelWidth === undefined || allocatedPixelHeight === undefined) {
    return undefined;
  }
  const key = JSON.stringify({
    shapeKind,
    width,
    height,
    bleed,
    style,
    zoom: zoomBucket,
    dpr,
  });
  return {
    key,
    width,
    height,
    bleed,
    pixelWidth: allocatedPixelWidth,
    pixelHeight: allocatedPixelHeight,
    style,
  };
}

function traceRoundedRect(context: CanvasPaintContext, frame: SceneRect, radius: number): void {
  const resolvedRadius = Math.max(0, Math.min(radius, frame.width / 2, frame.height / 2));
  const right = frame.x + frame.width;
  const bottom = frame.y + frame.height;
  context.moveTo(frame.x + resolvedRadius, frame.y);
  context.lineTo(right - resolvedRadius, frame.y);
  context.quadraticCurveTo(right, frame.y, right, frame.y + resolvedRadius);
  context.lineTo(right, bottom - resolvedRadius);
  context.quadraticCurveTo(right, bottom, right - resolvedRadius, bottom);
  context.lineTo(frame.x + resolvedRadius, bottom);
  context.quadraticCurveTo(frame.x, bottom, frame.x, bottom - resolvedRadius);
  context.lineTo(frame.x, frame.y + resolvedRadius);
  context.quadraticCurveTo(frame.x, frame.y, frame.x + resolvedRadius, frame.y);
}

function tracePath(context: CanvasPaintContext, commands: readonly ScenePathCommand[]): void {
  for (const command of commands) {
    switch (command.type) {
      case 'move':
        context.moveTo(command.to.x, command.to.y);
        break;
      case 'line':
        context.lineTo(command.to.x, command.to.y);
        break;
      case 'quadratic':
        context.quadraticCurveTo(
          command.control.x,
          command.control.y,
          command.to.x,
          command.to.y,
        );
        break;
      case 'cubic':
        context.bezierCurveTo(
          command.control1.x,
          command.control1.y,
          command.control2.x,
          command.control2.y,
          command.to.x,
          command.to.y,
        );
        break;
      case 'close':
        context.closePath();
        break;
    }
  }
}

function paintTextUnderline(
  context: CanvasPaintContext,
  item: Extract<SceneItem, { readonly type: 'text' }>,
): number {
  if (item.underline !== true || item.value.length === 0) {
    return 0;
  }
  const measurement = context.measureText(item.value);
  const spacing = item.letterSpacing ?? 0;
  const width = measurement.width + spacing * Math.max(0, item.value.length - 1);
  if (!Number.isFinite(width) || width <= 0) {
    return 0;
  }
  const startX = item.anchor === 'middle'
    ? item.at.x - width / 2
    : item.anchor === 'end'
      ? item.at.x - width
      : item.at.x;
  const underlineY = item.at.y + Math.max(1, item.fontSize * 0.1);
  context.beginPath();
  context.strokeStyle = item.fill;
  context.lineWidth = Math.max(1, item.fontSize / 16);
  context.moveTo(startX, underlineY);
  context.lineTo(startX + width, underlineY);
  context.stroke();
  return 1;
}

function fillAndStroke(
  context: CanvasPaintContext,
  item: {
    readonly fill?: string;
    readonly fillOpacity?: number;
    readonly stroke?: string;
    readonly strokeOpacity?: number;
    readonly strokeWidth?: number;
    readonly dash?: readonly number[];
  },
  strokeWidthOverride?: number,
): number {
  const inheritedAlpha = context.globalAlpha;
  const strokeWidth = strokeWidthOverride ?? item.strokeWidth ?? 1;
  let drawCallCount = 0;
  if (item.fill !== undefined && item.fill !== 'none') {
    context.fillStyle = item.fill;
    context.globalAlpha = inheritedAlpha * (item.fillOpacity ?? 1);
    context.fill();
    drawCallCount += 1;
  }
  if (item.stroke !== undefined && item.stroke !== 'none' && strokeWidth > 0) {
    context.strokeStyle = item.stroke;
    context.lineWidth = strokeWidth;
    context.setLineDash([...(item.dash ?? [])]);
    context.globalAlpha = inheritedAlpha * (item.strokeOpacity ?? 1);
    context.stroke();
    drawCallCount += 1;
  }
  context.globalAlpha = inheritedAlpha;
  return drawCallCount;
}

function paintRect(context: CanvasPaintContext, item: SceneRectItem): number {
  context.beginPath();
  traceRoundedRect(context, item.frame, item.radius ?? 0);
  context.closePath();
  return fillAndStroke(context, item);
}

function renderChromeSurface(surface: CanvasRasterSurface, spec: ChromeSpriteSpec): void {
  const context = surface.context;
  context.save();
  try {
    context.globalAlpha = 1;
    context.clearRect(0, 0, surface.width, surface.height);
    context.scale(
      spec.pixelWidth / (spec.width + spec.bleed * 2),
      spec.pixelHeight / (spec.height + spec.bleed * 2),
    );
    context.beginPath();
    traceRoundedRect(
      context,
      { x: spec.bleed, y: spec.bleed, width: spec.width, height: spec.height },
      spec.style.radius,
    );
    context.closePath();
    fillAndStroke(context, spec.style);
  } finally {
    context.restore();
  }
}

function chromeDestinationRect(frame: SceneRect, spec: ChromeSpriteSpec): SceneRect {
  const widthScale = frame.width / spec.width;
  const heightScale = frame.height / spec.height;
  return {
    x: frame.x - spec.bleed * widthScale,
    y: frame.y - spec.bleed * heightScale,
    width: (spec.width + spec.bleed * 2) * widthScale,
    height: (spec.height + spec.bleed * 2) * heightScale,
  };
}

function markerDirection(
  commands: readonly ScenePathCommand[],
  position: 'start' | 'end',
):
  | { readonly from: ScenePoint; readonly to: ScenePoint }
  | undefined {
  if (position === 'start') {
    let previous: ScenePoint | undefined;
    for (const command of commands) {
      if (command.type === 'move') {
        previous = command.to;
        continue;
      }
      if (previous === undefined || command.type === 'close') {
        continue;
      }
      if (command.type === 'line') {
        return { from: command.to, to: previous };
      }
      if (command.type === 'quadratic') {
        return { from: command.control, to: previous };
      }
      return { from: command.control1, to: previous };
    }
    return undefined;
  }
  let previous: ScenePoint | undefined;
  let segment: { readonly from: ScenePoint; readonly to: ScenePoint } | undefined;
  for (const command of commands) {
    if (command.type === 'move') {
      previous = command.to;
    } else if (command.type === 'line') {
      if (previous !== undefined) {
        segment = { from: previous, to: command.to };
      }
      previous = command.to;
    } else if (command.type === 'quadratic') {
      segment = { from: command.control, to: command.to };
      previous = command.to;
    } else if (command.type === 'cubic') {
      segment = { from: command.control2, to: command.to };
      previous = command.to;
    }
  }
  return segment;
}

function paintMarker(
  context: CanvasPaintContext,
  item: ScenePathItem,
  position: 'start' | 'end',
  strokeWidthOverride?: number,
  markerSizeOverride?: number,
): number {
  const marker = position === 'start' ? item.markerStart : item.markerEnd;
  if (marker === undefined) {
    return 0;
  }
  const segment = markerDirection(item.commands, position);
  if (segment === undefined) {
    return 0;
  }
  const deltaX = segment.to.x - segment.from.x;
  const deltaY = segment.to.y - segment.from.y;
  const length = Math.hypot(deltaX, deltaY);
  if (length === 0) {
    return 0;
  }

  const unitX = deltaX / length;
  const unitY = deltaY / length;
  const markerLength =
    (markerSizeOverride ?? marker.size) *
    (strokeWidthOverride ?? item.strokeWidth ?? 1);
  const halfWidth = markerLength * 0.5;
  const baseX = segment.to.x - unitX * markerLength;
  const baseY = segment.to.y - unitY * markerLength;
  const perpendicularX = -unitY;
  const perpendicularY = unitX;
  const inheritedAlpha = context.globalAlpha;

  context.fillStyle = marker.fill;
  context.strokeStyle = marker.fill;
  context.lineWidth = Math.max(strokeWidthOverride ?? item.strokeWidth ?? 1, markerLength * 0.12);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.globalAlpha = inheritedAlpha * (item.strokeOpacity ?? 1);
  context.beginPath();
  if (marker.type === 'circle') {
    context.arc(
      segment.to.x - unitX * markerLength * 0.42,
      segment.to.y - unitY * markerLength * 0.42,
      markerLength * 0.34,
      0,
      Math.PI * 2,
    );
    context.fill();
  } else if (marker.type === 'bar') {
    const centerX = segment.to.x - unitX * markerLength * 0.12;
    const centerY = segment.to.y - unitY * markerLength * 0.12;
    context.moveTo(centerX + perpendicularX * halfWidth * 0.72, centerY + perpendicularY * halfWidth * 0.72);
    context.lineTo(centerX - perpendicularX * halfWidth * 0.72, centerY - perpendicularY * halfWidth * 0.72);
    context.stroke();
  } else if (marker.type === 'crow-foot') {
    context.moveTo(baseX, baseY);
    context.lineTo(segment.to.x, segment.to.y);
    context.moveTo(baseX, baseY);
    context.lineTo(
      segment.to.x + perpendicularX * halfWidth,
      segment.to.y + perpendicularY * halfWidth,
    );
    context.moveTo(baseX, baseY);
    context.lineTo(
      segment.to.x - perpendicularX * halfWidth,
      segment.to.y - perpendicularY * halfWidth,
    );
    context.stroke();
  } else if (marker.type === 'open-arrow') {
    context.moveTo(baseX + perpendicularX * halfWidth, baseY + perpendicularY * halfWidth);
    context.lineTo(segment.to.x, segment.to.y);
    context.lineTo(baseX - perpendicularX * halfWidth, baseY - perpendicularY * halfWidth);
    context.stroke();
  } else if (marker.type === 'diamond') {
    const middleX = segment.to.x - unitX * markerLength * 0.5;
    const middleY = segment.to.y - unitY * markerLength * 0.5;
    context.moveTo(segment.to.x, segment.to.y);
    context.lineTo(middleX + perpendicularX * halfWidth, middleY + perpendicularY * halfWidth);
    context.lineTo(baseX, baseY);
    context.lineTo(middleX - perpendicularX * halfWidth, middleY - perpendicularY * halfWidth);
    context.closePath();
    context.fill();
  } else {
    context.moveTo(segment.to.x, segment.to.y);
    context.lineTo(baseX + perpendicularX * halfWidth, baseY + perpendicularY * halfWidth);
    context.lineTo(baseX - perpendicularX * halfWidth, baseY - perpendicularY * halfWidth);
    context.closePath();
    context.fill();
  }
  context.globalAlpha = inheritedAlpha;
  return 1;
}

function paintDotGrid(
  context: CanvasPaintContext,
  item: Extract<SceneItem, { type: 'dot-grid' }>,
  viewport: SceneRect | undefined,
): number {
  const inheritedAlpha = context.globalAlpha;
  if (!Number.isFinite(item.step) || item.step <= 0) return 0;
  const originX = item.frame.x + item.offset.x;
  const originY = item.frame.y + item.offset.y;
  const left = viewport === undefined ? originX : Math.max(originX, viewport.x - item.radius);
  const top = viewport === undefined ? originY : Math.max(originY, viewport.y - item.radius);
  const right = Math.min(item.frame.x + item.frame.width,
    viewport === undefined ? Infinity : viewport.x + viewport.width + item.radius);
  const bottom = Math.min(item.frame.y + item.frame.height,
    viewport === undefined ? Infinity : viewport.y + viewport.height + item.radius);
  const startX = originX + Math.max(0, Math.ceil((left - originX) / item.step)) * item.step;
  const startY = originY + Math.max(0, Math.ceil((top - originY) / item.step)) * item.step;
  context.fillStyle = item.fill;
  context.globalAlpha = inheritedAlpha * item.fillOpacity;
  let drawCallCount = 0;
  for (let x = startX; x <= right; x += item.step) {
    for (let y = startY; y <= bottom; y += item.step) {
      context.beginPath();
      context.arc(x, y, item.radius, 0, Math.PI * 2);
      context.fill();
      drawCallCount += 1;
    }
  }
  context.globalAlpha = inheritedAlpha;
  return drawCallCount;
}

function collectChromeCandidates(
  items: readonly SceneItem[],
  zoom: number,
  requestedLayer: SceneLayer | undefined,
  dpr: number,
  respectLod = true,
): ChromeCandidates {
  const specs = new Map<SceneRectItem, ChromeSpriteSpec>();
  const counts = new Map<string, number>();
  const zoomBucket = nextPowerOfTwo(zoom);

  const visit = (item: SceneItem, inheritedLayer: SceneLayer): void => {
    if (respectLod && item.minZoom !== undefined && item.minZoom > zoom) {
      return;
    }

    const effectiveLayer = item.layer ?? inheritedLayer;
    if (item.type === 'group') {
      for (const child of item.children) {
        visit(child, effectiveLayer);
      }
      return;
    }
    if (requestedLayer !== undefined && effectiveLayer !== requestedLayer) {
      return;
    }
    if (item.type !== 'rect') {
      return;
    }

    const spec = chromeSpriteSpec(item, zoomBucket, dpr);
    if (spec === undefined) {
      return;
    }
    specs.set(item, spec);
    counts.set(spec.key, (counts.get(spec.key) ?? 0) + 1);
  };

  for (const item of items) {
    visit(item, 'main');
  }
  return { specs, counts };
}

function traceClipItem(context: CanvasPaintContext, item: SceneClipItem): void {
  switch (item.type) {
    case 'rect':
      traceRoundedRect(context, item.frame, item.radius ?? 0);
      return;
    case 'circle':
      context.moveTo(item.center.x + item.radius, item.center.y);
      context.arc(item.center.x, item.center.y, item.radius, 0, Math.PI * 2);
      return;
    case 'ellipse':
      context.moveTo(item.center.x + item.radiusX, item.center.y);
      context.ellipse(
        item.center.x,
        item.center.y,
        item.radiusX,
        item.radiusY,
        0,
        0,
        Math.PI * 2,
      );
      return;
    case 'polygon': {
      const first = item.points[0];
      if (first === undefined) {
        return;
      }
      context.moveTo(first.x, first.y);
      for (const point of item.points.slice(1)) {
        context.lineTo(point.x, point.y);
      }
      context.closePath();
      return;
    }
    case 'path':
      tracePath(context, item.commands);
      return;
  }
}

function paintItem(
  context: CanvasPaintContext,
  item: SceneItem,
  runtime: PaintRuntime,
  inheritedLayer: SceneLayer,
): number {
  if (item.minZoom !== undefined && item.minZoom > runtime.zoom) {
    return 0;
  }

  const effectiveLayer = item.layer ?? inheritedLayer;
  if (
    item.type !== 'group' &&
    runtime.requestedLayer !== undefined &&
    effectiveLayer !== runtime.requestedLayer
  ) {
    return 0;
  }

  context.save();
  context.globalAlpha *= item.opacity ?? 1;
  let drawCallCount = 0;

  switch (item.type) {
    case 'group':
      if (item.transform !== undefined && item.transform.rotation !== 0) {
        context.translate(item.transform.origin.x, item.transform.origin.y);
        context.rotate((item.transform.rotation * Math.PI) / 180);
        context.translate(-item.transform.origin.x, -item.transform.origin.y);
      }
      if (item.clip !== undefined) {
        context.beginPath();
        for (const clipItem of item.clip.items) {
          traceClipItem(context, clipItem);
        }
        context.clip();
      }
      for (const child of item.children) {
        drawCallCount += paintItem(context, child,
          item.transform !== undefined && item.transform.rotation !== 0
            ? { ...runtime, worldViewport: undefined } : runtime,
          effectiveLayer);
      }
      break;
    case 'rect': {
      const spec = runtime.chromeCandidates.specs.get(item);
      const count = spec === undefined ? 0 : runtime.chromeCandidates.counts.get(spec.key) ?? 0;
      if (runtime.chromeCache !== undefined && spec !== undefined && count >= 2) {
        const surface = runtime.chromeCache.getOrCreate(
          spec.key,
          spec.pixelWidth,
          spec.pixelHeight,
          (cachedSurface) => renderChromeSurface(cachedSurface, spec),
        );
        surface.blit(context, chromeDestinationRect(item.frame, spec));
        drawCallCount += 1;
      } else {
        drawCallCount += paintRect(context, item);
      }
      break;
    }
    case 'circle':
      context.beginPath();
      context.arc(item.center.x, item.center.y, item.radius, 0, Math.PI * 2);
      drawCallCount += fillAndStroke(context, item);
      break;
    case 'ellipse':
      context.beginPath();
      context.ellipse(
        item.center.x,
        item.center.y,
        item.radiusX,
        item.radiusY,
        0,
        0,
        Math.PI * 2,
      );
      drawCallCount += fillAndStroke(context, item);
      break;
    case 'polygon': {
      const first = item.points[0];
      if (first !== undefined) {
        context.beginPath();
        context.moveTo(first.x, first.y);
        for (const point of item.points.slice(1)) {
          context.lineTo(point.x, point.y);
        }
        context.closePath();
        drawCallCount += fillAndStroke(context, item);
      }
      break;
    }
    case 'path': {
      const isMinimalDetail = runtime.zoom < 0.15 && item.lowZoomStrokeWidth !== undefined;
      const strokeWidth = isMinimalDetail
        ? item.lowZoomStrokeWidth / runtime.zoom
        : item.strokeWidth;
      context.beginPath();
      tracePath(context, item.commands);
      context.lineCap = item.lineCap ?? 'butt';
      context.lineJoin = item.lineJoin ?? 'miter';
      drawCallCount += fillAndStroke(context, item, strokeWidth);
      drawCallCount += paintMarker(
        context,
        item,
        'start',
        strokeWidth,
        isMinimalDetail ? Math.min(item.markerStart?.size ?? 4, 4) : undefined,
      );
      drawCallCount += paintMarker(
        context,
        item,
        'end',
        strokeWidth,
        isMinimalDetail ? Math.min(item.markerEnd?.size ?? 4, 4) : undefined,
      );
      break;
    }
    case 'text':
      if (runtime.textCache === undefined) {
        context.fillStyle = item.fill;
        context.font = `${item.fontStyle ?? 'normal'} ${item.fontWeight ?? 400} ${item.fontSize}px ${item.fontFamily}`;
        context.textAlign = item.anchor === 'middle' ? 'center' : (item.anchor ?? 'start');
        context.textBaseline = 'alphabetic';
        if ('letterSpacing' in context) context.letterSpacing = `${item.letterSpacing ?? 0}px`;
        context.fillText(item.value, item.at.x, item.at.y);
        drawCallCount += paintTextUnderline(context, item);
      } else {
        runtime.textCache.paintText(context, item, runtime.zoom, runtime.devicePixelRatio);
      }
      drawCallCount += 1;
      break;
    case 'dot-grid':
      drawCallCount += paintDotGrid(context, item, runtime.worldViewport);
      break;
  }

  context.restore();
  return drawCallCount;
}

export function paintSceneItemsToCanvas(
  items: readonly SceneItem[],
  context: CanvasPaintContext,
  options: CanvasPaintOptions = {},
): CanvasPaintStats {
  const zoom = options.zoom ?? 1;
  if (!Number.isFinite(zoom) || zoom <= 0) {
    throw new Error('Canvas paint zoom must be finite and positive');
  }
  const devicePixelRatio = normalizeDevicePixelRatio(options.devicePixelRatio);
  const chromeCandidates = options.chromeCache === undefined
    ? EMPTY_CHROME
    : options.chromePopulation === undefined
      ? collectChromeCandidates(items, zoom, options.layer, devicePixelRatio)
      : preparedChromeCandidates(options.chromePopulation, zoom, options.layer, devicePixelRatio);
  const runtime: PaintRuntime = {
    zoom,
    devicePixelRatio,
    requestedLayer: options.layer,
    chromeCache: options.chromeCache,
    textCache: options.textCache,
    chromeCandidates,
    worldViewport: options.worldViewport,
  };
  let drawCallCount = 0;
  for (const item of items) {
    drawCallCount += paintItem(context, item, runtime, 'main');
  }
  return { drawCallCount };
}

export function paintSceneToCanvas(
  scene: SceneDescription,
  context: CanvasPaintContext,
  options: CanvasPaintOptions = {},
): CanvasPaintStats {
  return paintSceneItemsToCanvas(scene.items, context, options);
}

export function paintSceneLayerToCanvas(
  scene: SceneDescription,
  layer: SceneLayer,
  context: CanvasPaintContext,
  optionsWithoutLayer: Omit<CanvasPaintOptions, 'layer'> = {},
): CanvasPaintStats {
  return paintSceneToCanvas(scene, context, { ...optionsWithoutLayer, layer });
}
