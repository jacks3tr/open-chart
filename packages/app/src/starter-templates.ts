import type { Edge, Node, OpenChartDocument, Port } from '@openchart/ir';
import type { Operation, OperationEnvelope } from '@openchart/ops';

export type StarterTemplateId =
  | 'flowchart'
  | 'integration'
  | 'cloud'
  | 'uml-erd'
  | 'network';

export interface StarterTemplateNodeSpec {
  readonly key: string;
  readonly label: string;
  readonly kind: 'service' | 'control' | 'database' | 'system';
  readonly libraryId: string;
  readonly entryId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StarterTemplateEdgeSpec {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly semantic?: string;
  readonly fromSide?: Port['side'];
  readonly toSide?: Port['side'];
  readonly waypoints?: readonly { readonly x: number; readonly y: number }[];
}

export interface StarterTemplateDefinition {
  readonly id: StarterTemplateId;
  readonly name: string;
  readonly section: string;
  readonly description: string;
  readonly nodes: readonly StarterTemplateNodeSpec[];
  readonly edges: readonly StarterTemplateEdgeSpec[];
}

export interface StarterTemplateTransaction {
  readonly envelope: OperationEnvelope;
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
}

const FLOWCHART_STARTER: StarterTemplateDefinition = {
  id: 'flowchart',
  name: 'Approval flowchart',
  section: 'Process',
  description: 'A complete request-and-approval flow with decision branches, document output, and an off-page handoff.',
  nodes: [
    { key: 'start', label: 'Request received', kind: 'control', libraryId: 'flowchart', entryId: 'flowchart.terminator', x: 80, y: 90, width: 170, height: 78 },
    { key: 'validate', label: 'Validate request', kind: 'service', libraryId: 'flowchart', entryId: 'flowchart.process', x: 320, y: 78, width: 190, height: 100 },
    { key: 'decision', label: 'Meets policy?', kind: 'control', libraryId: 'flowchart', entryId: 'flowchart.decision', x: 590, y: 70, width: 150, height: 120 },
    { key: 'approve', label: 'Approve request', kind: 'service', libraryId: 'flowchart', entryId: 'flowchart.process', x: 840, y: 55, width: 190, height: 100 },
    { key: 'document', label: 'Issue approval', kind: 'service', libraryId: 'flowchart', entryId: 'flowchart.document', x: 1090, y: 50, width: 190, height: 110 },
    { key: 'manual', label: 'Request clarification', kind: 'service', libraryId: 'flowchart', entryId: 'flowchart.manual-input', x: 590, y: 270, width: 190, height: 105 },
    { key: 'rework', label: 'Update request', kind: 'service', libraryId: 'flowchart', entryId: 'flowchart.predefined-process', x: 320, y: 278, width: 190, height: 100 },
    { key: 'handoff', label: 'Continue on next page', kind: 'control', libraryId: 'flowchart', entryId: 'flowchart.off-page-connector', x: 1095, y: 270, width: 170, height: 105 },
  ],
  edges: [
    { from: 'start', to: 'validate' },
    { from: 'validate', to: 'decision' },
    { from: 'decision', to: 'approve', label: 'Yes' },
    { from: 'approve', to: 'document' },
    { from: 'document', to: 'handoff', fromSide: 'south', toSide: 'north' },
    { from: 'decision', to: 'manual', label: 'No', fromSide: 'south', toSide: 'north' },
    { from: 'manual', to: 'rework', fromSide: 'west', toSide: 'east' },
    { from: 'rework', to: 'validate', fromSide: 'north', toSide: 'south', waypoints: [{ x: 415, y: 220 }] },
  ],
};

const INTEGRATION_STARTER: StarterTemplateDefinition = {
  id: 'integration',
  name: 'Event-driven integration',
  section: 'Architecture',
  description: 'API gateway, load balancer, services, cache, queue, worker, database, and external SaaS with labeled orthogonal flows.',
  nodes: [
    { key: 'client', label: 'Web & mobile clients', kind: 'service', libraryId: 'integration', entryId: 'integration.client', x: 60, y: 155, width: 170, height: 115 },
    { key: 'gateway', label: 'API gateway', kind: 'control', libraryId: 'integration', entryId: 'integration.api-gateway', x: 300, y: 150, width: 170, height: 120 },
    { key: 'lb', label: 'Load balancer', kind: 'control', libraryId: 'architecture', entryId: 'architecture.load-balancer', x: 540, y: 150, width: 170, height: 120 },
    { key: 'orders', label: 'Order service', kind: 'service', libraryId: 'integration', entryId: 'integration.service', x: 790, y: 70, width: 190, height: 112 },
    { key: 'inventory', label: 'Inventory service', kind: 'service', libraryId: 'integration', entryId: 'integration.service', x: 790, y: 245, width: 190, height: 112 },
    { key: 'cache', label: 'Shared cache', kind: 'database', libraryId: 'integration', entryId: 'integration.cache', x: 1050, y: 40, width: 170, height: 120 },
    { key: 'queue', label: 'Order events', kind: 'database', libraryId: 'integration', entryId: 'integration.queue', x: 1050, y: 205, width: 180, height: 112 },
    { key: 'worker', label: 'Fulfillment worker', kind: 'service', libraryId: 'integration', entryId: 'integration.worker', x: 1310, y: 205, width: 190, height: 112 },
    { key: 'db', label: 'Orders database', kind: 'database', libraryId: 'integration', entryId: 'integration.database', x: 1310, y: 40, width: 180, height: 120 },
    { key: 'saas', label: 'Shipping SaaS', kind: 'service', libraryId: 'integration', entryId: 'integration.external-saas', x: 1560, y: 205, width: 180, height: 112 },
  ],
  edges: [
    { from: 'client', to: 'gateway', label: 'HTTPS' },
    { from: 'gateway', to: 'lb', label: 'authorized' },
    { from: 'lb', to: 'orders', label: 'orders', toSide: 'west' },
    { from: 'lb', to: 'inventory', label: 'inventory', toSide: 'west' },
    { from: 'orders', to: 'cache', label: 'read/write' },
    { from: 'orders', to: 'db', label: 'transaction', fromSide: 'east', toSide: 'west' },
    { from: 'orders', to: 'queue', label: 'publish', fromSide: 'south', toSide: 'north' },
    { from: 'queue', to: 'worker', label: 'consume' },
    { from: 'worker', to: 'saas', label: 'ship request' },
    { from: 'inventory', to: 'queue', label: 'stock event' },
  ],
};

const CLOUD_STARTER: StarterTemplateDefinition = {
  id: 'cloud',
  name: 'Multi-cloud service path',
  section: 'Cloud',
  description: 'A recognizable AWS/Azure/GCP service path with edge delivery, compute, messaging, data, and observability.',
  nodes: [
    { key: 'aws-edge', label: 'AWS CloudFront', kind: 'system', libraryId: 'aws', entryId: 'aws.cloudfront', x: 80, y: 85, width: 180, height: 112 },
    { key: 'aws-api', label: 'AWS API Gateway', kind: 'control', libraryId: 'aws', entryId: 'aws.api-gateway', x: 330, y: 80, width: 180, height: 120 },
    { key: 'aws-compute', label: 'AWS ECS', kind: 'service', libraryId: 'aws', entryId: 'aws.ecs', x: 590, y: 70, width: 190, height: 130 },
    { key: 'aws-queue', label: 'AWS SQS', kind: 'database', libraryId: 'aws', entryId: 'aws.sqs', x: 860, y: 75, width: 180, height: 112 },
    { key: 'azure-worker', label: 'Azure Functions', kind: 'service', libraryId: 'azure', entryId: 'azure.functions', x: 1120, y: 70, width: 180, height: 120 },
    { key: 'azure-cache', label: 'Azure Redis Cache', kind: 'database', libraryId: 'azure', entryId: 'azure.redis-cache', x: 1380, y: 40, width: 180, height: 120 },
    { key: 'gcp-topic', label: 'GCP Pub/Sub', kind: 'database', libraryId: 'gcp', entryId: 'gcp.pub-sub', x: 1380, y: 220, width: 180, height: 112 },
    { key: 'gcp-run', label: 'GCP Cloud Run', kind: 'service', libraryId: 'gcp', entryId: 'gcp.cloud-run', x: 1640, y: 210, width: 190, height: 120 },
    { key: 'gcp-data', label: 'GCP Cloud SQL', kind: 'database', libraryId: 'gcp', entryId: 'gcp.cloud-sql', x: 1900, y: 210, width: 180, height: 120 },
    { key: 'observe', label: 'Cloud monitoring', kind: 'service', libraryId: 'gcp', entryId: 'gcp.cloud-monitoring', x: 1120, y: 270, width: 180, height: 112 },
  ],
  edges: [
    { from: 'aws-edge', to: 'aws-api', label: 'HTTPS' },
    { from: 'aws-api', to: 'aws-compute' },
    { from: 'aws-compute', to: 'aws-queue', label: 'events' },
    { from: 'aws-queue', to: 'azure-worker', label: 'bridge' },
    { from: 'azure-worker', to: 'azure-cache', label: 'cache' },
    { from: 'azure-worker', to: 'gcp-topic', label: 'publish', fromSide: 'south', toSide: 'west' },
    { from: 'gcp-topic', to: 'gcp-run', label: 'subscription' },
    { from: 'gcp-run', to: 'gcp-data', label: 'persist' },
    { from: 'aws-compute', to: 'observe', label: 'metrics', fromSide: 'south', toSide: 'west' },
    { from: 'gcp-run', to: 'observe', label: 'telemetry', fromSide: 'south', toSide: 'east' },
  ],
};

const UML_ERD_STARTER: StarterTemplateDefinition = {
  id: 'uml-erd',
  name: 'Domain model + ERD',
  section: 'Software design',
  description: 'A class-oriented domain model paired with core entities and explicit relationship conventions.',
  nodes: [
    { key: 'service', label: 'OrderService', kind: 'service', libraryId: 'uml', entryId: 'uml.class', x: 100, y: 70, width: 220, height: 150 },
    { key: 'repo', label: 'OrderRepository', kind: 'service', libraryId: 'uml', entryId: 'uml.interface', x: 400, y: 70, width: 220, height: 130 },
    { key: 'package', label: 'fulfillment.domain', kind: 'system', libraryId: 'uml', entryId: 'uml.package', x: 700, y: 60, width: 240, height: 150 },
    { key: 'note', label: 'Transactional boundary', kind: 'service', libraryId: 'uml', entryId: 'uml.comment', x: 100, y: 300, width: 220, height: 120 },
    { key: 'customer', label: 'Customer', kind: 'database', libraryId: 'erd', entryId: 'erd.entity', x: 520, y: 310, width: 220, height: 150 },
    { key: 'places', label: 'places', kind: 'control', libraryId: 'erd', entryId: 'erd.relationship', x: 800, y: 335, width: 130, height: 100 },
    { key: 'order', label: 'Order', kind: 'database', libraryId: 'erd', entryId: 'erd.entity', x: 990, y: 310, width: 220, height: 150 },
    { key: 'items', label: 'contains', kind: 'control', libraryId: 'erd', entryId: 'erd.relationship', x: 1270, y: 335, width: 130, height: 100 },
    { key: 'line', label: 'OrderLine', kind: 'database', libraryId: 'erd', entryId: 'erd.weak-entity', x: 1460, y: 310, width: 220, height: 150 },
  ],
  edges: [
    { from: 'service', to: 'repo', label: 'uses', semantic: 'Dependency' },
    { from: 'repo', to: 'package', label: 'implemented by', semantic: 'Realization' },
    { from: 'note', to: 'service', label: 'documents', fromSide: 'north', toSide: 'south', semantic: 'Note' },
    { from: 'customer', to: 'places', label: '1' },
    { from: 'places', to: 'order', label: '0..*' },
    { from: 'order', to: 'items', label: '1' },
    { from: 'items', to: 'line', label: '1..*' },
  ],
};

const NETWORK_STARTER: StarterTemplateDefinition = {
  id: 'network',
  name: 'Segmented application network',
  section: 'Infrastructure',
  description: 'Internet edge, router, firewall, DMZ and private subnets, load balancer, application servers, and network storage.',
  nodes: [
    { key: 'internet', label: 'Internet', kind: 'system', libraryId: 'network', entryId: 'network.internet', x: 60, y: 170, width: 170, height: 110 },
    { key: 'router', label: 'Edge router', kind: 'control', libraryId: 'network', entryId: 'network.router', x: 300, y: 170, width: 120, height: 120 },
    { key: 'firewall', label: 'Firewall', kind: 'control', libraryId: 'network', entryId: 'network.firewall', x: 500, y: 165, width: 150, height: 125 },
    { key: 'dmz', label: 'DMZ subnet', kind: 'system', libraryId: 'network', entryId: 'network.dmz', x: 730, y: 70, width: 290, height: 190 },
    { key: 'lb', label: 'Load balancer', kind: 'control', libraryId: 'network', entryId: 'network.load-balancer', x: 785, y: 115, width: 180, height: 115 },
    { key: 'private', label: 'Private application subnet', kind: 'system', libraryId: 'network', entryId: 'network.subnet', x: 1100, y: 60, width: 560, height: 280 },
    { key: 'app1', label: 'App server A', kind: 'service', libraryId: 'network', entryId: 'network.server', x: 1160, y: 110, width: 180, height: 105 },
    { key: 'app2', label: 'App server B', kind: 'service', libraryId: 'network', entryId: 'network.server', x: 1410, y: 110, width: 180, height: 105 },
    { key: 'storage', label: 'Network storage', kind: 'database', libraryId: 'network', entryId: 'network.storage', x: 1290, y: 255, width: 180, height: 115 },
  ],
  edges: [
    { from: 'internet', to: 'router' },
    { from: 'router', to: 'firewall' },
    { from: 'firewall', to: 'lb', label: '443' },
    { from: 'lb', to: 'app1', label: 'HTTP', fromSide: 'east', toSide: 'west' },
    { from: 'lb', to: 'app2', label: 'HTTP', fromSide: 'east', toSide: 'west' },
    { from: 'app1', to: 'storage', label: 'NFS', fromSide: 'south', toSide: 'west' },
    { from: 'app2', to: 'storage', label: 'NFS', fromSide: 'south', toSide: 'east' },
  ],
};

export const STARTER_TEMPLATES: readonly StarterTemplateDefinition[] = [
  FLOWCHART_STARTER,
  INTEGRATION_STARTER,
  CLOUD_STARTER,
  UML_ERD_STARTER,
  NETWORK_STARTER,
];

export function getStarterTemplate(id: StarterTemplateId): StarterTemplateDefinition {
  const template = STARTER_TEMPLATES.find((candidate) => candidate.id === id);
  if (template === undefined) {
    throw new Error(`Unknown starter template ${JSON.stringify(id)}`);
  }
  return template;
}

function randomUid(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = new Uint8Array(26);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
}

function allocateId(
  existing: Readonly<Record<string, unknown>>,
  reserved: Set<string>,
  prefix: string,
): string {
  let candidate = prefix;
  let index = 2;
  while (existing[candidate] !== undefined || reserved.has(candidate)) {
    candidate = `${prefix}.${index}`;
    index += 1;
  }
  reserved.add(candidate);
  return candidate;
}

function preferredNodeStyleId(document: OpenChartDocument): string {
  const fallback = Object.keys(document.styles).sort()[0];
  const preferred = document.styles['style.fabric'] === undefined ? fallback : 'style.fabric';
  if (preferred === undefined) {
    throw new Error('Template insertion requires at least one node style');
  }
  return preferred;
}

function preferredEdgeStyleId(document: OpenChartDocument): string {
  const flow = Object.values(document.styles)
    .filter((style) => style.role.toLowerCase().includes('flow'))
    .sort((left, right) => left.id.localeCompare(right.id))[0]?.id;
  return flow ?? preferredNodeStyleId(document);
}

function pageNodeIds(document: OpenChartDocument, pageId: string): readonly string[] {
  return Object.values(document.nodes)
    .filter((node) => node.pageId === pageId)
    .map((node) => node.id)
    .sort((left, right) => left.localeCompare(right));
}

export function createBlankPageTransaction(
  document: OpenChartDocument,
  request: { readonly txId: string; readonly pageId: string },
): OperationEnvelope | undefined {
  if (document.pages[request.pageId] === undefined) {
    throw new Error(`Template page ${JSON.stringify(request.pageId)} does not exist`);
  }
  const nodeIds = pageNodeIds(document, request.pageId);
  if (nodeIds.length === 0) return undefined;
  return {
    txId: request.txId,
    actor: 'user',
    origin: 'gui',
    baseRev: document.rev,
    ops: nodeIds.map((id): Operation => ({ op: 'delete_node', id })),
  };
}

export function createStarterTemplateTransaction(
  document: OpenChartDocument,
  template: StarterTemplateDefinition,
  request: {
    readonly txId: string;
    readonly pageId: string;
    readonly layerId: string;
    readonly makeUid?: () => string;
  },
): StarterTemplateTransaction {
  const page = document.pages[request.pageId];
  const layer = document.layers[request.layerId];
  if (page === undefined) {
    throw new Error(`Template page ${JSON.stringify(request.pageId)} does not exist`);
  }
  if (layer === undefined || layer.pageId !== page.id) {
    throw new Error(`Template layer ${JSON.stringify(request.layerId)} is not on the target page`);
  }
  if (layer.locked) {
    throw new Error('Unlock the target layer before applying a starter');
  }

  const makeUid = request.makeUid ?? randomUid;
  const nodeStyleId = preferredNodeStyleId(document);
  const edgeStyleId = preferredEdgeStyleId(document);
  const nodeReserved = new Set<string>();
  const portReserved = new Set<string>();
  const edgeReserved = new Set<string>();
  const nodeIdsByKey = new Map<string, string>();
  const nodeIds: string[] = [];
  const edgeIds: string[] = [];
  const ops: Operation[] = pageNodeIds(document, request.pageId).map(
    (id): Operation => ({ op: 'delete_node', id }),
  );

  for (const spec of template.nodes) {
    const id = allocateId(document.nodes, nodeReserved, `node.template.${template.id}.${spec.key}`);
    nodeIdsByKey.set(spec.key, id);
    nodeIds.push(id);
    const node: Node = {
      id,
      uid: makeUid(),
      kind: spec.kind,
      label: spec.label,
      pageId: request.pageId,
      layerId: request.layerId,
      styleId: nodeStyleId,
      data: { shape: { libraryId: spec.libraryId, entryId: spec.entryId }, starterTemplate: template.id },
    };
    ops.push(
      { op: 'create_node', node },
      {
        op: 'set_node_layout',
        id,
        layout: {
          x: spec.x,
          y: spec.y,
          width: spec.width,
          height: spec.height,
          pinned: true,
        },
      },
    );
  }

  template.edges.forEach((spec, index) => {
    const fromNodeId = nodeIdsByKey.get(spec.from);
    const toNodeId = nodeIdsByKey.get(spec.to);
    if (fromNodeId === undefined || toNodeId === undefined) {
      throw new Error(`Template edge ${index + 1} references an unknown node`);
    }
    const fromPortId = allocateId(document.ports, portReserved, `port.template.${template.id}.${index + 1}.out`);
    const toPortId = allocateId(document.ports, portReserved, `port.template.${template.id}.${index + 1}.in`);
    const edgeId = allocateId(document.edges, edgeReserved, `edge.template.${template.id}.${index + 1}`);
    const fromPort: Port = {
      id: fromPortId,
      uid: makeUid(),
      nodeId: fromNodeId,
      direction: 'out',
      side: spec.fromSide ?? 'east',
    };
    const toPort: Port = {
      id: toPortId,
      uid: makeUid(),
      nodeId: toNodeId,
      direction: 'in',
      side: spec.toSide ?? 'west',
    };
    const edge: Edge = {
      id: edgeId,
      uid: makeUid(),
      fromPortId,
      toPortId,
      label: spec.label ?? '',
      semantic: spec.semantic ?? 'Flow',
      pageId: request.pageId,
      layerId: request.layerId,
      styleId: edgeStyleId,
      routing: {
        mode: 'orthogonal',
        avoidObstacles: true,
        cornerRadius: 9,
        jumpStyle: 'arc',
        endMarker: 'arrow',
      },
      data: { starterTemplate: template.id },
    };
    ops.push(
      { op: 'create_port', port: fromPort },
      { op: 'create_port', port: toPort },
      { op: 'create_edge', edge },
    );
    if (spec.waypoints !== undefined && spec.waypoints.length > 0) {
      ops.push({
        op: 'set_edge_layout',
        id: edgeId,
        layout: { waypoints: spec.waypoints.map((point) => ({ ...point })) },
      });
    }
    edgeIds.push(edgeId);
  });

  return {
    envelope: {
      txId: request.txId,
      actor: 'user',
      origin: 'gui',
      baseRev: document.rev,
      ops,
    },
    nodeIds,
    edgeIds,
  };
}

export function createBlankInitialDocument(document: OpenChartDocument): OpenChartDocument {
  return {
    ...document,
    title: 'Untitled diagram',
    rev: 0,
    nodes: {},
    ports: {},
    edges: {},
    layout: {
      ...document.layout,
      overrides: {},
      edgeOverrides: {},
      derived: null,
    },
  };
}
