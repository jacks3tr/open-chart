import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateShapeDefinition } from '@openchart/shapes';
import {
  listShapeLibraries,
  resolveLibraryShape,
} from '@openchart/shapes/libraries';

import {
  buildShapeSceneDescription,
  type SceneDescription,
  type SceneGroup,
} from '../src/index.js';

const REPOSITORY_ROOT = resolve(
  fileURLToPath(new URL('../../../', import.meta.url)),
);
const SHAPE_COUNT = 1_000;
const COLUMNS = 25;
const CELL_WIDTH = 136;
const CELL_HEIGHT = 112;
const MAX_SHAPE_WIDTH = 92;
const MAX_SHAPE_HEIGHT = 72;

function outputPath(): string {
  const argumentIndex = process.argv.indexOf('--output');
  const value = argumentIndex === -1 ? undefined : process.argv[argumentIndex + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error('--output requires a repository-local JSON path');
  }
  const path = resolve(REPOSITORY_ROOT, value);
  if (
    path === REPOSITORY_ROOT ||
    !path.startsWith(`${REPOSITORY_ROOT}${sep}`) ||
    !path.toLowerCase().endsWith('.json')
  ) {
    throw new Error('--output must be a JSON file inside the OpenChart repository');
  }
  return path;
}

function artboard(scene: SceneDescription): SceneGroup {
  const item = scene.items[0];
  if (item?.type !== 'group' || item.role !== 'artboard') {
    throw new Error('Shape corpus scene did not produce an artboard group');
  }
  return item;
}

function createShapeCorpus(): SceneDescription {
  const libraries = listShapeLibraries();
  const catalog = libraries.flatMap((library) =>
    library.entries.map((entry) => ({ libraryId: library.id, entry })),
  );
  if (catalog.length < SHAPE_COUNT) {
    throw new Error(`Shape catalog has only ${catalog.length} entries`);
  }

  const instances = Array.from({ length: SHAPE_COUNT }, (_, index) => {
    const candidate = catalog[Math.floor((index * catalog.length) / SHAPE_COUNT)];
    if (candidate === undefined) {
      throw new Error(`Unable to sample shape catalog entry ${index}`);
    }
    const resolved = resolveLibraryShape(candidate.libraryId, candidate.entry.id);
    if (!resolved.ok) {
      throw new Error(
        `${candidate.entry.id}: ${JSON.stringify(resolved.diagnostics)}`,
      );
    }
    const defaultSize = resolved.definition.defaultSize;
    const scale = Math.min(
      MAX_SHAPE_WIDTH / defaultSize.width,
      MAX_SHAPE_HEIGHT / defaultSize.height,
    );
    const width = defaultSize.width * scale;
    const height = defaultSize.height * scale;
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const evaluated = evaluateShapeDefinition(resolved.definition, {
      frame: {
        x: column * CELL_WIDTH + (CELL_WIDTH - width) / 2,
        y: row * CELL_HEIGHT + (CELL_HEIGHT - height) / 2,
        width,
        height,
      },
    });
    if (!evaluated.ok) {
      throw new Error(
        `${candidate.entry.id}: ${JSON.stringify(evaluated.diagnostics)}`,
      );
    }
    return { id: `corpus.${String(index).padStart(4, '0')}`, shape: evaluated.shape };
  });

  const width = COLUMNS * CELL_WIDTH;
  const height = Math.ceil(SHAPE_COUNT / COLUMNS) * CELL_HEIGHT;
  const scene = buildShapeSceneDescription(instances, {
    bounds: { x: 0, y: 0, width, height },
    title: 'OpenChart 1,000-shape corpus',
    description: 'A deterministic six-library corpus for renderer and LOD acceptance.',
  });
  const baseArtboard = artboard(scene);
  return {
    ...scene,
    items: [
      {
        ...baseArtboard,
        children: [
          {
            id: 'shape-corpus-paper',
            type: 'rect',
            layer: 'background',
            frame: { x: 0, y: 0, width, height },
            fill: '#F4F7FB',
          },
          ...baseArtboard.children,
        ],
      },
    ],
  };
}

async function writeAtomically(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, 'wx');
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, path);
  } catch (error) {
    if (handle !== undefined) {
      await handle.close().catch(() => undefined);
    }
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

const scene = createShapeCorpus();
await writeAtomically(outputPath(), `${JSON.stringify(scene)}\n`);
