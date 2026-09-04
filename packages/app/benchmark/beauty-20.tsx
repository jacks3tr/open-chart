import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TOKEN_PRESET_IDS, type LayoutMode } from '@openchart/derive';
import { OperationEngine } from '@openchart/ops';

import { OpenChartEditor } from '../src/index.js';
import { requestBeautyPass } from '../src/layout-worker-client.js';
import '../src/openchart-editor.css';
import { createUglyBeautyDocument } from './beauty-corpus-fixture.js';

const MODES: readonly LayoutMode[] = ['layered', 'tree', 'radial', 'force'];
const requestedSeed = Number(new URLSearchParams(window.location.search).get('seed') ?? '1');
const seed = Number.isInteger(requestedSeed) && requestedSeed >= 1 && requestedSeed <= 20
  ? requestedSeed
  : 1;
const mode = MODES[(seed - 1) % MODES.length] ?? 'layered';
const presetId = TOKEN_PRESET_IDS[(seed - 1) % TOKEN_PRESET_IDS.length] ?? 'openchart-light';
const engine = new OperationEngine(createUglyBeautyDocument(seed));
const plan = await requestBeautyPass(engine.document, {
  pageId: 'page.architecture',
  layoutMode: mode,
  direction: 'RIGHT',
  presetId,
});
const result = engine.apply({
  txId: `browser.beauty-${seed}`,
  actor: 'user',
  origin: 'beauty',
  baseRev: 0,
  ops: plan.operations,
});
if (!result.ok) {
  throw new Error(`Beauty corpus browser seed failed: ${JSON.stringify(result.diagnostics)}`);
}

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('OpenChart Beauty corpus root element is missing');
}
document.documentElement.dataset.openchartBeautySeed = String(seed);
document.documentElement.dataset.openchartBeautyMode = mode;
document.documentElement.dataset.openchartBeautyPreset = presetId;

createRoot(rootElement).render(
  <StrictMode>
    <OpenChartEditor initialDocument={engine.document} />
  </StrictMode>,
);

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    document.documentElement.dataset.openchartBeautyReady = 'true';
  });
});
