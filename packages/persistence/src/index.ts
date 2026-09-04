import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { applyPatches, type Patch } from 'immer';
import { validateDocument, type OpenChartDocument } from '@openchart/ir';
import {
  validateOperationEnvelope,
  type CommittedTransaction,
  type OperationHistoryState,
  type OperationEnvelope,
} from '@openchart/ops';

export type PersistenceErrorCode =
  | 'DOCUMENT_INVALID'
  | 'JOURNAL_INVALID'
  | 'JOURNAL_REPLAY_FAILED'
  | 'READ_FAILED'
  | 'TRANSACTION_INVALID'
  | 'WRITE_FAILED';

export class PersistenceError extends Error {
  public constructor(
    public readonly code: PersistenceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PersistenceError';
  }
}

export interface LoadDocumentResult {
  readonly document: OpenChartDocument;
  readonly recoveredFromBackup: boolean;
  readonly recoveredTransactions: number;
  readonly history: OperationHistoryState;
}

export interface LegacyJournalEntry {
  readonly formatVersion: 1;
  readonly rev: number;
  readonly committedAt: string;
  readonly envelope: OperationEnvelope;
  readonly forwardPatches: readonly Patch[];
  readonly inversePatches: readonly Patch[];
}

export type JournalAction = 'commit' | 'undo' | 'redo';

export interface HistoryJournalEntry {
  readonly formatVersion: 2;
  readonly action: JournalAction;
  readonly recordedAt: string;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly transaction: CommittedTransaction;
}

export type JournalEntry = LegacyJournalEntry | HistoryJournalEntry;

export type ReadJournalOperationsOptions =
  | {
      readonly txId: string;
      readonly sinceRev?: never;
      readonly limit: number;
    }
  | {
      readonly txId?: never;
      readonly sinceRev: number;
      readonly limit: number;
    };

export interface JournalOperationRecord {
  /** One-based append order in the NDJSON journal. */
  readonly sequence: number;
  readonly action: JournalAction;
  readonly recordedAt: string;
  readonly rev: number;
  readonly committedAt: string;
  readonly envelope: OperationEnvelope;
}

export interface ReadJournalOperationsResult {
  readonly events: readonly JournalOperationRecord[];
  readonly truncated: boolean;
}

const LEGACY_JOURNAL_FORMAT_VERSION = 1 as const;
const JOURNAL_FORMAT_VERSION = 2 as const;
const MAX_ERROR_DETAIL_LENGTH = 240;
const MAX_DIAGNOSTICS = 3;
const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/;
const LEGACY_JOURNAL_ENTRY_KEYS = [
  'committedAt',
  'envelope',
  'formatVersion',
  'forwardPatches',
  'inversePatches',
  'rev',
] as const;
const HISTORY_JOURNAL_ENTRY_KEYS = [
  'action',
  'afterHash',
  'beforeHash',
  'formatVersion',
  'recordedAt',
  'transaction',
] as const;
const TRANSACTION_KEYS = [
  'committedAt',
  'envelope',
  'forwardPatches',
  'inversePatches',
  'rev',
] as const;
const PATCH_KEYS = ['op', 'path', 'value'] as const;
const DOCUMENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

function own<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRecoverableSnapshotFailure(error: unknown): error is PersistenceError {
  if (!(error instanceof PersistenceError)) {
    return false;
  }
  if (error.code === 'DOCUMENT_INVALID') {
    return true;
  }
  return (
    error.code === 'READ_FAILED' &&
    isRecord(error.cause) &&
    error.cause.code === 'ENOENT'
  );
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function contentHash(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')}`;
}

function boundedDetail(value: unknown): string {
  const detail = value instanceof Error ? value.message : String(value);
  if (detail.length <= MAX_ERROR_DETAIL_LENGTH) {
    return detail;
  }
  return `${detail.slice(0, MAX_ERROR_DETAIL_LENGTH - 3)}...`;
}

function withCause(
  code: PersistenceErrorCode,
  message: string,
  cause: unknown,
): PersistenceError {
  return new PersistenceError(code, message, { cause });
}

function diagnosticsDetail(
  diagnostics: readonly {
    readonly code: string;
    readonly path: string;
    readonly message: string;
  }[],
): string {
  const details = diagnostics
    .slice(0, MAX_DIAGNOSTICS)
    .map(({ code, path, message }) => `${code} at ${path}: ${boundedDetail(message)}`);
  if (diagnostics.length > MAX_DIAGNOSTICS) {
    details.push(`and ${diagnostics.length - MAX_DIAGNOSTICS} more diagnostic(s)`);
  }
  return details.join('; ');
}

function invalidDocument(
  documentPath: string,
  diagnostics: readonly {
    readonly code: string;
    readonly path: string;
    readonly message: string;
  }[],
): PersistenceError {
  return new PersistenceError(
    'DOCUMENT_INVALID',
    `Document ${JSON.stringify(documentPath)} is invalid: ${diagnosticsDetail(diagnostics)}`,
  );
}

function validateDocumentInput(
  documentPath: string,
  input: unknown,
): OpenChartDocument {
  try {
    const validation = validateDocument(input);
    if (!validation.ok) {
      throw invalidDocument(documentPath, validation.diagnostics);
    }
    return validation.document;
  } catch (error: unknown) {
    if (error instanceof PersistenceError) {
      throw error;
    }
    throw withCause(
      'DOCUMENT_INVALID',
      `Document ${JSON.stringify(documentPath)} could not be validated: ${boundedDetail(error)}`,
      error,
    );
  }
}

function isValidCommittedAt(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    ISO_DATE_TIME_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isJsonValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null) {
    return true;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value !== 'object') {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  let valid: boolean;
  if (Array.isArray(value)) {
    valid = value.every((item) => isJsonValue(item, seen));
  } else {
    const prototype: object | null = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      valid = false;
    } else {
      valid = Object.keys(value).every((key) =>
        isJsonValue((value as Record<string, unknown>)[key], seen),
      );
    }
  }

  seen.delete(value);
  return valid;
}

function isPatch(value: unknown): value is Patch {
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.some((key) => !(PATCH_KEYS as readonly string[]).includes(key))) {
    return false;
  }

  const operation = value.op;
  const path = value.path;
  if (
    (operation !== 'add' && operation !== 'remove' && operation !== 'replace') ||
    !Array.isArray(path) ||
    !path.every(
      (segment) =>
        typeof segment === 'string' ||
        (typeof segment === 'number' && Number.isInteger(segment) && segment >= 0),
    )
  ) {
    return false;
  }

  const hasValue = own(value, 'value');
  if (operation === 'remove' ? hasValue : !hasValue) {
    return false;
  }
  return !hasValue || isJsonValue(value.value);
}

function validatePatches(value: unknown, field: string): readonly Patch[] {
  if (!Array.isArray(value) || !value.every(isPatch)) {
    throw new Error(`${field} must be an array of valid Immer patches`);
  }
  return value;
}

function validateEnvelope(
  envelope: unknown,
  context: string,
): OperationEnvelope {
  try {
    const validation = validateOperationEnvelope(envelope);
    if (!validation.ok) {
      throw new Error(
        `${context} is invalid: ${diagnosticsDetail(validation.diagnostics)}`,
      );
    }
    return validation.envelope;
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith(`${context} is invalid:`)) {
      throw error;
    }
    throw new Error(`${context} could not be validated: ${boundedDetail(error)}`, {
      cause: error,
    });
  }
}

function validateTransactionValue(
  transaction: unknown,
  context: string,
): CommittedTransaction {
  if (!isRecord(transaction)) {
    throw new Error(`${context} must be an object`);
  }
  if (!hasOnlyKeys(transaction, TRANSACTION_KEYS)) {
    throw new Error(`${context} must contain only ${TRANSACTION_KEYS.join(', ')}`);
  }

  let envelope: OperationEnvelope;
  try {
    envelope = validateEnvelope(transaction.envelope, `${context} envelope`);
  } catch (error: unknown) {
    throw new Error(`${context} has an invalid envelope: ${boundedDetail(error)}`, {
      cause: error,
    });
  }

  if (
    typeof transaction.rev !== 'number' ||
    !Number.isSafeInteger(transaction.rev) ||
    transaction.rev < 1 ||
    envelope.baseRev !== transaction.rev - 1
  ) {
    throw new Error(
      `${context} revision must be a positive safe integer exactly one greater than its envelope base revision`,
    );
  }

  if (!isValidCommittedAt(transaction.committedAt)) {
    throw new Error(`${context} committedAt must be an ISO date-time`);
  }

  let forwardPatches: readonly Patch[];
  let inversePatches: readonly Patch[];
  try {
    forwardPatches = validatePatches(transaction.forwardPatches, 'forwardPatches');
    inversePatches = validatePatches(transaction.inversePatches, 'inversePatches');
  } catch (error: unknown) {
    throw new Error(`${context} has invalid patches: ${boundedDetail(error)}`, {
      cause: error,
    });
  }

  return {
    rev: transaction.rev,
    committedAt: transaction.committedAt,
    envelope,
    forwardPatches,
    inversePatches,
  };
}

function validateTransitionDocument(
  candidate: unknown,
  context: string,
): OpenChartDocument {
  const validation = validateDocument(candidate);
  if (!validation.ok) {
    throw new Error(`${context} is invalid: ${diagnosticsDetail(validation.diagnostics)}`);
  }
  return validation.document;
}

function createHistoryJournalEntry(
  documentPath: string,
  document: OpenChartDocument,
  transaction: unknown,
  action: JournalAction,
): HistoryJournalEntry {
  const after = validateDocumentInput(documentPath, document);
  let validatedTransaction: CommittedTransaction;
  try {
    validatedTransaction = validateTransactionValue(transaction, 'Transaction');
  } catch (error: unknown) {
    throw withCause(
      'TRANSACTION_INVALID',
      `Transaction for ${JSON.stringify(documentPath)} is invalid: ${boundedDetail(error)}`,
      error,
    );
  }

  let before: OpenChartDocument;
  try {
    before = validateTransitionDocument(
      applyPatches(
        after,
        action === 'undo'
          ? validatedTransaction.forwardPatches
          : validatedTransaction.inversePatches,
      ),
      `Transaction ${action} source document`,
    );
  } catch (error: unknown) {
    throw withCause(
      'TRANSACTION_INVALID',
      `Transaction for ${JSON.stringify(documentPath)} cannot reconstruct its ${action} source: ${boundedDetail(error)}`,
      error,
    );
  }

  const committedDocument = action === 'undo' ? before : after;
  const baseDocument = action === 'undo' ? after : before;
  if (
    committedDocument.rev !== validatedTransaction.rev ||
    committedDocument.meta.updatedAt !== validatedTransaction.committedAt ||
    baseDocument.rev !== validatedTransaction.envelope.baseRev
  ) {
    throw new PersistenceError(
      'TRANSACTION_INVALID',
      `Transaction for ${JSON.stringify(documentPath)} does not match the ${action} document revisions and timestamp`,
    );
  }

  let reapplied: OpenChartDocument;
  try {
    reapplied = validateTransitionDocument(
      applyPatches(
        before,
        action === 'undo'
          ? validatedTransaction.inversePatches
          : validatedTransaction.forwardPatches,
      ),
      `Transaction ${action} result document`,
    );
  } catch (error: unknown) {
    throw withCause(
      'TRANSACTION_INVALID',
      `Transaction for ${JSON.stringify(documentPath)} cannot reproduce its ${action} result: ${boundedDetail(error)}`,
      error,
    );
  }
  if (contentHash(reapplied) !== contentHash(after)) {
    throw new PersistenceError(
      'TRANSACTION_INVALID',
      `Transaction for ${JSON.stringify(documentPath)} does not reproduce the ${action} result document`,
    );
  }

  return {
    formatVersion: JOURNAL_FORMAT_VERSION,
    action,
    recordedAt: new Date().toISOString(),
    beforeHash: contentHash(before),
    afterHash: contentHash(after),
    transaction: validatedTransaction,
  };
}

function journalInvalid(line: number, message: string, cause?: unknown): PersistenceError {
  const detail = `Journal line ${line} is invalid: ${message}`;
  return cause === undefined
    ? new PersistenceError('JOURNAL_INVALID', detail)
    : withCause('JOURNAL_INVALID', detail, cause);
}

function hasOnlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const expectedSet = new Set(expected);
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key) => expectedSet.has(key));
}

function parseLegacyJournalEntry(
  value: Record<string, unknown>,
  line: number,
): LegacyJournalEntry {
  if (!hasOnlyKeys(value, LEGACY_JOURNAL_ENTRY_KEYS)) {
    throw journalInvalid(
      line,
      `version 1 entry must contain only ${LEGACY_JOURNAL_ENTRY_KEYS.join(', ')}`,
    );
  }
  let transaction: CommittedTransaction;
  try {
    transaction = validateTransactionValue(
      {
        rev: value.rev,
        committedAt: value.committedAt,
        envelope: value.envelope,
        forwardPatches: value.forwardPatches,
        inversePatches: value.inversePatches,
      },
      `Journal line ${line} transaction`,
    );
  } catch (error: unknown) {
    throw journalInvalid(line, boundedDetail(error), error);
  }
  return {
    formatVersion: LEGACY_JOURNAL_FORMAT_VERSION,
    rev: transaction.rev,
    committedAt: transaction.committedAt,
    envelope: transaction.envelope,
    forwardPatches: transaction.forwardPatches,
    inversePatches: transaction.inversePatches,
  };
}

function parseHistoryJournalEntry(
  value: Record<string, unknown>,
  line: number,
): HistoryJournalEntry {
  if (!hasOnlyKeys(value, HISTORY_JOURNAL_ENTRY_KEYS)) {
    throw journalInvalid(
      line,
      `version 2 entry must contain only ${HISTORY_JOURNAL_ENTRY_KEYS.join(', ')}`,
    );
  }
  if (value.action !== 'commit' && value.action !== 'undo' && value.action !== 'redo') {
    throw journalInvalid(line, 'action must be commit, undo, or redo');
  }
  if (!isValidCommittedAt(value.recordedAt)) {
    throw journalInvalid(line, 'recordedAt must be an ISO date-time');
  }
  if (
    typeof value.beforeHash !== 'string' ||
    !DOCUMENT_HASH_PATTERN.test(value.beforeHash) ||
    typeof value.afterHash !== 'string' ||
    !DOCUMENT_HASH_PATTERN.test(value.afterHash)
  ) {
    throw journalInvalid(line, 'beforeHash and afterHash must be SHA-256 document hashes');
  }

  let transaction: CommittedTransaction;
  try {
    transaction = validateTransactionValue(
      value.transaction,
      `Journal line ${line} transaction`,
    );
  } catch (error: unknown) {
    throw journalInvalid(line, boundedDetail(error), error);
  }
  return {
    formatVersion: JOURNAL_FORMAT_VERSION,
    action: value.action,
    recordedAt: value.recordedAt,
    beforeHash: value.beforeHash,
    afterHash: value.afterHash,
    transaction,
  };
}

function parseJournalEntry(value: unknown, line: number): JournalEntry {
  if (!isRecord(value)) {
    throw journalInvalid(line, 'entry must be a JSON object');
  }
  if (value.formatVersion === LEGACY_JOURNAL_FORMAT_VERSION) {
    return parseLegacyJournalEntry(value, line);
  }
  if (value.formatVersion === JOURNAL_FORMAT_VERSION) {
    return parseHistoryJournalEntry(value, line);
  }
  throw journalInvalid(line, 'formatVersion must be 1 or 2');
}

function parseJournal(text: string): readonly JournalEntry[] {
  if (text.length === 0) {
    return [];
  }
  const lines = text.split(/\r?\n/);
  const hasFinalNewline = lines.at(-1) === '';
  if (hasFinalNewline) {
    lines.pop();
  }
  if (lines.length === 0) {
    throw journalInvalid(1, 'journal must contain an entry');
  }
  return lines.map((line, index) => {
    if (line.trim().length === 0) {
      throw journalInvalid(index + 1, 'entry must not be blank');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error: unknown) {
      throw journalInvalid(index + 1, `invalid JSON: ${boundedDetail(error)}`, error);
    }
    return parseJournalEntry(parsed, index + 1);
  });
}

function transactionForEntry(entry: JournalEntry): CommittedTransaction {
  if (entry.formatVersion === JOURNAL_FORMAT_VERSION) {
    return entry.transaction;
  }
  return {
    rev: entry.rev,
    committedAt: entry.committedAt,
    envelope: entry.envelope,
    forwardPatches: entry.forwardPatches,
    inversePatches: entry.inversePatches,
  };
}

function actionForEntry(entry: JournalEntry): JournalAction {
  return entry.formatVersion === JOURNAL_FORMAT_VERSION ? entry.action : 'commit';
}

function operationRecord(
  entry: JournalEntry,
  sequence: number,
): JournalOperationRecord {
  const transaction = transactionForEntry(entry);
  return {
    sequence,
    action: actionForEntry(entry),
    recordedAt:
      entry.formatVersion === JOURNAL_FORMAT_VERSION
        ? entry.recordedAt
        : entry.committedAt,
    rev: transaction.rev,
    committedAt: transaction.committedAt,
    envelope: structuredClone(transaction.envelope),
  };
}

function sameTransaction(
  left: CommittedTransaction,
  right: CommittedTransaction,
): boolean {
  return contentHash(left) === contentHash(right);
}

function reconstructHistory(
  entries: readonly JournalEntry[],
): OperationHistoryState {
  const undoStack: CommittedTransaction[] = [];
  const redoStack: CommittedTransaction[] = [];

  for (const [index, entry] of entries.entries()) {
    const line = index + 1;
    const transaction = transactionForEntry(entry);
    switch (actionForEntry(entry)) {
      case 'commit':
        undoStack.push(transaction);
        redoStack.length = 0;
        break;
      case 'undo': {
        const expected = undoStack.pop();
        if (expected === undefined || !sameTransaction(expected, transaction)) {
          throw journalInvalid(line, 'undo does not match the active transaction');
        }
        redoStack.push(expected);
        break;
      }
      case 'redo': {
        const expected = redoStack.pop();
        if (expected === undefined || !sameTransaction(expected, transaction)) {
          throw journalInvalid(line, 'redo does not match the next undone transaction');
        }
        undoStack.push(expected);
        break;
      }
    }
  }

  return {
    undoStack: structuredClone(undoStack),
    redoStack: structuredClone(redoStack),
  };
}

async function closeHandle(handle: FileHandle | undefined): Promise<unknown> {
  if (handle === undefined) {
    return undefined;
  }
  try {
    await handle.close();
    return undefined;
  } catch (error: unknown) {
    return error;
  }
}

async function cleanupTemp(tempPath: string): Promise<unknown> {
  try {
    await unlink(tempPath);
    return undefined;
  } catch (error: unknown) {
    if (isRecord(error) && error.code === 'ENOENT') {
      return undefined;
    }
    return error;
  }
}

function combineErrors(primary: unknown, secondary: unknown): unknown {
  if (primary === undefined) {
    return secondary;
  }
  if (secondary === undefined) {
    return primary;
  }
  return new AggregateError([primary, secondary], 'Multiple persistence operations failed', {
    cause: primary,
  });
}

async function writeTextAtomically(
  documentPath: string,
  serialized: string,
): Promise<void> {
  const directory = dirname(documentPath);
  const tempPath = join(
    directory,
    `.${basename(documentPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle: FileHandle | undefined;
  let tempCreated = false;
  let failure: unknown;
  try {
    await mkdir(directory, { recursive: true });
    handle = await open(tempPath, 'wx');
    tempCreated = true;
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(tempPath, documentPath);
    tempCreated = false;
  } catch (error: unknown) {
    failure = error;
  }
  failure = combineErrors(failure, await closeHandle(handle));
  if (tempCreated) {
    failure = combineErrors(failure, await cleanupTemp(tempPath));
  }
  if (failure !== undefined) {
    throw withCause(
      'WRITE_FAILED',
      `Could not atomically write ${JSON.stringify(documentPath)}: ${boundedDetail(failure)}`,
      failure,
    );
  }
}

async function appendJournalEntry(
  journalPath: string,
  entry: JournalEntry,
): Promise<void> {
  let handle: FileHandle | undefined;
  let failure: unknown;
  try {
    const serialized = `${JSON.stringify(entry)}\n`;
    handle = await open(journalPath, 'a');
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
  } catch (error: unknown) {
    failure = error;
  }
  failure = combineErrors(failure, await closeHandle(handle));
  if (failure !== undefined) {
    throw withCause(
      'WRITE_FAILED',
      `Could not append journal ${JSON.stringify(journalPath)}: ${boundedDetail(failure)}`,
      failure,
    );
  }
}

async function readDocument(documentPath: string): Promise<OpenChartDocument> {
  let text: string;
  try {
    text = await readFile(documentPath, 'utf8');
  } catch (error: unknown) {
    throw withCause(
      'READ_FAILED',
      `Could not read document ${JSON.stringify(documentPath)}: ${boundedDetail(error)}`,
      error,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error: unknown) {
    throw withCause(
      'DOCUMENT_INVALID',
      `Document ${JSON.stringify(documentPath)} contains invalid JSON: ${boundedDetail(error)}`,
      error,
    );
  }
  return validateDocumentInput(documentPath, parsed);
}

export function journalPathFor(documentPath: string): string {
  return documentPath.endsWith('.openchart.json')
    ? `${documentPath.slice(0, -'.json'.length)}.journal.ndjson`
    : `${documentPath}.journal.ndjson`;
}

export function backupPathFor(documentPath: string): string {
  return documentPath.endsWith('.openchart.json')
    ? `${documentPath.slice(0, -'.openchart.json'.length)}.openchart.backup.json`
    : `${documentPath}.backup`;
}

async function rotateCurrentSnapshot(documentPath: string): Promise<void> {
  let current: OpenChartDocument;
  try {
    current = await readDocument(documentPath);
  } catch (error: unknown) {
    if (isRecoverableSnapshotFailure(error)) {
      return;
    }
    throw error;
  }
  await writeTextAtomically(
    backupPathFor(documentPath),
    `${JSON.stringify(current, null, 2)}\n`,
  );
}

async function readJournal(documentPath: string): Promise<readonly JournalEntry[]> {
  const journalPath = journalPathFor(documentPath);
  let journalText: string;
  try {
    journalText = await readFile(journalPath, 'utf8');
  } catch (error: unknown) {
    if (isRecord(error) && error.code === 'ENOENT') {
      return [];
    }
    throw withCause(
      'READ_FAILED',
      `Could not read journal ${JSON.stringify(journalPath)}: ${boundedDetail(error)}`,
      error,
    );
  }
  return parseJournal(journalText);
}

/** Read a bounded, patch-free projection of durable journal events. */
export async function readJournalOperations(
  documentPath: string,
  options: ReadJournalOperationsOptions,
): Promise<ReadJournalOperationsResult> {
  const entries = await readJournal(documentPath);
  const matching = entries
    .map((entry, index) => operationRecord(entry, index + 1))
    .filter((event) =>
      options.txId === undefined
        ? event.rev > options.sinceRev
        : event.envelope.txId === options.txId,
    );
  const start = Math.max(0, matching.length - options.limit);
  return {
    events: matching.slice(start),
    truncated: start > 0,
  };
}

export async function writeDocumentAtomically(
  documentPath: string,
  document: OpenChartDocument,
): Promise<void> {
  const validated = validateDocumentInput(documentPath, document);
  let serialized: string;
  try {
    serialized = `${JSON.stringify(validated, null, 2)}\n`;
  } catch (error: unknown) {
    throw withCause(
      'WRITE_FAILED',
      `Could not serialize document ${JSON.stringify(documentPath)}: ${boundedDetail(error)}`,
      error,
    );
  }
  await rotateCurrentSnapshot(documentPath);
  await writeTextAtomically(documentPath, serialized);
}

export async function persistCommittedTransaction(
  documentPath: string,
  document: OpenChartDocument,
  transaction: CommittedTransaction,
): Promise<void> {
  const validatedDocument = validateDocumentInput(documentPath, document);
  const entry = createHistoryJournalEntry(
    documentPath,
    validatedDocument,
    transaction,
    'commit',
  );
  await persistJournalEntryAndSnapshot(documentPath, validatedDocument, entry);
}

export async function persistHistoryTransition(
  documentPath: string,
  document: OpenChartDocument,
  transaction: CommittedTransaction,
  action: 'undo' | 'redo',
): Promise<void> {
  const validatedDocument = validateDocumentInput(documentPath, document);
  const entry = createHistoryJournalEntry(
    documentPath,
    validatedDocument,
    transaction,
    action,
  );
  await persistJournalEntryAndSnapshot(documentPath, validatedDocument, entry);
}

async function persistJournalEntryAndSnapshot(
  documentPath: string,
  document: OpenChartDocument,
  entry: HistoryJournalEntry,
): Promise<void> {
  const journalPath = journalPathFor(documentPath);
  try {
    await mkdir(dirname(journalPath), { recursive: true });
  } catch (error: unknown) {
    throw withCause(
      'WRITE_FAILED',
      `Could not create persistence directory for ${JSON.stringify(documentPath)}: ${boundedDetail(error)}`,
      error,
    );
  }
  await appendJournalEntry(journalPath, entry);
  await writeDocumentAtomically(documentPath, document);
}

export async function loadDocument(
  documentPath: string,
): Promise<LoadDocumentResult> {
  let baseDocument: OpenChartDocument;
  let recoveredFromBackup = false;
  try {
    baseDocument = await readDocument(documentPath);
  } catch (primaryError: unknown) {
    if (!isRecoverableSnapshotFailure(primaryError)) {
      throw primaryError;
    }
    const backupPath = backupPathFor(documentPath);
    try {
      baseDocument = await readDocument(backupPath);
    } catch (backupError: unknown) {
      throw withCause(
        primaryError.code,
        `Could not load document ${JSON.stringify(documentPath)} or its last known good backup ${JSON.stringify(backupPath)}: ${boundedDetail(backupError)}`,
        new AggregateError(
          [primaryError, backupError],
          'Primary and backup snapshots are unavailable',
          { cause: primaryError },
        ),
      );
    }
    recoveredFromBackup = true;
  }
  const entries = await readJournal(documentPath);
  const history = reconstructHistory(entries);
  let document = baseDocument;
  let recoveredTransactions = 0;
  const baseHash = contentHash(baseDocument);
  let replayStart = 0;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (
      entry?.formatVersion === JOURNAL_FORMAT_VERSION &&
      entry.afterHash === baseHash
    ) {
      replayStart = index + 1;
      break;
    }
  }
  if (replayStart === 0) {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (
        entry?.formatVersion === JOURNAL_FORMAT_VERSION &&
        entry.beforeHash === baseHash
      ) {
        replayStart = index;
        break;
      }
    }
  }

  for (let index = replayStart; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined) {
      continue;
    }
    const line = index + 1;
    if (entry.formatVersion === LEGACY_JOURNAL_FORMAT_VERSION) {
      if (entry.rev <= document.rev) {
        continue;
      }
      if (
        entry.envelope.baseRev !== document.rev ||
        entry.rev !== document.rev + 1
      ) {
        throw new PersistenceError(
          'JOURNAL_REPLAY_FAILED',
          `Journal line ${line} cannot replay revision ${entry.rev} over document revision ${document.rev}`,
        );
      }

      let legacyCandidate: OpenChartDocument;
      try {
        legacyCandidate = validateTransitionDocument(
          applyPatches(document, entry.forwardPatches),
          `Journal line ${line} result`,
        );
      } catch (error: unknown) {
        throw withCause(
          'JOURNAL_REPLAY_FAILED',
          `Journal line ${line} failed to apply revision ${entry.rev}: ${boundedDetail(error)}`,
          error,
        );
      }
      if (
        legacyCandidate.rev !== entry.rev ||
        legacyCandidate.meta.updatedAt !== entry.committedAt
      ) {
        throw new PersistenceError(
          'JOURNAL_REPLAY_FAILED',
          `Journal line ${line} produced revision ${legacyCandidate.rev} with committedAt ${JSON.stringify(legacyCandidate.meta.updatedAt)}, expected revision ${entry.rev} and committedAt ${JSON.stringify(entry.committedAt)}`,
        );
      }
      document = legacyCandidate;
      recoveredTransactions += 1;
      continue;
    }

    const currentHash = contentHash(document);
    if (currentHash === entry.afterHash) {
      continue;
    }
    if (currentHash !== entry.beforeHash) {
      throw new PersistenceError(
        'JOURNAL_REPLAY_FAILED',
        `Journal line ${line} cannot apply ${entry.action}: document hash does not match its before or after state`,
      );
    }

    let candidate: OpenChartDocument;
    try {
      candidate = validateTransitionDocument(
        applyPatches(
          document,
          entry.action === 'undo'
            ? entry.transaction.inversePatches
            : entry.transaction.forwardPatches,
        ),
        `Journal line ${line} ${entry.action} result`,
      );
    } catch (error: unknown) {
      throw withCause(
        'JOURNAL_REPLAY_FAILED',
        `Journal line ${line} failed to apply ${entry.action}: ${boundedDetail(error)}`,
        error,
      );
    }

    const expectedRev =
      entry.action === 'undo'
        ? entry.transaction.envelope.baseRev
        : entry.transaction.rev;
    if (
      contentHash(candidate) !== entry.afterHash ||
      candidate.rev !== expectedRev ||
      (entry.action !== 'undo' &&
        candidate.meta.updatedAt !== entry.transaction.committedAt)
    ) {
      throw new PersistenceError(
        'JOURNAL_REPLAY_FAILED',
        `Journal line ${line} produced an invalid ${entry.action} result`,
      );
    }
    document = candidate;
    recoveredTransactions += 1;
  }

  if (recoveredFromBackup || recoveredTransactions > 0) {
    await writeDocumentAtomically(documentPath, document);
  }
  return { document, recoveredFromBackup, recoveredTransactions, history };
}
