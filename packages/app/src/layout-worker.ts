import { layoutDocument, planBeautyPass } from '@openchart/derive';
import ElkWorker from 'elkjs/lib/elk-worker.min.js?worker';

import type { LayoutWorkerRequest, LayoutWorkerResponse } from './layout-worker-protocol.js';

interface WorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<LayoutWorkerRequest>) => void,
  ): void;
  postMessage(message: LayoutWorkerResponse): void;
}

const scope = globalThis as unknown as WorkerScope;
const runtime = { workerFactory: (): Worker => new ElkWorker() };

async function respond(request: LayoutWorkerRequest): Promise<void> {
  try {
    const response: LayoutWorkerResponse = request.kind === 'layout'
      ? {
          requestId: request.requestId,
          kind: request.kind,
          ok: true,
          result: await layoutDocument(request.document, request.options, runtime),
        }
      : {
          requestId: request.requestId,
          kind: request.kind,
          ok: true,
          result: await planBeautyPass(request.document, request.options, runtime),
        };
    scope.postMessage(response);
  } catch (error) {
    scope.postMessage({
      requestId: request.requestId,
      kind: request.kind,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

scope.addEventListener('message', (event) => {
  void respond(event.data);
});
