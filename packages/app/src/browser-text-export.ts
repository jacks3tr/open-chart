import type { OpenChartDocument } from '@openchart/ir';
import { exportDocumentToD2, exportDocumentToMermaid, type TextProjectionLoss } from '@openchart/serialize';

export interface BrowserTextExport {
  readonly content: string;
  readonly extension: 'd2' | 'mmd';
  readonly mimeType: 'text/plain;charset=utf-8';
  readonly losses: readonly TextProjectionLoss[];
}

export function createBrowserTextExport(document: OpenChartDocument, format: 'd2' | 'mermaid', pageId?: string): BrowserTextExport {
  const options = pageId === undefined ? {} : { pageId };
  const projection = format === 'd2' ? exportDocumentToD2(document, options) : exportDocumentToMermaid(document, options);
  return { content: projection.content, extension: format === 'd2' ? 'd2' : 'mmd', mimeType: 'text/plain;charset=utf-8', losses: projection.losses };
}
