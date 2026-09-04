import { renderAsync } from '@resvg/resvg-js';

import type { OpenChartDocument } from '@openchart/ir';

import {
  hasPngSignature,
  MAX_SCREENSHOT_BYTES,
  prepareDocumentScreenshot,
  screenshotFailure,
  type GetScreenshotInput,
  type GetScreenshotResult,
} from './screenshot-core.js';

export type {
  GetScreenshotFailure,
  GetScreenshotInput,
  GetScreenshotResult,
  GetScreenshotSuccess,
  ScreenshotRegion,
} from './screenshot-core.js';

export async function renderDocumentScreenshot(
  document: OpenChartDocument,
  input: GetScreenshotInput = {},
): Promise<GetScreenshotResult> {
  const prepared = prepareDocumentScreenshot(document, input);
  if ('ok' in prepared) return prepared;

  try {
    const rendered = await renderAsync(prepared.svg, {
      fitTo: { mode: 'zoom', value: prepared.scale },
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
    const png = rendered.asPng();
    if (
      rendered.width !== prepared.width ||
      rendered.height !== prepared.height ||
      !hasPngSignature(png)
    ) {
      return screenshotFailure('SCREENSHOT_FAILED', 'Rasterizer returned an invalid PNG');
    }
    if (png.byteLength > MAX_SCREENSHOT_BYTES) {
      return screenshotFailure(
        'SCREENSHOT_TOO_LARGE',
        `PNG payload exceeds the ${MAX_SCREENSHOT_BYTES}-byte limit`,
      );
    }
    return {
      ok: true,
      mimeType: 'image/png',
      pageId: prepared.pageId,
      region: prepared.region,
      scale: prepared.scale,
      width: rendered.width,
      height: rendered.height,
      bytes: png.byteLength,
      data: png.toString('base64'),
    };
  } catch (error: unknown) {
    return screenshotFailure(
      'SCREENSHOT_FAILED',
      `Could not render screenshot: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
