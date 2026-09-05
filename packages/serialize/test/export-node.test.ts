import { readFileSync } from 'node:fs';

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { validateDocument } from '@openchart/ir';

import {
  exportDocumentArtifact,
  type DocumentExportError,
} from '../src/export-node.js';

const document = (() => {
  const northstarInput: unknown = JSON.parse(
    readFileSync(
      new URL('../../../examples/northstar-integration.openchart.json', import.meta.url),
      'utf8',
    ),
  );
  const result = validateDocument(northstarInput);
  if (!result.ok) {
    throw new Error(`Invalid Northstar fixture: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.document;
})();

describe('SceneDescription file export', () => {
  it.each(['svg', 'png', 'jpeg', 'pdf', 'pptx'] as const)(
    'emits %s without mutating the canonical document', async (format) => {
      const before = JSON.stringify(document);
      const artifact = await exportDocumentArtifact(document, {
        format,
        altText: 'Northstar architecture diagram with connected production systems.',
        ...(format === 'svg' ? { includeIr: true } : {}),
      });
      switch (format) {
        case 'svg':
          expect(artifact.data.toString('utf8')).toMatch(
            /^<svg data-openchart-schema-version="1" data-openchart-ir="[A-Za-z0-9_-]+" /);
          expect(artifact.embeddedIr).toBe(true);
          break;
        case 'png':
          expect(artifact.data.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
          break;
        case 'jpeg':
          expect(artifact.data.subarray(0, 2).toString('hex')).toBe('ffd8');
          expect(artifact.data.subarray(-2).toString('hex')).toBe('ffd9');
          break;
        case 'pdf':
          expect(artifact.data.subarray(0, 5).toString('ascii')).toBe('%PDF-');
          expect(artifact.data.includes(Buffer.from('/StructTreeRoot'))).toBe(true);
          expect(artifact.data.includes(Buffer.from('/Figure'))).toBe(true);
          break;
        case 'pptx': {
          const presentation = await JSZip.loadAsync(artifact.data);
          const slide = await presentation.file('ppt/slides/slide1.xml')?.async('string');
          const vector = await presentation.file('ppt/media/image1.svg')?.async('string');
          expect(slide).toContain('asvg:svgBlip');
          expect(slide).toContain('descr="Northstar architecture diagram with connected production systems."');
          expect(vector).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
          expect(vector).not.toContain('data-openchart-ir');
          break;
        }
      }
      expect(JSON.stringify(document)).toBe(before);
    },
  );

  it('rejects a raster request that would exceed the memory budget', async () => {
    await expect(
      exportDocumentArtifact(document, { format: 'png', scale: 16 }),
    ).rejects.toMatchObject({
      name: 'DocumentExportError',
      code: 'EXPORT_TOO_LARGE',
    } satisfies Partial<DocumentExportError>);
  });

  it('preserves professional connector start and end markers in SVG export', async () => {
    const notationDocument = structuredClone(document);
    const edge = notationDocument.edges['edge.ingress-audit'];
    if (edge === undefined) {
      throw new Error('Expected connector fixture edge');
    }
    edge.routing = {
      ...(edge.routing ?? { mode: 'orthogonal' }),
      startMarker: 'diamond',
      endMarker: 'crow-foot',
    };

    const artifact = await exportDocumentArtifact(notationDocument, { format: 'svg' });
    const svg = artifact.data.toString('utf8');

    expect(svg).toContain('marker-start="url(#oc-marker-start-');
    expect(svg).toContain('marker-end="url(#oc-marker-end-');
    expect(svg).toContain('M 9 5 L 5 1 L 1 5 L 5 9 Z');
    expect(svg).toContain('M 1 5 L 9 1 M 1 5 L 9 5 M 1 5 L 9 9');
  });
});
