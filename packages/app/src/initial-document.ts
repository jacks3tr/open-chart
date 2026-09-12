import type { OpenChartDocument } from '@openchart/ir';

export function createBlankInitialDocument(document: OpenChartDocument): OpenChartDocument {
  return {
    ...document,
    title: 'Untitled diagram',
    rev: 0,
    nodes: {},
    ports: {},
    edges: {},
    layout: {
      ...document.layout,
      options: { ...document.layout.options, showDocumentChrome: false },
      overrides: {},
      edgeOverrides: {},
      derived: null,
    },
  };
}
