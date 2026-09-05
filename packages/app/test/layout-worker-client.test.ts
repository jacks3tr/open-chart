import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayoutDocumentOptions } from '@openchart/derive';
import { validateDocument } from '@openchart/ir';
import northstarInput from '../../../examples/northstar-integration.openchart.json';
import type { LayoutWorkerRequest } from '../src/layout-worker-protocol.js';

class TestWorker extends EventTarget {
  static instances: TestWorker[] = [];
  static failPost = false;
  readonly requests: LayoutWorkerRequest[] = [];
  terminated = false;

  constructor() {
    super();
    TestWorker.instances.push(this);
  }

  postMessage(request: LayoutWorkerRequest): void {
    if (TestWorker.failPost) throw new Error('Could not clone document');
    this.requests.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  complete(result: unknown): void {
    const request = this.requests.at(-1);
    if (request === undefined) throw new Error('No request was posted');
    this.dispatchEvent(new MessageEvent('message', {
      data: { requestId: request.requestId, kind: request.kind, ok: true, result },
    }));
  }
}

function fixture() {
  const result = validateDocument(northstarInput);
  if (!result.ok) throw new Error('Invalid fixture');
  return result.document;
}

function latestWorker(): TestWorker {
  const worker = TestWorker.instances.at(-1);
  if (worker === undefined) throw new Error('No worker was created');
  return worker;
}

beforeEach(() => {
  vi.resetModules();
  TestWorker.instances = [];
  TestWorker.failPost = false;
  vi.stubGlobal('Worker', TestWorker);
});

afterEach(() => {
  for (const worker of TestWorker.instances) worker.terminate();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('layout worker lifecycle', () => {
  it('reuses the worker across successful sequential requests', async () => {
    const { requestLayout } = await import('../src/layout-worker-client.js');
    const document = fixture();
    const options = {} as LayoutDocumentOptions;
    const first = requestLayout(document, options);
    latestWorker().complete({ marker: 'first' });
    await expect(first).resolves.toEqual({ marker: 'first' });
    const second = requestLayout(document, options);
    latestWorker().complete({ marker: 'second' });
    await expect(second).resolves.toEqual({ marker: 'second' });
    expect(TestWorker.instances).toHaveLength(1);
    expect(latestWorker().terminated).toBe(false);
  });

  it('cleans up a worker when posting a document throws', async () => {
    const { requestLayout } = await import('../src/layout-worker-client.js');
    TestWorker.failPost = true;
    await expect(requestLayout(fixture(), {} as LayoutDocumentOptions))
      .rejects.toThrow('Could not clone document');
    expect(latestWorker().terminated).toBe(true);
  });
});


describe('bounded layout requests', () => {
  it('rejects a timed out request and recovers with a new worker', async () => {
    vi.useFakeTimers();
    const { requestLayout } = await import('../src/layout-worker-client.js');
    const pending = requestLayout(fixture(), {} as LayoutDocumentOptions, { timeoutMs: 50 });
    const rejected = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(latestWorker().terminated).toBe(true);
    const next = requestLayout(fixture(), {} as LayoutDocumentOptions);
    latestWorker().complete({ marker: 'recovered' });
    await expect(next).resolves.toEqual({ marker: 'recovered' });
    expect(TestWorker.instances).toHaveLength(2);
  });

  it('cancels the last pending request and releases its worker', async () => {
    const { requestLayout } = await import('../src/layout-worker-client.js');
    const controller = new AbortController();
    const pending = requestLayout(fixture(), {} as LayoutDocumentOptions, { signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(latestWorker().terminated).toBe(true);
  });

  it('does not start a worker for an already cancelled request', async () => {
    const { requestLayout } = await import('../src/layout-worker-client.js');
    await expect(requestLayout(fixture(), {} as LayoutDocumentOptions, { signal: AbortSignal.abort() }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(TestWorker.instances).toHaveLength(0);
  });

  it('correlates concurrent responses and ignores unrelated messages', async () => {
    const { requestLayout } = await import('../src/layout-worker-client.js');
    const first = requestLayout(fixture(), {} as LayoutDocumentOptions);
    const second = requestLayout(fixture(), {} as LayoutDocumentOptions);
    expect(TestWorker.instances).toHaveLength(1);
    const worker = latestWorker();
    worker.dispatchEvent(new MessageEvent('message', { data: { requestId: 'unknown', ok: true } }));
    worker.complete({ marker: 'second' });
    await expect(second).resolves.toEqual({ marker: 'second' });
    worker.dispatchEvent(new MessageEvent('message', {
      data: { requestId: worker.requests[0]?.requestId, kind: 'layout', ok: true, result: { marker: 'first' } },
    }));
    await expect(first).resolves.toEqual({ marker: 'first' });
  });

  it('rejects pending requests when a worker response cannot be decoded', async () => {
    const { requestLayout } = await import('../src/layout-worker-client.js');
    const pending = requestLayout(fixture(), {} as LayoutDocumentOptions);
    const rejected = expect(pending).rejects.toThrow('decoded');
    latestWorker().dispatchEvent(new Event('messageerror'));
    await rejected;
    expect(latestWorker().terminated).toBe(true);
  });
});
