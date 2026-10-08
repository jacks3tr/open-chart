import type { OpenChartDocument, Style, Theme } from '@openchart/ir';
import type { Operation } from '@openchart/ops';

export const TOKEN_PRESET_IDS = [
  'openchart-light',
  'openchart-dark',
  'aws-official',
  'azure-official',
  'mono-print',
  'high-contrast',
] as const;

export type TokenPresetId = (typeof TOKEN_PRESET_IDS)[number];

export interface TokenPreset {
  readonly id: TokenPresetId;
  readonly label: string;
  readonly tokens: Theme['tokens'];
}

export const TOKEN_PRESETS: Readonly<Record<TokenPresetId, TokenPreset>> = {
  'openchart-light': {
    id: 'openchart-light',
    label: 'OpenChart Light',
    tokens: {
      canvas: '#F5F5F3', surface: '#FFFFFF', surfaceAlt: '#EBECE9',
      stroke: '#DDDEDB', strokeStrong: '#BFC3C1', textHi: '#29313A',
      textMid: '#53606D', textLo: '#5E6874', compute: '#29313A',
      computeTint: '#FFFFFF', storage: '#53606D', storageTint: '#EBECE9',
      data: '#B94E2A', dataTint: '#FFF1EA', network: '#53606D',
      networkTint: '#F5F5F3', identity: '#29313A', identityTint: '#FFFFFF',
      external: '#5E6874', externalTint: '#F0F1EF', danger: '#DC2626',
      success: '#059669', typeFloor: 10, nodeRadius: 6, containerRadius: 8,
    },
  },
  'openchart-dark': {
    id: 'openchart-dark',
    label: 'OpenChart Dark',
    tokens: {
      canvas: '#222730', surface: '#2B313B', surfaceAlt: '#343B46',
      stroke: '#444C58', strokeStrong: '#687482', textHi: '#F4F3EF',
      textMid: '#BFC7D0', textLo: '#A3ADB9', compute: '#F4F3EF',
      computeTint: '#2B313B', storage: '#BFC7D0', storageTint: '#343B46',
      data: '#F2946D', dataTint: '#3B302E', network: '#BFC7D0',
      networkTint: '#222730', identity: '#F4F3EF', identityTint: '#2B313B',
      external: '#A3ADB9', externalTint: '#292F38', danger: '#F87171',
      success: '#34D399', typeFloor: 10, nodeRadius: 6, containerRadius: 8,
    },
  },
  'aws-official': {
    id: 'aws-official',
    label: 'AWS Official',
    tokens: {
      canvas: '#FAFAFA', surface: '#FFFFFF', surfaceAlt: '#F2F3F3',
      stroke: '#D5DBDB', strokeStrong: '#AAB7B8', textHi: '#161E2D',
      textMid: '#414D5C', textLo: '#687078', compute: '#D86613',
      computeTint: '#FFF4E8', storage: '#3F8624', storageTint: '#F0F8EC',
      data: '#8C4FFF', dataTint: '#F5F0FF', network: '#2E73B8',
      networkTint: '#EDF5FC', identity: '#DD344C', identityTint: '#FFF0F2',
      external: '#687078', externalTint: '#F2F3F3', danger: '#D13212',
      success: '#1D8102', typeFloor: 10, nodeRadius: 8, containerRadius: 12,
    },
  },
  'azure-official': {
    id: 'azure-official',
    label: 'Azure Official',
    tokens: {
      canvas: '#F8FAFC', surface: '#FFFFFF', surfaceAlt: '#F1F5F9',
      stroke: '#D8E2EC', strokeStrong: '#B4C7D9', textHi: '#17253D',
      textMid: '#40566F', textLo: '#71869C', compute: '#0078D4',
      computeTint: '#EBF6FF', storage: '#773ADC', storageTint: '#F4EEFF',
      data: '#008272', dataTint: '#EAF9F7', network: '#5C6F82',
      networkTint: '#F2F5F8', identity: '#C239B3', identityTint: '#FFF0FC',
      external: '#7A8998', externalTint: '#F3F5F7', danger: '#D13438',
      success: '#107C10', typeFloor: 10, nodeRadius: 8, containerRadius: 12,
    },
  },
  'mono-print': {
    id: 'mono-print',
    label: 'Monochrome Print',
    tokens: {
      canvas: '#FFFFFF', surface: '#FFFFFF', surfaceAlt: '#F2F2F2',
      stroke: '#C7C7C7', strokeStrong: '#777777', textHi: '#111111',
      textMid: '#3D3D3D', textLo: '#6B6B6B', compute: '#1F1F1F',
      computeTint: '#F5F5F5', storage: '#3B3B3B', storageTint: '#EEEEEE',
      data: '#555555', dataTint: '#F2F2F2', network: '#707070',
      networkTint: '#F7F7F7', identity: '#292929', identityTint: '#E9E9E9',
      external: '#7D7D7D', externalTint: '#F4F4F4', danger: '#000000',
      success: '#333333', typeFloor: 10, nodeRadius: 8, containerRadius: 12,
    },
  },
  'high-contrast': {
    id: 'high-contrast',
    label: 'High Contrast',
    tokens: {
      canvas: '#000000', surface: '#000000', surfaceAlt: '#101010',
      stroke: '#FFFFFF', strokeStrong: '#FFFFFF', textHi: '#FFFFFF',
      textMid: '#FFFFFF', textLo: '#E6E6E6', compute: '#00FFFF',
      computeTint: '#001F24', storage: '#FF7FFF', storageTint: '#260026',
      data: '#00FF66', dataTint: '#002814', network: '#FFFFFF',
      networkTint: '#151515', identity: '#FFFF00', identityTint: '#292900',
      external: '#FFFFFF', externalTint: '#151515', danger: '#FF5A5A',
      success: '#00FF66', typeFloor: 10, nodeRadius: 8, containerRadius: 12,
    },
  },
};

type SemanticKey = 'compute' | 'storage' | 'data' | 'network' | 'identity' | 'external';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]),
  );
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function semanticKey(role: string): SemanticKey {
  const normalized = role.toLowerCase();
  if (normalized.includes('storage') || normalized.includes('database')) return 'storage';
  if (normalized.includes('identity') || normalized.includes('source')) return 'identity';
  if (normalized.includes('fabric') || normalized.includes('integration') || normalized.includes('data')) return 'data';
  if (normalized.includes('target') || normalized.includes('compute')) return 'compute';
  if (normalized.includes('external')) return 'external';
  return 'network';
}

function readToken(tokens: Theme['tokens'], key: string): string {
  const value = tokens[key];
  if (typeof value !== 'string') {
    throw new Error(`Token preset is missing string token ${JSON.stringify(key)}`);
  }
  return value;
}

function themedStyleTokens(style: Style, preset: TokenPreset): Style['tokens'] {
  const next: Style['tokens'] = { ...style.tokens };
  for (const key of [
    'accent', 'surface', 'stroke', 'textHi', 'textMid', 'textLo', 'radius', 'containerRadius', 'strokeWidth',
  ]) {
    delete next[key];
  }
  const role = style.role.toLowerCase();
  if (role.includes('flow')) {
    const semantic = semanticKey(role);
    next.stroke = readToken(preset.tokens, semantic);
    next.label = typeof style.tokens.label === 'string' ? style.tokens.label : style.role;
    if (role.includes('control') || role.includes('event') || role.includes('async')) {
      next.dash = '4 5';
    } else {
      delete next.dash;
    }
    next.strokeWidth = 1.5;
    return next;
  }
  const semantic = semanticKey(style.role);
  next.accent = readToken(preset.tokens, semantic);
  next.surface = readToken(preset.tokens, `${semantic}Tint`);
  next.textHi = readToken(preset.tokens, 'textHi');
  next.textMid = readToken(preset.tokens, 'textMid');
  next.textLo = readToken(preset.tokens, 'textLo');
  next.radius = preset.tokens.nodeRadius ?? 8;
  next.containerRadius = preset.tokens.containerRadius ?? 12;
  next.strokeWidth = 1;
  return next;
}

export function compileTokenOperations(
  document: OpenChartDocument,
  presetId: TokenPresetId,
): readonly Operation[] {
  const preset = TOKEN_PRESETS[presetId];
  const operations: Operation[] = [];
  const theme: Theme = { presetId, tokens: { ...preset.tokens } };
  if (!equalJson(document.theme, theme)) {
    operations.push({ op: 'set_theme', theme });
  }
  for (const style of Object.values(document.styles).sort((left, right) =>
    left.id.localeCompare(right.id))) {
    const tokens = themedStyleTokens(style, preset);
    if (!equalJson(style.tokens, tokens)) {
      operations.push({ op: 'set_style_tokens', id: style.id, tokens });
    }
  }
  return operations;
}
