import { describe, expect, test } from 'vitest';

import {
  WINDOWS_COMMANDS,
  resolveShortcut,
  searchCommands,
  validateCommandRegistry,
  type CommandDefinition,
} from '../src/index.js';

describe('Windows command registry', () => {
  test('resolves modifier-specific chords and produces searchable overlay entries', () => {
    expect(resolveShortcut({ key: 'z', ctrl: true, shift: true })?.id).toBe('redo');
    expect(resolveShortcut({ key: 'F1' })?.id).toBe('show-shortcuts');
    expect(resolveShortcut({ key: 'c' })?.id).toBe('connector-tool');
    expect(resolveShortcut({ key: 'r', ctrl: true, alt: true })?.id).toBe(
      'reroute-selection',
    );
    expect(resolveShortcut({ key: 'o', ctrl: true, alt: true })?.id).toBe(
      'toggle-obstacle-avoidance',
    );
    expect(resolveShortcut({ key: 'ArrowUp', shift: true })?.id).toBe(
      'fine-nudge-up',
    );
    expect(resolveShortcut({ key: 'c', ctrl: true, alt: true })?.id).toBe(
      'copy-style',
    );
    expect(resolveShortcut({ key: 'o', ctrl: true })?.id).toBe('open-document');
    expect(resolveShortcut({ key: 's', ctrl: true })?.id).toBe('save-document');
    expect(resolveShortcut({ key: 's', ctrl: true, shift: true })?.id).toBe('save-document-as');
    expect(resolveShortcut({ key: 'u', ctrl: true })?.id).toBe('underline');
    expect(resolveShortcut({ key: 'h', ctrl: true, shift: true })?.id).toBe(
      'distribute-horizontal',
    );
    expect(resolveShortcut({ key: 'v', ctrl: true, alt: true, shift: true })?.id).toBe(
      'distribute-vertical',
    );
    expect(resolveShortcut({ key: 'e', ctrl: true, shift: true })?.id).toBe(
      'equal-spacing',
    );
    expect(searchCommands('paste').map((command) => command.id)).toEqual([
      'paste',
      'paste-in-place',
      'paste-style',
    ]);
    expect(WINDOWS_COMMANDS.find((command) => command.id === 'redo')?.shortcuts).toEqual([
      'Ctrl+Y',
      'Ctrl+Shift+Z',
    ]);
    expect(
      WINDOWS_COMMANDS.find((command) => command.id === 'reroute-selection'),
    ).not.toMatchObject({ available: false });
    expect(
      WINDOWS_COMMANDS.find((command) => command.id === 'beauty-pass'),
    ).not.toMatchObject({ available: false });
  });

  test('rejects duplicate chords and suppresses canvas commands while editing text', () => {
    const duplicates: readonly CommandDefinition[] = [
      {
        id: 'first',
        label: 'First',
        category: 'Test',
        shortcuts: ['Ctrl+K'],
      },
      {
        id: 'second',
        label: 'Second',
        category: 'Test',
        shortcuts: ['Ctrl+K'],
      },
    ];
    expect(() => validateCommandRegistry(duplicates)).toThrow(
      'Shortcut Ctrl+K is assigned to both first and second',
    );

    expect(resolveShortcut({ key: 'v' }, { textEditing: true })).toBeUndefined();
    expect(resolveShortcut({ key: 'b', ctrl: true }, { textEditing: true })?.id).toBe(
      'bold',
    );
    expect(resolveShortcut({ key: 'u', ctrl: true }, { textEditing: true })?.id).toBe(
      'underline',
    );
    expect(resolveShortcut({ key: 'f', ctrl: true }, { textEditing: true })?.id).toBe(
      'find',
    );
    expect(resolveShortcut({ key: 'F3' }, { textEditing: true })?.id).toBe(
      'find-next',
    );
    expect(
      resolveShortcut({ key: 'F3', shift: true }, { textEditing: true })?.id,
    ).toBe('find-previous');
  });
});
