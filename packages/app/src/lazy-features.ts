async function importFullShapeCatalog() {
  return import('@openchart/shapes/libraries');
}

async function importStarterTemplates() {
  return import('./starter-templates.js');
}

async function importBrowserTextExport() {
  return import('./browser-text-export.js');
}

export type FullShapeCatalogModule = Awaited<ReturnType<typeof importFullShapeCatalog>>;
export type StarterTemplatesModule = Awaited<ReturnType<typeof importStarterTemplates>>;
export type BrowserTextExportModule = Awaited<ReturnType<typeof importBrowserTextExport>>;

let fullShapeCatalogPromise: ReturnType<typeof importFullShapeCatalog> | undefined;
let starterTemplatesPromise: ReturnType<typeof importStarterTemplates> | undefined;
let browserTextExportPromise: ReturnType<typeof importBrowserTextExport> | undefined;

export function loadFullShapeCatalog(): Promise<FullShapeCatalogModule> {
  fullShapeCatalogPromise ??= importFullShapeCatalog().catch((error: unknown) => {
    fullShapeCatalogPromise = undefined;
    throw error;
  });
  return fullShapeCatalogPromise;
}

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