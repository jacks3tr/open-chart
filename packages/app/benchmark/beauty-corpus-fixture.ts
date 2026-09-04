import { validateDocument, type OpenChartDocument } from '@openchart/ir';
import northstarInput from '../../../examples/northstar-integration.openchart.json';

function randomSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export function createUglyBeautyDocument(seed: number): OpenChartDocument {
  if (!Number.isInteger(seed) || seed < 1 || seed > 20) {
    throw new Error('Beauty corpus seed must be an integer from 1 through 20');
  }
  const validation = validateDocument(northstarInput);
  if (!validation.ok) {
    throw new Error(`Invalid Beauty corpus source: ${JSON.stringify(validation.diagnostics)}`);
  }
  const document = structuredClone(validation.document);
  const random = randomSource(seed);
  document.documentId = `document.beauty-${seed.toString().padStart(2, '0')}`;
  document.title = `OpenChart Beauty corpus ${seed.toString().padStart(2, '0')}`;
  document.rev = 0;
  delete document.theme;
  document.layout.engine = 'manual-ugly';
  delete document.layout.derivedVersion;
  document.layout.derived = null;
  document.layout.options = {
    ...document.layout.options,
    canvasWidth: 1_800,
    canvasHeight: 1_160,
    eyebrow: 'OPENCHART · BEAUTY CORPUS',
    subtitle: 'Deterministic before-and-after composition proof',
    versionLabel: `SEED / ${seed.toString().padStart(2, '0')}`,
  };
  for (const nodeId of Object.keys(document.nodes).sort()) {
    const existing = document.layout.overrides[nodeId];
    document.nodes[nodeId]!.data = {
      ...document.nodes[nodeId]!.data,
      seed,
    };
    delete document.nodes[nodeId]!.data.semanticTier;
    document.layout.overrides[nodeId] = {
      x: 500 + Math.round(random() * 130),
      y: 360 + Math.round(random() * 110),
      width: Math.round(190 + random() * 180),
      height: Math.round(96 + random() * 145),
      ...(existing?.zIndex === undefined ? {} : { zIndex: existing.zIndex }),
      pinned: false,
    };
  }
  for (const edge of Object.values(document.edges)) {
    edge.routing = {
      mode: 'straight',
      avoidObstacles: false,
      cornerRadius: 0,
      jumpStyle: 'none',
    };
  }
  const result = validateDocument(document);
  if (!result.ok) {
    throw new Error(`Invalid Beauty corpus seed ${seed}: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.document;
}
