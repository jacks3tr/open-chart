import {
  ID_PATTERN,
  type Edge,
  type Node,
  type OpenChartDocument,
  type Port,
} from '@openchart/ir';

export interface TextProjectionLoss {
  readonly code:
    | 'ENTITY_DATA_OMITTED'
    | 'LAYER_METADATA_OMITTED'
    | 'LAYOUT_OMITTED'
    | 'NODE_KIND_OMITTED'
    | 'PAGE_SCOPE_OMITTED'
    | 'PARENT_CONTAINMENT_OMITTED'
    | 'PORTS_OMITTED'
    | 'ROUTING_OMITTED'
    | 'SEMANTICS_OMITTED'
    | 'STYLE_METADATA_OMITTED'
    | 'THEME_OMITTED';
  readonly count: number;
  readonly message: string;
}

export interface TextProjectionResult {
  readonly pageId: string;
  readonly content: string;
  readonly losses: readonly TextProjectionLoss[];
}

export interface D2ProjectionNode {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly parentId?: string;
}

export interface D2ProjectionPort {
  readonly id: string;
  readonly nodeId: string;
  readonly direction: Port['direction'];
  readonly side: Port['side'];
  readonly order?: number;
}

export interface D2ProjectionEdge {
  readonly id: string;
  readonly fromPortId: string;
  readonly toPortId: string;
  readonly label: string;
  readonly semantic: string;
}

export interface D2Projection {
  readonly nodes: readonly D2ProjectionNode[];
  readonly ports: readonly D2ProjectionPort[];
  readonly edges: readonly D2ProjectionEdge[];
}

export class D2ProjectionError extends Error {
  public constructor(
    message: string,
    public readonly line: number,
    options?: ErrorOptions,
  ) {
    super(`D2 projection line ${line}: ${message}`, options);
    this.name = 'D2ProjectionError';
  }
}

interface SelectedPageEntities {
  readonly pageId: string;
  readonly nodes: readonly Node[];
  readonly ports: readonly Port[];
  readonly edges: readonly Edge[];
}

const JSON_STRING_SOURCE = '"(?:\\\\.|[^"\\\\])*"';
const D2_PATH_SOURCE = `${JSON_STRING_SOURCE}(?:\\.${JSON_STRING_SOURCE})*`;
const NODE_DECLARATION = new RegExp(
  `^(${JSON_STRING_SOURCE}): (${JSON_STRING_SOURCE})( \\{)?$`,
);
const EDGE_DECLARATION = new RegExp(
  `^(${D2_PATH_SOURCE}) -> (${D2_PATH_SOURCE}): (${JSON_STRING_SOURCE})$`,
);
const DIRECTIONS = new Set<Port['direction']>(['in', 'out', 'both']);
const SIDES = new Set<Port['side']>(['north', 'south', 'east', 'west', 'auto']);

function compareIds(left: { readonly id: string }, right: { readonly id: string }): number {
  return left.id.localeCompare(right.id);
}

function selectPage(
  document: OpenChartDocument,
  requestedPageId?: string,
): SelectedPageEntities {
  const pageId = requestedPageId ?? Object.keys(document.pages).sort()[0];
  if (pageId === undefined || document.pages[pageId] === undefined) {
    throw new Error(`Unknown page ${JSON.stringify(requestedPageId ?? '')}`);
  }
  const nodes = Object.values(document.nodes)
    .filter((node) => node.pageId === pageId)
    .sort(compareIds);
  const nodeIds = new Set(nodes.map(({ id }) => id));
  return {
    pageId,
    nodes,
    ports: Object.values(document.ports)
      .filter((port) => nodeIds.has(port.nodeId))
      .sort(compareIds),
    edges: Object.values(document.edges)
      .filter((edge) => edge.pageId === pageId)
      .sort(compareIds),
  };
}

function commonLosses(
  document: OpenChartDocument,
  selected: SelectedPageEntities,
): TextProjectionLoss[] {
  const losses: TextProjectionLoss[] = [];
  const add = (
    code: TextProjectionLoss['code'],
    count: number,
    message: string,
  ): void => {
    if (count > 0) losses.push({ code, count, message });
  };
  add(
    'PAGE_SCOPE_OMITTED',
    Object.keys(document.pages).length - 1,
    'Only the selected page is exported.',
  );
  add(
    'LAYER_METADATA_OMITTED',
    document.pages[selected.pageId]?.layerIds.length ?? 0,
    'Layer names, visibility, locking, and ordering are not represented.',
  );
  add(
    'STYLE_METADATA_OMITTED',
    new Set([
      ...selected.nodes.map(({ styleId }) => styleId),
      ...selected.edges.map(({ styleId }) => styleId),
    ]).size,
    'OpenChart style references and tokens are not represented.',
  );
  add(
    'ENTITY_DATA_OMITTED',
    [...selected.nodes, ...selected.edges].filter(
      ({ data }) => Object.keys(data).length > 0,
    ).length,
    'Entity data records are not represented.',
  );
  add(
    'ROUTING_OMITTED',
    selected.edges.filter(({ routing }) => routing !== undefined).length,
    'Edge routing preferences and waypoints are not represented.',
  );
  const selectedIds = new Set([
    ...selected.nodes.map(({ id }) => id),
    ...selected.edges.map(({ id }) => id),
  ]);
  add(
    'LAYOUT_OMITTED',
    Object.keys(document.layout.overrides).filter((id) => selectedIds.has(id)).length +
      Object.keys(document.layout.derived ?? {}).filter((id) => selectedIds.has(id)).length +
      Object.keys(document.layout.edgeOverrides ?? {}).filter((id) => selectedIds.has(id))
        .length,
    'Authored and derived geometry is not represented.',
  );
  add(
    'THEME_OMITTED',
    document.theme === undefined ? 0 : 1,
    'The document theme is not represented.',
  );
  return losses;
}

function d2Metadata(kind: 'node' | 'port' | 'edge', value: object): string {
  return `# openchart-${kind} ${JSON.stringify(value)}`;
}

function d2Path(parts: readonly string[]): string {
  return parts.map((part) => JSON.stringify(part)).join('.');
}

export function exportDocumentToD2(
  document: OpenChartDocument,
  options: { readonly pageId?: string } = {},
): TextProjectionResult {
  const selected = selectPage(document, options.pageId);
  const nodeById = new Map(selected.nodes.map((node) => [node.id, node]));
  const portsByNode = new Map<string, Port[]>();
  const childrenByParent = new Map<string, Node[]>();
  for (const port of selected.ports) {
    const ports = portsByNode.get(port.nodeId) ?? [];
    ports.push(port);
    portsByNode.set(port.nodeId, ports);
  }
  for (const node of selected.nodes) {
    if (node.parentId !== undefined && nodeById.has(node.parentId)) {
      const children = childrenByParent.get(node.parentId) ?? [];
      children.push(node);
      childrenByParent.set(node.parentId, children);
    }
  }
  for (const values of [...portsByNode.values(), ...childrenByParent.values()]) {
    values.sort(compareIds);
  }

  const portPaths = new Map<string, string>();
  const lines = ['# openchart-d2-v1', 'direction: right', ''];
  const emitNode = (node: Node, parentPath: readonly string[], depth: number): void => {
    const indent = '  '.repeat(depth);
    const path = [...parentPath, node.id];
    const ports = portsByNode.get(node.id) ?? [];
    const children = childrenByParent.get(node.id) ?? [];
    const hasBody = ports.length > 0 || children.length > 0;
    lines.push(`${indent}${d2Metadata('node', { id: node.id, kind: node.kind })}`);
    lines.push(
      `${indent}${JSON.stringify(node.id)}: ${JSON.stringify(node.label)}${hasBody ? ' {' : ''}`,
    );
    if (!hasBody) return;
    for (const port of ports) {
      const metadata = {
        id: port.id,
        direction: port.direction,
        side: port.side,
        ...(port.order === undefined ? {} : { order: port.order }),
      };
      lines.push(`${indent}  ${d2Metadata('port', metadata)}`);
      lines.push(`${indent}  ${JSON.stringify(port.id)}: "" {`);
      lines.push(`${indent}    shape: circle`);
      lines.push(`${indent}  }`);
      portPaths.set(port.id, d2Path([...path, port.id]));
    }
    for (const child of children) emitNode(child, path, depth + 1);
    lines.push(`${indent}}`);
  };

  for (const node of selected.nodes.filter(
    ({ parentId }) => parentId === undefined || !nodeById.has(parentId),
  )) {
    emitNode(node, [], 0);
  }
  if (selected.edges.length > 0) lines.push('');
  for (const edge of selected.edges) {
    const from = portPaths.get(edge.fromPortId);
    const to = portPaths.get(edge.toPortId);
    if (from === undefined || to === undefined) {
      throw new Error(`Edge ${JSON.stringify(edge.id)} has a port outside the selected page`);
    }
    lines.push(d2Metadata('edge', { id: edge.id, semantic: edge.semantic }));
    lines.push(`${from} -> ${to}: ${JSON.stringify(edge.label)}`);
  }

  return {
    pageId: selected.pageId,
    content: `${lines.join('\n')}\n`,
    losses: commonLosses(document, selected),
  };
}

function mermaidText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\|/g, '&#124;')
    .replace(/\r?\n/g, '<br/>');
}

function mermaidAliases(nodes: readonly Node[]): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>();
  const used = new Set<string>();
  for (const node of nodes) {
    const base = `oc_${node.id.replace(/[^A-Za-z0-9_]/g, '_')}`;
    let alias = base;
    let suffix = 2;
    while (used.has(alias)) alias = `${base}_${suffix++}`;
    aliases.set(node.id, alias);
    used.add(alias);
  }
  return aliases;
}

export function exportDocumentToMermaid(
  document: OpenChartDocument,
  options: { readonly pageId?: string } = {},
): TextProjectionResult {
  const selected = selectPage(document, options.pageId);
  const aliases = mermaidAliases(selected.nodes);
  const ports = new Map(selected.ports.map((port) => [port.id, port]));
  const lines = ['flowchart LR'];
  for (const node of selected.nodes) {
    lines.push(`  %% OpenChart node ${node.id}`);
    lines.push(`  ${aliases.get(node.id)}["${mermaidText(node.label)}"]`);
  }
  for (const edge of selected.edges) {
    const fromNode = ports.get(edge.fromPortId)?.nodeId;
    const toNode = ports.get(edge.toPortId)?.nodeId;
    const from = fromNode === undefined ? undefined : aliases.get(fromNode);
    const to = toNode === undefined ? undefined : aliases.get(toNode);
    if (from === undefined || to === undefined) continue;
    const label = mermaidText(edge.label);
    lines.push(label.length === 0 ? `  ${from} --> ${to}` : `  ${from} -->|${label}| ${to}`);
  }

  return {
    pageId: selected.pageId,
    content: `${lines.join('\n')}\n`,
    losses: [
      ...commonLosses(document, selected),
      ...(selected.ports.length === 0
        ? []
        : [{
            code: 'PORTS_OMITTED' as const,
            count: selected.ports.length,
            message: 'Mermaid connections terminate at nodes, not OpenChart ports.',
          }]),
      ...(selected.nodes.every(({ parentId }) => parentId === undefined)
        ? []
        : [{
            code: 'PARENT_CONTAINMENT_OMITTED' as const,
            count: selected.nodes.filter(({ parentId }) => parentId !== undefined).length,
            message: 'Mermaid output flattens OpenChart parent containment.',
          }]),
      ...(selected.nodes.length === 0
        ? []
        : [{
            code: 'NODE_KIND_OMITTED' as const,
            count: selected.nodes.length,
            message: 'Mermaid output uses one node shape and omits OpenChart kinds.',
          }]),
      ...(selected.edges.every(({ semantic }) => semantic.length === 0)
        ? []
        : [{
            code: 'SEMANTICS_OMITTED' as const,
            count: selected.edges.filter(({ semantic }) => semantic.length > 0).length,
            message: 'Mermaid edge labels omit OpenChart semantic annotations.',
          }]),
    ],
  };
}

function projectionError(line: number, message: string, cause?: unknown): never {
  throw new D2ProjectionError(
    message,
    line,
    cause === undefined ? undefined : { cause },
  );
}

function parseJsonString(value: string, line: number): string {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'string') projectionError(line, 'expected a quoted string');
    return parsed;
  } catch (error: unknown) {
    if (error instanceof D2ProjectionError) throw error;
    return projectionError(line, 'invalid quoted string', error);
  }
}

function parseMetadata(
  line: string,
  kind: 'node' | 'port' | 'edge',
  lineNumber: number,
): Record<string, unknown> {
  const prefix = `# openchart-${kind} `;
  if (!line.startsWith(prefix)) projectionError(lineNumber, `expected ${prefix.trim()}`);
  try {
    const parsed: unknown = JSON.parse(line.slice(prefix.length));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return projectionError(lineNumber, 'metadata must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (error: unknown) {
    if (error instanceof D2ProjectionError) throw error;
    return projectionError(lineNumber, 'invalid metadata JSON', error);
  }
}

function metadataId(
  metadata: Record<string, unknown>,
  line: number,
): string {
  if (typeof metadata.id !== 'string' || !ID_PATTERN.test(metadata.id)) {
    return projectionError(line, 'metadata id must be an OpenChart id');
  }
  return metadata.id;
}

function parsedPath(value: string, line: number): string {
  const parts = value.match(new RegExp(JSON_STRING_SOURCE, 'g'));
  if (parts === null) return projectionError(line, 'invalid D2 endpoint path');
  return d2Path(parts.map((part) => parseJsonString(part, line)));
}

/** Parse only the canonical, metadata-bearing subset emitted by exportDocumentToD2. */
export function parseOpenChartD2(source: string): D2Projection {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let index = 0;
  const nodes: D2ProjectionNode[] = [];
  const ports: D2ProjectionPort[] = [];
  const edges: D2ProjectionEdge[] = [];
  const portByPath = new Map<string, string>();
  const nodeIds = new Set<string>();
  const portIds = new Set<string>();
  const edgeIds = new Set<string>();

  const lineNumber = (): number => index + 1;
  const current = (): string => lines[index] ?? '';
  const skipBlank = (): void => {
    while (current().trim().length === 0 && index < lines.length) index += 1;
  };
  const parseNode = (parentId: string | undefined, parentPath: readonly string[]): void => {
    const metadataLine = lineNumber();
    const metadata = parseMetadata(current().trim(), 'node', metadataLine);
    const id = metadataId(metadata, metadataLine);
    if (nodeIds.has(id)) projectionError(metadataLine, `duplicate node ${JSON.stringify(id)}`);
    if (typeof metadata.kind !== 'string' || metadata.kind.length === 0) {
      projectionError(metadataLine, 'node kind must be a non-empty string');
    }
    index += 1;
    const declarationLine = lineNumber();
    const declaration = NODE_DECLARATION.exec(current().trim());
    if (declaration === null) projectionError(declarationLine, 'invalid node declaration');
    const key = parseJsonString(declaration[1] ?? '', declarationLine);
    const label = parseJsonString(declaration[2] ?? '', declarationLine);
    if (key !== id) projectionError(declarationLine, 'node key does not match metadata id');
    const hasBody = declaration[3] !== undefined;
    nodes.push({ id, label, kind: metadata.kind, ...(parentId === undefined ? {} : { parentId }) });
    nodeIds.add(id);
    index += 1;
    if (!hasBody) return;

    const path = [...parentPath, id];
    while (index < lines.length) {
      skipBlank();
      const trimmed = current().trim();
      if (trimmed === '}') {
        index += 1;
        return;
      }
      if (trimmed.startsWith('# openchart-node ')) {
        parseNode(id, path);
        continue;
      }
      if (!trimmed.startsWith('# openchart-port ')) {
        projectionError(lineNumber(), 'expected a node, port, or closing brace');
      }
      const portMetadataLine = lineNumber();
      const portMetadata = parseMetadata(trimmed, 'port', portMetadataLine);
      const portId = metadataId(portMetadata, portMetadataLine);
      if (portIds.has(portId)) {
        projectionError(portMetadataLine, `duplicate port ${JSON.stringify(portId)}`);
      }
      if (
        typeof portMetadata.direction !== 'string' ||
        !DIRECTIONS.has(portMetadata.direction as Port['direction'])
      ) {
        projectionError(portMetadataLine, 'port direction is invalid');
      }
      if (
        typeof portMetadata.side !== 'string' ||
        !SIDES.has(portMetadata.side as Port['side'])
      ) {
        projectionError(portMetadataLine, 'port side is invalid');
      }
      if (
        portMetadata.order !== undefined &&
        (!Number.isInteger(portMetadata.order) || (portMetadata.order as number) < 0)
      ) {
        projectionError(portMetadataLine, 'port order must be a non-negative integer');
      }
      index += 1;
      const portDeclarationLine = lineNumber();
      const portDeclaration = NODE_DECLARATION.exec(current().trim());
      if (portDeclaration === null || portDeclaration[3] === undefined) {
        projectionError(portDeclarationLine, 'invalid port declaration');
      }
      const portKey = parseJsonString(portDeclaration[1] ?? '', portDeclarationLine);
      const portLabel = parseJsonString(portDeclaration[2] ?? '', portDeclarationLine);
      if (portKey !== portId || portLabel !== '') {
        projectionError(portDeclarationLine, 'port declaration must match its metadata id and use an empty label');
      }
      index += 1;
      if (current().trim() !== 'shape: circle') {
        projectionError(lineNumber(), 'canonical ports must use shape: circle');
      }
      index += 1;
      if (current().trim() !== '}') projectionError(lineNumber(), 'port block is not closed');
      index += 1;
      ports.push({
        id: portId,
        nodeId: id,
        direction: portMetadata.direction as Port['direction'],
        side: portMetadata.side as Port['side'],
        ...(portMetadata.order === undefined
          ? {}
          : { order: portMetadata.order as number }),
      });
      portIds.add(portId);
      portByPath.set(d2Path([...path, portId]), portId);
    }
    projectionError(lineNumber(), `node ${JSON.stringify(id)} block is not closed`);
  };

  if (current() !== '# openchart-d2-v1') projectionError(1, 'missing openchart-d2-v1 header');
  index += 1;
  if (current().trim() !== 'direction: right') {
    projectionError(lineNumber(), 'canonical projection must use direction: right');
  }
  index += 1;
  while (index < lines.length) {
    skipBlank();
    if (index >= lines.length) break;
    const trimmed = current().trim();
    if (trimmed.startsWith('# openchart-node ')) {
      parseNode(undefined, []);
      continue;
    }
    if (!trimmed.startsWith('# openchart-edge ')) {
      projectionError(lineNumber(), 'expected a node or edge declaration');
    }
    const metadataLine = lineNumber();
    const metadata = parseMetadata(trimmed, 'edge', metadataLine);
    const id = metadataId(metadata, metadataLine);
    if (edgeIds.has(id)) projectionError(metadataLine, `duplicate edge ${JSON.stringify(id)}`);
    if (typeof metadata.semantic !== 'string') {
      projectionError(metadataLine, 'edge semantic must be a string');
    }
    index += 1;
    const declarationLine = lineNumber();
    const declaration = EDGE_DECLARATION.exec(current().trim());
    if (declaration === null) projectionError(declarationLine, 'invalid edge declaration');
    const fromPortId = portByPath.get(parsedPath(declaration[1] ?? '', declarationLine));
    const toPortId = portByPath.get(parsedPath(declaration[2] ?? '', declarationLine));
    if (fromPortId === undefined || toPortId === undefined) {
      projectionError(declarationLine, 'edge endpoint is not a declared canonical port');
    }
    edges.push({
      id,
      fromPortId,
      toPortId,
      label: parseJsonString(declaration[3] ?? '', declarationLine),
      semantic: metadata.semantic,
    });
    edgeIds.add(id);
    index += 1;
  }

  return {
    nodes: nodes.sort(compareIds),
    ports: ports.sort(compareIds),
    edges: edges.sort(compareIds),
  };
}
