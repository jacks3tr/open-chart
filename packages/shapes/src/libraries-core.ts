import { BUILTIN_SHAPE_LIBRARIES } from './builtin-libraries.js';
import { createShapeLibraryCatalog } from './library-catalog.js';
import type { ShapeLibrary } from './library-types.js';

export const DECORATIVE_SHAPE_LIBRARY_SUMMARIES = [
  { id: 'simple-icons', name: 'Simple Icons', count: 3_457 },
  { id: 'phosphor', name: 'Phosphor', count: 1_512 },
] as const;

const catalog = createShapeLibraryCatalog(BUILTIN_SHAPE_LIBRARIES);

export const listShapeLibraries = catalog.listShapeLibraries;
export const getShapeLibrary = catalog.getShapeLibrary;
export const getShapeLibraryEntry = catalog.getShapeLibraryEntry;
export const resolveLibraryShape = catalog.resolveLibraryShape;
export const searchShapeLibraries = catalog.searchShapeLibraries;

export function validateShapeLibraries(
  libraries: readonly ShapeLibrary[] = BUILTIN_SHAPE_LIBRARIES,
) {
  return catalog.validateShapeLibraries(libraries);
}

export function isDecorativeShapeLibraryId(id: string): boolean {
  return DECORATIVE_SHAPE_LIBRARY_SUMMARIES.some((library) => library.id === id);
}
