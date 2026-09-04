import type { OpenChartDocument } from '@openchart/ir';
import type { Operation, OperationEnvelope } from '@openchart/ops';

export * from './commands.js';
export * from './clipboard.js';

export interface InteractionPoint {
  readonly x: number;
  readonly y: number;
}

export interface InteractionRect extends InteractionPoint {
  readonly width: number;
  readonly height: number;
}

export type SelectableItemKind = 'node' | 'container' | 'group';

export interface SelectableItem {
  readonly id: string;
  readonly kind: SelectableItemKind;
  readonly bounds: InteractionRect;
  readonly paintOrder: number;
  readonly parentId?: string;
  readonly hidden?: boolean;
  readonly locked?: boolean;
}

export interface SelectionState {
  readonly scopeId: string | null;
  readonly selectedIds: readonly string[];
}

export interface PointSelectionOptions {
  readonly toggle?: boolean;
}

export interface TransformFrame extends InteractionRect {
  readonly rotation?: number;
}

export interface TransformPreview {
  readonly selectionBounds: TransformFrame;
  readonly updates: Readonly<Record<string, TransformFrame>>;
}

export interface TransformTransactionOptions {
  readonly txId: string;
  readonly idempotencyKey?: string;
}

export type ResizeHandle =
  | 'north-west'
  | 'north'
  | 'north-east'
  | 'east'
  | 'south-east'
  | 'south'
  | 'south-west'
  | 'west';

export interface ResizeOptions {
  readonly fromCenter?: boolean;
  readonly keepAspectRatio?: boolean;
  readonly minimumSize?: number;
}

export interface RotationOptions {
  readonly snapIncrement?: number;
}

export interface SnapCandidate {
  readonly id: string;
  readonly bounds: InteractionRect;
  readonly onScreen: boolean;
}

export interface UserGuide {
  readonly id: string;
  readonly axis: 'x' | 'y';
  readonly position: number;
}

export interface SnapSettings {
  readonly snapToGrid: boolean;
  readonly snapToObjects: boolean;
  readonly snapToGuides: boolean;
  readonly threshold: number;
  readonly gridSize?: number;
}

export interface SnapRequest {
  readonly movingId: string;
  readonly bounds: InteractionRect;
  readonly candidates: readonly SnapCandidate[];
  readonly userGuides?: readonly UserGuide[];
  readonly settings: SnapSettings;
}

export interface AlignmentGuide {
  readonly axis: 'x' | 'y';
  readonly position: number;
  readonly kind: 'center' | 'edge' | 'grid' | 'user';
  readonly style: 'dotted' | 'solid';
  readonly targetIds: readonly string[];
}

export interface DistanceMeasurement {
  readonly axis: 'x' | 'y';
  readonly targetId: string;
  readonly distance: number;
  readonly side: 'before' | 'after';
}

export interface SpacingGuide {
  readonly axis: 'x' | 'y';
  readonly targetIds: readonly [string, string];
  readonly distance: number;
}

export interface SnapResult {
  readonly bounds: InteractionRect;
  readonly delta: InteractionPoint;
  readonly coordinates: InteractionPoint;
  readonly alignmentGuides: readonly AlignmentGuide[];
  readonly distances: readonly DistanceMeasurement[];
  readonly spacingGuides: readonly SpacingGuide[];
}

interface NormalizedRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeRect(rect: InteractionRect, label: string): NormalizedRect {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) {
    throw new Error(`${label} must contain finite coordinates and dimensions`);
  }
  const oppositeX = rect.x + rect.width;
  const oppositeY = rect.y + rect.height;
  if (!Number.isFinite(oppositeX) || !Number.isFinite(oppositeY)) {
    throw new Error(`${label} extents must be finite`);
  }
  return {
    left: Math.min(rect.x, oppositeX),
    top: Math.min(rect.y, oppositeY),
    right: Math.max(rect.x, oppositeX),
    bottom: Math.max(rect.y, oppositeY),
  };
}

function validatePoint(point: InteractionPoint, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error(`${label} must contain finite coordinates`);
  }
}

function compareItems(left: SelectableItem, right: SelectableItem): number {
  const paintOrder = left.paintOrder - right.paintOrder;
  return paintOrder === 0 ? compareStrings(left.id, right.id) : paintOrder;
}

function itemScope(item: SelectableItem): string | null {
  return item.parentId ?? null;
}

function eligibleItems(
  state: SelectionState,
  items: readonly SelectableItem[],
): readonly SelectableItem[] {
  const eligible = items.filter((item) => {
    if (!Number.isFinite(item.paintOrder)) {
      throw new Error(`Selectable item ${JSON.stringify(item.id)} has an invalid paint order`);
    }
    normalizeRect(item.bounds, `Selectable item ${JSON.stringify(item.id)} bounds`);
    return !item.hidden && !item.locked && itemScope(item) === state.scopeId;
  });
  return eligible.sort(compareItems);
}

function sortedSelection(
  ids: ReadonlySet<string>,
  eligible: readonly SelectableItem[],
): readonly string[] {
  return eligible.filter((item) => ids.has(item.id)).map((item) => item.id);
}

function stateWithSelection(
  state: SelectionState,
  eligible: readonly SelectableItem[],
  ids: ReadonlySet<string>,
): SelectionState {
  return { scopeId: state.scopeId, selectedIds: sortedSelection(ids, eligible) };
}

function containsPoint(rect: NormalizedRect, point: InteractionPoint): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
}

function intersects(first: NormalizedRect, second: NormalizedRect): boolean {
  return !(
    first.right < second.left ||
    first.left > second.right ||
    first.bottom < second.top ||
    first.top > second.bottom
  );
}

function pointOnSegment(
  point: InteractionPoint,
  start: InteractionPoint,
  end: InteractionPoint,
): boolean {
  const cross =
    (point.y - start.y) * (end.x - start.x) -
    (point.x - start.x) * (end.y - start.y);
  const scale = Math.max(
    1,
    Math.abs(end.x - start.x),
    Math.abs(end.y - start.y),
  );
  if (Math.abs(cross) > 1e-9 * scale) {
    return false;
  }
  return (
    point.x >= Math.min(start.x, end.x) &&
    point.x <= Math.max(start.x, end.x) &&
    point.y >= Math.min(start.y, end.y) &&
    point.y <= Math.max(start.y, end.y)
  );
}

function polygonContainsPoint(
  polygon: readonly InteractionPoint[],
  point: InteractionPoint,
): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const start = polygon[previous];
    const end = polygon[index];
    if (start === undefined || end === undefined) {
      continue;
    }
    if (pointOnSegment(point, start, end)) {
      return true;
    }
    if (
      start.y > point.y !== end.y > point.y &&
      point.x < ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) + start.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function rectangleCorners(rect: NormalizedRect): readonly InteractionPoint[] {
  return [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
}

export function createSelectionState(scopeId: string | null = null): SelectionState {
  return { scopeId, selectedIds: [] };
}

export function clearSelection(state: SelectionState): SelectionState {
  return { scopeId: state.scopeId, selectedIds: [] };
}

export function selectAt(
  state: SelectionState,
  items: readonly SelectableItem[],
  point: InteractionPoint,
  options: PointSelectionOptions = {},
): SelectionState {
  validatePoint(point, 'Selection point');
  const eligible = eligibleItems(state, items);
  const hit = eligible.findLast((item) =>
    containsPoint(normalizeRect(item.bounds, `Selectable item ${JSON.stringify(item.id)} bounds`), point),
  );
  const current = new Set(
    state.selectedIds.filter((id) => eligible.some((item) => item.id === id)),
  );

  if (hit === undefined) {
    return options.toggle === true
      ? stateWithSelection(state, eligible, current)
      : clearSelection(state);
  }
  if (options.toggle === true) {
    if (current.has(hit.id)) {
      current.delete(hit.id);
    } else {
      current.add(hit.id);
    }
    return stateWithSelection(state, eligible, current);
  }
  return stateWithSelection(state, eligible, new Set([hit.id]));
}

export function selectMarquee(
  state: SelectionState,
  items: readonly SelectableItem[],
  rect: InteractionRect,
): SelectionState {
  const selectionRect = normalizeRect(rect, 'Marquee rectangle');
  const eligible = eligibleItems(state, items);
  const selected = new Set(
    eligible
      .filter((item) =>
        intersects(
          selectionRect,
          normalizeRect(item.bounds, `Selectable item ${JSON.stringify(item.id)} bounds`),
        ),
      )
      .map((item) => item.id),
  );
  return stateWithSelection(state, eligible, selected);
}

export function selectLasso(
  state: SelectionState,
  items: readonly SelectableItem[],
  polygon: readonly InteractionPoint[],
): SelectionState {
  if (polygon.length < 3) {
    throw new Error('Lasso polygon must contain at least three points');
  }
  polygon.forEach((point, index) => validatePoint(point, `Lasso point ${index}`));
  const eligible = eligibleItems(state, items);
  const selected = new Set(
    eligible
      .filter((item) =>
        rectangleCorners(
          normalizeRect(item.bounds, `Selectable item ${JSON.stringify(item.id)} bounds`),
        ).every((corner) => polygonContainsPoint(polygon, corner)),
      )
      .map((item) => item.id),
  );
  return stateWithSelection(state, eligible, selected);
}

export function selectAll(
  state: SelectionState,
  items: readonly SelectableItem[],
): SelectionState {
  const eligible = eligibleItems(state, items);
  return stateWithSelection(
    state,
    eligible,
    new Set(eligible.map((item) => item.id)),
  );
}

export function enterSelectionScope(
  state: SelectionState,
  items: readonly SelectableItem[],
): SelectionState {
  if (state.selectedIds.length !== 1) {
    return state;
  }
  const selectedId = state.selectedIds[0];
  const selected = eligibleItems(state, items).find((item) => item.id === selectedId);
  if (selected === undefined || (selected.kind !== 'container' && selected.kind !== 'group')) {
    return state;
  }
  return createSelectionState(selected.id);
}

export function exitSelectionScope(
  state: SelectionState,
  items: readonly SelectableItem[],
): SelectionState {
  if (state.scopeId === null) {
    return state;
  }
  const scope = items.find((item) => item.id === state.scopeId);
  return createSelectionState(scope?.parentId ?? null);
}

interface TransformContext {
  readonly affectedIds: readonly string[];
  readonly bounds: TransformFrame;
}

function requireTransformFrame(
  frames: Readonly<Record<string, TransformFrame>>,
  id: string,
): TransformFrame {
  const frame = frames[id];
  if (frame === undefined) {
    throw new Error(`Missing transform frame for node ${JSON.stringify(id)}`);
  }
  if (
    !Number.isFinite(frame.x) ||
    !Number.isFinite(frame.y) ||
    !Number.isFinite(frame.width) ||
    !Number.isFinite(frame.height) ||
    (frame.rotation !== undefined && !Number.isFinite(frame.rotation)) ||
    frame.width <= 0 ||
    frame.height <= 0
  ) {
    throw new Error(
      `Transform frame for node ${JSON.stringify(id)} must have finite coordinates and positive dimensions`,
    );
  }
  return frame;
}

function resolveTransformContext(
  document: OpenChartDocument,
  frames: Readonly<Record<string, TransformFrame>>,
  selectedIds: readonly string[],
  descendantMode: 'all' | 'magnetized',
): TransformContext {
  const selected = [...new Set(selectedIds)].sort(compareStrings);
  if (selected.length === 0) {
    throw new Error('Transform selection must contain at least one node');
  }

  const selectedParents = new Set<string>();
  for (const id of selected) {
    const node = document.nodes[id];
    if (node === undefined) {
      throw new Error(`Transform node ${JSON.stringify(id)} does not exist`);
    }
    const layer = document.layers[node.layerId];
    if (layer === undefined) {
      throw new Error(`Transform node ${JSON.stringify(id)} has no layer`);
    }
    if (!layer.visible) {
      throw new Error(`Cannot transform node ${JSON.stringify(id)} on a hidden layer`);
    }
    if (layer.locked) {
      throw new Error(`Cannot transform node ${JSON.stringify(id)} on a locked layer`);
    }
    if (
      node.container !== undefined &&
      (descendantMode === 'all' || node.container.magnetize !== false)
    ) {
      selectedParents.add(id);
    }
    if (node.group !== undefined) {
      selectedParents.add(id);
    }
  }

  const affected = new Set(selected);
  if (selectedParents.size > 0) {
    for (const [id, node] of Object.entries(document.nodes)) {
      let parentId = node.parentId;
      const visited = new Set<string>();
      while (parentId !== undefined && !visited.has(parentId)) {
        if (selectedParents.has(parentId)) {
          affected.add(id);
          break;
        }
        visited.add(parentId);
        parentId = document.nodes[parentId]?.parentId;
      }
    }
  }

  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const id of selected) {
    const frame = requireTransformFrame(frames, id);
    left = Math.min(left, frame.x);
    top = Math.min(top, frame.y);
    right = Math.max(right, frame.x + frame.width);
    bottom = Math.max(bottom, frame.y + frame.height);
  }

  const affectedIds = [...affected].sort(compareStrings);
  affectedIds.forEach((id) => requireTransformFrame(frames, id));
  return {
    affectedIds,
    bounds: { x: left, y: top, width: right - left, height: bottom - top },
  };
}

export function translateSelection(
  document: OpenChartDocument,
  frames: Readonly<Record<string, TransformFrame>>,
  selectedIds: readonly string[],
  delta: InteractionPoint,
): TransformPreview {
  validatePoint(delta, 'Transform delta');
  const context = resolveTransformContext(
    document,
    frames,
    selectedIds,
    'magnetized',
  );
  const updates: Record<string, TransformFrame> = {};
  for (const id of context.affectedIds) {
    const frame = requireTransformFrame(frames, id);
    updates[id] = {
      x: frame.x + delta.x,
      y: frame.y + delta.y,
      width: frame.width,
      height: frame.height,
      ...(frame.rotation === undefined ? {} : { rotation: frame.rotation }),
    };
  }
  return {
    selectionBounds: {
      x: context.bounds.x + delta.x,
      y: context.bounds.y + delta.y,
      width: context.bounds.width,
      height: context.bounds.height,
    },
    updates,
  };
}

export function resizeSelection(
  document: OpenChartDocument,
  frames: Readonly<Record<string, TransformFrame>>,
  selectedIds: readonly string[],
  handle: ResizeHandle,
  delta: InteractionPoint,
  options: ResizeOptions = {},
): TransformPreview {
  validatePoint(delta, 'Resize delta');
  const minimumSize = options.minimumSize ?? 16;
  if (!Number.isFinite(minimumSize) || minimumSize <= 0) {
    throw new Error('Resize minimum size must be finite and positive');
  }
  const context = resolveTransformContext(document, frames, selectedIds, 'all');
  const original = context.bounds;
  const horizontalDirection = handle.includes('west')
    ? -1
    : handle.includes('east')
      ? 1
      : 0;
  const verticalDirection = handle.includes('north')
    ? -1
    : handle.includes('south')
      ? 1
      : 0;
  const centerMultiplier = options.fromCenter === true ? 2 : 1;
  const proposedWidth =
    original.width + horizontalDirection * delta.x * centerMultiplier;
  const proposedHeight =
    original.height + verticalDirection * delta.y * centerMultiplier;

  let width: number;
  let height: number;
  if (options.keepAspectRatio === true) {
    let scale: number;
    if (horizontalDirection !== 0 && verticalDirection !== 0) {
      const widthScale = proposedWidth / original.width;
      const heightScale = proposedHeight / original.height;
      scale =
        Math.abs(widthScale - 1) >= Math.abs(heightScale - 1)
          ? widthScale
          : heightScale;
    } else if (horizontalDirection !== 0) {
      scale = proposedWidth / original.width;
    } else {
      scale = proposedHeight / original.height;
    }
    scale = Math.max(
      scale,
      minimumSize / original.width,
      minimumSize / original.height,
    );
    width = original.width * scale;
    height = original.height * scale;
  } else {
    width = Math.max(minimumSize, proposedWidth);
    height = Math.max(minimumSize, proposedHeight);
  }

  const originalRight = original.x + original.width;
  const originalBottom = original.y + original.height;
  const centerX = original.x + original.width / 2;
  const centerY = original.y + original.height / 2;
  const x =
    options.fromCenter === true || horizontalDirection === 0
      ? centerX - width / 2
      : horizontalDirection < 0
        ? originalRight - width
        : original.x;
  const y =
    options.fromCenter === true || verticalDirection === 0
      ? centerY - height / 2
      : verticalDirection < 0
        ? originalBottom - height
        : original.y;
  const scaleX = width / original.width;
  const scaleY = height / original.height;
  const updates: Record<string, TransformFrame> = {};
  for (const id of context.affectedIds) {
    const frame = requireTransformFrame(frames, id);
    updates[id] = {
      x: x + (frame.x - original.x) * scaleX,
      y: y + (frame.y - original.y) * scaleY,
      width: frame.width * scaleX,
      height: frame.height * scaleY,
      ...(frame.rotation === undefined ? {} : { rotation: frame.rotation }),
    };
  }
  return {
    selectionBounds: { x, y, width, height },
    updates,
  };
}

export function rotateSelection(
  document: OpenChartDocument,
  frames: Readonly<Record<string, TransformFrame>>,
  selectedIds: readonly string[],
  deltaDegrees: number,
  options: RotationOptions = {},
): TransformPreview {
  if (!Number.isFinite(deltaDegrees)) {
    throw new Error('Rotation delta must be finite');
  }
  const snapIncrement = options.snapIncrement;
  if (
    snapIncrement !== undefined &&
    (!Number.isFinite(snapIncrement) || snapIncrement <= 0)
  ) {
    throw new Error('Rotation snap increment must be finite and positive');
  }
  const selected = [...new Set(selectedIds)].sort(compareStrings);
  for (const id of selected) {
    if (document.nodes[id]?.container !== undefined) {
      throw new Error('Containers cannot be rotated');
    }
    if (document.nodes[id]?.group !== undefined) {
      throw new Error('Groups cannot be rotated');
    }
  }
  const context = resolveTransformContext(document, frames, selected, 'all');
  const appliedDelta =
    snapIncrement === undefined
      ? deltaDegrees
      : Math.round(deltaDegrees / snapIncrement) * snapIncrement;
  const radians = (appliedDelta * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const centerX = context.bounds.x + context.bounds.width / 2;
  const centerY = context.bounds.y + context.bounds.height / 2;
  const normalizeRotation = (rotation: number): number => {
    const normalized = rotation % 360;
    return normalized < 0 ? normalized + 360 : normalized;
  };
  const updates: Record<string, TransformFrame> = {};
  for (const id of context.affectedIds) {
    const frame = requireTransformFrame(frames, id);
    const frameCenterX = frame.x + frame.width / 2;
    const frameCenterY = frame.y + frame.height / 2;
    const offsetX = frameCenterX - centerX;
    const offsetY = frameCenterY - centerY;
    const rotatedCenterX = centerX + offsetX * cosine - offsetY * sine;
    const rotatedCenterY = centerY + offsetX * sine + offsetY * cosine;
    const currentRotation =
      frame.rotation ?? document.layout.overrides[id]?.rotation ?? 0;
    updates[id] = {
      x: rotatedCenterX - frame.width / 2,
      y: rotatedCenterY - frame.height / 2,
      width: frame.width,
      height: frame.height,
      rotation: normalizeRotation(currentRotation + appliedDelta),
    };
  }
  const onlyUpdate = selected.length === 1 ? updates[selected[0] ?? ''] : undefined;
  return {
    selectionBounds: {
      ...context.bounds,
      rotation:
        onlyUpdate?.rotation ?? normalizeRotation(appliedDelta),
    },
    updates,
  };
}

export function createTransformTransaction(
  document: OpenChartDocument,
  preview: TransformPreview,
  options: TransformTransactionOptions,
): OperationEnvelope {
  if (options.txId.length === 0) {
    throw new Error('Transform transaction id must not be empty');
  }
  if (options.idempotencyKey !== undefined && options.idempotencyKey.length === 0) {
    throw new Error('Transform idempotency key must not be empty');
  }
  const entries = Object.entries(preview.updates).sort(([left], [right]) =>
    compareStrings(left, right),
  );
  if (entries.length === 0) {
    throw new Error('Transform preview must contain at least one update');
  }
  const ops: Operation[] = entries.map(([id, frame]) => {
    if (document.nodes[id] === undefined) {
      throw new Error(`Transform node ${JSON.stringify(id)} does not exist`);
    }
    requireTransformFrame(preview.updates, id);
    return {
      op: 'set_node_layout',
      id,
      layout: {
        ...document.layout.overrides[id],
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
        ...(frame.rotation === undefined ? {} : { rotation: frame.rotation }),
        pinned: true,
      },
    };
  });
  return {
    txId: options.txId,
    actor: 'user',
    origin: 'gui',
    baseRev: document.rev,
    ...(options.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: options.idempotencyKey }),
    ops,
  };
}

interface SnapOption extends AlignmentGuide {
  readonly correction: number;
  readonly priority: number;
}

interface AxisDistancePair {
  readonly before: DistanceMeasurement | undefined;
  readonly after: DistanceMeasurement | undefined;
}

function snapAnchors(
  rect: NormalizedRect,
  axis: 'x' | 'y',
): readonly { readonly value: number; readonly kind: 'center' | 'edge' }[] {
  return axis === 'x'
    ? [
        { value: rect.left, kind: 'edge' },
        { value: (rect.left + rect.right) / 2, kind: 'center' },
        { value: rect.right, kind: 'edge' },
      ]
    : [
        { value: rect.top, kind: 'edge' },
        { value: (rect.top + rect.bottom) / 2, kind: 'center' },
        { value: rect.bottom, kind: 'edge' },
      ];
}

function bestSnap(options: readonly SnapOption[]): SnapOption | undefined {
  return [...options].sort((left, right) => {
    const distance = Math.abs(left.correction) - Math.abs(right.correction);
    if (distance !== 0) {
      return distance;
    }
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    if (left.position !== right.position) {
      return left.position - right.position;
    }
    return compareStrings(left.targetIds.join('|'), right.targetIds.join('|'));
  })[0];
}

function rangesOverlap(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
): boolean {
  return Math.min(firstEnd, secondEnd) >= Math.max(firstStart, secondStart);
}

function nearestDistances(
  bounds: NormalizedRect,
  candidates: readonly SnapCandidate[],
  axis: 'x' | 'y',
): AxisDistancePair {
  const measurements: DistanceMeasurement[] = [];
  for (const candidate of candidates) {
    const target = normalizeRect(
      candidate.bounds,
      `Snap candidate ${JSON.stringify(candidate.id)} bounds`,
    );
    if (axis === 'x') {
      if (!rangesOverlap(bounds.top, bounds.bottom, target.top, target.bottom)) {
        continue;
      }
      if (target.right <= bounds.left) {
        measurements.push({
          axis,
          targetId: candidate.id,
          distance: bounds.left - target.right,
          side: 'before',
        });
      } else if (target.left >= bounds.right) {
        measurements.push({
          axis,
          targetId: candidate.id,
          distance: target.left - bounds.right,
          side: 'after',
        });
      }
    } else {
      if (!rangesOverlap(bounds.left, bounds.right, target.left, target.right)) {
        continue;
      }
      if (target.bottom <= bounds.top) {
        measurements.push({
          axis,
          targetId: candidate.id,
          distance: bounds.top - target.bottom,
          side: 'before',
        });
      } else if (target.top >= bounds.bottom) {
        measurements.push({
          axis,
          targetId: candidate.id,
          distance: target.top - bounds.bottom,
          side: 'after',
        });
      }
    }
  }
  const nearest = (side: 'before' | 'after'): DistanceMeasurement | undefined =>
    measurements
      .filter((measurement) => measurement.side === side)
      .sort((left, right) => {
        const distance = left.distance - right.distance;
        return distance === 0
          ? compareStrings(left.targetId, right.targetId)
          : distance;
      })[0];
  return { before: nearest('before'), after: nearest('after') };
}

export function snapBounds(request: SnapRequest): SnapResult {
  const source = normalizeRect(request.bounds, 'Moving snap bounds');
  if (request.bounds.width <= 0 || request.bounds.height <= 0) {
    throw new Error('Moving snap bounds must have positive dimensions');
  }
  const threshold = request.settings.threshold;
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new Error('Snap threshold must be finite and non-negative');
  }
  const candidates = request.candidates
    .filter((candidate) => candidate.onScreen && candidate.id !== request.movingId)
    .sort((left, right) => compareStrings(left.id, right.id));
  candidates.forEach((candidate) => {
    normalizeRect(candidate.bounds, `Snap candidate ${JSON.stringify(candidate.id)} bounds`);
    if (candidate.bounds.width <= 0 || candidate.bounds.height <= 0) {
      throw new Error(
        `Snap candidate ${JSON.stringify(candidate.id)} must have positive dimensions`,
      );
    }
  });

  const optionsByAxis: Record<'x' | 'y', SnapOption[]> = { x: [], y: [] };
  if (request.settings.snapToObjects) {
    for (const candidate of candidates) {
      const target = normalizeRect(
        candidate.bounds,
        `Snap candidate ${JSON.stringify(candidate.id)} bounds`,
      );
      for (const axis of ['x', 'y'] as const) {
        for (const movingAnchor of snapAnchors(source, axis)) {
          for (const targetAnchor of snapAnchors(target, axis)) {
            if (movingAnchor.kind !== targetAnchor.kind) {
              continue;
            }
            const correction = targetAnchor.value - movingAnchor.value;
            if (Math.abs(correction) <= threshold) {
              optionsByAxis[axis].push({
                axis,
                position: targetAnchor.value,
                kind: movingAnchor.kind,
                style: movingAnchor.kind === 'center' ? 'solid' : 'dotted',
                targetIds: [candidate.id],
                correction,
                priority: movingAnchor.kind === 'center' ? 1 : 2,
              });
            }
          }
        }
      }
    }
  }

  if (request.settings.snapToGuides) {
    for (const guide of [...(request.userGuides ?? [])].sort((left, right) =>
      compareStrings(left.id, right.id),
    )) {
      if (!Number.isFinite(guide.position)) {
        throw new Error(`User guide ${JSON.stringify(guide.id)} has an invalid position`);
      }
      for (const anchor of snapAnchors(source, guide.axis)) {
        const correction = guide.position - anchor.value;
        if (Math.abs(correction) <= threshold) {
          optionsByAxis[guide.axis].push({
            axis: guide.axis,
            position: guide.position,
            kind: 'user',
            style: 'solid',
            targetIds: [guide.id],
            correction,
            priority: 0,
          });
        }
      }
    }
  }

  if (request.settings.snapToGrid) {
    const gridSize = request.settings.gridSize ?? 16;
    if (!Number.isFinite(gridSize) || gridSize <= 0) {
      throw new Error('Snap grid size must be finite and positive');
    }
    for (const [axis, value] of [
      ['x', request.bounds.x],
      ['y', request.bounds.y],
    ] as const) {
      const position = Math.round(value / gridSize) * gridSize;
      const correction = position - value;
      if (Math.abs(correction) <= threshold) {
        optionsByAxis[axis].push({
          axis,
          position,
          kind: 'grid',
          style: 'dotted',
          targetIds: [],
          correction,
          priority: 3,
        });
      }
    }
  }

  const horizontal = bestSnap(optionsByAxis.x);
  const vertical = bestSnap(optionsByAxis.y);
  const delta = {
    x: horizontal?.correction ?? 0,
    y: vertical?.correction ?? 0,
  };
  const bounds: InteractionRect = {
    x: request.bounds.x + delta.x,
    y: request.bounds.y + delta.y,
    width: request.bounds.width,
    height: request.bounds.height,
  };
  const snapped = normalizeRect(bounds, 'Snapped bounds');
  const alignmentGuides = [horizontal, vertical]
    .filter((option): option is SnapOption => option !== undefined)
    .map((option): AlignmentGuide => ({
      axis: option.axis,
      position: option.position,
      kind: option.kind,
      style: option.style,
      targetIds: option.targetIds,
    }));

  const distances: DistanceMeasurement[] = [];
  const spacingGuides: SpacingGuide[] = [];
  if (request.settings.snapToObjects) {
    for (const axis of ['x', 'y'] as const) {
      const pair = nearestDistances(snapped, candidates, axis);
      if (pair.before !== undefined) {
        distances.push(pair.before);
      }
      if (pair.after !== undefined) {
        distances.push(pair.after);
      }
      if (
        pair.before !== undefined &&
        pair.after !== undefined &&
        Math.abs(pair.before.distance - pair.after.distance) <= threshold
      ) {
        spacingGuides.push({
          axis,
          targetIds: [pair.before.targetId, pair.after.targetId],
          distance: (pair.before.distance + pair.after.distance) / 2,
        });
      }
    }
  }

  return {
    bounds,
    delta,
    coordinates: { x: bounds.x, y: bounds.y },
    alignmentGuides,
    distances,
    spacingGuides,
  };
}
