import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import type { LayoutFrame, OpenChartDocument } from '@openchart/ir';
import type { Operation } from '@openchart/ops';
import {
  loadDocument,
  writeDocumentAtomically,
} from '@openchart/persistence';
import { afterEach, describe, expect, it } from 'vitest';

import { createOpenChartMcpServer } from '../src/mcp.js';
import { renderDocumentScreenshot } from '../src/screenshot.js';
import { OpenChartDocumentSession } from '../src/session.js';
import { OpenChartToolKernel } from '../src/tools.js';

const repositoryRoot = dirname(
  dirname(dirname(fileURLToPath(new URL('.', import.meta.url)))),
);
const sourcePath = join(
  repositoryRoot,
  'examples',
  'northstar-integration.openchart.json',
);
const temporaryDirectories: string[] = [];
const closeCallbacks: Array<() => Promise<void>> = [];
const uid = (value: number): string => value.toString().padStart(26, '0');

const STAGES = [
  {
    zone: 'channels',
    zoneLabel: 'Channels',
    eyebrow: 'ENTRY',
    styleId: 'style.source',
    kind: 'system',
    capabilities: ['Authenticated entry', 'Trace context'],
    nodes: [
      ['channel.web', 'Web storefront', 'Customer commerce', 'LIVE'],
      ['channel.mobile', 'Mobile apps', 'Customer mobility', 'LIVE'],
      ['channel.partner', 'Partner portal', 'B2B self-service', 'FEDERATED'],
      ['channel.edi', 'EDI network', 'Trading partners', 'SCHEDULED'],
      ['channel.ops', 'Operations console', 'Internal control', 'PRIVILEGED'],
      ['channel.batch', 'Batch intake', 'Managed file entry', 'CONTROLLED'],
    ],
  },
  {
    zone: 'trust-edge',
    zoneLabel: 'Trust and edge',
    eyebrow: 'CONTROL',
    styleId: 'style.operations',
    kind: 'control',
    capabilities: ['Policy enforcement', 'Threat signals'],
    nodes: [
      ['edge.cdn', 'Global CDN', 'Static and API edge', 'ACTIVE'],
      ['edge.waf', 'Web application firewall', 'Managed protection', 'BLOCKING'],
      ['edge.gateway', 'API gateway', 'Contract front door', 'HEALTHY'],
      ['edge.identity', 'Identity broker', 'Workforce and partner trust', 'VERIFIED'],
      ['edge.ratelimit', 'Rate policy', 'Tenant fairness', 'ENFORCED'],
      ['edge.policy', 'Policy engine', 'Contextual authorization', 'ENFORCED'],
    ],
  },
  {
    zone: 'integration',
    zoneLabel: 'Integration fabric',
    eyebrow: 'FABRIC',
    styleId: 'style.fabric',
    kind: 'service',
    capabilities: ['Contract routing', 'Replay-safe delivery'],
    nodes: [
      ['integration.orchestrator', 'Order orchestrator', 'Long-running coordination', 'HEALTHY'],
      ['integration.bus', 'Event bus', 'Ordered domain streams', 'DURABLE'],
      ['integration.mapper', 'Mapping engine', 'Partner normalization', 'HEALTHY'],
      ['integration.schema', 'Schema registry', 'Governed contracts', 'CURRENT'],
      ['integration.workflow', 'Workflow engine', 'Human and system tasks', 'RUNNING'],
      ['integration.replay', 'Replay queue', 'Poison-message recovery', 'READY'],
    ],
  },
  {
    zone: 'domain',
    zoneLabel: 'Business domains',
    eyebrow: 'DOMAIN',
    styleId: 'style.target',
    kind: 'service',
    capabilities: ['Transactional boundary', 'Business events'],
    nodes: [
      ['domain.orders', 'Order service', 'Order lifecycle', 'AVAILABLE'],
      ['domain.inventory', 'Inventory service', 'Availability and promise', 'AVAILABLE'],
      ['domain.billing', 'Billing service', 'Invoices and settlement', 'AVAILABLE'],
      ['domain.fulfillment', 'Fulfillment service', 'Pick pack and ship', 'AVAILABLE'],
      ['domain.customer', 'Customer profile', 'Identity and preferences', 'AVAILABLE'],
      ['domain.notifications', 'Notification hub', 'Multi-channel delivery', 'AVAILABLE'],
    ],
  },
  {
    zone: 'data-ops',
    zoneLabel: 'Data and operations',
    eyebrow: 'EVIDENCE',
    styleId: 'style.operations',
    kind: 'database',
    capabilities: ['Durable retention', 'Operational evidence'],
    nodes: [
      ['data.operational', 'Operational store', 'Primary transactions', 'DURABLE'],
      ['data.cache', 'Hot cache', 'Low-latency reads', 'WARM'],
      ['data.ledger', 'Financial ledger', 'Immutable postings', 'BALANCED'],
      ['data.warehouse', 'Analytics warehouse', 'Curated history', 'FRESH'],
      ['data.telemetry', 'Telemetry lake', 'Metrics logs and traces', 'OBSERVED'],
      ['data.audit', 'Audit vault', 'Compliance evidence', 'IMMUTABLE'],
    ],
  },
] as const;

const FLOWS = [
  ['channel.web', 'edge.cdn', 'HTTPS', 'TLS 1.3 · traced', 'style.flow-outbound'],
  ['channel.mobile', 'edge.waf', 'Mobile API', 'mTLS · device attested', 'style.flow-outbound'],
  ['channel.partner', 'edge.gateway', 'Partner APIs', 'OAuth 2.1 · scoped', 'style.flow-outbound'],
  ['channel.edi', 'edge.identity', 'X12 intake', 'AS2 · signed', 'style.flow-outbound'],
  ['channel.ops', 'edge.ratelimit', 'Admin actions', 'SSO · privileged', 'style.flow-outbound'],
  ['channel.batch', 'edge.policy', 'File drop', 'SFTP · checksummed', 'style.flow-outbound'],
  ['edge.cdn', 'integration.orchestrator', 'Commerce traffic', 'REST · idempotent', 'style.flow-control'],
  ['edge.waf', 'integration.bus', 'Accepted events', 'CloudEvents · ordered', 'style.flow-control'],
  ['edge.gateway', 'integration.mapper', 'Canonical requests', 'JSON · validated', 'style.flow-control'],
  ['edge.identity', 'integration.schema', 'Trust context', 'JWT · verified', 'style.flow-control'],
  ['edge.ratelimit', 'integration.workflow', 'Quota signal', 'Policy · bounded', 'style.flow-control'],
  ['edge.policy', 'integration.replay', 'Denied work', 'Envelope · reviewable', 'style.flow-control'],
  ['integration.orchestrator', 'domain.orders', 'Order commands', 'Command · deduplicated', 'style.flow-inbound'],
  ['integration.bus', 'domain.inventory', 'Stock events', 'Stream · partitioned', 'style.flow-inbound'],
  ['integration.mapper', 'domain.billing', 'Invoice maps', 'Canonical · enriched', 'style.flow-inbound'],
  ['integration.schema', 'domain.fulfillment', 'Fulfillment schema', 'Contract · versioned', 'style.flow-inbound'],
  ['integration.workflow', 'domain.customer', 'Profile tasks', 'Workflow · audited', 'style.flow-inbound'],
  ['integration.replay', 'domain.notifications', 'Delivery retry', 'Queue · replay-safe', 'style.flow-inbound'],
  ['domain.orders', 'data.operational', 'Order state', 'ACID · encrypted', 'style.flow-control'],
  ['domain.inventory', 'data.cache', 'Availability', 'Key-value · expiring', 'style.flow-control'],
  ['domain.billing', 'data.ledger', 'Journal posting', 'Double-entry · immutable', 'style.flow-control'],
  ['domain.fulfillment', 'data.warehouse', 'Shipment facts', 'CDC · append-only', 'style.flow-control'],
  ['domain.customer', 'data.telemetry', 'Profile metrics', 'OTLP · sampled', 'style.flow-control'],
  ['domain.notifications', 'data.audit', 'Delivery evidence', 'WORM · retained', 'style.flow-control'],
  ['edge.gateway', 'integration.orchestrator', 'API routes', 'REST · correlated', 'style.flow-outbound'],
  ['edge.identity', 'integration.mapper', 'Verified claims', 'JWT · minimized', 'style.flow-outbound'],
  ['integration.bus', 'domain.fulfillment', 'Shipment events', 'Stream · at-least-once', 'style.flow-inbound'],
  ['integration.workflow', 'domain.orders', 'Recovery command', 'Command · compensating', 'style.flow-inbound'],
  ['integration.schema', 'data.warehouse', 'Governed model', 'Schema · compatible', 'style.flow-control'],
  ['domain.orders', 'data.ledger', 'Financial event', 'Event · reconciled', 'style.flow-control'],
] as const;

afterEach(async () => {
  await Promise.allSettled(closeCallbacks.splice(0).map((close) => close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function nodeSpecs() {
  return STAGES.flatMap((stage) =>
    stage.nodes.map(([id, label, subtitle, status]) => ({
      id,
      label,
      subtitle,
      status,
      zone: stage.zone,
      zoneLabel: stage.zoneLabel,
      eyebrow: stage.eyebrow,
      styleId: stage.styleId,
      kind: stage.kind,
      capabilities: stage.capabilities,
    })),
  );
}

function authoringOperations(): readonly Operation[] {
  const specs = nodeSpecs();
  const operations: Operation[] = [];
  for (const [index, node] of specs.entries()) {
    operations.push({
      op: 'create_node',
      node: {
        id: node.id,
        uid: uid(1_000 + index),
        kind: node.kind,
        label: node.label,
        pageId: 'page.architecture',
        layerId: 'layer.systems',
        styleId: node.styleId,
        data: {
          zone: node.zone,
          zoneLabel: node.zoneLabel,
          eyebrow: node.eyebrow,
          subtitle: node.subtitle,
          status: node.status,
          capabilities: [...node.capabilities],
        },
      },
    });
  }
  for (const [index, node] of specs.entries()) {
    operations.push(
      {
        op: 'create_port',
        port: {
          id: `${node.id}.in`,
          uid: uid(2_000 + index * 2),
          nodeId: node.id,
          direction: 'in',
          side: 'west',
        },
      },
      {
        op: 'create_port',
        port: {
          id: `${node.id}.out`,
          uid: uid(2_001 + index * 2),
          nodeId: node.id,
          direction: 'out',
          side: 'east',
        },
      },
    );
  }
  for (const [index, [from, to, label, semantic, styleId]] of FLOWS.entries()) {
    operations.push({
      op: 'create_edge',
      edge: {
        id: `edge.flow-${String(index + 1).padStart(2, '0')}`,
        uid: uid(3_000 + index),
        fromPortId: `${from}.out`,
        toPortId: `${to}.in`,
        label,
        semantic,
        pageId: 'page.architecture',
        layerId: 'layer.systems',
        styleId,
        data: {},
      },
    });
  }
  return operations;
}

async function makeArtifactDirectory(): Promise<string> {
  const configured = process.env.OPENCHART_ACCEPTANCE_OUTPUT;
  if (configured === undefined) {
    const directory = await mkdtemp(join(tmpdir(), 'openchart-arcline-'));
    temporaryDirectories.push(directory);
    return directory;
  }
  const root = resolve(configured);
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, 'run-'));
}

async function blankAcceptanceDocument(): Promise<OpenChartDocument> {
  const source = (await loadDocument(sourcePath)).document;
  return {
    ...source,
    documentId: 'document.arcline-reference',
    uid: uid(900),
    title: 'Arcline commerce control plane',
    rev: 0,
    nodes: {},
    ports: {},
    edges: {},
    theme: undefined,
    layout: {
      options: {
        canvasWidth: 2_800,
        canvasHeight: 2_000,
        eyebrow: 'OPENCHART · ARCLINE REFERENCE',
        subtitle: 'Commerce control plane · trust, integration, domains, and evidence',
        versionLabel: 'AGENT-AUTHORED / REV 03',
      },
      overrides: {},
      derived: null,
    },
    meta: {
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    },
  };
}

async function screenshot(
  client: Client,
): Promise<{ readonly png: Buffer; readonly metadata: Record<string, unknown> }> {
  const result = await client.callTool({
    name: 'get_screenshot',
    arguments: { pageId: 'page.architecture', scale: 0.75 },
  });
  expect(result.isError).not.toBe(true);
  const image = result.content.find((item) => item.type === 'image');
  if (image?.type !== 'image') throw new Error('Screenshot returned no image');
  const png = Buffer.from(image.data, 'base64');
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return {
    png,
    metadata: result.structuredContent as Record<string, unknown>,
  };
}

describe('Arcline agent-authored acceptance', () => {
  it('authors, renders, and visually corrects a 30-node diagram over real MCP', async () => {
    const artifactDirectory = await makeArtifactDirectory();
    const documentPath = join(
      artifactDirectory,
      'arcline-commerce.openchart.json',
    );
    await writeDocumentAtomically(documentPath, await blankAcceptanceDocument());

    const session = await OpenChartDocumentSession.open(documentPath);
    const server = createOpenChartMcpServer(
      new OpenChartToolKernel(session, renderDocumentScreenshot),
    );
    const client = new Client({
      name: 'arcline-acceptance-agent',
      version: '1.0.0',
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closeCallbacks.push(async () => client.close(), async () => server.close());

    const operations = authoringOperations();
    const authoring = {
      baseRev: 0,
      txId: 'tx.arcline-author',
      idempotencyKey: 'arcline-acceptance:author',
      ops: operations,
    };
    const preview = await client.callTool({
      name: 'apply_operations',
      arguments: authoring,
    });
    expect(preview.structuredContent).toMatchObject({
      ok: true,
      dryRun: true,
      rev: 1,
      applied: 120,
    });
    expect((await loadDocument(documentPath)).document.rev).toBe(0);

    const committed = await client.callTool({
      name: 'apply_operations',
      arguments: { ...authoring, dryRun: false },
    });
    expect(committed.structuredContent).toMatchObject({
      ok: true,
      dryRun: false,
      rev: 1,
      applied: 120,
    });

    const beauty = {
      baseRev: 1,
      txId: 'tx.arcline-beauty',
      idempotencyKey: 'arcline-acceptance:beauty',
      pageId: 'page.architecture',
      layoutMode: 'layered',
      direction: 'RIGHT',
      presetId: 'openchart-dark',
    };
    expect(
      (await client.callTool({
        name: 'apply_beauty_pass',
        arguments: beauty,
      })).structuredContent,
    ).toMatchObject({ ok: true, dryRun: true, rev: 2 });
    expect(
      (await client.callTool({
        name: 'apply_beauty_pass',
        arguments: { ...beauty, dryRun: false },
      })).structuredContent,
    ).toMatchObject({ ok: true, dryRun: false, rev: 2 });

    const info = await client.callTool({
      name: 'get_document_info',
      arguments: {},
    });
    expect(info.structuredContent).toMatchObject({
      rev: 2,
      counts: { nodes: 30, ports: 60, edges: 30 },
      themePresetId: 'openchart-dark',
    });
    const initial = await screenshot(client);
    await writeFile(join(artifactDirectory, 'initial.png'), initial.png);

    const nodeIds = nodeSpecs().map(({ id }) => id);
    const subgraph = await client.callTool({
      name: 'get_nodes',
      arguments: { ids: nodeIds, depth: 0 },
    });
    expect(subgraph.isError).not.toBe(true);
    const derived = (
      subgraph.structuredContent as {
        layout?: { derived?: Record<string, LayoutFrame> | null };
      }
    ).layout?.derived;
    if (derived === undefined || derived === null) {
      throw new Error('Beauty Pass returned no derived layout');
    }
    const correctionOps: Operation[] = nodeIds.map((id) => {
      const frame = derived[id];
      if (frame === undefined) throw new Error(`Missing layout frame for ${id}`);
      return {
        op: 'set_node_layout',
        id,
        layout: {
          x: Math.round((120 + frame.x * 1.08) / 8) * 8,
          y: Math.round((184 + frame.y * 1.1) / 8) * 8,
          width: frame.width,
          height: frame.height,
          pinned: true,
        },
      };
    });
    const correction = {
      baseRev: 2,
      txId: 'tx.arcline-visual-correction',
      idempotencyKey: 'arcline-acceptance:visual-correction',
      ops: correctionOps,
    };
    expect(
      (await client.callTool({
        name: 'apply_operations',
        arguments: correction,
      })).structuredContent,
    ).toMatchObject({ ok: true, dryRun: true, rev: 3, applied: 30 });
    expect(
      (await client.callTool({
        name: 'apply_operations',
        arguments: { ...correction, dryRun: false },
      })).structuredContent,
    ).toMatchObject({ ok: true, dryRun: false, rev: 3, applied: 30 });

    const final = await screenshot(client);
    await writeFile(join(artifactDirectory, 'final.png'), final.png);
    const initialHash = createHash('sha256').update(initial.png).digest('hex');
    const finalHash = createHash('sha256').update(final.png).digest('hex');
    expect(finalHash).not.toBe(initialHash);

    const persisted = (await loadDocument(documentPath)).document;
    expect(persisted.rev).toBe(3);
    expect(Object.keys(persisted.nodes)).toHaveLength(30);
    expect(Object.keys(persisted.ports)).toHaveLength(60);
    expect(Object.keys(persisted.edges)).toHaveLength(30);
    const history = await client.callTool({
      name: 'get_history',
      arguments: {},
    });
    const historyPayload = history.structuredContent as {
      undoDepth?: unknown;
      undo?: Array<{ txId?: unknown }>;
    };
    expect(historyPayload.undoDepth).toBe(3);
    expect(historyPayload.undo?.[0]).toMatchObject({
      txId: 'tx.arcline-visual-correction',
    });

    await writeFile(
      join(artifactDirectory, 'acceptance.json'),
      `${JSON.stringify({
        documentPath,
        counts: { nodes: 30, ports: 60, edges: 30 },
        revisions: { authoring: 1, beauty: 2, visualCorrection: 3 },
        correction: 'Added title clearance and 8-10% composition spacing',
        initial: { ...initial.metadata, sha256: initialHash },
        final: { ...final.metadata, sha256: finalHash },
      }, null, 2)}\n`,
      'utf8',
    );
    process.stdout.write(`Arcline acceptance artifacts: ${artifactDirectory}\n`);
  });
});
