import type { SceneRect } from '@openchart/scene';

import { coalesceDirtyRects, type DirtyRectOptions } from './dirty-rects.js';

function isReadonlyArray<T>(value: unknown): value is readonly T[] {
  return Array.isArray(value);
}

export interface RenderFrameHost {
  requestFrame(callback: (timestamp: number) => void): number;
  cancelFrame(handle: number): void;
}

export interface RenderFrame {
  readonly timestamp: number;
  readonly full: boolean;
  readonly dirtyRects: readonly SceneRect[];
}

export class RenderFrameScheduler {
  private readonly host: RenderFrameHost;
  private readonly onFrame: (frame: RenderFrame) => void;
  private readonly dirtyRectOptions: DirtyRectOptions | undefined;
  private pendingFrameHandle: number | undefined;
  private pendingFull = false;
  private pendingDirtyRects: SceneRect[] = [];
  private disposed = false;

  public constructor(
    host: RenderFrameHost,
    onFrame: (frame: RenderFrame) => void,
    dirtyRectOptions?: DirtyRectOptions,
  ) {
    if (
      host === null ||
      typeof host !== 'object' ||
      typeof host.requestFrame !== 'function' ||
      typeof host.cancelFrame !== 'function'
    ) {
      throw new TypeError('Render frame host must provide requestFrame and cancelFrame functions.');
    }
    if (typeof onFrame !== 'function') {
      throw new TypeError('Render frame callback must be a function.');
    }

    // Validate options at construction time so invalid margins cannot fail from an
    // animation-frame callback after the caller has moved on.
    coalesceDirtyRects([], dirtyRectOptions);

    this.host = host;
    this.onFrame = onFrame;
    this.dirtyRectOptions = dirtyRectOptions;
  }

  public requestDirty(rects: readonly SceneRect[]): void {
    this.assertActive();
    if (!isReadonlyArray<SceneRect>(rects)) {
      throw new TypeError('Render frame dirty rectangles must be an array.');
    }
    if (rects.length === 0) {
      return;
    }

    // Validate now, then snapshot caller-owned rectangles before deferring work.
    coalesceDirtyRects(rects, this.dirtyRectOptions);
    const snapshot = rects.map((rect) => ({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    }));
    if (!this.pendingFull) {
      this.pendingDirtyRects.push(...snapshot);
    }
    this.schedule();
  }

  public requestFull(): void {
    this.assertActive();
    this.pendingFull = true;
    this.pendingDirtyRects = [];
    this.schedule();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    const pendingFrameHandle = this.pendingFrameHandle;
    this.pendingFrameHandle = undefined;
    this.pendingFull = false;
    this.pendingDirtyRects = [];
    if (pendingFrameHandle !== undefined) {
      this.host.cancelFrame(pendingFrameHandle);
    }
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error('Render frame scheduler is disposed.');
    }
  }

  private schedule(): void {
    if (this.pendingFrameHandle !== undefined) {
      return;
    }

    this.pendingFrameHandle = this.host.requestFrame((timestamp) => {
      this.flush(timestamp);
    });
  }

  private flush(timestamp: number): void {
    if (this.disposed) {
      return;
    }

    const full = this.pendingFull;
    const dirtyRects = full
      ? []
      : coalesceDirtyRects(this.pendingDirtyRects, this.dirtyRectOptions);

    // Clear pending state before invoking user code. A reentrant request therefore
    // schedules a distinct frame instead of being lost behind this callback.
    this.pendingFrameHandle = undefined;
    this.pendingFull = false;
    this.pendingDirtyRects = [];

    this.onFrame({ timestamp, full, dirtyRects });
  }
}
