import type { OpenChartDocument } from '@openchart/ir';
import { exportDocumentToD2, exportDocumentToMermaid, exportDocumentToOpenChartCode, type TextProjectionLoss } from '@openchart/serialize';

export interface BrowserTextExport {
  readonly content: string;
  readonly extension: 'd2' | 'mmd' | 'openchart';
  readonly mimeType: 'text/plain;charset=utf-8';
  readonly losses: readonly TextProjectionLoss[];
}

export function createBrowserTextExport(document: OpenChartDocument, format: 'd2' | 'mermaid' | 'openchart', pageId?: string): BrowserTextExport {
  if (format === 'openchart') return { content: exportDocumentToOpenChartCode(document), extension: 'openchart', mimeType: 'text/plain;charset=utf-8', losses: [] };
  const options = pageId === undefined ? {} : { pageId };
  const projection = format === 'd2' ? exportDocumentToD2(document, options) : exportDocumentToMermaid(document, options);
  return { content: projection.content, extension: format === 'd2' ? 'd2' : 'mmd', mimeType: 'text/plain;charset=utf-8', losses: projection.losses };
}
