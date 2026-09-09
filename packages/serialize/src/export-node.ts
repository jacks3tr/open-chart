import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { renderAsync, type RenderedImage } from '@resvg/resvg-js';
import { encode as encodeJpeg } from 'jpeg-js';
import PDFDocument from 'pdfkit';
import { renderPdf, renderPptx } from './office-export.js';

import type { OpenChartDocument, Page } from '@openchart/ir';
import {
  buildSceneDescription,
  type SceneDescription,
  type SceneGroup,
  type SceneItem,
  type SceneRect,
} from '@openchart/scene';
import { resolveLibraryShape } from '@openchart/shapes/libraries';

import { renderSceneToSvg } from './index.js';
import { BUNDLED_FONTS, embedSvgFonts, plexPdfFont } from './fonts.js';

const fontPaths = BUNDLED_FONTS.map((font) => fileURLToPath(import.meta.resolve(`@openchart/scene/fonts/${font.file}`)));
let fontBase64: Promise<readonly string[]> | undefined;
let fontLicense: Promise<string> | undefined;

export const DOCUMENT_EXPORT_FORMATS = ['svg', 'png', 'jpeg', 'pdf', 'pptx'] as const;
export type DocumentExportFormat = (typeof DOCUMENT_EXPORT_FORMATS)[number];

export type DocumentExportRegion = SceneRect;

export interface DocumentExportOptions {
  readonly format: DocumentExportFormat;
  readonly pageId?: string;
  readonly region?: DocumentExportRegion;
  /** Raster multiplier. Vector exports retain the scene's logical dimensions. */
  readonly scale?: number;
  readonly transparent?: boolean;
  /** SVG only. Other formats deliberately omit the canonical document payload. */
  readonly includeIr?: boolean;
  readonly jpegQuality?: number;
  readonly altText?: string;
}

export interface DocumentExportArtifact {
  readonly format: DocumentExportFormat;
  readonly mimeType:
    | 'image/svg+xml'
    | 'image/png'
    | 'image/jpeg'
    | 'application/pdf'
    | 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  readonly extension: 'svg' | 'png' | 'jpg' | 'pdf' | 'pptx';
  readonly pageId: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly embeddedIr: boolean;
  readonly data: Buffer;
}

export type DocumentExportErrorCode =
  | 'INVALID_EXPORT_INPUT'
  | 'EXPORT_TOO_LARGE'
  | 'EXPORT_FAILED';

export class DocumentExportError extends Error {
  public constructor(
    public readonly code: DocumentExportErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'DocumentExportError';
  }
}

const MIN_RASTER_SCALE = 1;
const MAX_RASTER_SCALE = 16;
const MAX_RASTER_DIMENSION = 32_768;
const MAX_RASTER_PIXELS = 64 * 1024 * 1024;
const DEFAULT_JPEG_QUALITY = 92;

function boundedDetail(value: unknown): string {
  const detail = value instanceof Error ? value.message : String(value);
  return detail.length <= 240 ? detail : `${detail.slice(0, 237)}...`;
}

function comparePageOrder(left: Page, right: Page): number {
  const order =
    (left.order ?? Number.MAX_SAFE_INTEGER) -
    (right.order ?? Number.MAX_SAFE_INTEGER);
  return order === 0 ? left.id.localeCompare(right.id) : order;
}

function selectPageId(document: OpenChartDocument, requested: string | undefined): string {
  if (requested !== undefined) {
    if (document.pages[requested] === undefined) {
      throw new DocumentExportError(
        'INVALID_EXPORT_INPUT',
        `Unknown page ${JSON.stringify(requested)}`,
      );
    }
    return requested;
  }
  const first = Object.values(document.pages).sort(comparePageOrder)[0];
  if (first === undefined) {
    throw new DocumentExportError(
      'INVALID_EXPORT_INPUT',
      'The document does not contain a page to export',
    );
  }
  return first.id;
}

function validateScale(value: number | undefined): number {
  const scale = value ?? 1;
  if (!Number.isFinite(scale) || scale < MIN_RASTER_SCALE || scale > MAX_RASTER_SCALE) {
    throw new DocumentExportError(
      'INVALID_EXPORT_INPUT',
      `scale must be between ${MIN_RASTER_SCALE} and ${MAX_RASTER_SCALE}`,
    );
  }
  return scale;
}

function validateQuality(value: number | undefined): number {
  const quality = value ?? DEFAULT_JPEG_QUALITY;
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new DocumentExportError(
      'INVALID_EXPORT_INPUT',
      'jpegQuality must be an integer between 1 and 100',
    );
  }
  return quality;
}

function validateRegion(
  requested: DocumentExportRegion | undefined,
  bounds: SceneRect,
): DocumentExportRegion {
  if (requested === undefined) {
    return { ...bounds };
  }
  const { x, y, width, height } = requested;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new DocumentExportError(
      'INVALID_EXPORT_INPUT',
      'region must contain finite x/y and positive finite width/height',
    );
  }
  const epsilon = 1e-6;
  if (
    x < bounds.x - epsilon ||
    y < bounds.y - epsilon ||
    x + width > bounds.x + bounds.width + epsilon ||
    y + height > bounds.y + bounds.height + epsilon
  ) {
    throw new DocumentExportError(
      'INVALID_EXPORT_INPUT',
      'region must stay within the rendered page bounds',
    );
  }
  return { x, y, width, height };
}

function rasterDimensions(region: SceneRect, scale: number): {
  readonly width: number;
  readonly height: number;
} {
  const width = Math.max(1, Math.round(region.width * scale));
  const height = Math.max(1, Math.round(region.height * scale));
  if (
    width > MAX_RASTER_DIMENSION ||
    height > MAX_RASTER_DIMENSION ||
    width * height > MAX_RASTER_PIXELS
  ) {
    throw new DocumentExportError(
      'EXPORT_TOO_LARGE',
      `Raster output is limited to ${MAX_RASTER_DIMENSION}px per side and ${MAX_RASTER_PIXELS} pixels`,
    );
  }
  return { width, height };
}

function withoutBackgroundItem(item: SceneItem): SceneItem | undefined {
  if (item.id === 'artboard-background') {
    return undefined;
  }
  if (item.type !== 'group') {
    return item;
  }
  return {
    ...item,
    children: item.children
      .map(withoutBackgroundItem)
      .filter((child): child is SceneItem => child !== undefined),
  } satisfies SceneGroup;
}

function prepareScene(
  source: SceneDescription,
  region: DocumentExportRegion,
  transparent: boolean,
  altText: string | undefined,
): SceneDescription {
  const items = transparent
    ? source.items
        .map(withoutBackgroundItem)
        .filter((item): item is SceneItem => item !== undefined)
    : source.items;
  return {
    ...source,
    bounds: region,
    items,
    description: altText?.trim() || source.description,
  };
}

function sceneAccessibilityDescription(scene: SceneDescription): string {
  const labels: string[] = [];
  const visit = (items: readonly SceneItem[]): void => {
    for (const item of items) {
      if (item.type !== 'group') {
        continue;
      }
      if (
        (item.role === 'node' || item.role === 'container' || item.role === 'group') &&
        item.ariaLabel !== undefined &&
        item.ariaLabel.trim().length > 0
      ) {
        labels.push(item.ariaLabel.trim());
      }
      visit(item.children);
    }
  };
  visit(scene.items);
  const unique = [...new Set(labels)];
  return unique.length === 0
    ? scene.description
    : `${scene.description} Objects: ${unique.join('; ')}.`;
}

function withEmbeddedIr(svg: string, document: OpenChartDocument): string {
  const payload = Buffer.from(JSON.stringify(document), 'utf8').toString('base64url');
  return svg.replace(
    '<svg ',
    `<svg data-openchart-schema-version="${document.schemaVersion}" data-openchart-ir="${payload}" `,
  );
}

async function rasterize(svg: string, scale: number, region: SceneRect): Promise<RenderedImage> {
  rasterDimensions(region, scale);
  const rendered = await renderAsync(svg, {
    fitTo: { mode: 'zoom', value: scale },
    font: {
      loadSystemFonts: true,
      fontFiles: fontPaths,
      defaultFontFamily: 'IBM Plex Sans',
      sansSerifFamily: 'IBM Plex Sans',
      monospaceFamily: 'IBM Plex Mono',
    },
    shapeRendering: 2,
    textRendering: 1,
    imageRendering: 0,
    logLevel: 'off',
  });
  rasterDimensions({ x: 0, y: 0, width: rendered.width, height: rendered.height }, 1);
  return rendered;
}

function opaqueRgba(rendered: RenderedImage): Buffer {
  const pixels = Buffer.from(rendered.pixels);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3] ?? 255;
    if (alpha < 255) {
      const inverse = 255 - alpha;
      pixels[offset] = Math.round(((pixels[offset] ?? 0) * alpha + 255 * inverse) / 255);
      pixels[offset + 1] = Math.round(
        ((pixels[offset + 1] ?? 0) * alpha + 255 * inverse) / 255,
      );
      pixels[offset + 2] = Math.round(
        ((pixels[offset + 2] ?? 0) * alpha + 255 * inverse) / 255,
      );
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

function artifact(
  format: DocumentExportFormat,
  pageId: string,
  width: number,
  height: number,
  data: Buffer,
  embeddedIr = false,
): DocumentExportArtifact {
  const descriptors = {
    svg: ['image/svg+xml', 'svg'],
    png: ['image/png', 'png'],
    jpeg: ['image/jpeg', 'jpg'],
    pdf: ['application/pdf', 'pdf'],
    pptx: [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'pptx',
    ],
  } as const;
  const [mimeType, extension] = descriptors[format];
  return {
    format,
    mimeType,
    extension,
    pageId,
    width,
    height,
    bytes: data.byteLength,
    embeddedIr,
    data,
  };
}

export async function exportDocumentArtifact(
  document: OpenChartDocument,
  options: DocumentExportOptions,
): Promise<DocumentExportArtifact> {
  if (!DOCUMENT_EXPORT_FORMATS.includes(options.format)) {
    throw new DocumentExportError(
      'INVALID_EXPORT_INPUT',
      `Unsupported export format ${JSON.stringify(options.format)}`,
    );
  }
  const pageId = selectPageId(document, options.pageId);
  const scale = validateScale(options.scale);
  const quality = validateQuality(options.jpegQuality);
  if (options.format === 'jpeg' && options.transparent === true) {
    throw new DocumentExportError(
      'INVALID_EXPORT_INPUT',
      'JPEG does not support transparent backgrounds',
    );
  }

  try {
    const source = buildSceneDescription(document, { pageId, shapeResolver: resolveLibraryShape });
    const region = validateRegion(options.region, source.bounds);
    const scene = prepareScene(
      source,
      region,
      options.transparent === true,
      options.altText,
    );
    fontBase64 ??= Promise.all(fontPaths.map(async (path) => (await readFile(path)).toString('base64')));
    fontLicense ??= readFile(new URL(import.meta.resolve('@openchart/scene/fonts/OFL.txt')), 'utf8');
    const svg = embedSvgFonts(renderSceneToSvg(scene), await fontBase64, await fontLicense);
    const accessibilityDescription =
      options.altText?.trim() || sceneAccessibilityDescription(scene);

    switch (options.format) {
      case 'svg': {
        const embedded = options.includeIr === true;
        const data = Buffer.from(embedded ? withEmbeddedIr(svg, document) : svg, 'utf8');
        return artifact('svg', pageId, region.width, region.height, data, embedded);
      }
      case 'png': {
        const rendered = await rasterize(svg, scale, region);
        return artifact(
          'png',
          pageId,
          rendered.width,
          rendered.height,
          rendered.asPng(),
        );
      }
      case 'jpeg': {
        const rendered = await rasterize(svg, scale, region);
        const encoded = encodeJpeg(
          { width: rendered.width, height: rendered.height, data: opaqueRgba(rendered) },
          quality,
        );
        return artifact(
          'jpeg',
          pageId,
          encoded.width,
          encoded.height,
          encoded.data,
        );
      }
      case 'pdf':
        return artifact(
          'pdf',
          pageId,
          region.width,
          region.height,
          Buffer.from(await renderPdf(PDFDocument, svg, scene, accessibilityDescription, (family, bold, italic) =>
            fileURLToPath(import.meta.resolve(`@openchart/scene/fonts/${plexPdfFont(family, bold, italic)}`)))),
        );
      case 'pptx': {
        const fallback = (await rasterize(svg, 1, region)).asPng();
        return artifact(
          'pptx',
          pageId,
          region.width,
          region.height,
          Buffer.from(await renderPptx(svg, fallback, scene, accessibilityDescription)),
        );
      }
    }
  } catch (error: unknown) {
    if (error instanceof DocumentExportError) {
      throw error;
    }
    throw new DocumentExportError(
      'EXPORT_FAILED',
      `Could not export ${options.format}: ${boundedDetail(error)}`,
      { cause: error },
    );
  }
}
