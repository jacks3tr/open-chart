import { describe, expect, it } from 'vitest';

import { RasterCache, type RasterSurface } from '../src/index.js';

describe('RasterCache', () => {
  it('reuses entries and evicts the least recently used surface within its byte budget', () => {
    let creations = 0;
    const cache = new RasterCache((width, height) => {
      creations += 1;
      return { width, height };
    }, 32);
    const rendered: RasterSurface[] = [];

    const first = cache.getOrCreate('first', 2, 2, (surface) => rendered.push(surface));
    expect(cache.getOrCreate('first', 2, 2, () => undefined)).toBe(first);
    cache.getOrCreate('second', 2, 2, () => undefined);
    cache.getOrCreate('third', 2, 2, () => undefined);
    const recreated = cache.getOrCreate('first', 2, 2, () => undefined);

    expect(recreated).not.toBe(first);
    expect(creations).toBe(4);
    expect(rendered).toEqual([first]);
    expect(cache.stats).toMatchObject({
      entries: 2,
      bytes: 32,
      maxBytes: 32,
      hits: 1,
      misses: 4,
      evictions: 2,
    });
  });

  it('rejects invalid dimensions and byte budgets', () => {
    expect(() => new RasterCache(() => ({ width: 1, height: 1 }), 0)).toThrow(/positive/);
    const cache = new RasterCache(() => ({ width: 1, height: 1 }), 16);
    expect(() => cache.getOrCreate('bad', Number.NaN, 1, () => undefined)).toThrow(/finite/);
    expect(() => cache.getOrCreate('bad', 0, 1, () => undefined)).toThrow(/positive/);
  });
});
