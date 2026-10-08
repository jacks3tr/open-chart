import { BUILTIN_SHAPE_LIBRARIES } from './builtin-libraries.js';
import { createShapeLibraryCatalog } from './library-catalog.js';
import { DECORATIVE_SHAPE_LIBRARY_SUMMARIES } from './libraries-core.js';
import type { ShapeLibrary } from './library-types.js';

const libraryPromises = new Map<string, Promise<ShapeLibrary>>();

export type LoadedShapeCatalog = ReturnType<typeof createShapeLibraryCatalog>;

export async function loadShapeCatalog(
  libraryIds: readonly string[] = DECORATIVE_SHAPE_LIBRARY_SUMMARIES.map((library) => library.id),
): Promise<LoadedShapeCatalog> {
  const requested = new Set(libraryIds);
  const libraries = await Promise.all(DECORATIVE_SHAPE_LIBRARY_SUMMARIES
    .filter((library) => requested.has(library.id))
    .map(({ id }) => {
      let promise = libraryPromises.get(id);
      if (promise === undefined) {
        promise = (id === 'simple-icons'
          ? import('../generated/simple-icons.js').then((module) => module.simpleIconsLibrary)
          : import('../generated/phosphor.js').then((module) => module.phosphorLibrary)
        ).catch((error: unknown) => {
          libraryPromises.delete(id);
          throw error;
        });
        libraryPromises.set(id, promise);
      }
      return promise;
    }));
  return createShapeLibraryCatalog([...BUILTIN_SHAPE_LIBRARIES, ...libraries]);
}
