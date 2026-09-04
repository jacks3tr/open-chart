import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  loadDocument,
  writeDocumentAtomically,
} from '@openchart/persistence';
import type { OperationEnvelope } from '@openchart/ops';

import { OpenChartDocumentSession } from '../src/session.js';

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

describe('OpenChart persistent history', () => {
  it('restores undo and redo across reopen and append-before-snapshot recovery', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openchart-history-'));
    temporaryDirectories.push(directory);
    const documentPath = join(directory, 'northstar.openchart.json');
    await copyFile(fixturePath, documentPath);

    const envelope: OperationEnvelope = {
      txId: 'tx.persistent-history',
      actor: 'agent',
      origin: 'mcp',
      baseRev: 0,
      idempotencyKey: 'history:persistent-label',
      ops: [
        {
          op: 'set_node_label',
          id: 'service.ingress',
          label: 'Persistent ingress',
        },
      ],
    };

    const initial = await OpenChartDocumentSession.open(documentPath);
    await expect(initial.apply(envelope, { dryRun: false })).resolves.toMatchObject({
      ok: true,
      rev: 1,
    });
    const committedDocument = structuredClone(initial.document);

    const beforeUndo = await OpenChartDocumentSession.open(documentPath);
    expect(beforeUndo.history).toMatchObject({
      undoStack: [{ envelope: { txId: 'tx.persistent-history' } }],
      redoStack: [],
    });
    await expect(beforeUndo.undo()).resolves.toMatchObject({ ok: true, rev: 0 });
    expect(beforeUndo.document.nodes['service.ingress']?.label).toBe(
      'Ingress gateway',
    );

    // Simulate losing the snapshot rename after the undo event was durable.
    await writeDocumentAtomically(documentPath, committedDocument);
    const recoveredUndo = await loadDocument(documentPath);
    expect(recoveredUndo).toMatchObject({
      recoveredTransactions: 1,
      document: { rev: 0 },
      history: {
        undoStack: [],
        redoStack: [{ envelope: { txId: 'tx.persistent-history' } }],
      },
    });
    expect(recoveredUndo.document.nodes['service.ingress']?.label).toBe(
      'Ingress gateway',
    );
    const undoneDocument = structuredClone(recoveredUndo.document);

    const beforeRedo = await OpenChartDocumentSession.open(documentPath);
    await expect(beforeRedo.redo()).resolves.toMatchObject({ ok: true, rev: 1 });
    expect(beforeRedo.document.nodes['service.ingress']?.label).toBe(
      'Persistent ingress',
    );

    // Simulate the equivalent snapshot loss after the redo event.
    await writeDocumentAtomically(documentPath, undoneDocument);
    const recoveredRedo = await loadDocument(documentPath);
    expect(recoveredRedo).toMatchObject({
      recoveredTransactions: 1,
      document: { rev: 1 },
      history: {
        undoStack: [{ envelope: { txId: 'tx.persistent-history' } }],
        redoStack: [],
      },
    });
    expect(recoveredRedo.document.nodes['service.ingress']?.label).toBe(
      'Persistent ingress',
    );

    const final = await OpenChartDocumentSession.open(documentPath);
    await expect(final.apply(envelope, { dryRun: false })).resolves.toMatchObject({
      ok: true,
      replayed: true,
      rev: 1,
    });
    expect(final.history.undoStack).toHaveLength(1);
    await expect(final.undo()).resolves.toMatchObject({ ok: true, rev: 0 });
  });
});
