import { invoke } from '@tauri-apps/api/core';
import { open, save, confirm } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { validateDocument, type OpenChartDocument } from '@openchart/ir';
import { safeHttpUrl } from '@openchart/scene';
import { exportDocumentToOpenChartCode, parseOpenChartCode } from '@openchart/serialize';

export async function guardDesktopClose(isDirty: () => boolean): Promise<() => void> {
  const window = getCurrentWindow();
  let asking = false;
  return window.onCloseRequested(async (event) => {
    if (!isDirty()) return;
    event.preventDefault();
    if (asking) return;
    asking = true;
    try {
      if (await confirm('Discard unsaved changes and close OpenChart?', {
        title: 'Unsaved changes', kind: 'warning', okLabel: 'Discard and close', cancelLabel: 'Keep editing',
      })) await window.destroy();
    } finally { asking = false; }
  });
}

export async function openExternalLink(value: string): Promise<void> {
  const url = safeHttpUrl(value);
  if (url === undefined) throw new Error('Enter a complete HTTP or HTTPS URL');
  if (isDesktopRuntime()) await invoke('open_external_link', { url });
  else window.open(url, '_blank', 'noopener,noreferrer');
}

export async function saveDesktopExport(blob: Blob, filename: string): Promise<boolean> {
  const extension = filename.split('.').at(-1)!;
  const path = await save({ title: 'Export diagram', defaultPath: filename,
    filters: [{ name: `${extension.toUpperCase()} file`, extensions: [extension] }] });
  if (path === null) return false;
  await invoke('write_export', { path, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) });
  return true;
}

export interface DesktopDocumentFile {
  readonly path: string;
  readonly document: OpenChartDocument;
}

export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function parseDesktopDocument(contents: string): OpenChartDocument {
  if (!contents.trimStart().startsWith('{')) return parseOpenChartCode(contents);
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

export function serializeOpenChartDocument(document: OpenChartDocument, format: 'json' | 'openchart' = 'json'): string {
  if (format === 'openchart') return exportDocumentToOpenChartCode(document);
  return `${JSON.stringify(document, null, 2)}\n`;
}

export async function openDesktopDocument(): Promise<DesktopDocumentFile | undefined> {
  const path = await open({
    title: 'Open an OpenChart document',
    multiple: false,
    directory: false,
    filters: [{ name: 'OpenChart document', extensions: ['json', 'openchart'] }],
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
    contents: serializeOpenChartDocument(document, path.toLowerCase().endsWith('.openchart') ? 'openchart' : 'json'),
  });
}
