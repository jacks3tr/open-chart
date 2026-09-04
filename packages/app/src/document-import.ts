import type {
  Edge,
  LayoutOverride,
  Node,
  OpenChartDocument,
  Port,
} from '@openchart/ir';
import type { Operation, OperationEnvelope } from '@openchart/ops';

export interface OpenChartPageImportTransaction {
  readonly envelope: OperationEnvelope;
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
}

function randomUid(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = new Uint8Array(26);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
}

function releasedPageEntities(document: OpenChartDocument, pageId: string): {
  readonly nodeIds: ReadonlySet<string>;
  readonly portIds: ReadonlySet<string>;
  readonly edgeIds: ReadonlySet<string>;
} {
  const nodeIds = new Set(
    Object.values(document.nodes)
      .filter((node) => node.pageId === pageId)
      .map((node) => node.id),
  );
  const portIds = new Set(
    Object.values(document.ports)
      .filter((port) => nodeIds.has(port.nodeId))
      .map((port) => port.id),
  );
  const edgeIds = new Set(
    Object.values(document.edges)
      .filter(
        (edge) =>
          edge.pageId === pageId ||
          portIds.has(edge.fromPortId) ||
          portIds.has(edge.toPortId),
      )
      .map((edge) => edge.id),
  );
  return { nodeIds, portIds, edgeIds };
}

function allocateImportId(
  existing: Readonly<Record<string, unknown>>,
  released: ReadonlySet<string>,
  reserved: Set<string>,
  preferred: string,
): string {
  let candidate = preferred;
  let index = 2;
  while (
    reserved.has(candidate) ||
    (existing[candidate] !== undefined && !released.has(candidate))
  ) {
    candidate = `${preferred}.import.${index}`;
    index += 1;
  }
  reserved.add(candidate);
  return candidate;
}

function firstPageId(document: OpenChartDocument): string | undefined {
  return Object.values(document.pages)
    .toSorted((left, right) => {
      const order = (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER);
      return order === 0 ? left.id.localeCompare(right.id) : order;
    })[0]?.id;
}

function fallbackNodeStyleId(document: OpenChartDocument): string {
  const preferred = document.styles['style.fabric'] === undefined ? undefined : 'style.fabric';
  const fallback = preferred ?? Object.keys(document.styles).sort()[0];
  if (fallback === undefined) throw new Error('Import requires at least one node style');
  return fallback;
}

function fallbackEdgeStyleId(document: OpenChartDocument): string {
  return Object.values(document.styles)
    .filter((style) => style.role.toLowerCase().includes('flow'))
    .toSorted((left, right) => left.id.localeCompare(right.id))[0]?.id ?? fallbackNodeStyleId(document);
}

function sourceLayout(document: OpenChartDocument, nodeId: string): LayoutOverride | undefined {
  const explicit = document.layout.overrides[nodeId];
  if (explicit !== undefined) return { ...explicit };
  const derived = document.layout.derived?.[nodeId];
  return derived === undefined ? undefined : { ...derived, pinned: true };
}

function nodeDepth(nodes: ReadonlyMap<string, Node>, node: Node): number {
  let depth = 0;
  let current = node;
  const seen = new Set<string>();
  while (current.parentId !== undefined && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    const parent = nodes.get(current.parentId);
    if (parent === undefined) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

export function createOpenChartPageImportTransaction(
  target: OpenChartDocument,
  source: OpenChartDocument,
  request: {
    readonly txId: string;
    readonly targetPageId: string;
    readonly targetLayerId: string;
    readonly sourcePageId?: string;
    readonly makeUid?: () => string;
  },
): OpenChartPageImportTransaction {
  const targetPage = target.pages[request.targetPageId];
  const targetLayer = target.layers[request.targetLayerId];
  if (targetPage === undefined) throw new Error('Import target page does not exist');
  if (targetLayer === undefined || targetLayer.pageId !== targetPage.id) {
    throw new Error('Import target layer is not on the target page');
  }
  if (targetLayer.locked) throw new Error('Unlock the target layer before importing');

  const sourcePageId = request.sourcePageId ?? firstPageId(source);
  if (sourcePageId === undefined || source.pages[sourcePageId] === undefined) {
    throw new Error('The imported OpenChart document does not contain a page');
  }

  const sourceNodes = Object.values(source.nodes).filter((node) => node.pageId === sourcePageId);
  const sourceNodeById = new Map(sourceNodes.map((node) => [node.id, node]));
  const sourcePorts = Object.values(source.ports).filter((port) => sourceNodeById.has(port.nodeId));
  const sourcePortIds = new Set(sourcePorts.map((port) => port.id));
  const sourceEdges = Object.values(source.edges).filter(
    (edge) =>
      edge.pageId === sourcePageId &&
      sourcePortIds.has(edge.fromPortId) &&
      sourcePortIds.has(edge.toPortId),
  );

  const released = releasedPageEntities(target, request.targetPageId);
  const nodeReserved = new Set<string>();
  const portReserved = new Set<string>();
  const edgeReserved = new Set<string>();
  const nodeIdMap = new Map<string, string>();
  const portIdMap = new Map<string, string>();
  const makeUid = request.makeUid ?? randomUid;
  const nodeFallback = fallbackNodeStyleId(target);
  const edgeFallback = fallbackEdgeStyleId(target);
  const ops: Operation[] = [...released.nodeIds]
    .sort((left, right) => left.localeCompare(right))
    .map((id): Operation => ({ op: 'delete_node', id }));

  for (const sourceNode of sourceNodes) {
    nodeIdMap.set(
      sourceNode.id,
      allocateImportId(target.nodes, released.nodeIds, nodeReserved, sourceNode.id),
    );
  }
  for (const sourcePort of sourcePorts) {
    portIdMap.set(
      sourcePort.id,
      allocateImportId(target.ports, released.portIds, portReserved, sourcePort.id),
    );
  }

  const orderedNodes = sourceNodes.toSorted((left, right) => {
    const depth = nodeDepth(sourceNodeById, left) - nodeDepth(sourceNodeById, right);
    return depth === 0 ? left.id.localeCompare(right.id) : depth;
  });
  const importedNodeIds: string[] = [];
  for (const sourceNode of orderedNodes) {
    const id = nodeIdMap.get(sourceNode.id);
    if (id === undefined) throw new Error(`Unable to allocate imported node ${sourceNode.id}`);
    const parentId = sourceNode.parentId === undefined ? undefined : nodeIdMap.get(sourceNode.parentId);
    const node: Node = {
      ...sourceNode,
      id,
      uid: makeUid(),
      pageId: request.targetPageId,
      layerId: request.targetLayerId,
      styleId: target.styles[sourceNode.styleId] === undefined ? nodeFallback : sourceNode.styleId,
      data: { ...sourceNode.data },
      ...(parentId === undefined ? {} : { parentId }),
    };
    if (sourceNode.parentId !== undefined && parentId === undefined) {
      throw new Error(`Unable to map imported parent ${sourceNode.parentId}`);
    }
    if (sourceNode.parentId === undefined && node.parentId !== undefined) {
      delete node.parentId;
    }
    ops.push({ op: 'create_node', node });
    const layout = sourceLayout(source, sourceNode.id);
    if (layout !== undefined) ops.push({ op: 'set_node_layout', id, layout });
    importedNodeIds.push(id);
  }

  for (const sourcePort of sourcePorts.toSorted((left, right) => left.id.localeCompare(right.id))) {
    const id = portIdMap.get(sourcePort.id);
    const nodeId = nodeIdMap.get(sourcePort.nodeId);
    if (id === undefined || nodeId === undefined) throw new Error('Unable to allocate imported port');
    const port: Port = { ...sourcePort, id, uid: makeUid(), nodeId };
    ops.push({ op: 'create_port', port });
  }

  const importedEdgeIds: string[] = [];
  for (const sourceEdge of sourceEdges.toSorted((left, right) => left.id.localeCompare(right.id))) {
    const fromPortId = portIdMap.get(sourceEdge.fromPortId);
    const toPortId = portIdMap.get(sourceEdge.toPortId);
    if (fromPortId === undefined || toPortId === undefined) throw new Error('Unable to map imported edge ports');
    const id = allocateImportId(target.edges, released.edgeIds, edgeReserved, sourceEdge.id);
    const edge: Edge = {
      ...sourceEdge,
      id,
      uid: makeUid(),
      fromPortId,
      toPortId,
      pageId: request.targetPageId,
      layerId: request.targetLayerId,
      styleId: target.styles[sourceEdge.styleId] === undefined ? edgeFallback : sourceEdge.styleId,
      data: { ...sourceEdge.data },
    };
    ops.push({ op: 'create_edge', edge });
    const edgeLayout = source.layout.edgeOverrides?.[sourceEdge.id];
    if (edgeLayout !== undefined) {
      ops.push({ op: 'set_edge_layout', id, layout: { ...edgeLayout } });
    }
    importedEdgeIds.push(id);
  }

  return {
    envelope: {
      txId: request.txId,
      actor: 'user',
      origin: 'gui',
      baseRev: target.rev,
      ops,
    },
    nodeIds: importedNodeIds,
    edgeIds: importedEdgeIds,
  };
}
