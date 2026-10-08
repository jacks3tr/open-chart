import { runInNewContext } from 'node:vm';
import { describe, expect, test } from 'vitest';
import { renderCatalogModule } from './render-icon-catalog.mjs';

describe('packed icon catalog module', () => {
  test('parses large catalog data as JSON rather than compiling a giant object-literal AST', () => {
    const simple = { id: 'simple-icons', entries: [{ name: 'quotes" \n \\ unicode ·', path: 'M 1 2' }] };
    const phosphor = { id: 'phosphor', entries: [] };
    const modules = renderCatalogModule(simple, phosphor);
    const source = modules['simple-icons.js'] + modules['phosphor.js'];
    expect(source).toContain('JSON.parse(');
    const decoded = runInNewContext(source.replaceAll('export const ', 'var ') +
      '; JSON.stringify([simpleIconsLibrary, phosphorLibrary])');
    expect(JSON.parse(decoded)).toEqual([simple, phosphor]);
    expect(modules['simple-icons.js']).not.toContain('phosphorLibrary');
    expect(modules['phosphor.js']).not.toContain('simpleIconsLibrary');
    expect(modules['icon-libraries.js']).not.toContain('JSON.parse(');
    expect(renderCatalogModule(simple, phosphor)).toEqual(modules);
  });
});
