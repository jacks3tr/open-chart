export { loadShapeCatalog, type LoadedShapeCatalog } from '@openchart/shapes/libraries-lazy';

async function importStarterTemplates() {
  return import('./starter-templates.js');
}

async function importBrowserTextExport() {
  return import('./browser-text-export.js');
}

export type StarterTemplatesModule = Awaited<ReturnType<typeof importStarterTemplates>>;
export type BrowserTextExportModule = Awaited<ReturnType<typeof importBrowserTextExport>>;

let starterTemplatesPromise: ReturnType<typeof importStarterTemplates> | undefined;
let browserTextExportPromise: ReturnType<typeof importBrowserTextExport> | undefined;

export function loadStarterTemplates(): Promise<StarterTemplatesModule> {
  starterTemplatesPromise ??= importStarterTemplates().catch((error: unknown) => {
    starterTemplatesPromise = undefined;
    throw error;
  });
  return starterTemplatesPromise;
}

export function loadBrowserTextExport(): Promise<BrowserTextExportModule> {
  browserTextExportPromise ??= importBrowserTextExport().catch((error: unknown) => {
    browserTextExportPromise = undefined;
    throw error;
  });
  return browserTextExportPromise;
}
