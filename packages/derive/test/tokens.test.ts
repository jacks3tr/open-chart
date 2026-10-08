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
  test.each(['openchart-light', 'openchart-dark'] as const)('%s keeps text and semantic labels readable on their surfaces', (id) => {
    const tokens = TOKEN_PRESETS[id].tokens;
    const luminance = (hex: string): number => {
      const channels = [1, 3, 5].map((offset) => {
        const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
    };
    const pairs = [
      ...['textHi', 'textMid', 'textLo'].flatMap((text) =>
        ['canvas', 'surface', 'surfaceAlt'].map((surface) => [text, surface] as const)),
      ...['compute', 'storage', 'data', 'network', 'identity', 'external'].map((role) => [role, `${role}Tint`] as const),
    ];
    for (const [foreground, background] of pairs) {
      const ink = tokens[foreground];
      const paper = tokens[background];
      if (typeof ink !== 'string' || typeof paper !== 'string') throw new Error('Missing color token');
      const a = luminance(ink);
      const b = luminance(paper);
      expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });

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
