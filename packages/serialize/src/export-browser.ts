import type { SceneDescription } from '@openchart/scene';
import type PdfConstructor from 'pdfkit';
import { renderSceneToSvg } from './index.js';
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
  const svg = renderSceneToSvg(scene);
  if (format === 'pptx') {
    if (fallbackPng === undefined) throw new Error('PowerPoint requires a PNG preview');
    return new Blob([new Uint8Array(await renderPptx(svg, fallbackPng, scene, scene.description))], {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });
  }
  const pdfkit = await import('pdfkit') as unknown as { default: typeof PdfConstructor; registerStdFonts?: (...fonts: unknown[]) => void };
  pdfkit.registerStdFonts?.(Helvetica, HelveticaBold, HelveticaOblique, HelveticaBoldOblique,
    Courier, CourierBold, CourierOblique, CourierBoldOblique);
  const font = (family: string, bold: boolean, italic: boolean): string => {
    const base = /mono|consolas|cascadia/i.test(family) ? 'Courier' : 'Helvetica';
    return base + (bold && italic ? '-BoldOblique' : bold ? '-Bold' : italic ? '-Oblique' : '');
  };
  return new Blob([new Uint8Array(await renderPdf(pdfkit.default, svg, scene, scene.description, font))], { type: 'application/pdf' });
}
