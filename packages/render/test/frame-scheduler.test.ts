import { describe, expect, it } from 'vitest';

import type { SceneRect } from '@openchart/scene';

import {
  RenderFrameScheduler,
  type RenderFrame,
  type RenderFrameHost,
} from '../src/index.js';

class FakeFrameHost implements RenderFrameHost {
  public requested = 0;
  public readonly cancelled: number[] = [];
  private nextHandle = 1;
  private pending: { readonly handle: number; readonly callback: (timestamp: number) => void } | undefined;

  public requestFrame(callback: (timestamp: number) => void): number {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.requested += 1;
    this.pending = { handle, callback };
    return handle;
  }

  public cancelFrame(handle: number): void {
    this.cancelled.push(handle);
    if (this.pending?.handle === handle) {
      this.pending = undefined;
    }
  }

  public flush(timestamp: number): void {
    const pending = this.pending;
    if (pending === undefined) {
      throw new Error('No animation frame is pending');
    }
    this.pending = undefined;
    pending.callback(timestamp);
  }
}

describe('RenderFrameScheduler', () => {
  it('coalesces invalidations, defers reentrant work, and lets a full frame supersede dirty work', () => {
    const host = new FakeFrameHost();
    const frames: RenderFrame[] = [];
    const scheduler = new RenderFrameScheduler(host, (frame) => {
      frames.push(frame);
      if (frames.length === 1) {
        scheduler.requestDirty([{ x: 50, y: 20, width: 5, height: 5 }]);
      }
    });

    scheduler.requestDirty([{ x: 0, y: 0, width: 10, height: 10 }]);
    scheduler.requestDirty([{ x: 10, y: 0, width: 5, height: 10 }]);
    expect(host.requested).toBe(1);

    host.flush(12.5);
    expect(frames).toEqual([
      {
        timestamp: 12.5,
        full: false,
        dirtyRects: [{ x: 0, y: 0, width: 15, height: 10 }],
      },
    ]);
    expect(host.requested).toBe(2);

    host.flush(29.2);
    expect(frames[1]).toEqual({
      timestamp: 29.2,
      full: false,
      dirtyRects: [{ x: 50, y: 20, width: 5, height: 5 }],
    });

    scheduler.requestFull();
    scheduler.requestDirty([{ x: 100, y: 100, width: 10, height: 10 }]);
    expect(host.requested).toBe(3);
    host.flush(45.9);
    expect(frames[2]).toEqual({ timestamp: 45.9, full: true, dirtyRects: [] });

    const pendingRect: SceneRect = { x: 1, y: 1, width: 1, height: 1 };
    scheduler.requestDirty([pendingRect]);
    scheduler.dispose();
    expect(host.cancelled).toEqual([4]);
    expect(() => scheduler.requestFull()).toThrow(/disposed/i);
  });
});
