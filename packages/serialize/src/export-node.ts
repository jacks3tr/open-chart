import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { renderAsync, type RenderedImage } from '@resvg/resvg-js';
import { encode as encodeJpeg } from 'jpeg-js';
import JSZip from 'jszip';
import PDFDocument from 'pdfkit';
import svgToPdf from 'svg-to-pdfkit';

import type { OpenChartDocument, Page } from '@openchart/ir';
import {
  buildSceneDescription,
  type SceneDescription,
  type SceneGroup,
  type SceneItem,
  type SceneRect,
} from '@openchart/scene';

import { renderSceneToSvg } from './index.js';

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
const POINTS_PER_PIXEL = 72 / 96;
const EMU_PER_INCH = 914_400;
const MAX_PPTX_INCHES = 56;

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
      defaultFontFamily: 'Segoe UI',
      sansSerifFamily: 'Segoe UI',
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

function windowsFont(
  family: string,
  bold: boolean,
  italic: boolean,
): string {
  const fonts = join(process.env.SystemRoot ?? 'C:\\Windows', 'Fonts');
  const mono = /cascadia|consolas|mono/i.test(family);
  const file = mono
    ? bold && italic
      ? 'consolaz.ttf'
      : bold
        ? 'consolab.ttf'
        : italic
          ? 'consolai.ttf'
          : 'consola.ttf'
    : bold && italic
      ? 'segoeuiz.ttf'
      : bold
        ? 'segoeuib.ttf'
        : italic
          ? 'segoeuii.ttf'
          : 'segoeui.ttf';
  const path = join(fonts, file);
  if (existsSync(path)) {
    return path;
  }
  return mono
    ? bold && italic
      ? 'Courier-BoldOblique'
      : bold
        ? 'Courier-Bold'
        : italic
          ? 'Courier-Oblique'
          : 'Courier'
    : bold && italic
      ? 'Helvetica-BoldOblique'
      : bold
        ? 'Helvetica-Bold'
        : italic
          ? 'Helvetica-Oblique'
          : 'Helvetica';
}

async function renderPdf(
  svg: string,
  scene: SceneDescription,
  description: string,
): Promise<Buffer> {
  const width = scene.bounds.width * POINTS_PER_PIXEL;
  const height = scene.bounds.height * POINTS_PER_PIXEL;
  const now = new Date();
  const options: PDFKit.PDFDocumentOptions = {
    autoFirstPage: false,
    tagged: true,
    // @types/pdfkit 0.17.6 has not caught up with PDFKit's documented PDF/UA subset.
    // @ts-expect-error PDFKit 0.20.2 accepts this value at runtime.
    subset: 'PDF/UA',
    lang: 'en-US',
    displayTitle: true,
    compress: true,
    info: {
      Title: scene.title,
      Subject: scene.description,
      Author: 'OpenChart',
      Creator: 'OpenChart',
      Producer: 'OpenChart',
      CreationDate: now,
      ModDate: now,
    },
  };
  const document = new PDFDocument(options);
  const chunks: Buffer[] = [];
  const output = new Promise<Buffer>((resolve, reject) => {
    document.on('data', (chunk: Buffer | Uint8Array) => {
      chunks.push(Buffer.from(chunk));
    });
    document.once('end', () => resolve(Buffer.concat(chunks)));
    document.once('error', reject);
  });
  document.addPage({ size: [width, height], margin: 0 });
  const figure = document.struct(
    'Figure',
    { title: scene.title, alt: description, lang: 'en-US' },
    () => {
      svgToPdf(document, svg, 0, 0, {
        width,
        height,
        preserveAspectRatio: 'xMinYMin meet',
        fontCallback: windowsFont,
        warningCallback: () => undefined,
      });
    },
  );
  document.addStructure(figure);
  document.end();
  return output;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function groupShapeTree(children = ''): string {
  return `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${children}</p:spTree>`;
}

function themeXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="OpenChart"><a:themeElements><a:clrScheme name="OpenChart"><a:dk1><a:srgbClr val="10213A"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="0E192A"/></a:dk2><a:lt2><a:srgbClr val="F4F7FB"/></a:lt2><a:accent1><a:srgbClr val="2D62E8"/></a:accent1><a:accent2><a:srgbClr val="00A7A5"/></a:accent2><a:accent3><a:srgbClr val="FF6A3D"/></a:accent3><a:accent4><a:srgbClr val="7C3AED"/></a:accent4><a:accent5><a:srgbClr val="64748B"/></a:accent5><a:accent6><a:srgbClr val="D97706"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="OpenChart"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Segoe UI"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="OpenChart"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="25400" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="38100" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}

async function renderPptx(
  svg: string,
  fallbackPng: Buffer,
  scene: SceneDescription,
  altText: string,
): Promise<Buffer> {
  const sourceWidthInches = scene.bounds.width / 96;
  const sourceHeightInches = scene.bounds.height / 96;
  const fit = Math.min(
    1,
    MAX_PPTX_INCHES / sourceWidthInches,
    MAX_PPTX_INCHES / sourceHeightInches,
  );
  const width = Math.round(sourceWidthInches * fit * EMU_PER_INCH);
  const height = Math.round(sourceHeightInches * fit * EMU_PER_INCH);
  const title = escapeXml(scene.title);
  const description = escapeXml(altText);
  const now = new Date().toISOString();
  const picture = `<p:pic><p:nvPicPr><p:cNvPr id="2" name="${title}" descr="${description}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"><a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}" xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main"><asvg:svgBlip r:embed="rId3"/></a:ext></a:extLst></a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="svg" ContentType="image/svg+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${title}</dc:title><dc:subject>${description}</dc:subject><dc:creator>OpenChart</dc:creator><cp:lastModifiedBy>OpenChart</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  zip.file('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>OpenChart</Application><PresentationFormat>Custom</PresentationFormat><Slides>1</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides><MMClips>0</MMClips><ScaleCrop>false</ScaleCrop><Company>OpenChart</Company><AppVersion>16.0000</AppVersion></Properties>`);
  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="${width}" cy="${height}" type="custom"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:defaultTextStyle></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps" Target="presProps.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps" Target="viewProps.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"/></Relationships>`);
  zip.file('ppt/presProps.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentationPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`);
  zip.file('ppt/viewProps.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:viewPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:normalViewPr horzBarState="maximized"><p:restoredLeft sz="15611"/><p:restoredTop sz="94660"/></p:normalViewPr><p:slideViewPr><p:cSldViewPr snapToGrid="0" snapToObjects="1"><p:cViewPr varScale="1"><p:scale><a:sx n="1" d="1"/><a:sy n="1" d="1"/></p:scale><p:origin x="0" y="0"/></p:cViewPr><p:guideLst/></p:cSldViewPr></p:slideViewPr><p:notesTextViewPr><p:cViewPr><p:scale><a:sx n="1" d="1"/><a:sy n="1" d="1"/></p:scale><p:origin x="0" y="0"/></p:cViewPr></p:notesTextViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`);
  zip.file('ppt/tableStyles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`);
  zip.file('ppt/slideMasters/slideMaster1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="OpenChart">${groupShapeTree()}</p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:hf sldNum="0" hdr="0" ftr="0" dt="0"/><p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="3200"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr marL="0" indent="0"><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:otherStyle></p:txStyles></p:sldMaster>`);
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`);
  zip.file('ppt/slideLayouts/slideLayout1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank">${groupShapeTree()}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);
  zip.file('ppt/theme/theme1.xml', themeXml());
  zip.file('ppt/slides/slide1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="${title}">${groupShapeTree(picture)}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
  zip.file('ppt/slides/_rels/slide1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.svg"/></Relationships>`);
  zip.file('ppt/media/image1.png', fallbackPng);
  zip.file('ppt/media/image1.svg', svg);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
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
    const source = buildSceneDescription(document, { pageId });
    const region = validateRegion(options.region, source.bounds);
    const scene = prepareScene(
      source,
      region,
      options.transparent === true,
      options.altText,
    );
    const svg = renderSceneToSvg(scene);
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
          await renderPdf(svg, scene, accessibilityDescription),
        );
      case 'pptx': {
        const fallback = (await rasterize(svg, 1, region)).asPng();
        return artifact(
          'pptx',
          pageId,
          region.width,
          region.height,
          await renderPptx(svg, fallback, scene, accessibilityDescription),
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
