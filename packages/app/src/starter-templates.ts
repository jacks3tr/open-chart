import type { Edge, Node, OpenChartDocument, Port } from '@openchart/ir';
import { resolveLibraryShape } from '@openchart/shapes/libraries-core';
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
  readonly kind: 'service' | 'control' | 'database' | 'system' | 'text';
  readonly parent?: string;
  readonly container?: boolean;
  readonly data?: Node['data'];
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
  readonly routing?: Edge['routing'];
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

// Coordinates are shared by the canvas, gallery, and exports. Keep room for the footer.
function shape(key: string, label: string, entryId: string, x: number, y: number,
  width = 180, height = 120, extra: Partial<StarterTemplateNodeSpec> = {}): StarterTemplateNodeSpec {
  return { key, label, kind: 'service', libraryId: entryId.split('.')[0]!, entryId,
    x, y, width, height, ...extra };
}

function text(key: string, label: string, x: number, y: number, width: number,
  fontSize = 15, data: Node['data'] = {}): StarterTemplateNodeSpec {
  return shape(key, label, 'basic.text', x, y, width, fontSize + 16,
    { kind: 'text', data: { fontSize, fontWeight: 500, textAlign: 'left', textColor: '#526277', ...data } });
}

function heading(section: string, title: string, subtitle: string): readonly StarterTemplateNodeSpec[] {
  return [
    text('eyebrow', section.toUpperCase(), 64, 28, 1200, 12, { fontWeight: 700, textColor: '#2563EB' }),
    text('title', title, 64, 67, 1280, 34, { role: 'page-title', fontWeight: 700, textColor: '#15283F' }),
    text('subtitle', subtitle, 64, 124, 1280),
  ];
}

function zone(key: string, label: string, entryId: string, x: number, y: number,
  width: number, height: number): StarterTemplateNodeSpec {
  return shape(key, label, entryId, x, y, width, height, { kind: 'system', container: true });
}

const FLOWCHART_STARTER: StarterTemplateDefinition = {
  id: 'flowchart', name: 'Approval flowchart', section: 'Process',
  description: 'A policy approval process with a clear success path, clarification loop, and completed outcome.',
  nodes: [
    ...heading('01 / Business process', 'Request approval', 'Validate once. Resolve exceptions. Record the decision and close the request.'),
    shape('start', 'Request received', 'flowchart.terminator', 72, 290, 180, 90, { kind: 'control' }),
    shape('validate', 'Validate request', 'flowchart.process', 332, 280, 190, 110),
    shape('decision', 'Meets policy?', 'flowchart.decision', 602, 250, 210, 170, { kind: 'control' }),
    shape('approve', 'Approve request', 'flowchart.process', 892, 280, 190, 110),
    shape('document', 'Issue approval', 'flowchart.document', 1162, 275, 190, 120),
    shape('manual', 'Clarify request', 'flowchart.manual-input', 612, 555, 190, 110,
      { data: { borderColor: '#B7791F', fillColor: '#FFFAEB' } }),
    shape('rework', 'Update request', 'flowchart.predefined-process', 332, 555, 190, 110),
    shape('handoff', 'Request closed', 'flowchart.terminator', 1162, 565, 190, 90,
      { kind: 'control', data: { borderColor: '#07856D', fillColor: '#ECFDF5' } }),
  ],
  edges: [
    { from: 'start', to: 'validate' }, { from: 'validate', to: 'decision' },
    { from: 'decision', to: 'approve', label: 'Yes' }, { from: 'approve', to: 'document' },
    { from: 'document', to: 'handoff', fromSide: 'south', toSide: 'north', label: 'Recorded' },
    { from: 'decision', to: 'manual', label: 'No', fromSide: 'south', toSide: 'north' },
    { from: 'manual', to: 'rework', label: 'Revised input', fromSide: 'west', toSide: 'east' },
    { from: 'rework', to: 'validate', label: 'Resubmit', fromSide: 'north', toSide: 'south', waypoints: [{ x: 427, y: 475 }] },
  ],
};

const INTEGRATION_STARTER: StarterTemplateDefinition = {
  id: 'integration', name: 'Event-driven integration', section: 'Architecture',
  description: 'An order API with durable events, asynchronous fulfillment, and a dead-letter queue for failed jobs.',
  nodes: [
    ...heading('02 / Integration architecture', 'Order fulfillment platform', 'Synchronous order capture with durable messaging and independent fulfillment workers.'),
    zone('api-zone', '01  /  Request & persistence', 'architecture.system-boundary', 72, 195, 1296, 220),
    zone('async-zone', '02  /  Asynchronous fulfillment', 'architecture.system-boundary', 572, 470, 796, 330),
    shape('client', 'Web & mobile', 'integration.client', 102, 255, 170, 120, { parent: 'api-zone' }),
    shape('gateway', 'API gateway', 'integration.api-gateway', 352, 255, 170, 120, { kind: 'control', parent: 'api-zone' }),
    shape('orders', 'Order service', 'integration.service', 612, 255, 170, 120, { parent: 'api-zone' }),
    shape('db', 'Orders database', 'integration.database', 1132, 255, 180, 120, { kind: 'database', parent: 'api-zone' }),
    shape('outbox', 'Outbox relay', 'integration.worker', 872, 255, 170, 120, { parent: 'api-zone' }),
    shape('queue', 'Order events', 'integration.queue', 612, 535, 170, 120, { kind: 'database', parent: 'async-zone' }),
    shape('worker', 'Fulfillment worker', 'integration.worker', 872, 535, 170, 120, { parent: 'async-zone' }),
    shape('saas', 'Shipping partner', 'integration.external-saas', 1132, 535, 180, 120, { parent: 'async-zone' }),
    shape('dlq', 'Failed jobs', 'integration.queue', 872, 695, 170, 80,
      { kind: 'database', parent: 'async-zone', data: { borderColor: '#B7791F', fillColor: '#FFFAEB' } }),
    text('delivery-title', 'DELIVERY CONTRACT', 94, 535, 410, 12, { fontWeight: 700, textColor: '#07856D' }),
    text('delivery-once', 'At-least-once event delivery', 94, 578, 410),
    text('delivery-idempotent', 'Idempotent fulfillment by order ID', 94, 614, 410),
    text('delivery-failures', 'Failed jobs retained for operator review', 94, 650, 410),
  ],
  edges: [
    { from: 'client', to: 'gateway', label: 'HTTPS' },
    { from: 'gateway', to: 'orders', label: 'Create order' },
    { from: 'orders', to: 'db', label: 'Order + outbox / one transaction', fromSide: 'north', toSide: 'north',
      waypoints: [{ x: 697, y: 180 }, { x: 1222, y: 180 }] },
    { from: 'db', to: 'outbox', label: 'Committed rows', fromSide: 'west', toSide: 'east' },
    { from: 'outbox', to: 'queue', label: 'Publish', semantic: 'Event', fromSide: 'south', toSide: 'west',
      waypoints: [{ x: 957, y: 445 }, { x: 542, y: 445 }, { x: 542, y: 595 }] },
    { from: 'queue', to: 'worker', label: 'Consume', semantic: 'Event' },
    { from: 'worker', to: 'saas', label: 'Ship order' },
    { from: 'worker', to: 'dlq', label: 'Retries exhausted', semantic: 'Exception', fromSide: 'south', toSide: 'north' },
  ],
};

const CLOUD_STARTER: StarterTemplateDefinition = {
  id: 'cloud', name: 'Resilient AWS application', section: 'Cloud',
  description: 'Protected ingress, load balancing, ECS across two availability zones, and a managed Multi-AZ database.',
  nodes: [
    ...heading('03 / Cloud reference architecture', 'Resilient application on AWS', 'Protected ingress • Two application availability zones • Managed Multi-AZ persistence'),
    zone('edge-zone', 'Public ingress', 'architecture.edge-zone', 72, 210, 280, 550),
    zone('az-a', 'Private subnet / AZ A', 'architecture.availability-zone', 682, 210, 286, 250),
    zone('az-b', 'Private subnet / AZ B', 'architecture.availability-zone', 682, 510, 286, 250),
    zone('data-zone', 'Managed data tier', 'architecture.private-subnet', 1058, 210, 310, 550),
    shape('cdn', 'CloudFront', 'aws.cloudfront', 122, 285, 180, 130, { parent: 'edge-zone' }),
    shape('waf', 'WAF policy', 'aws.waf', 122, 570, 180, 130, { kind: 'control', parent: 'edge-zone' }),
    shape('lb', 'Application LB', 'aws.elastic-load-balancing', 432, 425, 180, 120, { kind: 'control' }),
    shape('ecs-a', 'ECS service / A', 'aws.ecs', 732, 285, 180, 130, { parent: 'az-a' }),
    shape('ecs-b', 'ECS service / B', 'aws.ecs', 732, 585, 180, 130, { parent: 'az-b' }),
    shape('rds', 'RDS / Multi-AZ', 'aws.rds', 1123, 425, 180, 130, { kind: 'database', parent: 'data-zone' }),
    text('data-note', 'Automatic failover', 1090, 637, 250, 14),
  ],
  edges: [
    { from: 'waf', to: 'cdn', label: 'Web ACL', semantic: 'Policy', fromSide: 'north', toSide: 'south',
      routing: { mode: 'orthogonal', lineStyle: 'dotted', endMarker: 'none' } },
    { from: 'cdn', to: 'lb', label: 'HTTPS', waypoints: [{ x: 390, y: 350 }, { x: 390, y: 485 }] },
    { from: 'lb', to: 'ecs-a', label: 'Healthy target', fromSide: 'north', toSide: 'west', waypoints: [{ x: 522, y: 350 }] },
    { from: 'lb', to: 'ecs-b', label: 'Healthy target', fromSide: 'south', toSide: 'west', waypoints: [{ x: 522, y: 650 }] },
    { from: 'ecs-a', to: 'rds', label: 'SQL / TLS', toSide: 'north', waypoints: [{ x: 1213, y: 350 }] },
    { from: 'ecs-b', to: 'rds', label: 'SQL / TLS', toSide: 'south', waypoints: [{ x: 1010, y: 650 }, { x: 1010, y: 600 }, { x: 1213, y: 600 }] },
  ],
};

const UML_ERD_STARTER: StarterTemplateDefinition = {
  id: 'uml-erd', name: 'Order domain model', section: 'Software design',
  description: 'Service dependencies and a populated order schema with explicit customer, order, and line-item cardinalities.',
  nodes: [
    ...heading('04 / Software design', 'Order domain & persistence', 'Application dependencies above; entity relationships and key fields below.'),
    shape('api', 'Checkout API', 'uml.component', 82, 235, 230, 145),
    shape('service', 'Order service', 'uml.component', 582, 235, 230, 145),
    shape('repo', 'Order repository', 'uml.component', 1102, 235, 230, 145),
    text('schema-label', 'PERSISTENCE MODEL', 64, 445, 400, 12, { fontWeight: 700 }),
    shape('customer', 'Customer\nPK  customer_id\nemail\ncreated_at', 'erd.entity', 82, 555, 230, 190, { kind: 'database' }),
    shape('places', 'places', 'erd.relationship', 382, 595, 120, 110, { kind: 'control' }),
    shape('order', 'Order\nPK  order_id\nFK  customer_id\nstatus', 'erd.entity', 582, 555, 230, 190, { kind: 'database' }),
    shape('items', 'contains', 'erd.identifying-relationship', 892, 595, 130, 110, { kind: 'control' }),
    shape('line', 'OrderLine\nPK  order_id, line_no\nSKU, quantity\nunit_price', 'erd.weak-entity', 1102, 555, 230, 190, { kind: 'database' }),
  ],
  edges: [
    { from: 'api', to: 'service', label: 'Submit order', semantic: 'Dependency', routing: { mode: 'orthogonal', lineStyle: 'dashed', endMarker: 'open-arrow' } },
    { from: 'service', to: 'repo', label: 'Save aggregate', semantic: 'Dependency', routing: { mode: 'orthogonal', lineStyle: 'dashed', endMarker: 'open-arrow' } },
    { from: 'customer', to: 'places', label: '1', semantic: 'Relationship', routing: { mode: 'orthogonal', endMarker: 'none' } },
    { from: 'places', to: 'order', label: '0..*', semantic: 'Relationship', routing: { mode: 'orthogonal', endMarker: 'none' } },
    { from: 'order', to: 'items', label: '1', semantic: 'Relationship', routing: { mode: 'orthogonal', endMarker: 'none' } },
    { from: 'items', to: 'line', label: '1..*', semantic: 'Relationship', routing: { mode: 'orthogonal', endMarker: 'none' } },
  ],
};

const NETWORK_STARTER: StarterTemplateDefinition = {
  id: 'network', name: 'Segmented application network', section: 'Infrastructure',
  description: 'Perimeter controls, a DMZ load balancer, private application servers, and a restricted database path.',
  nodes: [
    ...heading('05 / Network architecture', 'Segmented application network', 'Public access terminates at the perimeter. Application and data services stay private.'),
    zone('perimeter', '01 / Perimeter', 'architecture.security-zone', 72, 210, 330, 585),
    zone('dmz', '02 / DMZ · 10.0.10.0/24', 'network.dmz', 472, 210, 330, 585),
    zone('private', '03 / Private · 10.0.20.0/24', 'architecture.private-subnet', 872, 210, 496, 585),
    shape('internet', 'Internet', 'network.internet', 147, 275, 180, 100, { kind: 'system', parent: 'perimeter' }),
    shape('router', 'Edge router', 'network.router', 147, 455, 180, 110, { kind: 'control', parent: 'perimeter' }),
    shape('firewall', 'Firewall', 'network.firewall', 147, 645, 180, 110, { kind: 'control', parent: 'perimeter' }),
    shape('lb', 'Load balancer', 'network.load-balancer', 547, 455, 180, 110, { kind: 'control', parent: 'dmz' }),
    shape('app1', 'App server A', 'network.server', 912, 305, 180, 120, { parent: 'private' }),
    shape('app2', 'App server B', 'network.server', 912, 645, 180, 120, { parent: 'private' }),
    shape('storage', 'Private database', 'integration.database', 1152, 455, 180, 110, { kind: 'database', parent: 'private' }),
  ],
  edges: [
    { from: 'internet', to: 'router', fromSide: 'south', toSide: 'north' },
    { from: 'router', to: 'firewall', fromSide: 'south', toSide: 'north' },
    { from: 'firewall', to: 'lb', label: 'TCP 443', waypoints: [{ x: 438, y: 700 }, { x: 438, y: 510 }] },
    { from: 'lb', to: 'app1', label: 'TLS 8443', fromSide: 'north', toSide: 'west', waypoints: [{ x: 637, y: 365 }] },
    { from: 'lb', to: 'app2', label: 'TLS 8443', fromSide: 'south', waypoints: [{ x: 637, y: 705 }] },
    { from: 'app1', to: 'storage', label: 'TLS 5432', toSide: 'north', waypoints: [{ x: 1242, y: 365 }] },
    { from: 'app2', to: 'storage', label: 'TLS 5432', toSide: 'south', waypoints: [{ x: 1242, y: 705 }] },
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

function preferredNodeStyleId(document: OpenChartDocument, spec: StarterTemplateNodeSpec): string {
  const fallback = Object.keys(document.styles).sort()[0];
  const key = /queue|topic|event|stream|pub-sub/.test(spec.entryId) ? 'style.fabric'
    : /external|client|internet/.test(spec.entryId) ? 'style.operations'
    : spec.kind === 'database' ? 'style.source'
    : spec.kind === 'service' ? 'style.target'
    : 'style.operations';
  const preferred = document.styles[key] === undefined ? fallback : key;
  if (preferred === undefined) {
    throw new Error('Template insertion requires at least one node style');
  }
  return preferred;
}

function preferredEdgeStyleId(document: OpenChartDocument, event: boolean): string {
  const preferred = event ? 'style.flow-control' : 'style.flow-inbound';
  if (document.styles[preferred] !== undefined) return preferred;
  const flow = Object.values(document.styles)
    .filter((style) => style.role.toLowerCase().includes('flow'))
    .sort((left, right) => left.id.localeCompare(right.id))[0]?.id;
  const fallback = flow ?? Object.keys(document.styles).sort()[0];
  if (fallback === undefined) throw new Error('Template insertion requires a connector style');
  return fallback;
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
  const nodeReserved = new Set<string>();
  const portReserved = new Set<string>();
  const edgeReserved = new Set<string>();
  const nodeIdsByKey = new Map<string, string>();
  const nodeIds: string[] = [];
  const edgeIds: string[] = [];
  const ops: Operation[] = pageNodeIds(document, request.pageId).map(
    (id): Operation => ({ op: 'delete_node', id }),
  );
  if (document.title === 'Untitled diagram' && Object.keys(document.nodes).length === 0) {
    ops.push({ op: 'set_document_title', title: template.name });
  }

  ops.push({ op: 'rename_page', id: page.id, name: template.name });
  ops.push({ op: 'set_page_color', id: page.id, color: '#FFFFFF' });

  for (const spec of template.nodes) {
    const id = allocateId(document.nodes, nodeReserved, `node.template.${template.id}.${spec.key}`);
    nodeIdsByKey.set(spec.key, id);
    nodeIds.push(id);
    const resolved = resolveLibraryShape(spec.libraryId, spec.entryId);
    if (!resolved.ok) throw new Error(`Missing template shape ${spec.entryId}`);
    const defaults = Object.fromEntries(resolved.definition.properties?.map((property) => [property.name, property.default]) ?? []);
    const parentId = spec.parent === undefined ? undefined : nodeIdsByKey.get(spec.parent);
    if (spec.parent !== undefined && parentId === undefined) throw new Error(`Missing template parent ${spec.parent}`);
    const node: Node = {
      id,
      uid: makeUid(),
      kind: spec.kind,
      label: spec.label,
      pageId: request.pageId,
      layerId: request.layerId,
      styleId: preferredNodeStyleId(document, spec),
      ...(parentId === undefined ? {} : { parentId }),
      ...(spec.container ? { container: { title: spec.label, autoGrow: true, clip: false, padding: 24 } } : {}),
      data: {
        shape: { libraryId: spec.libraryId, entryId: spec.entryId },
        starterTemplate: template.id, fontSize: 16, fontWeight: 600,
        borderColor: typeof defaults.Accent === 'string' ? defaults.Accent : '#2563EB',
        fillColor: typeof defaults.Surface === 'string' ? defaults.Surface : '#FFFFFF',
        textColor: '#20364D', ...spec.data,
      },
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
    const event = spec.semantic === 'Event';
    const edge: Edge = {
      id: edgeId,
      uid: makeUid(),
      fromPortId,
      toPortId,
      label: spec.label ?? '',
      semantic: spec.semantic ?? (event ? 'Event' : 'Request'),
      pageId: request.pageId,
      layerId: request.layerId,
      styleId: preferredEdgeStyleId(document, event),
      routing: {
        mode: 'orthogonal',
        avoidObstacles: true,
        cornerRadius: 9,
        jumpStyle: 'arc',
        endMarker: 'arrow',
        lineStyle: event ? 'dashed' : 'solid',
        lineWidth: 2,
        ...spec.routing,
      },
      data: { starterTemplate: template.id, fontSize: 12, showSemanticLabel: false,
        strokeColor: event ? '#07856D' : '#526B89' },
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
        layout: { waypoints: spec.waypoints.map((point) => ({ x: point.x, y: point.y })) },
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
