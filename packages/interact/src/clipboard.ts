import type {
  Edge,
  Node,
  OpenChartDocument,
  Port,
} from '@openchart/ir';
import { ID_PATTERN, UID_PATTERN } from '@openchart/ir';
import type { Operation, OperationEnvelope } from '@openchart/ops';

export type ClipboardEntityKind = 'node' | 'port' | 'edge';

export interface ClipboardFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation?: number;
}

export interface ClipboardPayload {
  readonly version: 1;
  readonly rootNodeIds: readonly string[];
  readonly nodes: Readonly<Record<string, Node>>;
  readonly ports: Readonly<Record<string, Port>>;
  readonly edges: Readonly<Record<string, Edge>>;
  readonly frames: Readonly<Record<string, ClipboardFrame>>;
}

export interface PasteOptions {
  readonly txId: string;
  readonly pageId: string;
  readonly layerId: string;
  readonly offset: { readonly x: number; readonly y: number };
  readonly allocateId: (kind: ClipboardEntityKind, sourceId: string) => string;
  readonly allocateUid: (kind: ClipboardEntityKind, sourceUid: string) => string;
}

export interface PasteTransactionResult {
  readonly envelope: OperationEnvelope;
  readonly pastedNodeIds: readonly string[];
  readonly pastedRootNodeIds: readonly string[];
}

export interface PasteStyleOptions {
  readonly txId: string;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function requireFrame(
  frames: Readonly<Record<string, ClipboardFrame>>,
  id: string,
): ClipboardFrame {
  const frame = frames[id];
  if (frame === undefined) {
    throw new Error(`Missing clipboard frame for node ${JSON.stringify(id)}`);
  }
  if (
    !Number.isFinite(frame.x) ||
    !Number.isFinite(frame.y) ||
    !Number.isFinite(frame.width) ||
    !Number.isFinite(frame.height) ||
    frame.width <= 0 ||
    frame.height <= 0 ||
    (frame.rotation !== undefined && !Number.isFinite(frame.rotation))
  ) {
    throw new Error(
      `Clipboard frame for node ${JSON.stringify(id)} must have finite coordinates and positive dimensions`,
    );
  }
  return frame;
}

export function createClipboardPayload(
  document: OpenChartDocument,
  selectedIds: readonly string[],
  frames: Readonly<Record<string, ClipboardFrame>>,
): ClipboardPayload {
  const selected = [...new Set(selectedIds)].sort(compareIds);
  if (selected.length === 0) {
    throw new Error('Clipboard selection must contain at least one node');
  }
  for (const id of selected) {
    if (document.nodes[id] === undefined) {
      throw new Error(`Clipboard node ${JSON.stringify(id)} does not exist`);
    }
  }

  const includedNodeIds = new Set(selected);
  for (const [id, node] of Object.entries(document.nodes)) {
    let parentId = node.parentId;
    const visited = new Set<string>();
    while (parentId !== undefined && !visited.has(parentId)) {
      if (includedNodeIds.has(parentId)) {
        includedNodeIds.add(id);
        break;
      }
      visited.add(parentId);
      parentId = document.nodes[parentId]?.parentId;
    }
  }
  const nodeIds = [...includedNodeIds].sort(compareIds);
  nodeIds.forEach((id) => requireFrame(frames, id));

  const roots = selected.filter((id) => {
    let parentId = document.nodes[id]?.parentId;
    const visited = new Set<string>();
    while (parentId !== undefined && !visited.has(parentId)) {
      if (includedNodeIds.has(parentId)) {
        return false;
      }
      visited.add(parentId);
      parentId = document.nodes[parentId]?.parentId;
    }
    return true;
  });
  const nodes: Record<string, Node> = {};
  const clipboardFrames: Record<string, ClipboardFrame> = {};
  for (const id of nodeIds) {
    const source = document.nodes[id];
    if (source === undefined) {
      continue;
    }
    const copied = clone(source);
    if (copied.parentId !== undefined && !includedNodeIds.has(copied.parentId)) {
      delete copied.parentId;
    }
    nodes[id] = copied;
    clipboardFrames[id] = { ...requireFrame(frames, id) };
  }

  const ports: Record<string, Port> = {};
  const portIds = Object.keys(document.ports)
    .filter((id) => includedNodeIds.has(document.ports[id]?.nodeId ?? ''))
    .sort(compareIds);
  for (const id of portIds) {
    const port = document.ports[id];
    if (port !== undefined) {
      ports[id] = clone(port);
    }
  }
  const includedPortIds = new Set(portIds);
  const edges: Record<string, Edge> = {};
  for (const id of Object.keys(document.edges).sort(compareIds)) {
    const edge = document.edges[id];
    if (
      edge !== undefined &&
      includedPortIds.has(edge.fromPortId) &&
      includedPortIds.has(edge.toPortId)
    ) {
      edges[id] = clone(edge);
    }
  }
  return {
    version: 1,
    rootNodeIds: roots,
    nodes,
    ports,
    edges,
    frames: clipboardFrames,
  };
}

export function createPasteTransaction(
  document: OpenChartDocument,
  payload: ClipboardPayload,
  options: PasteOptions,
): PasteTransactionResult {
  if (payload.version !== 1) {
    throw new Error(`Unsupported clipboard version ${String(payload.version)}`);
  }
  if (options.txId.length === 0) {
    throw new Error('Paste transaction id must not be empty');
  }
  if (!Number.isFinite(options.offset.x) || !Number.isFinite(options.offset.y)) {
    throw new Error('Paste offset must contain finite coordinates');
  }
  const page = document.pages[options.pageId];
  const layer = document.layers[options.layerId];
  if (page === undefined) {
    throw new Error(`Paste page ${JSON.stringify(options.pageId)} does not exist`);
  }
  if (layer === undefined || layer.pageId !== page.id) {
    throw new Error(
      `Paste layer ${JSON.stringify(options.layerId)} does not belong to page ${JSON.stringify(options.pageId)}`,
    );
  }

  const nodeIds = Object.keys(payload.nodes).sort(compareIds);
  const portIds = Object.keys(payload.ports).sort(compareIds);
  const edgeIds = Object.keys(payload.edges).sort(compareIds);
  if (nodeIds.length === 0) {
    throw new Error('Clipboard payload does not contain a node');
  }
  nodeIds.forEach((id) => requireFrame(payload.frames, id));

  const idMaps: Record<ClipboardEntityKind, Map<string, string>> = {
    node: new Map(),
    port: new Map(),
    edge: new Map(),
  };
  const existingByKind: Record<ClipboardEntityKind, Readonly<Record<string, unknown>>> = {
    node: document.nodes,
    port: document.ports,
    edge: document.edges,
  };
  const allocatedIdsByKind: Record<ClipboardEntityKind, Set<string>> = {
    node: new Set(),
    port: new Set(),
    edge: new Set(),
  };
  const allocatedUids = new Set<string>([
    document.uid,
    ...Object.values(document.pages).map((entity) => entity.uid),
    ...Object.values(document.layers).map((entity) => entity.uid),
    ...Object.values(document.nodes).map((entity) => entity.uid),
    ...Object.values(document.ports).map((entity) => entity.uid),
    ...Object.values(document.edges).map((entity) => entity.uid),
    ...Object.values(document.styles).map((entity) => entity.uid),
  ]);
  const uidMaps: Record<ClipboardEntityKind, Map<string, string>> = {
    node: new Map(),
    port: new Map(),
    edge: new Map(),
  };
  const allocate = (
    kind: ClipboardEntityKind,
    sourceId: string,
    sourceUid: string,
  ): void => {
    const id = options.allocateId(kind, sourceId);
    if (!ID_PATTERN.test(id)) {
      throw new Error(`Allocator returned invalid ${kind} id ${JSON.stringify(id)}`);
    }
    if (existingByKind[kind][id] !== undefined || allocatedIdsByKind[kind].has(id)) {
      throw new Error(`Allocator allocated duplicate ${kind} id ${JSON.stringify(id)}`);
    }
    const uid = options.allocateUid(kind, sourceUid);
    if (!UID_PATTERN.test(uid)) {
      throw new Error(`Allocator returned invalid ${kind} UID ${JSON.stringify(uid)}`);
    }
    if (allocatedUids.has(uid)) {
      throw new Error(`Allocator allocated duplicate UID ${JSON.stringify(uid)}`);
    }
    allocatedIdsByKind[kind].add(id);
    allocatedUids.add(uid);
    idMaps[kind].set(sourceId, id);
    uidMaps[kind].set(sourceId, uid);
  };
  for (const id of nodeIds) {
    const node = payload.nodes[id];
    if (node !== undefined) {
      allocate('node', id, node.uid);
    }
  }
  for (const id of portIds) {
    const port = payload.ports[id];
    if (port !== undefined) {
      allocate('port', id, port.uid);
    }
  }
  for (const id of edgeIds) {
    const edge = payload.edges[id];
    if (edge !== undefined) {
      allocate('edge', id, edge.uid);
    }
  }

  const nodeDepth = (id: string): number => {
    let depth = 0;
    let parentId = payload.nodes[id]?.parentId;
    const visited = new Set<string>();
    while (parentId !== undefined && payload.nodes[parentId] !== undefined) {
      if (visited.has(parentId)) {
        break;
      }
      visited.add(parentId);
      depth += 1;
      parentId = payload.nodes[parentId]?.parentId;
    }
    return depth;
  };
  const orderedNodeIds = [...nodeIds].sort((left, right) => {
    const depth = nodeDepth(left) - nodeDepth(right);
    return depth === 0 ? compareIds(left, right) : depth;
  });
  const ops: Operation[] = [];
  for (const sourceId of orderedNodeIds) {
    const source = payload.nodes[sourceId];
    const id = idMaps.node.get(sourceId);
    const uid = uidMaps.node.get(sourceId);
    if (source === undefined || id === undefined || uid === undefined) {
      throw new Error(`Clipboard node ${JSON.stringify(sourceId)} could not be remapped`);
    }
    const parentId =
      source.parentId === undefined ? undefined : idMaps.node.get(source.parentId);
    ops.push({
      op: 'create_node',
      node: {
        ...clone(source),
        id,
        uid,
        pageId: options.pageId,
        layerId: options.layerId,
        ...(parentId === undefined ? { parentId: undefined } : { parentId }),
      },
    });
  }
  for (const sourceId of portIds) {
    const source = payload.ports[sourceId];
    const id = idMaps.port.get(sourceId);
    const uid = uidMaps.port.get(sourceId);
    const nodeId = source === undefined ? undefined : idMaps.node.get(source.nodeId);
    if (source === undefined || id === undefined || uid === undefined || nodeId === undefined) {
      throw new Error(`Clipboard port ${JSON.stringify(sourceId)} could not be remapped`);
    }
    ops.push({ op: 'create_port', port: { ...clone(source), id, uid, nodeId } });
  }
  for (const sourceId of edgeIds) {
    const source = payload.edges[sourceId];
    const id = idMaps.edge.get(sourceId);
    const uid = uidMaps.edge.get(sourceId);
    const fromPortId =
      source === undefined ? undefined : idMaps.port.get(source.fromPortId);
    const toPortId =
      source === undefined ? undefined : idMaps.port.get(source.toPortId);
    if (
      source === undefined ||
      id === undefined ||
      uid === undefined ||
      fromPortId === undefined ||
      toPortId === undefined
    ) {
      throw new Error(`Clipboard edge ${JSON.stringify(sourceId)} could not be remapped`);
    }
    ops.push({
      op: 'create_edge',
      edge: {
        ...clone(source),
        id,
        uid,
        fromPortId,
        toPortId,
        pageId: options.pageId,
        layerId: options.layerId,
      },
    });
  }
  for (const sourceId of nodeIds) {
    const id = idMaps.node.get(sourceId);
    const frame = requireFrame(payload.frames, sourceId);
    if (id === undefined) {
      throw new Error(`Clipboard node ${JSON.stringify(sourceId)} has no allocated id`);
    }
    ops.push({
      op: 'set_node_layout',
      id,
      layout: {
        x: frame.x + options.offset.x,
        y: frame.y + options.offset.y,
        width: frame.width,
        height: frame.height,
        ...(frame.rotation === undefined ? {} : { rotation: frame.rotation }),
        pinned: true,
      },
    });
  }
  const pastedRootNodeIds = payload.rootNodeIds.map((sourceId) => {
    const id = idMaps.node.get(sourceId);
    if (id === undefined) {
      throw new Error(`Clipboard root node ${JSON.stringify(sourceId)} has no allocated id`);
    }
    return id;
  });
  return {
    envelope: {
      txId: options.txId,
      actor: 'user',
      origin: 'gui',
      baseRev: document.rev,
      ops,
    },
    pastedNodeIds: nodeIds.map((id) => idMaps.node.get(id) as string),
    pastedRootNodeIds,
  };
}

export function createPasteStyleTransaction(
  document: OpenChartDocument,
  sourceNodeId: string,
  targetNodeIds: readonly string[],
  options: PasteStyleOptions,
): OperationEnvelope {
  if (options.txId.length === 0) {
    throw new Error('Paste-style transaction id must not be empty');
  }
  const source = document.nodes[sourceNodeId];
  if (source === undefined) {
    throw new Error(`Style source node ${JSON.stringify(sourceNodeId)} does not exist`);
  }
  const targets = [...new Set(targetNodeIds)].sort(compareIds);
  if (targets.length === 0) {
    throw new Error('Paste-style selection must contain a target node');
  }
  const ops: Operation[] = targets.map((id) => {
    if (document.nodes[id] === undefined) {
      throw new Error(`Style target node ${JSON.stringify(id)} does not exist`);
    }
    return { op: 'set_node_style', id, styleId: source.styleId };
  });
  return {
    txId: options.txId,
    actor: 'user',
    origin: 'gui',
    baseRev: document.rev,
    ops,
  };
}
