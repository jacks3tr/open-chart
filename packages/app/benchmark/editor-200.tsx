import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { validateDocument, type Node, type OpenChartDocument } from '@openchart/ir';
import northstarInput from '../../../examples/northstar-integration.openchart.json';

import { OpenChartEditor } from '../src/index.js';
import '../src/openchart-editor.css';

function uid(value: number): string {
  return String(value).padStart(26, '0');
}

function createInteractionDocument(): OpenChartDocument {
  const validation = validateDocument(northstarInput);
  if (!validation.ok) {
    throw new Error(`Invalid source fixture: ${JSON.stringify(validation.diagnostics)}`);
  }
  const source = validation.document;
  const nodes: Record<string, Node> = {};
  const overrides: OpenChartDocument['layout']['overrides'] = {};
  const kinds = ['service', 'database', 'system', 'control'] as const;
  const styles = ['style.fabric', 'style.operations', 'style.source', 'style.target'] as const;
  const zones = ['ingress', 'platform', 'data', 'operations'] as const;
  for (let index = 0; index < 200; index += 1) {
    const id = `node.workload-${String(index + 1).padStart(3, '0')}`;
    const column = index % 20;
    const row = Math.floor(index / 20);
    const kind = kinds[index % kinds.length] ?? 'service';
    const zone = zones[Math.floor(column / 5)] ?? 'platform';
    nodes[id] = {
      id,
      uid: uid(1_000 + index),
      kind,
      label: `${zone[0]?.toUpperCase() ?? ''}${zone.slice(1)} ${String(index + 1).padStart(3, '0')}`,
      pageId: 'page.architecture',
      layerId: 'layer.systems',
      styleId: styles[index % styles.length] ?? 'style.fabric',
      data: {
        zone,
        zoneLabel: `${zone[0]?.toUpperCase() ?? ''}${zone.slice(1)} domain`,
        eyebrow: kind.toUpperCase(),
        subtitle: 'Keyboard interaction workload',
        status: index % 7 === 0 ? 'WATCH' : 'READY',
      },
    };
    overrides[id] = {
      x: 100 + column * 205,
      y: 180 + row * 190,
      width: 172,
      height: 126,
      zIndex: index,
      pinned: true,
    };
  }
  const document: OpenChartDocument = {
    ...source,
    documentId: 'document.interaction-200',
    uid: uid(900),
    title: 'OpenChart 200-shape keyboard interaction proof',
    rev: 0,
    nodes,
    ports: {},
    edges: {},
    layout: {
      engine: 'manual-reference',
      options: {
        canvasWidth: 4_300,
        canvasHeight: 2_180,
        eyebrow: 'OPENCHART · PHASE 3 ACCEPTANCE',
        subtitle: 'Two hundred independently editable architecture objects',
        versionLabel: 'INTERACTION / 200',
      },
      overrides,
      derived: null,
    },
    meta: {
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    },
  };
  const result = validateDocument(document);
  if (!result.ok) {
    throw new Error(`Invalid 200-shape fixture: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.document;
}

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('OpenChart root element is missing');
}
const interactionDocument = createInteractionDocument();
document.documentElement.dataset.openchartNodeCount = String(
  Object.keys(interactionDocument.nodes).length,
);

createRoot(rootElement).render(
  <StrictMode>
    <OpenChartEditor initialDocument={interactionDocument} />
  </StrictMode>,
);
