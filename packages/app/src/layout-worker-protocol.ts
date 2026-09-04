import type {
  BeautyPassOptions,
  BeautyPassPlan,
  LayoutDocumentOptions,
  LayoutDocumentResult,
} from '@openchart/derive';
import type { OpenChartDocument } from '@openchart/ir';

export type LayoutWorkerRequest =
  | {
      readonly requestId: string;
      readonly kind: 'layout';
      readonly document: OpenChartDocument;
      readonly options: LayoutDocumentOptions;
    }
  | {
      readonly requestId: string;
      readonly kind: 'beauty';
      readonly document: OpenChartDocument;
      readonly options: BeautyPassOptions;
    };

export type LayoutWorkerResponse =
  | {
      readonly requestId: string;
      readonly kind: 'layout';
      readonly ok: true;
      readonly result: LayoutDocumentResult;
    }
  | {
      readonly requestId: string;
      readonly kind: 'beauty';
      readonly ok: true;
      readonly result: BeautyPassPlan;
    }
  | {
      readonly requestId: string;
      readonly kind: LayoutWorkerRequest['kind'];
      readonly ok: false;
      readonly error: string;
    };

export type LayoutWorkerSuccess = Extract<LayoutWorkerResponse, { readonly ok: true }>;
