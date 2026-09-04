import svgpath from 'svgpath';

import type { ShapeDefinition, ShapePathCommandDefinition } from './types.js';

export const SHAPE_LIBRARY_CATALOG_VERSION = 1 as const;

export type PhosphorWeight =
  | 'thin'
  | 'light'
  | 'regular'
  | 'bold'
  | 'fill'
  | 'duotone';

export type PackedVectorCommand =
  | readonly ['M' | 'L', number, number]
  | readonly ['Q', number, number, number, number]
  | readonly ['C', number, number, number, number, number, number]
  | readonly ['Z'];

export interface ShapeVectorPath {
  /** Validated upstream SVG path data, expanded only when a shape is selected. */
  readonly data: string;
  readonly viewBox: readonly [number, number, number, number];
  readonly opacity?: number;
}

export interface ShapeVectorVariant {
  /** Paths retain compact source coordinates and normalize on first use. */
  readonly paths: readonly ShapeVectorPath[];
}

export interface ShapeLicenseInfo {
  readonly name: string;
  readonly url?: string;
  readonly notice?: string;
}

export interface ShapeProvenance {
  readonly sourceUrl: string;
  readonly packageName?: string;
  readonly packageVersion?: string;
  readonly packageLicense?: string;
  readonly upstreamId?: string;
  readonly guidelinesUrl?: string;
  readonly iconLicense?: ShapeLicenseInfo;
  readonly trademark?: boolean;
}

interface ShapeLibraryEntryBase {
  readonly id: string;
  readonly name: string;
  readonly tags: readonly string[];
  readonly defaultSize: {
    readonly width: number;
    readonly height: number;
  };
  readonly composition: 'above' | 'left' | 'circle';
  readonly provenance: ShapeProvenance;
}

export interface ShapeDefinitionLibraryEntry extends ShapeLibraryEntryBase {
  readonly kind: 'definition';
  readonly definition: ShapeDefinition;
}

export interface ShapeVectorLibraryEntry extends ShapeLibraryEntryBase {
  readonly kind: 'vector';
  readonly defaultVariant: string;
  readonly defaultColor?: string;
  readonly variants: Readonly<Record<string, ShapeVectorVariant>>;
}

export type ShapeLibraryEntry =
  | ShapeDefinitionLibraryEntry
  | ShapeVectorLibraryEntry;

export interface ShapeLibrary {
  readonly catalogVersion: typeof SHAPE_LIBRARY_CATALOG_VERSION;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly license: ShapeLicenseInfo;
  readonly entries: readonly ShapeLibraryEntry[];
}

export interface ResolveLibraryShapeOptions {
  readonly variant?: string;
  readonly color?: string;
}

export type ShapeLibraryDiagnosticCode =
  | 'LIBRARY_NOT_FOUND'
  | 'ENTRY_NOT_FOUND'
  | 'VARIANT_NOT_FOUND'
  | 'COLOR_INVALID'
  | 'CATALOG_INVALID';

export interface ShapeLibraryDiagnostic {
  readonly code: ShapeLibraryDiagnosticCode;
  readonly path: string;
  readonly message: string;
}

export type ResolveLibraryShapeResult =
  | {
      readonly ok: true;
      readonly definition: ShapeDefinition;
      readonly entry: ShapeLibraryEntry;
    }
  | { readonly ok: false; readonly diagnostics: readonly ShapeLibraryDiagnostic[] };

export interface ShapeLibrarySearchResult {
  readonly libraryId: string;
  readonly entry: ShapeLibraryEntry;
}

/** Expand a compact generated vector command into the shape-runtime command. */
export function unpackVectorCommand(
  command: PackedVectorCommand,
): ShapePathCommandDefinition {
  switch (command[0]) {
    case 'M':
      return { type: 'move', x: command[1], y: command[2] };
    case 'L':
      return { type: 'line', x: command[1], y: command[2] };
    case 'Q':
      return {
        type: 'quadratic',
        cx: command[1],
        cy: command[2],
        x: command[3],
        y: command[4],
      };
    case 'C':
      return {
        type: 'cubic',
        c1x: command[1],
        c1y: command[2],
        c2x: command[3],
        c2y: command[4],
        x: command[5],
        y: command[6],
      };
    case 'Z':
      return { type: 'close' };
  }
}

const MAX_VECTOR_PATH_LENGTH = 1_000_000;
const MAX_VECTOR_COMMANDS = 100_000;
const vectorCommandCache = new WeakMap<
  ShapeVectorPath,
  readonly ShapePathCommandDefinition[]
>();

function finiteCoordinate(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Non-finite ${context}`);
  }
  return value;
}

/**
 * Convert a validated catalog path to shape-runtime commands on first use.
 * Keeping source paths packed avoids eagerly allocating every icon command.
 */
export function vectorPathToCommands(
  path: ShapeVectorPath,
): readonly ShapePathCommandDefinition[] {
  const cached = vectorCommandCache.get(path);
  if (cached !== undefined) {
    return cached;
  }
  if (path.data.length === 0 || path.data.length > MAX_VECTOR_PATH_LENGTH) {
    throw new Error('Vector path data has an invalid length');
  }
  const [viewBoxX, viewBoxY, viewBoxWidth, viewBoxHeight] = path.viewBox;
  if (
    ![viewBoxX, viewBoxY, viewBoxWidth, viewBoxHeight].every(Number.isFinite) ||
    viewBoxWidth <= 0 ||
    viewBoxHeight <= 0
  ) {
    throw new Error('Vector path has an invalid viewBox');
  }

  try {
    const parsed = svgpath(path.data).abs().unshort().unarc();
    if (viewBoxX !== 0 || viewBoxY !== 0) {
      parsed.translate(-viewBoxX, -viewBoxY);
    }
    parsed.scale(1 / viewBoxWidth, 1 / viewBoxHeight).round(6);

    const packed: PackedVectorCommand[] = [];
    parsed.iterate((segment, index, startX, startY) => {
      if (packed.length >= MAX_VECTOR_COMMANDS) {
        throw new Error(`Vector path exceeds ${MAX_VECTOR_COMMANDS} commands`);
      }
      switch (segment[0]) {
        case 'M':
        case 'L':
          packed.push([
            segment[0],
            finiteCoordinate(segment[1], `${segment[0]} x at segment ${index}`),
            finiteCoordinate(segment[2], `${segment[0]} y at segment ${index}`),
          ]);
          return;
        case 'H':
          packed.push([
            'L',
            finiteCoordinate(segment[1], `H x at segment ${index}`),
            finiteCoordinate(startY, `H start y at segment ${index}`),
          ]);
          return;
        case 'V':
          packed.push([
            'L',
            finiteCoordinate(startX, `V start x at segment ${index}`),
            finiteCoordinate(segment[1], `V y at segment ${index}`),
          ]);
          return;
        case 'Q':
          packed.push([
            'Q',
            finiteCoordinate(segment[1], `Q control x at segment ${index}`),
            finiteCoordinate(segment[2], `Q control y at segment ${index}`),
            finiteCoordinate(segment[3], `Q x at segment ${index}`),
            finiteCoordinate(segment[4], `Q y at segment ${index}`),
          ]);
          return;
        case 'C':
          packed.push([
            'C',
            finiteCoordinate(segment[1], `C control 1 x at segment ${index}`),
            finiteCoordinate(segment[2], `C control 1 y at segment ${index}`),
            finiteCoordinate(segment[3], `C control 2 x at segment ${index}`),
            finiteCoordinate(segment[4], `C control 2 y at segment ${index}`),
            finiteCoordinate(segment[5], `C x at segment ${index}`),
            finiteCoordinate(segment[6], `C y at segment ${index}`),
          ]);
          return;
        case 'Z':
          packed.push(['Z']);
          return;
        default:
          throw new Error(
            `Unsupported SVG path command ${String(segment[0])} at segment ${index}`,
          );
      }
    });
    if (packed.length === 0) {
      throw new Error('Vector path has no commands');
    }
    const commands = packed.map(unpackVectorCommand);
    vectorCommandCache.set(path, commands);
    return commands;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid vector path data: ${message}`, { cause: error });
  }
}
