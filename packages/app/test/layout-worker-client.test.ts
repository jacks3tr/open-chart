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
