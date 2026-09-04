export {
  renderDocumentToSvg,
  renderSceneToSvg,
  type SvgRenderOptions,
} from '@openchart/serialize';
export {
  paintSceneItemsToCanvas,
  paintSceneLayerToCanvas,
  paintSceneToCanvas,
  type CanvasPaintContext,
  type CanvasPaintOptions,
  type CanvasPaintStats,
  type CanvasRasterSurface,
} from './canvas.js';
export type { SceneLayer } from '@openchart/scene';
export {
  SceneViewportRenderer,
  type CameraState,
  type DirtyViewportPaintOptions,
  type DirtyViewportPaintStats,
  type ViewportPaintOptions,
  type ViewportPaintStats,
} from './viewport.js';
export { coalesceDirtyRects, type DirtyRectOptions } from './dirty-rects.js';
export {
  RasterCache,
  type RasterCacheStats,
  type RasterSurface,
  type RasterSurfaceFactory,
} from './raster-cache.js';
export {
  CanvasTextRasterCache,
  type CanvasTextMeasurement,
} from './text-raster-cache.js';
export {
  RenderFrameScheduler,
  type RenderFrame,
  type RenderFrameHost,
} from './frame-scheduler.js';
export {
  RenderStatsCollector,
  paintRenderStatsOverlay,
  type RenderStatsOverlayOptions,
  type RenderStatsSample,
  type RenderStatsSnapshot,
} from './stats-overlay.js';
