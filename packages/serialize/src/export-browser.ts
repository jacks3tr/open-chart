import type { SceneDescription } from '@openchart/scene';
import type PdfConstructor from 'pdfkit';
import { loadBrowserFonts, renderPortableSvg } from './browser-fonts.js';
import { BUNDLED_FONTS, plexPdfFont } from './fonts.js';
import { renderPdf, renderPptx } from './office-export.js';
import Helvetica from 'pdfkit/standard-fonts/Helvetica';
import HelveticaBold from 'pdfkit/standard-fonts/HelveticaBold';
import HelveticaOblique from 'pdfkit/standard-fonts/HelveticaOblique';
import HelveticaBoldOblique from 'pdfkit/standard-fonts/HelveticaBoldOblique';
import Courier from 'pdfkit/standard-fonts/Courier';
import CourierBold from 'pdfkit/standard-fonts/CourierBold';
import CourierOblique from 'pdfkit/standard-fonts/CourierOblique';
import CourierBoldOblique from 'pdfkit/standard-fonts/CourierBoldOblique';

export async function exportOfficeBlob(
  scene: SceneDescription,
  format: 'pdf' | 'pptx',
  fallbackPng?: Uint8Array,
): Promise<Blob> {
  const svg = await renderPortableSvg(scene);
  if (format === 'pptx') {
    if (fallbackPng === undefined) throw new Error('PowerPoint requires a PNG preview');
    return new Blob([new Uint8Array(await renderPptx(svg, fallbackPng, scene, scene.description))], {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });
  }
  const pdfkit = await import('pdfkit') as unknown as { default: typeof PdfConstructor; registerStdFonts?: (...fonts: unknown[]) => void };
  pdfkit.registerStdFonts?.(Helvetica, HelveticaBold, HelveticaOblique, HelveticaBoldOblique,
    Courier, CourierBold, CourierOblique, CourierBoldOblique);
  const bytes = await loadBrowserFonts();
  const fonts = Object.fromEntries(BUNDLED_FONTS.map((font, index) => [font.file, bytes[index]!]));
  return new Blob([new Uint8Array(await renderPdf(pdfkit.default, svg, scene, scene.description, plexPdfFont, fonts))], { type: 'application/pdf' });
}
