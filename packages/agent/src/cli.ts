import { randomUUID } from 'node:crypto';
import { link, open, readFile, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  journalPathFor,
  PersistenceError,
} from '@openchart/persistence';
import { validateOperationEnvelope } from '@openchart/ops';
import {
  DOCUMENT_EXPORT_FORMATS,
  DocumentExportError,
  exportDocumentArtifact,
  type DocumentExportFormat,
} from '@openchart/serialize/export';

import { serveOpenChartMcpStdio } from './mcp-stdio.js';
import { renderDocumentScreenshot } from './screenshot.js';
import { OpenChartDocumentSession } from './session.js';
import { OpenChartToolKernel } from './tools.js';
import { startOpenChartWindowsMcpHost } from './windows-host.js';

const MAX_ERROR_DETAIL_LENGTH = 240;
const USAGE =
  'Usage: openchart apply <ops.json> <diagram.openchart.json> | openchart export <svg|png|jpeg|pdf|pptx> <diagram.openchart.json> <output> [--page <id>] [--scale <1-16>] [--transparent] [--include-ir] [--quality <1-100>] | openchart mcp (--stdio | --http) <diagram.openchart.json>';

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

function emit(payload: Record<string, unknown>, stream: NodeJS.WriteStream): void {
  stream.write(`${JSON.stringify(payload)}\n`);
}

function emitFailure(
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): void {
  emit({ ok: false, code, ...extra, message }, process.stderr);
}

function persistenceFailure(
  code: 'DOCUMENT_LOAD_FAILED' | 'PERSISTENCE_FAILED',
  error: unknown,
): void {
  const extra: Record<string, unknown> = {};
  if (error instanceof PersistenceError) {
    extra.persistenceCode = error.code;
  }
  emitFailure(code, boundedDetail(error), extra);
}

function isEntryModule(): boolean {
  const entryPath = process.argv[1];
  if (entryPath === undefined) {
    return false;
  }
  try {
    return fileURLToPath(import.meta.url).toLowerCase() === resolve(entryPath).toLowerCase();
  } catch {
    return false;
  }
}

function isDocumentExportFormat(value: string): value is DocumentExportFormat {
  return DOCUMENT_EXPORT_FORMATS.some((format) => format === value);
}

function parseExportArgs(args: readonly string[]) {
  return parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      page: { type: 'string' },
      scale: { type: 'string' },
      transparent: { type: 'boolean' },
      'include-ir': { type: 'boolean' },
      quality: { type: 'string' },
    },
  } as const);
}

async function writeNewFileAtomically(outputPath: string, data: Buffer): Promise<string> {
  const destination = resolve(outputPath);
  const temporary = join(
    dirname(destination),
    `.${basename(destination)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, 'wx');
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporary, destination);
    return destination;
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

export async function runCli(args: readonly string[]): Promise<number> {
  if (args[0] === 'mcp') {
    if (
      args.length !== 3 ||
      (args[1] !== '--stdio' && args[1] !== '--http') ||
      args[2] === undefined
    ) {
      emitFailure('USAGE_ERROR', USAGE);
      return 2;
    }

    let session: OpenChartDocumentSession;
    try {
      session = await OpenChartDocumentSession.open(args[2]);
    } catch (error: unknown) {
      persistenceFailure('DOCUMENT_LOAD_FAILED', error);
      return 1;
    }

    const kernel = new OpenChartToolKernel(session, renderDocumentScreenshot);
    try {
      if (args[1] === '--stdio') {
        serveOpenChartMcpStdio(kernel);
      } else {
        const host = await startOpenChartWindowsMcpHost(kernel);
        emit(
          {
            ok: true,
            transport: 'streamable-http',
            url: host.url,
            discoveryPath: host.discoveryPath,
          },
          process.stdout,
        );
        const shutdown = (): void => {
          void host.close().finally(() => {
            process.exitCode = 0;
          });
        };
        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);
      }
    } catch (error: unknown) {
      emitFailure('MCP_START_FAILED', boundedDetail(error));
      return 1;
    }
    return 0;
  }

  if (args[0] === 'export') {
    let parsed: ReturnType<typeof parseExportArgs>;
    try {
      parsed = parseExportArgs(args.slice(1));
    } catch (error: unknown) {
      emitFailure('USAGE_ERROR', `${USAGE} ${boundedDetail(error)}`);
      return 2;
    }
    const [formatValue, documentPath, outputPath] = parsed.positionals;
    if (
      parsed.positionals.length !== 3 ||
      formatValue === undefined ||
      !isDocumentExportFormat(formatValue) ||
      documentPath === undefined ||
      outputPath === undefined
    ) {
      emitFailure('USAGE_ERROR', USAGE);
      return 2;
    }

    let session: OpenChartDocumentSession;
    try {
      session = await OpenChartDocumentSession.open(documentPath);
    } catch (error: unknown) {
      persistenceFailure('DOCUMENT_LOAD_FAILED', error);
      return 1;
    }

    try {
      const artifact = await exportDocumentArtifact(session.document, {
        format: formatValue,
        ...(parsed.values.page === undefined ? {} : { pageId: parsed.values.page }),
        ...(parsed.values.scale === undefined
          ? {}
          : { scale: Number(parsed.values.scale) }),
        ...(parsed.values.transparent === true ? { transparent: true } : {}),
        ...(parsed.values['include-ir'] === true ? { includeIr: true } : {}),
        ...(parsed.values.quality === undefined
          ? {}
          : { jpegQuality: Number(parsed.values.quality) }),
      });
      const resolvedOutputPath = await writeNewFileAtomically(outputPath, artifact.data);
      emit(
        {
          ok: true,
          format: artifact.format,
          mimeType: artifact.mimeType,
          pageId: artifact.pageId,
          width: artifact.width,
          height: artifact.height,
          bytes: artifact.bytes,
          embeddedIr: artifact.embeddedIr,
          documentPath,
          outputPath: resolvedOutputPath,
        },
        process.stdout,
      );
      return 0;
    } catch (error: unknown) {
      if (error instanceof DocumentExportError) {
        emitFailure(error.code, error.message);
      } else {
        emitFailure(
          'EXPORT_WRITE_FAILED',
          `Could not write export ${JSON.stringify(outputPath)}: ${boundedDetail(error)}`,
        );
      }
      return 1;
    }
  }

  if (args.length !== 3 || args[0] !== 'apply') {
    emitFailure('USAGE_ERROR', USAGE);
    return 2;
  }

  const operationsPath = args[1];
  const documentPath = args[2];
  if (operationsPath === undefined || documentPath === undefined) {
    emitFailure('USAGE_ERROR', USAGE);
    return 2;
  }

  let operationsText: string;
  try {
    operationsText = await readFile(operationsPath, 'utf8');
  } catch (error: unknown) {
    emitFailure(
      'OPS_READ_FAILED',
      boundedDetail(`Could not read operations file ${JSON.stringify(operationsPath)}: ${boundedDetail(error)}`),
    );
    return 1;
  }

  let parsedOperations: unknown;
  try {
    parsedOperations = JSON.parse(operationsText);
  } catch (error: unknown) {
    emitFailure(
      'OPS_INVALID_JSON',
      boundedDetail(`Operations file ${JSON.stringify(operationsPath)} contains invalid JSON: ${boundedDetail(error)}`),
    );
    return 1;
  }

  const operationValidation = validateOperationEnvelope(parsedOperations);
  if (!operationValidation.ok) {
    emit({ ok: false, code: 'OPS_INVALID', diagnostics: operationValidation.diagnostics }, process.stderr);
    return 1;
  }

  let session: OpenChartDocumentSession;
  try {
    session = await OpenChartDocumentSession.open(documentPath);
  } catch (error: unknown) {
    persistenceFailure('DOCUMENT_LOAD_FAILED', error);
    return 1;
  }

  let result: Awaited<ReturnType<OpenChartDocumentSession['apply']>>;
  try {
    result = await session.apply(operationValidation.envelope, { dryRun: false });
  } catch (error: unknown) {
    emitFailure('UNEXPECTED_ERROR', boundedDetail(error));
    return 1;
  }

  if (!result.ok) {
    if (result.code === 'OPERATION_REJECTED') {
      emit(
        {
          ok: false,
          code: 'OPERATION_REJECTED',
          diagnostics: result.diagnostics ?? [],
        },
        process.stderr,
      );
    } else {
      emitFailure(
        result.code,
        result.message,
        result.persistenceCode === undefined
          ? {}
          : { persistenceCode: result.persistenceCode },
      );
    }
    return 1;
  }

  emit(
    {
      ok: true,
      rev: result.rev,
      replayed: result.replayed,
      recoveredFromBackup: session.recoveredFromBackup,
      recoveredTransactions: session.recoveredTransactions,
      documentPath,
      journalPath: journalPathFor(documentPath),
    },
    process.stdout,
  );
  return 0;
}

if (isEntryModule()) {
  void runCli(process.argv.slice(2)).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error: unknown) => {
      emitFailure('UNEXPECTED_ERROR', boundedDetail(error));
      process.exitCode = 1;
    },
  );
}
