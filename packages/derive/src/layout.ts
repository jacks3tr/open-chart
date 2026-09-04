import ElkApiConstructor from 'elkjs/lib/elk-api.js';
import type {
  ELK,
  ElkExtendedEdge,
  ElkNode,
  ElkPort,
} from 'elkjs/lib/elk-api.js';

import type {
  LayoutFrame,
  LayoutOverride,
  OpenChartDocument,
  Port,
} from '@openchart/ir';

export const LAYOUT_DERIVED_VERSION = 'elkjs@0.12.0/openchart-2';

export type LayoutMode = 'layered' | 'tree' | 'radial' | 'force';
export type LayoutDirection = 'RIGHT' | 'DOWN';
export type LayoutEngine = 'elk.layered' | 'elk.mrtree' | 'elk.radial' | 'elk.force';

export interface LayoutDocumentOptions {
  readonly pageId: string;
  readonly mode: LayoutMode;
  readonly direction?: LayoutDirection;
  readonly spacing?: number;
  readonly gridSize?: number;
}

export interface LayoutDocumentResult {
  readonly engine: LayoutEngine;
  readonly derivedVersion: typeof LAYOUT_DERIVED_VERSION;
  readonly frames: Readonly<Record<string, LayoutFrame>>;
}

export interface LayoutDocumentRuntime {
  readonly workerFactory: (url?: string) => unknown;
}

interface MutableFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface InitialFrame {
  readonly frame: MutableFrame;
  readonly pinned: boolean;
  readonly override?: LayoutOverride;
}

const DEFAULT_SPACING = 24;
const DEFAULT_GRID_SIZE = 8;
const DEFAULT_CANVAS_WIDTH = 1_440;
const DEFAULT_CANVAS_HEIGHT = 920;
const COMPOSITION_MARGIN_X = 72;
const COMPOSITION_MARGIN_TOP = 168;
const COMPOSITION_MARGIN_BOTTOM = 96;

/** Keep layout defaults aligned with the shipped scene defaults without coupling
 * the DOM-free derivation package to the renderer package. */
const DEFAULT_NODE_SIZE: Readonly<Record<string, { readonly width: number; readonly height: number }>> = {
  system: { width: 310, height: 230 },
  service: { width: 300, height: 154 },
  database: { width: 300, height: 154 },
  control: { width: 310, height: 128 },
  group: { width: 360, height: 240 },
  container: { width: 360, height: 240 },
};

const ENGINE_BY_MODE: Readonly<Record<LayoutMode, LayoutEngine>> = {
  layered: 'elk.layered',
  tree: 'elk.mrtree',
  radial: 'elk.radial',
  force: 'elk.force',
};

type ElkConstructorType = new (options?: {
  readonly workerFactory?: (url?: string) => unknown;
}) => ELK;

async function createElk(runtime?: LayoutDocumentRuntime): Promise<ELK> {
  if (runtime !== undefined) {
    const Elk = ElkApiConstructor as unknown as ElkConstructorType;
    return new Elk({ workerFactory: runtime.workerFactory });
  }
  // Node tests and headless callers use ELK's self-contained fake worker. The
  // browser application supplies a real worker factory through the runtime.
  const module = await import('elkjs/lib/elk.bundled.js');
  const Elk = module.default as unknown as ElkConstructorType;
  return new Elk();
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function readFrameValue(
  override: LayoutOverride | undefined,
  derived: LayoutFrame | undefined,
  key: keyof MutableFrame,
): number | undefined {
  const overrideValue = override?.[key];
  if (isFiniteNumber(overrideValue)) {
    return overrideValue;
  }
  const derivedValue = derived?.[key];
  return isFiniteNumber(derivedValue) ? derivedValue : undefined;
}

function defaultSizeForKind(kind: string): { readonly width: number; readonly height: number } {
  return DEFAULT_NODE_SIZE[kind] ?? { width: 280, height: 148 };
}

function initialFrameForNode(
  document: OpenChartDocument,
  nodeId: string,
): InitialFrame {
  const node = document.nodes[nodeId];
  if (node === undefined) {
    throw new Error(`Cannot derive layout for missing node ${JSON.stringify(nodeId)}`);
  }
  const override = document.layout.overrides[nodeId];
  const derived = document.layout.derived?.[nodeId];
  const defaults = defaultSizeForKind(node.kind);
  const width = isPositiveNumber(override?.width)
    ? override.width
    : isPositiveNumber(derived?.width)
      ? derived.width
      : defaults.width;
  const height = isPositiveNumber(override?.height)
    ? override.height
    : isPositiveNumber(derived?.height)
      ? derived.height
      : defaults.height;
  const x = readFrameValue(override, derived, 'x') ?? 0;
  const y = readFrameValue(override, derived, 'y') ?? 0;
  return {
    frame: { x, y, width, height },
    pinned: override?.pinned === true,
    ...(override === undefined ? {} : { override }),
  };
}

function validateOptions(
  document: OpenChartDocument,
  options: LayoutDocumentOptions,
): { readonly engine: LayoutEngine; readonly direction: LayoutDirection; readonly spacing: number; readonly gridSize: number } {
  if (typeof options.pageId !== 'string' || document.pages[options.pageId] === undefined) {
    throw new Error(`Unknown layout page ${JSON.stringify(options.pageId)}`);
  }
  const engine = ENGINE_BY_MODE[options.mode];
  if (engine === undefined) {
    throw new Error(`Unsupported layout mode ${JSON.stringify(options.mode)}`);
  }
  const direction = options.direction ?? 'RIGHT';
  if (direction !== 'RIGHT' && direction !== 'DOWN') {
    throw new Error(`Unsupported layout direction ${JSON.stringify(direction)}`);
  }
  const spacing = options.spacing ?? DEFAULT_SPACING;
  if (!isPositiveNumber(spacing)) {
    throw new Error('Layout spacing must be a positive finite number');
  }
  const gridSize = options.gridSize ?? DEFAULT_GRID_SIZE;
  if (!isPositiveNumber(gridSize)) {
    throw new Error('Layout grid size must be a positive finite number');
  }
  return { engine, direction, spacing, gridSize };
}

function visibleNodeIds(
  document: OpenChartDocument,
  pageId: string,
): readonly string[] {
  const page = document.pages[pageId];
  if (page === undefined) {
    return [];
  }
  const visibleLayers = new Set(
    page.layerIds.filter((layerId) => document.layers[layerId]?.visible === true),
  );
  return Object.keys(document.nodes)
    .filter((nodeId) => {
      const node = document.nodes[nodeId];
      return node?.pageId === pageId && visibleLayers.has(node.layerId);
    })
    .sort(compareIds);
}

function visiblePortIdsByNode(
  document: OpenChartDocument,
  nodeIds: readonly string[],
): ReadonlyMap<string, readonly string[]> {
  const nodeIdSet = new Set(nodeIds);
  const idsByNode = new Map<string, string[]>();
  for (const nodeId of nodeIds) {
    idsByNode.set(nodeId, []);
  }
  for (const portId of Object.keys(document.ports).sort(compareIds)) {
    const port = document.ports[portId];
    if (port !== undefined && nodeIdSet.has(port.nodeId)) {
      idsByNode.get(port.nodeId)?.push(portId);
    }
  }
  return idsByNode;
}

function portSide(
  port: Port,
  direction: LayoutDirection,
): 'NORTH' | 'SOUTH' | 'EAST' | 'WEST' {
  switch (port.side) {
    case 'north':
      return 'NORTH';
    case 'south':
      return 'SOUTH';
    case 'east':
      return 'EAST';
    case 'west':
      return 'WEST';
    case 'auto':
      return direction === 'RIGHT'
        ? port.direction === 'in'
          ? 'WEST'
          : 'EAST'
        : port.direction === 'in'
          ? 'NORTH'
          : 'SOUTH';
  }
}

function graphLayoutOptions(
  algorithm: string,
  direction: LayoutDirection,
  spacing: number,
): Record<string, string> {
  return {
    'elk.algorithm': algorithm,
    'elk.direction': direction,
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.portConstraints': 'FIXED_SIDE',
    'elk.spacing.nodeNode': String(spacing),
    'elk.spacing.edgeNode': String(spacing),
    'elk.spacing.componentComponent': String(spacing),
    'elk.spacing.portPort': String(Math.max(4, spacing / 2)),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(spacing),
    'elk.layered.spacing.edgeNodeBetweenLayers': String(spacing),
    // ELK uses zero for a time-derived seed, so use a stable non-zero seed.
    'elk.randomSeed': '1',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  };
}

function nodeLayoutOptions(): Record<string, string> {
  return {
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.portConstraints': 'FIXED_SIDE',
  };
}

function encodedNodeId(nodeId: string): string {
  return `node:${nodeId}`;
}

function encodedPortId(portId: string): string {
  return `port:${portId}`;
}

function encodedEdgeId(edgeId: string): string {
  return `edge:${edgeId}`;
}

function visibleEdges(
  document: OpenChartDocument,
  pageId: string,
  nodeIds: readonly string[],
): readonly string[] {
  const page = document.pages[pageId];
  const visibleLayers = new Set(
    page?.layerIds.filter((layerId) => document.layers[layerId]?.visible === true) ?? [],
  );
  const nodeIdSet = new Set(nodeIds);
  return Object.keys(document.edges)
    .filter((edgeId) => {
      const edge = document.edges[edgeId];
      if (edge === undefined || edge.pageId !== pageId || !visibleLayers.has(edge.layerId)) {
        return false;
      }
      const fromPort = document.ports[edge.fromPortId];
      const toPort = document.ports[edge.toPortId];
      return (
        fromPort !== undefined &&
        toPort !== undefined &&
        nodeIdSet.has(fromPort.nodeId) &&
        nodeIdSet.has(toPort.nodeId)
      );
    })
    .sort(compareIds);
}

function radialForestEdges(
  document: OpenChartDocument,
  edgeIds: readonly string[],
): readonly string[] {
  // elk.radial requires a tree. Keep the first deterministic spanning forest
  // so cyclic semantic graphs still receive a useful radial composition.
  const parent = new Map<string, string>();
  const find = (nodeId: string): string => {
    const current = parent.get(nodeId);
    if (current === undefined) {
      parent.set(nodeId, nodeId);
      return nodeId;
    }
    if (current === nodeId) {
      return current;
    }
    const root = find(current);
    parent.set(nodeId, root);
    return root;
  };
  const union = (left: string, right: string): boolean => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) {
      return false;
    }
    if (leftRoot < rightRoot) {
      parent.set(rightRoot, leftRoot);
    } else {
      parent.set(leftRoot, rightRoot);
    }
    return true;
  };
  const result: string[] = [];
  for (const edgeId of edgeIds) {
    const edge = document.edges[edgeId];
    if (edge === undefined) {
      continue;
    }
    const fromNode = document.ports[edge.fromPortId]?.nodeId;
    const toNode = document.ports[edge.toPortId]?.nodeId;
    if (fromNode === undefined || toNode === undefined || fromNode === toNode) {
      continue;
    }
    if (union(fromNode, toNode)) {
      result.push(edgeId);
    }
  }
  return result;
}

function buildGraph(
  document: OpenChartDocument,
  pageId: string,
  nodeIds: readonly string[],
  edgeIds: readonly string[],
  direction: LayoutDirection,
  spacing: number,
  mode: LayoutMode,
  initialFrames: ReadonlyMap<string, InitialFrame>,
): ElkNode {
  const nodeIdSet = new Set(nodeIds);
  const portIdsByNode = visiblePortIdsByNode(document, nodeIds);
  const childIdsByParent = new Map<string, string[]>();
  for (const nodeId of nodeIds) {
    childIdsByParent.set(nodeId, []);
  }
  const topLevelIds: string[] = [];
  for (const nodeId of nodeIds) {
    const parentId = document.nodes[nodeId]?.parentId;
    if (parentId !== undefined && nodeIdSet.has(parentId)) {
      childIdsByParent.get(parentId)?.push(nodeId);
    } else {
      topLevelIds.push(nodeId);
    }
  }
  for (const childIds of childIdsByParent.values()) {
    childIds.sort(compareIds);
  }

  const graphOptions = graphLayoutOptions(ENGINE_BY_MODE[mode].slice(4), direction, spacing);
  const nodeOptions = nodeLayoutOptions();
  const makeNode = (nodeId: string): ElkNode => {
    const node = document.nodes[nodeId];
    const initial = initialFrames.get(nodeId);
    if (node === undefined || initial === undefined) {
      throw new Error(`Cannot construct layout node ${JSON.stringify(nodeId)}`);
    }
    const ports: ElkPort[] = [];
    for (const portId of portIdsByNode.get(nodeId) ?? []) {
      const port = document.ports[portId];
      if (port === undefined) {
        continue;
      }
      const layoutOptions: Record<string, string> = {
        'elk.port.side': portSide(port, direction),
      };
      if (port.order !== undefined) {
        layoutOptions['elk.port.index'] = String(port.order);
      }
      ports.push({
        id: encodedPortId(port.id),
        width: 1,
        height: 1,
        layoutOptions,
      });
    }
    const children = (childIdsByParent.get(nodeId) ?? []).map(makeNode);
    const result: ElkNode = {
      id: encodedNodeId(nodeId),
      width: initial.frame.width,
      height: initial.frame.height,
      layoutOptions: nodeOptions,
    };
    if (ports.length > 0) {
      result.ports = ports;
    }
    if (children.length > 0) {
      result.children = children;
    }
    return result;
  };

  const edges: ElkExtendedEdge[] = [];
  for (const edgeId of edgeIds) {
    const edge = document.edges[edgeId];
    if (edge === undefined) {
      continue;
    }
    edges.push({
      id: encodedEdgeId(edge.id),
      sources: [encodedPortId(edge.fromPortId)],
      targets: [encodedPortId(edge.toPortId)],
    });
  }
  const graph: ElkNode = {
    id: `page:${pageId}`,
    layoutOptions: graphOptions,
    children: topLevelIds.map(makeNode),
  };
  if (edges.length > 0) {
    graph.edges = edges;
  }
  return graph;
}

function finiteCoordinate(value: unknown): number {
  return isFiniteNumber(value) ? value : 0;
}

function positiveSize(value: unknown, fallback: number): number {
  return isPositiveNumber(value) ? value : fallback;
}

function collectAbsoluteFrames(
  result: ElkNode,
  nodeIdByEncodedId: ReadonlyMap<string, string>,
  initialFrames: ReadonlyMap<string, InitialFrame>,
): Map<string, MutableFrame> {
  const frames = new Map<string, MutableFrame>();
  const visit = (node: ElkNode, parentX: number, parentY: number): void => {
    const nodeId = nodeIdByEncodedId.get(node.id);
    const nextX = parentX + finiteCoordinate(node.x);
    const nextY = parentY + finiteCoordinate(node.y);
    if (nodeId !== undefined) {
      const initial = initialFrames.get(nodeId);
      if (initial !== undefined) {
        frames.set(nodeId, {
          x: nextX,
          y: nextY,
          width: positiveSize(node.width, initial.frame.width),
          height: positiveSize(node.height, initial.frame.height),
        });
      }
    }
    for (const child of node.children ?? []) {
      visit(child, nextX, nextY);
    }
  };
  // The root's coordinates establish the layout origin; descendants are
  // accumulated relative to it exactly once.
  visit(result, 0, 0);
  for (const [nodeId, initial] of initialFrames) {
    if (!frames.has(nodeId)) {
      frames.set(nodeId, { ...initial.frame });
    }
  }
  return frames;
}

function snap(value: number, gridSize: number): number {
  const snapped = Math.round(value / gridSize) * gridSize;
  return Object.is(snapped, -0) ? 0 : snapped;
}

function intersects(left: LayoutFrame, right: LayoutFrame): boolean {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  );
}

function asLayoutFrame(frame: MutableFrame): LayoutFrame {
  return {
    x: frame.x,
    y: frame.y,
    width: Math.max(Number.MIN_VALUE, frame.width),
    height: Math.max(Number.MIN_VALUE, frame.height),
  };
}

function configuredCanvasDimension(
  document: OpenChartDocument,
  key: 'canvasWidth' | 'canvasHeight',
  fallback: number,
): number {
  const value = document.layout.options?.[key];
  return isPositiveNumber(value) ? value : fallback;
}

function centerUnpinnedComposition(
  document: OpenChartDocument,
  nodeIds: readonly string[],
  gridSize: number,
  initialFrames: ReadonlyMap<string, InitialFrame>,
  frames: Record<string, LayoutFrame>,
): Record<string, LayoutFrame> {
  if (nodeIds.some((nodeId) => initialFrames.get(nodeId)?.pinned === true)) {
    return frames;
  }
  const values = Object.values(frames);
  if (values.length === 0) {
    return frames;
  }
  const minX = Math.min(...values.map((frame) => frame.x));
  const minY = Math.min(...values.map((frame) => frame.y));
  const maxX = Math.max(...values.map((frame) => frame.x + frame.width));
  const maxY = Math.max(...values.map((frame) => frame.y + frame.height));
  const width = maxX - minX;
  const height = maxY - minY;
  const canvasWidth = configuredCanvasDimension(document, 'canvasWidth', DEFAULT_CANVAS_WIDTH);
  const canvasHeight = configuredCanvasDimension(document, 'canvasHeight', DEFAULT_CANVAS_HEIGHT);
  const availableWidth = Math.max(0, canvasWidth - COMPOSITION_MARGIN_X * 2);
  const availableHeight = Math.max(
    0,
    canvasHeight - COMPOSITION_MARGIN_TOP - COMPOSITION_MARGIN_BOTTOM,
  );
  const targetX = width <= availableWidth
    ? COMPOSITION_MARGIN_X + (availableWidth - width) / 2
    : COMPOSITION_MARGIN_X;
  const targetY = height <= availableHeight
    ? COMPOSITION_MARGIN_TOP + (availableHeight - height) / 2
    : COMPOSITION_MARGIN_TOP;
  const deltaX = snap(targetX - minX, gridSize);
  const deltaY = snap(targetY - minY, gridSize);
  return Object.fromEntries(
    nodeIds.map((nodeId) => {
      const frame = frames[nodeId];
      if (frame === undefined) {
        throw new Error(`Layout normalization omitted node ${JSON.stringify(nodeId)}`);
      }
      return [nodeId, { ...frame, x: frame.x + deltaX, y: frame.y + deltaY }];
    }),
  );
}

function applyOverridesAndNormalize(
  document: OpenChartDocument,
  nodeIds: readonly string[],
  direction: LayoutDirection,
  spacing: number,
  gridSize: number,
  initialFrames: ReadonlyMap<string, InitialFrame>,
  frames: Map<string, MutableFrame>,
): Record<string, LayoutFrame> {
  const visibleNodeSet = new Set(nodeIds);
  const childIdsByParent = new Map<string, string[]>();
  for (const nodeId of nodeIds) {
    const parentId = document.nodes[nodeId]?.parentId;
    if (parentId !== undefined && visibleNodeSet.has(parentId)) {
      const childIds = childIdsByParent.get(parentId) ?? [];
      childIds.push(nodeId);
      childIdsByParent.set(parentId, childIds);
    }
  }
  for (const childIds of childIdsByParent.values()) {
    childIds.sort(compareIds);
  }

  const translateDescendants = (
    parentId: string,
    deltaX: number,
    deltaY: number,
    preservePinned: boolean,
  ): void => {
    for (const childId of childIdsByParent.get(parentId) ?? []) {
      if (preservePinned && initialFrames.get(childId)?.pinned === true) {
        continue;
      }
      const childFrame = frames.get(childId);
      if (childFrame !== undefined) {
        childFrame.x += deltaX;
        childFrame.y += deltaY;
      }
      translateDescendants(childId, deltaX, deltaY, preservePinned);
    }
  };

  for (const nodeId of nodeIds) {
    const frame = frames.get(nodeId);
    const initial = initialFrames.get(nodeId);
    if (frame === undefined || initial === undefined) {
      continue;
    }
    frame.width = positiveSize(frame.width, initial.frame.width);
    frame.height = positiveSize(frame.height, initial.frame.height);
  }

  const depthByNodeId = new Map<string, number>();
  const depthForNode = (nodeId: string): number => {
    const cached = depthByNodeId.get(nodeId);
    if (cached !== undefined) {
      return cached;
    }
    let depth = 0;
    let parentId = document.nodes[nodeId]?.parentId;
    const visited = new Set([nodeId]);
    while (parentId !== undefined && visibleNodeSet.has(parentId) && !visited.has(parentId)) {
      visited.add(parentId);
      depth += 1;
      parentId = document.nodes[parentId]?.parentId;
    }
    depthByNodeId.set(nodeId, depth);
    return depth;
  };
  const hierarchyOrder = [...nodeIds].sort((left, right) => (
    depthForNode(left) - depthForNode(right) || compareIds(left, right)
  ));
  for (const nodeId of hierarchyOrder) {
    const frame = frames.get(nodeId);
    const initial = initialFrames.get(nodeId);
    if (frame === undefined || initial === undefined) {
      continue;
    }
    const previousX = frame.x;
    const previousY = frame.y;
    if (initial.pinned) {
      // Preserve every explicit pinned field exactly; missing optional fields
      // still receive the deterministic size/position fallback.
      const override = initial.override;
      if (override !== undefined) {
        if (isFiniteNumber(override.x)) frame.x = override.x;
        if (isFiniteNumber(override.y)) frame.y = override.y;
        if (isPositiveNumber(override.width)) frame.width = override.width;
        if (isPositiveNumber(override.height)) frame.height = override.height;
      }
    } else {
      frame.x = snap(frame.x, gridSize);
      frame.y = snap(frame.y, gridSize);
    }
    const deltaX = frame.x - previousX;
    const deltaY = frame.y - previousY;
    if (deltaX !== 0 || deltaY !== 0) {
      // ELK returns child coordinates relative to their parent. Once converted
      // to absolute frames, any parent normalization must carry its subtree.
      // Pinned descendants are reset later in this parent-first pass.
      translateDescendants(nodeId, deltaX, deltaY, false);
    }
  }

  const pinnedFrames = nodeIds
    .filter((nodeId) => initialFrames.get(nodeId)?.pinned === true)
    .map((nodeId) => frames.get(nodeId))
    .filter((frame): frame is MutableFrame => frame !== undefined)
    .map(asLayoutFrame);
  const occupied: LayoutFrame[] = [...pinnedFrames];
  const topLevelIds = nodeIds.filter((nodeId) => {
    const parentId = document.nodes[nodeId]?.parentId;
    return parentId === undefined || !visibleNodeSet.has(parentId);
  });
  for (const nodeId of topLevelIds) {
    const initial = initialFrames.get(nodeId);
    const frame = frames.get(nodeId);
    if (initial?.pinned === true || frame === undefined) {
      continue;
    }
    let candidate = asLayoutFrame(frame);
    let guard = 0;
    while (occupied.some((other) => intersects(candidate, other)) && guard < 100_000) {
      const previousX = frame.x;
      const previousY = frame.y;
      let next = direction === 'RIGHT' ? candidate.x + gridSize : candidate.y + gridSize;
      for (const other of occupied) {
        if (!intersects(candidate, other)) {
          continue;
        }
        const edge = direction === 'RIGHT' ? other.x + other.width : other.y + other.height;
        next = Math.max(next, edge + spacing);
      }
      if (direction === 'RIGHT') {
        frame.x = snap(next, gridSize);
      } else {
        frame.y = snap(next, gridSize);
      }
      const deltaX = frame.x - previousX;
      const deltaY = frame.y - previousY;
      if (deltaX !== 0 || deltaY !== 0) {
        // De-overlap happens after pinned frames have been restored, so pinned
        // descendant subtrees must remain at their exact absolute positions.
        translateDescendants(nodeId, deltaX, deltaY, true);
      }
      candidate = asLayoutFrame(frame);
      guard += 1;
    }
    occupied.push(candidate);
  }

  const result: Record<string, LayoutFrame> = {};
  for (const nodeId of nodeIds) {
    const frame = frames.get(nodeId);
    if (frame !== undefined) {
      result[nodeId] = asLayoutFrame(frame);
    }
  }
  return result;
}

function terminateElk(elk: ELK): void {
  try {
    elk.terminateWorker();
  } catch (error) {
    // elkjs's Node fake-worker facade in 0.12.0 lacks terminate(), while the
    // browser worker has it. Do not turn a successful layout into a failure in
    // the DOM-free test/CLI runtime; rethrow unrelated cleanup failures.
    if (!(error instanceof TypeError && /terminate is not a function/.test(String(error)))) {
      throw error;
    }
  }
}

export async function layoutDocument(
  document: OpenChartDocument,
  options: LayoutDocumentOptions,
  runtime?: LayoutDocumentRuntime,
): Promise<LayoutDocumentResult> {
  const { engine, direction, spacing, gridSize } = validateOptions(document, options);
  const nodeIds = visibleNodeIds(document, options.pageId);
  if (nodeIds.length === 0) {
    return { engine, derivedVersion: LAYOUT_DERIVED_VERSION, frames: {} };
  }

  const initialFrames = new Map<string, InitialFrame>();
  const nodeIdByEncodedId = new Map<string, string>();
  for (const nodeId of nodeIds) {
    initialFrames.set(nodeId, initialFrameForNode(document, nodeId));
    nodeIdByEncodedId.set(encodedNodeId(nodeId), nodeId);
  }
  const allEdgeIds = visibleEdges(document, options.pageId, nodeIds);
  const edgeIds = options.mode === 'radial'
    ? radialForestEdges(document, allEdgeIds)
    : allEdgeIds;
  const graph = buildGraph(
    document,
    options.pageId,
    nodeIds,
    edgeIds,
    direction,
    spacing,
    options.mode,
    initialFrames,
  );

  let elk: ELK | undefined;
  try {
    const instance = await createElk(runtime);
    elk = instance;
    const laidOut = await instance.layout(graph);
    const frames = collectAbsoluteFrames(laidOut, nodeIdByEncodedId, initialFrames);
    const normalized = applyOverridesAndNormalize(
      document,
      nodeIds,
      direction,
      spacing,
      gridSize,
      initialFrames,
      frames,
    );
    return {
      engine,
      derivedVersion: LAYOUT_DERIVED_VERSION,
      frames: centerUnpinnedComposition(
        document,
        nodeIds,
        gridSize,
        initialFrames,
        normalized,
      ),
    };
  } finally {
    if (elk !== undefined) {
      terminateElk(elk);
    }
  }
}
