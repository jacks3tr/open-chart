import {
  applyPatches,
  enablePatches,
  freeze,
  produceWithPatches,
  type Draft,
  type Patch,
} from 'immer';
import {
  ContainerSettingsSchema,
  EdgeLayoutOverrideSchema,
  EdgeRoutingSchema,
  EdgeSchema,
  ID_PATTERN,
  LayerSchema,
  LayoutFrameSchema,
  LayoutOverrideSchema,
  NodeSchema,
  PageSchema,
  PortSchema,
  ThemeSchema,
  validateDocument,
  validateReferences,
  type ContainerSettings,
  type DocumentDiagnosticCode,
  type Edge,
  type EdgeLayoutOverride,
  type EdgeRouting,
  type LayoutOverride,
  type LayoutFrame,
  type Layer,
  type Node as DiagramNode,
  type OpenChartDocument,
  type Page,
  type Port,
  type Style,
  type Theme,
} from '@openchart/ir';
import { z, type ZodIssue } from 'zod';

enablePatches();

export type Operation =
  | { readonly op: 'set_document_title'; readonly title: string }
  | { readonly op: 'create_page'; readonly page: Page; readonly baseLayer: Layer }
  | { readonly op: 'rename_page'; readonly id: string; readonly name: string }
  | { readonly op: 'set_page_color'; readonly id: string; readonly color: string | null }
  | { readonly op: 'set_page_order'; readonly id: string; readonly order: number | null }
  | { readonly op: 'delete_page'; readonly id: string }
  | { readonly op: 'create_layer'; readonly layer: Layer; readonly index?: number }
  | { readonly op: 'rename_layer'; readonly id: string; readonly name: string }
  | {
      readonly op: 'reorder_layers';
      readonly pageId: string;
      readonly layerIds: readonly string[];
    }
  | { readonly op: 'save_layer_view'; readonly pageId: string }
  | { readonly op: 'set_layer_visibility'; readonly id: string; readonly visible: boolean }
  | { readonly op: 'set_layer_locked'; readonly id: string; readonly locked: boolean }
  | { readonly op: 'delete_layer'; readonly id: string }
  | { readonly op: 'create_node'; readonly node: DiagramNode }
  | { readonly op: 'create_port'; readonly port: Port }
  | { readonly op: 'set_port_direction'; readonly id: string; readonly direction: Port['direction'] }
  | { readonly op: 'set_port_side'; readonly id: string; readonly side: Port['side'] }
  | { readonly op: 'set_port_order'; readonly id: string; readonly order: number | null }
  | { readonly op: 'create_edge'; readonly edge: Edge }
  | {
      readonly op: 'set_edge_endpoints';
      readonly id: string;
      readonly fromPortId: string;
      readonly toPortId: string;
    }
  | { readonly op: 'set_edge_label'; readonly id: string; readonly label: string }
  | { readonly op: 'set_edge_data'; readonly id: string; readonly data: Edge['data'] }
  | { readonly op: 'set_edge_semantic'; readonly id: string; readonly semantic: string }
  | { readonly op: 'set_edge_style'; readonly id: string; readonly styleId: string }
  | { readonly op: 'set_edge_routing'; readonly id: string; readonly routing: EdgeRouting | null }
  | { readonly op: 'set_edge_layout'; readonly id: string; readonly layout: EdgeLayoutOverride | null }
  | {
      readonly op: 'set_derived_layout';
      readonly engine: string;
      readonly derivedVersion: string;
      readonly frames: Readonly<Record<string, LayoutFrame>> | null;
    }
  | { readonly op: 'set_style_tokens'; readonly id: string; readonly tokens: Style['tokens'] }
  | { readonly op: 'set_theme'; readonly theme: Theme | null }
  | { readonly op: 'rename_node'; readonly id: string; readonly newId: string }
  | { readonly op: 'set_node_label'; readonly id: string; readonly label: string }
  | {
      readonly op: 'set_node_data';
      readonly id: string;
      readonly data: DiagramNode['data'];
    }
  | { readonly op: 'set_node_style'; readonly id: string; readonly styleId: string }
  | { readonly op: 'set_node_z_index'; readonly id: string; readonly zIndex: number }
  | { readonly op: 'set_node_parent'; readonly id: string; readonly parentId: string | null }
  | {
      readonly op: 'set_node_container';
      readonly id: string;
      readonly container: ContainerSettings | null;
    }
  | {
      readonly op: 'set_node_layout';
      readonly id: string;
      readonly layout: LayoutOverride | null;
    }
  | { readonly op: 'delete_node'; readonly id: string }
  | { readonly op: 'delete_port'; readonly id: string }
  | { readonly op: 'delete_edge'; readonly id: string };

export interface OperationEnvelope {
  readonly txId: string;
  readonly actor: 'user' | 'agent';
  readonly origin: 'gui' | 'mcp' | 'cli' | 'dsl' | 'layout' | 'beauty';
  readonly baseRev: number;
  readonly idempotencyKey?: string;
  readonly ops: readonly Operation[];
}

const idSchema = z.string().regex(ID_PATTERN, {
  message: 'Expected a lowercase dot-separated identifier',
});
const jsonRecordSchema = z.record(z.string(), z.json());

const operationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_document_title'), title: z.string().trim().min(1) }).strict(),
  z
    .object({
      op: z.literal('create_page'),
      page: PageSchema,
      baseLayer: LayerSchema,
    })
    .strict(),
  z.object({ op: z.literal('rename_page'), id: idSchema, name: z.string() }).strict(),
  z
    .object({
      op: z.literal('set_page_color'),
      id: idSchema,
      color: z.string().min(1).nullable(),
    })
    .strict(),
  z
    .object({
      op: z.literal('set_page_order'),
      id: idSchema,
      order: z.number().int().nonnegative().nullable(),
    })
    .strict(),
  z.object({ op: z.literal('delete_page'), id: idSchema }).strict(),
  z
    .object({
      op: z.literal('create_layer'),
      layer: LayerSchema,
      index: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z.object({ op: z.literal('rename_layer'), id: idSchema, name: z.string() }).strict(),
  z
    .object({
      op: z.literal('reorder_layers'),
      pageId: idSchema,
      layerIds: z.array(idSchema).min(1),
    })
    .strict(),
  z.object({ op: z.literal('save_layer_view'), pageId: idSchema }).strict(),
  z
    .object({
      op: z.literal('set_layer_visibility'),
      id: idSchema,
      visible: z.boolean(),
    })
    .strict(),
  z
    .object({
      op: z.literal('set_layer_locked'),
      id: idSchema,
      locked: z.boolean(),
    })
    .strict(),
  z.object({ op: z.literal('delete_layer'), id: idSchema }).strict(),
  z.object({ op: z.literal('create_node'), node: NodeSchema }).strict(),
  z.object({ op: z.literal('create_port'), port: PortSchema }).strict(),
  z
    .object({
      op: z.literal('set_port_direction'),
      id: idSchema,
      direction: z.enum(['in', 'out', 'both']),
    })
    .strict(),
  z
    .object({
      op: z.literal('set_port_side'),
      id: idSchema,
      side: z.enum(['north', 'south', 'east', 'west', 'auto']),
    })
    .strict(),
  z
    .object({
      op: z.literal('set_port_order'),
      id: idSchema,
      order: z.number().int().nonnegative().nullable(),
    })
    .strict(),
  z.object({ op: z.literal('create_edge'), edge: EdgeSchema }).strict(),
  z
    .object({
      op: z.literal('set_edge_endpoints'),
      id: idSchema,
      fromPortId: idSchema,
      toPortId: idSchema,
    })
    .strict(),
  z.object({ op: z.literal('set_edge_label'), id: idSchema, label: z.string() }).strict(),
  z.object({ op: z.literal('set_edge_data'), id: idSchema, data: jsonRecordSchema }).strict(),
  z.object({ op: z.literal('set_edge_semantic'), id: idSchema, semantic: z.string() }).strict(),
  z.object({ op: z.literal('set_edge_style'), id: idSchema, styleId: idSchema }).strict(),
  z
    .object({
      op: z.literal('set_edge_routing'),
      id: idSchema,
      routing: EdgeRoutingSchema.nullable(),
    })
    .strict(),
  z
    .object({
      op: z.literal('set_edge_layout'),
      id: idSchema,
      layout: EdgeLayoutOverrideSchema.nullable(),
    })
    .strict(),
  z
    .object({
      op: z.literal('set_derived_layout'),
      engine: z.string().min(1),
      derivedVersion: z.string().min(1),
      frames: z.record(idSchema, LayoutFrameSchema).nullable(),
    })
    .strict(),
  z
    .object({ op: z.literal('set_style_tokens'), id: idSchema, tokens: jsonRecordSchema })
    .strict(),
  z.object({ op: z.literal('set_theme'), theme: ThemeSchema.nullable() }).strict(),
  z
    .object({ op: z.literal('rename_node'), id: idSchema, newId: idSchema })
    .strict(),
  z
    .object({ op: z.literal('set_node_label'), id: idSchema, label: z.string() })
    .strict(),
  z
    .object({ op: z.literal('set_node_data'), id: idSchema, data: jsonRecordSchema })
    .strict(),
  z
    .object({ op: z.literal('set_node_style'), id: idSchema, styleId: idSchema })
    .strict(),
  z
    .object({
      op: z.literal('set_node_z_index'),
      id: idSchema,
      zIndex: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      op: z.literal('set_node_parent'),
      id: idSchema,
      parentId: idSchema.nullable(),
    })
    .strict(),
  z
    .object({
      op: z.literal('set_node_container'),
      id: idSchema,
      container: ContainerSettingsSchema.nullable(),
    })
    .strict(),
  z
    .object({
      op: z.literal('set_node_layout'),
      id: idSchema,
      layout: LayoutOverrideSchema.nullable(),
    })
    .strict(),
  z.object({ op: z.literal('delete_node'), id: idSchema }).strict(),
  z.object({ op: z.literal('delete_port'), id: idSchema }).strict(),
  z.object({ op: z.literal('delete_edge'), id: idSchema }).strict(),
]);

/** Strict runtime schema for an operation envelope accepted by the engine. */
export const OperationEnvelopeSchema = z
  .object({
    txId: z.string().min(1),
    actor: z.enum(['user', 'agent']),
    origin: z.enum(['gui', 'mcp', 'cli', 'dsl', 'layout', 'beauty']),
    baseRev: z.number().int().nonnegative(),
    idempotencyKey: z.string().min(1).optional(),
    ops: z.array(operationSchema).min(1).max(5000),
  })
  .strict();

export type OperationEnvelopeValidationResult =
  | { readonly ok: true; readonly envelope: OperationEnvelope }
  | { readonly ok: false; readonly diagnostics: readonly OperationDiagnostic[] };

export type OperationDiagnosticCode =
  | DocumentDiagnosticCode
  | 'EMPTY_ENVELOPE'
  | 'TOO_MANY_OPERATIONS'
  | 'BASE_REV_MISMATCH'
  | 'IDEMPOTENCY_KEY_CONFLICT'
  | 'ID_COLLISION'
  | 'NOT_FOUND'
  | 'NOTHING_TO_UNDO'
  | 'NOTHING_TO_REDO'
  | 'INVALID_OPERATION';

export interface OperationDiagnostic {
  readonly code: OperationDiagnosticCode;
  readonly path: string;
  readonly message: string;
}

function formatIssuePath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? '$' : path.map(String).join('.');
}

function schemaDiagnostic(issue: ZodIssue): OperationDiagnostic {
  return {
    code: 'SCHEMA_INVALID',
    path: formatIssuePath(issue.path),
    message: issue.message,
  };
}

export function validateOperationEnvelope(
  input: unknown,
): OperationEnvelopeValidationResult {
  const parsed = OperationEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      diagnostics: parsed.error.issues.map(schemaDiagnostic),
    };
  }
  return { ok: true, envelope: parsed.data as OperationEnvelope };
}

export interface CommittedTransaction {
  readonly envelope: OperationEnvelope;
  readonly rev: number;
  readonly committedAt: string;
  readonly forwardPatches: readonly Patch[];
  readonly inversePatches: readonly Patch[];
}

export interface OperationHistoryState {
  readonly undoStack: readonly CommittedTransaction[];
  readonly redoStack: readonly CommittedTransaction[];
}

export type ApplyResult =
  | {
      readonly ok: true;
      readonly replayed: boolean;
      readonly rev: number;
      readonly transaction: CommittedTransaction;
    }
  | { readonly ok: false; readonly diagnostics: readonly OperationDiagnostic[] };

export type UndoResult =
  | {
      readonly ok: true;
      readonly rev: number;
      readonly transaction: CommittedTransaction;
    }
  | { readonly ok: false; readonly diagnostics: readonly OperationDiagnostic[] };

export type RedoResult = UndoResult;

type DocumentDraft = Draft<OpenChartDocument>;
type PageDraft = Draft<Page>;
type LayerDraft = Draft<Layer>;
type NodeDraft = Draft<DiagramNode>;
type PortDraft = Draft<Port>;
type EdgeDraft = Draft<Edge>;
type StyleDraft = Draft<Style>;

interface IdempotencyRecord {
  readonly fingerprint: string;
  readonly transaction: CommittedTransaction;
}

class OperationFailure extends Error {
  public constructor(readonly diagnostic: OperationDiagnostic) {
    super(diagnostic.message);
    this.name = 'OperationFailure';
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, canonicalize(object[key])]),
    );
  }
  return value;
}

function envelopeFingerprint(envelope: OperationEnvelope): string {
  return JSON.stringify(canonicalize(envelope));
}

function diagnostic(
  code: OperationDiagnosticCode,
  path: string,
  message: string,
): OperationDiagnostic {
  return { code, path, message };
}

function hasOwn<T extends object>(record: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function fail(
  code: OperationDiagnosticCode,
  path: string,
  message: string,
): never {
  throw new OperationFailure(diagnostic(code, path, message));
}

function requireNode(
  document: DocumentDraft,
  id: string,
  path: string,
): NodeDraft {
  if (!hasOwn(document.nodes, id)) {
    fail('NOT_FOUND', path, `Node ${JSON.stringify(id)} does not exist`);
  }
  return document.nodes[id] as NodeDraft;
}

function requirePort(
  document: DocumentDraft,
  id: string,
  path: string,
): PortDraft {
  if (!hasOwn(document.ports, id)) {
    fail('NOT_FOUND', path, `Port ${JSON.stringify(id)} does not exist`);
  }
  return document.ports[id] as PortDraft;
}

function requireEdge(
  document: DocumentDraft,
  id: string,
  path: string,
): EdgeDraft {
  if (!hasOwn(document.edges, id)) {
    fail('NOT_FOUND', path, `Edge ${JSON.stringify(id)} does not exist`);
  }
  return document.edges[id] as EdgeDraft;
}

function requirePage(document: DocumentDraft, id: string, path: string): PageDraft {
  if (!hasOwn(document.pages, id)) {
    fail('NOT_FOUND', path, `Page ${JSON.stringify(id)} does not exist`);
  }
  return document.pages[id] as PageDraft;
}

function requireLayer(document: DocumentDraft, id: string, path: string): LayerDraft {
  if (!hasOwn(document.layers, id)) {
    fail('NOT_FOUND', path, `Layer ${JSON.stringify(id)} does not exist`);
  }
  return document.layers[id] as LayerDraft;
}

function requireStyle(document: DocumentDraft, id: string, path: string): StyleDraft {
  if (!hasOwn(document.styles, id)) {
    fail('NOT_FOUND', path, `Style ${JSON.stringify(id)} does not exist`);
  }
  return document.styles[id] as StyleDraft;
}

function collision(document: Record<string, unknown>, id: string, path: string): void {
  if (hasOwn(document, id)) {
    fail('ID_COLLISION', path, `ID ${JSON.stringify(id)} is already in use`);
  }
}

function deleteEdge(document: DocumentDraft, id: string): void {
  delete document.edges[id];
  if (document.layout.edgeOverrides !== undefined) {
    delete document.layout.edgeOverrides[id];
  }
}

function applyOperations(
  document: DocumentDraft,
  operations: readonly Operation[],
): void {
  operations.forEach((operation, index) => {
    const path = `ops.${index}`;

    switch (operation.op) {
      case 'set_document_title': {
        document.title = operation.title;
        return;
      }
      case 'create_page': {
        collision(document.pages, operation.page.id, `${path}.page.id`);
        collision(document.layers, operation.baseLayer.id, `${path}.baseLayer.id`);
        if (
          operation.page.layerIds.length !== 1 ||
          operation.page.layerIds[0] !== operation.baseLayer.id
        ) {
          fail(
            'INVALID_OPERATION',
            `${path}.page.layerIds`,
            'A new page must list exactly its supplied base layer',
          );
        }
        if (operation.baseLayer.pageId !== operation.page.id) {
          fail(
            'INVALID_OPERATION',
            `${path}.baseLayer.pageId`,
            'A page base layer must belong to the new page',
          );
        }
        if (operation.baseLayer.locked) {
          fail(
            'INVALID_OPERATION',
            `${path}.baseLayer.locked`,
            'A page base layer cannot be locked',
          );
        }
        document.pages[operation.page.id] = clone(operation.page);
        document.layers[operation.baseLayer.id] = clone(operation.baseLayer);
        return;
      }
      case 'rename_page': {
        const page = requirePage(document, operation.id, `${path}.id`);
        page.name = operation.name;
        return;
      }
      case 'set_page_color': {
        const page = requirePage(document, operation.id, `${path}.id`);
        if (operation.color === null) {
          delete page.color;
        } else {
          page.color = operation.color;
        }
        return;
      }
      case 'set_page_order': {
        const page = requirePage(document, operation.id, `${path}.id`);
        if (operation.order === null) {
          delete page.order;
        } else {
          page.order = operation.order;
        }
        return;
      }
      case 'delete_page': {
        requirePage(document, operation.id, `${path}.id`);
        if (Object.keys(document.pages).length <= 1) {
          fail('INVALID_OPERATION', `${path}.id`, 'The last page cannot be deleted');
        }
        const layerIds = new Set(
          Object.values(document.layers)
            .filter((layer) => layer.pageId === operation.id)
            .map((layer) => layer.id),
        );
        const nodeIds = new Set(
          Object.values(document.nodes)
            .filter((node) => node.pageId === operation.id)
            .map((node) => node.id),
        );
        const portIds = new Set(
          Object.values(document.ports)
            .filter((port) => nodeIds.has(port.nodeId))
            .map((port) => port.id),
        );
        for (const [edgeId, edge] of Object.entries(document.edges)) {
          if (
            edge.pageId === operation.id ||
            portIds.has(edge.fromPortId) ||
            portIds.has(edge.toPortId)
          ) {
            deleteEdge(document, edgeId);
          }
        }
        for (const portId of portIds) {
          delete document.ports[portId];
        }
        for (const nodeId of nodeIds) {
          delete document.layout.overrides[nodeId];
          if (document.layout.derived !== null) {
            delete document.layout.derived[nodeId];
          }
          delete document.nodes[nodeId];
        }
        for (const layerId of layerIds) {
          delete document.layers[layerId];
        }
        delete document.pages[operation.id];
        return;
      }
      case 'create_layer': {
        collision(document.layers, operation.layer.id, `${path}.layer.id`);
        const page = requirePage(
          document,
          operation.layer.pageId,
          `${path}.layer.pageId`,
        );
        const layerIndex = operation.index ?? page.layerIds.length;
        if (layerIndex < 1 || layerIndex > page.layerIds.length) {
          fail(
            'INVALID_OPERATION',
            `${path}.index`,
            `Layer index must be between 1 and ${page.layerIds.length}`,
          );
        }
        document.layers[operation.layer.id] = clone(operation.layer);
        page.layerIds.splice(layerIndex, 0, operation.layer.id);
        return;
      }
      case 'rename_layer': {
        const layer = requireLayer(document, operation.id, `${path}.id`);
        layer.name = operation.name;
        return;
      }
      case 'reorder_layers': {
        const page = requirePage(document, operation.pageId, `${path}.pageId`);
        const requested = [...operation.layerIds];
        const requestedSet = new Set(requested);
        if (
          requestedSet.size !== requested.length ||
          requested.length !== page.layerIds.length ||
          page.layerIds.some((layerId) => !requestedSet.has(layerId))
        ) {
          fail(
            'INVALID_OPERATION',
            `${path}.layerIds`,
            'Layer order must contain every page layer exactly once',
          );
        }
        if (requested[0] !== page.layerIds[0]) {
          fail(
            'INVALID_OPERATION',
            `${path}.layerIds`,
            'The base layer must remain first',
          );
        }
        page.layerIds = requested;
        return;
      }
      case 'save_layer_view': {
        const page = requirePage(document, operation.pageId, `${path}.pageId`);
        for (const layerId of page.layerIds) {
          const layer = requireLayer(document, layerId, `${path}.pageId`);
          layer.defaultVisible = layer.visible;
        }
        return;
      }
      case 'set_layer_visibility': {
        const layer = requireLayer(document, operation.id, `${path}.id`);
        layer.visible = operation.visible;
        return;
      }
      case 'set_layer_locked': {
        const layer = requireLayer(document, operation.id, `${path}.id`);
        const page = requirePage(document, layer.pageId, `${path}.id`);
        if (operation.locked && page.layerIds[0] === operation.id) {
          fail(
            'INVALID_OPERATION',
            `${path}.locked`,
            'The base layer cannot be locked',
          );
        }
        layer.locked = operation.locked;
        return;
      }
      case 'delete_layer': {
        const layer = requireLayer(document, operation.id, `${path}.id`);
        const page = requirePage(document, layer.pageId, `${path}.id`);
        const baseLayerId = page.layerIds[0];
        if (baseLayerId === operation.id || baseLayerId === undefined) {
          fail(
            'INVALID_OPERATION',
            `${path}.id`,
            'The base layer cannot be deleted',
          );
        }
        for (const node of Object.values(document.nodes)) {
          if (node.layerId === operation.id) {
            node.layerId = baseLayerId;
          }
        }
        for (const edge of Object.values(document.edges)) {
          if (edge.layerId === operation.id) {
            edge.layerId = baseLayerId;
          }
        }
        const layerIndex = page.layerIds.indexOf(operation.id);
        if (layerIndex >= 0) {
          page.layerIds.splice(layerIndex, 1);
        }
        delete document.layers[operation.id];
        return;
      }
      case 'create_node': {
        collision(document.nodes, operation.node.id, `${path}.node.id`);
        requirePage(document, operation.node.pageId, `${path}.node.pageId`);
        requireLayer(document, operation.node.layerId, `${path}.node.layerId`);
        requireStyle(document, operation.node.styleId, `${path}.node.styleId`);
        if (operation.node.parentId !== undefined) {
          requireNode(document, operation.node.parentId, `${path}.node.parentId`);
        }
        document.nodes[operation.node.id] = clone(operation.node);
        return;
      }
      case 'create_port': {
        collision(document.ports, operation.port.id, `${path}.port.id`);
        requireNode(document, operation.port.nodeId, `${path}.port.nodeId`);
        document.ports[operation.port.id] = clone(operation.port);
        return;
      }
      case 'set_port_direction': {
        const port = requirePort(document, operation.id, `${path}.id`);
        port.direction = operation.direction;
        return;
      }
      case 'set_port_side': {
        const port = requirePort(document, operation.id, `${path}.id`);
        port.side = operation.side;
        return;
      }
      case 'set_port_order': {
        const port = requirePort(document, operation.id, `${path}.id`);
        if (operation.order === null) {
          delete port.order;
        } else {
          port.order = operation.order;
        }
        return;
      }
      case 'create_edge': {
        collision(document.edges, operation.edge.id, `${path}.edge.id`);
        requirePort(document, operation.edge.fromPortId, `${path}.edge.fromPortId`);
        requirePort(document, operation.edge.toPortId, `${path}.edge.toPortId`);
        requirePage(document, operation.edge.pageId, `${path}.edge.pageId`);
        requireLayer(document, operation.edge.layerId, `${path}.edge.layerId`);
        requireStyle(document, operation.edge.styleId, `${path}.edge.styleId`);
        document.edges[operation.edge.id] = clone(operation.edge);
        return;
      }
      case 'set_edge_endpoints': {
        const edge = requireEdge(document, operation.id, `${path}.id`);
        requirePort(document, operation.fromPortId, `${path}.fromPortId`);
        requirePort(document, operation.toPortId, `${path}.toPortId`);
        edge.fromPortId = operation.fromPortId;
        edge.toPortId = operation.toPortId;
        return;
      }
      case 'set_edge_label': {
        const edge = requireEdge(document, operation.id, `${path}.id`);
        edge.label = operation.label;
        return;
      }
      case 'set_edge_data': {
        const edge = requireEdge(document, operation.id, `${path}.id`);
        edge.data = clone(operation.data);
        return;
      }
      case 'set_edge_semantic': {
        const edge = requireEdge(document, operation.id, `${path}.id`);
        edge.semantic = operation.semantic;
        return;
      }
      case 'set_edge_style': {
        const edge = requireEdge(document, operation.id, `${path}.id`);
        requireStyle(document, operation.styleId, `${path}.styleId`);
        edge.styleId = operation.styleId;
        return;
      }
      case 'set_edge_routing': {
        const edge = requireEdge(document, operation.id, `${path}.id`);
        if (operation.routing === null) {
          delete edge.routing;
        } else {
          edge.routing = clone(operation.routing);
        }
        return;
      }
      case 'set_edge_layout': {
        requireEdge(document, operation.id, `${path}.id`);
        if (operation.layout === null) {
          if (document.layout.edgeOverrides !== undefined) {
            delete document.layout.edgeOverrides[operation.id];
          }
        } else {
          document.layout.edgeOverrides ??= {};
          document.layout.edgeOverrides[operation.id] = clone(operation.layout);
        }
        return;
      }
      case 'set_derived_layout': {
        if (operation.frames !== null) {
          for (const nodeId of Object.keys(operation.frames)) {
            requireNode(document, nodeId, `${path}.frames.${nodeId}`);
          }
        }
        document.layout.engine = operation.engine;
        document.layout.derivedVersion = operation.derivedVersion;
        document.layout.derived = operation.frames === null ? null : clone(operation.frames);
        return;
      }
      case 'set_style_tokens': {
        const style = requireStyle(document, operation.id, `${path}.id`);
        style.tokens = clone(operation.tokens);
        return;
      }
      case 'set_theme': {
        if (operation.theme === null) {
          delete document.theme;
        } else {
          document.theme = clone(operation.theme);
        }
        return;
      }
      case 'rename_node': {
        const node = requireNode(document, operation.id, `${path}.id`);
        if (operation.newId !== operation.id) {
          collision(document.nodes, operation.newId, `${path}.newId`);
          const renamed = { ...node, id: operation.newId } as NodeDraft;
          document.nodes[operation.newId] = renamed;
          delete document.nodes[operation.id];

          Object.values(document.ports).forEach((port) => {
            if (port.nodeId === operation.id) {
              port.nodeId = operation.newId;
            }
          });

          Object.values(document.nodes).forEach((candidate) => {
            if (candidate.parentId === operation.id) {
              candidate.parentId = operation.newId;
            }
          });

          const override = document.layout.overrides[operation.id];
          if (override !== undefined) {
            document.layout.overrides[operation.newId] = { ...override };
            delete document.layout.overrides[operation.id];
          }
          const derived = document.layout.derived?.[operation.id];
          if (derived !== undefined && document.layout.derived !== null) {
            document.layout.derived[operation.newId] = { ...derived };
            delete document.layout.derived[operation.id];
          }
        }
        return;
      }
      case 'set_node_label': {
        const node = requireNode(document, operation.id, `${path}.id`);
        node.label = operation.label;
        return;
      }
      case 'set_node_data': {
        const node = requireNode(document, operation.id, `${path}.id`);
        node.data = clone(operation.data);
        return;
      }
      case 'set_node_style': {
        const node = requireNode(document, operation.id, `${path}.id`);
        requireStyle(document, operation.styleId, `${path}.styleId`);
        node.styleId = operation.styleId;
        return;
      }
      case 'set_node_z_index': {
        requireNode(document, operation.id, `${path}.id`);
        document.layout.overrides[operation.id] = {
          ...document.layout.overrides[operation.id],
          zIndex: operation.zIndex,
        };
        return;
      }
      case 'set_node_parent': {
        const node = requireNode(document, operation.id, `${path}.id`);
        if (operation.parentId === null) {
          delete node.parentId;
        } else {
          requireNode(document, operation.parentId, `${path}.parentId`);
          node.parentId = operation.parentId;
        }
        return;
      }
      case 'set_node_container': {
        const node = requireNode(document, operation.id, `${path}.id`);
        if (operation.container === null) {
          delete node.container;
        } else {
          node.container = clone(operation.container);
        }
        return;
      }
      case 'set_node_layout': {
        const node = requireNode(document, operation.id, `${path}.id`);
        if (
          operation.layout?.rotation !== undefined &&
          operation.layout.rotation % 360 !== 0 &&
          (node.container !== undefined || node.group !== undefined)
        ) {
          fail(
            'INVALID_OPERATION',
            `${path}.layout.rotation`,
            'Containers and groups cannot be rotated',
          );
        }
        if (operation.layout === null) {
          delete document.layout.overrides[operation.id];
        } else {
          document.layout.overrides[operation.id] = clone(operation.layout);
        }
        return;
      }
      case 'delete_node': {
        const node = requireNode(document, operation.id, `${path}.id`);
        Object.values(document.nodes).forEach((candidate) => {
          if (candidate.parentId === operation.id) {
            if (node.parentId === undefined) {
              delete candidate.parentId;
            } else {
              candidate.parentId = node.parentId;
            }
          }
        });
        const portIds = Object.entries(document.ports)
          .filter(([, port]) => port.nodeId === operation.id)
          .map(([portId]) => portId);
        const portIdSet = new Set(portIds);
        const edgeIds = Object.entries(document.edges)
          .filter(
            ([, edge]) =>
              portIdSet.has(edge.fromPortId) || portIdSet.has(edge.toPortId),
          )
          .map(([edgeId]) => edgeId);
        edgeIds.forEach((edgeId) => {
          deleteEdge(document, edgeId);
        });
        portIds.forEach((portId) => {
          delete document.ports[portId];
        });
        delete document.layout.overrides[operation.id];
        if (document.layout.derived !== null) {
          delete document.layout.derived[operation.id];
        }
        delete document.nodes[operation.id];
        return;
      }
      case 'delete_port': {
        requirePort(document, operation.id, `${path}.id`);
        const edgeIds = Object.entries(document.edges)
          .filter(
            ([, edge]) =>
              edge.fromPortId === operation.id || edge.toPortId === operation.id,
          )
          .map(([edgeId]) => edgeId);
        edgeIds.forEach((edgeId) => {
          deleteEdge(document, edgeId);
        });
        delete document.ports[operation.id];
        return;
      }
      case 'delete_edge': {
        requireEdge(document, operation.id, `${path}.id`);
        deleteEdge(document, operation.id);
        return;
      }
      default: {
        fail('INVALID_OPERATION', path, 'Unknown operation');
      }
    }
  });
}

function preservesDocumentReferences(operation: Operation): boolean {
  switch (operation.op) {
    case 'set_document_title':
    case 'delete_node':
    case 'set_node_data':
    case 'set_node_label':
    case 'set_node_style':
    case 'set_node_z_index':
      return true;
    default:
      return false;
  }
}

function cloneTransaction(transaction: CommittedTransaction): CommittedTransaction {
  return clone(transaction);
}

export class OperationEngine {
  #document: OpenChartDocument;
  readonly #undoStack: CommittedTransaction[] = [];
  readonly #redoStack: CommittedTransaction[] = [];
  readonly #idempotency = new Map<string, IdempotencyRecord>();

  public constructor(
    document: OpenChartDocument,
    history: OperationHistoryState = { undoStack: [], redoStack: [] },
  ) {
    this.#document = freeze(clone(document), true);
    this.#undoStack.push(...history.undoStack.map(cloneTransaction));
    this.#redoStack.push(...history.redoStack.map(cloneTransaction));
    for (const transaction of this.#undoStack) {
      const idempotencyKey = transaction.envelope.idempotencyKey;
      if (idempotencyKey !== undefined) {
        this.#idempotency.set(idempotencyKey, {
          fingerprint: envelopeFingerprint(transaction.envelope),
          transaction,
        });
      }
    }
  }

  public get document(): OpenChartDocument {
    return this.#document;
  }

  public get history(): OperationHistoryState {
    return {
      undoStack: this.#undoStack.map(cloneTransaction),
      redoStack: this.#redoStack.map(cloneTransaction),
    };
  }

  /**
   * Capture a rollback point for a serialized mutation. Document and transaction
   * payloads are owned by the engine; only their collection membership is copied.
   * The returned closure is bound to this engine and must not span unrelated edits.
   */
  public checkpoint(): () => void {
    const document = this.#document;
    const undo = this.#undoStack.slice();
    const redo = this.#redoStack.slice();
    const idempotency = new Map(this.#idempotency);
    return () => {
      this.#document = document;
      this.#undoStack.length = 0;
      this.#redoStack.length = 0;
      for (const transaction of undo) this.#undoStack.push(transaction);
      for (const transaction of redo) this.#redoStack.push(transaction);
      this.#idempotency.clear();
      for (const [key, record] of idempotency) this.#idempotency.set(key, record);
    };
  }

  public apply(envelope: OperationEnvelope): ApplyResult {
    const operations = (envelope as { readonly ops?: unknown }).ops;
    if (Array.isArray(operations) && operations.length === 0) {
      return {
        ok: false,
        diagnostics: [
          diagnostic('EMPTY_ENVELOPE', 'ops', 'An operation envelope must contain at least one operation'),
        ],
      };
    }
    if (Array.isArray(operations) && operations.length > 5000) {
      return {
        ok: false,
        diagnostics: [
          diagnostic('TOO_MANY_OPERATIONS', 'ops', 'An operation envelope may contain at most 5000 operations'),
        ],
      };
    }
    const envelopeValidation = validateOperationEnvelope(envelope);
    if (!envelopeValidation.ok) {
      return { ok: false, diagnostics: envelopeValidation.diagnostics };
    }
    const isolatedEnvelope = envelopeValidation.envelope;
    const fingerprint = envelopeFingerprint(isolatedEnvelope);
    const idempotencyKey = isolatedEnvelope.idempotencyKey;
    if (idempotencyKey !== undefined) {
      const record = this.#idempotency.get(idempotencyKey);
      if (record !== undefined) {
        if (record.fingerprint !== fingerprint) {
          return {
            ok: false,
            diagnostics: [
              diagnostic(
                'IDEMPOTENCY_KEY_CONFLICT',
                'idempotencyKey',
                `Idempotency key ${JSON.stringify(idempotencyKey)} was already committed with different content`,
              ),
            ],
          };
        }
        return {
          ok: true,
          replayed: true,
          rev: record.transaction.rev,
          transaction: cloneTransaction(record.transaction),
        };
      }
    }

    if (isolatedEnvelope.baseRev !== this.#document.rev) {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            'BASE_REV_MISMATCH',
            'baseRev',
            `Envelope base revision ${isolatedEnvelope.baseRev} does not match current revision ${this.#document.rev}`,
          ),
        ],
      };
    }

    const committedAt = new Date().toISOString();
    let candidate: OpenChartDocument;
    let forwardPatches: Patch[];
    let inversePatches: Patch[];
    try {
      [candidate, forwardPatches, inversePatches] = produceWithPatches(
        this.#document,
        (draft: DocumentDraft) => {
          applyOperations(draft, isolatedEnvelope.ops);
          draft.rev = this.#document.rev + 1;
          draft.meta.updatedAt = committedAt;
        },
      );
    } catch (error: unknown) {
      if (error instanceof OperationFailure) {
        return { ok: false, diagnostics: [error.diagnostic] };
      }
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            'INVALID_OPERATION',
            'ops',
            error instanceof Error ? error.message : 'Operation application failed',
          ),
        ],
      };
    }

    const diagnostics = isolatedEnvelope.ops.every(preservesDocumentReferences)
      ? []
      : validateReferences(candidate);
    if (diagnostics.length > 0) {
      return {
        ok: false,
        diagnostics: diagnostics.map(({ code, path, message }) =>
          diagnostic(code, path, message),
        ),
      };
    }

    const transaction: CommittedTransaction = {
      envelope: clone(isolatedEnvelope),
      rev: candidate.rev,
      committedAt,
      forwardPatches: clone(forwardPatches),
      inversePatches: clone(inversePatches),
    };
    // The current document is schema-valid and the envelope was parsed by the
    // operation schema, so unchanged entities do not need a full Zod clone.
    // Structural operations still take the cross-entity integrity pass above;
    // reference-preserving node mutations take the measured fast path.
    this.#document = candidate;
    this.#redoStack.length = 0;
    this.#undoStack.push(transaction);
    if (idempotencyKey !== undefined) {
      this.#idempotency.set(idempotencyKey, { fingerprint, transaction });
    }
    return {
      ok: true,
      replayed: false,
      rev: transaction.rev,
      transaction: cloneTransaction(transaction),
    };
  }

  public undo(): UndoResult {
    const transaction = this.#undoStack.pop();
    if (transaction === undefined) {
      return {
        ok: false,
        diagnostics: [
          diagnostic('NOTHING_TO_UNDO', '', 'There is no committed transaction to undo'),
        ],
      };
    }

    let restored: OpenChartDocument;
    try {
      restored = applyPatches(this.#document, transaction.inversePatches);
    } catch (error: unknown) {
      this.#undoStack.push(transaction);
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            'INVALID_OPERATION',
            'undo',
            error instanceof Error ? error.message : 'Undo failed',
          ),
        ],
      };
    }

    const validation = validateDocument(restored);
    if (!validation.ok) {
      this.#undoStack.push(transaction);
      return {
        ok: false,
        diagnostics: validation.diagnostics.map(({ code, path, message }) =>
          diagnostic(code, path, message),
        ),
      };
    }

    this.#document = freeze(validation.document, true);
    const idempotencyKey = transaction.envelope.idempotencyKey;
    if (idempotencyKey !== undefined) {
      const record = this.#idempotency.get(idempotencyKey);
      if (record?.transaction === transaction) {
        this.#idempotency.delete(idempotencyKey);
      }
    }
    this.#redoStack.push(transaction);
    return {
      ok: true,
      rev: this.#document.rev,
      transaction: cloneTransaction(transaction),
    };
  }

  public redo(): RedoResult {
    const transaction = this.#redoStack.pop();
    if (transaction === undefined) {
      return {
        ok: false,
        diagnostics: [
          diagnostic('NOTHING_TO_REDO', '', 'There is no transaction to redo'),
        ],
      };
    }

    let restored: OpenChartDocument;
    try {
      restored = applyPatches(this.#document, transaction.forwardPatches);
    } catch (error: unknown) {
      this.#redoStack.push(transaction);
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            'INVALID_OPERATION',
            'redo',
            error instanceof Error ? error.message : 'Redo failed',
          ),
        ],
      };
    }

    const validation = validateDocument(restored);
    if (!validation.ok) {
      this.#redoStack.push(transaction);
      return {
        ok: false,
        diagnostics: validation.diagnostics.map(({ code, path, message }) =>
          diagnostic(code, path, message),
        ),
      };
    }

    this.#document = freeze(validation.document, true);
    this.#undoStack.push(transaction);
    const idempotencyKey = transaction.envelope.idempotencyKey;
    if (idempotencyKey !== undefined) {
      this.#idempotency.set(idempotencyKey, {
        fingerprint: envelopeFingerprint(transaction.envelope),
        transaction,
      });
    }
    return {
      ok: true,
      rev: this.#document.rev,
      transaction: cloneTransaction(transaction),
    };
  }
}
