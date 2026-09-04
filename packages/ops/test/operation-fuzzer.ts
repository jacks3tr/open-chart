import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { validateDocument, type Node, type OpenChartDocument } from '@openchart/ir';

import { OperationEngine, type Operation, type OperationEnvelope } from '../src/index.js';

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const FIXTURE_PATH = resolve(REPOSITORY_ROOT, 'examples/northstar-integration.openchart.json');
const DEFAULT_SEQUENCES = 10_000;
const DEFAULT_SEED = 0x4f50454e;
const SCENARIO_COUNT = 18;

interface FuzzCase {
  readonly name: string;
  readonly expected: 'accept' | 'reject';
  readonly envelope: unknown;
}

function integerArgument(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} requires a positive integer`);
  }
  return value;
}

function randomGenerator(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = DEFAULT_SEED;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function makeNode(
  template: Node,
  id: string,
  uid: string,
  extras: Pick<Node, 'container'> | Record<never, never> = {},
): Node {
  return {
    id,
    uid,
    kind: template.kind,
    label: `Fuzz ${id}`,
    pageId: template.pageId,
    layerId: template.layerId,
    styleId: template.styleId,
    data: {},
    ...extras,
  };
}

function makeEnvelope(
  sequence: number,
  operations: readonly Operation[],
  baseRev = 0,
): OperationEnvelope {
  return {
    txId: `fuzz.${sequence}`,
    actor: 'agent',
    origin: 'mcp',
    baseRev,
    ops: operations,
  };
}

function generateCase(
  scenario: number,
  sequence: number,
  random: () => number,
  document: OpenChartDocument,
): FuzzCase {
  const nodeIds = Object.keys(document.nodes);
  const edgeIds = Object.keys(document.edges);
  const styleIds = Object.keys(document.styles);
  const nodeId = nodeIds[random() % nodeIds.length];
  const edgeId = edgeIds[random() % edgeIds.length];
  const styleId = styleIds[random() % styleIds.length];
  if (nodeId === undefined || edgeId === undefined || styleId === undefined) {
    throw new Error('The fuzz fixture must contain nodes, edges, and styles');
  }
  const node = document.nodes[nodeId];
  const edge = document.edges[edgeId];
  if (node === undefined || edge === undefined) {
    throw new Error('The fuzz fixture lookup failed');
  }

  switch (scenario) {
    case 0:
      return {
        name: 'valid-label',
        expected: 'accept',
        envelope: makeEnvelope(sequence, [
          { op: 'set_node_label', id: nodeId, label: `Agent label ${random()}` },
        ]),
      };
    case 1:
      return {
        name: 'valid-data',
        expected: 'accept',
        envelope: makeEnvelope(sequence, [
          { op: 'set_node_data', id: nodeId, data: { sequence, value: random() } },
        ]),
      };
    case 2:
      return {
        name: 'valid-style',
        expected: 'accept',
        envelope: makeEnvelope(sequence, [{ op: 'set_node_style', id: nodeId, styleId }]),
      };
    case 3:
      return {
        name: 'valid-z-index',
        expected: 'accept',
        envelope: makeEnvelope(sequence, [
          { op: 'set_node_z_index', id: nodeId, zIndex: random() % 100 },
        ]),
      };
    case 4:
      return {
        name: 'valid-edge-label',
        expected: 'accept',
        envelope: makeEnvelope(sequence, [
          { op: 'set_edge_label', id: edgeId, label: `Flow ${random()}` },
        ]),
      };
    case 5:
      return {
        name: 'valid-atomic-batch',
        expected: 'accept',
        envelope: makeEnvelope(sequence, [
          { op: 'set_node_label', id: nodeId, label: `Batch ${sequence}` },
          { op: 'set_node_data', id: nodeId, data: { batch: true } },
          { op: 'set_node_style', id: nodeId, styleId },
        ]),
      };
    case 6:
      return {
        name: 'valid-create',
        expected: 'accept',
        envelope: makeEnvelope(sequence, [
          {
            op: 'create_node',
            node: makeNode(node, 'fuzz.temporary', '99999999999999999999999990'),
          },
        ]),
      };
    case 7:
      return {
        name: 'valid-delete',
        expected: 'accept',
        envelope: makeEnvelope(sequence, [{ op: 'delete_node', id: nodeId }]),
      };
    case 8:
      return {
        name: 'valid-rename',
        expected: 'accept',
        envelope: makeEnvelope(sequence, [
          { op: 'rename_node', id: nodeId, newId: 'fuzz.renamed' },
        ]),
      };
    case 9:
      return {
        name: 'dangling-id',
        expected: 'reject',
        envelope: makeEnvelope(sequence, [
          { op: 'set_node_label', id: 'node.missing', label: 'Must not apply' },
        ]),
      };
    case 10:
      return {
        name: 'atomic-invalid-second-op',
        expected: 'reject',
        envelope: makeEnvelope(sequence, [
          { op: 'set_node_label', id: nodeId, label: 'Must roll back' },
          { op: 'set_node_style', id: nodeId, styleId: 'style.missing' },
        ]),
      };
    case 11:
      return {
        name: 'duplicate-id',
        expected: 'reject',
        envelope: makeEnvelope(sequence, [
          {
            op: 'create_node',
            node: makeNode(node, nodeId, '99999999999999999999999993'),
          },
        ]),
      };
    case 12:
      return {
        name: 'duplicate-uid',
        expected: 'reject',
        envelope: makeEnvelope(sequence, [
          { op: 'create_node', node: makeNode(node, 'fuzz.duplicate-uid', node.uid) },
        ]),
      };
    case 13: {
      const first = makeNode(node, 'fuzz.container-a', '99999999999999999999999991', {
        container: { title: 'A' },
      });
      const second = makeNode(node, 'fuzz.container-b', '99999999999999999999999992', {
        container: { title: 'B' },
      });
      return {
        name: 'parent-cycle',
        expected: 'reject',
        envelope: makeEnvelope(sequence, [
          { op: 'create_node', node: first },
          { op: 'create_node', node: second },
          { op: 'set_node_parent', id: first.id, parentId: second.id },
          { op: 'set_node_parent', id: second.id, parentId: first.id },
        ]),
      };
    }
    case 14:
      return {
        name: 'malformed-schema',
        expected: 'reject',
        envelope: {
          ...makeEnvelope(sequence, [{ op: 'set_node_z_index', id: nodeId, zIndex: 0 }]),
          ops: [{ op: 'set_node_z_index', id: nodeId, zIndex: -1 }],
        },
      };
    case 15:
      return {
        name: 'stale-revision',
        expected: 'reject',
        envelope: makeEnvelope(
          sequence,
          [{ op: 'set_node_label', id: nodeId, label: 'Stale' }],
          document.rev + 1,
        ),
      };
    case 16:
      return {
        name: 'dangling-edge-endpoint',
        expected: 'reject',
        envelope: makeEnvelope(sequence, [
          {
            op: 'create_edge',
            edge: {
              ...edge,
              id: 'edge.fuzz-dangling',
              uid: '99999999999999999999999994',
              fromPortId: 'port.missing',
            },
          },
        ]),
      };
    default:
      return {
        name: 'empty-envelope',
        expected: 'reject',
        envelope: { ...makeEnvelope(sequence, []), ops: [] },
      };
  }
}

function exercise(engine: OperationEngine, fuzzCase: FuzzCase): 'accept' | 'reject' {
  const before = engine.document;
  let result;
  try {
    result = engine.apply(fuzzCase.envelope as OperationEnvelope);
  } catch (error: unknown) {
    throw new Error(`${fuzzCase.name} panicked`, { cause: error });
  }

  if (result.ok !== (fuzzCase.expected === 'accept')) {
    throw new Error(
      `${fuzzCase.name} expected ${fuzzCase.expected} but returned ${JSON.stringify(result)}`,
    );
  }
  if (!result.ok) {
    if (engine.document !== before) {
      throw new Error(`${fuzzCase.name} partially applied a rejected transaction`);
    }
    return 'reject';
  }

  const validation = validateDocument(engine.document);
  if (!validation.ok) {
    throw new Error(`${fuzzCase.name} produced invalid state: ${JSON.stringify(validation.diagnostics)}`);
  }
  const undo = engine.undo();
  if (!undo.ok || !isDeepStrictEqual(engine.document, before)) {
    throw new Error(`${fuzzCase.name} did not restore the pre-transaction document`);
  }
  return 'accept';
}

const sequences = integerArgument('--sequences', DEFAULT_SEQUENCES);
const seed = integerArgument('--seed', DEFAULT_SEED) >>> 0;
const parsed = validateDocument(JSON.parse(await readFile(FIXTURE_PATH, 'utf8')));
if (!parsed.ok) {
  throw new Error(`Invalid fuzz fixture: ${JSON.stringify(parsed.diagnostics)}`);
}
const engine = new OperationEngine(parsed.document);

const exactLimitOps: Operation[] = Array.from({ length: 5_001 }, (_, index) => ({
  op: 'set_node_label',
  id: 'service.ingress',
  label: `Limit ${index}`,
}));
exercise(engine, {
  name: 'exact-5000-op-batch',
  expected: 'accept',
  envelope: makeEnvelope(-1, exactLimitOps.slice(0, 5_000)),
});
exercise(engine, {
  name: 'oversized-5001-op-batch',
  expected: 'reject',
  envelope: makeEnvelope(-2, exactLimitOps),
});

const random = randomGenerator(seed);
const scenarioCounts = Array.from({ length: SCENARIO_COUNT }, () => 0);
let accepted = 0;
let rejected = 0;
const started = performance.now();
for (let sequence = 0; sequence < sequences; sequence += 1) {
  const scenario = random() % SCENARIO_COUNT;
  scenarioCounts[scenario] = (scenarioCounts[scenario] ?? 0) + 1;
  const outcome = exercise(engine, generateCase(scenario, sequence, random, engine.document));
  if (outcome === 'accept') accepted += 1;
  else rejected += 1;
  if (sequences >= 100_000 && (sequence + 1) % 100_000 === 0) {
    process.stderr.write(`OpenChart operation fuzz: ${sequence + 1}/${sequences}\n`);
  }
}
const elapsedMs = performance.now() - started;
if (scenarioCounts.some((count) => count === 0)) {
  throw new Error(`The deterministic run missed a scenario: ${JSON.stringify(scenarioCounts)}`);
}

const report = {
  schemaVersion: 1,
  seed,
  sequences,
  accepted,
  rejected,
  exactLimitBatch: 5_000,
  oversizedBatch: 5_001,
  scenarioCounts,
  elapsedMs,
  sequencesPerSecond: sequences / (elapsedMs / 1_000),
  passed: true,
};
const outputPath = resolve(REPOSITORY_ROOT, `.openchart-benchmarks/operation-fuzz-${sequences}.json`);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
