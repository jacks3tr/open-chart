import type {
  EvaluatedBooleanGeometry,
  EvaluatedClip,
  EvaluatedGeometry,
  EvaluatedPathCommand,
  EvaluatedShape,
  EvaluatedShapeBounds,
  EvaluatedShapeNode,
  EvaluatedTextArea,
  ShapeFrame,
  ShapePoint,
} from '@openchart/shapes';

import type {
  SceneClip,
  SceneClipItem,
  SceneDescription,
  SceneEllipseItem,
  SceneGroup,
  SceneItem,
  ScenePathCommand,
  ScenePathItem,
  ScenePoint,
  ScenePolygonItem,
  SceneRect,
  SceneRectItem,
  SceneTextItem,
} from './index.js';

const DEFAULT_FONT_FAMILY = 'Segoe UI, Arial, sans-serif';
const DEFAULT_TEXT_COLOR = '#10213A';
const DEFAULT_TITLE = 'OpenChart shape scene';
const TEXT_MIN_ZOOM = 0.4;
const BOUNDS_PADDING = 24;
const MIN_TEXT_SIZE = 8;
const MAX_TEXT_SIZE = 32;

export interface ShapeSceneInstance {
  readonly id: string;
  readonly shape: EvaluatedShape;
}

export interface ShapeSceneBuildOptions {
  readonly bounds?: SceneRect;
  readonly title?: string;
  readonly description?: string;
  readonly fontFamily?: string;
  readonly textColor?: string;
}

interface PaintValues {
  readonly fill?: string;
  readonly fillOpacity?: number;
  readonly stroke?: string;
  readonly strokeOpacity?: number;
  readonly strokeWidth?: number;
  readonly dash?: readonly number[];
}

type PaintOverride = Readonly<{
  readonly fill?: string | undefined;
  readonly fillOpacity?: number | undefined;
  readonly stroke?: string | undefined;
  readonly strokeOpacity?: number | undefined;
  readonly strokeWidth?: number | undefined;
  readonly dash?: readonly number[] | undefined;
}>;

function encodeId(value: string): string {
  let encoded = '';
  for (const character of value) {
    if (/^[A-Za-z0-9_.-]$/.test(character)) {
      encoded += character;
      continue;
    }
    encoded += `-${character.codePointAt(0)?.toString(16) ?? '0'}-`;
  }
  return encoded || 'anonymous';
}

function shapeGroupId(instanceId: string): string {
  return `shape-${encodeId(instanceId)}`;
}

function childGroupId(parentId: string, childId: string): string {
  return `${parentId}-child-${encodeId(childId)}`;
}

function geometryItemId(parentId: string, geometryId: string, suffix = ''): string {
  return `${parentId}-geometry-${encodeId(geometryId)}${suffix}`;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Shape scene ${label} must be finite`);
  }
  return value;
}

function positive(value: unknown, label: string): number {
  const number = finite(value, label);
  if (number <= 0) {
    throw new Error(`Shape scene ${label} must be a finite positive number`);
  }
  return number;
}

function validateSceneBounds(bounds: SceneRect, label = 'bounds'): SceneRect {
  return {
    x: finite(bounds.x, `${label}.x`),
    y: finite(bounds.y, `${label}.y`),
    width: positive(bounds.width, `${label}.width`),
    height: positive(bounds.height, `${label}.height`),
  };
}

function validateFrame(frame: ShapeFrame, label: string): ShapeFrame {
  return {
    x: finite(frame.x, `${label}.x`),
    y: finite(frame.y, `${label}.y`),
    width: positive(frame.width, `${label}.width`),
    height: positive(frame.height, `${label}.height`),
  };
}

function validatePoint(point: ShapePoint, label: string): ScenePoint {
  return {
    x: finite(point.x, `${label}.x`),
    y: finite(point.y, `${label}.y`),
  };
}

function paintValues(geometry: EvaluatedGeometry): PaintValues {
  const output: {
    fill?: string;
    fillOpacity?: number;
    stroke?: string;
    strokeOpacity?: number;
    strokeWidth?: number;
    dash?: readonly number[];
  } = {};
  if (geometry.fill !== undefined) {
    output.fill = geometry.fill;
  }
  if (geometry.fillOpacity !== undefined) {
    output.fillOpacity = geometry.fillOpacity;
  }
  if (geometry.stroke !== undefined) {
    output.stroke = geometry.stroke;
  }
  if (geometry.strokeOpacity !== undefined) {
    output.strokeOpacity = geometry.strokeOpacity;
  }
  if (geometry.strokeWidth !== undefined) {
    output.strokeWidth = geometry.strokeWidth;
  }
  if (geometry.dash !== undefined) {
    output.dash = geometry.dash;
  }
  return output;
}

function mergePaint(geometry: EvaluatedGeometry, override: PaintOverride | undefined): PaintValues {
  const base = paintValues(geometry);
  if (override === undefined) {
    return base;
  }
  const output: {
    fill?: string;
    fillOpacity?: number;
    stroke?: string;
    strokeOpacity?: number;
    strokeWidth?: number;
    dash?: readonly number[];
  } = { ...base };
  if (Object.prototype.hasOwnProperty.call(override, 'fill')) {
    if (override.fill !== undefined) {
      output.fill = override.fill;
    } else {
      delete output.fill;
    }
  }
  if (Object.prototype.hasOwnProperty.call(override, 'fillOpacity')) {
    if (override.fillOpacity !== undefined) {
      output.fillOpacity = override.fillOpacity;
    } else {
      delete output.fillOpacity;
    }
  }
  if (Object.prototype.hasOwnProperty.call(override, 'stroke')) {
    if (override.stroke !== undefined) {
      output.stroke = override.stroke;
    } else {
      delete output.stroke;
    }
  }
  if (Object.prototype.hasOwnProperty.call(override, 'strokeOpacity')) {
    if (override.strokeOpacity !== undefined) {
      output.strokeOpacity = override.strokeOpacity;
    } else {
      delete output.strokeOpacity;
    }
  }
  if (Object.prototype.hasOwnProperty.call(override, 'strokeWidth')) {
    if (override.strokeWidth !== undefined) {
      output.strokeWidth = override.strokeWidth;
    } else {
      delete output.strokeWidth;
    }
  }
  if (Object.prototype.hasOwnProperty.call(override, 'dash')) {
    if (override.dash !== undefined) {
      output.dash = override.dash;
    } else {
      delete output.dash;
    }
  }
  return output;
}

function pathCommand(command: EvaluatedPathCommand, label: string): ScenePathCommand {
  switch (command.type) {
    case 'move':
      return { type: 'move', to: validatePoint(command.to, `${label}.to`) };
    case 'line':
      return { type: 'line', to: validatePoint(command.to, `${label}.to`) };
    case 'quadratic':
      return {
        type: 'quadratic',
        control: validatePoint(command.control, `${label}.control`),
        to: validatePoint(command.to, `${label}.to`),
      };
    case 'cubic':
      return {
        type: 'cubic',
        control1: validatePoint(command.control1, `${label}.control1`),
        control2: validatePoint(command.control2, `${label}.control2`),
        to: validatePoint(command.to, `${label}.to`),
      };
    case 'close':
      return { type: 'close' };
  }
}

function unsupportedBoolean(operation: EvaluatedBooleanGeometry['operation']): never {
  throw new Error(
    `Shape scene adapter cannot represent boolean operation ${JSON.stringify(operation)} faithfully; only "union" may be flattened`,
  );
}

function isClipItem(item: SceneItem): item is SceneClipItem {
  return (
    item.type === 'rect' ||
    item.type === 'circle' ||
    item.type === 'ellipse' ||
    item.type === 'polygon' ||
    item.type === 'path'
  );
}

function geometryItems(
  geometry: EvaluatedGeometry,
  itemId: string,
  override?: PaintOverride,
): readonly SceneItem[] {
  if (geometry.type === 'boolean') {
    if (geometry.operation !== 'union') {
      unsupportedBoolean(geometry.operation);
    }
    const resolvedPaint = mergePaint(geometry, override);
    const inheritedPaint: PaintOverride = {
      fill: resolvedPaint.fill,
      fillOpacity: resolvedPaint.fillOpacity,
      stroke: resolvedPaint.stroke,
      strokeOpacity: resolvedPaint.strokeOpacity,
      strokeWidth: resolvedPaint.strokeWidth,
      dash: resolvedPaint.dash,
    };
    return geometry.geometry.flatMap((operand, index) =>
      geometryItems(
        operand,
        `${itemId}-operand-${index}-${encodeId(operand.id)}`,
        inheritedPaint,
      ),
    );
  }

  const paint = mergePaint(geometry, override);
  switch (geometry.type) {
    case 'rect': {
      const frame = validateFrame(geometry.frame, `${itemId}.frame`);
      const item: SceneRectItem = {
        type: 'rect',
        id: itemId,
        frame,
        ...paint,
        ...(geometry.radius === undefined ? {} : { radius: finite(geometry.radius, `${itemId}.radius`) }),
      };
      return [item];
    }
    case 'ellipse': {
      const frame = validateFrame(geometry.frame, `${itemId}.frame`);
      const item: SceneEllipseItem = {
        type: 'ellipse',
        id: itemId,
        center: { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 },
        radiusX: frame.width / 2,
        radiusY: frame.height / 2,
        ...paint,
      };
      return [item];
    }
    case 'polygon': {
      const item: ScenePolygonItem = {
        type: 'polygon',
        id: itemId,
        points: geometry.points.map((point, index) =>
          validatePoint(point, `${itemId}.points.${index}`),
        ),
        ...paint,
      };
      return [item];
    }
    case 'path': {
      const item: ScenePathItem = {
        type: 'path',
        id: itemId,
        commands: geometry.commands.map((command, index) =>
          pathCommand(command, `${itemId}.commands.${index}`),
        ),
        ...paint,
      };
      return [item];
    }
  }
}

function clipItems(clip: EvaluatedClip, groupId: string): SceneClip {
  const items = clip.geometry
    .flatMap((geometry, index) => geometryItems(geometry, `${groupId}-clip-${index}-${encodeId(geometry.id)}`))
    .filter(isClipItem);
  return { items };
}

function clipOutlines(clip: EvaluatedClip, groupId: string): readonly SceneItem[] {
  if (clip.stroke === undefined && clip.strokeWidth === undefined) {
    return [];
  }
  const override: PaintOverride = {
    fill: 'none',
    stroke: clip.stroke ?? 'none',
    strokeWidth: clip.strokeWidth ?? 0,
    fillOpacity: undefined,
    strokeOpacity: undefined,
    dash: undefined,
  };
  return clip.geometry.flatMap((geometry, index) =>
    geometryItems(
      geometry,
      `${groupId}-clip-outline-${index}-${encodeId(geometry.id)}`,
      override,
    ),
  );
}

function boundedTextSize(frame: ShapeFrame, value: string): number {
  const widthBudget = frame.width / Math.max(1, value.length * 0.58);
  const heightBudget = frame.height * 0.58;
  const candidate = Math.min(widthBudget, heightBudget);
  if (!Number.isFinite(candidate)) {
    return MIN_TEXT_SIZE;
  }
  return Math.max(MIN_TEXT_SIZE, Math.min(MAX_TEXT_SIZE, candidate));
}

function textItem(
  textArea: EvaluatedTextArea,
  itemId: string,
  fontFamily: string,
  textColor: string,
): SceneTextItem {
  const frame = validateFrame(textArea.frame, `${itemId}.frame`);
  const fontSize = boundedTextSize(frame, textArea.text);
  return {
    type: 'text',
    id: itemId,
    value: textArea.text,
    at: {
      x: frame.x + frame.width / 2,
      y: frame.y + frame.height / 2 + fontSize * 0.35,
    },
    fill: textColor,
    fontFamily,
    fontSize,
    anchor: 'middle',
    minZoom: TEXT_MIN_ZOOM,
  };
}

function transformFor(bounds: EvaluatedShapeBounds): SceneGroup['transform'] {
  const rotation = finite(bounds.rotation, 'shape rotation');
  if (rotation === 0) {
    return undefined;
  }
  return {
    rotation,
    origin: validatePoint(bounds.rotationOrigin, 'shape rotation origin'),
  };
}

function nodeEntityId(instanceId: string, node: EvaluatedShapeNode, root: boolean): string {
  return root ? instanceId : `${instanceId}.${node.id}`;
}

function nodeGroup(
  instanceId: string,
  node: EvaluatedShapeNode,
  groupId: string,
  options: Pick<ShapeSceneBuildOptions, 'fontFamily' | 'textColor'>,
  root: boolean,
  rootName: string,
  composition: EvaluatedShape['composition'] | undefined,
): SceneGroup {
  const fontFamily = options.fontFamily ?? DEFAULT_FONT_FAMILY;
  const textColor = options.textColor ?? DEFAULT_TEXT_COLOR;
  validateFrame(node.bounds, `${groupId}.bounds`);
  const transform = transformFor(node.bounds);
  const children: SceneItem[] = [];

  for (const geometry of node.geometry) {
    children.push(...geometryItems(geometry, geometryItemId(groupId, geometry.id)));
  }
  for (const textArea of node.textAreas) {
    children.push(textItem(textArea, `${groupId}-text-${encodeId(textArea.id)}`, fontFamily, textColor));
  }
  for (const child of node.children) {
    children.push(
      nodeGroup(
        instanceId,
        child,
        childGroupId(groupId, child.id),
        options,
        false,
        rootName,
        undefined,
      ),
    );
  }
  if (node.clip !== undefined) {
    children.push(...clipOutlines(node.clip, groupId));
  }

  const group: SceneGroup = {
    type: 'group',
    id: groupId,
    role: 'shape',
    entityId: nodeEntityId(instanceId, node, root),
    ariaLabel: root ? rootName : node.id,
    ...(root && composition !== undefined ? { composition } : {}),
    ...(transform === undefined ? {} : { transform }),
    ...(node.clip === undefined ? {} : { clip: clipItems(node.clip, groupId) }),
    children,
  };
  return group;
}

function validateInstanceId(id: unknown): string {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Shape scene instance ids must be non-empty strings');
  }
  return id;
}

function allBounds(node: EvaluatedShapeNode): readonly EvaluatedShapeBounds[] {
  return [node.bounds, ...node.children.flatMap((child) => allBounds(child))];
}

function rotatedExtents(bounds: EvaluatedShapeBounds, label: string): SceneRect {
  const frame = validateFrame(bounds, label);
  const rotation = finite(bounds.rotation, `${label}.rotation`);
  const origin = validatePoint(bounds.rotationOrigin, `${label}.rotationOrigin`);
  if (rotation === 0) {
    return frame;
  }
  const radians = (rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const points = [
    { x: frame.x, y: frame.y },
    { x: frame.x + frame.width, y: frame.y },
    { x: frame.x + frame.width, y: frame.y + frame.height },
    { x: frame.x, y: frame.y + frame.height },
  ].map((point) => {
    const offsetX = point.x - origin.x;
    const offsetY = point.y - origin.y;
    return {
      x: origin.x + offsetX * cosine - offsetY * sine,
      y: origin.y + offsetX * sine + offsetY * cosine,
    };
  });
  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  const minX = Math.min(...xValues);
  const minY = Math.min(...yValues);
  const maxX = Math.max(...xValues);
  const maxY = Math.max(...yValues);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function deriveBounds(instances: readonly ShapeSceneInstance[]): SceneRect {
  if (instances.length === 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const frames = instances.flatMap((instance) => allBounds(instance.shape));
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  frames.forEach((frame, index) => {
    const validated = rotatedExtents(frame, `instances.frame.${index}`);
    minX = Math.min(minX, validated.x);
    minY = Math.min(minY, validated.y);
    maxX = Math.max(maxX, validated.x + validated.width);
    maxY = Math.max(maxY, validated.y + validated.height);
  });
  return {
    x: minX - BOUNDS_PADDING,
    y: minY - BOUNDS_PADDING,
    width: maxX - minX + BOUNDS_PADDING * 2,
    height: maxY - minY + BOUNDS_PADDING * 2,
  };
}

export function shapeToSceneGroup(
  instance: ShapeSceneInstance,
  options: Pick<ShapeSceneBuildOptions, 'fontFamily' | 'textColor'> = {},
): SceneGroup {
  const instanceId = validateInstanceId(instance.id);
  return nodeGroup(
    instanceId,
    instance.shape,
    shapeGroupId(instanceId),
    options,
    true,
    instance.shape.name,
    instance.shape.composition,
  );
}

export function buildShapeSceneDescription(
  instances: readonly ShapeSceneInstance[],
  options: ShapeSceneBuildOptions = {},
): SceneDescription {
  const ids = new Set<string>();
  for (const instance of instances) {
    const id = validateInstanceId(instance.id);
    if (ids.has(id)) {
      throw new Error(`Shape scene instance id ${JSON.stringify(id)} is duplicated`);
    }
    ids.add(id);
    validateFrame(instance.shape.bounds, `instance ${JSON.stringify(id)}.bounds`);
  }

  const bounds = validateSceneBounds(options.bounds ?? deriveBounds(instances));
  const title = options.title ?? DEFAULT_TITLE;
  const description = options.description ?? `OpenChart shape scene with ${instances.length} evaluated instance${instances.length === 1 ? '' : 's'}.`;
  const groups = instances.map((instance) => shapeToSceneGroup(instance, options));
  const artboard: SceneGroup = {
    type: 'group',
    id: 'artboard',
    role: 'artboard',
    ariaLabel: title,
    children: groups,
  };
  return {
    version: 1,
    bounds,
    title,
    description,
    items: [artboard],
  };
}
