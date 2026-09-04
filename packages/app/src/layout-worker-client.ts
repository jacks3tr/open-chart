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

let requestCounter = 0;

function nextRequestId(): string {
  requestCounter += 1;
  return `layout-worker-${requestCounter}`;
}

function requestDerivation(request: LayoutWorkerRequest): Promise<LayoutWorkerSuccess> {
  const worker = new Worker(new URL('./layout-worker.ts', import.meta.url), {
    type: 'module',
    name: 'openchart-layout',
  });
  return new Promise((resolve, reject) => {
    const finish = (): void => worker.terminate();
    worker.addEventListener('message', (event: MessageEvent<LayoutWorkerResponse>) => {
      if (event.data.requestId !== request.requestId) {
        return;
      }
      finish();
      if (!event.data.ok) {
        reject(new Error(event.data.error));
        return;
      }
      resolve(event.data);
    });
    worker.addEventListener('error', (event) => {
      finish();
      reject(new Error(event.message || 'The layout worker failed'));
    });
    worker.postMessage(request);
  });
}

export async function requestLayout(
  document: OpenChartDocument,
  options: LayoutDocumentOptions,
): Promise<LayoutDocumentResult> {
  const response = await requestDerivation({
    requestId: nextRequestId(),
    kind: 'layout',
    document,
    options,
  });
  if (response.kind !== 'layout') {
    throw new Error('The layout worker returned the wrong response type');
  }
  return response.result;
}

export async function requestBeautyPass(
  document: OpenChartDocument,
  options: BeautyPassOptions,
): Promise<BeautyPassPlan> {
  const response = await requestDerivation({
    requestId: nextRequestId(),
    kind: 'beauty',
    document,
    options,
  });
  if (response.kind !== 'beauty') {
    throw new Error('The layout worker returned the wrong response type');
  }
  return response.result;
}
