import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';

import { loadDocument } from '@openchart/persistence';

import {
  createOpenChartMcpHandler,
  createOpenChartMcpServer,
} from '../src/mcp.js';
import { OpenChartDocumentSession } from '../src/session.js';
import { renderDocumentScreenshot } from '../src/screenshot.js';
import { OpenChartToolKernel } from '../src/tools.js';

const temporaryDirectories: string[] = [];
const closeCallbacks: Array<() => Promise<void>> = [];
const repositoryRoot = dirname(
  dirname(dirname(fileURLToPath(new URL('.', import.meta.url)))),
);
const fixturePath = join(
  repositoryRoot,
  'examples',
  'northstar-integration.openchart.json',
);

afterEach(async () => {
  await Promise.allSettled(closeCallbacks.splice(0).map((close) => close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function connectClient(): Promise<{
  readonly client: Client;
  readonly documentPath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'openchart-mcp-'));
  temporaryDirectories.push(directory);
  const documentPath = join(directory, 'northstar.openchart.json');
  await copyFile(fixturePath, documentPath);

  const session = await OpenChartDocumentSession.open(documentPath);
  const server = createOpenChartMcpServer(
    new OpenChartToolKernel(session, renderDocumentScreenshot),
  );
  const client = new Client({ name: 'openchart-contract-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closeCallbacks.push(async () => client.close(), async () => server.close());
  return { client, documentPath };
}

describe('OpenChart MCP contract', () => {
  it('lists and invokes the shared bounded read/apply tools through a real client', async () => {
    const { client, documentPath } = await connectClient();

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      'apply_beauty_pass',
      'apply_layout',
      'apply_operations',
      'export',
      'find_nodes',
      'get_document_info',
      'get_history',
      'get_nodes',
      'get_operations',
      'get_screenshot',
      'propose_d2_import',
      'redo',
      'set_tokens',
      'undo',
    ]);
    expect(
      listed.tools.find((tool) => tool.name === 'get_document_info')?.annotations,
    ).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(
      listed.tools.find((tool) => tool.name === 'apply_operations')?.annotations,
    ).toMatchObject({ readOnlyHint: false, destructiveHint: true });

    const info = await client.callTool({ name: 'get_document_info', arguments: {} });
    expect(info.isError).not.toBe(true);
    expect(info.structuredContent).toMatchObject({
      documentId: 'document.northstar-integration',
      rev: 0,
      counts: { nodes: 6, edges: 7 },
    });

    const exported = await client.callTool({
      name: 'export',
      arguments: { format: 'mermaid', pageId: 'page.architecture' },
    });
    expect(exported.isError).not.toBe(true);
    expect(exported.structuredContent).toMatchObject({
      format: 'mermaid',
      pageId: 'page.architecture',
      mimeType: 'text/plain',
    });
    const exportContent = exported.structuredContent as {
      readonly content?: unknown;
      readonly losses?: unknown;
    };
    expect(exportContent.content).toContain('flowchart LR');
    expect(exportContent.losses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PORTS_OMITTED', count: 14 }),
      ]),
    );

    const d2Exported = await client.callTool({
      name: 'export',
      arguments: { format: 'd2', pageId: 'page.architecture' },
    });
    const d2Content = (d2Exported.structuredContent as { content?: unknown })
      .content;
    if (typeof d2Content !== 'string') throw new Error('D2 export returned no text');
    const proposed = await client.callTool({
      name: 'propose_d2_import',
      arguments: {
        pageId: 'page.architecture',
        source: d2Content.replace(
          '"service.ingress": "Ingress gateway"',
          '"service.ingress": "MCP ingress gateway"',
        ),
      },
    });
    expect(proposed.isError).not.toBe(true);
    expect(proposed.structuredContent).toMatchObject({
      ok: true,
      baseRev: 0,
      operationCount: 1,
      updateCount: 1,
      operations: [
        {
          op: 'set_node_label',
          id: 'service.ingress',
          label: 'MCP ingress gateway',
        },
      ],
    });
    expect((await loadDocument(documentPath)).document.rev).toBe(0);
    const proposedOperations = (
      proposed.structuredContent as { operations?: unknown }
    ).operations;
    if (!Array.isArray(proposedOperations)) {
      throw new Error('D2 proposal returned no operation array');
    }

    const wholePageScreenshot = await client.callTool({
      name: 'get_screenshot',
      arguments: { scale: 0.25 },
    });
    expect(wholePageScreenshot.isError).not.toBe(true);
    expect(wholePageScreenshot.structuredContent).toMatchObject({
      ok: true,
      mimeType: 'image/png',
      pageId: 'page.architecture',
      width: 360,
      height: 230,
    });
    const wholePageImage = wholePageScreenshot.content.find(
      (item) => item.type === 'image',
    );
    if (wholePageImage?.type !== 'image') {
      throw new Error('get_screenshot did not return image content');
    }
    expect(
      Buffer.from(wholePageImage.data, 'base64')
        .subarray(0, 8)
        .toString('hex'),
    ).toBe('89504e470d0a1a0a');

    const regionScreenshot = await client.callTool({
      name: 'get_screenshot',
      arguments: {
        region: { x: 80, y: 160, width: 640, height: 400 },
        scale: 0.5,
      },
    });
    expect(regionScreenshot.isError).not.toBe(true);
    expect(regionScreenshot.structuredContent).toMatchObject({
      ok: true,
      width: 320,
      height: 200,
      region: { x: 80, y: 160, width: 640, height: 400 },
    });

    const invalidScreenshot = await client.callTool({
      name: 'get_screenshot',
      arguments: {
        region: { x: 1_400, y: 0, width: 100, height: 100 },
      },
    });
    expect(invalidScreenshot.isError).toBe(true);
    expect(invalidScreenshot.structuredContent).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
      field: 'region',
    });

    for (const request of [
      {
        name: 'set_tokens',
        arguments: {
          baseRev: 0,
          txId: 'tx.mcp-token-preview',
          idempotencyKey: 'mcp-contract:token-preview',
          presetId: 'openchart-dark',
        },
      },
      {
        name: 'apply_layout',
        arguments: {
          baseRev: 0,
          txId: 'tx.mcp-layout-preview',
          idempotencyKey: 'mcp-contract:layout-preview',
          pageId: 'page.architecture',
          mode: 'layered',
          direction: 'RIGHT',
        },
      },
      {
        name: 'apply_beauty_pass',
        arguments: {
          baseRev: 0,
          txId: 'tx.mcp-beauty-preview',
          idempotencyKey: 'mcp-contract:beauty-preview',
          pageId: 'page.architecture',
          layoutMode: 'layered',
          direction: 'RIGHT',
          presetId: 'openchart-light',
        },
      },
    ] as const) {
      const previewResult = await client.callTool(request);
      expect(previewResult.isError).not.toBe(true);
      expect(previewResult.structuredContent).toMatchObject({
        ok: true,
        dryRun: true,
        replayed: false,
        rev: 1,
      });
    }
    expect((await loadDocument(documentPath)).document.rev).toBe(0);

    const applyArguments = {
      baseRev: 0,
      txId: 'tx.mcp-contract',
      idempotencyKey: 'mcp-contract:label',
      ops: proposedOperations,
    };
    const preview = await client.callTool({
      name: 'apply_operations',
      arguments: applyArguments,
    });
    expect(preview.isError).not.toBe(true);
    expect(preview.structuredContent).toMatchObject({
      ok: true,
      dryRun: true,
      rev: 1,
    });
    expect((await loadDocument(documentPath)).document.rev).toBe(0);

    const committed = await client.callTool({
      name: 'apply_operations',
      arguments: { ...applyArguments, dryRun: false },
    });
    expect(committed.isError).not.toBe(true);
    expect(committed.structuredContent).toMatchObject({
      ok: true,
      dryRun: false,
      replayed: false,
      rev: 1,
    });
    const persisted = await loadDocument(documentPath);
    expect(persisted.document.nodes['service.ingress']?.label).toBe(
      'MCP ingress gateway',
    );

    const rejected = await client.callTool({
      name: 'apply_operations',
      arguments: {
        ...applyArguments,
        txId: 'tx.mcp-stale',
        idempotencyKey: 'mcp-contract:stale',
        dryRun: false,
      },
    });
    expect(rejected.isError).toBe(true);
    expect(rejected.structuredContent).toMatchObject({
      ok: false,
      code: 'OPERATION_REJECTED',
      rev: 1,
    });

    const history = await client.callTool({
      name: 'get_history',
      arguments: {},
    });
    expect(history.structuredContent).toMatchObject({
      canUndo: true,
      canRedo: false,
      undoDepth: 1,
      undo: [{ txId: 'tx.mcp-contract', operationCount: 1 }],
    });

    const undone = await client.callTool({ name: 'undo', arguments: {} });
    expect(undone.isError).not.toBe(true);
    expect(undone.structuredContent).toMatchObject({
      ok: true,
      direction: 'undo',
      rev: 0,
    });
    expect((await loadDocument(documentPath)).document.nodes['service.ingress']?.label).toBe(
      'Ingress gateway',
    );

    const redone = await client.callTool({ name: 'redo', arguments: {} });
    expect(redone.isError).not.toBe(true);
    expect(redone.structuredContent).toMatchObject({
      ok: true,
      direction: 'redo',
      rev: 1,
    });
    expect((await loadDocument(documentPath)).document.nodes['service.ingress']?.label).toBe(
      'MCP ingress gateway',
    );

    for (const arguments_ of [
      { txId: 'tx.mcp-contract' },
      { sinceRev: 0 },
    ]) {
      const operations = await client.callTool({
        name: 'get_operations',
        arguments: arguments_,
      });
      expect(operations.isError).not.toBe(true);
      expect(operations.structuredContent).toMatchObject({
        truncated: false,
        events: [
          {
            sequence: 1,
            action: 'commit',
            rev: 1,
            envelope: {
              txId: 'tx.mcp-contract',
              ops: [{ op: 'set_node_label', id: 'service.ingress' }],
            },
          },
          { sequence: 2, action: 'undo' },
          { sequence: 3, action: 'redo' },
        ],
      });
    }
  });

  it('serves the same registry through the socket-free HTTP handler', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openchart-mcp-http-'));
    temporaryDirectories.push(directory);
    const documentPath = join(directory, 'northstar.openchart.json');
    await copyFile(fixturePath, documentPath);

    const session = await OpenChartDocumentSession.open(documentPath);
    const handler = createOpenChartMcpHandler(
      new OpenChartToolKernel(session, renderDocumentScreenshot),
    );
    const transport = new StreamableHTTPClientTransport(
      new URL('http://openchart.local/mcp'),
      {
        fetch: (input, init) => handler.fetch(new Request(input, init)),
      },
    );
    const client = new Client(
      {
        name: 'openchart-http-contract-test',
        version: '1.0.0',
      },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    await client.connect(transport);
    closeCallbacks.push(async () => client.close(), async () => handler.close());

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      'apply_beauty_pass',
      'apply_layout',
      'apply_operations',
      'export',
      'find_nodes',
      'get_document_info',
      'get_history',
      'get_nodes',
      'get_operations',
      'get_screenshot',
      'propose_d2_import',
      'redo',
      'set_tokens',
      'undo',
    ]);
    const info = await client.callTool({
      name: 'get_document_info',
      arguments: {},
    });
    expect(info.isError).not.toBe(true);
    expect(info.structuredContent).toMatchObject({
      documentId: 'document.northstar-integration',
      rev: 0,
    });
  });
});
