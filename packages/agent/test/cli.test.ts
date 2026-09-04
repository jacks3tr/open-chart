import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { validateDocument, type OpenChartDocument } from '@openchart/ir';
import { journalPathFor, loadDocument, writeDocumentAtomically } from '@openchart/persistence';
import type { OperationEnvelope } from '@openchart/ops';

interface CliRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const temporaryDirectories: string[] = [];
const repositoryRoot = dirname(
  dirname(dirname(fileURLToPath(new URL('.', import.meta.url)))),
);
const cliPath = join(repositoryRoot, 'packages', 'agent', 'src', 'cli.ts');
const uid = (value: number): string => value.toString().padStart(26, '0');

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function makePaths(): Promise<{
  readonly documentPath: string;
  readonly operationsPath: string;
  readonly outputPath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'openchart-cli-'));
  temporaryDirectories.push(directory);
  return {
    documentPath: join(directory, 'diagram.openchart.json'),
    operationsPath: join(directory, 'ops.json'),
    outputPath: join(directory, 'diagram.svg'),
  };
}

function fiftyNodeDocument(): OpenChartDocument {
  const nodes = Object.fromEntries(
    Array.from({ length: 50 }, (_, index) => {
      const ordinal = index + 1;
      const id = `service.node-${ordinal.toString().padStart(2, '0')}`;
      return [
        id,
        {
          id,
          uid: uid(ordinal + 10),
          kind: 'service',
          label: `Service ${ordinal}`,
          pageId: 'page.main',
          layerId: 'layer.main',
          styleId: 'style.service',
          data: {},
        },
      ];
    }),
  );
  const result = validateDocument({
    schemaVersion: 1,
    documentId: 'document.main',
    uid: uid(1),
    title: 'CLI test',
    rev: 0,
    pages: {
      'page.main': {
        id: 'page.main',
        uid: uid(2),
        name: 'Architecture',
        layerIds: ['layer.main'],
      },
    },
    layers: {
      'layer.main': {
        id: 'layer.main',
        uid: uid(3),
        name: 'Systems',
        pageId: 'page.main',
        visible: true,
        locked: false,
      },
    },
    nodes,
    ports: {},
    edges: {},
    styles: {
      'style.service': {
        id: 'style.service',
        uid: uid(4),
        role: 'service/compute',
        tokens: {},
      },
    },
    layout: { overrides: {}, derived: null },
    meta: {
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    },
  });
  if (!result.ok) {
    throw new Error(`Invalid test fixture: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.document;
}

function createNode(id: string, uidValue: number): OperationEnvelope['ops'][number] {
  return {
    op: 'create_node',
    node: {
      id,
      uid: uid(uidValue),
      kind: 'service',
      label: 'New service',
      pageId: 'page.main',
      layerId: 'layer.main',
      styleId: 'style.service',
      data: {},
    },
  };
}

async function runCli(args: readonly string[]): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', cliPath, ...args],
      { cwd: repositoryRoot, windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (signal !== null) {
        reject(new Error(`CLI terminated by ${signal}`));
        return;
      }
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

describe('openchart apply', () => {
  it('applies an operation envelope to a real 50-node document', async () => {
    const paths = await makePaths();
    await writeDocumentAtomically(paths.documentPath, fiftyNodeDocument());
    const envelope: OperationEnvelope = {
      txId: 'tx.cli-success',
      actor: 'agent',
      origin: 'cli',
      baseRev: 0,
      idempotencyKey: 'cli:success',
      ops: [createNode('service.node-51', 100)],
    };
    await writeFile(paths.operationsPath, `${JSON.stringify(envelope)}\n`, 'utf8');

    const run = await runCli(['apply', paths.operationsPath, paths.documentPath]);
    expect(run).toMatchObject({ exitCode: 0, stderr: '' });
    const output: unknown = JSON.parse(run.stdout);
    expect(output).toMatchObject({
      ok: true,
      rev: 1,
      replayed: false,
      recoveredFromBackup: false,
    });

    const replay = await runCli(['apply', paths.operationsPath, paths.documentPath]);
    expect(replay).toMatchObject({ exitCode: 0, stderr: '' });
    expect(JSON.parse(replay.stdout)).toMatchObject({
      ok: true,
      rev: 1,
      replayed: true,
    });

    const loaded = await loadDocument(paths.documentPath);
    expect(Object.keys(loaded.document.nodes)).toHaveLength(51);
    expect(loaded.document.nodes['service.node-51']?.label).toBe('New service');
    expect(await readFile(journalPathFor(paths.documentPath), 'utf8')).toContain(
      'tx.cli-success',
    );
  });

  it('returns a structured collision and leaves the document byte-identical', async () => {
    const paths = await makePaths();
    await writeDocumentAtomically(paths.documentPath, fiftyNodeDocument());
    const envelope: OperationEnvelope = {
      txId: 'tx.cli-failure',
      actor: 'agent',
      origin: 'cli',
      baseRev: 0,
      idempotencyKey: 'cli:failure',
      ops: [
        createNode('service.duplicate', 100),
        createNode('service.duplicate', 101),
      ],
    };
    await writeFile(paths.operationsPath, `${JSON.stringify(envelope)}\n`, 'utf8');
    const before = await readFile(paths.documentPath, 'utf8');

    const run = await runCli(['apply', paths.operationsPath, paths.documentPath]);
    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe('');
    const failure: unknown = JSON.parse(run.stderr);
    expect(failure).toMatchObject({
      ok: false,
      code: 'OPERATION_REJECTED',
      diagnostics: [{ code: 'ID_COLLISION', path: 'ops.1.node.id' }],
    });
    expect(await readFile(paths.documentPath, 'utf8')).toBe(before);
    await expect(readFile(journalPathFor(paths.documentPath), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

describe('openchart export', () => {
  it('writes a new export atomically and never mutates or overwrites source data', async () => {
    const paths = await makePaths();
    await writeDocumentAtomically(paths.documentPath, fiftyNodeDocument());
    const sourceBefore = await readFile(paths.documentPath, 'utf8');

    const run = await runCli([
      'export',
      'svg',
      paths.documentPath,
      paths.outputPath,
      '--include-ir',
    ]);
    expect(run).toMatchObject({ exitCode: 0, stderr: '' });
    expect(JSON.parse(run.stdout)).toMatchObject({
      ok: true,
      format: 'svg',
      mimeType: 'image/svg+xml',
      embeddedIr: true,
      outputPath: paths.outputPath,
    });
    const exported = await readFile(paths.outputPath, 'utf8');
    expect(exported).toContain('data-openchart-ir=');
    expect(await readFile(paths.documentPath, 'utf8')).toBe(sourceBefore);

    const second = await runCli([
      'export',
      'svg',
      paths.documentPath,
      paths.outputPath,
    ]);
    expect(second.exitCode).toBe(1);
    expect(JSON.parse(second.stderr)).toMatchObject({
      ok: false,
      code: 'EXPORT_WRITE_FAILED',
    });
    expect(await readFile(paths.outputPath, 'utf8')).toBe(exported);
  });
});

describe('openchart mcp --stdio', () => {
  it('serves the bounded tool registry to a real spawned MCP client', async () => {
    const paths = await makePaths();
    await writeDocumentAtomically(paths.documentPath, fiftyNodeDocument());

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        '--import',
        'tsx',
        cliPath,
        'mcp',
        '--stdio',
        paths.documentPath,
      ],
      cwd: repositoryRoot,
      stderr: 'pipe',
    });
    let stderr = '';
    transport.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    const client = new Client(
      { name: 'openchart-cli-contract-test', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );

    let childPid: number | null = null;
    try {
      await client.connect(transport);
      childPid = transport.pid;
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
      expect(info.structuredContent).toMatchObject({
        documentId: 'document.main',
        rev: 0,
        counts: { nodes: 50 },
      });
    } finally {
      await client.close();
    }

    expect(stderr).toBe('');
    expect(childPid).not.toBeNull();
    expect(() => process.kill(childPid ?? -1, 0)).toThrow();
  });
});
