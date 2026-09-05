import { createRoot } from 'react-dom/client';
import { validateDocument, type OpenChartDocument } from '@openchart/ir';
import { OperationEngine } from '@openchart/ops';
import { SceneViewportRenderer, type CameraState } from '@openchart/render';
import northstarInput from '../../../examples/northstar-integration.openchart.json';
import { OpenChartEditor } from '../src/openchart-editor.js';
import { createBlankInitialDocument } from '../src/initial-document.js';
import '../src/openchart-editor.css';

// Instrument public boundaries in the test page, never in the shipped editor.
declare global {
  interface Window {
    __editorSmoke: {
      initialClones: number;
      commits: number;
      paints: number[];
      document: OpenChartDocument;
      camera?: CameraState;
    };
  }
}
const validation = validateDocument(northstarInput);
if (!validation.ok) throw new Error('Invalid smoke-test fixture');
const initial = createBlankInitialDocument(validation.document);
const stats = window.__editorSmoke = {
  initialClones: 0, commits: 0, paints: [0, 0, 0], document: initial,
} as Window['__editorSmoke'];
const clone = globalThis.structuredClone;
globalThis.structuredClone = (value, options) => {
  if (value === initial) stats.initialClones += 1;
  return clone(value, options);
};
// The wrapper below always invokes the captured method with its original receiver.
// eslint-disable-next-line @typescript-eslint/unbound-method
const apply = OperationEngine.prototype.apply;
OperationEngine.prototype.apply = function (envelope) {
  const result = apply.call(this, envelope);
  if (result.ok && !result.replayed) {
    stats.commits += 1;
    stats.document = this.document;
  }
  return result;
};
// The wrapper below always invokes the captured method with its original receiver.
// eslint-disable-next-line @typescript-eslint/unbound-method
const paint = SceneViewportRenderer.prototype.paint;
SceneViewportRenderer.prototype.paint = function (context, camera, options) {
  stats.camera = camera;
  return paint.call(this, context, camera, options);
};
// The wrapper below always invokes the captured method with its original receiver.
// eslint-disable-next-line @typescript-eslint/unbound-method
const clear = CanvasRenderingContext2D.prototype.clearRect;
CanvasRenderingContext2D.prototype.clearRect = function (x, y, width, height) {
  const layers = [...document.querySelectorAll('.oc-canvas-layer')];
  const index = layers.indexOf(this.canvas);
  if (index >= 0) stats.paints[index] = (stats.paints[index] ?? 0) + 1;
  clear.call(this, x, y, width, height);
};
const root = document.getElementById('root');
if (root === null) throw new Error('Missing smoke-test root');
createRoot(root).render(<OpenChartEditor initialDocument={initial} />);
