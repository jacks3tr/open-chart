import {
  OperationEngine,
  validateOperationEnvelope,
  type ApplyResult,
  type CommittedTransaction,
  type OperationHistoryState,
  type OperationDiagnostic,
  type OperationEnvelope,
} from '@openchart/ops';
import { isDeepStrictEqual } from 'node:util';
import {
  loadDocument,
  persistCommittedTransaction,
  persistHistoryTransition,
  PersistenceError,
  readJournalOperations,
  type ReadJournalOperationsOptions,
  type ReadJournalOperationsResult,
} from '@openchart/persistence';
import type { OpenChartDocument } from '@openchart/ir';

const MAX_ERROR_DETAIL_LENGTH = 240;
const MAX_DIAGNOSTICS_IN_MESSAGE = 3;

export interface OpenChartDocumentSessionOptions {
  /** Reject all operation envelopes, including previews. */
  readonly readOnly?: boolean;
  /** Reject all operation envelopes, including previews. */
  readonly mutationsEnabled?: boolean;
}

export type DocumentSessionApplyFailureCode =
  | 'READ_ONLY'
  | 'MUTATIONS_DISABLED'
  | 'OPERATION_REJECTED'
  | 'PERSISTENCE_FAILED';

export interface DocumentSessionApplyOptions {
  readonly dryRun: boolean;
}

export interface DocumentSessionApplySuccess {
  readonly ok: true;
  readonly dryRun: boolean;
  readonly replayed: boolean;
  readonly rev: number;
  readonly transaction: CommittedTransaction;
}

export interface DocumentSessionApplyFailure {
  readonly ok: false;
  readonly dryRun: boolean;
  readonly rev: number;
  readonly code: DocumentSessionApplyFailureCode;
  readonly message: string;
  readonly diagnostics?: readonly OperationDiagnostic[];
  readonly persistenceCode?: PersistenceError['code'];
}

export type DocumentSessionApplyResult =
  | DocumentSessionApplySuccess
  | DocumentSessionApplyFailure;

export type DocumentSessionHistoryDirection = 'undo' | 'redo';

export interface DocumentSessionHistorySuccess {
  readonly ok: true;
  readonly direction: DocumentSessionHistoryDirection;
  readonly rev: number;
  readonly transaction: CommittedTransaction;
}

export interface DocumentSessionHistoryFailure {
  readonly ok: false;
  readonly direction: DocumentSessionHistoryDirection;
  readonly rev: number;
  readonly code: DocumentSessionApplyFailureCode;
  readonly message: string;
  readonly diagnostics?: readonly OperationDiagnostic[];
  readonly persistenceCode?: PersistenceError['code'];
}

export type DocumentSessionHistoryResult =
  | DocumentSessionHistorySuccess
  | DocumentSessionHistoryFailure;

function boundedDetail(value: unknown): string {
  let detail: string;
  try {
    detail = value instanceof Error ? value.message : String(value);
  } catch {
    detail = 'Unknown error';
  }
  if (detail.length <= MAX_ERROR_DETAIL_LENGTH) {
    return detail;
  }
  return `${detail.slice(0, MAX_ERROR_DETAIL_LENGTH - 3)}...`;
}

function diagnosticsMessage(diagnostics: readonly OperationDiagnostic[]): string {
  if (diagnostics.length === 0) {
    return 'Operation rejected';
  }
  const details = diagnostics
    .slice(0, MAX_DIAGNOSTICS_IN_MESSAGE)
    .map(({ code, path, message }) => `${code} at ${path || '$'}: ${boundedDetail(message)}`);
  if (diagnostics.length > MAX_DIAGNOSTICS_IN_MESSAGE) {
    details.push(`and ${diagnostics.length - MAX_DIAGNOSTICS_IN_MESSAGE} more diagnostic(s)`);
  }
  return boundedDetail(details.join('; '));
}

function failure(
  code: DocumentSessionApplyFailureCode,
  dryRun: boolean,
  rev: number,
  message: string,
  extras: Pick<DocumentSessionApplyFailure, 'diagnostics' | 'persistenceCode'> = {},
): DocumentSessionApplyFailure {
  return {
    ok: false,
    dryRun,
    rev,
    code,
    message: boundedDetail(message),
    ...(extras.diagnostics === undefined
      ? {}
      : { diagnostics: extras.diagnostics }),
    ...(extras.persistenceCode === undefined
      ? {}
      : { persistenceCode: extras.persistenceCode }),
  };
}

function operationFailure(
  dryRun: boolean,
  rev: number,
  result: Extract<ApplyResult, { readonly ok: false }>,
): DocumentSessionApplyFailure {
  return failure('OPERATION_REJECTED', dryRun, rev, diagnosticsMessage(result.diagnostics), {
    diagnostics: result.diagnostics,
  });
}

function historyFailure(
  direction: DocumentSessionHistoryDirection,
  code: DocumentSessionApplyFailureCode,
  rev: number,
  message: string,
  extras: Pick<DocumentSessionHistoryFailure, 'diagnostics' | 'persistenceCode'> = {},
): DocumentSessionHistoryFailure {
  return {
    ok: false,
    direction,
    rev,
    code,
    message: boundedDetail(message),
    ...(extras.diagnostics === undefined
      ? {}
      : { diagnostics: extras.diagnostics }),
    ...(extras.persistenceCode === undefined
      ? {}
      : { persistenceCode: extras.persistenceCode }),
  };
}

/**
 * The semantic owner shared by the GUI, CLI, and agent adapters.
 *
 * This class deliberately wraps the existing operation engine and persistence
 * functions. It does not maintain a second document or patch representation.
 */
export class OpenChartDocumentSession {
  #documentPath: string;
  #engine: OperationEngine;
  #recoveredFromBackup: boolean;
  #recoveredTransactions: number;
  #readOnly: boolean;
  #mutationsEnabled: boolean;
  #persistenceFault: string | undefined;
  #mutationTail: Promise<void> = Promise.resolve();

  private constructor(
    documentPath: string,
    document: OpenChartDocument,
    recoveredFromBackup: boolean,
    recoveredTransactions: number,
    history: OperationHistoryState,
    options: OpenChartDocumentSessionOptions,
  ) {
    this.#documentPath = documentPath;
    this.#engine = new OperationEngine(document, history);
    this.#recoveredFromBackup = recoveredFromBackup;
    this.#recoveredTransactions = recoveredTransactions;
    this.#readOnly = options.readOnly ?? false;
    this.#mutationsEnabled = options.mutationsEnabled ?? true;
    this.#persistenceFault = undefined;
  }

  public static async open(
    documentPath: string,
    options: OpenChartDocumentSessionOptions = {},
  ): Promise<OpenChartDocumentSession> {
    const loaded = await loadDocument(documentPath);
    return new OpenChartDocumentSession(
      documentPath,
      loaded.document,
      loaded.recoveredFromBackup,
      loaded.recoveredTransactions,
      loaded.history,
      options,
    );
  }

  public get documentPath(): string {
    return this.#documentPath;
  }

  /** The operation engine exposes a recursively frozen immutable snapshot. */
  public get document(): OpenChartDocument {
    return this.#engine.document;
  }

  public get recoveredTransactions(): number {
    return this.#recoveredTransactions;
  }

  public get recoveredFromBackup(): boolean {
    return this.#recoveredFromBackup;
  }

  public get readOnly(): boolean {
    return this.#readOnly;
  }

  public get mutationsEnabled(): boolean {
    return this.#mutationsEnabled;
  }

  public get persistenceFault(): string | undefined {
    return this.#persistenceFault;
  }

  public get history(): OperationHistoryState {
    return this.#engine.history;
  }

  public async getOperations(
    options: ReadJournalOperationsOptions,
  ): Promise<ReadJournalOperationsResult> {
    return this.#withMutationLock(() =>
      readJournalOperations(this.#documentPath, options),
    );
  }

  /**
   * Apply one validated operation envelope, optionally as an isolated preview.
   * Committed calls are serialized around both engine mutation and persistence.
   */
  public async apply(
    envelope: OperationEnvelope,
    { dryRun }: DocumentSessionApplyOptions = { dryRun: false },
  ): Promise<DocumentSessionApplyResult> {
    if (this.#readOnly) {
      return failure(
        'READ_ONLY',
        dryRun,
        this.#engine.document.rev,
        'This document session is read-only',
      );
    }
    if (!this.#mutationsEnabled) {
      return failure(
        'MUTATIONS_DISABLED',
        dryRun,
        this.#engine.document.rev,
        'Mutations are disabled for this document session',
      );
    }
    if (this.#persistenceFault !== undefined) {
      return failure(
        'PERSISTENCE_FAILED',
        dryRun,
        this.#engine.document.rev,
        this.#persistenceFault,
      );
    }

    const validation = validateOperationEnvelope(envelope);
    if (!validation.ok) {
      return failure(
        'OPERATION_REJECTED',
        dryRun,
        this.#engine.document.rev,
        diagnosticsMessage(validation.diagnostics),
        { diagnostics: validation.diagnostics },
      );
    }

    if (dryRun) {
      const isolatedEngine = new OperationEngine(this.#engine.document);
      const result = isolatedEngine.apply(validation.envelope);
      if (!result.ok) {
        return operationFailure(true, this.#engine.document.rev, result);
      }
      return {
        ok: true,
        dryRun: true,
        replayed: result.replayed,
        rev: result.rev,
        transaction: result.transaction,
      };
    }

    return this.#withMutationLock(async () => {
      if (this.#persistenceFault !== undefined) {
        return failure(
          'PERSISTENCE_FAILED',
          false,
          this.#engine.document.rev,
          this.#persistenceFault,
        );
      }

      const before = this.#engine.document;
      const beforeHistory = this.#engine.history;
      const result = this.#engine.apply(validation.envelope);
      if (!result.ok) {
        return operationFailure(false, before.rev, result);
      }
      if (result.replayed) {
        // Replays are already durable and must never append a duplicate journal entry.
        return {
          ok: true,
          dryRun: false,
          replayed: true,
          rev: result.rev,
          transaction: result.transaction,
        };
      }

      try {
        await persistCommittedTransaction(
          this.#documentPath,
          this.#engine.document,
          result.transaction,
        );
      } catch (error: unknown) {
        const persistenceCode =
          error instanceof PersistenceError ? error.code : undefined;
        const candidate = this.#engine.document;

        let reconciled: Awaited<ReturnType<typeof loadDocument>>;
        try {
          reconciled = await loadDocument(this.#documentPath);
        } catch (reconciliationError: unknown) {
          const message =
            `Could not persist transaction: ${boundedDetail(error)}; ` +
            `durability reconciliation failed: ${boundedDetail(reconciliationError)}`;
          this.#persistenceFault = boundedDetail(message);
          return failure(
            'PERSISTENCE_FAILED',
            false,
            candidate.rev,
            this.#persistenceFault,
            persistenceCode === undefined ? {} : { persistenceCode },
          );
        }

        if (
          isDeepStrictEqual(reconciled.document, candidate) &&
          isDeepStrictEqual(reconciled.history, this.#engine.history)
        ) {
          // The journal append is authoritative. Keep this exact engine so its
          // idempotency record remains available for replay.
          this.#recoveredFromBackup ||= reconciled.recoveredFromBackup;
          this.#recoveredTransactions += reconciled.recoveredTransactions;
          return {
            ok: true,
            dryRun: false,
            replayed: false,
            rev: result.rev,
            transaction: result.transaction,
          };
        }

        if (
          isDeepStrictEqual(reconciled.document, before) &&
          isDeepStrictEqual(reconciled.history, beforeHistory)
        ) {
          // No durable transaction was found. Reconstruct the exact pre-apply
          // document and both history stacks; apply() clears redo on success.
          this.#engine = new OperationEngine(before, beforeHistory);
          return failure(
            'PERSISTENCE_FAILED',
            false,
            this.#engine.document.rev,
            `Could not persist transaction: ${boundedDetail(error)}`,
            persistenceCode === undefined ? {} : { persistenceCode },
          );
        }

        // Disk and memory disagree in a third state. Do not guess whether an
        // inverse patch is safe; fail closed and require the caller to reopen.
        const message =
          `Could not persist transaction: ${boundedDetail(error)}; ` +
          'durability reconciliation produced an indeterminate document state';
        this.#persistenceFault = boundedDetail(message);
        return failure(
          'PERSISTENCE_FAILED',
          false,
          candidate.rev,
          this.#persistenceFault,
          persistenceCode === undefined ? {} : { persistenceCode },
        );
      }

      return {
        ok: true,
        dryRun: false,
        replayed: false,
        rev: result.rev,
        transaction: result.transaction,
      };
    });
  }

  public async undo(): Promise<DocumentSessionHistoryResult> {
    return this.#transitionHistory('undo');
  }

  public async redo(): Promise<DocumentSessionHistoryResult> {
    return this.#transitionHistory('redo');
  }

  async #transitionHistory(
    direction: DocumentSessionHistoryDirection,
  ): Promise<DocumentSessionHistoryResult> {
    if (this.#readOnly) {
      return historyFailure(
        direction,
        'READ_ONLY',
        this.#engine.document.rev,
        'This document session is read-only',
      );
    }
    if (!this.#mutationsEnabled) {
      return historyFailure(
        direction,
        'MUTATIONS_DISABLED',
        this.#engine.document.rev,
        'Mutations are disabled for this document session',
      );
    }
    if (this.#persistenceFault !== undefined) {
      return historyFailure(
        direction,
        'PERSISTENCE_FAILED',
        this.#engine.document.rev,
        this.#persistenceFault,
      );
    }

    return this.#withMutationLock(async () => {
      if (this.#persistenceFault !== undefined) {
        return historyFailure(
          direction,
          'PERSISTENCE_FAILED',
          this.#engine.document.rev,
          this.#persistenceFault,
        );
      }

      const before = this.#engine.document;
      const beforeHistory = this.#engine.history;
      const result =
        direction === 'undo' ? this.#engine.undo() : this.#engine.redo();
      if (!result.ok) {
        return historyFailure(
          direction,
          'OPERATION_REJECTED',
          before.rev,
          diagnosticsMessage(result.diagnostics),
          { diagnostics: result.diagnostics },
        );
      }

      const candidate = this.#engine.document;
      try {
        await persistHistoryTransition(
          this.#documentPath,
          candidate,
          result.transaction,
          direction,
        );
      } catch (error: unknown) {
        const persistenceCode =
          error instanceof PersistenceError ? error.code : undefined;
        let reconciled: Awaited<ReturnType<typeof loadDocument>>;
        try {
          reconciled = await loadDocument(this.#documentPath);
        } catch (reconciliationError: unknown) {
          const message =
            `Could not persist ${direction}: ${boundedDetail(error)}; ` +
            `durability reconciliation failed: ${boundedDetail(reconciliationError)}`;
          this.#persistenceFault = boundedDetail(message);
          return historyFailure(
            direction,
            'PERSISTENCE_FAILED',
            candidate.rev,
            this.#persistenceFault,
            persistenceCode === undefined ? {} : { persistenceCode },
          );
        }

        if (
          isDeepStrictEqual(reconciled.document, candidate) &&
          isDeepStrictEqual(reconciled.history, this.#engine.history)
        ) {
          this.#recoveredFromBackup ||= reconciled.recoveredFromBackup;
          this.#recoveredTransactions += reconciled.recoveredTransactions;
          return {
            ok: true,
            direction,
            rev: result.rev,
            transaction: result.transaction,
          };
        }

        if (
          isDeepStrictEqual(reconciled.document, before) &&
          isDeepStrictEqual(reconciled.history, beforeHistory)
        ) {
          this.#engine = new OperationEngine(before, beforeHistory);
          return historyFailure(
            direction,
            'PERSISTENCE_FAILED',
            before.rev,
            `Could not persist ${direction}: ${boundedDetail(error)}`,
            persistenceCode === undefined ? {} : { persistenceCode },
          );
        }

        const message =
          `Could not persist ${direction}: ${boundedDetail(error)}; ` +
          'durability reconciliation produced an indeterminate document or history state';
        this.#persistenceFault = boundedDetail(message);
        return historyFailure(
          direction,
          'PERSISTENCE_FAILED',
          candidate.rev,
          this.#persistenceFault,
          persistenceCode === undefined ? {} : { persistenceCode },
        );
      }

      return {
        ok: true,
        direction,
        rev: result.rev,
        transaction: result.transaction,
      };
    });
  }

  async #withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#mutationTail;
    let release!: () => void;
    this.#mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
