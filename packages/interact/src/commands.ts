export interface CommandDefinition {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly shortcuts: readonly string[];
  readonly allowInText?: boolean;
  readonly available?: boolean;
  readonly unavailableReason?: string;
}

export interface ShortcutInput {
  readonly key: string;
  readonly ctrl?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
}

export interface ShortcutContext {
  readonly textEditing?: boolean;
}

export const WINDOWS_COMMANDS = [
  { id: 'open-document', label: 'Open document', category: 'File', shortcuts: ['Ctrl+O'], allowInText: true },
  { id: 'save-document', label: 'Save document', category: 'File', shortcuts: ['Ctrl+S'], allowInText: true },
  { id: 'save-document-as', label: 'Save document as', category: 'File', shortcuts: ['Ctrl+Shift+S'], allowInText: true },
  { id: 'select-tool', label: 'Select tool', category: 'Tools', shortcuts: ['V'] },
  { id: 'connector-tool', label: 'Connector tool', category: 'Tools', shortcuts: ['C'] },
  {
    id: 'deselect',
    label: 'Deselect or exit text editing',
    category: 'Edit',
    shortcuts: ['Escape'],
    allowInText: true,
  },
  { id: 'shape-manager', label: 'Shape manager', category: 'Tools', shortcuts: ['M'] },
  { id: 'pan', label: 'Pan canvas', category: 'View', shortcuts: ['Space'] },
  { id: 'zoom-in', label: 'Zoom in', category: 'View', shortcuts: ['Ctrl+=', 'Ctrl++'] },
  { id: 'zoom-out', label: 'Zoom out', category: 'View', shortcuts: ['Ctrl+-'] },
  { id: 'zoom-reset', label: 'Reset zoom', category: 'View', shortcuts: ['Ctrl+0'] },
  { id: 'undo', label: 'Undo', category: 'Edit', shortcuts: ['Ctrl+Z'] },
  { id: 'redo', label: 'Redo', category: 'Edit', shortcuts: ['Ctrl+Y', 'Ctrl+Shift+Z'] },
  { id: 'cut', label: 'Cut', category: 'Edit', shortcuts: ['Ctrl+X'] },
  { id: 'copy', label: 'Copy', category: 'Edit', shortcuts: ['Ctrl+C'] },
  { id: 'paste', label: 'Paste', category: 'Edit', shortcuts: ['Ctrl+V'] },
  {
    id: 'paste-in-place',
    label: 'Paste in place',
    category: 'Edit',
    shortcuts: ['Ctrl+Shift+V'],
  },
  { id: 'duplicate', label: 'Duplicate', category: 'Edit', shortcuts: ['Ctrl+D'] },
  { id: 'delete-selection', label: 'Delete selection', category: 'Edit', shortcuts: ['Delete', 'Backspace'] },
  { id: 'select-all', label: 'Select all', category: 'Edit', shortcuts: ['Ctrl+A'] },
  {
    id: 'copy-style',
    label: 'Copy text style',
    category: 'Format',
    shortcuts: ['Ctrl+Alt+C'],
  },
  {
    id: 'paste-style',
    label: 'Paste text style',
    category: 'Format',
    shortcuts: ['Ctrl+Alt+V'],
  },
  {
    id: 'bold',
    label: 'Bold',
    category: 'Text',
    shortcuts: ['Ctrl+B'],
    allowInText: true,
  },
  {
    id: 'italic',
    label: 'Italic',
    category: 'Text',
    shortcuts: ['Ctrl+I'],
    allowInText: true,
  },
  {
    id: 'underline',
    label: 'Underline',
    category: 'Text',
    shortcuts: ['Ctrl+U'],
    allowInText: true,
  },
  {
    id: 'link',
    label: 'Add or edit link',
    category: 'Text',
    shortcuts: ['Ctrl+K'],
    allowInText: true,
  },
  {
    id: 'font-size-up',
    label: 'Increase font size',
    category: 'Text',
    shortcuts: ['Ctrl+Shift+>'],
    allowInText: true,
  },
  {
    id: 'font-size-down',
    label: 'Decrease font size',
    category: 'Text',
    shortcuts: ['Ctrl+Shift+<'],
    allowInText: true,
  },
  { id: 'edit-text', label: 'Edit text', category: 'Text', shortcuts: ['F2'] },
  { id: 'nudge-up', label: 'Nudge up', category: 'Arrange', shortcuts: ['ArrowUp'] },
  { id: 'nudge-right', label: 'Nudge right', category: 'Arrange', shortcuts: ['ArrowRight'] },
  { id: 'nudge-down', label: 'Nudge down', category: 'Arrange', shortcuts: ['ArrowDown'] },
  { id: 'nudge-left', label: 'Nudge left', category: 'Arrange', shortcuts: ['ArrowLeft'] },
  {
    id: 'fine-nudge-up',
    label: 'Fine nudge up',
    category: 'Arrange',
    shortcuts: ['Shift+ArrowUp'],
  },
  {
    id: 'fine-nudge-right',
    label: 'Fine nudge right',
    category: 'Arrange',
    shortcuts: ['Shift+ArrowRight'],
  },
  {
    id: 'fine-nudge-down',
    label: 'Fine nudge down',
    category: 'Arrange',
    shortcuts: ['Shift+ArrowDown'],
  },
  {
    id: 'fine-nudge-left',
    label: 'Fine nudge left',
    category: 'Arrange',
    shortcuts: ['Shift+ArrowLeft'],
  },
  { id: 'align-up', label: 'Align up', category: 'Arrange', shortcuts: ['Ctrl+ArrowUp'] },
  {
    id: 'align-right',
    label: 'Align right',
    category: 'Arrange',
    shortcuts: ['Ctrl+ArrowRight'],
  },
  {
    id: 'align-down',
    label: 'Align down',
    category: 'Arrange',
    shortcuts: ['Ctrl+ArrowDown'],
  },
  {
    id: 'align-left',
    label: 'Align left',
    category: 'Arrange',
    shortcuts: ['Ctrl+ArrowLeft'],
  },
  {
    id: 'distribute-horizontal',
    label: 'Distribute horizontally',
    category: 'Arrange',
    shortcuts: ['Ctrl+Shift+H'],
  },
  {
    id: 'distribute-vertical',
    label: 'Distribute vertically',
    category: 'Arrange',
    shortcuts: ['Ctrl+Alt+Shift+V'],
  },
  {
    id: 'equal-spacing',
    label: 'Equal spacing',
    category: 'Arrange',
    shortcuts: ['Ctrl+Shift+E'],
  },
  { id: 'group', label: 'Group', category: 'Arrange', shortcuts: ['Ctrl+G'] },
  { id: 'ungroup', label: 'Ungroup', category: 'Arrange', shortcuts: ['Ctrl+Shift+G'] },
  {
    id: 'bring-front',
    label: 'Bring to front',
    category: 'Arrange',
    shortcuts: ['Ctrl+Alt+]'],
  },
  {
    id: 'bring-forward',
    label: 'Bring forward',
    category: 'Arrange',
    shortcuts: ['Ctrl+]'],
  },
  {
    id: 'send-backward',
    label: 'Send backward',
    category: 'Arrange',
    shortcuts: ['Ctrl+['],
  },
  {
    id: 'send-back',
    label: 'Send to back',
    category: 'Arrange',
    shortcuts: ['Ctrl+Alt+['],
  },
  {
    id: 'freehand-select',
    label: 'Freehand select',
    category: 'Tools',
    shortcuts: ['Ctrl+Alt+S'],
  },
  {
    id: 'find',
    label: 'Find',
    category: 'Navigate',
    shortcuts: ['Ctrl+F'],
    allowInText: true,
  },
  {
    id: 'find-next',
    label: 'Find next',
    category: 'Navigate',
    shortcuts: ['F3'],
    allowInText: true,
  },
  {
    id: 'find-previous',
    label: 'Find previous',
    category: 'Navigate',
    shortcuts: ['Shift+F3'],
    allowInText: true,
  },
  { id: 'next-page', label: 'Next page', category: 'Navigate', shortcuts: ['PageDown'] },
  {
    id: 'previous-page',
    label: 'Previous page',
    category: 'Navigate',
    shortcuts: ['PageUp'],
  },
  {
    id: 'show-shortcuts',
    label: 'Shortcut overlay',
    category: 'Help',
    shortcuts: ['F1'],
    allowInText: true,
  },
  {
    id: 'canvas-navigation',
    label: 'Canvas navigation mode',
    category: 'Navigate',
    shortcuts: ['Ctrl+Alt+K'],
  },
  { id: 'next-object', label: 'Next object', category: 'Navigate', shortcuts: ['Tab'] },
  {
    id: 'previous-object',
    label: 'Previous object',
    category: 'Navigate',
    shortcuts: ['Shift+Tab'],
  },
  { id: 'enter-scope', label: 'Enter group or container', category: 'Navigate', shortcuts: ['Enter'] },
  {
    id: 'exit-scope',
    label: 'Exit group or container',
    category: 'Navigate',
    shortcuts: ['Shift+Enter'],
  },
  {
    id: 'beauty-pass',
    label: 'Beauty Pass',
    category: 'Automation',
    shortcuts: ['Ctrl+Alt+B'],
  },
  {
    id: 'reroute-selection',
    label: 'Re-route selection',
    category: 'Connectors',
    shortcuts: ['Ctrl+Alt+R'],
  },
  {
    id: 'toggle-obstacle-avoidance',
    label: 'Toggle obstacle avoidance',
    category: 'Connectors',
    shortcuts: ['Ctrl+Alt+O'],
  },
] as const satisfies readonly CommandDefinition[];

export function validateCommandRegistry(
  commands: readonly CommandDefinition[],
): void {
  const commandIds = new Set<string>();
  const commandByShortcut = new Map<string, string>();
  for (const command of commands) {
    if (commandIds.has(command.id)) {
      throw new Error(`Command id ${command.id} is assigned more than once`);
    }
    commandIds.add(command.id);
    for (const shortcut of command.shortcuts) {
      const firstCommandId = commandByShortcut.get(shortcut);
      if (firstCommandId !== undefined) {
        throw new Error(
          `Shortcut ${shortcut} is assigned to both ${firstCommandId} and ${command.id}`,
        );
      }
      commandByShortcut.set(shortcut, command.id);
    }
  }
}

validateCommandRegistry(WINDOWS_COMMANDS);

function normalizeKey(key: string): string {
  if (key === ' ') {
    return 'Space';
  }
  const aliases: Readonly<Record<string, string>> = {
    Esc: 'Escape',
    Spacebar: 'Space',
  };
  const alias = aliases[key];
  if (alias !== undefined) {
    return alias;
  }
  return key.length === 1 ? key.toUpperCase() : key;
}

function shortcutFor(input: ShortcutInput): string {
  const key = normalizeKey(input.key);
  const modifiers: string[] = [];
  if (input.ctrl === true) {
    modifiers.push('Ctrl');
  }
  if (input.alt === true) {
    modifiers.push('Alt');
  }
  if (input.shift === true && key !== '+') {
    modifiers.push('Shift');
  }
  modifiers.push(key);
  return modifiers.join('+');
}

const commandByShortcut = new Map<string, CommandDefinition>();
for (const command of WINDOWS_COMMANDS) {
  for (const shortcut of command.shortcuts) {
    commandByShortcut.set(shortcut, command);
  }
}

export function resolveShortcut(
  input: ShortcutInput,
  context: ShortcutContext = {},
): CommandDefinition | undefined {
  const command = commandByShortcut.get(shortcutFor(input));
  if (command === undefined) {
    return undefined;
  }
  return context.textEditing === true && command.allowInText !== true
    ? undefined
    : command;
}

export function searchCommands(query: string): readonly CommandDefinition[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) {
    return WINDOWS_COMMANDS;
  }
  return WINDOWS_COMMANDS.filter((command) =>
    [command.id, command.label, command.category, ...command.shortcuts]
      .join(' ')
      .toLowerCase()
      .includes(normalized),
  );
}
