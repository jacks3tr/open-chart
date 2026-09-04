import type { SceneRect } from '@openchart/scene';

export interface DirtyRectOptions {
  readonly routingMargin?: number;
  readonly shadowBleed?: number;
}

type MutableSceneRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function assertFinite(value: unknown, label: string): asserts value is number {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
  }
}

function assertNonNegative(value: number, label: string): void {
  if (value < 0) {
    throw new RangeError(`${label} must be non-negative.`);
  }
}

function validateRect(rect: SceneRect, label: string): void {
  const x = rect?.x;
  const y = rect?.y;
  const width = rect?.width;
  const height = rect?.height;

  assertFinite(x, `${label} x`);
  assertFinite(y, `${label} y`);
  assertFinite(width, `${label} width`);
  assertFinite(height, `${label} height`);
  assertNonNegative(width, `${label} width`);
  assertNonNegative(height, `${label} height`);
  assertFinite(x + width, `${label} right edge`);
  assertFinite(y + height, `${label} bottom edge`);
}

function unionRects(first: MutableSceneRect, second: MutableSceneRect): MutableSceneRect {
  const left = Math.min(first.x, second.x);
  const top = Math.min(first.y, second.y);
  const right = Math.max(first.x + first.width, second.x + second.width);
  const bottom = Math.max(first.y + first.height, second.y + second.height);

  const result = {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
  validateRect(result, 'Merged dirty rectangle');
  return result;
}

function overlapsOrTouches(first: MutableSceneRect, second: MutableSceneRect): boolean {
  return (
    first.x <= second.x + second.width &&
    second.x <= first.x + first.width &&
    first.y <= second.y + second.height &&
    second.y <= first.y + first.height
  );
}

function compareRects(first: MutableSceneRect, second: MutableSceneRect): number {
  if (first.y !== second.y) {
    return first.y < second.y ? -1 : 1;
  }
  if (first.x !== second.x) {
    return first.x < second.x ? -1 : 1;
  }
  if (first.width !== second.width) {
    return first.width < second.width ? -1 : 1;
  }
  if (first.height !== second.height) {
    return first.height < second.height ? -1 : 1;
  }
  return 0;
}

export function coalesceDirtyRects(
  rects: readonly SceneRect[],
  options?: DirtyRectOptions,
): readonly SceneRect[] {
  const suppliedRoutingMargin = options?.routingMargin;
  const suppliedShadowBleed = options?.shadowBleed;
  const routingMargin = suppliedRoutingMargin === undefined ? 0 : suppliedRoutingMargin;
  const shadowBleed = suppliedShadowBleed === undefined ? 0 : suppliedShadowBleed;

  assertFinite(routingMargin, 'Dirty rectangle routingMargin');
  assertFinite(shadowBleed, 'Dirty rectangle shadowBleed');
  assertNonNegative(routingMargin, 'Dirty rectangle routingMargin');
  assertNonNegative(shadowBleed, 'Dirty rectangle shadowBleed');

  const padding = routingMargin + shadowBleed;
  assertFinite(padding, 'Dirty rectangle combined margin');

  if (rects.length === 0) {
    return [];
  }

  const merged: MutableSceneRect[] = [];

  rects.forEach((rect, index) => {
    validateRect(rect, `Dirty rectangle ${index}`);

    let candidate: MutableSceneRect = {
      x: rect.x - padding,
      y: rect.y - padding,
      width: rect.width + padding * 2,
      height: rect.height + padding * 2,
    };
    validateRect(candidate, `Padded dirty rectangle ${index}`);

    let mergedIndex = 0;
    while (mergedIndex < merged.length) {
      const existing = merged[mergedIndex];
      if (existing === undefined) {
        break;
      }
      if (overlapsOrTouches(candidate, existing)) {
        candidate = unionRects(candidate, existing);
        merged.splice(mergedIndex, 1);
        mergedIndex = 0;
      } else {
        mergedIndex += 1;
      }
    }

    merged.push(candidate);
  });

  merged.sort(compareRects);

  if (merged.length <= 4) {
    return merged;
  }

  const first = merged[0];
  if (first === undefined) {
    return [];
  }

  return [merged.slice(1).reduce(unionRects, first)];
}
