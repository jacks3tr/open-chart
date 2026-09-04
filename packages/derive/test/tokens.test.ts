import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { validateDocument } from '@openchart/ir';
import { OperationEngine } from '@openchart/ops';

import {
  TOKEN_PRESET_IDS,
  TOKEN_PRESETS,
  compileTokenOperations,
} from '../src/index.js';

const fixturePath = fileURLToPath(
  new URL('../../../examples/northstar-integration.openchart.json', import.meta.url),
);

describe('token presets', () => {
  test('resolves all six presets deterministically and becomes a no-op after application', () => {
    const input: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const validation = validateDocument(input);
    if (!validation.ok) {
      throw new Error(`Invalid token fixture: ${JSON.stringify(validation.diagnostics)}`);
    }

    expect(TOKEN_PRESET_IDS).toEqual([
      'openchart-light',
      'openchart-dark',
      'aws-official',
      'azure-official',
      'mono-print',
      'high-contrast',
    ]);
    for (const presetId of TOKEN_PRESET_IDS) {
      const preset = TOKEN_PRESETS[presetId];
      const canvas = preset.tokens.canvas;
      const textHi = preset.tokens.textHi;
      expect(typeof canvas).toBe('string');
      expect(typeof textHi).toBe('string');
      if (typeof canvas === 'string' && typeof textHi === 'string') {
        expect(canvas).toMatch(/^#[0-9A-F]{6}$/);
        expect(textHi).toMatch(/^#[0-9A-F]{6}$/);
      }
    }

    const engine = new OperationEngine(validation.document);
    const operations = compileTokenOperations(engine.document, 'openchart-dark');
    expect(operations[0]).toMatchObject({
      op: 'set_theme',
      theme: { presetId: 'openchart-dark' },
    });
    expect(
      engine.apply({
        txId: 'tx.theme-dark',
        actor: 'user',
        origin: 'beauty',
        baseRev: 0,
        ops: operations,
      }),
    ).toMatchObject({ ok: true, rev: 1 });
    expect(engine.document.theme?.presetId).toBe('openchart-dark');
    expect(compileTokenOperations(engine.document, 'openchart-dark')).toEqual([]);
  });
});
