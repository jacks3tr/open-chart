import { ID_PATTERN } from '@openchart/ir';

import {
  SHAPE_LIBRARY_CATALOG_VERSION,
  vectorPathToCommands,
  type ResolveLibraryShapeOptions,
  type ResolveLibraryShapeResult,
  type ShapeLibrary,
  type ShapeLibraryDiagnostic,
  type ShapeLibraryEntry,
  type ShapeLibrarySearchResult,
  type ShapeVectorLibraryEntry,
} from './library-types.js';
import { validateShapeDefinition } from './schema.js';
import { SHAPE_DEFINITION_VERSION, type ShapeDefinition } from './types.js';

export function createShapeLibraryCatalog(catalogLibraries: readonly ShapeLibrary[]) {
  // Catalogs are immutable. Build entry indices lazily so unused libraries cost no traversal.
  const librariesById = new Map<string, ShapeLibrary>();
  const entriesByLibrary = new Map<string, ReadonlyMap<string, ShapeLibraryEntry>>();
  for (const library of catalogLibraries) {
    if (!librariesById.has(library.id)) librariesById.set(library.id, library);
  }

  function colorIsValid(value: string): boolean {
    return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);
  }

  function failure(
    code: ShapeLibraryDiagnostic['code'],
    path: string,
    message: string,
  ): ResolveLibraryShapeResult {
    return { ok: false, diagnostics: [{ code, path, message }] };
  }

  function listShapeLibraries(): readonly ShapeLibrary[] {
    return catalogLibraries;
  }

  function getShapeLibrary(id: string): ShapeLibrary | undefined {
    return librariesById.get(id);
  }

  function getShapeLibraryEntry(
    libraryId: string,
    entryId: string,
  ): ShapeLibraryEntry | undefined {
    let entries = entriesByLibrary.get(libraryId);
    if (entries === undefined) {
      const library = getShapeLibrary(libraryId);
      if (library === undefined) return undefined;
      const index = new Map<string, ShapeLibraryEntry>();
      for (const entry of library.entries) {
        if (!index.has(entry.id)) index.set(entry.id, entry);
      }
      entriesByLibrary.set(libraryId, index);
      entries = index;
    }
    return entries.get(entryId);
  }

  function resolveLibraryShape(
    libraryId: string,
    entryId: string,
    options: ResolveLibraryShapeOptions = {},
  ): ResolveLibraryShapeResult {
    const library = getShapeLibrary(libraryId);
    if (library === undefined) {
      return failure(
        'LIBRARY_NOT_FOUND',
        'libraryId',
        `Shape library ${JSON.stringify(libraryId)} does not exist`,
      );
    }
    const entry = getShapeLibraryEntry(libraryId, entryId);
    if (entry === undefined) {
      return failure(
        'ENTRY_NOT_FOUND',
        'entryId',
        `Shape entry ${JSON.stringify(entryId)} does not exist in ${JSON.stringify(libraryId)}`,
      );
    }
    if (entry.kind === 'definition') {
      return { ok: true, definition: entry.definition, entry };
    }

    const variantName = options.variant ?? entry.defaultVariant;
    const variant = entry.variants[variantName];
    if (variant === undefined) {
      return failure(
        'VARIANT_NOT_FOUND',
        'options.variant',
        `Variant ${JSON.stringify(variantName)} does not exist for ${JSON.stringify(entry.id)}`,
      );
    }
    const color = options.color ?? entry.defaultColor ?? '#0F172A';
    if (!colorIsValid(color)) {
      return failure(
        'COLOR_INVALID',
        'options.color',
        `Color ${JSON.stringify(color)} is not a supported solid color`,
      );
    }

    try {
      const definition: ShapeDefinition = {
        version: SHAPE_DEFINITION_VERSION,
        id: entry.id,
        name: entry.name,
        defaultSize: entry.defaultSize,
        composition: entry.composition,
        properties: [{ name: 'Color', type: 'color', default: color }],
        geometry: variant.paths.map((path, index) => ({
          id: `path-${index}`,
          type: 'path',
          commands: vectorPathToCommands(path),
          fill: '=@Color',
          ...(path.opacity === undefined ? {} : { fillOpacity: path.opacity }),
        })),
        ports: [
          { id: 'west-in', direction: 'in', side: 'west', x: 0, y: 0.5 },
          { id: 'north-in', direction: 'in', side: 'north', x: 0.5, y: 0 },
          { id: 'east-out', direction: 'out', side: 'east', x: 1, y: 0.5 },
          { id: 'south-out', direction: 'out', side: 'south', x: 0.5, y: 1 },
        ],
      };
      return { ok: true, definition, entry };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failure(
        'CATALOG_INVALID',
        `entry.${entry.id}.variants.${variantName}`,
        message,
      );
    }
  }

  function entryScore(entry: ShapeLibraryEntry, query: string): number | undefined {
    if (query.length === 0) {
      return 4;
    }
    const id = entry.id.toLowerCase();
    const name = entry.name.toLowerCase();
    if (id === query || name === query) {
      return 0;
    }
    if (id.startsWith(query) || name.startsWith(query)) {
      return 1;
    }
    if (entry.tags.some((tag) => tag === query || tag.startsWith(query))) {
      return 2;
    }
    if (id.includes(query) || name.includes(query) || entry.tags.some((tag) => tag.includes(query))) {
      return 3;
    }
    const terms = query.split(/\s+/).filter(Boolean);
    if (terms.length > 1) {
      const haystack = `${id} ${name} ${entry.tags.join(' ')}`;
      if (terms.every((term) => haystack.includes(term))) {
        return 3;
      }
    }
    return undefined;
  }

  function searchShapeLibraries(
    query: string,
    options: {
      readonly libraryIds?: readonly string[];
      readonly limit?: number;
    } = {},
  ): readonly ShapeLibrarySearchResult[] {
    const normalized = query.trim().toLowerCase();
    const requestedLibraries =
      options.libraryIds === undefined ? undefined : new Set(options.libraryIds);
    const limit = Math.max(0, Math.min(500, Math.trunc(options.limit ?? 50)));
    if (!(limit > 0)) return [];
    // Scores have five values: bounded stable buckets avoid sorting all matching entries.
    const ranked: ShapeLibrarySearchResult[][] = [[], [], [], [], []];
    for (const library of catalogLibraries) {
      if (requestedLibraries !== undefined && !requestedLibraries.has(library.id)) {
        continue;
      }
      for (const entry of library.entries) {
        const score = entryScore(entry, normalized);
        if (score !== undefined) {
          const bucket = ranked[score];
          if (bucket !== undefined && bucket.length < limit) {
            bucket.push({ libraryId: library.id, entry });
          }
        }
      }
    }
    return ranked.flat().slice(0, limit);
  }

  function vectorPathIsValid(
    path: ShapeVectorLibraryEntry['variants'][string]['paths'][number],
  ): boolean {
    const [x, y, width, height] = path.viewBox;
    return (
      path.data.length > 0 &&
      path.data.length <= 1_000_000 &&
      [x, y, width, height].every(Number.isFinite) &&
      width > 0 &&
      height > 0 &&
      (path.opacity === undefined ||
        (Number.isFinite(path.opacity) && path.opacity >= 0 && path.opacity <= 1))
    );
  }

  function validateShapeLibraries(
    libraries: readonly ShapeLibrary[] = catalogLibraries,
  ): readonly ShapeLibraryDiagnostic[] {
    const diagnostics: ShapeLibraryDiagnostic[] = [];
    const libraryIds = new Set<string>();
    const entryIds = new Set<string>();
    for (let libraryIndex = 0; libraryIndex < libraries.length; libraryIndex += 1) {
      const library = libraries[libraryIndex];
      if (library === undefined) {
        continue;
      }
      const libraryPath = `libraries.${libraryIndex}`;
      if (library.catalogVersion !== SHAPE_LIBRARY_CATALOG_VERSION) {
        diagnostics.push({
          code: 'CATALOG_INVALID',
          path: `${libraryPath}.catalogVersion`,
          message: `Unsupported catalog version ${String(library.catalogVersion)}`,
        });
      }
      if (!ID_PATTERN.test(library.id)) {
        diagnostics.push({
          code: 'CATALOG_INVALID',
          path: `${libraryPath}.id`,
          message: `Invalid library id ${JSON.stringify(library.id)}`,
        });
      }
      if (libraryIds.has(library.id)) {
        diagnostics.push({
          code: 'CATALOG_INVALID',
          path: `${libraryPath}.id`,
          message: `Duplicate library id ${JSON.stringify(library.id)}`,
        });
      }
      libraryIds.add(library.id);
      for (let entryIndex = 0; entryIndex < library.entries.length; entryIndex += 1) {
        const entry = library.entries[entryIndex];
        if (entry === undefined) {
          continue;
        }
        const entryPath = `${libraryPath}.entries.${entryIndex}`;
        if (!ID_PATTERN.test(entry.id)) {
          diagnostics.push({
            code: 'CATALOG_INVALID',
            path: `${entryPath}.id`,
            message: `Invalid entry id ${JSON.stringify(entry.id)}`,
          });
        }
        if (entryIds.has(entry.id)) {
          diagnostics.push({
            code: 'CATALOG_INVALID',
            path: `${entryPath}.id`,
            message: `Duplicate entry id ${JSON.stringify(entry.id)}`,
          });
        }
        entryIds.add(entry.id);
        if (entry.kind === 'definition') {
          if (entry.definition.id !== entry.id) {
            diagnostics.push({
              code: 'CATALOG_INVALID',
              path: `${entryPath}.definition.id`,
              message: 'Definition id must match its catalog entry id',
            });
          }
          const definitionValidation = validateShapeDefinition(entry.definition);
          if (!definitionValidation.ok) {
            diagnostics.push(
              ...definitionValidation.diagnostics.map((diagnostic) => ({
                code: 'CATALOG_INVALID' as const,
                path: `${entryPath}.definition.${diagnostic.path}`,
                message: diagnostic.message,
              })),
            );
          }
        } else {
          const variant = entry.variants[entry.defaultVariant];
          if (variant === undefined || variant.paths.length === 0) {
            diagnostics.push({
              code: 'CATALOG_INVALID',
              path: `${entryPath}.defaultVariant`,
              message: `Default variant ${JSON.stringify(entry.defaultVariant)} is missing or empty`,
            });
            continue;
          }
          for (const [variantName, candidate] of Object.entries(entry.variants)) {
            if (candidate.paths.length === 0) {
              diagnostics.push({
                code: 'CATALOG_INVALID',
                path: `${entryPath}.variants.${variantName}`,
                message: 'Vector variants must contain at least one path',
              });
            }
            candidate.paths.forEach((path, pathIndex) => {
              if (!vectorPathIsValid(path)) {
                diagnostics.push({
                  code: 'CATALOG_INVALID',
                  path: `${entryPath}.variants.${variantName}.paths.${pathIndex}`,
                  message: 'Vector path data, viewBox, or opacity is malformed',
                });
              }
            });
          }
        }
      }
    }
    return diagnostics;
  }

  return {
    listShapeLibraries,
    getShapeLibrary,
    getShapeLibraryEntry,
    resolveLibraryShape,
    searchShapeLibraries,
    validateShapeLibraries,
  } as const;
}
