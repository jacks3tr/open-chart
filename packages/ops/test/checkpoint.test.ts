import { describe, expect, it } from 'vitest';
import { validateDocument } from '@openchart/ir';
import northstarInput from '../../../examples/northstar-integration.openchart.json' with { type: 'json' };
import { OperationEngine, type OperationEnvelope } from '../src/index.js';

function fixture() {
  const result = validateDocument(northstarInput);
  if (!result.ok) throw new Error('Invalid fixture');
  return new OperationEngine(result.document);
}

function envelope(engine: OperationEngine, txId: string): OperationEnvelope {
  const id = Object.keys(engine.document.nodes)[0];
  if (id === undefined) throw new Error('Fixture has no nodes');
  return { txId, idempotencyKey: txId, actor: 'agent', origin: 'mcp', baseRev: engine.document.rev,
    ops: [{ op: 'set_node_label', id, label: txId }] };
}

describe('operation engine checkpoints', () => {
  it('restores document identity, redo history and replay keys after a failed mutation', () => {
    const engine = fixture();
    const first = envelope(engine, 'first');
    expect(engine.apply(first).ok).toBe(true);
    const second = envelope(engine, 'second');
    expect(engine.apply(second).ok).toBe(true);
    expect(engine.undo().ok).toBe(true);
    const before = engine.document;
    const history = engine.history;
    const restore = engine.checkpoint();
    const failed = envelope(engine, 'failed');
    expect(engine.apply(failed).ok).toBe(true);
    restore();
    expect(engine.document).toBe(before);
    expect(engine.history).toEqual(history);
    expect(engine.apply(first)).toMatchObject({ ok: true, replayed: true });
    expect(engine.redo().ok).toBe(true);
    expect(engine.apply(second)).toMatchObject({ ok: true, replayed: true });
    expect(engine.apply({ ...failed, baseRev: engine.document.rev })).toMatchObject({ ok: true, replayed: false });
  });

  it('restores after undo and redo without retaining mutable caller transactions', () => {
    const engine = fixture();
    const original = envelope(engine, 'original');
    expect(engine.apply(original).ok).toBe(true);
    const before = engine.document;
    const restoreUndo = engine.checkpoint();
    expect(engine.undo().ok).toBe(true);
    restoreUndo();
    expect(engine.document).toBe(before);
    expect(engine.apply(original)).toMatchObject({ ok: true, replayed: true });
    engine.undo();
    const undone = engine.document;
    const restoreRedo = engine.checkpoint();
    engine.redo();
    restoreRedo();
    expect(engine.document).toBe(undone);
    expect(engine.history.redoStack).toHaveLength(1);
  });
});
