import type { OpenChartDocument, Page } from '@openchart/ir';
import {
  buildSceneDescription,
  type SceneDescription,
  type SceneRect,
} from '@openchart/scene';
import { renderSceneToSvg } from '@openchart/serialize';

const MIN_SCREENSHOT_SCALE = 0.1;
const MAX_SCREENSHOT_SCALE = 4;
const MAX_SCREENSHOT_DIMENSION = 4096;
const MAX_SCREENSHOT_PIXELS = 8_388_608;
export const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

export interface ScreenshotRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface GetScreenshotInput {
  readonly pageId?: string;
  readonly region?: ScreenshotRegion;
  readonly scale?: number;
}

export interface GetScreenshotSuccess {
  readonly ok: true;
  readonly mimeType: 'image/png';
  readonly pageId: string;
  readonly region: ScreenshotRegion;
  readonly scale: number;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly data: string;
}

export interface GetScreenshotFailure {
  readonly ok: false;
  readonly code:
    | 'INVALID_INPUT'
    | 'SCREENSHOT_FAILED'
    | 'SCREENSHOT_TOO_LARGE';
  readonly message: string;
  readonly field?: string;
}

export type GetScreenshotResult =
  | GetScreenshotSuccess
  | GetScreenshotFailure;

export interface PreparedScreenshot {
  readonly pageId: string;
  readonly region: ScreenshotRegion;
  readonly scale: number;
  readonly width: number;
  readonly height: number;
  readonly svg: string;
}

export function screenshotFailure(
  code: GetScreenshotFailure['code'],
  message: string,
  field?: string,
): GetScreenshotFailure {
  return {
    ok: false,
    code,
    message: message.length > 240 ? `${message.slice(0, 237)}...` : message,
    ...(field === undefined ? {} : { field }),
  };
}

function comparePageOrder(left: Page, right: Page): number {
  const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;
  return leftOrder === rightOrder
    ? left.id.localeCompare(right.id)
    : leftOrder - rightOrder;
}

function selectPageId(
  document: OpenChartDocument,
  requested: unknown,
): string | GetScreenshotFailure {
  if (requested !== undefined) {
    if (typeof requested !== 'string' || requested.trim().length === 0) {
      return screenshotFailure(
        'INVALID_INPUT',
        'pageId must be a non-empty string',
        'pageId',
      );
    }
    if (document.pages[requested] === undefined) {
      return screenshotFailure(
        'INVALID_INPUT',
        `Unknown page ${JSON.stringify(requested)}`,
        'pageId',
      );
    }
    return requested;
  }
  const first = Object.values(document.pages).sort(comparePageOrder)[0];
  return first?.id ?? screenshotFailure(
    'SCREENSHOT_FAILED',
    'The document does not contain a page to render',
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateScale(value: unknown): number | GetScreenshotFailure {
  const scale = value ?? 1;
  if (
    !isFiniteNumber(scale) ||
    scale < MIN_SCREENSHOT_SCALE ||
    scale > MAX_SCREENSHOT_SCALE
  ) {
    return screenshotFailure(
      'INVALID_INPUT',
      `scale must be between ${MIN_SCREENSHOT_SCALE} and ${MAX_SCREENSHOT_SCALE}`,
      'scale',
    );
  }
  return scale;
}

function validateRegion(
  value: unknown,
  bounds: SceneRect,
): ScreenshotRegion | GetScreenshotFailure {
  if (value === undefined) {
    return { ...bounds };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return screenshotFailure('INVALID_INPUT', 'region must be an object', 'region');
  }
  const candidate = value as Partial<Record<keyof ScreenshotRegion, unknown>>;
  const { x, y, width, height } = candidate;
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return screenshotFailure(
      'INVALID_INPUT',
      'region must contain finite x/y and positive finite width/height',
      'region',
    );
  }
  const epsilon = 1e-6;
  if (
    x < bounds.x - epsilon ||
    y < bounds.y - epsilon ||
    x + width > bounds.x + bounds.width + epsilon ||
    y + height > bounds.y + bounds.height + epsilon
  ) {
    return screenshotFailure(
      'INVALID_INPUT',
      'region must stay within the rendered page bounds',
      'region',
    );
  }
  return { x, y, width, height };
}

function isFailure(
  value: ScreenshotRegion | GetScreenshotFailure,
): value is GetScreenshotFailure {
  return 'ok' in value && value.ok === false;
}

function viewportScene(
  scene: SceneDescription,
  region: ScreenshotRegion,
): SceneDescription {
  return { ...scene, bounds: region };
}

export function prepareDocumentScreenshot(
  document: OpenChartDocument,
  input: GetScreenshotInput = {},
): PreparedScreenshot | GetScreenshotFailure {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return screenshotFailure('INVALID_INPUT', 'Screenshot input must be an object');
  }
  const pageId = selectPageId(document, input.pageId);
  if (typeof pageId !== 'string') return pageId;
  const scale = validateScale(input.scale);
  if (typeof scale !== 'number') return scale;

  try {
    const scene = buildSceneDescription(document, { pageId });
    const region = validateRegion(input.region, scene.bounds);
    if (isFailure(region)) return region;
    const width = Math.max(1, Math.round(region.width * scale));
    const height = Math.max(1, Math.round(region.height * scale));
    if (
      width > MAX_SCREENSHOT_DIMENSION ||
      height > MAX_SCREENSHOT_DIMENSION ||
      width * height > MAX_SCREENSHOT_PIXELS
    ) {
      return screenshotFailure(
        'SCREENSHOT_TOO_LARGE',
        `Screenshot output is limited to ${MAX_SCREENSHOT_DIMENSION}px per side and ${MAX_SCREENSHOT_PIXELS} pixels`,
        'scale',
      );
    }
    return {
      pageId,
      region,
      scale,
      width,
      height,
      svg: renderSceneToSvg(viewportScene(scene, region)),
    };
  } catch (error: unknown) {
    return screenshotFailure(
      'SCREENSHOT_FAILED',
      `Could not prepare screenshot: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function hasPngSignature(data: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => data[index] === byte);
}
