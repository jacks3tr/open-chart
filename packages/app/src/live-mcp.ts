import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  createOpenChartMcpHandler,
  hasPngSignature,
  MAX_SCREENSHOT_BYTES,
  OpenChartToolKernel,
  prepareDocumentScreenshot,
  screenshotFailure,
  type GetScreenshotInput,
  type GetScreenshotResult,
} from '@openchart/agent/live';
import type { OpenChartDocument } from '@openchart/ir';

import type { LiveDocumentSession } from './live-document-session.js';

interface BridgeRequest {
  readonly id: string;
  readonly method: 'POST';
  readonly url: string;
  readonly headers: readonly [string, string][];
  readonly body: string;
}

interface BridgeResponse {
  readonly id: string;
  readonly status: number;
  readonly headers: readonly [string, string][];
  readonly body: string;
}

function bytesToBase64(data: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < data.length; offset += 0x8000) {
    binary += String.fromCharCode(...data.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function renderBrowserScreenshot(
  document: OpenChartDocument,
  input: GetScreenshotInput = {},
): Promise<GetScreenshotResult> {
  const prepared = prepareDocumentScreenshot(document, input);
  if ('ok' in prepared) return prepared;

  const source = URL.createObjectURL(new Blob([prepared.svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener(
        'error',
        () => reject(new Error('The SVG could not be rasterized')),
        { once: true },
      );
      image.src = source;
    });
    const canvas = window.document.createElement('canvas');
    canvas.width = prepared.width;
    canvas.height = prepared.height;
    const context = canvas.getContext('2d');
    if (context === null) {
      return screenshotFailure('SCREENSHOT_FAILED', 'Canvas rendering is unavailable');
    }
    context.drawImage(image, 0, 0, prepared.width, prepared.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => value === null
          ? reject(new Error('The browser returned an empty PNG'))
          : resolve(value),
        'image/png',
      );
    });
    if (blob.size > MAX_SCREENSHOT_BYTES) {
      return screenshotFailure(
        'SCREENSHOT_TOO_LARGE',
        `PNG payload exceeds the ${MAX_SCREENSHOT_BYTES}-byte limit`,
      );
    }
    const data = new Uint8Array(await blob.arrayBuffer());
    if (!hasPngSignature(data)) {
      return screenshotFailure('SCREENSHOT_FAILED', 'Canvas returned an invalid PNG');
    }
    return {
      ok: true,
      mimeType: 'image/png',
      pageId: prepared.pageId,
      region: prepared.region,
      scale: prepared.scale,
      width: prepared.width,
      height: prepared.height,
      bytes: data.byteLength,
      data: bytesToBase64(data),
    };
  } catch (error: unknown) {
    return screenshotFailure(
      'SCREENSHOT_FAILED',
      `Could not render screenshot: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    URL.revokeObjectURL(source);
  }
}

/** Mount the web-standard MCP handler behind the authenticated Rust loopback host. */
export async function startLiveMcpBridge(
  session: LiveDocumentSession,
): Promise<() => Promise<void>> {
  const handler = createOpenChartMcpHandler(
    new OpenChartToolKernel(session, renderBrowserScreenshot),
  );
  const unlisten = await listen<BridgeRequest>(
    'openchart-mcp-request',
    ({ payload }) => {
      void (async () => {
        let response: BridgeResponse;
        try {
          const handled = await handler.fetch(new Request(payload.url, {
            method: payload.method,
            headers: new Headers(payload.headers.map(([key, value]): [string, string] => [key, value])),
            body: payload.body,
          }));
          response = {
            id: payload.id,
            status: handled.status,
            headers: [...handled.headers.entries()],
            body: await handled.text(),
          };
        } catch (error: unknown) {
          response = {
            id: payload.id,
            status: 500,
            headers: [['content-type', 'application/json; charset=utf-8']],
            body: JSON.stringify({
              ok: false,
              code: 'MCP_HANDLER_FAILED',
              message: error instanceof Error ? error.message : String(error),
            }),
          };
        }
        await invoke('complete_mcp_request', { response });
      })();
    },
  );

  try {
    await invoke('start_mcp_host');
  } catch (error: unknown) {
    unlisten();
    await handler.close();
    throw error;
  }

  return async () => {
    unlisten();
    await handler.close();
    await invoke('stop_mcp_host');
  };
}
