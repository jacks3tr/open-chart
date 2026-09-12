import { validateDocument, type OpenChartDocument } from '@openchart/ir';

export const OPENCHART_CODE_EXAMPLE = `openchart 1
document {"title":"API and database"}
node api {"label":"API","kind":"service"}
node database {"label":"Database","kind":"database"}
edge query api -> database {"label":"SQL"}
place api {"x":80,"y":120,"width":200,"height":120}
place database {"x":400,"y":120,"width":200,"height":120}
`;

export const OPENCHART_CODE_GUIDE = `OpenChart code v1 uses one statement per line. Start with "openchart 1". Blank lines and whole-line # or // comments are allowed. Properties are JSON objects on the same line. IDs are lowercase dot-separated identifiers.
Statements: document {properties}; page ID {properties}; layer ID {properties}; style ID {properties}; node ID {properties}; port ID {properties}; edge ID FROM -> TO {properties}; layout {properties}; place NODE_ID {layout override}; route EDGE_ID {edge layout override}. Semicolons here separate examples and are not part of the syntax.
All properties use the document schema. Entity IDs come from the statement. Edge endpoints refer to explicit port IDs or node IDs; node endpoints create a both-direction auto-side port named NODE_ID.connection. Do not repeat id, fromPortId, or toPortId in properties. Omitted labels use the ID; omitted UIDs are allocated deterministically. An omitted page, layer, or style section supplies defaults, unless document has "defaults":false. Exports set this flag to preserve empty sections. Nodes and edges default to the first page and its first layer. Nodes default to kind "service", edges to semantic "flow", and data defaults to {}. Use explicit pageId, layerId, styleId, parentId, data, routing, and ports for full control. place and route use the same geometry as the UI; no automatic layout runs. Unplaced nodes use the editor's grid fallback. apply_layout can arrange them through MCP.
Export includes every document field, UID, page, layer, style, node, port, edge, and layout value. Edit that export to retain all UI details. export with format "openchart" returns the whole document. apply_code replaces the open document's content in one undoable transaction, retaining its identity and creation date; baseRev protects concurrent edits and dryRun defaults to true. Read get_document_info for the current revision. Use apply_operations for incremental edits. Mermaid and D2 remain separate, lossy export formats.`;

export class OpenChartCodeError extends Error {
  public constructor(message: string, public readonly line: number) {
    super(`OpenChart code line ${line}: ${message}`);
    this.name = 'OpenChartCodeError';
  }
}

type Properties = Record<string, unknown>;
const ENTITY_KINDS = ['page', 'layer', 'style', 'node', 'port', 'place', 'route'] as const;
type EntityKind = typeof ENTITY_KINDS[number];
type Statement = {
  readonly properties: Properties;
  readonly line: number;
} & (
  | { readonly kind: 'document' | 'layout' }
  | { readonly kind: EntityKind; readonly id: string }
  | { readonly kind: 'edge'; readonly id: string; readonly from: string; readonly to: string }
);

const IDENTIFIER = '[a-z0-9-]+(?:\\.[a-z0-9-]+)*';
const ENTITY = new RegExp(`^(${ENTITY_KINDS.join('|')})\\s+(${IDENTIFIER})(?:\\s+(\\{.*\\}))?$`, 's');
const EDGE = new RegExp(`^edge\\s+(${IDENTIFIER})\\s+(${IDENTIFIER})\\s+->\\s+(${IDENTIFIER})(?:\\s+(\\{.*\\}))?$`, 's');

function isEntityKind(value: string | undefined): value is EntityKind {
  return ENTITY_KINDS.some((kind) => kind === value);
}

function properties(text: string, line: number): Properties {
  let value: unknown;
  try { value = JSON.parse(text); } catch {
    throw new OpenChartCodeError('Expected a JSON object on one line', line);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OpenChartCodeError('Expected a JSON object', line);
  }
  return Object.fromEntries(Object.entries(value));
}

function statements(source: string): Statement[] {
  const result: Statement[] = [];
  const seen = new Set<string>();
  let header = false;
  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const text = raw.trim();
    const line = index + 1;
    if (text === '' || text.startsWith('#') || text.startsWith('//')) continue;
    if (!header) {
      if (text !== 'openchart 1') throw new OpenChartCodeError('Expected openchart 1', line);
      header = true;
      continue;
    }
    const singleton = /^(document|layout)\s+(\{.*\})$/s.exec(text);
    const entity = ENTITY.exec(text);
    const edge = EDGE.exec(text);
    let statement: Statement;
    if ((singleton?.[1] === 'document' || singleton?.[1] === 'layout') && singleton[2] !== undefined) {
      statement = { kind: singleton[1], properties: properties(singleton[2], line), line };
    } else if (isEntityKind(entity?.[1]) && entity?.[2] !== undefined) {
      statement = { kind: entity[1], id: entity[2], properties: properties(entity[3] ?? '{}', line), line };
    } else if (edge?.[1] !== undefined && edge[2] !== undefined && edge[3] !== undefined) {
      statement = { kind: 'edge', id: edge[1], from: edge[2], to: edge[3], properties: properties(edge[4] ?? '{}', line), line };
    } else {
      throw new OpenChartCodeError('Unknown or malformed statement', line);
    }
    const key = `${statement.kind}:${'id' in statement ? statement.id : ''}`;
    if (seen.has(key)) throw new OpenChartCodeError(`Duplicate ${key}`, line);
    seen.add(key);
    if ('id' in statement && 'id' in statement.properties) {
      throw new OpenChartCodeError('Put the ID before the properties', line);
    }
    if (statement.kind === 'edge' && ('fromPortId' in statement.properties || 'toPortId' in statement.properties)) {
      throw new OpenChartCodeError('Put edge endpoints around ->', line);
    }
    result.push(statement);
  }
  if (!header) throw new OpenChartCodeError('Expected openchart 1', 1);
  return result;
}

export function parseOpenChartCode(source: string, options: { readonly reservedUid?: string } = {}): OpenChartDocument {
  const parsed = statements(source);
  const metadata = parsed.find((statement) => statement.kind === 'document');
  const { defaults = true, ...documentProperties } = metadata?.properties ?? {};
  if (typeof defaults !== 'boolean') throw new OpenChartCodeError('defaults must be a boolean', metadata?.line ?? 1);
  const usedUids = new Set(parsed.flatMap(({ properties: value }) => typeof value.uid === 'string' ? [value.uid.toUpperCase()] : []));
  if (options.reservedUid !== undefined) usedUids.add(options.reservedUid.toUpperCase());
  let uidCounter = 0;
  const nextUid = (): string => {
    let uid: string;
    do { uid = (++uidCounter).toString(16).toUpperCase().padStart(26, '0'); } while (usedUids.has(uid));
    usedUids.add(uid);
    return uid;
  };
  const records = (kind: EntityKind | 'edge', defaults: (id: string, value: Properties) => Properties): Record<string, Properties> =>
    Object.fromEntries(parsed.filter((statement) => 'id' in statement).filter((statement) => statement.kind === kind).map((statement) => {
      const id = statement.id;
      return [id, { ...defaults(id, statement.properties), uid: nextUid(), ...statement.properties, id }];
    }));
  const pages = records('page', (id) => ({ name: id }));
  if (defaults && !parsed.some((statement) => statement.kind === 'page')) {
    pages['page.main'] = { id: 'page.main', uid: nextUid(), name: 'Page 1', layerIds: ['layer.main'] };
  }
  const pageId = Object.keys(pages)[0] ?? 'page.main';
  const layers = records('layer', (id) => ({ name: id, pageId, visible: true, locked: false }));
  if (defaults && !parsed.some((statement) => statement.kind === 'layer')) {
    layers['layer.main'] = { id: 'layer.main', uid: nextUid(), name: 'Layer 1', pageId, visible: true, locked: false };
  }
  for (const page of Object.values(pages)) {
    if (page.layerIds === undefined) page.layerIds = Object.values(layers).filter((layer) => layer.pageId === page.id).map((layer) => layer.id);
  }
  const defaultLayer = (value: Properties): unknown => {
    const page = pages[typeof value.pageId === 'string' ? value.pageId : pageId];
    return Array.isArray(page?.layerIds) ? page.layerIds[0] : undefined;
  };
  const styles = records('style', (id) => ({ role: id, tokens: {} }));
  if (defaults && !parsed.some((statement) => statement.kind === 'style')) {
    styles['style.node'] = { id: 'style.node', uid: nextUid(), role: 'service', tokens: {} };
    styles['style.edge'] = { id: 'style.edge', uid: nextUid(), role: 'flow', tokens: {} };
  }
  const styleId = Object.keys(styles)[0];
  const nodes = records('node', (id, value) => ({ label: id, kind: 'service', pageId, layerId: defaultLayer(value), styleId, data: {} }));
  const ports = records('port', () => ({ direction: 'both', side: 'auto' }));
  const endpoint = (id: string, line: number): string => {
    if (Object.hasOwn(ports, id)) return id;
    if (!Object.hasOwn(nodes, id)) throw new OpenChartCodeError(`Unknown node or port ${id}`, line);
    const portId = `${id}.connection`;
    const existing = ports[portId];
    if (existing !== undefined && existing.nodeId !== id) {
      throw new OpenChartCodeError(`Port ${portId} belongs to another node; use an explicit port`, line);
    }
    ports[portId] ??= { id: portId, uid: nextUid(), nodeId: id, direction: 'both', side: 'auto' };
    return portId;
  };
  const edges = records('edge', (id, value) => ({ label: id, semantic: 'flow', pageId, layerId: defaultLayer(value), styleId: styles['style.edge'] === undefined ? styleId : 'style.edge', data: {} }));
  for (const statement of parsed) {
    if (statement.kind === 'edge') {
      const edge = edges[statement.id];
      if (edge !== undefined) {
        edge.fromPortId = endpoint(statement.from, statement.line);
        edge.toPortId = endpoint(statement.to, statement.line);
      }
    }
  }
  const layout = { overrides: {}, derived: null, ...parsed.find((statement) => statement.kind === 'layout')?.properties };
  const mergeLayout = (kind: string, existing: unknown): Properties => {
    const map = properties(JSON.stringify(existing === undefined ? {} : existing), 1);
    for (const statement of parsed) {
      if (!('id' in statement) || statement.kind !== kind) continue;
      const id = statement.id;
      if (Object.hasOwn(map, id)) throw new OpenChartCodeError(`Duplicate layout for ${id}`, statement.line);
      map[id] = statement.properties;
    }
    return map;
  };
  const input = {
    schemaVersion: 1, documentId: 'document.main', uid: metadata?.properties.uid ?? nextUid(),
    title: 'Untitled', rev: 0, meta: { createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z' },
    ...documentProperties,
    pages, layers, styles, nodes, ports, edges,
    layout: {
      ...layout, overrides: mergeLayout('place', layout.overrides),
      ...('edgeOverrides' in layout || parsed.some((statement) => statement.kind === 'route')
        ? { edgeOverrides: mergeLayout('route', 'edgeOverrides' in layout ? layout.edgeOverrides : undefined) } : {}),
    },
  };
  // Document metadata must not hide misspelled or duplicate content sections.
  if (metadata !== undefined) {
    for (const key of Object.keys(metadata.properties)) {
      if (['pages', 'layers', 'styles', 'nodes', 'ports', 'edges', 'layout', 'schemaVersion'].includes(key)) {
        throw new OpenChartCodeError(`${key} is not a document metadata property`, metadata.line);
      }
    }
  }
  const validation = validateDocument(input);
  if (!validation.ok) {
    const diagnostic = validation.diagnostics[0];
    const statement = parsed.find((entry) => 'id' in entry && diagnostic?.path.startsWith(`${entry.kind === 'place' ? 'layout.overrides' : entry.kind === 'route' ? 'layout.edgeOverrides' : `${entry.kind}s`}.${entry.id}`));
    throw new OpenChartCodeError(validation.diagnostics.slice(0, 3).map((entry) => `${entry.path}: ${entry.message}`).join('; '), statement?.line ?? metadata?.line ?? 1);
  }
  return validation.document;
}

export function exportDocumentToOpenChartCode(document: OpenChartDocument): string {
  const format = (value: unknown): string => JSON.stringify(value, (_key, entry: unknown) => {
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      return Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right)));
    }
    return entry;
  });
  const { schemaVersion, pages, layers, styles, nodes, ports, edges, layout, ...metadata } = document;
  const lines = [`openchart ${schemaVersion}`, `document ${format({ defaults: false, ...metadata })}`];
  const entities = (kind: string, values: Record<string, { id: string }>): void => {
    for (const { id, ...value } of Object.values(values)) lines.push(`${kind} ${id} ${format(value)}`);
  };
  entities('page', pages);
  entities('layer', layers);
  entities('style', styles);
  entities('node', nodes);
  entities('port', ports);
  for (const { id, fromPortId, toPortId, ...value } of Object.values(edges)) {
    lines.push(`edge ${id} ${fromPortId} -> ${toPortId} ${format(value)}`);
  }
  const { overrides, edgeOverrides, ...layoutProperties } = layout;
  lines.push(`layout ${format({ ...layoutProperties, ...(edgeOverrides === undefined ? {} : { edgeOverrides: {} }) })}`);
  for (const [id, value] of Object.entries(overrides)) lines.push(`place ${id} ${format(value)}`);
  for (const [id, value] of Object.entries(edgeOverrides ?? {})) lines.push(`route ${id} ${format(value)}`);
  return `${lines.join('\n')}\n`;
}
