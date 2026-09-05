import RBush from 'rbush';
import type { BBox } from 'rbush';
import type {
  SceneDescription,
  SceneGroup,
  SceneItem,
  ScenePathCommand,
  SceneRect,
  SceneLayer,
} from '@openchart/scene';

import {
  paintSceneItemsToCanvas,
  type CanvasPaintContext,
  type CanvasPaintOptions,
  type CanvasRasterSurface,
} from './canvas.js';
import { coalesceDirtyRects, type DirtyRectOptions } from './dirty-rects.js';
import type { RasterCache } from './raster-cache.js';
import type { CanvasTextRasterCache } from './text-raster-cache.js';

export interface CameraState {
  /** World-space x coordinate at the viewport's left edge. */
  readonly x: number;
  /** World-space y coordinate at the viewport's top edge. */
  readonly y: number;
  readonly zoom: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

export interface ViewportPaintStats {
  readonly totalIndexedGroups: number;
  readonly visibleIndexedGroups: number;
  readonly paintedTopLevelItems: number;
  readonly drawCallCount: number;
  readonly visibleEntityIds: readonly string[];
}

export interface ViewportPaintOptions {
  readonly layer?: SceneLayer;
  readonly chromeCache?: RasterCache<CanvasRasterSurface>;
  readonly textCache?: CanvasTextRasterCache;
  readonly devicePixelRatio?: number;
}

export interface DirtyViewportPaintOptions extends ViewportPaintOptions, DirtyRectOptions {}

export interface DirtyViewportPaintStats extends ViewportPaintStats {
  readonly dirtyRectCount: number;
}

function canvasPaintOptions(
  camera: CameraState,
  options: ViewportPaintOptions,
  chromePopulation?: readonly SceneItem[],
): CanvasPaintOptions {
  return {
    zoom: camera.zoom,
    worldViewport: { x: camera.x, y: camera.y,
      width: camera.viewportWidth / camera.zoom, height: camera.viewportHeight / camera.zoom },
    ...(options.layer === undefined ? {} : { layer: options.layer }),
    ...(options.chromeCache === undefined ? {} : { chromeCache: options.chromeCache }),
    ...(options.textCache === undefined ? {} : { textCache: options.textCache }),
    ...(options.devicePixelRatio === undefined ? {} : { devicePixelRatio: options.devicePixelRatio }),
    ...(chromePopulation === undefined ? {} : { chromePopulation }),
  };
}

type Bounds = BBox;

interface IndexedGroup extends Bounds {
  readonly group: SceneGroup;
  readonly paintIndex: number;
}

const CULLABLE_ROLES = new Set<SceneGroup['role']>([
  'zone',
  'container',
  'group',
  'edge',
  'node',
  'shape',
]);
const MINIMAL_MARKER_SCREEN_BLEED = 4;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function positiveFinite(value: number): boolean {
  return finite(value) && value > 0;
}

function strokePadding(item: {
  readonly stroke?: string;
  readonly strokeWidth?: number;
}): number {
  if (item.stroke === undefined || item.stroke === 'none') {
    return 0;
  }
  const width = item.strokeWidth ?? 1;
  return positiveFinite(width) ? width / 2 : 0;
}

function normalizeBounds(x1: number, y1: number, x2: number, y2: number): Bounds | undefined {
  if (![x1, y1, x2, y2].every(finite)) {
    return undefined;
  }
  return {
    minX: Math.min(x1, x2),
    minY: Math.min(y1, y2),
    maxX: Math.max(x1, x2),
    maxY: Math.max(y1, y2),
  };
}

function expand(bounds: Bounds, margin: number): Bounds {
  const padding = finite(margin) && margin > 0 ? margin : 0;
  return {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding,
  };
}

function union(left: Bounds | undefined, right: Bounds | undefined): Bounds | undefined {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY),
  };
}

function pointBounds(x: number, y: number): Bounds | undefined {
  return normalizeBounds(x, y, x, y);
}

function boundsForRect(frame: SceneRect, margin: number): Bounds | undefined {
  const bounds = normalizeBounds(
    frame.x,
    frame.y,
    frame.x + frame.width,
    frame.y + frame.height,
  );
  return bounds === undefined ? undefined : expand(bounds, margin);
}

function pathPoint(command: ScenePathCommand): readonly { readonly x: number; readonly y: number }[] {
  switch (command.type) {
    case 'move':
    case 'line':
      return [command.to];
    case 'quadratic':
      return [command.control, command.to];
    case 'cubic':
      return [command.control1, command.control2, command.to];
    case 'close':
      return [];
  }
}

function intersect(left: Bounds, right: Bounds): Bounds | undefined {
  const minX = Math.max(left.minX, right.minX);
  const minY = Math.max(left.minY, right.minY);
  const maxX = Math.min(left.maxX, right.maxX);
  const maxY = Math.min(left.maxY, right.maxY);
  return minX > maxX || minY > maxY
    ? undefined
    : { minX, minY, maxX, maxY };
}

function transformBounds(
  bounds: Bounds,
  transform: NonNullable<SceneGroup['transform']>,
): Bounds | undefined {
  if (
    !finite(transform.rotation) ||
    !finite(transform.origin.x) ||
    !finite(transform.origin.y)
  ) {
    return undefined;
  }
  if (transform.rotation === 0) {
    return bounds;
  }
  const radians = (transform.rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  let transformed: Bounds | undefined;
  for (const point of [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ]) {
    const offsetX = point.x - transform.origin.x;
    const offsetY = point.y - transform.origin.y;
    transformed = union(
      transformed,
      pointBounds(
        transform.origin.x + offsetX * cosine - offsetY * sine,
        transform.origin.y + offsetX * sine + offsetY * cosine,
      ),
    );
  }
  return transformed;
}

function boundsForPath(
  commands: readonly ScenePathCommand[],
  strokeWidth: number | undefined,
  markerSize: number | undefined,
): Bounds | undefined {
  let bounds: Bounds | undefined;
  for (const command of commands) {
    for (const point of pathPoint(command)) {
      bounds = union(bounds, pointBounds(point.x, point.y));
    }
  }
  if (bounds === undefined) {
    return undefined;
  }

  const strokeMargin = positiveFinite(strokeWidth ?? 0) ? (strokeWidth ?? 0) / 2 : 0;
  // Canvas markers are sized in multiples of the stroke width. Expanding the
  // entire path by that length is intentionally conservative at the endpoint.
  const markerMargin = positiveFinite(markerSize ?? 0)
    ? (markerSize ?? 0) * Math.max(1, strokeWidth ?? 1)
    : 0;
  return expand(bounds, Math.max(strokeMargin, markerMargin));
}

function estimateTextBounds(item: Extract<SceneItem, { type: 'text' }>): Bounds | undefined {
  if (!finite(item.at.x) || !finite(item.at.y)) {
    return undefined;
  }
  const fontSize = positiveFinite(item.fontSize) ? item.fontSize : 12;
  const letterSpacing = finite(item.letterSpacing ?? 0) ? item.letterSpacing ?? 0 : 0;
  const characterCount = item.value.length;
  const width = Math.max(
    fontSize,
    characterCount * fontSize + Math.max(0, characterCount - 1) * Math.abs(letterSpacing),
  );
  let minX = item.at.x;
  let maxX = item.at.x + width;
  if (item.anchor === 'middle') {
    minX = item.at.x - width / 2;
    maxX = item.at.x + width / 2;
  } else if (item.anchor === 'end') {
    minX = item.at.x - width;
    maxX = item.at.x;
  }
  // Canvas text uses an alphabetic baseline. The generous lower margin keeps
  // descenders and font substitution from becoming false-negative culls.
  return normalizeBounds(minX, item.at.y - fontSize * 1.2, maxX, item.at.y + fontSize * 0.35);
}

function boundsForItem(item: SceneItem): Bounds | undefined {
  switch (item.type) {
    case 'group': {
      let bounds: Bounds | undefined;
      for (const child of item.children) {
        bounds = union(bounds, boundsForItem(child));
      }
      if (bounds !== undefined && item.clip !== undefined) {
        let clipBounds: Bounds | undefined;
        for (const clipItem of item.clip.items) {
          clipBounds = union(clipBounds, boundsForItem(clipItem));
        }
        if (clipBounds !== undefined) {
          bounds = intersect(bounds, clipBounds);
        }
      }
      if (bounds !== undefined && item.transform !== undefined) {
        bounds = transformBounds(bounds, item.transform);
      }
      return bounds;
    }
    case 'rect':
      return boundsForRect(item.frame, strokePadding(item));
    case 'dot-grid': {
      const radius = positiveFinite(item.radius) ? item.radius : 0;
      return boundsForRect(item.frame, radius);
    }
    case 'circle': {
      const margin = strokePadding(item);
      const radius = Math.max(0, item.radius) + margin;
      return normalizeBounds(
        item.center.x - radius,
        item.center.y - radius,
        item.center.x + radius,
        item.center.y + radius,
      );
    }
    case 'ellipse': {
      const margin = strokePadding(item);
      const radiusX = Math.max(0, item.radiusX) + margin;
      const radiusY = Math.max(0, item.radiusY) + margin;
      return normalizeBounds(
        item.center.x - radiusX,
        item.center.y - radiusY,
        item.center.x + radiusX,
        item.center.y + radiusY,
      );
    }
    case 'polygon': {
      let bounds: Bounds | undefined;
      for (const point of item.points) {
        bounds = union(bounds, pointBounds(point.x, point.y));
      }
      return bounds === undefined
        ? undefined
        : expand(bounds, strokePadding(item));
    }
    case 'path':
      return boundsForPath(
        item.commands,
        strokePadding(item) * 2,
        Math.max(item.markerStart?.size ?? 0, item.markerEnd?.size ?? 0) || undefined,
      );
    case 'text':
      return estimateTextBounds(item);
  }
}

function worldRectToBBox(rect: SceneRect): Bounds {
  if (![rect.x, rect.y, rect.width, rect.height].every(finite)) {
    throw new Error('World query rectangle must contain finite coordinates and dimensions');
  }
  if (rect.width < 0 || rect.height < 0) {
    throw new Error('World query rectangle dimensions must be non-negative');
  }
  const maxX = rect.x + rect.width;
  const maxY = rect.y + rect.height;
  if (!finite(maxX) || !finite(maxY)) {
    throw new Error('World query rectangle extents must be finite');
  }
  return {
    minX: rect.x,
    minY: rect.y,
    maxX,
    maxY,
  };
}

function validateCamera(camera: CameraState): void {
  if (![camera.x, camera.y, camera.zoom, camera.viewportWidth, camera.viewportHeight].every(finite)) {
    throw new Error('Camera values must be finite');
  }
  if (camera.zoom <= 0) {
    throw new Error('Camera zoom must be positive');
  }
  if (camera.viewportWidth <= 0 || camera.viewportHeight <= 0) {
    throw new Error('Camera viewport dimensions must be positive');
  }
}

function isCullingGroup(item: SceneItem): item is SceneGroup {
  return item.type === 'group' && CULLABLE_ROLES.has(item.role);
}

function isArtboard(item: SceneItem): item is SceneGroup {
  return item.type === 'group' && item.role === 'artboard';
}

function comparePaintOrder(left: IndexedGroup, right: IndexedGroup): number {
  return left.paintIndex - right.paintIndex;
}

function intersectRects(first: SceneRect, second: SceneRect): SceneRect | undefined {
  const left = Math.max(first.x, second.x);
  const top = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  if (!(right > left) || !(bottom > top)) {
    return undefined;
  }
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function worldToScreenRect(rect: SceneRect, camera: CameraState): SceneRect {
  return {
    x: (rect.x - camera.x) * camera.zoom,
    y: (rect.y - camera.y) * camera.zoom,
    width: rect.width * camera.zoom,
    height: rect.height * camera.zoom,
  };
}

function alignToDevicePixels(rect: SceneRect, devicePixelRatio: number | undefined): SceneRect {
  const dpr = Math.min(devicePixelRatio ?? 1, 2);
  if (!positiveFinite(dpr)) {
    throw new Error('Canvas devicePixelRatio must be finite and positive');
  }
  const left = Math.floor(rect.x * dpr) / dpr;
  const top = Math.floor(rect.y * dpr) / dpr;
  const right = Math.ceil((rect.x + rect.width) * dpr) / dpr;
  const bottom = Math.ceil((rect.y + rect.height) * dpr) / dpr;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function expandQueryForScreenBleed(rect: SceneRect, zoom: number): SceneRect {
  if (zoom >= 0.15) {
    return rect;
  }
  const margin = MINIMAL_MARKER_SCREEN_BLEED / zoom;
  return {
    x: rect.x - margin,
    y: rect.y - margin,
    width: rect.width + margin * 2,
    height: rect.height + margin * 2,
  };
}

export class SceneViewportRenderer {
  private readonly artboard: SceneGroup;
  private readonly indexedItems: readonly IndexedGroup[];
  private readonly index: RBush<IndexedGroup>;
  private readonly uncullable: readonly { readonly item: SceneItem; readonly paintIndex: number }[];
  private readonly chromePopulation: readonly SceneItem[];

  public constructor(scene: SceneDescription) {
    const artboard = scene.items.find(isArtboard);
    if (artboard === undefined) {
      throw new Error('Scene description must contain an artboard group');
    }
    this.artboard = artboard;
    this.chromePopulation = [artboard];
    const uncullable: { item: SceneItem; paintIndex: number }[] = [];

    const indexed: IndexedGroup[] = [];
    artboard.children.forEach((item, paintIndex) => {
      if (!isCullingGroup(item)) {
        uncullable.push({ item, paintIndex });
        return;
      }
      const derived = boundsForItem(item) ?? boundsForRect(scene.bounds, 0);
      if (derived === undefined) {
        throw new Error(`Unable to derive bounds for scene group ${JSON.stringify(item.id)}`);
      }
      indexed.push({ ...derived, group: item, paintIndex });
    });

    this.uncullable = uncullable;
    this.indexedItems = Object.freeze(indexed);
    this.index = new RBush<IndexedGroup>();
    this.index.load(this.indexedItems);
  }

  public get totalIndexedGroups(): number {
    return this.indexedItems.length;
  }

  public query(worldRect: SceneRect): readonly SceneGroup[] {
    return this.queryEntries(worldRect).map((entry) => entry.group);
  }

  private queryEntries(worldRect: SceneRect): IndexedGroup[] {
    return this.index.search(worldRectToBBox(worldRect)).sort(comparePaintOrder);
  }

  /** Merge only visible entries with fixed backgrounds/overlays; never rescan the scene. */
  private paintItems(visible: readonly IndexedGroup[]): SceneItem[] {
    const items: SceneItem[] = [];
    let fixedIndex = 0;
    for (const entry of visible) {
      while (fixedIndex < this.uncullable.length) {
        const fixed = this.uncullable[fixedIndex];
        if (fixed === undefined || fixed.paintIndex > entry.paintIndex) break;
        items.push(fixed.item);
        fixedIndex += 1;
      }
      items.push(entry.group);
    }
    for (; fixedIndex < this.uncullable.length; fixedIndex += 1) {
      const fixed = this.uncullable[fixedIndex];
      if (fixed !== undefined) items.push(fixed.item);
    }
    return items;
  }

  public paint(
    context: CanvasPaintContext,
    camera: CameraState,
    options: ViewportPaintOptions = {},
  ): ViewportPaintStats {
    validateCamera(camera);
    const visible = this.queryEntries(
      expandQueryForScreenBleed(
        {
          x: camera.x,
          y: camera.y,
          width: camera.viewportWidth / camera.zoom,
          height: camera.viewportHeight / camera.zoom,
        },
        camera.zoom,
      ),
    );
    const paintItems = this.paintItems(visible);
    const visibleEntityIds = visible.flatMap(({ group }) =>
      group.entityId === undefined ? [] : [group.entityId]);

    // Clear in screen coordinates before changing the transform.
    context.clearRect(0, 0, camera.viewportWidth, camera.viewportHeight);
    let drawCallCount: number;
    context.save();
    try {
      context.scale(camera.zoom, camera.zoom);
      context.translate(-camera.x, -camera.y);
      drawCallCount = paintSceneItemsToCanvas(
        [{ ...this.artboard, children: paintItems }],
        context,
        canvasPaintOptions(camera, options, this.chromePopulation),
      ).drawCallCount;
    } finally {
      context.restore();
    }

    return {
      totalIndexedGroups: this.totalIndexedGroups,
      visibleIndexedGroups: visible.length,
      paintedTopLevelItems: paintItems.length,
      drawCallCount,
      visibleEntityIds,
    };
  }

  public paintDirty(
    context: CanvasPaintContext,
    camera: CameraState,
    dirtyRects: readonly SceneRect[],
    options: DirtyViewportPaintOptions = {},
  ): DirtyViewportPaintStats {
    validateCamera(camera);
    const cameraWorldRect: SceneRect = {
      x: camera.x,
      y: camera.y,
      width: camera.viewportWidth / camera.zoom,
      height: camera.viewportHeight / camera.zoom,
    };
    const remainingRects = coalesceDirtyRects(dirtyRects, options)
      .map((rect) => intersectRects(rect, cameraWorldRect))
      .filter((rect): rect is SceneRect => rect !== undefined);

    if (remainingRects.length === 0) {
      return {
        totalIndexedGroups: this.totalIndexedGroups,
        visibleIndexedGroups: 0,
        paintedTopLevelItems: 0,
        drawCallCount: 0,
        visibleEntityIds: [],
        dirtyRectCount: 0,
      };
    }

    const visibleSet = new Set<IndexedGroup>();
    for (const rect of remainingRects) {
      for (const entry of this.queryEntries(expandQueryForScreenBleed(rect, camera.zoom))) {
        visibleSet.add(entry);
      }
    }
    const visible = [...visibleSet].sort(comparePaintOrder);
    const paintItems = this.paintItems(visible);
    const visibleEntityIds = visible.flatMap(({ group }) =>
      group.entityId === undefined ? [] : [group.entityId]);

    const screenRects = remainingRects.map((rect) =>
      alignToDevicePixels(worldToScreenRect(rect, camera), options.devicePixelRatio),
    );
    let drawCallCount: number;
    context.save();
    try {
      context.beginPath();
      for (const rect of screenRects) {
        context.rect(rect.x, rect.y, rect.width, rect.height);
      }
      context.clip();
      for (const rect of screenRects) {
        context.clearRect(rect.x, rect.y, rect.width, rect.height);
      }
      context.scale(camera.zoom, camera.zoom);
      context.translate(-camera.x, -camera.y);
      drawCallCount = paintSceneItemsToCanvas(
        [{ ...this.artboard, children: paintItems }],
        context,
        canvasPaintOptions(camera, options, this.chromePopulation),
      ).drawCallCount;
    } finally {
      context.restore();
    }

    return {
      totalIndexedGroups: this.totalIndexedGroups,
      visibleIndexedGroups: visibleSet.size,
      paintedTopLevelItems: paintItems.length,
      drawCallCount,
      visibleEntityIds,
      dirtyRectCount: remainingRects.length,
    };
  }
}
