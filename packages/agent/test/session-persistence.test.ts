import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { validateDocument, type OpenChartDocument } from '@openchart/ir';
import type {
  CommittedTransaction,
  OperationEnvelope,
} from '@openchart/ops';

const persistenceState = vi.hoisted(() => ({
  base: undefined as OpenChartDocument | undefined,
  durable: undefined as OpenChartDocument | undefined,
  transaction: undefined as CommittedTransaction | undefined,
}));

vi.mock('@openchart/persistence', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    loadDocument: vi.fn(() => {
      const document = persistenceState.durable ?? persistenceState.base;
      if (document === undefined) {
        throw new Error('Test persistence state was not initialized');
      }
      return {
        document: structuredClone(document),
        recoveredFromBackup: false,
        recoveredTransactions: persistenceState.durable === undefined ? 0 : 1,
        history: {
          undoStack:
            persistenceState.transaction === undefined
              ? []
              : [structuredClone(persistenceState.transaction)],
          redoStack: [],
        },
      };
    }),
    persistCommittedTransaction: vi.fn(
      (
        _documentPath: string,
        document: OpenChartDocument,
        transaction: CommittedTransaction,
      ) => {
        persistenceState.durable = structuredClone(document);
        persistenceState.transaction = structuredClone(transaction);
        throw new Error(
          'Snapshot rename failed after the journal append became durable',
        );
      },
    ),
  };
});

import { loadDocument } from '@openchart/persistence';

import { OpenChartDocumentSession } from '../src/session.js';

const repositoryRoot = dirname(
  dirname(dirname(fileURLToPath(new URL('.', import.meta.url)))),
);
const fixturePath = join(
  repositoryRoot,
  'examples',
  'northstar-integration.openchart.json',
);

beforeEach(async () => {
  persistenceState.durable = undefined;
  persistenceState.transaction = undefined;
  const parsed: unknown = JSON.parse(await readFile(fixturePath, 'utf8'));
  const validation = validateDocument(parsed);
  if (!validation.ok) {
    throw new Error(`Invalid test fixture: ${JSON.stringify(validation.diagnostics)}`);
  }
  persistenceState.base = validation.document;
  vi.mocked(loadDocument).mockClear();
});

describe('OpenChartDocumentSession persistence reconciliation', () => {
  it('keeps a journal-durable transaction when the snapshot write reports failure', async () => {
    const session = await OpenChartDocumentSession.open('mock.openchart.json');
    const envelope: OperationEnvelope = {
      txId: 'tx.recovered-commit',
      actor: 'agent',
      origin: 'mcp',
      baseRev: 0,
      idempotencyKey: 'agent:recovered-commit',
      ops: [
        {
          op: 'set_node_label',
          id: 'service.ingress',
          label: 'Journal-recovered ingress',
        },
      ],
    };

    await expect(session.apply(envelope, { dryRun: false })).resolves.toMatchObject({
      ok: true,
      dryRun: false,
      replayed: false,
      rev: 1,
    });
    expect(session.document.rev).toBe(1);
    expect(session.document.nodes['service.ingress']?.label).toBe(
      'Journal-recovered ingress',
    );
    expect(loadDocument).toHaveBeenCalledTimes(2);
  });
});
