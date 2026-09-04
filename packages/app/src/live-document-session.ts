import type { OpenChartToolSession } from '@openchart/agent/live';
import type { OpenChartDocument } from '@openchart/ir';
import {
  OperationEngine,
  type ApplyResult,
  type CommittedTransaction,
  type OperationDiagnostic,
  type OperationEnvelope,
  type OperationHistoryState,
  type RedoResult,
  type UndoResult,
} from '@openchart/ops';

type SessionApplyResult = Awaited<ReturnType<OpenChartToolSession['apply']>>;
type SessionHistoryResult = Awaited<ReturnType<OpenChartToolSession['undo']>>;
type OperationsQuery = Parameters<OpenChartToolSession['getOperations']>[0];
type OperationsResult = Awaited<ReturnType<OpenChartToolSession['getOperations']>>;
type JournalAction = 'commit' | 'undo' | 'redo';

export interface LiveDocumentSessionOptions {
  readonly getEngine: () => OperationEngine;
  readonly replaceEngine: (engine: OperationEngine) => void;
  readonly publish: (document: OpenChartDocument) => void;
  readonly persist: (document: OpenChartDocument) => Promise<void>;
  readonly setStatus: (message: string) => void;
}

function boundedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 240 ? `${message.slice(0, 237)}...` : message;
}

function busyDiagnostic(): OperationDiagnostic {
  return {
    code: 'INVALID_OPERATION',
    path: '',
    message: 'Wait for the current agent edit to finish saving',
  };
}

function operationFailure(
  dryRun: boolean,
  rev: number,
  diagnostics: readonly OperationDiagnostic[],
): SessionApplyResult {
  return {
    ok: false,
    dryRun,
    rev,
    code: 'OPERATION_REJECTED',
    message: diagnostics[0]?.message ?? 'Operation rejected',
    diagnostics,
  };
}

/** One live operation session shared by the React editor and in-process MCP. */
export class LiveDocumentSession implements OpenChartToolSession {
  readonly #options: LiveDocumentSessionOptions;
  readonly #events: Array<OperationsResult['events'][number]> = [];
  #mutationTail: Promise<void> = Promise.resolve();
  #agentMutationInFlight = false;

  public constructor(options: LiveDocumentSessionOptions) {
    this.#options = options;
  }

  public get document(): OpenChartDocument {
    return this.#options.getEngine().document;
  }

  public get history() {
    return this.#options.getEngine().history;
  }

  public readonly readOnly = false;
  public readonly mutationsEnabled = true;
  public readonly persistenceFault = undefined;

  public reset(engine: OperationEngine): void {
    this.#options.replaceEngine(engine);
    this.#events.length = 0;
    this.#options.publish(engine.document);
  }

  public applyLocal(envelope: OperationEnvelope): ApplyResult {
    if (this.#agentMutationInFlight) {
      return { ok: false, diagnostics: [busyDiagnostic()] };
    }
    const result = this.#options.getEngine().apply(envelope);
    if (result.ok) {
      if (!result.replayed) this.#record('commit', result.transaction);
      this.#options.publish(this.document);
    }
    return result;
  }

  public undoLocal(): UndoResult {
    if (this.#agentMutationInFlight) {
      return { ok: false, diagnostics: [busyDiagnostic()] };
    }
    const result = this.#options.getEngine().undo();
    if (result.ok) {
      this.#record('undo', result.transaction);
      this.#options.publish(this.document);
    }
    return result;
  }

  public redoLocal(): RedoResult {
    if (this.#agentMutationInFlight) {
      return { ok: false, diagnostics: [busyDiagnostic()] };
    }
    const result = this.#options.getEngine().redo();
    if (result.ok) {
      this.#record('redo', result.transaction);
      this.#options.publish(this.document);
    }
    return result;
  }

  public getOperations(options: OperationsQuery): Promise<OperationsResult> {
    const matching = this.#events.filter((event) =>
      options.txId === undefined
        ? event.rev > options.sinceRev
        : event.envelope.txId === options.txId,
    );
    const start = Math.max(0, matching.length - options.limit);
    return Promise.resolve({
      events: structuredClone(matching.slice(start)),
      truncated: start > 0,
    });
  }

  public async apply(
    envelope: OperationEnvelope,
    { dryRun }: { readonly dryRun: boolean } = { dryRun: false },
  ): Promise<SessionApplyResult> {
    if (dryRun) {
      const preview = new OperationEngine(this.document).apply(envelope);
      return preview.ok
        ? {
            ok: true,
            dryRun: true,
            replayed: preview.replayed,
            rev: preview.rev,
            transaction: preview.transaction,
          }
        : operationFailure(true, this.document.rev, preview.diagnostics);
    }

    return this.#serialized(async () => {
      const engine = this.#options.getEngine();
      const before = engine.document;
      const beforeHistory = engine.history;
      const result = engine.apply(envelope);
      if (!result.ok) {
        return operationFailure(false, before.rev, result.diagnostics);
      }
      if (!result.replayed) {
        try {
          await this.#options.persist(engine.document);
        } catch (error: unknown) {
          this.#restore(before, beforeHistory);
          return {
            ok: false,
            dryRun: false,
            rev: before.rev,
            code: 'PERSISTENCE_FAILED',
            message: boundedMessage(error),
          };
        }
        this.#record('commit', result.transaction);
        this.#options.publish(engine.document);
        this.#options.setStatus(
          `MCP applied ${result.transaction.envelope.ops.length} operation${result.transaction.envelope.ops.length === 1 ? '' : 's'}`,
        );
      }
      return {
        ok: true,
        dryRun: false,
        replayed: result.replayed,
        rev: result.rev,
        transaction: result.transaction,
      };
    });
  }

  public async undo(): Promise<SessionHistoryResult> {
    return this.#historyTransition('undo');
  }

  public async redo(): Promise<SessionHistoryResult> {
    return this.#historyTransition('redo');
  }

  async #historyTransition(direction: 'undo' | 'redo'): Promise<SessionHistoryResult> {
    return this.#serialized(async () => {
      const engine = this.#options.getEngine();
      const before = engine.document;
      const beforeHistory = engine.history;
      const result = direction === 'undo' ? engine.undo() : engine.redo();
      if (!result.ok) {
        return {
          ok: false,
          direction,
          rev: before.rev,
          code: 'OPERATION_REJECTED',
          message: result.diagnostics[0]?.message ?? `Could not ${direction}`,
          diagnostics: result.diagnostics,
        };
      }
      try {
        await this.#options.persist(engine.document);
      } catch (error: unknown) {
        this.#restore(before, beforeHistory);
        return {
          ok: false,
          direction,
          rev: before.rev,
          code: 'PERSISTENCE_FAILED',
          message: boundedMessage(error),
        };
      }
      this.#record(direction, result.transaction);
      this.#options.publish(engine.document);
      this.#options.setStatus(`MCP ${direction === 'undo' ? 'undid' : 'redid'} one transaction`);
      return {
        ok: true,
        direction,
        rev: result.rev,
        transaction: result.transaction,
      };
    });
  }

  #record(action: JournalAction, transaction: CommittedTransaction): void {
    this.#events.push({
      sequence: this.#events.length + 1,
      action,
      recordedAt: new Date().toISOString(),
      rev: transaction.rev,
      committedAt: transaction.committedAt,
      envelope: structuredClone(transaction.envelope),
    });
  }

  #restore(
    document: OpenChartDocument,
    history: OperationHistoryState,
  ): void {
    const restored = new OperationEngine(document, history);
    this.#options.replaceEngine(restored);
    this.#options.publish(restored.document);
  }

  async #serialized<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#mutationTail;
    let release!: () => void;
    this.#mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    this.#agentMutationInFlight = true;
    try {
      return await operation();
    } finally {
      this.#agentMutationInFlight = false;
      release();
    }
  }
}
