import { describe, expect, it } from 'vitest';
import northstarInput from '../../../examples/northstar-integration.openchart.json';
import { validateDocument, type OpenChartDocument } from '@openchart/ir';
import { OperationEngine } from '@openchart/ops';

import { LiveDocumentSession } from '../src/live-document-session.js';

function fixture(): OpenChartDocument {
  const validation = validateDocument(northstarInput);
  if (!validation.ok) throw new Error('Fixture is invalid');
  return validation.document;
}

describe('live document session', () => {
  it('routes GUI and agent edits through one engine and operation history', async () => {
    let engine = new OperationEngine(fixture());
    let published = engine.document;
    let persisted: OpenChartDocument | undefined;
    const session = new LiveDocumentSession({
      getEngine: () => engine,
      replaceEngine: (next) => { engine = next; },
      publish: (document) => { published = document; },
      persist: (document) => {
        persisted = document;
        return Promise.resolve();
      },
      setStatus: () => undefined,
    });
    const nodeId = Object.keys(engine.document.nodes)[0];
    expect(nodeId).toBeDefined();
    if (nodeId === undefined) return;

    const local = session.applyLocal({
      txId: 'gui-label',
      actor: 'user',
      origin: 'gui',
      baseRev: session.document.rev,
      ops: [{ op: 'set_node_label', id: nodeId, label: 'GUI label' }],
    });
    expect(local.ok).toBe(true);

    const agent = await session.apply({
      txId: 'mcp-label',
      actor: 'agent',
      origin: 'mcp',
      baseRev: session.document.rev,
      ops: [{ op: 'set_node_label', id: nodeId, label: 'MCP label' }],
    }, { dryRun: false });

    expect(agent.ok).toBe(true);
    expect(engine.document.nodes[nodeId]?.label).toBe('MCP label');
    expect(published.nodes[nodeId]?.label).toBe('MCP label');
    expect(persisted?.nodes[nodeId]?.label).toBe('MCP label');
    expect(session.history.undoStack).toHaveLength(2);
    await expect(session.getOperations({ sinceRev: 0, limit: 10 })).resolves.toMatchObject({
      truncated: false,
      events: [
        { action: 'commit', envelope: { txId: 'gui-label' } },
        { action: 'commit', envelope: { txId: 'mcp-label' } },
      ],
    });
  });

  it('restores the exact document and history when native persistence fails', async () => {
    let engine = new OperationEngine(fixture());
    const before = engine.document;
    const session = new LiveDocumentSession({
      getEngine: () => engine,
      replaceEngine: (next) => { engine = next; },
      publish: () => undefined,
      persist: () => Promise.reject(new Error('disk full')),
      setStatus: () => undefined,
    });
    const nodeId = Object.keys(before.nodes)[0];
    if (nodeId === undefined) throw new Error('Fixture has no node');

    const result = await session.apply({
      txId: 'mcp-failed-save',
      actor: 'agent',
      origin: 'mcp',
      baseRev: before.rev,
      ops: [{ op: 'set_node_label', id: nodeId, label: 'Must roll back' }],
    }, { dryRun: false });

    expect(result).toMatchObject({ ok: false, code: 'PERSISTENCE_FAILED' });
    expect(engine.document).toEqual(before);
    expect(session.history.undoStack).toHaveLength(0);
  });
});
