import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateDocument } from '@openchart/ir';
import { OperationEngine } from '@openchart/ops';
import { buildSceneDescription } from '@openchart/scene';
import { previewDocument } from '../src/openchart-editor.js';

describe('transform preview structural sharing', () => {
  it('copies only changed layout paths and preserves the frozen canonical document', () => {
    const parsed = validateDocument(JSON.parse(readFileSync(new URL(
      '../../../examples/northstar-integration.openchart.json', import.meta.url), 'utf8')));
    if (!parsed.ok) throw new Error('Invalid fixture');
    const document = new OperationEngine(parsed.document).document;
    const before = JSON.stringify(document);
    const id = Object.keys(document.nodes)[0]!;
    const other = Object.keys(document.nodes)[1]!;
    const frame = { x: 300, y: 400, width: 120, height: 80, rotation: 15 };
    const next = previewDocument(document, { selectionBounds: frame, updates: { [id]: frame } });
    expect(next).not.toBe(document);
    expect(next.nodes).toBe(document.nodes);
    expect(next.ports).toBe(document.ports);
    expect(next.edges).toBe(document.edges);
    expect(next.styles).toBe(document.styles);
    expect(next.layout).not.toBe(document.layout);
    expect(next.layout.overrides).not.toBe(document.layout.overrides);
    expect(next.layout.overrides[other]).toBe(document.layout.overrides[other]);
    expect(next.layout.overrides[id]).toMatchObject({ ...frame, pinned: true });
    buildSceneDescription(next, { routingStrategy: 'fast' });
    expect(JSON.stringify(document)).toBe(before);
    expect(previewDocument(document, null)).toBe(document);
  });
});
