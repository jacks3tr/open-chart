import { runInNewContext } from 'node:vm';
import { describe, expect, test } from 'vitest';
import { renderCatalogModule } from './render-icon-catalog.mjs';

describe('packed icon catalog module', () => {
  test('parses large catalog data as JSON rather than compiling a giant object-literal AST', () => {
    const simple = { id: 'simple-icons', entries: [{ name: 'quotes" \n \\ unicode ·', path: 'M 1 2' }] };
    const phosphor = { id: 'phosphor', entries: [] };
    const source = renderCatalogModule(simple, phosphor);
    expect(source).toContain('JSON.parse(');
    const decoded = runInNewContext(source.replaceAll('export const ', 'var ') +
      '; JSON.stringify([simpleIconsLibrary, phosphorLibrary])');
    expect(JSON.parse(decoded)).toEqual([simple, phosphor]);
    expect(renderCatalogModule(simple, phosphor)).toBe(source);
  });
});
