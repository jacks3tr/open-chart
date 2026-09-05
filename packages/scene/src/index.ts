import {
  catmullRomToCubicSegments,
  findOrthogonalCrossings,
  pointAtNormalizedDistance,
  routeConnector,
  type OrthogonalCrossing,
  type RouteDiagnostic,
  type RouteResult,
} from '@openchart/connectors';
import {
  reconcileContainers,
  type ResolvedContainer,
} from '@openchart/derive';
import type {
  Edge,
  EdgeLayoutOverride,
  LayoutFrame,
  LayoutOverride,
  Node,
  OpenChartDocument,
  Page,
  Port,
  Style,
} from '@openchart/ir';
import { evaluateShapeDefinition } from '@openchart/shapes';
import { resolveLibraryShape as resolveBuiltinLibraryShape } from '@openchart/shapes/libraries-core';
import type { ResolveLibraryShapeResult } from '@openchart/shapes/libraries';

import { shapeToSceneGroup as evaluatedShapeToSceneGroup } from './shapes.js';

export {
  buildShapeSceneDescription,
  shapeToSceneGroup,
  type ShapeSceneBuildOptions,
  type ShapeSceneInstance,
} from './shapes.js';

export const SCENE_VERSION = 1 as const;

export type SceneLayer = 'background' | 'main' | 'overlay';

export interface SceneRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ScenePoint {
  readonly x: number;
  readonly y: number;
}

export interface SceneTransform {
  /** Clockwise rotation in degrees around an absolute scene point. */
  readonly rotation: number;
  readonly origin: ScenePoint;
}

interface SceneItemBase {
  readonly id: string;
  readonly opacity?: number;
  readonly minZoom?: number;
  readonly layer?: SceneLayer;
}

export type SceneGroupRole =
  | 'artboard'
  | 'header'
  | 'zone'
  | 'container'
  | 'group'
  | 'edge'
  | 'node'
  | 'shape'
  | 'glyph'
  | 'label'
  | 'legend';

export interface SceneGroup extends SceneItemBase {
  readonly type: 'group';
  readonly role: SceneGroupRole;
  readonly entityId?: string;
  readonly ariaLabel?: string;
  readonly composition?: 'above' | 'left' | 'circle';
  readonly transform?: SceneTransform;
  readonly clip?: SceneClip;
  readonly children: readonly SceneItem[];
}

export interface SceneRectItem extends SceneItemBase {
  readonly type: 'rect';
  readonly frame: SceneRect;
  readonly radius?: number;
  readonly fill?: string;
  readonly fillOpacity?: number;
  readonly stroke?: string;
  readonly strokeOpacity?: number;
  readonly strokeWidth?: number;
  readonly dash?: readonly number[];
  readonly chromeCacheKey?: string;
}

export interface SceneCircleItem extends SceneItemBase {
  readonly type: 'circle';
  readonly center: ScenePoint;
  readonly radius: number;
  readonly fill?: string;
  readonly fillOpacity?: number;
  readonly stroke?: string;
  readonly strokeOpacity?: number;
  readonly strokeWidth?: number;
  readonly dash?: readonly number[];
}

export interface SceneEllipseItem extends SceneItemBase {
  readonly type: 'ellipse';
  readonly center: ScenePoint;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly fill?: string;
  readonly fillOpacity?: number;
  readonly stroke?: string;
  readonly strokeOpacity?: number;
  readonly strokeWidth?: number;
  readonly dash?: readonly number[];
}

export interface ScenePolygonItem extends SceneItemBase {
  readonly type: 'polygon';
  readonly points: readonly ScenePoint[];
  readonly fill?: string;
  readonly fillOpacity?: number;
  readonly stroke?: string;
  readonly strokeOpacity?: number;
  readonly strokeWidth?: number;
  readonly dash?: readonly number[];
}

export type ScenePathCommand =
  | { readonly type: 'move'; readonly to: ScenePoint }
  | { readonly type: 'line'; readonly to: ScenePoint }
  | { readonly type: 'quadratic'; readonly control: ScenePoint; readonly to: ScenePoint }
  | {
      readonly type: 'cubic';
      readonly control1: ScenePoint;
      readonly control2: ScenePoint;
      readonly to: ScenePoint;
    }
  | { readonly type: 'close' };

export interface SceneMarker {
  readonly type: 'arrow' | 'open-arrow' | 'diamond' | 'circle' | 'bar' | 'crow-foot';
  readonly size: number;
  readonly fill: string;
}

export interface ScenePathItem extends SceneItemBase {
  readonly type: 'path';
  readonly commands: readonly ScenePathCommand[];
  readonly fill?: string;
  readonly fillOpacity?: number;
  readonly stroke?: string;
  readonly strokeOpacity?: number;
  readonly strokeWidth?: number;
  readonly dash?: readonly number[];
  readonly lineCap?: 'butt' | 'round' | 'square';
  readonly lineJoin?: 'bevel' | 'miter' | 'round';
  readonly markerStart?: SceneMarker;
  readonly markerEnd?: SceneMarker;
  /** Desired screen-space stroke width below the minimal-detail threshold. */
  readonly lowZoomStrokeWidth?: number;
}

export interface SceneTextItem extends SceneItemBase {
  readonly type: 'text';
  readonly value: string;
  readonly at: ScenePoint;
  readonly fill: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight?: number;
  readonly fontStyle?: 'normal' | 'italic';
  readonly underline?: boolean;
  readonly letterSpacing?: number;
  readonly anchor?: 'start' | 'middle' | 'end';
}

export interface SceneDotGridItem extends SceneItemBase {
  readonly type: 'dot-grid';
  readonly frame: SceneRect;
  readonly step: number;
  readonly offset: ScenePoint;
  readonly radius: number;
  readonly fill: string;
  readonly fillOpacity: number;
}

export type SceneItem =
  | SceneGroup
  | SceneRectItem
  | SceneCircleItem
  | SceneEllipseItem
  | ScenePolygonItem
  | ScenePathItem
  | SceneTextItem
  | SceneDotGridItem;

export type SceneClipItem =
  | SceneRectItem
  | SceneCircleItem
  | SceneEllipseItem
  | ScenePolygonItem
  | ScenePathItem;

export interface SceneClip {
  readonly items: readonly SceneClipItem[];
}

export interface SceneDescription {
  readonly version: typeof SCENE_VERSION;
  readonly bounds: SceneRect;
  readonly title: string;
  readonly description: string;
  /** Fully resolved, deterministic display list in paint order. */
  readonly items: readonly SceneItem[];
  /** Disposable connector geometry for hit testing and editor affordances. */
  readonly connectors?: readonly SceneConnectorGeometry[];
}

export interface SceneConnectorGeometry {
  readonly edgeId: string;
  readonly mode: 'orthogonal' | 'straight' | 'curved';
  readonly from: SceneConnectorAnchor;
  readonly to: SceneConnectorAnchor;
  readonly points: readonly ScenePoint[];
  readonly commands: readonly ScenePathCommand[];
}

export type SceneShapeResolver = (
  libraryId: string,
  entryId: string,
) => ResolveLibraryShapeResult | undefined;

export interface SceneBuildOptions {
  readonly shapeResolver?: SceneShapeResolver;
  readonly pageId?: string;
  readonly width?: number;
  readonly height?: number;
  readonly firstOpen?: boolean;
  /** Force preview routing or honor each edge's persisted obstacle preference. */
  readonly routingStrategy?: 'fast' | 'obstacle' | 'document';
}

const PALETTE = {
  paper: '#F4F7FB',
  ink: '#10213A',
  orange: '#FF6A3D',
  blue: '#2D62E8',
  teal: '#00A7A5',
  slate: '#64748B',
  sourceSurface: '#FFF8F5',
  fabricSurface: '#F0FBFA',
  targetSurface: '#F4F7FF',
  operationsSurface: '#F7F9FC',
  white: '#FFFFFF',
} as const;

type Bounds = SceneRect;

export interface SceneConnectorAnchor extends ScenePoint {
  readonly side: 'north' | 'south' | 'east' | 'west';
}

type Side = SceneConnectorAnchor['side'];
type Anchor = SceneConnectorAnchor;

interface RoutedEdge {
  readonly edge: Edge;
  readonly style: EdgeStyle;
  readonly points: readonly ScenePoint[];
  readonly commands: readonly ScenePathCommand[];
}

interface NodeStyle {
  readonly accent: string;
  readonly surface: string;
  readonly borderWidth?: number;
  readonly borderDash?: readonly number[];
  readonly cornerRadius?: number;
  readonly opacity: number;
  readonly shadowStrength: number;
}

interface EdgeStyle {
  readonly stroke: string;
  readonly label: string;
  readonly dash?: readonly number[];
}

interface ZonePanel {
  readonly id: string;
  readonly entityId: string;
  readonly label: string;
  readonly accent: string;
  readonly bounds: Bounds;
}

const DEFAULT_NODE_SIZE: Record<string, { readonly width: number; readonly height: number }> = {
  system: { width: 310, height: 230 },
  service: { width: 300, height: 154 },
  database: { width: 300, height: 154 },
  control: { width: 310, height: 128 },
};

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function compareNodePaintOrder(
  document: OpenChartDocument,
  left: Node,
  right: Node,
): number {
  const zIndex =
    (document.layout.overrides[left.id]?.zIndex ?? 0) -
    (document.layout.overrides[right.id]?.zIndex ?? 0);
  return zIndex === 0 ? compareIds(left.id, right.id) : zIndex;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: unknown, key: string): string | undefined {
  if (!isRecord(record)) {
    return undefined;
  }
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readNumber(record: unknown, key: string): number | undefined {
  if (!isRecord(record)) {
    return undefined;
  }
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readCapabilities(record: unknown): readonly string[] {
  if (!isRecord(record) || !Array.isArray(record.capabilities)) {
    return [];
  }
  return record.capabilities
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .slice(0, 3);
}

function textValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function nodeAriaLabel(node: Node, fallback: string): string {
  return textValue(node.data.altText).trim() || fallback;
}

function safeColor(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const color = value.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(color)) {
    return color;
  }
  return /^[a-z][a-z0-9_-]{0,31}$/i.test(color) ? color : undefined;
}

function documentThemeColors(document: OpenChartDocument): ReadonlyMap<string, string> {
  const tokens = document.theme?.tokens;
  if (tokens === undefined) {
    return new Map();
  }
  const color = (key: string, fallback: string): string =>
    safeColor(readString(tokens, key)) ?? fallback;
  return new Map([
    [PALETTE.paper, color('canvas', PALETTE.paper)],
    [PALETTE.white, color('surface', PALETTE.white)],
    [PALETTE.ink, color('textHi', PALETTE.ink)],
    [PALETTE.slate, color('textMid', PALETTE.slate)],
    [PALETTE.blue, color('compute', PALETTE.blue)],
    [PALETTE.teal, color('data', PALETTE.teal)],
    [PALETTE.orange, color('identity', PALETTE.orange)],
    [PALETTE.sourceSurface, color('identityTint', PALETTE.sourceSurface)],
    [PALETTE.fabricSurface, color('dataTint', PALETTE.fabricSurface)],
    [PALETTE.targetSurface, color('computeTint', PALETTE.targetSurface)],
    [PALETTE.operationsSurface, color('networkTint', PALETTE.operationsSurface)],
  ]);
}

function documentThemeTypeFloor(document: OpenChartDocument): number {
  const value = document.theme?.tokens.typeFloor;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(10, value)
    : 10;
}

function themedColor(value: string, colors: ReadonlyMap<string, string>): string {
  return colors.get(value) ?? value;
}

function themeClipItem(item: SceneClipItem, colors: ReadonlyMap<string, string>): SceneClipItem {
  switch (item.type) {
    case 'path':
      return {
        ...item,
        ...(item.fill === undefined ? {} : { fill: themedColor(item.fill, colors) }),
        ...(item.stroke === undefined ? {} : { stroke: themedColor(item.stroke, colors) }),
        ...(item.markerStart === undefined
          ? {}
          : { markerStart: { ...item.markerStart, fill: themedColor(item.markerStart.fill, colors) } }),
        ...(item.markerEnd === undefined
          ? {}
          : { markerEnd: { ...item.markerEnd, fill: themedColor(item.markerEnd.fill, colors) } }),
      };
    case 'rect':
    case 'circle':
    case 'ellipse':
    case 'polygon':
      return {
        ...item,
        ...(item.fill === undefined ? {} : { fill: themedColor(item.fill, colors) }),
        ...(item.stroke === undefined ? {} : { stroke: themedColor(item.stroke, colors) }),
      };
  }
}

function themeSceneItem(
  item: SceneItem,
  colors: ReadonlyMap<string, string>,
  typeFloor: number,
): SceneItem {
  switch (item.type) {
    case 'group':
      return {
        ...item,
        ...(item.clip === undefined
          ? {}
          : { clip: { items: item.clip.items.map((clipItem) => themeClipItem(clipItem, colors)) } }),
        children: item.children.map((child) => themeSceneItem(child, colors, typeFloor)),
      };
    case 'text':
      return {
        ...item,
        fill: themedColor(item.fill, colors),
        fontSize: Math.max(item.fontSize, typeFloor),
      };
    case 'dot-grid':
      return { ...item, fill: themedColor(item.fill, colors) };
    case 'path': {
      const themed = themeClipItem(item, colors);
      return themed;
    }
    case 'rect':
    case 'circle':
    case 'ellipse':
    case 'polygon':
      return themeClipItem(item, colors);
  }
}

function safeDash(value: unknown): readonly number[] | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const dash = value.trim();
  if (!/^\d+(?:\s+\d+)*$/.test(dash)) {
    return undefined;
  }
  const values = dash.split(/\s+/).map(Number);
  return values.every((entry) => Number.isFinite(entry)) ? values : undefined;
}

function sanitizeId(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_.-]/g, '-');
  return /^[A-Za-z_]/.test(sanitized) ? sanitized : `id-${sanitized}`;
}

function validateDimension(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Scene ${name} must be a finite positive number`);
  }
  return value;
}

function chooseDimension(
  explicit: number | undefined,
  layoutValue: unknown,
  fallback: number,
  name: string,
): number {
  if (explicit !== undefined) {
    return validateDimension(explicit, name);
  }
  if (typeof layoutValue === 'number') {
    return validateDimension(layoutValue, name);
  }
  return fallback;
}

function selectPage(document: OpenChartDocument, pageId: string | undefined): Page {
  if (pageId !== undefined) {
    const selected = document.pages[pageId];
    if (selected === undefined) {
      throw new Error(`Scene page ${JSON.stringify(pageId)} does not exist`);
    }
    return selected;
  }

  const firstPage = Object.values(document.pages).sort((left, right) => {
    const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;
    return leftOrder === rightOrder
      ? compareIds(left.id, right.id)
      : leftOrder - rightOrder;
  })[0];
  if (firstPage === undefined) {
    throw new Error('Scene document does not contain a page');
  }
  return firstPage;
}

function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function positiveOrUndefined(value: unknown): number | undefined {
  const number = finiteOrUndefined(value);
  return number !== undefined && number > 0 ? number : undefined;
}

function defaultSizeForKind(kind: string): { readonly width: number; readonly height: number } {
  return DEFAULT_NODE_SIZE[kind] ?? { width: 280, height: 148 };
}

function gridFallback(
  index: number,
  count: number,
  kind: string,
  canvasWidth: number,
  canvasHeight: number,
): Bounds {
  const columns = Math.max(1, Math.min(3, count));
  const marginX = Math.max(40, Math.min(86, canvasWidth * 0.08));
  const gapX = Math.max(28, Math.min(56, canvasWidth * 0.04));
  const top = Math.max(176, Math.min(246, canvasHeight * 0.2));
  const gapY = Math.max(32, Math.min(56, canvasHeight * 0.045));
  const cellWidth = Math.max(1, (canvasWidth - marginX * 2 - gapX * (columns - 1)) / columns);
  const defaults = defaultSizeForKind(kind);
  const width = Math.min(defaults.width, Math.max(140, cellWidth - 14));
  const col = index % columns;
  const row = Math.floor(index / columns);
  const maxHeight = Math.max(112, canvasHeight - top - 70);
  const height = Math.min(defaults.height, maxHeight);

  return {
    x: marginX + col * (cellWidth + gapX),
    y: top + row * (defaults.height + gapY),
    width,
    height,
  };
}

function resolveBounds(
  node: Node,
  index: number,
  count: number,
  canvasWidth: number,
  canvasHeight: number,
  overrides: Readonly<Record<string, LayoutOverride>>,
  derived: Readonly<Record<string, LayoutFrame>>,
): Bounds {
  const fallback = gridFallback(index, count, textValue(node.kind, 'node'), canvasWidth, canvasHeight);
  const derivedFrame = derived[node.id];
  const explicit = overrides[node.id];
  const override = derivedFrame === undefined || explicit?.pinned === true ? explicit : undefined;
  return {
    x: finiteOrUndefined(override?.x) ?? finiteOrUndefined(derivedFrame?.x) ?? fallback.x,
    y: finiteOrUndefined(override?.y) ?? finiteOrUndefined(derivedFrame?.y) ?? fallback.y,
    width: positiveOrUndefined(override?.width) ?? positiveOrUndefined(derivedFrame?.width) ?? fallback.width,
    height: positiveOrUndefined(override?.height) ?? positiveOrUndefined(derivedFrame?.height) ?? fallback.height,
  };
}

function fallbackNodeAccent(node: Node, style: Style | undefined): string {
  const role = textValue(style?.role).toLowerCase();
  if (role.includes('source')) {
    return PALETTE.orange;
  }
  if (role.includes('target')) {
    return PALETTE.blue;
  }
  if (role.includes('fabric') || role.includes('integration')) {
    return PALETTE.teal;
  }
  if (role.includes('operation') || role.includes('control')) {
    return PALETTE.slate;
  }
  switch (textValue(node.kind, 'node').toLowerCase()) {
    case 'system':
      return PALETTE.orange;
    case 'service':
    case 'database':
      return PALETTE.teal;
    case 'control':
      return PALETTE.slate;
    default:
      return PALETTE.blue;
  }
}

function fallbackNodeSurface(node: Node, style: Style | undefined): string {
  const role = textValue(style?.role).toLowerCase();
  if (role.includes('source')) {
    return PALETTE.sourceSurface;
  }
  if (role.includes('target')) {
    return PALETTE.targetSurface;
  }
  if (role.includes('operation') || role.includes('control')) {
    return PALETTE.operationsSurface;
  }
  switch (textValue(node.kind, 'node').toLowerCase()) {
    case 'system':
      return PALETTE.sourceSurface;
    case 'service':
    case 'database':
      return PALETTE.fabricSurface;
    case 'control':
      return PALETTE.operationsSurface;
    default:
      return PALETTE.white;
  }
}

function nodeBorderDash(node: Node): readonly number[] | undefined {
  const pattern = readString(node.data, 'borderStyle');
  return pattern === 'dashed' ? [8, 6] : pattern === 'dotted' ? [2, 5] : undefined;
}

function nodeStyle(node: Node, style: Style | undefined): NodeStyle {
  const borderDash = nodeBorderDash(node);
  const borderWidth = readNumber(node.data, 'borderWidth');
  const cornerRadius = readNumber(node.data, 'cornerRadius');
  return {
    accent:
      safeColor(readString(node.data, 'borderColor')) ??
      safeColor(readString(style?.tokens, 'accent')) ??
      fallbackNodeAccent(node, style),
    surface:
      safeColor(readString(node.data, 'fillColor')) ??
      safeColor(readString(style?.tokens, 'surface')) ??
      fallbackNodeSurface(node, style),
    ...(borderWidth === undefined ? {} : { borderWidth: clamp(borderWidth, 0.5, 10) }),
    ...(borderDash === undefined ? {} : { borderDash }),
    ...(cornerRadius === undefined ? {} : { cornerRadius: clamp(cornerRadius, 0, 64) }),
    opacity: clamp(readNumber(node.data, 'opacity') ?? 1, 0.1, 1),
    shadowStrength: node.data.shadowEnabled === true
      ? clamp(readNumber(node.data, 'shadowStrength') ?? 0.45, 0, 1)
      : 0,
  };
}

function nodeShadow(node: Node, bounds: Bounds, style: NodeStyle): SceneRectItem | undefined {
  if (style.shadowStrength <= 0) return undefined;
  const offset = 2 + style.shadowStrength * 6;
  return {
    type: 'rect',
    id: `node-${sanitizeId(node.id)}-shadow`,
    frame: { x: bounds.x + offset, y: bounds.y + offset, width: bounds.width, height: bounds.height },
    radius: style.cornerRadius ?? 10,
    fill: '#0F172A',
    fillOpacity: 0.08 + style.shadowStrength * 0.18,
  };
}

function isConnectorAnchorNode(node: Node): boolean {
  return node.kind === 'connector-anchor' && node.data.connectorAnchor === true;
}

function renderAnchorNode(node: Node, bounds: Bounds, style: NodeStyle): SceneGroup {
  const nodeId = `node-${sanitizeId(node.id)}`;
  return {
    type: 'group',
    id: nodeId,
    role: 'node',
    entityId: node.id,
    ariaLabel: nodeAriaLabel(node, node.label),
    opacity: style.opacity,
    children: [
      {
        type: 'circle',
        id: `${nodeId}-anchor`,
        center: nodeCenter(bounds),
        radius: 4,
        fill: style.accent,
      },
    ],
  };
}

function restyleLibraryItem(item: SceneItem, node: Node, bounds: Bounds, style: NodeStyle): SceneItem {
  if (item.type === 'group') {
    return { ...item, children: item.children.map((child) => restyleLibraryItem(child, node, bounds, style)) };
  }
  if (item.type === 'text' && item.value === node.label) {
    const fontFamily = readString(node.data, 'fontFamily');
    const fontSize = readNumber(node.data, 'fontSize');
    const fontWeight = readNumber(node.data, 'fontWeight');
    const textColor = safeColor(node.data.textColor);
    const alignment = readString(node.data, 'textAlign');
    return {
      ...item,
      ...(fontFamily === undefined ? {} : { fontFamily }),
      ...(fontSize === undefined ? {} : { fontSize: clamp(fontSize, 8, 96) }),
      ...(fontWeight === undefined ? {} : { fontWeight: clamp(fontWeight, 100, 900) }),
      ...(readString(node.data, 'fontStyle') === 'italic' ? { fontStyle: 'italic' as const } : {}),
      ...(node.data.underline === true ? { underline: true } : {}),
      ...(textColor === undefined ? {} : { fill: textColor }),
      ...(alignment === 'center' ? { anchor: 'middle' as const } : alignment === 'right' ? { anchor: 'end' as const } : alignment === 'left' ? { anchor: 'start' as const } : {}),
    };
  }
  const mainStroke = 'stroke' in item && item.stroke === style.accent;
  if (!mainStroke) return item;
  const borderStyle = readString(node.data, 'borderStyle');
  if (item.type === 'rect') {
    const isMainBody = item.frame.width >= bounds.width * 0.75 && item.frame.height >= bounds.height * 0.45;
    if (borderStyle === 'solid') {
      const rest = { ...item };
      delete rest.dash;
      return {
        ...rest,
        ...(style.borderWidth === undefined ? {} : { strokeWidth: style.borderWidth }),
        ...(style.cornerRadius === undefined || !isMainBody ? {} : { radius: style.cornerRadius }),
      };
    }
    return {
      ...item,
      ...(style.borderWidth === undefined ? {} : { strokeWidth: style.borderWidth }),
      ...(style.cornerRadius === undefined || !isMainBody ? {} : { radius: style.cornerRadius }),
      ...((borderStyle === 'dashed' || borderStyle === 'dotted') && style.borderDash !== undefined ? { dash: style.borderDash } : {}),
    };
  }
  if (item.type === 'circle' || item.type === 'ellipse' || item.type === 'polygon' || item.type === 'path') {
    if (borderStyle === 'solid') {
      const rest = { ...item };
      delete rest.dash;
      return {
        ...rest,
        ...(style.borderWidth === undefined ? {} : { strokeWidth: style.borderWidth }),
      };
    }
    return {
      ...item,
      ...(style.borderWidth === undefined ? {} : { strokeWidth: style.borderWidth }),
      ...((borderStyle === 'dashed' || borderStyle === 'dotted') && style.borderDash !== undefined ? { dash: style.borderDash } : {}),
    };
  }
  return item;
}

function renderLibraryNode(
  node: Node,
  bounds: Bounds,
  style: NodeStyle,
  resolveShape: SceneShapeResolver,
): SceneGroup | undefined {
  const reference = node.data.shape;
  if (reference === undefined) {
    return undefined;
  }
  if (!isRecord(reference)) {
    throw new Error(`Node ${JSON.stringify(node.id)} shape reference must be an object`);
  }
  const libraryId = readString(reference, 'libraryId');
  const entryId = readString(reference, 'entryId');
  if (libraryId === undefined || entryId === undefined) {
    throw new Error(`Node ${JSON.stringify(node.id)} shape reference requires libraryId and entryId`);
  }
  const resolved = resolveShape(libraryId, entryId);
  if (resolved === undefined) {
    return undefined;
  }
  if (!resolved.ok) {
    throw new Error(
      `Node ${JSON.stringify(node.id)} shape ${JSON.stringify(`${libraryId}/${entryId}`)} could not be resolved: ${JSON.stringify(resolved.diagnostics)}`,
    );
  }
  const propertyNames = new Set(resolved.definition.properties?.map(({ name }) => name));
  const data: Record<string, string> = {};
  if (propertyNames.has('Label')) {
    data.Label = node.label;
  }
  if (propertyNames.has('Accent')) {
    data.Accent = style.accent;
  }
  if (propertyNames.has('Surface')) {
    data.Surface = style.surface;
  }
  if (propertyNames.has('Color')) {
    data.Color = style.accent;
  }
  const evaluated = evaluateShapeDefinition(resolved.definition, { frame: bounds, data });
  if (!evaluated.ok) {
    throw new Error(
      `Node ${JSON.stringify(node.id)} shape ${JSON.stringify(`${libraryId}/${entryId}`)} could not be evaluated: ${JSON.stringify(evaluated.diagnostics)}`,
    );
  }
  const group = evaluatedShapeToSceneGroup({ id: node.id, shape: evaluated.shape });
  const shadow = nodeShadow(node, bounds, style);
  return {
    ...group,
    role: 'node',
    entityId: node.id,
    ariaLabel: nodeAriaLabel(node, node.label),
    opacity: style.opacity,
    children: [
      ...(shadow === undefined ? [] : [shadow]),
      ...group.children.map((item) => restyleLibraryItem(item, node, bounds, style)),
    ],
  };
}

function fallbackEdgeStroke(edge: Edge, style: Style | undefined): string {
  const role = `${textValue(style?.role)} ${edge.styleId}`.toLowerCase();
  if (role.includes('outbound') || role.includes('master')) {
    return PALETTE.orange;
  }
  if (role.includes('control') || role.includes('evidence')) {
    return PALETTE.teal;
  }
  if (role.includes('inbound') || role.includes('transaction')) {
    return PALETTE.blue;
  }
  return PALETTE.slate;
}

function edgeStyle(edge: Edge, style: Style | undefined): EdgeStyle {
  const role = textValue(style?.role, edge.styleId || 'flow');
  const common = {
    stroke: safeColor(edge.data.strokeColor) ?? safeColor(readString(style?.tokens, 'stroke')) ?? fallbackEdgeStroke(edge, style),
    label: readString(style?.tokens, 'label') ?? role,
  };
  const dash = safeDash(readString(style?.tokens, 'dash'));
  return dash === undefined ? common : { ...common, dash };
}

const PORT_SIDES: readonly Side[] = ['north', 'south', 'east', 'west'];

function comparePortOrder(left: Port, right: Port): number {
  const order = (left.order ?? Number.MAX_SAFE_INTEGER) -
    (right.order ?? Number.MAX_SAFE_INTEGER);
  return order !== 0 ? order : compareIds(left.id, right.id);
}

function portAnchorKey(portId: string, side: Side): string {
  return `${portId}:${side}`;
}

function anchorOnSide(bounds: Bounds, side: Side, fraction: number): Anchor {
  if (side === 'north') {
    return { x: bounds.x + bounds.width * fraction, y: bounds.y, side };
  }
  if (side === 'south') {
    return {
      x: bounds.x + bounds.width * fraction,
      y: bounds.y + bounds.height,
      side,
    };
  }
  if (side === 'west') {
    return { x: bounds.x, y: bounds.y + bounds.height * fraction, side };
  }
  return {
    x: bounds.x + bounds.width,
    y: bounds.y + bounds.height * fraction,
    side,
  };
}

function buildPortAnchors(
  ports: readonly Port[],
  boundsByNode: ReadonlyMap<string, Bounds>,
): ReadonlyMap<string, Anchor> {
  const portsByNode = new Map<string, Port[]>();
  for (const port of ports) {
    if (!boundsByNode.has(port.nodeId)) {
      continue;
    }
    const nodePorts = portsByNode.get(port.nodeId) ?? [];
    nodePorts.push(port);
    portsByNode.set(port.nodeId, nodePorts);
  }

  const anchors = new Map<string, Anchor>();
  for (const [nodeId, nodePorts] of portsByNode) {
    const bounds = boundsByNode.get(nodeId);
    if (bounds === undefined) {
      continue;
    }
    for (const side of PORT_SIDES) {
      const sidePorts = nodePorts
        .filter((port) => port.side === side || port.side === 'auto')
        .sort(comparePortOrder);
      sidePorts.forEach((port, index) => {
        anchors.set(
          portAnchorKey(port.id, side),
          anchorOnSide(bounds, side, (index + 1) / (sidePorts.length + 1)),
        );
      });
    }
  }
  return anchors;
}

function nodeCenter(bounds: Bounds): ScenePoint {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

function autoPortSide(
  port: Port,
  otherPort: Port,
  boundsByNode: ReadonlyMap<string, Bounds>,
): Side {
  const bounds = boundsByNode.get(port.nodeId);
  const otherBounds = boundsByNode.get(otherPort.nodeId);
  if (bounds === undefined || otherBounds === undefined) {
    return 'east';
  }
  const center = nodeCenter(bounds);
  const otherCenter = nodeCenter(otherBounds);
  const deltaX = otherCenter.x - center.x;
  const deltaY = otherCenter.y - center.y;
  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return deltaX >= 0 ? 'east' : 'west';
  }
  return deltaY >= 0 ? 'south' : 'north';
}

function resolvePortAnchor(
  port: Port,
  otherPort: Port,
  anchors: ReadonlyMap<string, Anchor>,
  boundsByNode: ReadonlyMap<string, Bounds>,
): Anchor | undefined {
  const side = port.side === 'auto' ? autoPortSide(port, otherPort, boundsByNode) : port.side;
  return anchors.get(portAnchorKey(port.id, side));
}

function sideVector(side: Side): ScenePoint {
  switch (side) {
    case 'north':
      return { x: 0, y: -1 };
    case 'south':
      return { x: 0, y: 1 };
    case 'west':
      return { x: -1, y: 0 };
    default:
      return { x: 1, y: 0 };
  }
}

function pushDistinct(points: ScenePoint[], point: ScenePoint): void {
  const previous = points[points.length - 1];
  if (previous === undefined || previous.x !== point.x || previous.y !== point.y) {
    points.push(point);
  }
}

function simplifyRoutePoints(points: readonly ScenePoint[]): readonly ScenePoint[] {
  const result: ScenePoint[] = [];
  for (const point of points) {
    pushDistinct(result, point);
    while (result.length >= 3) {
      const first = result.at(-3);
      const middle = result.at(-2);
      const last = result.at(-1);
      if (first === undefined || middle === undefined || last === undefined) {
        break;
      }
      const cross = (middle.x - first.x) * (last.y - middle.y) -
        (middle.y - first.y) * (last.x - middle.x);
      if (Math.abs(cross) > 1e-9) {
        break;
      }
      result.splice(result.length - 2, 1);
    }
  }
  return result;
}

function offsetPoint(anchor: Anchor, amount: number): ScenePoint {
  const vector = sideVector(anchor.side);
  return {
    x: anchor.x + vector.x * amount,
    y: anchor.y + vector.y * amount,
  };
}

function resolveRoutingStrategy(
  edge: Edge,
  requested: SceneBuildOptions['routingStrategy'],
): 'fast' | 'obstacle' {
  if (requested === 'fast' || requested === 'obstacle') {
    return requested;
  }
  return edge.routing?.avoidObstacles === true ? 'obstacle' : 'fast';
}

function routeEdge(
  edge: Edge,
  from: Anchor,
  to: Anchor,
  layout: EdgeLayoutOverride | undefined,
  requestedStrategy: SceneBuildOptions['routingStrategy'],
  obstacles: readonly Bounds[],
): RouteResult {
  const mode = edge.routing?.mode ?? 'orthogonal';
  const strategy = resolveRoutingStrategy(edge, requestedStrategy);
  const routeOptions = {
    mode,
    strategy,
    obstacles,
    clearance: 10,
  } as const;
  const waypoints = layout?.waypoints ?? [];
  if (waypoints.length === 0) {
    return routeConnector({ ...routeOptions, from, to, jetty: 12 });
  }
  if (mode === 'straight') {
    return {
      ok: true,
      mode,
      strategy,
      points: simplifyRoutePoints([from, ...waypoints, to]),
    };
  }

  const routeAnchors: readonly (Anchor | ScenePoint)[] = [
    from,
    offsetPoint(from, 12),
    ...waypoints,
    offsetPoint(to, 12),
    to,
  ];
  const points: ScenePoint[] = [];
  for (let index = 1; index < routeAnchors.length; index += 1) {
    const segmentFrom = routeAnchors[index - 1];
    const segmentTo = routeAnchors[index];
    if (segmentFrom === undefined || segmentTo === undefined) {
      continue;
    }
    const segment = routeConnector({
      ...routeOptions,
      from: segmentFrom,
      to: segmentTo,
      jetty: 0,
    });
    if (!segment.ok) {
      return segment;
    }
    for (const point of segment.points) {
      pushDistinct(points, point);
    }
  }
  return {
    ok: true,
    mode,
    strategy,
    points: mode === 'curved' ? points : simplifyRoutePoints(points),
  };
}

function pathCommands(
  mode: 'orthogonal' | 'straight' | 'curved',
  points: readonly ScenePoint[],
  cornerRadius: number,
): readonly ScenePathCommand[] {
  const first = points[0];
  if (first === undefined) {
    return [];
  }
  if (mode === 'curved') {
    return [
      { type: 'move', to: first },
      ...catmullRomToCubicSegments(points).map((segment): ScenePathCommand => ({
        type: 'cubic',
        control1: segment.control1,
        control2: segment.control2,
        to: segment.end,
      })),
    ];
  }
  if (mode === 'straight') {
    return [
      { type: 'move', to: first },
      ...points.slice(1).map((point): ScenePathCommand => ({ type: 'line', to: point })),
    ];
  }
  return roundedPath(points, cornerRadius);
}

function roundedPath(points: readonly ScenePoint[], radius = 9): readonly ScenePathCommand[] {
  const first = points[0];
  if (first === undefined) {
    return [];
  }
  const commands: ScenePathCommand[] = [{ type: 'move', to: first }];
  if (points.length === 1) {
    return commands;
  }

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    if (previous === undefined || current === undefined || next === undefined) {
      continue;
    }
    const beforeDistance = Math.hypot(current.x - previous.x, current.y - previous.y);
    const afterDistance = Math.hypot(next.x - current.x, next.y - current.y);
    if (beforeDistance <= 0 || afterDistance <= 0) {
      commands.push({ type: 'line', to: current });
      continue;
    }
    const cornerRadius = Math.min(radius, beforeDistance / 2, afterDistance / 2);
    if (cornerRadius <= 0) {
      commands.push({ type: 'line', to: current });
      continue;
    }
    const before = {
      x: current.x - ((current.x - previous.x) / beforeDistance) * cornerRadius,
      y: current.y - ((current.y - previous.y) / beforeDistance) * cornerRadius,
    };
    const after = {
      x: current.x + ((next.x - current.x) / afterDistance) * cornerRadius,
      y: current.y + ((next.y - current.y) / afterDistance) * cornerRadius,
    };
    commands.push(
      { type: 'line', to: before },
      { type: 'quadratic', control: current, to: after },
    );
  }
  const last = points[points.length - 1];
  if (last !== undefined) {
    commands.push({ type: 'line', to: last });
  }
  return commands;
}

function labelPoint(points: readonly ScenePoint[]): ScenePoint {
  let best: ScenePoint = points[0] ?? { x: 0, y: 0 };
  let bestLength = -1;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (from === undefined || to === undefined) {
      continue;
    }
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length > bestLength) {
      bestLength = length;
      best = {
        x: (from.x + to.x) / 2,
        y: (from.y + to.y) / 2,
      };
      if (Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)) {
        best = { x: best.x, y: best.y - 10 };
      } else {
        best = { x: best.x + 10, y: best.y };
      }
    }
  }
  return best;
}

function edgeLabelPoint(
  points: readonly ScenePoint[],
  layout: EdgeLayoutOverride | undefined,
): ScenePoint {
  if (layout?.labelT === undefined) {
    return labelPoint(points);
  }
  const sampled = pointAtNormalizedDistance(points, layout.labelT) ?? labelPoint(points);
  const offset = layout.labelOffset ?? 0;
  switch (layout.labelPlacement ?? 'above') {
    case 'above':
      return { x: sampled.x, y: sampled.y - 10 - offset };
    case 'below':
      return { x: sampled.x, y: sampled.y + 10 + offset };
    case 'on':
      return { x: sampled.x, y: sampled.y + offset };
  }
}

function nodeKindClass(node: Node): string {
  const kind = textValue(node.kind, 'node').toLowerCase();
  return ['system', 'service', 'database', 'control'].includes(kind) ? kind : 'node';
}

function estimateTextWidth(value: string, characterWidth = 6.2): number {
  return Math.max(20, value.length * characterWidth);
}

function ellipsis(value: string, maxWidth: number, characterWidth = 6.2): string {
  if (value.length === 0 || estimateTextWidth(value, characterWidth) <= maxWidth) {
    return value;
  }
  const maxCharacters = Math.max(1, Math.floor(maxWidth / characterWidth) - 1);
  return `${value.slice(0, maxCharacters).trimEnd()}…`;
}

function wrapText(value: string, maxWidth: number, characterWidth: number, maxLines: number): readonly string[] {
  const trimmed = value.trim();
  if (trimmed.length === 0 || estimateTextWidth(trimmed, characterWidth) <= maxWidth) {
    return [trimmed];
  }
  const maxCharacters = Math.max(1, Math.floor(maxWidth / characterWidth));
  const lines: string[] = [];
  let remaining = trimmed;
  while (remaining.length > 0 && lines.length < maxLines) {
    if (lines.length === maxLines - 1) {
      lines.push(ellipsis(remaining, maxWidth, characterWidth));
      break;
    }
    if (remaining.length <= maxCharacters) {
      lines.push(remaining);
      break;
    }
    const candidate = remaining.slice(0, maxCharacters + 1);
    const breakAt = candidate.lastIndexOf(' ');
    const lineEnd = breakAt > 0 ? breakAt : maxCharacters;
    lines.push(remaining.slice(0, lineEnd).trimEnd());
    remaining = remaining.slice(lineEnd).trimStart();
  }
  return lines;
}

function glyphGroup(node: Node, bounds: Bounds, accent: string): SceneGroup {
  const kind = nodeKindClass(node);
  const x = bounds.x + 19;
  const y = bounds.y + 18;
  const id = `node-${sanitizeId(node.id)}-glyph`;
  const children: SceneItem[] = [];
  if (kind === 'system') {
    children.push({
      type: 'rect',
      id: `${id}-box`,
      frame: { x, y, width: 24, height: 24 },
      radius: 4,
      fill: accent,
      fillOpacity: 0.14,
      stroke: accent,
      strokeWidth: 1.5,
    });
    children.push({
      type: 'path',
      id: `${id}-lines`,
      commands: [
        { type: 'move', to: { x: x + 6, y: y + 8 } },
        { type: 'line', to: { x: x + 18, y: y + 8 } },
        { type: 'move', to: { x: x + 6, y: y + 14 } },
        { type: 'line', to: { x: x + 18, y: y + 14 } },
        { type: 'move', to: { x: x + 6, y: y + 20 } },
        { type: 'line', to: { x: x + 14, y: y + 20 } },
      ],
      fill: 'none',
      stroke: accent,
      strokeWidth: 1.5,
      lineCap: 'round',
    });
  } else if (kind === 'service') {
    children.push({
      type: 'rect',
      id: `${id}-box`,
      frame: { x, y, width: 24, height: 24 },
      radius: 7,
      fill: accent,
      fillOpacity: 0.14,
      stroke: accent,
      strokeWidth: 1.5,
    });
    children.push(
      { type: 'circle', id: `${id}-dot-a`, center: { x: x + 8, y: y + 12 }, radius: 2.5, fill: accent },
      { type: 'circle', id: `${id}-dot-b`, center: { x: x + 16, y: y + 12 }, radius: 2.5, fill: accent },
      {
        type: 'path',
        id: `${id}-link`,
        commands: [
          { type: 'move', to: { x: x + 8, y: y + 12 } },
          { type: 'line', to: { x: x + 16, y: y + 12 } },
        ],
        fill: 'none',
        stroke: accent,
        strokeWidth: 1.5,
      },
    );
  } else if (kind === 'database') {
    children.push({
      type: 'rect',
      id: `${id}-body`,
      frame: { x: x + 1, y: y + 6, width: 22, height: 12 },
      fill: accent,
      fillOpacity: 0.08,
      stroke: accent,
      strokeWidth: 1.5,
    });
    children.push(
      {
        type: 'ellipse',
        id: `${id}-top`,
        center: { x: x + 12, y: y + 6 },
        radiusX: 11,
        radiusY: 5,
        fill: accent,
        fillOpacity: 0.14,
        stroke: accent,
        strokeWidth: 1.5,
      },
      {
        type: 'ellipse',
        id: `${id}-bottom`,
        center: { x: x + 12, y: y + 18 },
        radiusX: 11,
        radiusY: 5,
        fill: accent,
        fillOpacity: 0.08,
        stroke: accent,
        strokeWidth: 1,
      },
    );
  } else if (kind === 'control') {
    children.push({
      type: 'polygon',
      id: `${id}-diamond`,
      points: [
        { x: x + 12, y },
        { x: x + 24, y: y + 12 },
        { x: x + 12, y: y + 24 },
        { x, y: y + 12 },
      ],
      fill: accent,
      fillOpacity: 0.14,
      stroke: accent,
      strokeWidth: 1.5,
    });
    children.push({
      type: 'circle',
      id: `${id}-core`,
      center: { x: x + 12, y: y + 12 },
      radius: 3,
      fill: accent,
    });
  } else {
    children.push({
      type: 'circle',
      id: `${id}-circle`,
      center: { x: x + 12, y: y + 12 },
      radius: 12,
      fill: accent,
      fillOpacity: 0.14,
      stroke: accent,
      strokeWidth: 1.5,
    });
  }
  return { type: 'group', id, role: 'glyph', entityId: node.id, minZoom: 0.5, children };
}

function renderNode(node: Node, bounds: Bounds, style: NodeStyle): SceneGroup {
  if (isConnectorAnchorNode(node)) {
    return renderAnchorNode(node, bounds, style);
  }
  const data = node.data;
  const label = textValue(node.label, node.id);
  const kindClass = nodeKindClass(node);
  const eyebrow = readString(data, 'eyebrow');
  const subtitle = readString(data, 'subtitle');
  const status = readString(data, 'status');
  const capabilities = readCapabilities(data);
  const nodeId = `node-${sanitizeId(node.id)}`;
  const titleSize = clamp(readNumber(data, 'fontSize') ?? (kindClass === 'system' ? 20 : 18), 8, 96);
  const titleWeight = clamp(readNumber(data, 'fontWeight') ?? 700, 100, 900);
  const titleStyle = readString(data, 'fontStyle') === 'italic' ? 'italic' : 'normal';
  const titleFontFamily = readString(data, 'fontFamily') ?? 'Aptos Display, Segoe UI, sans-serif';
  const titleUnderline = data.underline === true;
  const titleAlignment = readString(data, 'textAlign');
  const titleAnchor: SceneTextItem['anchor'] = titleAlignment === 'center'
    ? 'middle'
    : titleAlignment === 'right'
      ? 'end'
      : 'start';
  const titleFill = safeColor(data.textColor) ?? (readString(data, 'link') === undefined ? PALETTE.ink : PALETTE.blue);
  const titleY = bounds.y + 59;
  const titleLineHeight = Math.max(
    18,
    Math.round(titleSize * clamp(readNumber(data, 'lineHeight') ?? 1.15, 0.8, 3)),
  );
  const titleLines = wrapText(label, Math.max(20, bounds.width - 40), titleSize * 0.48, 2);
  const titleBottomY = titleY + Math.max(0, titleLines.length - 1) * titleLineHeight;
  const subtitleY = titleBottomY + 23;
  const capabilityStart = titleBottomY + (subtitle === undefined ? 34 : 50);
  const visualSubtitle = subtitle === undefined ? undefined : ellipsis(subtitle, Math.max(20, bounds.width - 40), 6.4);
  const capabilityBottom = bounds.y + bounds.height - 8;
  const statusWidth = status === undefined ? 0 : Math.min(
    Math.max(54, estimateTextWidth(status, 5.7) + 18),
    Math.max(0, bounds.width - 38),
  );
  const statusX = bounds.x + bounds.width - statusWidth - 18;
  const children: SceneItem[] = [];
  const shadow = nodeShadow(node, bounds, style);
  if (shadow !== undefined) children.push(shadow);
  children.push(
    {
      type: 'rect',
      id: `${nodeId}-card`,
      frame: bounds,
      radius: style.cornerRadius ?? 10,
      fill: style.surface,
      stroke: style.accent,
      strokeWidth: style.borderWidth ?? 1.5,
      ...(style.borderDash === undefined ? {} : { dash: style.borderDash }),
      chromeCacheKey: kindClass,
    },
    {
      type: 'rect',
      id: `${nodeId}-accent`,
      frame: { x: bounds.x, y: bounds.y, width: 5, height: bounds.height },
      radius: 2.5,
      fill: style.accent,
      minZoom: 0.15,
    },
    glyphGroup(node, bounds, style.accent),
  );
  const labels: SceneItem[] = [];
  if (eyebrow !== undefined) {
    labels.push({
      type: 'text',
      id: `${nodeId}-eyebrow`,
      value: eyebrow.toUpperCase(),
      at: { x: bounds.x + 57, y: bounds.y + 28 },
      fill: PALETTE.slate,
      fontFamily: 'Cascadia Code, Consolas, monospace',
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: 1.2,
      minZoom: 0.75,
    });
  }
  for (let index = 0; index < titleLines.length; index += 1) {
    labels.push({
      type: 'text',
      id: index === 0 ? `${nodeId}-title` : `${nodeId}-title-${index + 1}`,
      value: titleLines[index] ?? '',
      at: {
        x: titleAnchor === 'middle'
          ? bounds.x + bounds.width / 2
          : titleAnchor === 'end'
            ? bounds.x + bounds.width - 20
            : bounds.x + 20,
        y: titleY + index * titleLineHeight,
      },
      fill: titleFill,
      fontFamily: titleFontFamily,
      fontSize: titleSize,
      fontWeight: titleWeight,
      fontStyle: titleStyle,
      ...(titleUnderline ? { underline: true } : {}),
      anchor: titleAnchor,
      minZoom: 0.4,
    });
  }
  if (subtitle !== undefined) {
    labels.push({
      type: 'text',
      id: `${nodeId}-subtitle`,
      value: visualSubtitle ?? '',
      at: { x: bounds.x + 20, y: subtitleY },
      fill: PALETTE.slate,
      fontFamily: 'Segoe UI, Arial, sans-serif',
      fontSize: 12,
      minZoom: 0.75,
    });
  }
  if (status !== undefined && statusWidth > 0) {
    labels.push(
      {
        type: 'rect',
        id: `${nodeId}-status-bg`,
        frame: { x: statusX, y: bounds.y + 18, width: statusWidth, height: 20 },
        radius: 10,
        fill: style.accent,
        fillOpacity: 0.13,
        minZoom: 0.75,
      },
      {
        type: 'text',
        id: `${nodeId}-status`,
        value: status.toUpperCase(),
        at: { x: statusX + statusWidth / 2, y: bounds.y + 31.5 },
        fill: style.accent,
        fontFamily: 'Cascadia Code, Consolas, monospace',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: 0.6,
        anchor: 'middle',
        minZoom: 0.75,
      },
    );
  }
  for (let index = 0; index < capabilities.length; index += 1) {
    const capability = capabilities[index];
    if (capability === undefined) {
      continue;
    }
    const y = capabilityStart + index * 19;
    if (y > capabilityBottom) {
      break;
    }
    labels.push(
      {
        type: 'circle',
        id: `${nodeId}-capability-dot-${index}`,
        center: { x: bounds.x + 24, y: y - 4 },
        radius: 2.5,
        fill: style.accent,
        minZoom: 0.75,
      },
      {
        type: 'text',
        id: `${nodeId}-capability-${index}`,
        value: ellipsis(capability, Math.max(20, bounds.width - 52), 5.8),
        at: { x: bounds.x + 34, y },
        fill: PALETTE.ink,
        fontFamily: 'Segoe UI, Arial, sans-serif',
        fontSize: 11,
        minZoom: 0.75,
      },
    );
  }
  children.push({
    type: 'group',
    id: `${nodeId}-labels`,
    role: 'label',
    entityId: node.id,
    minZoom: 0.4,
    children: labels,
  });
  return {
    type: 'group',
    id: nodeId,
    role: 'node',
    entityId: node.id,
    ariaLabel: nodeAriaLabel(node, label),
    opacity: style.opacity,
    children,
  };
}

function renderContainer(
  node: Node,
  container: ResolvedContainer,
  style: NodeStyle,
  children: readonly SceneGroup[],
): SceneGroup {
  const id = `container-${sanitizeId(node.id)}`;
  const content: SceneGroup = {
    type: 'group',
    id: `${id}-content`,
    role: 'shape',
    ...(container.clip
      ? {
          clip: {
            items: [
              {
                type: 'rect' as const,
                id: `${id}-content-clip`,
                frame: container.contentFrame,
                radius: 8,
              },
            ],
          },
        }
      : {}),
    children,
  };
  return {
    type: 'group',
    id,
    role: 'container',
    entityId: node.id,
    ariaLabel: nodeAriaLabel(node, container.title),
    children: [
      {
        type: 'rect',
        id: `${id}-surface`,
        layer: 'background',
        frame: container.frame,
        radius: 12,
        fill: style.accent,
        fillOpacity: 0.045,
        stroke: style.accent,
        strokeOpacity: 0.48,
        strokeWidth: 2,
        dash: [6, 3],
      },
      {
        type: 'rect',
        id: `${id}-title-bar`,
        layer: 'background',
        frame: container.titleFrame,
        radius: 12,
        fill: style.accent,
        fillOpacity: 0.08,
      },
      {
        type: 'text',
        id: `${id}-title`,
        value: ellipsis(container.title.toUpperCase(), container.titleFrame.width - 32, 7.1),
        at: { x: container.titleFrame.x + 16, y: container.titleFrame.y + 23 },
        fill: PALETTE.ink,
        fontFamily: 'Segoe UI, Arial, sans-serif',
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: 0.52,
        minZoom: 0.4,
      },
      content,
    ],
  };
}

function renderZone(panel: ZonePanel): SceneGroup {
  const { bounds } = panel;
  const visualLabel = ellipsis(panel.label, Math.max(24, bounds.width - 36), 6.2);
  return {
    type: 'group',
    id: panel.id,
    role: 'zone',
    entityId: panel.entityId,
    ariaLabel: panel.label,
    children: [
      {
        type: 'rect',
        id: `${panel.id}-surface`,
        layer: 'background',
        frame: bounds,
        radius: 16,
        fill: panel.accent,
        fillOpacity: 0.045,
        stroke: panel.accent,
        strokeOpacity: 0.34,
        strokeWidth: 1.2,
        dash: [6, 6],
      },
      {
        type: 'path',
        id: `${panel.id}-rule`,
        commands: [
          { type: 'move', to: { x: bounds.x + 18, y: bounds.y + 42 } },
          { type: 'line', to: { x: Math.min(bounds.x + 180, bounds.x + bounds.width - 18), y: bounds.y + 42 } },
        ],
        fill: 'none',
        stroke: panel.accent,
        strokeOpacity: 0.42,
        strokeWidth: 1.5,
      },
      {
        type: 'text',
        id: `${panel.id}-label`,
        value: visualLabel.toUpperCase(),
        at: { x: bounds.x + 18, y: bounds.y + 27 },
        fill: panel.accent,
        fontFamily: 'Cascadia Code, Consolas, monospace',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 1,
        minZoom: 0.4,
      },
    ],
  };
}

type EdgeMarkerType = NonNullable<NonNullable<Edge['routing']>['endMarker']>;

function sceneMarker(
  marker: EdgeMarkerType | undefined,
  defaultMarker: EdgeMarkerType,
  color: string,
): SceneMarker | undefined {
  const resolved = marker ?? defaultMarker;
  if (resolved === 'none') {
    return undefined;
  }
  return {
    type: resolved,
    size: resolved === 'bar' ? 5.5 : resolved === 'circle' ? 5.75 : 7,
    fill: color,
  };
}

function renderEdge(
  routed: RoutedEdge,
  layout: EdgeLayoutOverride | undefined,
): SceneGroup {
  const { edge, style, points, commands } = routed;
  const label = textValue(edge.label);
  const semantic = textValue(edge.semantic);
  const point = edgeLabelPoint(points, layout);
  const lineLabel = label || semantic || style.label;
  const caption = label && semantic ? semantic : label ? semantic : style.label;
  const labelFontFamily = readString(edge.data, 'fontFamily') ?? 'Segoe UI, Arial, sans-serif';
  const labelFontSize = clamp(readNumber(edge.data, 'fontSize') ?? 10, 8, 96);
  const labelFontWeight = clamp(readNumber(edge.data, 'fontWeight') ?? 700, 100, 900);
  const labelFontStyle = readString(edge.data, 'fontStyle') === 'italic' ? 'italic' : 'normal';
  const labelUnderline = edge.data.underline === true;
  const labelLineHeight = clamp(readNumber(edge.data, 'lineHeight') ?? 1.2, 0.8, 3);
  const labelAlignment = readString(edge.data, 'textAlign');
  const labelAnchor: SceneTextItem['anchor'] = labelAlignment === 'left'
    ? 'start'
    : labelAlignment === 'right'
      ? 'end'
      : 'middle';
  const labelFill = safeColor(edge.data.textColor) ?? PALETTE.ink;
  const labelCharacterWidth = 5.6 * (labelFontSize / 10);
  const visualLabel = ellipsis(lineLabel, 300, labelCharacterWidth);
  const visualCaption = caption === '' ? '' : ellipsis(caption, 210, 5.1);
  const labelWidth = Math.min(
    320,
    Math.max(68, Math.max(estimateTextWidth(visualLabel, labelCharacterWidth), estimateTextWidth(visualCaption, 5.1)) + 18),
  );
  const labelX = point.x - labelWidth / 2;
  const labelLineAdvance = labelFontSize * labelLineHeight;
  const labelY = point.y - (visualCaption ? Math.max(16, labelLineAdvance) : labelFontSize * 0.8);
  const labelTextX = labelAnchor === 'start'
    ? labelX + 9
    : labelAnchor === 'end'
      ? labelX + labelWidth - 9
      : point.x;
  const edgeId = `edge-${sanitizeId(edge.id)}`;
  const markerStart = sceneMarker(edge.routing?.startMarker, 'none', style.stroke);
  const markerEnd = sceneMarker(edge.routing?.endMarker, 'arrow', style.stroke);
  const lineWidth = edge.routing?.lineWidth ?? 2.4;
  const lineDash = edge.routing?.lineStyle === 'solid'
    ? undefined
    : edge.routing?.lineStyle === 'dashed'
      ? [8, 6]
      : edge.routing?.lineStyle === 'dotted'
        ? [2, 5]
        : style.dash;
  const children: SceneItem[] = [
    {
      type: 'path',
      id: `${edgeId}-halo`,
      commands,
      fill: 'none',
      stroke: PALETTE.paper,
      strokeWidth: lineWidth + 7.6,
      lineCap: 'round',
      lineJoin: 'round',
      opacity: 0.86,
      minZoom: 0.15,
    },
    {
      type: 'path',
      id: `${edgeId}-flow`,
      commands,
      fill: 'none',
      stroke: style.stroke,
      strokeWidth: lineWidth,
      ...(lineDash === undefined ? {} : { dash: lineDash }),
      lineCap: 'round',
      lineJoin: 'round',
      ...(markerStart === undefined ? {} : { markerStart }),
      ...(markerEnd === undefined ? {} : { markerEnd }),
      lowZoomStrokeWidth: 1,
    },
  ];
  if (visualLabel || visualCaption) {
    const labelItems: SceneItem[] = [
      {
        type: 'rect',
        id: `${edgeId}-label-bg`,
        frame: { x: labelX, y: labelY - 13, width: labelWidth, height: visualCaption ? 31 : 20 },
        radius: 6,
        fill: PALETTE.paper,
        fillOpacity: 0.95,
        stroke: style.stroke,
        strokeOpacity: 0.2,
        minZoom: 0.4,
      },
      {
        type: 'text',
        id: `${edgeId}-label-text`,
        value: visualLabel,
        at: { x: labelTextX, y: labelY },
        fill: labelFill,
        fontFamily: labelFontFamily,
        fontSize: labelFontSize,
        fontWeight: labelFontWeight,
        fontStyle: labelFontStyle,
        ...(labelUnderline ? { underline: true } : {}),
        anchor: labelAnchor,
        minZoom: 0.4,
      },
    ];
    if (visualCaption) {
      labelItems.push({
        type: 'text',
        id: `${edgeId}-caption`,
        value: visualCaption,
        at: { x: point.x, y: labelY + Math.max(12, labelLineAdvance) },
        fill: style.stroke,
        fontFamily: 'Cascadia Code, Consolas, monospace',
        fontSize: 8.5,
        anchor: 'middle',
        minZoom: 0.75,
      });
    }
    children.push({
      type: 'group',
      id: `${edgeId}-label`,
      role: 'label',
      entityId: edge.id,
      minZoom: 0.4,
      children: labelItems,
    });
  }
  return {
    type: 'group',
    id: edgeId,
    role: 'edge',
    entityId: edge.id,
    ariaLabel: `${lineLabel}${caption ? `, ${caption}` : ''}`,
    children,
  };
}

function renderRouteDiagnostic(
  edge: Edge,
  anchor: Anchor,
  diagnostic: RouteDiagnostic,
): SceneGroup {
  const edgeId = `edge-${sanitizeId(edge.id)}`;
  const center = offsetPoint(anchor, 18);
  return {
    type: 'group',
    id: `${edgeId}-routing-error`,
    role: 'edge',
    entityId: edge.id,
    ariaLabel: `Connector routing error: ${diagnostic.message}`,
    children: [
      {
        type: 'circle',
        id: `${edgeId}-routing-error-badge`,
        center,
        radius: 9,
        fill: '#FFF1F2',
        stroke: '#C81E1E',
        strokeWidth: 1.5,
        minZoom: 0.4,
      },
      {
        type: 'path',
        id: `${edgeId}-routing-error-mark`,
        commands: [
          { type: 'move', to: { x: center.x, y: center.y - 4 } },
          { type: 'line', to: { x: center.x, y: center.y + 2 } },
          { type: 'move', to: { x: center.x, y: center.y + 5 } },
          { type: 'line', to: { x: center.x, y: center.y + 5.2 } },
        ],
        fill: 'none',
        stroke: '#C81E1E',
        strokeWidth: 1.8,
        lineCap: 'round',
        minZoom: 0.4,
      },
    ],
  };
}

function crossingOrientation(
  points: readonly ScenePoint[],
  point: ScenePoint,
): 'horizontal' | 'vertical' | undefined {
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (from === undefined || to === undefined) {
      continue;
    }
    if (
      from.y === to.y &&
      point.y === from.y &&
      point.x > Math.min(from.x, to.x) &&
      point.x < Math.max(from.x, to.x)
    ) {
      return 'horizontal';
    }
    if (
      from.x === to.x &&
      point.x === from.x &&
      point.y > Math.min(from.y, to.y) &&
      point.y < Math.max(from.y, to.y)
    ) {
      return 'vertical';
    }
  }
  return undefined;
}

function jumpCommands(
  orientation: 'horizontal' | 'vertical',
  point: ScenePoint,
  style: 'arc' | 'gap' | 'square',
): readonly ScenePathCommand[] {
  const radius = 6;
  if (orientation === 'horizontal') {
    if (style === 'arc') {
      return [
        { type: 'move', to: { x: point.x - radius, y: point.y } },
        {
          type: 'cubic',
          control1: { x: point.x - radius / 2, y: point.y - radius },
          control2: { x: point.x + radius / 2, y: point.y - radius },
          to: { x: point.x + radius, y: point.y },
        },
      ];
    }
    if (style === 'square') {
      return [
        { type: 'move', to: { x: point.x - radius, y: point.y } },
        { type: 'line', to: { x: point.x - radius / 2, y: point.y - radius } },
        { type: 'line', to: { x: point.x + radius / 2, y: point.y - radius } },
        { type: 'line', to: { x: point.x + radius, y: point.y } },
      ];
    }
    return [
      { type: 'move', to: { x: point.x - radius, y: point.y } },
      { type: 'line', to: { x: point.x + radius, y: point.y } },
    ];
  }
  if (style === 'arc') {
    return [
      { type: 'move', to: { x: point.x, y: point.y - radius } },
      {
        type: 'cubic',
        control1: { x: point.x + radius, y: point.y - radius / 2 },
        control2: { x: point.x + radius, y: point.y + radius / 2 },
        to: { x: point.x, y: point.y + radius },
      },
    ];
  }
  if (style === 'square') {
    return [
      { type: 'move', to: { x: point.x, y: point.y - radius } },
      { type: 'line', to: { x: point.x + radius, y: point.y - radius / 2 } },
      { type: 'line', to: { x: point.x + radius, y: point.y + radius / 2 } },
      { type: 'line', to: { x: point.x, y: point.y + radius } },
    ];
  }
  return [
    { type: 'move', to: { x: point.x, y: point.y - radius } },
    { type: 'line', to: { x: point.x, y: point.y + radius } },
  ];
}

function renderConnectorJumps(
  crossings: readonly OrthogonalCrossing[],
  routesByEdgeId: ReadonlyMap<string, RoutedEdge>,
): readonly SceneGroup[] {
  const groups: SceneGroup[] = [];
  crossings.forEach((crossing, index) => {
    const routed = routesByEdgeId.get(crossing.overEdgeId);
    const style = routed?.edge.routing?.jumpStyle ?? 'arc';
    if (routed === undefined || style === 'none') {
      return;
    }
    const orientation = crossingOrientation(routed.points, crossing.point);
    if (orientation === undefined) {
      return;
    }
    const commands = jumpCommands(orientation, crossing.point, style);
    const id = `edge-${sanitizeId(routed.edge.id)}-jump-${index}`;
    const children: SceneItem[] = [
      {
        type: 'path',
        id: `${id}-gap`,
        commands,
        fill: 'none',
        stroke: PALETTE.paper,
        strokeWidth: 8,
        lineCap: 'round',
        lineJoin: 'round',
      },
    ];
    if (style !== 'gap') {
      children.push({
        type: 'path',
        id: `${id}-flow`,
        commands,
        fill: 'none',
        stroke: routed.style.stroke,
        strokeWidth: 2.4,
        lineCap: 'round',
        lineJoin: 'round',
      });
    }
    groups.push({
      type: 'group',
      id,
      role: 'glyph',
      entityId: routed.edge.id,
      ariaLabel: `${style} line jump`,
      minZoom: 0.4,
      children,
    });
  });
  return groups;
}

function renderHeader(
  document: OpenChartDocument,
  page: Page,
  layoutOptions: Record<string, unknown> | undefined,
  nodeCount: number,
  edgeCount: number,
  canvasWidth: number,
): SceneGroup {
  const layoutEyebrow = readString(layoutOptions, 'eyebrow') ?? 'OPENCHART · SYSTEM CONNECTIVITY';
  const layoutSubtitle = readString(layoutOptions, 'subtitle') ?? `${textValue(page.name, 'Integration architecture')} rendered as a connected system map`;
  const versionLabel = readString(layoutOptions, 'versionLabel') ?? `REFERENCE / REV ${String(document.rev).padStart(2, '0')}`;
  const titleBadgeWidth = Math.min(260, Math.max(130, estimateTextWidth(versionLabel, 5.5) + 28));
  const countBadgeWidth = 146;
  const headerRight = canvasWidth - 72;
  return {
    type: 'group',
    id: 'artboard-header',
    role: 'header',
    ariaLabel: `${textValue(document.title, 'OpenChart document')}, ${layoutSubtitle}`,
    minZoom: 0.4,
    children: [
      {
        type: 'text',
        id: 'header-eyebrow',
        value: layoutEyebrow.toUpperCase(),
        at: { x: 72, y: 54 },
        fill: PALETTE.slate,
        fontFamily: 'Cascadia Code, Consolas, monospace',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 1.6,
        minZoom: 0.75,
      },
      {
        type: 'text',
        id: 'header-title',
        value: textValue(document.title, 'OpenChart document'),
        at: { x: 72, y: 94 },
        fill: PALETTE.ink,
        fontFamily: 'Aptos Display, Segoe UI, sans-serif',
        fontSize: 34,
        fontWeight: 700,
        minZoom: 0.4,
      },
      {
        type: 'text',
        id: 'header-subtitle',
        value: layoutSubtitle,
        at: { x: 72, y: 120 },
        fill: PALETTE.slate,
        fontFamily: 'Segoe UI, Arial, sans-serif',
        fontSize: 13,
        minZoom: 0.75,
      },
      {
        type: 'rect',
        id: 'header-version-bg',
        frame: {
          x: headerRight - countBadgeWidth - titleBadgeWidth - 12,
          y: 38,
          width: titleBadgeWidth,
          height: 28,
        },
        radius: 14,
        fill: PALETTE.ink,
        minZoom: 0.75,
      },
      {
        type: 'text',
        id: 'header-version',
        value: versionLabel,
        at: { x: headerRight - countBadgeWidth - titleBadgeWidth / 2 - 12, y: 56 },
        fill: PALETTE.paper,
        fontFamily: 'Cascadia Code, Consolas, monospace',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.6,
        anchor: 'middle',
        minZoom: 0.75,
      },
      {
        type: 'rect',
        id: 'header-count-bg',
        frame: { x: headerRight - countBadgeWidth, y: 38, width: countBadgeWidth, height: 28 },
        radius: 14,
        fill: PALETTE.white,
        stroke: PALETTE.ink,
        strokeOpacity: 0.16,
        minZoom: 0.75,
      },
      {
        type: 'text',
        id: 'header-count',
        value: `${nodeCount} NODES  ·  ${edgeCount} FLOWS`,
        at: { x: headerRight - countBadgeWidth / 2, y: 56 },
        fill: PALETTE.ink,
        fontFamily: 'Cascadia Code, Consolas, monospace',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.6,
        anchor: 'middle',
        minZoom: 0.75,
      },
    ],
  };
}

function renderLegend(
  edges: readonly Edge[],
  styles: ReadonlyMap<string, EdgeStyle>,
  canvasWidth: number,
  canvasHeight: number,
): SceneGroup {
  const entries = [...styles.entries()].sort(([left], [right]) => compareIds(left, right));
  const y = Math.max(0, canvasHeight - 39);
  const children: SceneItem[] = [
    {
      type: 'path',
      id: 'legend-rule',
      commands: [
        { type: 'move', to: { x: 72, y: y - 20 } },
        { type: 'line', to: { x: canvasWidth - 72, y: y - 20 } },
      ],
      fill: 'none',
      stroke: PALETTE.ink,
      strokeOpacity: 0.12,
    },
    {
      type: 'text',
      id: 'legend-title',
      value: 'FLOW LEGEND',
      at: { x: 72, y },
      fill: PALETTE.slate,
      fontFamily: 'Cascadia Code, Consolas, monospace',
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: 1.3,
    },
  ];
  if (entries.length === 0 || edges.length === 0) {
    children.push({
      type: 'text',
      id: 'legend-empty',
      value: 'No flows on this page',
      at: { x: 164, y },
      fill: PALETTE.slate,
      fontFamily: 'Segoe UI, Arial, sans-serif',
      fontSize: 11,
    });
  } else {
    let x = 164;
    for (const [styleId, style] of entries) {
      const width = Math.min(270, Math.max(100, estimateTextWidth(style.label, 5.6) + 48));
      const legendLine = style.dash === undefined
        ? {
            type: 'path' as const,
            id: `legend-${sanitizeId(styleId)}-line`,
            commands: [
              { type: 'move' as const, to: { x, y: y - 4 } },
              { type: 'line' as const, to: { x: x + 28, y: y - 4 } },
            ],
            fill: 'none',
            stroke: style.stroke,
            strokeWidth: 2.4,
            lineCap: 'round' as const,
          }
        : {
            type: 'path' as const,
            id: `legend-${sanitizeId(styleId)}-line`,
            commands: [
              { type: 'move' as const, to: { x, y: y - 4 } },
              { type: 'line' as const, to: { x: x + 28, y: y - 4 } },
            ],
            fill: 'none',
            stroke: style.stroke,
            strokeWidth: 2.4,
            dash: style.dash,
            lineCap: 'round' as const,
          };
      children.push(
        legendLine,
        {
          type: 'text',
          id: `legend-${sanitizeId(styleId)}-label`,
          value: style.label,
          at: { x: x + 38, y },
          fill: PALETTE.ink,
          fontFamily: 'Segoe UI, Arial, sans-serif',
          fontSize: 11,
        },
      );
      x += width;
      if (x > canvasWidth - 100) {
        break;
      }
    }
  }
  return {
    type: 'group',
    id: 'flow-legend',
    role: 'legend',
    ariaLabel: 'Flow legend',
    minZoom: 0.4,
    children,
  };
}

function renderZonePanels(
  nodes: readonly Node[],
  boundsByNode: ReadonlyMap<string, Bounds>,
  stylesByNode: ReadonlyMap<string, NodeStyle>,
  canvasWidth: number,
  canvasHeight: number,
): readonly ZonePanel[] {
  const zones = new Map<string, { readonly nodes: Node[]; readonly label: string | undefined; readonly accent: string | undefined }>();
  for (const node of nodes) {
    const zone = readString(node.data, 'zone');
    if (zone === undefined) {
      continue;
    }
    const current = zones.get(zone);
    const label = readString(node.data, 'zoneLabel');
    const accent = stylesByNode.get(node.id)?.accent;
    const isSystem = textValue(node.kind).toLowerCase() === 'system';
    if (current === undefined) {
      zones.set(zone, { nodes: [node], label, accent });
    } else {
      const nextLabel = current.label ?? label;
      const nextAccent = isSystem && accent !== undefined ? accent : current.accent ?? accent;
      zones.set(zone, { nodes: [...current.nodes, node], label: nextLabel, accent: nextAccent });
    }
  }

  const panels: ZonePanel[] = [];
  for (const [zone, group] of [...zones.entries()].sort(([left], [right]) => compareIds(left, right))) {
    const groupBounds = group.nodes
      .map((node) => boundsByNode.get(node.id))
      .filter((bounds): bounds is Bounds => bounds !== undefined);
    if (groupBounds.length === 0) {
      continue;
    }
    const minX = Math.min(...groupBounds.map((bounds) => bounds.x));
    const minY = Math.min(...groupBounds.map((bounds) => bounds.y));
    const maxX = Math.max(...groupBounds.map((bounds) => bounds.x + bounds.width));
    const maxY = Math.max(...groupBounds.map((bounds) => bounds.y + bounds.height));
    const padding = 28;
    const x = Math.max(20, minX - padding);
    const y = Math.max(148, minY - padding);
    const right = Math.min(canvasWidth - 20, maxX + padding);
    const bottom = Math.min(canvasHeight - 58, maxY + padding);
    panels.push({
      id: `zone-${sanitizeId(zone)}`,
      entityId: zone,
      label: group.label ?? zone,
      accent: group.accent ?? PALETTE.slate,
      bounds: { x, y, width: Math.max(80, right - x), height: Math.max(80, bottom - y) },
    });
  }
  return panels;
}

export function buildSceneDescription(
  document: OpenChartDocument,
  options: SceneBuildOptions = {},
): SceneDescription {
  const page = selectPage(document, options.pageId);
  const layoutOptions = isRecord(document.layout.options) ? document.layout.options : undefined;
  const baseCanvasWidth = chooseDimension(options.width, layoutOptions?.canvasWidth, 1440, 'width');
  const baseCanvasHeight = chooseDimension(options.height, layoutOptions?.canvasHeight, 920, 'height');

  const visibleLayerIds = new Set<string>();
  for (const layerId of page.layerIds) {
    const layer = document.layers[layerId];
    if (layer !== undefined && layer.pageId === page.id && layer.visible) {
      visibleLayerIds.add(layer.id);
    }
  }
  const nodes = Object.values(document.nodes)
    .filter((node) => node.pageId === page.id && visibleLayerIds.has(node.layerId))
    .sort((left, right) => compareNodePaintOrder(document, left, right));
  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  const portsById = new Map<string, Port>();
  const visiblePorts: Port[] = [];
  for (const port of Object.values(document.ports)) {
    portsById.set(port.id, port);
    if (visibleNodeIds.has(port.nodeId)) {
      visiblePorts.push(port);
    }
  }
  visiblePorts.sort((left, right) => compareIds(left.id, right.id));
  const edges = Object.values(document.edges)
    .filter((edge) => {
      if (edge.pageId !== page.id || !visibleLayerIds.has(edge.layerId)) {
        return false;
      }
      const fromPort = portsById.get(edge.fromPortId);
      const toPort = portsById.get(edge.toPortId);
      return fromPort !== undefined && toPort !== undefined && visibleNodeIds.has(fromPort.nodeId) && visibleNodeIds.has(toPort.nodeId);
    })
    .sort((left, right) => compareIds(left.id, right.id));

  const baseFrames: Record<string, Bounds> = {};
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node !== undefined) {
      baseFrames[node.id] = resolveBounds(
        node,
        index,
        nodes.length,
        baseCanvasWidth,
        baseCanvasHeight,
        document.layout.overrides,
        document.layout.derived ?? {},
      );
    }
  }
  const remainingLayoutNodes = Object.values(document.nodes)
    .filter((node) => !visibleNodeIds.has(node.id))
    .sort((left, right) => compareIds(left.id, right.id));
  for (let index = 0; index < remainingLayoutNodes.length; index += 1) {
    const node = remainingLayoutNodes[index];
    if (node !== undefined) {
      baseFrames[node.id] = resolveBounds(
        node,
        index,
        remainingLayoutNodes.length,
        baseCanvasWidth,
        baseCanvasHeight,
        document.layout.overrides,
        document.layout.derived ?? {},
      );
    }
  }
  const containerLayout = reconcileContainers(document, baseFrames, {
    firstOpen: options.firstOpen ?? false,
  });
  const boundsByNode = new Map<string, Bounds>();
  const stylesByNode = new Map<string, NodeStyle>();
  for (const node of nodes) {
    const frame = containerLayout.frames[node.id];
    if (frame === undefined) {
      throw new Error(`Container reconciliation omitted node ${JSON.stringify(node.id)}`);
    }
    boundsByNode.set(node.id, frame);
    stylesByNode.set(node.id, nodeStyle(node, document.styles[node.styleId]));
  }
  const nodeBounds = [...boundsByNode.values()];
  const canvasWidth = options.width === undefined && nodeBounds.length > 0
    ? Math.max(baseCanvasWidth, Math.ceil(Math.max(...nodeBounds.map((bounds) => bounds.x + bounds.width)) + 72))
    : baseCanvasWidth;
  const canvasHeight = options.height === undefined && nodeBounds.length > 0
    ? Math.max(baseCanvasHeight, Math.ceil(Math.max(...nodeBounds.map((bounds) => bounds.y + bounds.height)) + 96))
    : baseCanvasHeight;
  const anchors = buildPortAnchors(visiblePorts, boundsByNode);
  const edgeStyles = new Map<string, EdgeStyle>();
  for (const edge of edges) {
    edgeStyles.set(edge.styleId, edgeStyle(edge, document.styles[edge.styleId]));
  }
  const zones = renderZonePanels(
    nodes.filter(
      (node) => node.container === undefined && node.group === undefined,
    ),
    boundsByNode,
    stylesByNode,
    canvasWidth,
    canvasHeight,
  );
  const edgeGroups: SceneGroup[] = [];
  const routedEdges: RoutedEdge[] = [];
  const routesByEdgeId = new Map<string, RoutedEdge>();
  const connectorGeometries: SceneConnectorGeometry[] = [];
  for (const edge of edges) {
    const fromPort = portsById.get(edge.fromPortId);
    const toPort = portsById.get(edge.toPortId);
    const from = fromPort === undefined || toPort === undefined
      ? undefined
      : resolvePortAnchor(fromPort, toPort, anchors, boundsByNode);
    const to = fromPort === undefined || toPort === undefined
      ? undefined
      : resolvePortAnchor(toPort, fromPort, anchors, boundsByNode);
    const style = edgeStyles.get(edge.styleId);
    if (
      from === undefined ||
      to === undefined ||
      style === undefined ||
      fromPort === undefined ||
      toPort === undefined
    ) {
      continue;
    }
    const obstacles = nodes
      .filter(
        (node) =>
          node.id !== fromPort.nodeId &&
          node.id !== toPort.nodeId &&
          node.container === undefined &&
          node.group === undefined,
      )
      .map((node) => {
        const bounds = boundsByNode.get(node.id);
        return bounds === undefined ? undefined : { ...bounds, id: node.id };
      })
      .filter((bounds): bounds is Bounds & { readonly id: string } => bounds !== undefined);
    const layout = document.layout.edgeOverrides?.[edge.id];
    const route = routeEdge(
      edge,
      from,
      to,
      layout,
      options.routingStrategy ?? 'document',
      obstacles,
    );
    if (!route.ok) {
      edgeGroups.push(renderRouteDiagnostic(edge, from, route.diagnostic));
      continue;
    }
    const routed: RoutedEdge = {
      edge,
      style,
      points: route.points,
      commands: pathCommands(
        route.mode,
        route.points,
        edge.routing?.cornerRadius ?? 9,
      ),
    };
    routedEdges.push(routed);
    routesByEdgeId.set(edge.id, routed);
    connectorGeometries.push({
      edgeId: edge.id,
      mode: route.mode,
      from,
      to,
      points: route.points,
      commands: routed.commands,
    });
    edgeGroups.push(renderEdge(routed, layout));
  }
  const crossings = findOrthogonalCrossings(
    routedEdges
      .filter((routed) => (routed.edge.routing?.mode ?? 'orthogonal') === 'orthogonal')
      .map((routed) => ({
        id: routed.edge.id,
        uid: routed.edge.uid,
        zIndex: edges.findIndex((edge) => edge.id === routed.edge.id),
        points: routed.points,
      })),
  );
  const jumpGroups = renderConnectorJumps(crossings, routesByEdgeId);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const childIdsByGroup = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parentId === undefined || nodesById.get(node.parentId)?.group === undefined) {
      continue;
    }
    const childIds = childIdsByGroup.get(node.parentId) ?? [];
    childIds.push(node.id);
    childIdsByGroup.set(node.parentId, childIds);
  }
  for (const childIds of childIdsByGroup.values()) {
    childIds.sort(compareIds);
  }
  const renderHierarchyNode = (node: Node): SceneGroup | undefined => {
    const bounds = boundsByNode.get(node.id);
    const style = stylesByNode.get(node.id);
    if (bounds === undefined || style === undefined) {
      return undefined;
    }
    const rotation =
      finiteOrUndefined(document.layout.overrides[node.id]?.rotation) ?? 0;
    if (
      (node.container !== undefined || node.group !== undefined) &&
      rotation % 360 !== 0
    ) {
      throw new Error(
        `Container or group ${JSON.stringify(node.id)} cannot be rotated`,
      );
    }
    if (node.group !== undefined) {
      const children = (childIdsByGroup.get(node.id) ?? [])
        .map((childId) => nodesById.get(childId))
        .filter((child): child is Node => child !== undefined)
        .map(renderHierarchyNode)
        .filter((group): group is SceneGroup => group !== undefined);
      return {
        type: 'group',
        id: `group-${sanitizeId(node.id)}`,
        role: 'group',
        entityId: node.id,
        ariaLabel: nodeAriaLabel(node, textValue(node.label, node.id)),
        children,
      };
    }
    if (node.container === undefined) {
      const group = renderLibraryNode(
        node,
        bounds,
        style,
        options.shapeResolver ?? resolveBuiltinLibraryShape,
      ) ?? renderNode(node, bounds, style);
      return rotation % 360 === 0
        ? group
        : {
            ...group,
            transform: {
              rotation,
              origin: {
                x: bounds.x + bounds.width / 2,
                y: bounds.y + bounds.height / 2,
              },
            },
          };
    }
    const container = containerLayout.containers[node.id];
    if (container === undefined) {
      throw new Error(`Container reconciliation omitted container ${JSON.stringify(node.id)}`);
    }
    const children = container.childIds
      .map((childId) => nodesById.get(childId))
      .filter((child): child is Node => child !== undefined)
      .map(renderHierarchyNode)
      .filter((group): group is SceneGroup => group !== undefined);
    return renderContainer(node, container, style, children);
  };
  const nodeGroups = nodes
    .filter(
      (node) => node.parentId === undefined || !visibleNodeIds.has(node.parentId),
    )
    .map((node) => {
      const bounds = boundsByNode.get(node.id);
      return bounds === undefined ? undefined : renderHierarchyNode(node);
    })
    .filter((group): group is SceneGroup => group !== undefined);
  const title = textValue(document.title, 'OpenChart document');
  const description = `${textValue(page.name, 'OpenChart page')} with ${nodes.length} nodes and ${edges.length} flows.`;
  const needsArtboardSurface = document.theme?.presetId === 'openchart-dark'
    || document.theme?.presetId === 'high-contrast';
  const hasDiagramContent = nodes.length > 0 || edges.length > 0;
  const artboardChildren: SceneItem[] = [
    ...(needsArtboardSurface
      ? [
          {
            type: 'rect' as const,
            id: 'artboard-background',
            layer: 'background' as const,
            frame: { x: 0, y: 0, width: canvasWidth, height: canvasHeight },
            fill: PALETTE.paper,
          },
          {
            type: 'dot-grid' as const,
            id: 'artboard-dot-grid',
            layer: 'background' as const,
            frame: {
              x: 24,
              y: 144,
              width: Math.max(0, canvasWidth - 48),
              height: Math.max(0, canvasHeight - 202),
            },
            step: 24,
            offset: { x: 2, y: 2 },
            radius: 1.15,
            fill: PALETTE.ink,
            fillOpacity: 0.11,
            opacity: 0.64,
            minZoom: 0.4,
          },
        ]
      : []),
    ...(hasDiagramContent
      ? [renderHeader(document, page, layoutOptions, nodes.length, edges.length, canvasWidth)]
      : []),
    ...zones.map(renderZone),
    ...edgeGroups,
    ...jumpGroups,
    ...nodeGroups,
    ...(hasDiagramContent ? [renderLegend(edges, edgeStyles, canvasWidth, canvasHeight)] : []),
  ];
  const artboard: SceneGroup = {
    type: 'group',
    id: 'artboard',
    role: 'artboard',
    ariaLabel: title,
    children: artboardChildren,
  };
  const themeColors = documentThemeColors(document);
  const themedArtboard = themeColors.size === 0
    ? artboard
    : themeSceneItem(artboard, themeColors, documentThemeTypeFloor(document)) as SceneGroup;
  return {
    version: SCENE_VERSION,
    bounds: { x: 0, y: 0, width: canvasWidth, height: canvasHeight },
    title,
    description,
    items: [themedArtboard],
    connectors: connectorGeometries,
  };
}
