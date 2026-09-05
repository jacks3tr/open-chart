import { describe, expect, it, vi } from 'vitest';
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


describe('live session mutation isolation', () => {
  it('blocks a document switch as soon as an agent mutation is queued', async () => {
    let engine = new OperationEngine(fixture());
    let release!: () => void;
    const save = new Promise<void>((resolve) => { release = resolve; });
    const session = new LiveDocumentSession({
      getEngine: () => engine,
      replaceEngine: (next) => { engine = next; },
      publish: () => undefined,
      persist: () => save,
      setStatus: () => undefined,
    });
    const id = Object.keys(engine.document.nodes)[0];
    if (id === undefined) throw new Error('Fixture has no nodes');
    const pending = session.apply({ txId: 'pending', actor: 'agent', origin: 'mcp', baseRev: session.document.rev,
      ops: [{ op: 'set_node_label', id, label: 'Saved' }] });
    expect(() => session.reset(new OperationEngine(fixture()))).toThrow('saving');
    expect(session.undoLocal().ok).toBe(false);
    await Promise.resolve();
    expect(() => session.reset(new OperationEngine(fixture()))).toThrow('saving');
    release();
    expect((await pending).ok).toBe(true);
    expect(() => session.reset(new OperationEngine(fixture()))).not.toThrow();
  });

  it('does not clone full history before an agent mutation or rollback', async () => {
    const engine = new OperationEngine(fixture());
    const historyRead = vi.spyOn(engine, 'history', 'get');
    const before = engine.document;
    const session = new LiveDocumentSession({
      getEngine: () => engine,
      replaceEngine: () => { throw new Error('Rollback must keep the engine'); },
      publish: () => undefined,
      persist: () => Promise.reject(new Error('disk full')),
      setStatus: () => undefined,
    });
    const id = Object.keys(engine.document.nodes)[0];
    if (id === undefined) throw new Error('Fixture has no nodes');
    const result = await session.apply({ txId: 'failed', actor: 'agent', origin: 'mcp', baseRev: session.document.rev,
      ops: [{ op: 'set_node_label', id, label: 'Not saved' }] });
    expect(result).toMatchObject({ ok: false, code: 'PERSISTENCE_FAILED' });
    expect(engine.document).toBe(before);
    expect(historyRead).not.toHaveBeenCalled();
  });
});
