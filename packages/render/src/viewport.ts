import RBush from 'rbush';
import { boundsForItem, boundsForRect } from '@openchart/scene';
import type { BBox } from 'rbush';
import type {
  SceneDescription,
  SceneGroup,
  SceneItem,
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

  public constructor(scene: SceneDescription) {
    const artboard = scene.items.find(isArtboard);
    if (artboard === undefined) {
      throw new Error('Scene description must contain an artboard group');
    }
    this.artboard = artboard;

    const indexed: IndexedGroup[] = [];
    artboard.children.forEach((item, paintIndex) => {
      if (!isCullingGroup(item)) {
        return;
      }
      const derived = boundsForItem(item) ?? boundsForRect(scene.bounds, 0);
      if (derived === undefined) {
        throw new Error(`Unable to derive bounds for scene group ${JSON.stringify(item.id)}`);
      }
      indexed.push({ ...derived, group: item, paintIndex });
    });

    this.indexedItems = Object.freeze(indexed);
    this.index = new RBush<IndexedGroup>();
    this.index.load(this.indexedItems);
  }

  public get totalIndexedGroups(): number {
    return this.indexedItems.length;
  }

  public query(worldRect: SceneRect): readonly SceneGroup[] {
    const matches = this.index.search(worldRectToBBox(worldRect));
    matches.sort(comparePaintOrder);
    return matches.map((entry) => entry.group);
  }

  public paint(
    context: CanvasPaintContext,
    camera: CameraState,
    options: ViewportPaintOptions = {},
  ): ViewportPaintStats {
    validateCamera(camera);
    const visible = this.query(
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
    const visibleSet = new Set(visible);
    const paintItems: SceneItem[] = [];
    const visibleEntityIds: string[] = [];
    for (const item of this.artboard.children) {
      if (!isCullingGroup(item) || visibleSet.has(item)) {
        paintItems.push(item);
      }
    }
    for (const group of visible) {
      if (group.entityId !== undefined) {
        visibleEntityIds.push(group.entityId);
      }
    }

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
        canvasPaintOptions(camera, options, [this.artboard]),
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

    const visibleSet = new Set<SceneGroup>();
    for (const rect of remainingRects) {
      for (const group of this.query(expandQueryForScreenBleed(rect, camera.zoom))) {
        visibleSet.add(group);
      }
    }

    const paintItems: SceneItem[] = [];
    const visibleEntityIds: string[] = [];
    for (const item of this.artboard.children) {
      if (!isCullingGroup(item)) {
        paintItems.push(item);
      } else if (visibleSet.has(item)) {
        paintItems.push(item);
        if (item.entityId !== undefined) {
          visibleEntityIds.push(item.entityId);
        }
      }
    }

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
        canvasPaintOptions(camera, options, [this.artboard]),
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
