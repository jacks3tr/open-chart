import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateDocument, type OpenChartDocument } from '@openchart/ir';
import { exportDocumentToOpenChartCode, parseOpenChartCode, OPENCHART_CODE_EXAMPLE, renderDocumentToSvg } from '../src/index.js';

function fixture(): OpenChartDocument {
  const input: unknown = JSON.parse(readFileSync(new URL('../../../examples/northstar-integration.openchart.json', import.meta.url), 'utf8'));
  const result = validateDocument(input);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.document;
}

describe('native OpenChart code', () => {
  it('creates an editable diagram from node and arrow statements with deterministic defaults', () => {
    const document = parseOpenChartCode(OPENCHART_CODE_EXAMPLE);
    expect(document).toEqual(parseOpenChartCode(OPENCHART_CODE_EXAMPLE));
    expect(Object.keys(document.nodes)).toEqual(['api', 'database']);
    expect(document.nodes.api).toMatchObject({ label: 'API', kind: 'service', pageId: 'page.main', layerId: 'layer.main' });
    expect(document.edges.query).toMatchObject({ fromPortId: 'api.connection', toPortId: 'database.connection', label: 'SQL' });
    expect(document.ports['database.connection']).toMatchObject({ nodeId: 'database', side: 'auto', direction: 'both' });
    expect(document.layout.overrides.api).toEqual({ x: 80, y: 120, width: 200, height: 120 });
    expect(parseOpenChartCode(exportDocumentToOpenChartCode(document))).toEqual(document);
  });

  it.each(['#FFF4E6', null])('preserves every field and SVG across code reload with background %s', (backgroundColor) => {
    const document = fixture();
    const page = document.pages['page.architecture'];
    if (page === undefined) throw new Error('Missing fixture page');
    page.backgroundColor = backgroundColor;
    page.color = '#7C3AED';
    document.theme = { presetId: 'custom', tokens: { color: '#abc' } };
    const node = document.nodes['system.northstar'];
    if (node === undefined) throw new Error('Missing fixture node');
    node.label = 'Quotes " and backslash \\ \n Unicode: 日本語\u2028line\u2029paragraph';
    node.data = { ...node.data, libraryShapeId: 'flowchart.process', fillColor: '#abcdef', fontSize: 18, opacity: 0.65, url: 'https://example.com/?a=1&b=2' };
    document.layout.overrides[node.id] = { x: -12.375, y: 40.125, width: 240, height: 120, rotation: 17.5, zIndex: 7, pinned: true };
    const edge = Object.values(document.edges)[0];
    if (edge === undefined) throw new Error('Missing fixture edge');
    edge.routing = { mode: 'curved', lineStyle: 'dotted', startMarker: 'diamond', endMarker: 'crow-foot', cornerRadius: 13, jumpStyle: 'gap', lineWidth: 2.5 };
    document.layout.edgeOverrides = { [edge.id]: { waypoints: [{ x: 12.5, y: 75 }], labelT: 0.32, labelPlacement: 'below', labelOffset: -7 } };
    document.layout.options = { spacing: 24, direction: 'RIGHT' };
    const code = exportDocumentToOpenChartCode(document);
    const reloaded = parseOpenChartCode(code);
    expect(reloaded).toEqual(document);
    expect(exportDocumentToOpenChartCode(reloaded)).toBe(code);
    expect(renderDocumentToSvg(reloaded)).toBe(renderDocumentToSvg(document));
  });

  it('preserves empty maps and optional layout fields without injecting defaults', () => {
    const empty = { ...fixture(), pages: {}, layers: {}, nodes: {}, ports: {}, edges: {}, styles: {}, layout: { overrides: {}, derived: null, edgeOverrides: {} } };
    expect(parseOpenChartCode(exportDocumentToOpenChartCode(empty))).toEqual(empty);
  });

  it.each([
    ['openchart 2', /line 1.*openchart 1/],
    ['openchart 1\nnode a\nnode a', /line 3.*Duplicate/],
    ['openchart 1\nnode a {"kind":"service","typo":1}', /line 2.*typo/],
    ['openchart 1\nnode a {"uid":null}', /line 2.*uid/],
    ['openchart 1\nnode a\nedge e a -> missing', /line 3.*Unknown/],
    ['openchart 1\nnode a\nplace a {"width":-1}', /line 3.*width/],
    ['openchart 1\nnode a {"parentId":"missing"}', /line 2.*parentId/],
    ['openchart 1\nnode a {"id":"b"}', /line 2.*ID/],
    ['openchart 1\nlayout {"overrides":null}', /JSON object/],
  ])('rejects malformed or invalid source with a line number: %s', (source, error) => {
    expect(() => parseOpenChartCode(source)).toThrow(error);
  });
});
