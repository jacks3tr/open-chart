import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { loadDocument } from '@openchart/persistence';
import type { Operation } from '@openchart/ops';

import {
  OpenChartDocumentSession,
  type OpenChartDocumentSessionOptions,
} from '../src/session.js';
import { renderDocumentScreenshot } from '../src/screenshot.js';
import { OpenChartToolKernel } from '../src/tools.js';

const temporaryDirectories: string[] = [];
const repositoryRoot = dirname(
  dirname(dirname(fileURLToPath(new URL('.', import.meta.url)))),
);
const fixturePath = join(
  repositoryRoot,
  'examples',
  'northstar-integration.openchart.json',
);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function openFixture(
  options: OpenChartDocumentSessionOptions = {},
): Promise<{
  readonly documentPath: string;
  readonly session: OpenChartDocumentSession;
  readonly tools: OpenChartToolKernel;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'openchart-agent-'));
  temporaryDirectories.push(directory);
  const documentPath = join(directory, 'northstar.openchart.json');
  await copyFile(fixturePath, documentPath);
  const session = await OpenChartDocumentSession.open(documentPath, options);
  return {
    documentPath,
    session,
    tools: new OpenChartToolKernel(session, renderDocumentScreenshot),
  };
}

describe('OpenChart agent document tools', () => {
  it('serves bounded reads and one dry-run-first idempotent transaction', async () => {
    const { documentPath, session, tools } = await openFixture();

    expect(tools.getDocumentInfo()).toMatchObject({
      documentId: 'document.northstar-integration',
      rev: 0,
      themePresetId: null,
      counts: {
        pages: 1,
        layers: 1,
        nodes: 6,
        ports: 14,
        edges: 7,
        styles: 7,
      },
      bounds: { x: 86, y: 196, width: 1238, height: 566 },
    });

    const firstPage = tools.findNodes({
      filter: 'service',
      limit: 2,
      fields: ['id', 'label'],
    });
    expect(firstPage).toEqual({
      items: [
        { id: 'service.audit', label: 'Replay ledger' },
        { id: 'service.ingress', label: 'Ingress gateway' },
      ],
      nextCursor: 'service.ingress',
    });
    expect(
      tools.findNodes({
        filter: 'service',
        limit: 2,
        cursor: firstPage.nextCursor,
        fields: ['id'],
      }),
    ).toEqual({
      items: [{ id: 'service.sentinel' }, { id: 'service.transform' }],
      nextCursor: null,
    });

    const subgraph = tools.getNodes({ ids: ['service.ingress'], depth: 1 });
    expect(Object.keys(subgraph.nodes)).toEqual([
      'service.audit',
      'service.ingress',
      'system.forge',
      'system.northstar',
    ]);
    expect(Object.keys(subgraph.edges)).toEqual([
      'edge.ingress-audit',
      'edge.master-ingress',
      'edge.master-target',
    ]);
    expect(subgraph).toMatchObject({ missingIds: [], truncated: false });

    const before = await readFile(documentPath, 'utf8');
    const input = {
      baseRev: 0,
      txId: 'tx.agent-label',
      idempotencyKey: 'agent:test:label',
      ops: [
        {
          op: 'set_node_label',
          id: 'service.ingress',
          label: 'Ingress gateway v2',
        },
      ] satisfies readonly Operation[],
    };

    await expect(tools.applyOperations(input)).resolves.toMatchObject({
      ok: true,
      dryRun: true,
      replayed: false,
      rev: 1,
      applied: 1,
      changedIds: ['service.ingress'],
    });
    expect(session.document.rev).toBe(0);
    expect(await readFile(documentPath, 'utf8')).toBe(before);

    await expect(
      tools.applyOperations({ ...input, dryRun: false }),
    ).resolves.toMatchObject({
      ok: true,
      dryRun: false,
      replayed: false,
      rev: 1,
      applied: 1,
      changedIds: ['service.ingress'],
    });
    await expect(
      tools.applyOperations({ ...input, dryRun: false }),
    ).resolves.toMatchObject({
      ok: true,
      dryRun: false,
      replayed: true,
      rev: 1,
    });

    const persisted = await loadDocument(documentPath);
    expect(persisted.document.nodes['service.ingress']?.label).toBe(
      'Ingress gateway v2',
    );
  });

  it('commits token, layout, and Beauty Pass derivations as retry-safe undo entries', async () => {
    const { documentPath, session, tools } = await openFixture();

    const tokensInput = {
      baseRev: 0,
      txId: 'tx.agent-tokens',
      idempotencyKey: 'agent:test:tokens',
      dryRun: false,
      presetId: 'openchart-dark' as const,
    };
    await expect(tools.setTokens(tokensInput)).resolves.toMatchObject({
      ok: true,
      replayed: false,
      rev: 1,
    });
    await expect(tools.setTokens(tokensInput)).resolves.toMatchObject({
      ok: true,
      replayed: true,
      rev: 1,
    });

    const layoutInput = {
      baseRev: 1,
      txId: 'tx.agent-layout',
      idempotencyKey: 'agent:test:layout',
      dryRun: false,
      pageId: 'page.architecture',
      mode: 'layered' as const,
      direction: 'RIGHT' as const,
    };
    await expect(tools.applyLayout(layoutInput)).resolves.toMatchObject({
      ok: true,
      replayed: false,
      rev: 2,
      applied: 1,
    });
    await expect(tools.applyLayout(layoutInput)).resolves.toMatchObject({
      ok: true,
      replayed: true,
      rev: 2,
    });

    const beautyInput = {
      baseRev: 2,
      txId: 'tx.agent-beauty',
      idempotencyKey: 'agent:test:beauty',
      dryRun: false,
      pageId: 'page.architecture',
      layoutMode: 'layered' as const,
      direction: 'RIGHT' as const,
      presetId: 'openchart-light' as const,
    };
    await expect(tools.applyBeautyPass(beautyInput)).resolves.toMatchObject({
      ok: true,
      replayed: false,
      rev: 3,
    });
    await expect(tools.applyBeautyPass(beautyInput)).resolves.toMatchObject({
      ok: true,
      replayed: true,
      rev: 3,
    });

    expect(session.history.undoStack.map(({ envelope }) => envelope.origin)).toEqual([
      'mcp',
      'layout',
      'beauty',
    ]);
    const persisted = await loadDocument(documentPath);
    expect(persisted.document).toMatchObject({
      rev: 3,
      theme: { presetId: 'openchart-light' },
      layout: { engine: 'elk.layered', derivedVersion: 'elkjs@0.12.0/openchart-2' },
    });
    await expect(session.undo()).resolves.toMatchObject({ ok: true, rev: 2 });
    expect(session.document.theme?.presetId).toBe('openchart-dark');
  });

  it('rejects disabled and destructive mutations before changing the document', async () => {
    const disabled = await openFixture({ mutationsEnabled: false });
    const beforeDisabled = await readFile(disabled.documentPath, 'utf8');
    await expect(
      disabled.tools.applyOperations({
        baseRev: 0,
        txId: 'tx.disabled',
        dryRun: false,
        ops: [
          {
            op: 'set_node_label',
            id: 'service.ingress',
            label: 'Must not change',
          },
        ],
      }),
    ).resolves.toMatchObject({ ok: false, code: 'MUTATIONS_DISABLED', rev: 0 });
    await expect(
      disabled.tools.setTokens({
        baseRev: 0,
        txId: 'tx.disabled-tokens',
        dryRun: false,
        presetId: 'openchart-dark',
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'MUTATIONS_DISABLED',
      rev: 0,
    });
    expect(await readFile(disabled.documentPath, 'utf8')).toBe(beforeDisabled);

    const guarded = await openFixture();
    const beforeGuarded = await readFile(guarded.documentPath, 'utf8');
    expect(
      guarded.tools.getNodes({
        ids: Array.from({ length: 51 }, (_, index) => `service.lookup-${index + 1}`),
        depth: 0,
      }),
    ).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
      field: 'ids',
      nodes: {},
      missingIds: [],
    });
    await expect(
      guarded.tools.applyOperations({
        baseRev: 0,
        txId: 'tx.destructive',
        dryRun: false,
        ops: Array.from({ length: 26 }, (_, index) => ({
          op: 'delete_node' as const,
          id: `service.delete-${index + 1}`,
        })),
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'DESTRUCTIVE_CONFIRMATION_REQUIRED',
      rev: 0,
      deleteCount: 26,
    });
    expect(await readFile(guarded.documentPath, 'utf8')).toBe(beforeGuarded);
  });
});
