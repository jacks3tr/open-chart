import { describe, expect, it } from 'vitest';
import { validateDocument } from '@openchart/ir';
import { OperationEngine } from '@openchart/ops';
import northstarInput from '../../../examples/northstar-integration.openchart.json';
import { LiveDocumentSession } from '../src/live-document-session.js';

function sessionFixture(eventLimit = 2) {
  const validation = validateDocument(northstarInput);
  if (!validation.ok) throw new Error('Invalid fixture');
  let engine = new OperationEngine(validation.document);
  const options = {
    getEngine: () => engine,
    replaceEngine: (next: OperationEngine) => { engine = next; },
    publish: () => undefined,
    persist: () => Promise.resolve(),
    setStatus: () => undefined,
    eventLimit,
  };
  return new LiveDocumentSession(options);
}

function edit(session: LiveDocumentSession, index: number): void {
  const id = Object.keys(session.document.nodes)[0];
  if (id === undefined) throw new Error('Fixture has no nodes');
  expect(session.applyLocal({
    txId: `retention-${index}`,
    actor: 'user',
    origin: 'gui',
    baseRev: session.document.rev,
    ops: [{ op: 'set_node_label', id, label: `Label ${index}` }],
  }).ok).toBe(true);
}

describe('live session journal retention', () => {
  it('bounds retained events while preserving sequence numbers and reporting lost history', async () => {
    const session = sessionFixture();
    for (let index = 0; index < 4; index += 1) edit(session, index);
    const result = await session.getOperations({ sinceRev: 0, limit: 10 });
    expect(result.events).toHaveLength(2);
    expect(result.events.map((event) => event.sequence)).toEqual([3, 4]);
    expect(result.truncated).toBe(true);
  });

  it('does not report a gap when the requested revision follows all evicted events', async () => {
    const session = sessionFixture();
    edit(session, 0);
    edit(session, 1);
    const sinceRev = session.document.rev;
    edit(session, 2);
    edit(session, 3);
    const result = await session.getOperations({ sinceRev, limit: 10 });
    expect(result.events).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });

  it('rejects an invalid journal retention limit', () => {
    expect(() => sessionFixture(0)).toThrow();
    expect(() => sessionFixture(-1)).toThrow();
    expect(() => sessionFixture(1.5)).toThrow();
  });
});
