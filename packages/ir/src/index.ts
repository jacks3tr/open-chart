import { z, type ZodIssue } from 'zod';

/** The only document format understood by the Phase 0 IR. */
export const SCHEMA_VERSION = 1 as const;

/** IDs are mutable, addressable names in the canonical IR. */
export const ID_PATTERN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/;

/** UIDs are 26-character Crockford-base32 ULIDs. */
export const UID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

const idSchema = z.string().regex(ID_PATTERN, {
  message: 'Expected a lowercase dot-separated identifier',
});
const uidSchema = z.string().regex(UID_PATTERN, {
  message: 'Expected a 26-character ULID',
});
const jsonValueSchema = z.json();
const jsonRecordSchema = z.record(z.string(), jsonValueSchema);
const isoDateTimeSchema = z.string().datetime({ offset: true });

export const PageSchema = z
  .object({
    id: idSchema,
    uid: uidSchema,
    name: z.string(),
    order: z.number().int().nonnegative().optional(),
    color: z.string().min(1).optional(),
    layerIds: z.array(idSchema).min(1),
  })
  .strict();

export const LayerSchema = z
  .object({
    id: idSchema,
    uid: uidSchema,
    name: z.string(),
    pageId: idSchema,
    visible: z.boolean(),
    defaultVisible: z.boolean().optional(),
    locked: z.boolean(),
  })
  .strict();

export const ContainerSettingsSchema = z
  .object({
    title: z.string().optional(),
    magnetize: z.boolean().optional(),
    assistedLayout: z.boolean().optional(),
    clip: z.boolean().optional(),
    autoGrow: z.boolean().optional(),
    padding: z.number().finite().nonnegative().optional(),
  })
  .strict();

export const GroupSettingsSchema = z.object({}).strict();

/**
 * A node is semantic data only. Position, size, and other rendered geometry
 * belong in `layout.overrides` or `layout.derived`, never on this object.
 */
export const NodeSchema = z
  .object({
    id: idSchema,
    uid: uidSchema,
    kind: z.string(),
    label: z.string(),
    pageId: idSchema,
    layerId: idSchema,
    styleId: idSchema,
    parentId: idSchema.optional(),
    container: ContainerSettingsSchema.optional(),
    group: GroupSettingsSchema.optional(),
    data: jsonRecordSchema,
  })
  .strict();

export const PortSchema = z
  .object({
    id: idSchema,
    uid: uidSchema,
    nodeId: idSchema,
    direction: z.enum(['in', 'out', 'both']),
    side: z.enum(['north', 'south', 'east', 'west', 'auto']),
    order: z.number().int().nonnegative().optional(),
  })
  .strict();

export const EdgeRoutingSchema = z
  .object({
    mode: z.enum(['orthogonal', 'straight', 'curved']),
    avoidObstacles: z.boolean().optional(),
    cornerRadius: z.number().finite().nonnegative().max(64).optional(),
    jumpStyle: z.enum(['arc', 'gap', 'square', 'none']).optional(),
    lineWidth: z.number().finite().min(0.5).max(10).optional(),
    lineStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
    startMarker: z
      .enum(['none', 'arrow', 'open-arrow', 'diamond', 'circle', 'bar', 'crow-foot'])
      .optional(),
    endMarker: z
      .enum(['none', 'arrow', 'open-arrow', 'diamond', 'circle', 'bar', 'crow-foot'])
      .optional(),
  })
  .strict();

export const EdgeSchema = z
  .object({
    id: idSchema,
    uid: uidSchema,
    fromPortId: idSchema,
    toPortId: idSchema,
    label: z.string(),
    semantic: z.string(),
    pageId: idSchema,
    layerId: idSchema,
    styleId: idSchema,
    routing: EdgeRoutingSchema.optional(),
    data: jsonRecordSchema,
  })
  .strict();

const styleSchema = z
  .object({
    id: idSchema,
    uid: uidSchema,
    role: z.string(),
    tokens: jsonRecordSchema,
  })
  .strict();

export const ThemeSchema = z
  .object({
    presetId: idSchema,
    tokens: jsonRecordSchema,
  })
  .strict();

/** Layout is intentionally separate from the semantic entity records. */
export const LayoutOverrideSchema = z
  .object({
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    width: z.number().finite().positive().optional(),
    height: z.number().finite().positive().optional(),
    rotation: z.number().finite().optional(),
    zIndex: z.number().int().nonnegative().optional(),
    pinned: z.boolean().optional(),
  })
  .strict();

/** Disposable geometry produced by a layout engine. Explicit overrides win. */
export const LayoutFrameSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  })
  .strict();

export const EdgeLayoutOverrideSchema = z
  .object({
    waypoints: z
      .array(
        z
          .object({
            x: z.number().finite(),
            y: z.number().finite(),
          })
          .strict(),
      )
      .max(256)
      .optional(),
    labelT: z.number().finite().min(0).max(1).optional(),
    labelPlacement: z.enum(['above', 'below', 'on']).optional(),
    labelOffset: z.number().finite().min(-256).max(256).optional(),
  })
  .strict();

const layoutSchema = z
  .object({
    engine: z.string().optional(),
    options: jsonRecordSchema.optional(),
    overrides: z.record(idSchema, LayoutOverrideSchema),
    edgeOverrides: z.record(idSchema, EdgeLayoutOverrideSchema).optional(),
    derivedVersion: z.string().optional(),
    derived: z.record(idSchema, LayoutFrameSchema).nullable(),
  })
  .strict();

const documentMetaSchema = z
  .object({
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

const entityMap = <T extends z.ZodType>(schema: T) => z.record(idSchema, schema);

/** Runtime schema for schema-version 1 OpenChart documents. */
export const DocumentSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    documentId: idSchema,
    uid: uidSchema,
    title: z.string(),
    rev: z.number().int().nonnegative(),
    pages: entityMap(PageSchema),
    layers: entityMap(LayerSchema),
    nodes: entityMap(NodeSchema),
    ports: entityMap(PortSchema),
    edges: entityMap(EdgeSchema),
    styles: entityMap(styleSchema),
    theme: ThemeSchema.optional(),
    layout: layoutSchema,
    meta: documentMetaSchema,
  })
  .strict();

/** Lowercase alias for consumers that use value-style schema naming. */
export const documentSchema = DocumentSchema;

export type Page = z.infer<typeof PageSchema>;
export type Layer = z.infer<typeof LayerSchema>;
export type ContainerSettings = z.infer<typeof ContainerSettingsSchema>;
export type GroupSettings = z.infer<typeof GroupSettingsSchema>;
export type Node = z.infer<typeof NodeSchema>;
export type Port = z.infer<typeof PortSchema>;
export type EdgeRouting = z.infer<typeof EdgeRoutingSchema>;
export type Edge = z.infer<typeof EdgeSchema>;
export type Style = z.infer<typeof styleSchema>;
export type Theme = z.infer<typeof ThemeSchema>;
export type LayoutOverride = z.infer<typeof LayoutOverrideSchema>;
export type LayoutFrame = z.infer<typeof LayoutFrameSchema>;
export type EdgeLayoutOverride = z.infer<typeof EdgeLayoutOverrideSchema>;
export type Layout = z.infer<typeof layoutSchema>;
export type DocumentMeta = z.infer<typeof documentMetaSchema>;
export type OpenChartDocument = z.infer<typeof DocumentSchema>;

/** Stable machine-readable validation codes. */
export type DocumentDiagnosticCode =
  | 'SCHEMA_INVALID'
  | 'DUPLICATE_UID'
  | 'ID_KEY_MISMATCH'
  | 'DANGLING_PAGE_REFERENCE'
  | 'DANGLING_LAYER_REFERENCE'
  | 'DANGLING_NODE_REFERENCE'
  | 'DANGLING_PORT_REFERENCE'
  | 'DANGLING_EDGE_REFERENCE'
  | 'DANGLING_STYLE_REFERENCE'
  | 'INVALID_PORT_DIRECTION'
  | 'EDGE_PAGE_MISMATCH'
  | 'INVALID_PARENT_REFERENCE'
  | 'INVALID_NODE_ROLE'
  | 'INVALID_LAYOUT_OVERRIDE'
  | 'INVALID_PAGE_LAYERS'
  | 'LAYER_PAGE_MISMATCH'
  | 'DUPLICATE_PAGE_ORDER'
  | 'PARENT_CYCLE';

export interface DocumentDiagnostic {
  readonly code: DocumentDiagnosticCode;
  /** Dot-separated path into the submitted document. */
  readonly path: string;
  readonly message: string;
}

export type DocumentValidationResult =
  | {
      readonly ok: true;
      readonly document: OpenChartDocument;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly DocumentDiagnostic[];
    };

function formatPath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? '$' : path.map(String).join('.');
}

function schemaDiagnostic(issue: ZodIssue): DocumentDiagnostic {
  return {
    code: 'SCHEMA_INVALID',
    path: formatPath(issue.path),
    message: issue.message,
  };
}

function diagnostic(
  code: DocumentDiagnosticCode,
  path: string,
  message: string,
): DocumentDiagnostic {
  return { code, path, message };
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function checkIdentityMap<T extends { id: string; uid: string }>(
  collection: string,
  values: Record<string, T>,
  diagnostics: DocumentDiagnostic[],
  seenUids: Map<string, string>,
): void {
  for (const [key, value] of Object.entries(values)) {
    const path = `${collection}.${key}`;
    if (key !== value.id) {
      diagnostics.push(
        diagnostic(
          'ID_KEY_MISMATCH',
          `${path}.id`,
          `Entity id ${JSON.stringify(value.id)} does not match map key ${JSON.stringify(key)}`,
        ),
      );
    }

    const firstPath = seenUids.get(value.uid);
    if (firstPath !== undefined) {
      diagnostics.push(
        diagnostic(
          'DUPLICATE_UID',
          `${path}.uid`,
          `UID ${JSON.stringify(value.uid)} is already used at ${firstPath}`,
        ),
      );
    } else {
      seenUids.set(value.uid, `${path}.uid`);
    }
  }
}

function checkReference(
  diagnostics: DocumentDiagnostic[],
  path: string,
  reference: string,
  collection: Record<string, unknown>,
  code: Extract<
    DocumentDiagnosticCode,
    | 'DANGLING_PAGE_REFERENCE'
    | 'DANGLING_LAYER_REFERENCE'
    | 'DANGLING_NODE_REFERENCE'
    | 'DANGLING_PORT_REFERENCE'
    | 'DANGLING_EDGE_REFERENCE'
    | 'DANGLING_STYLE_REFERENCE'
  >,
): void {
  if (!(reference in collection)) {
    diagnostics.push(
      diagnostic(code, path, `Reference ${JSON.stringify(reference)} does not exist`),
    );
  }
}

/**
 * Validate references and immutable identities on an already schema-valid
 * document. Keeping this pass separate lets callers reuse the integrity
 * checks after trusted structural transforms.
 */
export function validateReferences(
  document: OpenChartDocument,
): readonly DocumentDiagnostic[] {
  const diagnostics: DocumentDiagnostic[] = [];
  const seenUids = new Map<string, string>();

  seenUids.set(document.uid, 'uid');
  checkIdentityMap('pages', document.pages, diagnostics, seenUids);
  checkIdentityMap('layers', document.layers, diagnostics, seenUids);
  checkIdentityMap('nodes', document.nodes, diagnostics, seenUids);
  checkIdentityMap('ports', document.ports, diagnostics, seenUids);
  checkIdentityMap('edges', document.edges, diagnostics, seenUids);
  checkIdentityMap('styles', document.styles, diagnostics, seenUids);

  const pageIdByOrder = new Map<number, string>();
  for (const [pageId, page] of Object.entries(document.pages)) {
    if (page.order !== undefined) {
      const firstPageId = pageIdByOrder.get(page.order);
      if (firstPageId === undefined) {
        pageIdByOrder.set(page.order, pageId);
      } else {
        diagnostics.push(
          diagnostic(
            'DUPLICATE_PAGE_ORDER',
            `pages.${pageId}.order`,
            `Page order ${page.order} is already used by ${JSON.stringify(firstPageId)}`,
          ),
        );
      }
    }
    const seenLayerIds = new Set<string>();
    page.layerIds.forEach((layerId, index) => {
      if (seenLayerIds.has(layerId)) {
        diagnostics.push(
          diagnostic(
            'INVALID_PAGE_LAYERS',
            `pages.${pageId}.layerIds.${index}`,
            `Layer ${JSON.stringify(layerId)} occurs more than once on the page`,
          ),
        );
      }
      seenLayerIds.add(layerId);
      checkReference(
        diagnostics,
        `pages.${pageId}.layerIds.${index}`,
        layerId,
        document.layers,
        'DANGLING_LAYER_REFERENCE',
      );
      const layer = document.layers[layerId];
      if (layer !== undefined && layer.pageId !== pageId) {
        diagnostics.push(
          diagnostic(
            'LAYER_PAGE_MISMATCH',
            `pages.${pageId}.layerIds.${index}`,
            `Layer ${JSON.stringify(layerId)} belongs to page ${JSON.stringify(layer.pageId)}`,
          ),
        );
      }
    });
    const baseLayer = document.layers[page.layerIds[0] ?? ''];
    if (baseLayer?.locked === true) {
      diagnostics.push(
        diagnostic(
          'INVALID_PAGE_LAYERS',
          `layers.${baseLayer.id}.locked`,
          `Base layer ${JSON.stringify(baseLayer.id)} cannot be locked`,
        ),
      );
    }
  }

  for (const [layerId, layer] of Object.entries(document.layers)) {
    checkReference(
      diagnostics,
      `layers.${layerId}.pageId`,
      layer.pageId,
      document.pages,
      'DANGLING_PAGE_REFERENCE',
    );
    const page = document.pages[layer.pageId];
    if (page !== undefined && !page.layerIds.includes(layerId)) {
      diagnostics.push(
        diagnostic(
          'INVALID_PAGE_LAYERS',
          `layers.${layerId}.pageId`,
          `Layer ${JSON.stringify(layerId)} is not listed by page ${JSON.stringify(layer.pageId)}`,
        ),
      );
    }
  }

  for (const [nodeId, node] of Object.entries(document.nodes)) {
    checkReference(
      diagnostics,
      `nodes.${nodeId}.pageId`,
      node.pageId,
      document.pages,
      'DANGLING_PAGE_REFERENCE',
    );
    checkReference(
      diagnostics,
      `nodes.${nodeId}.layerId`,
      node.layerId,
      document.layers,
      'DANGLING_LAYER_REFERENCE',
    );
    const nodeLayer = document.layers[node.layerId];
    if (nodeLayer !== undefined && nodeLayer.pageId !== node.pageId) {
      diagnostics.push(
        diagnostic(
          'LAYER_PAGE_MISMATCH',
          `nodes.${nodeId}.layerId`,
          `Layer ${JSON.stringify(node.layerId)} belongs to page ${JSON.stringify(nodeLayer.pageId)}`,
        ),
      );
    }
    checkReference(
      diagnostics,
      `nodes.${nodeId}.styleId`,
      node.styleId,
      document.styles,
      'DANGLING_STYLE_REFERENCE',
    );
    if (node.container !== undefined && node.group !== undefined) {
      diagnostics.push(
        diagnostic(
          'INVALID_NODE_ROLE',
          `nodes.${nodeId}.group`,
          'A node cannot be both a container and a group',
        ),
      );
    }
    if (node.parentId !== undefined) {
      checkReference(
        diagnostics,
        `nodes.${nodeId}.parentId`,
        node.parentId,
        document.nodes,
        'DANGLING_NODE_REFERENCE',
      );
      const parent = document.nodes[node.parentId];
      if (
        parent !== undefined &&
        parent.container === undefined &&
        parent.group === undefined
      ) {
        diagnostics.push(
          diagnostic(
            'INVALID_PARENT_REFERENCE',
            `nodes.${nodeId}.parentId`,
            `Parent ${JSON.stringify(node.parentId)} is not a container or group`,
          ),
        );
      }
      if (parent !== undefined && parent.pageId !== node.pageId) {
        diagnostics.push(
          diagnostic(
            'INVALID_PARENT_REFERENCE',
            `nodes.${nodeId}.parentId`,
            `Parent ${JSON.stringify(node.parentId)} belongs to a different page`,
          ),
        );
      }
    }
  }

  const parentVisitState = new Map<string, 'visiting' | 'visited'>();
  const parentStack: string[] = [];
  const reportedCycles = new Set<string>();
  const visitParent = (nodeId: string): void => {
    const state = parentVisitState.get(nodeId);
    if (state === 'visited' || state === 'visiting') {
      return;
    }
    parentVisitState.set(nodeId, 'visiting');
    parentStack.push(nodeId);
    const parentId = document.nodes[nodeId]?.parentId;
    if (parentId !== undefined && document.nodes[parentId] !== undefined) {
      if (parentVisitState.get(parentId) === 'visiting') {
        const cycleStart = parentStack.indexOf(parentId);
        const members = parentStack.slice(cycleStart).sort(compareStrings);
        const cycleKey = members.join('|');
        const reporter = members[0];
        if (reporter !== undefined && !reportedCycles.has(cycleKey)) {
          reportedCycles.add(cycleKey);
          diagnostics.push(
            diagnostic(
              'PARENT_CYCLE',
              `nodes.${reporter}.parentId`,
              `Container parent cycle includes ${members.map((member) => JSON.stringify(member)).join(', ')}`,
            ),
          );
        }
      } else {
        visitParent(parentId);
      }
    }
    parentStack.pop();
    parentVisitState.set(nodeId, 'visited');
  };
  Object.keys(document.nodes).sort(compareStrings).forEach(visitParent);

  for (const [portId, port] of Object.entries(document.ports)) {
    checkReference(
      diagnostics,
      `ports.${portId}.nodeId`,
      port.nodeId,
      document.nodes,
      'DANGLING_NODE_REFERENCE',
    );
  }

  for (const [edgeId, edge] of Object.entries(document.edges)) {
    checkReference(
      diagnostics,
      `edges.${edgeId}.fromPortId`,
      edge.fromPortId,
      document.ports,
      'DANGLING_PORT_REFERENCE',
    );
    checkReference(
      diagnostics,
      `edges.${edgeId}.toPortId`,
      edge.toPortId,
      document.ports,
      'DANGLING_PORT_REFERENCE',
    );
    checkReference(
      diagnostics,
      `edges.${edgeId}.pageId`,
      edge.pageId,
      document.pages,
      'DANGLING_PAGE_REFERENCE',
    );
    checkReference(
      diagnostics,
      `edges.${edgeId}.layerId`,
      edge.layerId,
      document.layers,
      'DANGLING_LAYER_REFERENCE',
    );
    checkReference(
      diagnostics,
      `edges.${edgeId}.styleId`,
      edge.styleId,
      document.styles,
      'DANGLING_STYLE_REFERENCE',
    );
    const edgeLayer = document.layers[edge.layerId];
    if (edgeLayer !== undefined && edgeLayer.pageId !== edge.pageId) {
      diagnostics.push(
        diagnostic(
          'LAYER_PAGE_MISMATCH',
          `edges.${edgeId}.layerId`,
          `Layer ${JSON.stringify(edge.layerId)} belongs to page ${JSON.stringify(edgeLayer.pageId)}`,
        ),
      );
    }
    const fromPort = document.ports[edge.fromPortId];
    const toPort = document.ports[edge.toPortId];
    if (fromPort?.direction === 'in') {
      diagnostics.push(
        diagnostic(
          'INVALID_PORT_DIRECTION',
          `edges.${edgeId}.fromPortId`,
          `Source port ${JSON.stringify(fromPort.id)} does not allow outbound connections`,
        ),
      );
    }
    if (toPort?.direction === 'out') {
      diagnostics.push(
        diagnostic(
          'INVALID_PORT_DIRECTION',
          `edges.${edgeId}.toPortId`,
          `Target port ${JSON.stringify(toPort.id)} does not allow inbound connections`,
        ),
      );
    }
    const fromNode = fromPort === undefined ? undefined : document.nodes[fromPort.nodeId];
    const toNode = toPort === undefined ? undefined : document.nodes[toPort.nodeId];
    if (fromNode !== undefined && fromNode.pageId !== edge.pageId) {
      diagnostics.push(
        diagnostic(
          'EDGE_PAGE_MISMATCH',
          `edges.${edgeId}.fromPortId`,
          `Source node ${JSON.stringify(fromNode.id)} belongs to page ${JSON.stringify(fromNode.pageId)}`,
        ),
      );
    }
    if (toNode !== undefined && toNode.pageId !== edge.pageId) {
      diagnostics.push(
        diagnostic(
          'EDGE_PAGE_MISMATCH',
          `edges.${edgeId}.toPortId`,
          `Target node ${JSON.stringify(toNode.id)} belongs to page ${JSON.stringify(toNode.pageId)}`,
        ),
      );
    }
  }

  for (const overrideId of Object.keys(document.layout.overrides)) {
    checkReference(
      diagnostics,
      `layout.overrides.${overrideId}`,
      overrideId,
      document.nodes,
      'DANGLING_NODE_REFERENCE',
    );
    const node = document.nodes[overrideId];
    const rotation = document.layout.overrides[overrideId]?.rotation;
    if (
      (node?.container !== undefined || node?.group !== undefined) &&
      rotation !== undefined &&
      rotation % 360 !== 0
    ) {
      diagnostics.push(
        diagnostic(
          'INVALID_LAYOUT_OVERRIDE',
          `layout.overrides.${overrideId}.rotation`,
          `Container or group ${JSON.stringify(overrideId)} cannot be rotated`,
        ),
      );
    }
  }

  for (const derivedId of Object.keys(document.layout.derived ?? {})) {
    checkReference(
      diagnostics,
      `layout.derived.${derivedId}`,
      derivedId,
      document.nodes,
      'DANGLING_NODE_REFERENCE',
    );
  }

  for (const edgeId of Object.keys(document.layout.edgeOverrides ?? {})) {
    checkReference(
      diagnostics,
      `layout.edgeOverrides.${edgeId}`,
      edgeId,
      document.edges,
      'DANGLING_EDGE_REFERENCE',
    );
  }

  return diagnostics;
}

/** Parse and validate an unknown JSON value as a canonical document. */
export function validateDocument(input: unknown): DocumentValidationResult {
  const parsed = DocumentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      diagnostics: parsed.error.issues.map(schemaDiagnostic),
    };
  }

  const diagnostics = validateReferences(parsed.data);
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }

  return { ok: true, document: parsed.data };
}
