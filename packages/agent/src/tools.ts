import {
  compileTokenOperations,
  layoutDocument,
  planBeautyPass,
  TOKEN_PRESET_IDS,
  type LayoutDirection,
  type LayoutMode,
  type TokenPresetId,
} from '@openchart/derive';
import type {
  Edge,
  EdgeLayoutOverride,
  Layer,
  LayoutFrame,
  LayoutOverride,
  Node,
  OpenChartDocument,
  Page,
  Port,
} from '@openchart/ir';
import type {
  CommittedTransaction,
  Operation,
  OperationEnvelope,
} from '@openchart/ops';
import type { JournalOperationRecord } from '@openchart/persistence';
import {
  exportDocumentToD2,
  exportDocumentToMermaid,
  type TextProjectionLoss,
} from '@openchart/serialize';

import {
  proposeD2Import,
  type D2ImportProposalResult,
  type ProposeD2ImportInput,
} from './d2-proposal.js';

import type {
  DocumentSessionApplyFailure,
  DocumentSessionApplyOptions,
  DocumentSessionApplyResult,
  DocumentSessionHistoryResult,
  OpenChartDocumentSession,
} from './session.js';
import type {
  GetScreenshotInput,
  GetScreenshotResult,
} from './screenshot-core.js';
import { sha256Hex } from './hash.js';

export type {
  GetScreenshotFailure,
  GetScreenshotInput,
  GetScreenshotResult,
  GetScreenshotSuccess,
  ScreenshotRegion,
} from './screenshot-core.js';

export interface OpenChartToolSession {
  readonly document: OpenChartDocument;
  readonly history: OpenChartDocumentSession['history'];
  readonly readOnly: boolean;
  readonly mutationsEnabled: boolean;
  readonly persistenceFault: string | undefined;
  getOperations: OpenChartDocumentSession['getOperations'];
  apply(
    envelope: OperationEnvelope,
    options?: DocumentSessionApplyOptions,
  ): Promise<DocumentSessionApplyResult>;
  undo(): Promise<DocumentSessionHistoryResult>;
  redo(): Promise<DocumentSessionHistoryResult>;
}

export type OpenChartScreenshotRenderer = (
  document: OpenChartDocument,
  input?: GetScreenshotInput,
) => Promise<GetScreenshotResult>;

const DEFAULT_FIND_LIMIT = 50;
const MAX_FIND_LIMIT = 100;
const MAX_SUBGRAPH_NODES = 50;
const MAX_SUBGRAPH_DEPTH = 2;
const MAX_DELETE_BATCH = 25;
const MAX_DOCUMENT_INFO_SUMMARIES = 100;
const MAX_CHANGED_IDS = 200;
const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 100;
const DEFAULT_OPERATIONS_LIMIT = 50;
const MAX_OPERATIONS_LIMIT = 100;
const MAX_LAYOUT_SPACING = 512;
const MAX_LAYOUT_GRID_SIZE = 128;
const MAX_TEXT_PROJECTION_BYTES = 1024 * 1024;
const LAYOUT_MODES = new Set<LayoutMode>([
  'layered',
  'tree',
  'radial',
  'force',
]);
const LAYOUT_DIRECTIONS = new Set<LayoutDirection>(['RIGHT', 'DOWN']);
const TOKEN_PRESETS = new Set<TokenPresetId>(TOKEN_PRESET_IDS);

/** Fields intentionally exposed by the cheap node lookup. */
export type FindNodeField =
  | 'id'
  | 'uid'
  | 'kind'
  | 'label'
  | 'pageId'
  | 'layerId'
  | 'styleId'
  | 'parentId';

export interface FindNodesInput {
  readonly filter?: string;
  readonly limit?: number;
  readonly cursor?: string | null;
  readonly fields?: readonly FindNodeField[];
}

export type FindNodeItem = Partial<Pick<Node, FindNodeField>>;

export interface FindNodesSuccess {
  readonly items: readonly FindNodeItem[];
  readonly nextCursor: string | null;
}

export interface ToolInputFailure {
  readonly ok: false;
  readonly code: 'INVALID_INPUT';
  readonly message: string;
  readonly field?: string;
}

export type FindNodesResult = FindNodesSuccess | (ToolInputFailure & {
  readonly items: readonly FindNodeItem[];
  readonly nextCursor: null;
});

export interface DocumentPageSummary {
  readonly id: string;
  readonly name: string;
  readonly layerIds: readonly string[];
}

export interface DocumentLayerSummary {
  readonly id: string;
  readonly name: string;
  readonly pageId: string;
  readonly visible: boolean;
  readonly locked: boolean;
}

export interface DocumentInfo {
  readonly documentId: string;
  readonly title: string;
  readonly rev: number;
  readonly counts: {
    readonly pages: number;
    readonly layers: number;
    readonly nodes: number;
    readonly ports: number;
    readonly edges: number;
    readonly styles: number;
  };
  readonly pages: readonly DocumentPageSummary[];
  readonly pagesTruncated: boolean;
  readonly layers: readonly DocumentLayerSummary[];
  readonly layersTruncated: boolean;
  readonly themePresetId: string | null;
  readonly layoutEngine: string | null;
  readonly bounds: LayoutFrame | null;
}

export interface GetHistoryInput {
  readonly limit?: number;
}

export interface HistoryTransactionSummary {
  readonly txId: string;
  readonly rev: number;
  readonly baseRev: number;
  readonly committedAt: string;
  readonly actor: OperationEnvelope['actor'];
  readonly origin: OperationEnvelope['origin'];
  readonly operationCount: number;
  readonly summary: string;
}

export interface GetHistorySuccess {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoDepth: number;
  readonly redoDepth: number;
  readonly undo: readonly HistoryTransactionSummary[];
  readonly redo: readonly HistoryTransactionSummary[];
  readonly undoTruncated: boolean;
  readonly redoTruncated: boolean;
}

export type GetHistoryResult = GetHistorySuccess | (ToolInputFailure & GetHistorySuccess);

export type GetOperationsInput =
  | {
      readonly txId: string;
      readonly sinceRev?: never;
      readonly limit?: number;
    }
  | {
      readonly txId?: never;
      readonly sinceRev: number;
      readonly limit?: number;
    };

export interface GetOperationsSuccess {
  readonly events: readonly JournalOperationRecord[];
  readonly truncated: boolean;
}

export type GetOperationsResult =
  | GetOperationsSuccess
  | (ToolInputFailure & GetOperationsSuccess);

export type ExportTextFormat = 'd2' | 'mermaid';

export interface ExportTextInput {
  readonly format: ExportTextFormat;
  readonly pageId?: string;
}

export interface ExportTextSuccess {
  readonly format: ExportTextFormat;
  readonly pageId: string;
  readonly mimeType: 'text/plain';
  readonly content: string;
  readonly losses: readonly TextProjectionLoss[];
}

export type ExportTextResult =
  | ExportTextSuccess
  | (ToolInputFailure & {
      readonly content: '';
      readonly losses: readonly [];
    });

export interface GetNodesInput {
  readonly ids: readonly string[];
  readonly depth?: number;
}

export interface SubgraphLayout {
  readonly overrides: Readonly<Record<string, LayoutOverride>>;
  readonly derived: Readonly<Record<string, LayoutFrame>> | null;
  readonly edgeOverrides: Readonly<Record<string, EdgeLayoutOverride>>;
}

export interface GetNodesSuccess {
  readonly nodes: Readonly<Record<string, Node>>;
  readonly ports: Readonly<Record<string, Port>>;
  readonly edges: Readonly<Record<string, Edge>>;
  readonly layout: SubgraphLayout;
  readonly missingIds: readonly string[];
  readonly truncated: boolean;
}

export type GetNodesResult = GetNodesSuccess | (ToolInputFailure & GetNodesSuccess);

export interface ApplyOperationsInput {
  readonly baseRev: number;
  readonly txId: string;
  readonly idempotencyKey?: string;
  readonly dryRun?: boolean;
  readonly ops: readonly Operation[];
}

export interface DerivedMutationInput {
  readonly baseRev: number;
  readonly txId: string;
  readonly idempotencyKey?: string;
  readonly dryRun?: boolean;
}

export interface ApplyLayoutInput extends DerivedMutationInput {
  readonly pageId: string;
  readonly mode: LayoutMode;
  readonly direction?: LayoutDirection;
  readonly spacing?: number;
  readonly gridSize?: number;
}

export interface ApplyBeautyPassInput extends DerivedMutationInput {
  readonly pageId: string;
  readonly layoutMode?: LayoutMode;
  readonly direction?: LayoutDirection;
  readonly presetId?: TokenPresetId;
}

export interface SetTokensInput extends DerivedMutationInput {
  readonly presetId: TokenPresetId;
}

export interface ApplyOperationsSuccess {
  readonly ok: true;
  readonly dryRun: boolean;
  readonly replayed: boolean;
  readonly rev: number;
  readonly txId: string;
  readonly applied: number;
  readonly changedIds: readonly string[];
  readonly changedIdsTruncated: boolean;
}

export interface DestructiveConfirmationFailure {
  readonly ok: false;
  readonly dryRun: false;
  readonly code: 'DESTRUCTIVE_CONFIRMATION_REQUIRED';
  readonly message: string;
  readonly rev: number;
  readonly txId: string;
  readonly deleteCount: number;
}

export type ApplyOperationsFailure =
  | DocumentSessionApplyFailure
  | DestructiveConfirmationFailure
  | (ToolInputFailure & { readonly dryRun: boolean; readonly rev: number });

export type ApplyOperationsResult = ApplyOperationsSuccess | ApplyOperationsFailure;

function compareIds(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareIds);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function clampInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  if (!isFiniteNumber(value)) {
    return null;
  }
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sortedRecord<T>(record: Readonly<Record<string, T>>): Record<string, T> {
  const sorted: Record<string, T> = {};
  for (const id of Object.keys(record).sort(compareIds)) {
    const value = record[id];
    if (value !== undefined) {
      sorted[id] = clone(value);
    }
  }
  return sorted;
}

function pickNodeField(node: Node, field: FindNodeField): unknown {
  switch (field) {
    case 'id':
      return node.id;
    case 'uid':
      return node.uid;
    case 'kind':
      return node.kind;
    case 'label':
      return node.label;
    case 'pageId':
      return node.pageId;
    case 'layerId':
      return node.layerId;
    case 'styleId':
      return node.styleId;
    case 'parentId':
      return node.parentId;
  }
}

const FIND_NODE_FIELDS = new Set<FindNodeField>([
  'id',
  'uid',
  'kind',
  'label',
  'pageId',
  'layerId',
  'styleId',
  'parentId',
]);

function normalizedFindFields(
  fields: readonly FindNodeField[] | undefined,
): FindNodeField[] | ToolInputFailure {
  const requested = fields ?? ['id', 'label', 'kind'];
  const normalized: FindNodeField[] = [];
  for (const field of requested) {
    if (typeof field !== 'string' || !FIND_NODE_FIELDS.has(field)) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        field: 'fields',
        message: `Unsupported node field ${JSON.stringify(field)}`,
      };
    }
    if (!normalized.includes(field)) {
      normalized.push(field);
    }
  }
  return normalized;
}

function inputFailure(
  message: string,
  field?: string,
): ToolInputFailure {
  return {
    ok: false,
    code: 'INVALID_INPUT',
    message,
    ...(field === undefined ? {} : { field }),
  };
}

function resolveFrame(
  document: OpenChartDocument,
  nodeId: string,
): LayoutFrame | null {
  const override = document.layout.overrides[nodeId];
  const derived = document.layout.derived?.[nodeId];
  const x = override?.x ?? derived?.x;
  const y = override?.y ?? derived?.y;
  const width = override?.width ?? derived?.width;
  const height = override?.height ?? derived?.height;
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isPositiveFiniteNumber(width) ||
    !isPositiveFiniteNumber(height)
  ) {
    return null;
  }
  return { x, y, width, height };
}

function aggregateBounds(
  document: OpenChartDocument,
): LayoutFrame | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let count = 0;

  for (const nodeId of Object.keys(document.nodes)) {
    const frame = resolveFrame(document, nodeId);
    if (frame === null) {
      continue;
    }
    minX = Math.min(minX, frame.x);
    minY = Math.min(minY, frame.y);
    maxX = Math.max(maxX, frame.x + frame.width);
    maxY = Math.max(maxY, frame.y + frame.height);
    count += 1;
  }

  if (
    count === 0 ||
    !isFiniteNumber(minX) ||
    !isFiniteNumber(minY) ||
    !isFiniteNumber(maxX) ||
    !isFiniteNumber(maxY)
  ) {
    return null;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (!isPositiveFiniteNumber(width) || !isPositiveFiniteNumber(height)) {
    return null;
  }
  return { x: minX, y: minY, width, height };
}

function compactPageSummary(page: Page): DocumentPageSummary {
  return {
    id: page.id,
    name: page.name,
    layerIds: [...page.layerIds],
  };
}

function compactLayerSummary(layer: Layer): DocumentLayerSummary {
  return {
    id: layer.id,
    name: layer.name,
    pageId: layer.pageId,
    visible: layer.visible,
    locked: layer.locked,
  };
}

function compactTransaction(
  transaction: CommittedTransaction,
): HistoryTransactionSummary {
  const operationNames = [
    ...new Set(transaction.envelope.ops.map((operation) => operation.op)),
  ];
  const names = operationNames.slice(0, 3).join(', ');
  const remaining = operationNames.length - 3;
  return {
    txId: transaction.envelope.txId,
    rev: transaction.rev,
    baseRev: transaction.envelope.baseRev,
    committedAt: transaction.committedAt,
    actor: transaction.envelope.actor,
    origin: transaction.envelope.origin,
    operationCount: transaction.envelope.ops.length,
    summary:
      `${transaction.envelope.ops.length} operation(s): ${names}` +
      (remaining > 0 ? ` and ${remaining} more type(s)` : ''),
  };
}

function changedIdsFromTransaction(
  transaction: CommittedTransaction,
): Set<string> {
  const changed = new Set<string>();
  for (const patch of transaction.forwardPatches) {
    const path = patch.path.map(String);
    const [root, entityId] = path;
    if (
      (root === 'pages' ||
        root === 'layers' ||
        root === 'nodes' ||
        root === 'ports' ||
        root === 'edges' ||
        root === 'styles') &&
      entityId !== undefined
    ) {
      changed.add(entityId);
      continue;
    }
    if (root === 'layout') {
      const map = path[1];
      const layoutId = path[2];
      if (
        (map === 'overrides' || map === 'derived' || map === 'edgeOverrides') &&
        layoutId !== undefined
      ) {
        changed.add(layoutId);
      }
    }
  }
  return changed;
}

function changedIdsFromOperations(operations: readonly Operation[]): Set<string> {
  const changed = new Set<string>();
  for (const operation of operations) {
    switch (operation.op) {
      case 'set_document_title':
        break;
      case 'create_page':
        changed.add(operation.page.id);
        changed.add(operation.baseLayer.id);
        break;
      case 'create_layer':
        changed.add(operation.layer.id);
        break;
      case 'create_node':
        changed.add(operation.node.id);
        break;
      case 'create_port':
        changed.add(operation.port.id);
        break;
      case 'create_edge':
        changed.add(operation.edge.id);
        break;
      case 'set_derived_layout':
        for (const id of Object.keys(operation.frames ?? {})) {
          changed.add(id);
        }
        break;
      case 'set_theme':
        break;
      case 'rename_node':
        changed.add(operation.id);
        changed.add(operation.newId);
        break;
      case 'rename_page':
      case 'set_page_color':
      case 'set_page_order':
      case 'delete_page':
      case 'rename_layer':
      case 'set_layer_visibility':
      case 'set_layer_locked':
      case 'delete_layer':
      case 'set_port_direction':
      case 'set_port_side':
      case 'set_port_order':
      case 'set_edge_endpoints':
      case 'set_edge_label':
      case 'set_edge_semantic':
      case 'set_edge_style':
      case 'set_edge_routing':
      case 'set_edge_layout':
      case 'set_style_tokens':
      case 'set_node_label':
      case 'set_node_data':
      case 'set_node_style':
      case 'set_node_z_index':
      case 'set_node_parent':
      case 'set_node_container':
      case 'set_node_layout':
      case 'delete_node':
      case 'delete_port':
      case 'delete_edge':
        changed.add(operation.id);
        break;
      case 'reorder_layers':
      case 'save_layer_view':
        changed.add(operation.pageId);
        break;
    }
  }
  return changed;
}

function transactionResult(
  transaction: CommittedTransaction,
  dryRun: boolean,
  replayed: boolean,
): ApplyOperationsSuccess {
  const changedIds = changedIdsFromTransaction(transaction);
  for (const id of changedIdsFromOperations(transaction.envelope.ops)) {
    changedIds.add(id);
  }
  const sortedChangedIds = [...changedIds].sort(compareIds);
  return {
    ok: true,
    dryRun,
    replayed,
    rev: transaction.rev,
    txId: transaction.envelope.txId,
    applied: transaction.envelope.ops.length,
    changedIds: sortedChangedIds.slice(0, MAX_CHANGED_IDS),
    changedIdsTruncated: sortedChangedIds.length > MAX_CHANGED_IDS,
  };
}

function deleteCount(operations: readonly Operation[]): number {
  return operations.reduce(
    (count, operation) =>
      count +
      (operation.op === 'delete_page' ||
      operation.op === 'delete_layer' ||
      operation.op === 'delete_node' ||
      operation.op === 'delete_port' ||
      operation.op === 'delete_edge'
        ? 1
        : 0),
    0,
  );
}

function validateApplyInput(
  input: ApplyOperationsInput,
): ToolInputFailure | null {
  const identityFailure = validateMutationIdentity(input, 'Operation');
  if (identityFailure !== null) return identityFailure;
  if (!Array.isArray(input.ops)) {
    return inputFailure('ops must be an array', 'ops');
  }
  return null;
}

function validateMutationIdentity(
  input: DerivedMutationInput,
  label: string,
): ToolInputFailure | null {
  if (!input || typeof input !== 'object') {
    return inputFailure(`${label} input must be an object`);
  }
  if (!isFiniteNumber(input.baseRev) || input.baseRev < 0 || !Number.isInteger(input.baseRev)) {
    return inputFailure('baseRev must be a non-negative integer', 'baseRev');
  }
  if (typeof input.txId !== 'string' || input.txId.trim().length === 0) {
    return inputFailure('txId must be a non-empty string', 'txId');
  }
  if (input.idempotencyKey !== undefined &&
      (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.trim().length === 0)) {
    return inputFailure('idempotencyKey must be a non-empty string', 'idempotencyKey');
  }
  if (input.dryRun !== undefined && typeof input.dryRun !== 'boolean') {
    return inputFailure('dryRun must be a boolean', 'dryRun');
  }
  return null;
}

function validatePageId(
  document: OpenChartDocument,
  pageId: unknown,
): ToolInputFailure | null {
  if (typeof pageId !== 'string' || pageId.trim().length === 0) {
    return inputFailure('pageId must be a non-empty string', 'pageId');
  }
  if (document.pages[pageId] === undefined) {
    return inputFailure(`Unknown page ${JSON.stringify(pageId)}`, 'pageId');
  }
  return null;
}

function validateLayoutMode(mode: unknown, field = 'mode'): ToolInputFailure | null {
  return typeof mode === 'string' && LAYOUT_MODES.has(mode as LayoutMode)
    ? null
    : inputFailure(`Unsupported layout mode ${JSON.stringify(mode)}`, field);
}

function validateDirection(direction: unknown): ToolInputFailure | null {
  return direction === undefined ||
    (typeof direction === 'string' &&
      LAYOUT_DIRECTIONS.has(direction as LayoutDirection))
    ? null
    : inputFailure(
        `Unsupported layout direction ${JSON.stringify(direction)}`,
        'direction',
      );
}

function validatePresetId(
  presetId: unknown,
  optional: boolean,
): ToolInputFailure | null {
  if (presetId === undefined && optional) {
    return null;
  }
  return typeof presetId === 'string' && TOKEN_PRESETS.has(presetId as TokenPresetId)
    ? null
    : inputFailure(`Unknown token preset ${JSON.stringify(presetId)}`, 'presetId');
}

function validateApplyLayoutInput(
  document: OpenChartDocument,
  input: ApplyLayoutInput,
): ToolInputFailure | null {
  const identity = validateMutationIdentity(input, 'Layout');
  if (identity !== null) return identity;
  const page = validatePageId(document, input.pageId);
  if (page !== null) return page;
  const mode = validateLayoutMode(input.mode);
  if (mode !== null) return mode;
  const direction = validateDirection(input.direction);
  if (direction !== null) return direction;
  if (
    input.spacing !== undefined &&
    (!isPositiveFiniteNumber(input.spacing) || input.spacing > MAX_LAYOUT_SPACING)
  ) {
    return inputFailure(
      `spacing must be a positive finite number at most ${MAX_LAYOUT_SPACING}`,
      'spacing',
    );
  }
  if (
    input.gridSize !== undefined &&
    (!isPositiveFiniteNumber(input.gridSize) ||
      input.gridSize > MAX_LAYOUT_GRID_SIZE)
  ) {
    return inputFailure(
      `gridSize must be a positive finite number at most ${MAX_LAYOUT_GRID_SIZE}`,
      'gridSize',
    );
  }
  return null;
}

function validateApplyBeautyPassInput(
  document: OpenChartDocument,
  input: ApplyBeautyPassInput,
): ToolInputFailure | null {
  const identity = validateMutationIdentity(input, 'Beauty Pass');
  if (identity !== null) return identity;
  const page = validatePageId(document, input.pageId);
  if (page !== null) return page;
  if (input.layoutMode !== undefined) {
    const mode = validateLayoutMode(input.layoutMode, 'layoutMode');
    if (mode !== null) return mode;
  }
  const direction = validateDirection(input.direction);
  if (direction !== null) return direction;
  return validatePresetId(input.presetId, true);
}

function validateSetTokensInput(input: SetTokensInput): ToolInputFailure | null {
  const identity = validateMutationIdentity(input, 'Token');
  return identity ?? validatePresetId(input.presetId, false);
}

function boundedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 240 ? `${message.slice(0, 237)}...` : message;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => compareIds(left, right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function derivedIdempotency(
  tool: 'apply_layout' | 'apply_beauty_pass' | 'set_tokens',
  input: DerivedMutationInput,
  semanticInput: object,
): Promise<{ readonly key: string; readonly prefix: string } | null> {
  if (input.idempotencyKey === undefined) {
    return null;
  }
  const prefix = `openchart:${tool}:${await sha256Hex(input.idempotencyKey)}:`;
  return {
    prefix,
    key: `${prefix}${await sha256Hex(canonicalJson({
      baseRev: input.baseRev,
      txId: input.txId,
      ...semanticInput,
    }))}`,
  };
}

function operationRejected(
  dryRun: boolean,
  rev: number,
  code:
    | 'BASE_REV_MISMATCH'
    | 'IDEMPOTENCY_KEY_CONFLICT'
    | 'INVALID_OPERATION',
  path: string,
  message: string,
): DocumentSessionApplyFailure {
  return {
    ok: false,
    dryRun,
    rev,
    code: 'OPERATION_REJECTED',
    message: boundedMessage(message),
    diagnostics: [{ code, path, message: boundedMessage(message) }],
  };
}

function sessionError(
  error: unknown,
  dryRun: boolean,
  rev: number,
): DocumentSessionApplyFailure {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    dryRun,
    rev,
    code: 'PERSISTENCE_FAILED',
    message: message.length > 240 ? `${message.slice(0, 237)}...` : message,
  };
}

function getCurrentRev(session: OpenChartToolSession): number {
  const rev = session.document.rev;
  return isFiniteNumber(rev) && rev >= 0 ? rev : 0;
}

/**
 * Bounded, deterministic projections over one semantic document session.
 *
 * This class never mutates the session directly. All writes are represented as
 * an OperationEnvelope and delegated to OpenChartDocumentSession.apply().
 */
export class OpenChartToolKernel {
  readonly #session: OpenChartToolSession;
  readonly #renderScreenshot: OpenChartScreenshotRenderer;
  #screenshotTail: Promise<void> = Promise.resolve();

  public constructor(
    session: OpenChartToolSession,
    renderScreenshot: OpenChartScreenshotRenderer,
  ) {
    this.#session = session;
    this.#renderScreenshot = renderScreenshot;
  }

  public exportText(input: ExportTextInput): ExportTextResult {
    const empty = { content: '', losses: [] } as const;
    if (!input || typeof input !== 'object') {
      return { ...inputFailure('Export input must be an object'), ...empty };
    }
    if (input.format !== 'd2' && input.format !== 'mermaid') {
      return {
        ...inputFailure('format must be d2 or mermaid', 'format'),
        ...empty,
      };
    }
    if (input.pageId !== undefined && typeof input.pageId !== 'string') {
      return {
        ...inputFailure('pageId must be a string', 'pageId'),
        ...empty,
      };
    }

    let projection: ReturnType<typeof exportDocumentToD2>;
    try {
      projection =
        input.format === 'd2'
          ? exportDocumentToD2(this.#session.document, {
              ...(input.pageId === undefined ? {} : { pageId: input.pageId }),
            })
          : exportDocumentToMermaid(this.#session.document, {
              ...(input.pageId === undefined ? {} : { pageId: input.pageId }),
            });
    } catch (error: unknown) {
      return {
        ...inputFailure(boundedMessage(error), 'pageId'),
        ...empty,
      };
    }
    if (new TextEncoder().encode(projection.content).byteLength > MAX_TEXT_PROJECTION_BYTES) {
      return {
        ...inputFailure('Text projection exceeds the 1 MiB response limit'),
        ...empty,
      };
    }
    return {
      format: input.format,
      pageId: projection.pageId,
      mimeType: 'text/plain',
      content: projection.content,
      losses: projection.losses,
    };
  }

  public getDocumentInfo(): DocumentInfo {
    const document = this.#session.document;
    const pages = Object.values(document.pages).sort((left, right) =>
      compareIds(left.id, right.id),
    );
    const layers = Object.values(document.layers).sort((left, right) =>
      compareIds(left.id, right.id),
    );
    return {
      documentId: document.documentId,
      title: document.title,
      rev: document.rev,
      counts: {
        pages: Object.keys(document.pages).length,
        layers: Object.keys(document.layers).length,
        nodes: Object.keys(document.nodes).length,
        ports: Object.keys(document.ports).length,
        edges: Object.keys(document.edges).length,
        styles: Object.keys(document.styles).length,
      },
      pages: pages
        .slice(0, MAX_DOCUMENT_INFO_SUMMARIES)
        .map(compactPageSummary),
      pagesTruncated: pages.length > MAX_DOCUMENT_INFO_SUMMARIES,
      layers: layers
        .slice(0, MAX_DOCUMENT_INFO_SUMMARIES)
        .map(compactLayerSummary),
      layersTruncated: layers.length > MAX_DOCUMENT_INFO_SUMMARIES,
      themePresetId: document.theme?.presetId ?? null,
      layoutEngine: document.layout.engine ?? null,
      bounds: aggregateBounds(document),
    };
  }

  public async proposeD2Import(
    input: ProposeD2ImportInput,
  ): Promise<D2ImportProposalResult> {
    return proposeD2Import(this.#session.document, input);
  }

  public async getScreenshot(
    input: GetScreenshotInput = {},
  ): Promise<GetScreenshotResult> {
    const previous = this.#screenshotTail;
    let release!: () => void;
    this.#screenshotTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await this.#renderScreenshot(this.#session.document, input);
    } finally {
      release();
    }
  }

  public getHistory(input: GetHistoryInput = {}): GetHistoryResult {
    if (!input || typeof input !== 'object') {
      return {
        ...inputFailure('History input must be an object'),
        canUndo: false,
        canRedo: false,
        undoDepth: 0,
        redoDepth: 0,
        undo: [],
        redo: [],
        undoTruncated: false,
        redoTruncated: false,
      };
    }
    const limit =
      input.limit === undefined
        ? DEFAULT_HISTORY_LIMIT
        : clampInteger(input.limit, 1, MAX_HISTORY_LIMIT);
    if (limit === null) {
      return {
        ...inputFailure('limit must be a finite number', 'limit'),
        canUndo: false,
        canRedo: false,
        undoDepth: 0,
        redoDepth: 0,
        undo: [],
        redo: [],
        undoTruncated: false,
        redoTruncated: false,
      };
    }

    const history = this.#session.history;
    const undo = [...history.undoStack]
      .reverse()
      .slice(0, limit)
      .map(compactTransaction);
    const redo = [...history.redoStack]
      .reverse()
      .slice(0, limit)
      .map(compactTransaction);
    return {
      canUndo: history.undoStack.length > 0,
      canRedo: history.redoStack.length > 0,
      undoDepth: history.undoStack.length,
      redoDepth: history.redoStack.length,
      undo,
      redo,
      undoTruncated: history.undoStack.length > limit,
      redoTruncated: history.redoStack.length > limit,
    };
  }

  public async getOperations(
    input: GetOperationsInput,
  ): Promise<GetOperationsResult> {
    const empty = { events: [], truncated: false } as const;
    if (!input || typeof input !== 'object') {
      return {
        ...inputFailure('Operation query input must be an object'),
        ...empty,
      };
    }
    const hasTxId = input.txId !== undefined;
    const hasSinceRev = input.sinceRev !== undefined;
    if (hasTxId === hasSinceRev) {
      return {
        ...inputFailure('Provide exactly one of txId or sinceRev'),
        ...empty,
      };
    }
    if (hasTxId && (typeof input.txId !== 'string' || input.txId.length === 0)) {
      return {
        ...inputFailure('txId must be a non-empty string', 'txId'),
        ...empty,
      };
    }
    if (
      hasSinceRev &&
      (!Number.isInteger(input.sinceRev) || (input.sinceRev ?? -1) < 0)
    ) {
      return {
        ...inputFailure('sinceRev must be a non-negative integer', 'sinceRev'),
        ...empty,
      };
    }
    const limit =
      input.limit === undefined
        ? DEFAULT_OPERATIONS_LIMIT
        : clampInteger(input.limit, 1, MAX_OPERATIONS_LIMIT);
    if (limit === null) {
      return {
        ...inputFailure('limit must be a finite number', 'limit'),
        ...empty,
      };
    }

    return hasTxId
      ? this.#session.getOperations({ txId: input.txId, limit })
      : this.#session.getOperations({ sinceRev: input.sinceRev, limit });
  }

  public async undo(): Promise<DocumentSessionHistoryResult> {
    return this.#session.undo();
  }

  public async redo(): Promise<DocumentSessionHistoryResult> {
    return this.#session.redo();
  }

  public async applyLayout(
    input: ApplyLayoutInput,
  ): Promise<ApplyOperationsResult> {
    const dryRun = input?.dryRun ?? true;
    const validation = validateApplyLayoutInput(this.#session.document, input);
    if (validation !== null) {
      return {
        ...validation,
        dryRun,
        rev: getCurrentRev(this.#session),
      };
    }

    const idempotency = await derivedIdempotency('apply_layout', input, {
      pageId: input.pageId,
      mode: input.mode,
      direction: input.direction ?? 'RIGHT',
      spacing: input.spacing ?? 24,
      gridSize: input.gridSize ?? 8,
    });
    const gated = this.#derivedGate(input, idempotency);
    if (gated !== null) return gated;

    const document = this.#session.document;
    let layout: Awaited<ReturnType<typeof layoutDocument>>;
    try {
      layout = await layoutDocument(document, {
        pageId: input.pageId,
        mode: input.mode,
        ...(input.direction === undefined ? {} : { direction: input.direction }),
        ...(input.spacing === undefined ? {} : { spacing: input.spacing }),
        ...(input.gridSize === undefined ? {} : { gridSize: input.gridSize }),
      });
    } catch (error: unknown) {
      return operationRejected(
        dryRun,
        getCurrentRev(this.#session),
        'INVALID_OPERATION',
        '',
        `Layout failed: ${boundedMessage(error)}`,
      );
    }

    const operations: readonly Operation[] =
      document.layout.engine === layout.engine &&
      document.layout.derivedVersion === layout.derivedVersion &&
      canonicalJson(document.layout.derived) === canonicalJson(layout.frames)
        ? []
        : [
            {
              op: 'set_derived_layout',
              engine: layout.engine,
              derivedVersion: layout.derivedVersion,
              frames: layout.frames,
            },
          ];
    return this.#finishDerived(input, operations, 'layout', idempotency);
  }

  public async applyBeautyPass(
    input: ApplyBeautyPassInput,
  ): Promise<ApplyOperationsResult> {
    const dryRun = input?.dryRun ?? true;
    const validation = validateApplyBeautyPassInput(
      this.#session.document,
      input,
    );
    if (validation !== null) {
      return {
        ...validation,
        dryRun,
        rev: getCurrentRev(this.#session),
      };
    }

    const idempotency = await derivedIdempotency('apply_beauty_pass', input, {
      pageId: input.pageId,
      layoutMode: input.layoutMode ?? 'layered',
      direction: input.direction ?? 'RIGHT',
      presetId: input.presetId ?? 'openchart-light',
    });
    const gated = this.#derivedGate(input, idempotency);
    if (gated !== null) return gated;

    let plan: Awaited<ReturnType<typeof planBeautyPass>>;
    try {
      plan = await planBeautyPass(this.#session.document, {
        pageId: input.pageId,
        ...(input.layoutMode === undefined
          ? {}
          : { layoutMode: input.layoutMode }),
        ...(input.direction === undefined ? {} : { direction: input.direction }),
        ...(input.presetId === undefined ? {} : { presetId: input.presetId }),
      });
    } catch (error: unknown) {
      return operationRejected(
        dryRun,
        getCurrentRev(this.#session),
        'INVALID_OPERATION',
        '',
        `Beauty Pass failed: ${boundedMessage(error)}`,
      );
    }
    return this.#finishDerived(input, plan.operations, 'beauty', idempotency);
  }

  public async setTokens(
    input: SetTokensInput,
  ): Promise<ApplyOperationsResult> {
    const dryRun = input?.dryRun ?? true;
    const validation = validateSetTokensInput(input);
    if (validation !== null) {
      return {
        ...validation,
        dryRun,
        rev: getCurrentRev(this.#session),
      };
    }

    const idempotency = await derivedIdempotency('set_tokens', input, {
      presetId: input.presetId,
    });
    const gated = this.#derivedGate(input, idempotency);
    if (gated !== null) return gated;
    const operations = compileTokenOperations(
      this.#session.document,
      input.presetId,
    );
    return this.#finishDerived(input, operations, 'mcp', idempotency);
  }

  public findNodes(input: FindNodesInput = {}): FindNodesResult {
    if (!input || typeof input !== 'object') {
      return {
        ...inputFailure('Node lookup input must be an object'),
        items: [],
        nextCursor: null,
      };
    }
    if (input.filter !== undefined && typeof input.filter !== 'string') {
      return {
        ...inputFailure('filter must be a string', 'filter'),
        items: [],
        nextCursor: null,
      };
    }
    if (
      input.cursor !== undefined &&
      input.cursor !== null &&
      typeof input.cursor !== 'string'
    ) {
      return {
        ...inputFailure('cursor must be a string', 'cursor'),
        items: [],
        nextCursor: null,
      };
    }
    const limit =
      input.limit === undefined
        ? DEFAULT_FIND_LIMIT
        : clampInteger(input.limit, 1, MAX_FIND_LIMIT);
    if (limit === null) {
      return {
        ...inputFailure('limit must be a finite number', 'limit'),
        items: [],
        nextCursor: null,
      };
    }
    if (input.fields !== undefined && !Array.isArray(input.fields)) {
      return {
        ...inputFailure('fields must be an array', 'fields'),
        items: [],
        nextCursor: null,
      };
    }
    const fields = normalizedFindFields(input.fields);
    if (!Array.isArray(fields)) {
      return { ...fields, items: [], nextCursor: null };
    }

    const filter = input.filter?.toLowerCase() ?? '';
    const cursor = input.cursor ?? undefined;
    const candidates = Object.values(this.#session.document.nodes)
      .filter((node) => {
        if (cursor !== undefined && compareIds(node.id, cursor) <= 0) {
          return false;
        }
        if (filter.length === 0) {
          return true;
        }
        return [node.id, node.label, node.kind].some((value) =>
          value.toLowerCase().includes(filter),
        );
      })
      .sort((left, right) => compareIds(left.id, right.id));

    const page = candidates.slice(0, limit);
    const items = page.map((node) => {
      const item: Record<string, unknown> = {};
      for (const field of fields) {
        const value = pickNodeField(node, field);
        if (value !== undefined) {
          item[field] = value;
        }
      }
      return item;
    });
    return {
      items,
      nextCursor: candidates.length > limit ? page.at(-1)?.id ?? null : null,
    };
  }

  public getNodes(input: GetNodesInput): GetNodesResult {
    if (!input || typeof input !== 'object') {
      return {
        ...inputFailure('Subgraph input must be an object'),
        nodes: {},
        ports: {},
        edges: {},
        layout: { overrides: {}, derived: null, edgeOverrides: {} },
        missingIds: [],
        truncated: false,
      };
    }
    if (!Array.isArray(input.ids) || input.ids.some((id) => typeof id !== 'string')) {
      return {
        ...inputFailure('ids must be an array of strings', 'ids'),
        nodes: {},
        ports: {},
        edges: {},
        layout: { overrides: {}, derived: null, edgeOverrides: {} },
        missingIds: [],
        truncated: false,
      };
    }
    const depth =
      input.depth === undefined
        ? 1
        : clampInteger(input.depth, 0, MAX_SUBGRAPH_DEPTH);
    if (depth === null) {
      return {
        ...inputFailure('depth must be a finite number', 'depth'),
        nodes: {},
        ports: {},
        edges: {},
        layout: { overrides: {}, derived: null, edgeOverrides: {} },
        missingIds: [],
        truncated: false,
      };
    }

    const document = this.#session.document;
    const seedIds = sortedUnique(input.ids);
    if (seedIds.length > MAX_SUBGRAPH_NODES) {
      return {
        ...inputFailure(
          `ids must contain at most ${MAX_SUBGRAPH_NODES} unique values`,
          'ids',
        ),
        nodes: {},
        ports: {},
        edges: {},
        layout: { overrides: {}, derived: null, edgeOverrides: {} },
        missingIds: [],
        truncated: false,
      };
    }
    const missingIds = seedIds.filter((id) => document.nodes[id] === undefined);
    const existingSeeds = seedIds.filter((id) => document.nodes[id] !== undefined);
    const included = new Set<string>();
    let truncated = false;
    let frontier: string[] = [];
    for (const id of existingSeeds) {
      if (included.size >= MAX_SUBGRAPH_NODES) {
        truncated = true;
        break;
      }
      included.add(id);
      frontier.push(id);
    }

    const portToNode = new Map<string, string>();
    for (const port of Object.values(document.ports)) {
      portToNode.set(port.id, port.nodeId);
    }
    const sortedNodes = Object.values(document.nodes).sort((left, right) =>
      compareIds(left.id, right.id),
    );
    const sortedEdges = Object.values(document.edges).sort((left, right) =>
      compareIds(left.id, right.id),
    );

    for (let level = 0; level < depth && frontier.length > 0; level += 1) {
      const candidates = new Set<string>();
      for (const nodeId of frontier) {
        const node = document.nodes[nodeId];
        if (node?.parentId !== undefined && document.nodes[node.parentId] !== undefined) {
          candidates.add(node.parentId);
        }
        for (const candidate of sortedNodes) {
          if (candidate.parentId === nodeId) {
            candidates.add(candidate.id);
          }
        }
        for (const edge of sortedEdges) {
          const fromNodeId = portToNode.get(edge.fromPortId);
          const toNodeId = portToNode.get(edge.toPortId);
          if (fromNodeId === nodeId && toNodeId !== undefined) {
            candidates.add(toNodeId);
          }
          if (toNodeId === nodeId && fromNodeId !== undefined) {
            candidates.add(fromNodeId);
          }
        }
      }
      const next: string[] = [];
      for (const candidateId of [...candidates].sort(compareIds)) {
        if (included.has(candidateId) || document.nodes[candidateId] === undefined) {
          continue;
        }
        if (included.size >= MAX_SUBGRAPH_NODES) {
          truncated = true;
          continue;
        }
        included.add(candidateId);
        next.push(candidateId);
      }
      frontier = next;
    }

    const nodes: Record<string, Node> = {};
    for (const id of [...included].sort(compareIds)) {
      const node = document.nodes[id];
      if (node !== undefined) {
        nodes[id] = clone(node);
      }
    }

    const ports: Record<string, Port> = {};
    for (const port of Object.values(document.ports).sort((left, right) =>
      compareIds(left.id, right.id),
    )) {
      if (included.has(port.nodeId)) {
        ports[port.id] = clone(port);
      }
    }
    const edges: Record<string, Edge> = {};
    for (const edge of sortedEdges) {
      const fromNodeId = portToNode.get(edge.fromPortId);
      const toNodeId = portToNode.get(edge.toPortId);
      if (fromNodeId !== undefined && toNodeId !== undefined &&
          included.has(fromNodeId) && included.has(toNodeId)) {
        edges[edge.id] = clone(edge);
      }
    }

    const overrides: Record<string, LayoutOverride> = {};
    for (const id of [...included].sort(compareIds)) {
      const override = document.layout.overrides[id];
      if (override !== undefined) {
        overrides[id] = clone(override);
      }
    }
    const derived = document.layout.derived === null
      ? null
      : (() => {
          const result: Record<string, LayoutFrame> = {};
          for (const id of [...included].sort(compareIds)) {
            const frame = document.layout.derived?.[id];
            if (frame !== undefined) {
              result[id] = clone(frame);
            }
          }
          return result;
        })();
    const edgeOverrides: Record<string, EdgeLayoutOverride> = {};
    for (const edgeId of Object.keys(edges).sort(compareIds)) {
      const override = document.layout.edgeOverrides?.[edgeId];
      if (override !== undefined) {
        edgeOverrides[edgeId] = clone(override);
      }
    }

    return {
      nodes: sortedRecord(nodes),
      ports: sortedRecord(ports),
      edges: sortedRecord(edges),
      layout: { overrides: sortedRecord(overrides), derived, edgeOverrides: sortedRecord(edgeOverrides) },
      missingIds,
      truncated,
    };
  }

  public async applyOperations(
    input: ApplyOperationsInput,
  ): Promise<ApplyOperationsResult> {
    const dryRun = input?.dryRun ?? true;
    const validationFailure = validateApplyInput(input);
    if (validationFailure !== null) {
      return {
        ...validationFailure,
        dryRun,
        rev: getCurrentRev(this.#session),
      };
    }

    const currentRev = getCurrentRev(this.#session);
    const deletes = deleteCount(input.ops);
    if (!dryRun && deletes > MAX_DELETE_BATCH) {
      return {
        ok: false,
        dryRun: false,
        code: 'DESTRUCTIVE_CONFIRMATION_REQUIRED',
        message: `This transaction deletes ${deletes} entities; confirmation is required above ${MAX_DELETE_BATCH}`,
        rev: currentRev,
        txId: input.txId,
        deleteCount: deletes,
      };
    }

    return this.#applyCompiledOperations(
      input,
      input.ops,
      'mcp',
      input.idempotencyKey,
    );
  }

  #derivedGate(
    input: DerivedMutationInput,
    idempotency: Awaited<ReturnType<typeof derivedIdempotency>>,
  ): ApplyOperationsResult | null {
    const dryRun = input.dryRun ?? true;
    const currentRev = getCurrentRev(this.#session);
    if (this.#session.readOnly) {
      return {
        ok: false,
        dryRun,
        rev: currentRev,
        code: 'READ_ONLY',
        message: 'This document session is read-only',
      };
    }
    if (!this.#session.mutationsEnabled) {
      return {
        ok: false,
        dryRun,
        rev: currentRev,
        code: 'MUTATIONS_DISABLED',
        message: 'Mutations are disabled for this document session',
      };
    }
    if (this.#session.persistenceFault !== undefined) {
      return {
        ok: false,
        dryRun,
        rev: currentRev,
        code: 'PERSISTENCE_FAILED',
        message: this.#session.persistenceFault,
      };
    }
    if (idempotency !== null) {
      const matching = this.#session.history.undoStack.filter((transaction) =>
        transaction.envelope.idempotencyKey?.startsWith(idempotency.prefix),
      );
      const replay = matching.find(
        (transaction) => transaction.envelope.idempotencyKey === idempotency.key,
      );
      if (replay !== undefined) {
        return transactionResult(replay, dryRun, true);
      }
      if (matching.length > 0) {
        return operationRejected(
          dryRun,
          getCurrentRev(this.#session),
          'IDEMPOTENCY_KEY_CONFLICT',
          'idempotencyKey',
          `Idempotency key ${JSON.stringify(input.idempotencyKey)} was already committed with different derived-tool input`,
        );
      }
    }

    if (input.baseRev !== currentRev) {
      return operationRejected(
        dryRun,
        currentRev,
        'BASE_REV_MISMATCH',
        'baseRev',
        `Request base revision ${input.baseRev} does not match current revision ${currentRev}`,
      );
    }
    return null;
  }

  async #finishDerived(
    input: DerivedMutationInput,
    operations: readonly Operation[],
    origin: OperationEnvelope['origin'],
    idempotency: Awaited<ReturnType<typeof derivedIdempotency>>,
  ): Promise<ApplyOperationsResult> {
    const gated = this.#derivedGate(input, idempotency);
    if (gated !== null) return gated;
    if (operations.length === 0) {
      return {
        ok: true,
        dryRun: input.dryRun ?? true,
        replayed: false,
        rev: getCurrentRev(this.#session),
        txId: input.txId,
        applied: 0,
        changedIds: [],
        changedIdsTruncated: false,
      };
    }
    return this.#applyCompiledOperations(
      input,
      operations,
      origin,
      idempotency?.key,
    );
  }

  async #applyCompiledOperations(
    input: DerivedMutationInput,
    operations: readonly Operation[],
    origin: OperationEnvelope['origin'],
    idempotencyKey: string | undefined,
  ): Promise<ApplyOperationsResult> {
    const dryRun = input.dryRun ?? true;
    const currentRev = getCurrentRev(this.#session);
    const envelope: OperationEnvelope = {
      txId: input.txId,
      actor: 'agent',
      origin,
      baseRev: input.baseRev,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      ops: operations,
    };
    let result: DocumentSessionApplyResult;
    try {
      result = await this.#session.apply(envelope, { dryRun });
    } catch (error: unknown) {
      return sessionError(error, dryRun, currentRev);
    }
    if (!result.ok) {
      return result;
    }
    return transactionResult(result.transaction, dryRun, result.replayed);
  }
}
