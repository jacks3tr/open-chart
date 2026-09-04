import type { OpenChartDocument } from '@openchart/ir';
import type { Operation } from '@openchart/ops';
import { D2ProjectionError, parseOpenChartD2 } from '@openchart/serialize';

import { sha256Hex } from './hash.js';

const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_PROPOSAL_OPERATIONS = 5000;

export interface ProposeD2ImportInput {
  readonly source: string;
  readonly pageId: string;
  readonly layerId?: string;
  readonly nodeStyleId?: string;
  readonly edgeStyleId?: string;
}

export interface D2ImportProposalSuccess {
  readonly ok: true;
  readonly baseRev: number;
  readonly operations: readonly Operation[];
  readonly operationCount: number;
  readonly createCount: number;
  readonly updateCount: number;
  readonly deleteCount: number;
  readonly defaults: {
    readonly layerId: string;
    readonly nodeStyleId: string;
    readonly edgeStyleId: string;
  };
}

export interface D2ImportProposalFailure {
  readonly ok: false;
  readonly code:
    | 'INVALID_D2'
    | 'INVALID_INPUT'
    | 'PROJECTION_CONFLICT'
    | 'PROPOSAL_TOO_LARGE';
  readonly message: string;
  readonly field?: string;
  readonly conflicts?: readonly string[];
  readonly operations: readonly [];
}

export type D2ImportProposalResult =
  | D2ImportProposalSuccess
  | D2ImportProposalFailure;

function failure(
  code: D2ImportProposalFailure['code'],
  message: string,
  extras: Pick<D2ImportProposalFailure, 'field' | 'conflicts'> = {},
): D2ImportProposalFailure {
  return {
    ok: false,
    code,
    message: message.length > 240 ? `${message.slice(0, 237)}...` : message,
    ...(extras.field === undefined ? {} : { field: extras.field }),
    ...(extras.conflicts === undefined ? {} : { conflicts: extras.conflicts }),
    operations: [],
  };
}

async function deterministicUid(
  document: OpenChartDocument,
  kind: 'node' | 'port' | 'edge',
  id: string,
  allocated: Set<string>,
): Promise<string> {
  let salt = 0;
  while (true) {
    // ponytail: content-derived UIDs keep proposals retry-stable; use a monotonic
    // ULID allocator only if creation-time ordering becomes a product contract.
    const hash = (await sha256Hex(
      `${document.documentId}\0${kind}\0${id}\0${salt}`,
    )).toUpperCase();
    const uid = `0${hash.slice(0, 25)}`;
    if (!allocated.has(uid)) {
      allocated.add(uid);
      return uid;
    }
    salt += 1;
  }
}

function nodeDepth(
  id: string,
  parentByNode: ReadonlyMap<string, string | undefined>,
): number {
  let depth = 0;
  let parent = parentByNode.get(id);
  while (parent !== undefined) {
    depth += 1;
    parent = parentByNode.get(parent);
  }
  return depth;
}

function opCategory(operation: Operation): 'create' | 'update' | 'delete' {
  if (operation.op.startsWith('create_')) return 'create';
  if (operation.op.startsWith('delete_')) return 'delete';
  return 'update';
}

export async function proposeD2Import(
  document: OpenChartDocument,
  input: ProposeD2ImportInput,
): Promise<D2ImportProposalResult> {
  if (!input || typeof input !== 'object') {
    return failure('INVALID_INPUT', 'D2 import proposal input must be an object');
  }
  if (typeof input.source !== 'string' || input.source.length === 0) {
    return failure('INVALID_INPUT', 'source must be a non-empty string', {
      field: 'source',
    });
  }
  if (new TextEncoder().encode(input.source).byteLength > MAX_SOURCE_BYTES) {
    return failure('INVALID_INPUT', 'source exceeds the 1 MiB input limit', {
      field: 'source',
    });
  }
  const page = document.pages[input.pageId];
  if (page === undefined) {
    return failure('INVALID_INPUT', `Unknown page ${JSON.stringify(input.pageId)}`, {
      field: 'pageId',
    });
  }
  const layerId = input.layerId ?? page.layerIds[0];
  const layer = layerId === undefined ? undefined : document.layers[layerId];
  if (layer === undefined || layer.pageId !== page.id) {
    return failure('INVALID_INPUT', 'layerId must name a layer on the selected page', {
      field: 'layerId',
    });
  }
  const styles = Object.values(document.styles).sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const nodeStyleId =
    input.nodeStyleId ?? styles.find(({ role }) => !role.startsWith('flow/'))?.id;
  const edgeStyleId =
    input.edgeStyleId ??
    styles.find(({ role }) => role.startsWith('flow/'))?.id ??
    styles[0]?.id;
  if (nodeStyleId === undefined || document.styles[nodeStyleId] === undefined) {
    return failure('INVALID_INPUT', 'nodeStyleId must name an existing style', {
      field: 'nodeStyleId',
    });
  }
  if (edgeStyleId === undefined || document.styles[edgeStyleId] === undefined) {
    return failure('INVALID_INPUT', 'edgeStyleId must name an existing style', {
      field: 'edgeStyleId',
    });
  }
  const selectedLayerId = layer.id;
  const selectedNodeStyleId = nodeStyleId;
  const selectedEdgeStyleId = edgeStyleId;

  let projection: ReturnType<typeof parseOpenChartD2>;
  try {
    projection = parseOpenChartD2(input.source);
  } catch (error: unknown) {
    return failure(
      'INVALID_D2',
      error instanceof D2ProjectionError ? error.message : String(error),
      { field: 'source' },
    );
  }

  const conflicts: string[] = [];
  for (const node of projection.nodes) {
    const existing = document.nodes[node.id];
    if (existing !== undefined && existing.pageId !== page.id) {
      conflicts.push(`Node ${node.id} already exists on another page`);
    } else if (existing !== undefined && existing.kind !== node.kind) {
      conflicts.push(`Node ${node.id} kind cannot change from ${existing.kind} to ${node.kind}`);
    }
    if (node.parentId !== undefined) {
      const parent = projection.nodes.find(({ id }) => id === node.parentId);
      if (parent === undefined) conflicts.push(`Node ${node.id} has an omitted parent`);
    }
  }
  for (const port of projection.ports) {
    const existing = document.ports[port.id];
    if (existing !== undefined && existing.nodeId !== port.nodeId) {
      conflicts.push(`Port ${port.id} cannot move between nodes`);
    }
    const existingNode = document.nodes[port.nodeId];
    if (
      existingNode !== undefined &&
      existingNode.pageId !== page.id &&
      !projection.nodes.some(({ id }) => id === port.nodeId)
    ) {
      conflicts.push(`Port ${port.id} targets a node on another page`);
    }
  }
  for (const edge of projection.edges) {
    const existing = document.edges[edge.id];
    if (existing !== undefined && existing.pageId !== page.id) {
      conflicts.push(`Edge ${edge.id} already exists on another page`);
    }
  }
  if (conflicts.length > 0) {
    return failure('PROJECTION_CONFLICT', conflicts[0] ?? 'Projection conflict', {
      conflicts: conflicts.slice(0, 50),
    });
  }

  const currentNodes = Object.values(document.nodes).filter(
    (node) => node.pageId === page.id,
  );
  const currentNodeIds = new Set(currentNodes.map(({ id }) => id));
  const currentPorts = Object.values(document.ports).filter((port) =>
    currentNodeIds.has(port.nodeId),
  );
  const currentEdges = Object.values(document.edges).filter(
    (edge) => edge.pageId === page.id,
  );
  const proposedNodeIds = new Set(projection.nodes.map(({ id }) => id));
  const proposedPortIds = new Set(projection.ports.map(({ id }) => id));
  const proposedEdgeIds = new Set(projection.edges.map(({ id }) => id));
  const deletedNodeIds = new Set(
    currentNodes.filter(({ id }) => !proposedNodeIds.has(id)).map(({ id }) => id),
  );
  const deletedPortIds = new Set(
    currentPorts
      .filter(({ id, nodeId }) => deletedNodeIds.has(nodeId) || !proposedPortIds.has(id))
      .map(({ id }) => id),
  );
  const parentByNode = new Map(
    projection.nodes.map(({ id, parentId }) => [id, parentId] as const),
  );
  const childrenByParent = new Set(
    projection.nodes.flatMap(({ parentId }) =>
      parentId === undefined ? [] : [parentId],
    ),
  );
  const allocatedUids = new Set([
    document.uid,
    ...Object.values(document.pages).map(({ uid }) => uid),
    ...Object.values(document.layers).map(({ uid }) => uid),
    ...Object.values(document.nodes).map(({ uid }) => uid),
    ...Object.values(document.ports).map(({ uid }) => uid),
    ...Object.values(document.edges).map(({ uid }) => uid),
    ...Object.values(document.styles).map(({ uid }) => uid),
  ]);
  const operations: Operation[] = [];

  for (const parentId of [...childrenByParent].sort()) {
    const parent = document.nodes[parentId];
    if (parent !== undefined && parent.container === undefined && parent.group === undefined) {
      operations.push({ op: 'set_node_container', id: parentId, container: {} });
    }
  }
  for (const node of projection.nodes
    .filter(({ id }) => document.nodes[id] === undefined)
    .sort((left, right) =>
      nodeDepth(left.id, parentByNode) - nodeDepth(right.id, parentByNode) ||
      left.id.localeCompare(right.id),
    )) {
    operations.push({
      op: 'create_node',
      node: {
        id: node.id,
        uid: await deterministicUid(document, 'node', node.id, allocatedUids),
        kind: node.kind,
        label: node.label,
        pageId: page.id,
        layerId: selectedLayerId,
        styleId: selectedNodeStyleId,
        ...(node.parentId === undefined ? {} : { parentId: node.parentId }),
        ...(childrenByParent.has(node.id) ? { container: {} } : {}),
        data: {},
      },
    });
  }
  for (const node of projection.nodes) {
    const existing = document.nodes[node.id];
    if (existing === undefined) continue;
    if (existing.label !== node.label) {
      operations.push({ op: 'set_node_label', id: node.id, label: node.label });
    }
    if (existing.parentId !== node.parentId) {
      operations.push({
        op: 'set_node_parent',
        id: node.id,
        parentId: node.parentId ?? null,
      });
    }
  }
  for (const port of projection.ports) {
    if (document.ports[port.id] === undefined) {
      operations.push({
        op: 'create_port',
        port: {
          id: port.id,
          uid: await deterministicUid(document, 'port', port.id, allocatedUids),
          nodeId: port.nodeId,
          direction: port.direction,
          side: port.side,
          ...(port.order === undefined ? {} : { order: port.order }),
        },
      });
    }
  }
  for (const edge of projection.edges) {
    const existing = document.edges[edge.id];
    if (
      existing !== undefined &&
      (existing.fromPortId !== edge.fromPortId || existing.toPortId !== edge.toPortId)
    ) {
      operations.push({
        op: 'set_edge_endpoints',
        id: edge.id,
        fromPortId: edge.fromPortId,
        toPortId: edge.toPortId,
      });
    }
  }
  for (const edge of currentEdges) {
    if (
      !proposedEdgeIds.has(edge.id) &&
      !deletedPortIds.has(edge.fromPortId) &&
      !deletedPortIds.has(edge.toPortId)
    ) {
      operations.push({ op: 'delete_edge', id: edge.id });
    }
  }
  for (const port of currentPorts) {
    if (!proposedPortIds.has(port.id) && !deletedNodeIds.has(port.nodeId)) {
      operations.push({ op: 'delete_port', id: port.id });
    }
  }
  for (const node of currentNodes
    .filter(({ id }) => deletedNodeIds.has(id))
    .sort((left, right) =>
      nodeDepth(right.id, new Map(currentNodes.map(({ id, parentId }) => [id, parentId]))) -
        nodeDepth(left.id, new Map(currentNodes.map(({ id, parentId }) => [id, parentId]))) ||
      left.id.localeCompare(right.id),
    )) {
    operations.push({ op: 'delete_node', id: node.id });
  }
  for (const port of projection.ports) {
    const existing = document.ports[port.id];
    if (existing === undefined) continue;
    if (existing.direction !== port.direction) {
      operations.push({
        op: 'set_port_direction',
        id: port.id,
        direction: port.direction,
      });
    }
    if (existing.side !== port.side) {
      operations.push({ op: 'set_port_side', id: port.id, side: port.side });
    }
    if (existing.order !== port.order) {
      operations.push({
        op: 'set_port_order',
        id: port.id,
        order: port.order ?? null,
      });
    }
  }
  for (const edge of projection.edges) {
    const existing = document.edges[edge.id];
    if (existing === undefined) {
      operations.push({
        op: 'create_edge',
        edge: {
          id: edge.id,
          uid: await deterministicUid(document, 'edge', edge.id, allocatedUids),
          fromPortId: edge.fromPortId,
          toPortId: edge.toPortId,
          label: edge.label,
          semantic: edge.semantic,
          pageId: page.id,
          layerId: selectedLayerId,
          styleId: selectedEdgeStyleId,
          data: {},
        },
      });
      continue;
    }
    if (existing.label !== edge.label) {
      operations.push({ op: 'set_edge_label', id: edge.id, label: edge.label });
    }
    if (existing.semantic !== edge.semantic) {
      operations.push({
        op: 'set_edge_semantic',
        id: edge.id,
        semantic: edge.semantic,
      });
    }
  }

  if (operations.length > MAX_PROPOSAL_OPERATIONS) {
    return failure(
      'PROPOSAL_TOO_LARGE',
      `Proposal has ${operations.length} operations; maximum is ${MAX_PROPOSAL_OPERATIONS}`,
    );
  }
  const counts = { create: 0, update: 0, delete: 0 };
  for (const operation of operations) counts[opCategory(operation)] += 1;
  return {
    ok: true,
    baseRev: document.rev,
    operations,
    operationCount: operations.length,
    createCount: counts.create,
    updateCount: counts.update,
    deleteCount: counts.delete,
    defaults: {
      layerId: selectedLayerId,
      nodeStyleId: selectedNodeStyleId,
      edgeStyleId: selectedEdgeStyleId,
    },
  };
}
