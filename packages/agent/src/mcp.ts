import {
  createMcpHandler,
  McpServer,
  type CallToolResult,
  type McpHttpHandler,
  type ToolAnnotations,
} from '@modelcontextprotocol/server';
import { TOKEN_PRESET_IDS } from '@openchart/derive';
import { OperationEnvelopeSchema } from '@openchart/ops';
import { z } from 'zod';

import type { ProposeD2ImportInput } from './d2-proposal.js';

import type {
  ApplyBeautyPassInput,
  ApplyLayoutInput,
  ApplyOperationsInput,
  ExportTextInput,
  FindNodesInput,
  GetHistoryInput,
  GetNodesInput,
  GetOperationsInput,
  GetScreenshotInput,
  GetScreenshotResult,
  OpenChartToolKernel,
  SetTokensInput,
} from './tools.js';

const SERVER_INFO = {
  name: 'open-chart',
  version: '0.0.0',
} as const;

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} satisfies ToolAnnotations;

const APPLY_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} satisfies ToolAnnotations;

const EMPTY_INPUT_SCHEMA = z.object({}).strict();

const EXPORT_TEXT_INPUT_SCHEMA = z
  .object({
    format: z.enum(['d2', 'mermaid']),
    pageId: z.string().min(1).optional(),
  })
  .strict();

const FIND_NODE_FIELD_SCHEMA = z.enum([
  'id',
  'uid',
  'kind',
  'label',
  'pageId',
  'layerId',
  'styleId',
  'parentId',
]);

const FIND_NODES_INPUT_SCHEMA = z
  .object({
    filter: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().nullable().optional(),
    fields: z.array(FIND_NODE_FIELD_SCHEMA).max(8).optional(),
  })
  .strict();

const GET_NODES_INPUT_SCHEMA = z
  .object({
    ids: z.array(z.string()).max(50),
    depth: z.number().int().min(0).max(2).optional(),
  })
  .strict();

const GET_HISTORY_INPUT_SCHEMA = z
  .object({ limit: z.number().int().min(1).max(100).optional() })
  .strict();

const GET_OPERATIONS_INPUT_SCHEMA = z
  .object({
    txId: z.string().min(1).optional(),
    sinceRev: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict()
  .refine(
    (input) => (input.txId === undefined) !== (input.sinceRev === undefined),
    { message: 'Provide exactly one of txId or sinceRev' },
  );

const SCREENSHOT_REGION_SCHEMA = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().positive().finite(),
    height: z.number().positive().finite(),
  })
  .strict();

const GET_SCREENSHOT_INPUT_SCHEMA = z
  .object({
    pageId: z.string().min(1).optional(),
    region: SCREENSHOT_REGION_SCHEMA.optional(),
    scale: z.number().min(0.1).max(4).optional(),
  })
  .strict();

const PROPOSE_D2_IMPORT_INPUT_SCHEMA = z
  .object({
    source: z.string().min(1).max(1024 * 1024),
    pageId: z.string().min(1),
    layerId: z.string().min(1).optional(),
    nodeStyleId: z.string().min(1).optional(),
    edgeStyleId: z.string().min(1).optional(),
  })
  .strict();

const APPLY_OPERATIONS_INPUT_SCHEMA = OperationEnvelopeSchema.pick({
  txId: true,
  baseRev: true,
  idempotencyKey: true,
  ops: true,
})
  .extend({ dryRun: z.boolean().optional() })
  .strict();

const DERIVED_MUTATION_INPUT_SCHEMA = OperationEnvelopeSchema.pick({
  txId: true,
  baseRev: true,
  idempotencyKey: true,
})
  .extend({ dryRun: z.boolean().optional() })
  .strict();

const LAYOUT_MODE_SCHEMA = z.enum(['layered', 'tree', 'radial', 'force']);
const LAYOUT_DIRECTION_SCHEMA = z.enum(['RIGHT', 'DOWN']);
const TOKEN_PRESET_SCHEMA = z.enum(TOKEN_PRESET_IDS);

const APPLY_LAYOUT_INPUT_SCHEMA = DERIVED_MUTATION_INPUT_SCHEMA.extend({
  pageId: z.string().min(1),
  mode: LAYOUT_MODE_SCHEMA,
  direction: LAYOUT_DIRECTION_SCHEMA.optional(),
  spacing: z.number().positive().max(512).optional(),
  gridSize: z.number().positive().max(128).optional(),
}).strict();

const APPLY_BEAUTY_PASS_INPUT_SCHEMA = DERIVED_MUTATION_INPUT_SCHEMA.extend({
  pageId: z.string().min(1),
  layoutMode: LAYOUT_MODE_SCHEMA.optional(),
  direction: LAYOUT_DIRECTION_SCHEMA.optional(),
  presetId: TOKEN_PRESET_SCHEMA.optional(),
}).strict();

const SET_TOKENS_INPUT_SCHEMA = DERIVED_MUTATION_INPUT_SCHEMA.extend({
  presetId: TOKEN_PRESET_SCHEMA,
}).strict();

function boundedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 240 ? `${message.slice(0, 237)}...` : message;
}

function isToolFailure(result: object): boolean {
  return 'ok' in result && result.ok === false;
}

function response(result: object, isError = isToolFailure(result)): CallToolResult {
  const text = JSON.stringify(result);
  return {
    content: [{ type: 'text', text }],
    structuredContent: result,
    ...(isError ? { isError: true } : {}),
  };
}

function findNodesInput(
  input: z.infer<typeof FIND_NODES_INPUT_SCHEMA>,
): FindNodesInput {
  return {
    ...(input.filter === undefined ? {} : { filter: input.filter }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(input.fields === undefined ? {} : { fields: input.fields }),
  };
}

function exportTextInput(
  input: z.infer<typeof EXPORT_TEXT_INPUT_SCHEMA>,
): ExportTextInput {
  return {
    format: input.format,
    ...(input.pageId === undefined ? {} : { pageId: input.pageId }),
  };
}

function getNodesInput(
  input: z.infer<typeof GET_NODES_INPUT_SCHEMA>,
): GetNodesInput {
  return {
    ids: input.ids,
    ...(input.depth === undefined ? {} : { depth: input.depth }),
  };
}

function getHistoryInput(
  input: z.infer<typeof GET_HISTORY_INPUT_SCHEMA>,
): GetHistoryInput {
  return input.limit === undefined ? {} : { limit: input.limit };
}

function getOperationsInput(
  input: z.infer<typeof GET_OPERATIONS_INPUT_SCHEMA>,
): GetOperationsInput {
  return input.txId === undefined
    ? {
        sinceRev: input.sinceRev as number,
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      }
    : {
        txId: input.txId,
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      };
}

function getScreenshotInput(
  input: z.infer<typeof GET_SCREENSHOT_INPUT_SCHEMA>,
): GetScreenshotInput {
  return {
    ...(input.pageId === undefined ? {} : { pageId: input.pageId }),
    ...(input.region === undefined ? {} : { region: input.region }),
    ...(input.scale === undefined ? {} : { scale: input.scale }),
  };
}

function proposeD2ImportInput(
  input: z.infer<typeof PROPOSE_D2_IMPORT_INPUT_SCHEMA>,
): ProposeD2ImportInput {
  return {
    source: input.source,
    pageId: input.pageId,
    ...(input.layerId === undefined ? {} : { layerId: input.layerId }),
    ...(input.nodeStyleId === undefined
      ? {}
      : { nodeStyleId: input.nodeStyleId }),
    ...(input.edgeStyleId === undefined
      ? {}
      : { edgeStyleId: input.edgeStyleId }),
  };
}

function applyOperationsInput(
  input: z.infer<typeof APPLY_OPERATIONS_INPUT_SCHEMA>,
): ApplyOperationsInput {
  return {
    txId: input.txId,
    baseRev: input.baseRev,
    // Zod's inferred output includes `undefined` on nested optional fields;
    // parsing has already stripped absent keys and validated the operation union.
    ops: input.ops as ApplyOperationsInput['ops'],
    ...(input.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: input.idempotencyKey }),
    ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
  };
}

function derivedMutationFields(
  input: z.infer<typeof DERIVED_MUTATION_INPUT_SCHEMA>,
): Pick<
  ApplyOperationsInput,
  'baseRev' | 'txId' | 'idempotencyKey' | 'dryRun'
> {
  return {
    baseRev: input.baseRev,
    txId: input.txId,
    ...(input.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: input.idempotencyKey }),
    ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
  };
}

function applyLayoutInput(
  input: z.infer<typeof APPLY_LAYOUT_INPUT_SCHEMA>,
): ApplyLayoutInput {
  return {
    ...derivedMutationFields(input),
    pageId: input.pageId,
    mode: input.mode,
    ...(input.direction === undefined ? {} : { direction: input.direction }),
    ...(input.spacing === undefined ? {} : { spacing: input.spacing }),
    ...(input.gridSize === undefined ? {} : { gridSize: input.gridSize }),
  };
}

function applyBeautyPassInput(
  input: z.infer<typeof APPLY_BEAUTY_PASS_INPUT_SCHEMA>,
): ApplyBeautyPassInput {
  return {
    ...derivedMutationFields(input),
    pageId: input.pageId,
    ...(input.layoutMode === undefined
      ? {}
      : { layoutMode: input.layoutMode }),
    ...(input.direction === undefined ? {} : { direction: input.direction }),
    ...(input.presetId === undefined ? {} : { presetId: input.presetId }),
  };
}

function setTokensInput(
  input: z.infer<typeof SET_TOKENS_INPUT_SCHEMA>,
): SetTokensInput {
  return {
    ...derivedMutationFields(input),
    presetId: input.presetId,
  };
}

async function invoke(
  operation: () => object | Promise<object>,
): Promise<CallToolResult> {
  try {
    return response(await operation());
  } catch (error: unknown) {
    return response(
      {
        ok: false,
        code: 'INTERNAL_ERROR',
        message: boundedErrorMessage(error),
      },
      true,
    );
  }
}

function screenshotResponse(result: GetScreenshotResult): CallToolResult {
  if (!result.ok) {
    return response(result, true);
  }
  const { data, ...metadata } = result;
  return {
    content: [
      { type: 'text', text: JSON.stringify(metadata) },
      { type: 'image', data, mimeType: result.mimeType },
    ],
    structuredContent: metadata,
  };
}

async function invokeScreenshot(
  operation: () => Promise<GetScreenshotResult>,
): Promise<CallToolResult> {
  try {
    return screenshotResponse(await operation());
  } catch (error: unknown) {
    return response(
      {
        ok: false,
        code: 'INTERNAL_ERROR',
        message: boundedErrorMessage(error),
      },
      true,
    );
  }
}

/** Register the bounded OpenChart tool kernel on one MCP server instance. */
export function createOpenChartMcpServer(
  kernel: OpenChartToolKernel,
): McpServer {
  const server = new McpServer(SERVER_INFO);

  server.registerTool(
    'apply_beauty_pass',
    {
      title: 'Apply OpenChart Beauty Pass',
      description:
        'Compile the deterministic eleven-step Beauty Pass into one dry-run-first transaction and one undo entry.',
      inputSchema: APPLY_BEAUTY_PASS_INPUT_SCHEMA,
      annotations: APPLY_ANNOTATIONS,
    },
    (input) =>
      invoke(() => kernel.applyBeautyPass(applyBeautyPassInput(input))),
  );

  server.registerTool(
    'apply_layout',
    {
      title: 'Apply OpenChart layout',
      description:
        'Compile deterministic ELK layout for a page into one dry-run-first transaction and one undo entry.',
      inputSchema: APPLY_LAYOUT_INPUT_SCHEMA,
      annotations: APPLY_ANNOTATIONS,
    },
    (input) => invoke(() => kernel.applyLayout(applyLayoutInput(input))),
  );

  server.registerTool(
    'apply_operations',
    {
      title: 'Apply OpenChart operations',
      description:
        'Validate and preview an atomic OpenChart operation transaction; set dryRun=false to persist it.',
      inputSchema: APPLY_OPERATIONS_INPUT_SCHEMA,
      annotations: APPLY_ANNOTATIONS,
    },
    (input) =>
      invoke(() => kernel.applyOperations(applyOperationsInput(input))),
  );

  server.registerTool(
    'export',
    {
      title: 'Export OpenChart text projection',
      description:
        'Return a bounded D2 or Mermaid projection with explicit semantic-loss reporting; no file is written.',
      inputSchema: EXPORT_TEXT_INPUT_SCHEMA,
      annotations: READ_ANNOTATIONS,
    },
    (input) => invoke(() => kernel.exportText(exportTextInput(input))),
  );

  server.registerTool(
    'find_nodes',
    {
      title: 'Find OpenChart nodes',
      description:
        'Search the current document for nodes using a bounded deterministic projection.',
      inputSchema: FIND_NODES_INPUT_SCHEMA,
      annotations: READ_ANNOTATIONS,
    },
    (input) => invoke(() => kernel.findNodes(findNodesInput(input))),
  );

  server.registerTool(
    'get_document_info',
    {
      title: 'Get OpenChart document info',
      description:
        'Read compact document metadata, entity counts, page/layer summaries, and bounds.',
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: READ_ANNOTATIONS,
    },
    () => invoke(() => kernel.getDocumentInfo()),
  );

  server.registerTool(
    'get_history',
    {
      title: 'Get OpenChart history',
      description:
        'Read bounded transaction summaries and current undo/redo availability.',
      inputSchema: GET_HISTORY_INPUT_SCHEMA,
      annotations: READ_ANNOTATIONS,
    },
    (input) => invoke(() => kernel.getHistory(getHistoryInput(input))),
  );

  server.registerTool(
    'get_nodes',
    {
      title: 'Get OpenChart subgraph',
      description:
        'Read a bounded node-centered subgraph with ports, edges, and layout data.',
      inputSchema: GET_NODES_INPUT_SCHEMA,
      annotations: READ_ANNOTATIONS,
    },
    (input) => invoke(() => kernel.getNodes(getNodesInput(input))),
  );

  server.registerTool(
    'get_operations',
    {
      title: 'Get OpenChart operations',
      description:
        'Read a bounded, patch-free projection of durable journal events by transaction or revision.',
      inputSchema: GET_OPERATIONS_INPUT_SCHEMA,
      annotations: READ_ANNOTATIONS,
    },
    (input) => invoke(() => kernel.getOperations(getOperationsInput(input))),
  );

  server.registerTool(
    'get_screenshot',
    {
      title: 'Get OpenChart screenshot',
      description:
        'Render a bounded PNG of the whole page or an explicit region from the shared deterministic scene.',
      inputSchema: GET_SCREENSHOT_INPUT_SCHEMA,
      annotations: READ_ANNOTATIONS,
    },
    (input) =>
      invokeScreenshot(() => kernel.getScreenshot(getScreenshotInput(input))),
  );

  server.registerTool(
    'propose_d2_import',
    {
      title: 'Propose OpenChart D2 import',
      description:
        'Parse the canonical D2 subset and return typed operations without mutating the document; apply_operations is required to accept them.',
      inputSchema: PROPOSE_D2_IMPORT_INPUT_SCHEMA,
      annotations: READ_ANNOTATIONS,
    },
    (input) =>
      invoke(() => kernel.proposeD2Import(proposeD2ImportInput(input))),
  );

  server.registerTool(
    'redo',
    {
      title: 'Redo OpenChart transaction',
      description: 'Redo the next persisted transaction as one history action.',
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: APPLY_ANNOTATIONS,
    },
    () => invoke(() => kernel.redo()),
  );

  server.registerTool(
    'set_tokens',
    {
      title: 'Set OpenChart design tokens',
      description:
        'Compile a shipped token preset into one dry-run-first restyling transaction and one undo entry.',
      inputSchema: SET_TOKENS_INPUT_SCHEMA,
      annotations: APPLY_ANNOTATIONS,
    },
    (input) => invoke(() => kernel.setTokens(setTokensInput(input))),
  );

  server.registerTool(
    'undo',
    {
      title: 'Undo OpenChart transaction',
      description: 'Undo the latest persisted transaction as one history action.',
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: APPLY_ANNOTATIONS,
    },
    () => invoke(() => kernel.undo()),
  );

  return server;
}

/** Create the socket-free web-standard MCP handler mounted by the Tauri host. */
export function createOpenChartMcpHandler(
  kernel: OpenChartToolKernel,
): McpHttpHandler {
  return createMcpHandler(() => createOpenChartMcpServer(kernel), {
    legacy: 'reject',
    responseMode: 'json',
  });
}
