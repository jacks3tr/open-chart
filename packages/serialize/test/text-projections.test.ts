import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateDocument } from '@openchart/ir';
import { describe, expect, it } from 'vitest';

import {
  exportDocumentToD2,
  exportDocumentToMermaid,
  parseOpenChartD2,
} from '../src/index.js';

const repositoryRoot = dirname(
  dirname(dirname(fileURLToPath(new URL('.', import.meta.url)))),
);

describe('OpenChart text projections', () => {
  it('round-trips the canonical D2 subset and reports Mermaid losses', async () => {
    const parsed: unknown = JSON.parse(
      await readFile(
        join(repositoryRoot, 'examples', 'northstar-integration.openchart.json'),
        'utf8',
      ),
    );
    const validation = validateDocument(parsed);
    if (!validation.ok) throw new Error('Northstar fixture is invalid');
    const document = validation.document;

    const d2 = exportDocumentToD2(document, { pageId: 'page.architecture' });
    expect(parseOpenChartD2(d2.content)).toEqual({
      nodes: Object.values(document.nodes)
        .map(({ id, label, kind, parentId }) => ({
          id,
          label,
          kind,
          ...(parentId === undefined ? {} : { parentId }),
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      ports: Object.values(document.ports)
        .map(({ id, nodeId, direction, side, order }) => ({
          id,
          nodeId,
          direction,
          side,
          ...(order === undefined ? {} : { order }),
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      edges: Object.values(document.edges)
        .map(({ id, fromPortId, toPortId, label, semantic }) => ({
          id,
          fromPortId,
          toPortId,
          label,
          semantic,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    });

    const mermaid = exportDocumentToMermaid(document, {
      pageId: 'page.architecture',
    });
    expect(mermaid.content).toContain('flowchart LR');
    expect(mermaid.losses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PORTS_OMITTED', count: 14 }),
        expect.objectContaining({ code: 'NODE_KIND_OMITTED', count: 6 }),
        expect.objectContaining({ code: 'SEMANTICS_OMITTED', count: 7 }),
      ]),
    );
  });
});
