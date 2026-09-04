import {
  phosphorLibrary,
  simpleIconsLibrary,
} from '../generated/icon-libraries.js';

import { BUILTIN_SHAPE_LIBRARIES } from './builtin-libraries.js';
import { createShapeLibraryCatalog } from './library-catalog.js';
import type { ShapeLibrary } from './library-types.js';

const SHAPE_LIBRARIES = [
  ...BUILTIN_SHAPE_LIBRARIES,
  simpleIconsLibrary,
  phosphorLibrary,
] as const satisfies readonly ShapeLibrary[];

const catalog = createShapeLibraryCatalog(SHAPE_LIBRARIES);

export const listShapeLibraries = catalog.listShapeLibraries;
export const getShapeLibrary = catalog.getShapeLibrary;
export const getShapeLibraryEntry = catalog.getShapeLibraryEntry;
export const resolveLibraryShape = catalog.resolveLibraryShape;
export const searchShapeLibraries = catalog.searchShapeLibraries;

export function validateShapeLibraries(
  libraries: readonly ShapeLibrary[] = SHAPE_LIBRARIES,
) {
  return catalog.validateShapeLibraries(libraries);
}
