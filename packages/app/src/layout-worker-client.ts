import type {
  BeautyPassOptions,
  BeautyPassPlan,
  LayoutDocumentOptions,
  LayoutDocumentResult,
} from '@openchart/derive';
import type { OpenChartDocument } from '@openchart/ir';

import type {
  LayoutWorkerRequest,
  LayoutWorkerResponse,
  LayoutWorkerSuccess,
} from './layout-worker-protocol.js';

export interface LayoutRequestOptions {
  readonly signal?: AbortSignal;
  /** Includes time spent waiting behind another request in the worker. */
  readonly timeoutMs?: number;
}

interface PendingRequest {
  readonly resolve: (response: LayoutWorkerSuccess) => void;
  readonly reject: (error: Error) => void;
  readonly cleanup: () => void;
}

let requestCounter = 0;
let worker: Worker | undefined;
const pending = new Map<string, PendingRequest>();
const DEFAULT_TIMEOUT_MS = 30_000;

function abortError(): Error {
  return new DOMException('The layout request was cancelled', 'AbortError');
}

function stopWorker(error: Error): void {
  worker?.terminate();
  worker = undefined;
  const requests = [...pending.values()];
  pending.clear();
  for (const request of requests) {
    request.cleanup();
    request.reject(error);
  }
}

/** Release the idle worker and reject outstanding requests on editor teardown. */
export function disposeLayoutWorker(): void {
  stopWorker(abortError());
}

function getWorker(): Worker {
  if (worker !== undefined) return worker;
  const created = new Worker(new URL('./layout-worker.ts', import.meta.url), {
    type: 'module',
    name: 'openchart-layout',
  });
  worker = created;
  created.addEventListener('message', (event: MessageEvent<LayoutWorkerResponse>) => {
    if (worker !== created) return;
    const request = pending.get(event.data.requestId);
    if (request === undefined) return;
    pending.delete(event.data.requestId);
    request.cleanup();
    if (event.data.ok) request.resolve(event.data);
    else request.reject(new Error(event.data.error));
  });
  created.addEventListener('error', (event) => {
    if (worker === created) stopWorker(new Error(event.message || 'The layout worker failed'));
  });
  created.addEventListener('messageerror', () => {
    if (worker === created) stopWorker(new Error('The layout worker response could not be decoded'));
  });
  return created;
}

function requestDerivation(
  request: LayoutWorkerRequest,
  options: LayoutRequestOptions,
): Promise<LayoutWorkerSuccess> {
  if (options.signal?.aborted === true) return Promise.reject(abortError());
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    return Promise.reject(new RangeError('Layout timeout must be a positive 32-bit integer'));
  }
  return new Promise((resolve, reject) => {
    const activeWorker = getWorker();
    const cancel = (): void => {
      const entry = pending.get(request.requestId);
      if (entry === undefined) return;
      pending.delete(request.requestId);
      entry.cleanup();
      entry.reject(abortError());
      // Terminating a shared worker would also cancel unrelated callers. Once no
      // caller is waiting, terminate it to stop the cancelled CPU work as well.
      if (pending.size === 0) stopWorker(abortError());
    };
    const timeout = setTimeout(() => {
      // A worker that misses its deadline may be stuck in synchronous layout.
      // Reject all requests assigned to it rather than leave callers hanging.
      if (worker === activeWorker) stopWorker(new Error('The layout worker timed out'));
    }, timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', cancel);
    };
    pending.set(request.requestId, { resolve, reject, cleanup });
    options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      activeWorker.postMessage(request);
    } catch (error: unknown) {
      pending.delete(request.requestId);
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
      if (pending.size === 0) stopWorker(abortError());
    }
  });
}

export async function requestLayout(
  document: OpenChartDocument,
  options: LayoutDocumentOptions,
  requestOptions: LayoutRequestOptions = {},
): Promise<LayoutDocumentResult> {
  const response = await requestDerivation({
    requestId: `layout-worker-${++requestCounter}`,
    kind: 'layout',
    document,
    options,
  }, requestOptions);
  if (response.kind !== 'layout') {
    throw new Error('The layout worker returned the wrong response type');
  }
  return response.result;
}

export async function requestBeautyPass(
  document: OpenChartDocument,
  options: BeautyPassOptions,
  requestOptions: LayoutRequestOptions = {},
): Promise<BeautyPassPlan> {
  const response = await requestDerivation({
    requestId: `layout-worker-${++requestCounter}`,
    kind: 'beauty',
    document,
    options,
  }, requestOptions);
  if (response.kind !== 'beauty') {
    throw new Error('The layout worker returned the wrong response type');
  }
  return response.result;
}
