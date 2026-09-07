import type { SceneGroup, SceneItem, ScenePathCommand, SceneRect } from './index.js';

interface Bounds { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number; }
function finite(value: number): boolean { return Number.isFinite(value); }
function positiveFinite(value: number): boolean { return finite(value) && value > 0; }

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

export function boundsForRect(frame: SceneRect, margin: number): Bounds | undefined {
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

export function boundsForItem(item: SceneItem): Bounds | undefined {
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

export function sceneItemsBounds(items: readonly SceneItem[]): SceneRect | undefined {
  let bounds: Bounds | undefined;
  for (const item of items) bounds = union(bounds, boundsForItem(item));
  return bounds === undefined ? undefined : {
    x: bounds.minX, y: bounds.minY,
    width: Math.max(1, bounds.maxX - bounds.minX), height: Math.max(1, bounds.maxY - bounds.minY),
  };
}
