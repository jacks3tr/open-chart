import {
  CanvasTextRasterCache,
  RasterCache,
  type CameraState,
  type CanvasPaintContext,
  type CanvasRasterSurface,
  type SceneLayer,
  type SceneViewportRenderer,
} from '@openchart/render';

function createSurface(width: number, height: number): CanvasRasterSurface {
  const canvas = window.document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('A 2D canvas context is required');
  return {
    width, height,
    context: context as unknown as CanvasPaintContext,
    blit(target, destination) {
      (target as unknown as CanvasRenderingContext2D).drawImage(
        canvas, destination.x, destination.y, destination.width, destination.height,
      );
    },
  };
}

/** Per-editor budgets; allocating the cache does not allocate any pixel surfaces. */
export function createEditorRasterCaches() {
  return {
    chromeCache: new RasterCache(createSurface, 32 * 1024 * 1024),
    textCache: new CanvasTextRasterCache(createSurface, 16 * 1024 * 1024),
  };
}

/** Resize and clear only the layer whose visual inputs changed. */
export function paintCanvasLayer(
  canvas: HTMLCanvasElement | null,
  renderer: SceneViewportRenderer,
  camera: CameraState,
  layer: SceneLayer,
  caches?: ReturnType<typeof createEditorRasterCaches>,
): CanvasRenderingContext2D | undefined {
  if (canvas === null) return undefined;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(camera.viewportWidth * dpr));
  const height = Math.max(1, Math.round(camera.viewportHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  canvas.style.width = `${camera.viewportWidth}px`;
  canvas.style.height = `${camera.viewportHeight}px`;
  const context = canvas.getContext('2d');
  if (context === null) return undefined;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  renderer.paint(context as unknown as CanvasPaintContext, camera, {
    layer, devicePixelRatio: dpr, ...caches,
  });
  return context;
}
