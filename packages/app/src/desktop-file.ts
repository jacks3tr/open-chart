import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { validateDocument, type OpenChartDocument } from '@openchart/ir';

export interface DesktopDocumentFile {
  readonly path: string;
  readonly document: OpenChartDocument;
}

export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function parseDesktopDocument(contents: string): OpenChartDocument {
  let input: unknown;
  try {
    input = JSON.parse(contents);
  } catch {
    throw new Error('The selected file is not valid JSON');
  }
  const validation = validateDocument(input);
  if (!validation.ok) {
    const detail = validation.diagnostics
      .slice(0, 3)
      .map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`)
      .join('; ');
    throw new Error(`The selected file is not a valid OpenChart document: ${detail}`);
  }
  return validation.document;
}

export function serializeOpenChartDocument(document: OpenChartDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export async function openDesktopDocument(): Promise<DesktopDocumentFile | undefined> {
  const path = await open({
    title: 'Open an OpenChart document',
    multiple: false,
    directory: false,
    filters: [{ name: 'OpenChart document', extensions: ['json'] }],
  });
  if (path === null) {
    return undefined;
  }
  const contents = await invoke<string>('read_document', { path });
  return { path, document: parseDesktopDocument(contents) };
}

export async function saveDesktopDocument(
  document: OpenChartDocument,
  path: string | undefined,
  suggestedName: string,
): Promise<string | undefined> {
  const target = path ?? await save({
    title: 'Save the OpenChart document',
    defaultPath: `${suggestedName}.openchart.json`,
    filters: [{ name: 'OpenChart document', extensions: ['json'] }],
  });
  if (target === null) {
    return undefined;
  }
  await writeDesktopDocument(document, target);
  return target;
}

export async function writeDesktopDocument(
  document: OpenChartDocument,
  path: string,
): Promise<void> {
  await invoke('write_document', {
    path,
    contents: serializeOpenChartDocument(document),
  });
}
