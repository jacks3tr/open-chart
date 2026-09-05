import { describe, expect, it } from 'vitest';
import { createShapeLibraryCatalog } from '../src/library-catalog.js';
import { listShapeLibraries } from '../src/libraries-core.js';

describe('catalog lookup work', () => {
  it('indexes entry identifiers once instead of rescanning a library on every lookup', () => {
    let reads = 0;
    const source = listShapeLibraries()[0]!;
    const entries = source.entries.map((entry) => ({ ...entry,
      get id() { reads += 1; return entry.id; },
    }));
    const catalog = createShapeLibraryCatalog([{ ...source, entries }]);
    const last = source.entries.at(-1)!;
    expect(catalog.getShapeLibraryEntry(source.id, last.id)?.name).toBe(last.name);
    reads = 0;
    for (let index = 0; index < 20; index += 1) {
      expect(catalog.getShapeLibraryEntry(source.id, last.id)?.name).toBe(last.name);
    }
    expect(reads).toBe(0);
  });

  it('preserves scored search order and returns an empty result without scanning for limit zero', () => {
    let reads = 0;
    const source = listShapeLibraries()[0]!;
    const catalog = createShapeLibraryCatalog([{ ...source,
      entries: source.entries.map((entry) => ({ ...entry,
        get tags() { reads += 1; return entry.tags; },
      })),
    }]);
    expect(catalog.searchShapeLibraries('arbitrary query', { limit: 0 })).toEqual([]);
    expect(reads).toBe(0);
    for (const query of ['', 'process', 'basic', 'arrow']) {
      expect(catalog.searchShapeLibraries(query, { limit: 3 }))
        .toEqual(catalog.searchShapeLibraries(query, { limit: 500 }).slice(0, 3));
    }
  });
});
