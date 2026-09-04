import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateDocument, type OpenChartDocument } from '@openchart/ir';
import {
  OperationEngine,
  type CommittedTransaction,
  type OperationEnvelope,
} from '@openchart/ops';

import {
  backupPathFor,
  journalPathFor,
  loadDocument,
  persistCommittedTransaction,
  writeDocumentAtomically,
} from '../src/index.js';

const temporaryDirectories: string[] = [];
const uid = (value: number): string => value.toString().padStart(26, '0');

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function temporaryDocumentPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'openchart-persistence-'));
  temporaryDirectories.push(directory);
  return join(directory, 'diagram.openchart.json');
}

function baseDocument(): OpenChartDocument {
  const result = validateDocument({
    schemaVersion: 1,
    documentId: 'document.main',
    uid: uid(1),
    title: 'Persistence test',
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
    nodes: {},
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

function createEnvelope(): OperationEnvelope {
  return {
    txId: 'tx.create-api',
    actor: 'agent',
    origin: 'cli',
    baseRev: 0,
    idempotencyKey: 'fixture:create-api',
    ops: [
      {
        op: 'create_node',
        node: {
          id: 'service.api',
          uid: uid(10),
          kind: 'service',
          label: 'API',
          pageId: 'page.main',
          layerId: 'layer.main',
          styleId: 'style.service',
          data: {},
        },
      },
    ],
  };
}

function committedTransaction(document: OpenChartDocument): {
  readonly document: OpenChartDocument;
  readonly transaction: CommittedTransaction;
} {
  const engine = new OperationEngine(document);
  const result = engine.apply(createEnvelope());
  if (!result.ok) {
    throw new Error(`Operation failed: ${JSON.stringify(result.diagnostics)}`);
  }
  return { document: engine.document, transaction: result.transaction };
}

describe('Windows document persistence', () => {
  it('journals a commit and replays it over a stale document', async () => {
    const documentPath = await temporaryDocumentPath();
    const original = baseDocument();
    await writeDocumentAtomically(documentPath, original);
    const committed = committedTransaction(original);

    await persistCommittedTransaction(
      documentPath,
      committed.document,
      committed.transaction,
    );

    const journalText = await readFile(journalPathFor(documentPath), 'utf8');
    const journalEntry: unknown = JSON.parse(journalText.trim());
    expect(journalEntry).toMatchObject({
      formatVersion: 2,
      action: 'commit',
      transaction: {
        rev: 1,
        envelope: { txId: 'tx.create-api' },
      },
    });
    expect(
      typeof journalEntry === 'object' &&
        journalEntry !== null &&
        'beforeHash' in journalEntry &&
        'afterHash' in journalEntry,
    ).toBe(true);

    await writeDocumentAtomically(documentPath, original);
    const loaded = await loadDocument(documentPath);
    expect(loaded.recoveredTransactions).toBe(1);
    expect(loaded.document.nodes['service.api']?.label).toBe('API');
    expect(loaded.history).toMatchObject({
      undoStack: [{ envelope: { txId: 'tx.create-api' } }],
      redoStack: [],
    });

    const reopenedEngine = new OperationEngine(loaded.document, loaded.history);
    expect(reopenedEngine.undo()).toMatchObject({ ok: true, rev: 0 });

    const persisted: unknown = JSON.parse(await readFile(documentPath, 'utf8'));
    const validation = validateDocument(persisted);
    expect(validation.ok && validation.document.rev).toBe(1);
  });

  it('continues to load a valid version 1 journal into active history', async () => {
    const documentPath = await temporaryDocumentPath();
    const original = baseDocument();
    await writeDocumentAtomically(documentPath, original);
    const committed = committedTransaction(original);
    const legacyEntry = {
      formatVersion: 1,
      rev: committed.transaction.rev,
      committedAt: committed.transaction.committedAt,
      envelope: committed.transaction.envelope,
      forwardPatches: committed.transaction.forwardPatches,
      inversePatches: committed.transaction.inversePatches,
    };
    await writeFile(
      journalPathFor(documentPath),
      `${JSON.stringify(legacyEntry)}\n`,
      'utf8',
    );

    const loaded = await loadDocument(documentPath);
    expect(loaded.document.nodes['service.api']?.label).toBe('API');
    expect(loaded.history).toMatchObject({
      undoStack: [{ envelope: { txId: 'tx.create-api' } }],
      redoStack: [],
    });
  });

  it('rejects a journal revision conflict without changing the document', async () => {
    const documentPath = await temporaryDocumentPath();
    const original = baseDocument();
    await writeDocumentAtomically(documentPath, original);
    const committed = committedTransaction(original);
    const poisonedEntry = {
      formatVersion: 1,
      rev: 2,
      committedAt: committed.transaction.committedAt,
      envelope: { ...committed.transaction.envelope, baseRev: 1 },
      forwardPatches: committed.transaction.forwardPatches,
      inversePatches: committed.transaction.inversePatches,
    };
    await writeFile(
      journalPathFor(documentPath),
      `${JSON.stringify(poisonedEntry)}\n`,
      'utf8',
    );
    const before = await readFile(documentPath, 'utf8');

    await expect(loadDocument(documentPath)).rejects.toMatchObject({
      code: 'JOURNAL_REPLAY_FAILED',
    });
    expect(await readFile(documentPath, 'utf8')).toBe(before);
  });

  it('repairs a corrupt primary snapshot from the last known good backup and journal', async () => {
    const documentPath = await temporaryDocumentPath();
    const original = baseDocument();
    await writeDocumentAtomically(documentPath, original);
    const committed = committedTransaction(original);
    await persistCommittedTransaction(
      documentPath,
      committed.document,
      committed.transaction,
    );

    await writeFile(documentPath, '{corrupt', 'utf8');
    const loaded = await loadDocument(documentPath);

    expect(loaded).toMatchObject({
      recoveredFromBackup: true,
      recoveredTransactions: 1,
      document: { rev: 1, nodes: { 'service.api': { label: 'API' } } },
    });
    expect(
      validateDocument(JSON.parse(await readFile(documentPath, 'utf8'))).ok,
    ).toBe(true);
    expect(
      validateDocument(JSON.parse(await readFile(backupPathFor(documentPath), 'utf8'))),
    ).toMatchObject({ ok: true, document: { rev: 0 } });
  });

  it('does not claim recovery when both the primary and backup are corrupt', async () => {
    const documentPath = await temporaryDocumentPath();
    const original = baseDocument();
    await writeDocumentAtomically(documentPath, original);
    await writeDocumentAtomically(documentPath, { ...original, title: 'Second snapshot' });
    await writeFile(documentPath, '{corrupt-primary', 'utf8');
    await writeFile(backupPathFor(documentPath), '{corrupt-backup', 'utf8');

    await expect(loadDocument(documentPath)).rejects.toMatchObject({
      code: 'DOCUMENT_INVALID',
    });
    expect(await readFile(documentPath, 'utf8')).toBe('{corrupt-primary');
  });
});
