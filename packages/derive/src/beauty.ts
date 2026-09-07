import type {
  EdgeRouting,
  LayoutFrame,
  Node,
  OpenChartDocument,
  Port,
} from '@openchart/ir';
import type { Operation } from '@openchart/ops';

import {
  layoutDocument,
  type LayoutDirection,
  type LayoutDocumentRuntime,
  type LayoutMode,
} from './layout.js';
import {
  compileTokenOperations,
  TOKEN_PRESETS,
  type TokenPresetId,
} from './tokens.js';

export const BEAUTY_PASS_STEP_IDS = [
  'infer-semantics',
  'assign-ports',
  'auto-layout',
  'route',
  'snap-grid',
  'apply-tokens',
  'semantics-to-style',
] as const;

export type BeautyPassStepId = (typeof BEAUTY_PASS_STEP_IDS)[number];

export interface BeautyPassOptions {
  readonly pageId: string;
  /** Limit edits to these shapes and connectors between them. */
  readonly nodeIds?: readonly string[];
  readonly layoutMode?: LayoutMode;
  readonly direction?: LayoutDirection;
  readonly presetId?: TokenPresetId;
}

export interface BeautyPassStep {
  readonly id: BeautyPassStepId;
  readonly label: string;
  readonly operationCount: number;
}

export interface BeautyPassBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BeautyPassPlan {
  readonly operations: readonly Operation[];
  readonly steps: readonly BeautyPassStep[];
  readonly fitBounds: BeautyPassBounds;
}

type SemanticTier =
  | 'source'
  | 'target'
  | 'storage'
  | 'data'
  | 'operations'
  | 'external'
  | 'network';

const STEP_LABELS: Readonly<Record<BeautyPassStepId, string>> = {
  'infer-semantics': 'Identify shape roles',
  'assign-ports': 'Assign ports',
  'auto-layout': 'Arrange shapes',
  route: 'Route connectors',
  'snap-grid': 'Normalize shape sizes',
  'apply-tokens': 'Unify diagram colors',
  'semantics-to-style': 'Distinguish system roles',
};

const BEAUTY_ROUTING: EdgeRouting = {
  mode: 'orthogonal',
  avoidObstacles: true,
  cornerRadius: 8,
  jumpStyle: 'arc',
};

const BEAUTY_NODE_SIZE: Readonly<Record<string, { readonly width: number; readonly height: number }>> = {
  system: { width: 310, height: 230 },
  service: { width: 300, height: 154 },
  database: { width: 300, height: 154 },
  control: { width: 310, height: 128 },
  group: { width: 360, height: 240 },
  container: { width: 360, height: 240 },
  text: { width: 280, height: 148 },
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]),
  );
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function textData(node: Node, key: string): string {
  const value = node.data[key];
  return typeof value === 'string' ? value : '';
}

function inferSemanticTier(node: Node): SemanticTier {
  const haystack = [
    node.kind,
    node.label,
    textData(node, 'zone'),
    textData(node, 'zoneLabel'),
    textData(node, 'eyebrow'),
    textData(node, 'subtitle'),
  ].join(' ').toLowerCase();
  if (/external|third[- ]party|saas|partner/.test(haystack)) return 'external';
  if (/database|storage|warehouse|audit|archive|cache/.test(haystack)) return 'storage';
  if (/source|record|erp|identity|authoritative/.test(haystack)) return 'source';
  if (/operations|control|monitor|sentinel|reconcil/.test(haystack)) return 'operations';
  if (/target|execution|compute|mes|runtime/.test(haystack)) return 'target';
  if (/integration|fabric|transform|ingress|data|stream|queue/.test(haystack)) return 'data';
  return 'network';
}

function styleMatchesTier(role: string, tier: SemanticTier): boolean {
  const normalized = role.toLowerCase();
  const needles: Readonly<Record<SemanticTier, readonly string[]>> = {
    source: ['source', 'identity'],
    target: ['target', 'compute'],
    storage: ['storage', 'database'],
    data: ['integration', 'fabric', 'data'],
    operations: ['operations', 'control'],
    external: ['external'],
    network: ['network'],
  };
  return needles[tier].some((needle) => normalized.includes(needle));
}

function compileSemanticOperations(document: OpenChartDocument, nodeIds: ReadonlySet<string>): readonly Operation[] {
  const operations: Operation[] = [];
  const styles = Object.values(document.styles)
    .filter((style) => !style.role.toLowerCase().includes('flow'))
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const node of Object.values(document.nodes)
    .filter((candidate) => nodeIds.has(candidate.id))
    .sort((left, right) => left.id.localeCompare(right.id))) {
    const semanticTier = inferSemanticTier(node);
    if (node.data.semanticTier !== semanticTier) {
      operations.push({
        op: 'set_node_data',
        id: node.id,
        data: { ...node.data, semanticTier },
      });
    }
    const inferredStyle = styles.find((style) => styleMatchesTier(style.role, semanticTier));
    if (inferredStyle !== undefined && inferredStyle.id !== node.styleId) {
      operations.push({ op: 'set_node_style', id: node.id, styleId: inferredStyle.id });
    }
  }
  return operations;
}

function desiredPortSide(port: Port, direction: LayoutDirection): Port['side'] {
  if (port.direction === 'both') {
    return 'auto';
  }
  if (direction === 'RIGHT') {
    return port.direction === 'out' ? 'east' : 'west';
  }
  return port.direction === 'out' ? 'south' : 'north';
}

function compilePortOperations(
  document: OpenChartDocument,
  nodeIds: ReadonlySet<string>,
  direction: LayoutDirection,
): readonly Operation[] {
  const operations: Operation[] = [];
  for (const port of Object.values(document.ports)
    .filter((candidate) =>
      nodeIds.has(candidate.nodeId) &&
      document.layout.overrides[candidate.nodeId]?.pinned !== true)
    .sort((left, right) => left.id.localeCompare(right.id))) {
    const side = desiredPortSide(port, direction);
    if (port.side !== side) {
      operations.push({ op: 'set_port_side', id: port.id, side });
    }
  }
  return operations;
}

function compileSizeOperations(document: OpenChartDocument, nodeIds: ReadonlySet<string>): readonly Operation[] {
  const operations: Operation[] = [];
  for (const node of Object.values(document.nodes)
    .filter((candidate) => nodeIds.has(candidate.id))
    .sort((left, right) => left.id.localeCompare(right.id))) {
    const current = document.layout.overrides[node.id];
    if (current?.pinned === true) {
      continue;
    }
    const size = BEAUTY_NODE_SIZE[node.kind] ?? { width: 280, height: 148 };
    const layout = { ...current, ...size, pinned: false };
    if (!equalJson(current, layout)) {
      operations.push({ op: 'set_node_layout', id: node.id, layout });
    }
  }
  return operations;
}

function compileRoutingOperations(document: OpenChartDocument, nodeIds: ReadonlySet<string>): readonly Operation[] {
  const operations: Operation[] = [];
  for (const edge of Object.values(document.edges)
    .filter((candidate) =>
      document.layers[candidate.layerId]?.locked === false &&
      document.layers[candidate.layerId]?.visible === true &&
      nodeIds.has(document.ports[candidate.fromPortId]?.nodeId ?? '') &&
      nodeIds.has(document.ports[candidate.toPortId]?.nodeId ?? ''))
    .sort((left, right) => left.id.localeCompare(right.id))) {
    const routing = { ...edge.routing, ...BEAUTY_ROUTING };
    if (!equalJson(edge.routing, routing)) {
      operations.push({ op: 'set_edge_routing', id: edge.id, routing });
    }
  }
  return operations;
}

function fitBounds(frames: Readonly<Record<string, LayoutFrame>>): BeautyPassBounds {
  const values = Object.values(frames);
  if (values.length === 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const margin = 64;
  const minX = Math.min(...values.map((frame) => frame.x));
  const minY = Math.min(...values.map((frame) => frame.y));
  const maxX = Math.max(...values.map((frame) => frame.x + frame.width));
  const maxY = Math.max(...values.map((frame) => frame.y + frame.height));
  return {
    x: minX - margin,
    y: minY - margin,
    width: Math.max(1, maxX - minX + margin * 2),
    height: Math.max(1, maxY - minY + margin * 2),
  };
}

export async function planBeautyPass(
  document: OpenChartDocument,
  options: BeautyPassOptions,
  runtime?: LayoutDocumentRuntime,
): Promise<BeautyPassPlan> {
  const presetId = options.presetId ?? 'openchart-light';
  if (!(presetId in TOKEN_PRESETS)) {
    throw new Error(`Unknown Beauty Pass token preset ${JSON.stringify(presetId)}`);
  }
  const direction = options.direction ?? 'RIGHT';
  if (options.nodeIds?.some((id) => document.nodes[id]?.pageId !== options.pageId)) {
    throw new Error('Beauty Pass selection must contain shapes on the current page');
  }
  const requestedIds = options.nodeIds === undefined ? undefined : new Set(options.nodeIds);
  const nodeIds = new Set(Object.values(document.nodes)
    .filter((node) => node.pageId === options.pageId &&
      document.layers[node.layerId]?.visible === true &&
      document.layers[node.layerId]?.locked === false &&
      (requestedIds === undefined || requestedIds.has(node.id)))
    .map((node) => node.id));
  const portOperations = compilePortOperations(document, nodeIds, direction);
  const sizeOperations = compileSizeOperations(document, nodeIds);
  const layoutInput = structuredClone(document);
  for (const node of Object.values(document.nodes)) {
    if (node.pageId === options.pageId && !nodeIds.has(node.id)) {
      layoutInput.layout.overrides[node.id] = {
        ...document.layout.derived?.[node.id],
        ...document.layout.overrides[node.id],
        pinned: true,
      };
    }
  }
  for (const operation of [...portOperations, ...sizeOperations]) {
    if (operation.op === 'set_port_side') {
      const port = layoutInput.ports[operation.id];
      if (port !== undefined) {
        port.side = operation.side;
      }
    } else if (operation.op === 'set_node_layout') {
      if (operation.layout === null) {
        delete layoutInput.layout.overrides[operation.id];
      } else {
        layoutInput.layout.overrides[operation.id] = structuredClone(operation.layout);
      }
    }
  }
  const layout = await layoutDocument(layoutInput, {
    pageId: options.pageId,
    mode: options.layoutMode ?? 'layered',
    direction,
    spacing: 48,
  }, runtime);
  const semanticOperations = compileSemanticOperations(document, nodeIds);
  const layoutOperations: Operation[] = [];
  const mergedFrames = { ...document.layout.derived, ...layout.frames };
  if (requestedIds !== undefined) {
    for (const id of nodeIds) {
      const frame = layout.frames[id];
      if (frame === undefined || document.layout.overrides[id]?.pinned === true) continue;
      layoutOperations.push({ op: 'set_node_layout', id,
        layout: { ...document.layout.overrides[id], ...frame, pinned: true } });
    }
  } else if (
    document.layout.engine !== layout.engine ||
    document.layout.derivedVersion !== layout.derivedVersion ||
    !equalJson(document.layout.derived, mergedFrames)
  ) {
    layoutOperations.push({
      op: 'set_derived_layout',
      engine: layout.engine,
      derivedVersion: layout.derivedVersion,
      frames: mergedFrames,
    });
  }
  const routingOperations = compileRoutingOperations(document, nodeIds);
  // Only retheme styles owned by this page's editable objects. Styles used by
  // another page, hidden/locked objects, or external connectors stay untouched.
  const usedStyles = new Set<string>();
  const protectedStyles = new Set<string>();
  for (const node of Object.values(document.nodes)) {
    (nodeIds.has(node.id) ? usedStyles : protectedStyles).add(node.styleId);
  }
  for (const operation of semanticOperations) {
    if (operation.op === 'set_node_style') usedStyles.add(operation.styleId);
  }
  for (const edge of Object.values(document.edges)) {
    const eligible = nodeIds.has(document.ports[edge.fromPortId]?.nodeId ?? '') &&
      nodeIds.has(document.ports[edge.toPortId]?.nodeId ?? '') &&
      document.layers[edge.layerId]?.locked === false && document.layers[edge.layerId]?.visible === true;
    (eligible ? usedStyles : protectedStyles).add(edge.styleId);
  }
  const tokenOperations = requestedIds === undefined ? compileTokenOperations(document, presetId)
    .filter((operation) => operation.op === 'set_theme'
      ? Object.keys(document.pages).length === 1 && protectedStyles.size === 0
      : operation.op === 'set_style_tokens' && usedStyles.has(operation.id) && !protectedStyles.has(operation.id)) : [];
  const operations = [
    ...semanticOperations,
    ...portOperations,
    ...sizeOperations,
    ...layoutOperations,
    ...routingOperations,
    ...tokenOperations,
  ];
  const semanticStyleCount = semanticOperations.filter(
    (operation) => operation.op === 'set_node_style',
  ).length;
  const steps: BeautyPassStep[] = BEAUTY_PASS_STEP_IDS.map((id) => ({
    id,
    label: STEP_LABELS[id],
    operationCount: id === 'infer-semantics'
      ? semanticOperations.length - semanticStyleCount
      : id === 'assign-ports'
        ? portOperations.length
      : id === 'auto-layout' || id === 'snap-grid'
        ? id === 'snap-grid'
          ? sizeOperations.length
          : layoutOperations.length
        : id === 'route'
          ? routingOperations.length
          : id === 'apply-tokens'
            ? tokenOperations.length
            : id === 'semantics-to-style'
              ? semanticStyleCount
              : 0,
  }));
  return {
    operations,
    steps,
    fitBounds: fitBounds(Object.fromEntries(Object.entries(layout.frames).filter(([id]) => nodeIds.has(id)))),
  };
}
