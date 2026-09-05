/* global console, process */

import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { icons as phosphorIcons } from '@phosphor-icons/core';
import svgpath from 'svgpath';
import { renderCatalogModule } from './render-icon-catalog.mjs';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, '..');
const SIMPLE_ICONS_ROOT = join(REPOSITORY_ROOT, 'node_modules', 'simple-icons');
const PHOSPHOR_ROOT = join(
  REPOSITORY_ROOT,
  'node_modules',
  '@phosphor-icons',
  'core',
);
const OUTPUT_DIRECTORY = join(
  REPOSITORY_ROOT,
  'packages',
  'shapes',
  'generated',
);
const OUTPUT_PATH = join(OUTPUT_DIRECTORY, 'icon-libraries.js');
const argumentsAfterScript = process.argv.slice(2);
if (
  argumentsAfterScript.length > 1 ||
  (argumentsAfterScript.length === 1 && argumentsAfterScript[0] !== '--check')
) {
  throw new Error('Usage: node scripts/generate-icon-catalog.mjs [--check]');
}
const CHECK_ONLY = argumentsAfterScript[0] === '--check';
const PHOSPHOR_WEIGHTS = [
  'thin',
  'light',
  'regular',
  'bold',
  'fill',
  'duotone',
];
const VIEW_BOX_NUMBER_PATTERN =
  /[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g;
const ATTRIBUTE_PATTERN =
  /([A-Za-z_:][A-Za-z0-9:._-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
const PATH_TAG_PATTERN = /<path\b([^>]*)>/gi;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function requiredString(value, context) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${context} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value, context) {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, context);
}

function parseAttributes(source) {
  const attributes = new Map();
  for (const match of source.matchAll(ATTRIBUTE_PATTERN)) {
    const name = match[1].toLowerCase();
    attributes.set(name, match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function parseViewBox(svg, assetPath) {
  const svgTag = /<svg\b([^>]*)>/i.exec(svg);
  if (svgTag === null) {
    throw new Error(`Missing <svg> element in ${assetPath}`);
  }
  const viewBox = parseAttributes(svgTag[1]).get('viewbox');
  if (viewBox === undefined) {
    throw new Error(`Missing viewBox in ${assetPath}`);
  }
  const numbers = viewBox.match(VIEW_BOX_NUMBER_PATTERN) ?? [];
  if (numbers.length !== 4) {
    throw new Error(`Malformed viewBox in ${assetPath}`);
  }
  const [x, y, width, height] = numbers.map(Number);
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error(`Invalid viewBox in ${assetPath}`);
  }
  return { x, y, width, height };
}

function readSvgPaths(svg, assetPath) {
  const viewBox = parseViewBox(svg, assetPath);
  const paths = [];
  for (const match of svg.matchAll(PATH_TAG_PATTERN)) {
    const attributes = parseAttributes(match[1]);
    const d = attributes.get('d');
    if (d === undefined || d.trim().length === 0) {
      throw new Error(`Missing path data in ${assetPath}`);
    }
    let opacity;
    if (attributes.has('opacity')) {
      opacity = Number(attributes.get('opacity'));
      if (!Number.isFinite(opacity)) {
        throw new Error(`Invalid path opacity in ${assetPath}`);
      }
    }
    paths.push({ d, opacity });
  }
  if (paths.length === 0) {
    throw new Error(`Missing <path> elements in ${assetPath}`);
  }
  return { viewBox, paths };
}

function finiteNumber(value, context) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Non-finite ${context}`);
  }
  return value;
}

function normalizedPathCommands(d, viewBox, assetPath) {
  try {
    const path = svgpath(d).abs().unshort().unarc();
    if (viewBox.x !== 0 || viewBox.y !== 0) {
      path.translate(-viewBox.x, -viewBox.y);
    }
    path.scale(1 / viewBox.width, 1 / viewBox.height).round(6);

    const commands = [];
    path.iterate((segment, index, startX, startY) => {
      const command = segment[0];
      switch (command) {
        case 'M':
        case 'L':
          if (segment.length !== 3) {
            throw new Error(`Malformed ${command} command at segment ${index}`);
          }
          commands.push([
            command,
            finiteNumber(segment[1], `${command} x coordinate`),
            finiteNumber(segment[2], `${command} y coordinate`),
          ]);
          return;
        case 'H':
          if (segment.length !== 2) {
            throw new Error(`Malformed H command at segment ${index}`);
          }
          commands.push([
            'L',
            finiteNumber(segment[1], 'H x coordinate'),
            finiteNumber(startY, 'H start y coordinate'),
          ]);
          return;
        case 'V':
          if (segment.length !== 2) {
            throw new Error(`Malformed V command at segment ${index}`);
          }
          commands.push([
            'L',
            finiteNumber(startX, 'V start x coordinate'),
            finiteNumber(segment[1], 'V y coordinate'),
          ]);
          return;
        case 'Q':
          if (segment.length !== 5) {
            throw new Error(`Malformed Q command at segment ${index}`);
          }
          commands.push([
            'Q',
            finiteNumber(segment[1], 'Q control x coordinate'),
            finiteNumber(segment[2], 'Q control y coordinate'),
            finiteNumber(segment[3], 'Q x coordinate'),
            finiteNumber(segment[4], 'Q y coordinate'),
          ]);
          return;
        case 'C':
          if (segment.length !== 7) {
            throw new Error(`Malformed C command at segment ${index}`);
          }
          commands.push([
            'C',
            finiteNumber(segment[1], 'C control1 x coordinate'),
            finiteNumber(segment[2], 'C control1 y coordinate'),
            finiteNumber(segment[3], 'C control2 x coordinate'),
            finiteNumber(segment[4], 'C control2 y coordinate'),
            finiteNumber(segment[5], 'C x coordinate'),
            finiteNumber(segment[6], 'C y coordinate'),
          ]);
          return;
        case 'Z':
          if (segment.length !== 1) {
            throw new Error(`Malformed Z command at segment ${index}`);
          }
          commands.push(['Z']);
          return;
        default:
          throw new Error(`Unsupported SVG path command ${String(command)}`);
      }
    });

    if (commands.length === 0) {
      throw new Error('SVG path has no commands');
    }
    return commands;
  } catch (error) {
    throw new Error(`Invalid SVG path in ${assetPath}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

function vectorPathsFromSvg(svg, assetPath) {
  const { viewBox, paths } = readSvgPaths(svg, assetPath);
  return paths.map(({ d, opacity }) => {
    normalizedPathCommands(d, viewBox, assetPath);
    const vectorPath = {
      data: d.trim(),
      viewBox: [viewBox.x, viewBox.y, viewBox.width, viewBox.height],
    };
    if (opacity !== undefined) vectorPath.opacity = opacity;
    return vectorPath;
  });
}

function collectStrings(value, output) {
  if (typeof value === 'string') {
    output.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, output);
  }
}

function sortedTags(values, omitMarkers = false) {
  const tags = new Set();
  for (const value of values) {
    const strings = [];
    collectStrings(value, strings);
    for (const string of strings) {
      const tag = string.trim().toLowerCase();
      if (
        tag.length > 0 &&
        (!omitMarkers || !(tag.startsWith('*') && tag.endsWith('*')))
      ) {
        tags.add(tag);
      }
    }
  }
  return [...tags].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function ensureSafeAssetName(name, context) {
  if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    throw new Error(`Unsafe ${context}: ${name}`);
  }
  return name;
}

function catalogIdSegment(value, context) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (normalized.length === 0) {
    throw new Error(`${context} cannot form a catalog identifier`);
  }
  return normalized;
}

function humanizeIconName(name) {
  return name
    .split('-')
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

function iconLicense(license, context) {
  if (license === undefined || license === null) return undefined;
  if (typeof license !== 'object' || Array.isArray(license)) {
    throw new Error(`${context} must be an object`);
  }
  const name = requiredString(license.type, `${context}.type`);
  const url = optionalString(license.url, `${context}.url`);
  return url === undefined ? { name } : { name, url };
}

async function readPackage(packagePath) {
  let source;
  try {
    source = await readFile(packagePath, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read ${packagePath}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(
      `Malformed package metadata ${packagePath}: ${errorMessage(error)}`,
      { cause: error },
    );
  }
}

async function readJson(jsonPath) {
  let source;
  try {
    source = await readFile(jsonPath, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read ${jsonPath}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Malformed JSON ${jsonPath}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

async function readSvgFile(assetPath) {
  let source;
  try {
    source = await readFile(assetPath, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read ${assetPath}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
  return vectorPathsFromSvg(source, assetPath);
}

async function buildSimpleIconsLibrary(simplePackage) {
  const metadataPath = join(SIMPLE_ICONS_ROOT, 'data', 'simple-icons.json');
  const metadata = await readJson(metadataPath);
  if (!Array.isArray(metadata)) {
    throw new Error(`Simple Icons metadata must be an array: ${metadataPath}`);
  }

  const ids = new Set();
  const entries = [];
  for (const [index, icon] of metadata.entries()) {
    if (icon === null || typeof icon !== 'object' || Array.isArray(icon)) {
      throw new Error(`Simple Icons entry ${index} must be an object`);
    }
    const title = requiredString(icon.title, `Simple Icons entry ${index}.title`);
    const slug = ensureSafeAssetName(
      requiredString(icon.slug, `Simple Icons entry ${index}.slug`),
      'Simple Icons slug',
    );
    const hex = requiredString(icon.hex, `Simple Icons entry ${index}.hex`);
    if (!/^[0-9A-Fa-f]{6}$/.test(hex)) {
      throw new Error(`Invalid Simple Icons color for ${slug}: ${hex}`);
    }
    const sourceUrl = requiredString(
      icon.source,
      `Simple Icons entry ${index}.source`,
    );
    const id = `simple.${catalogIdSegment(slug, 'Simple Icons slug')}`;
    if (ids.has(id)) throw new Error(`Duplicate entry ID: ${id}`);
    ids.add(id);

    const assetPath = join(SIMPLE_ICONS_ROOT, 'icons', `${slug}.svg`);
    const paths = await readSvgFile(assetPath);
    if (paths.length === 0) throw new Error(`Empty vector variant: ${assetPath}`);
    const provenance = {
      sourceUrl,
      packageName: requiredString(simplePackage.name, 'simple-icons package name'),
      packageVersion: requiredString(
        simplePackage.version,
        'simple-icons package version',
      ),
      packageLicense: requiredString(
        simplePackage.license,
        'simple-icons package license',
      ),
      upstreamId: slug,
      trademark: true,
    };
    const guidelinesUrl = optionalString(
      icon.guidelines,
      `Simple Icons entry ${index}.guidelines`,
    );
    if (guidelinesUrl !== undefined) provenance.guidelinesUrl = guidelinesUrl;
    const license = iconLicense(
      icon.license,
      `Simple Icons entry ${index}.license`,
    );
    if (license !== undefined) provenance.iconLicense = license;

    entries.push({
      id,
      name: title,
      tags: sortedTags([title, slug, icon.aliases]),
      defaultSize: { width: 96, height: 96 },
      composition: 'circle',
      provenance,
      kind: 'vector',
      defaultVariant: 'brand',
      defaultColor: `#${hex}`,
      variants: { brand: { paths } },
    });
  }

  return {
    catalogVersion: 1,
    id: 'simple-icons',
    name: 'Simple Icons',
    version: requiredString(simplePackage.version, 'simple-icons package version'),
    license: {
      name: 'CC0-1.0',
      url: 'https://creativecommons.org/publicdomain/zero/1.0/',
      notice:
        'The package is CC0-1.0; individual brand licenses, trademarks, and usage guidelines still apply.',
    },
    entries,
  };
}

function packageRepository(packageMetadata, context) {
  const repository = packageMetadata.repository;
  if (typeof repository === 'string') return requiredString(repository, context);
  if (repository !== null && typeof repository === 'object') {
    return requiredString(repository.url, `${context}.url`);
  }
  throw new Error(`${context} must identify an official repository`);
}

async function readPhosphorWeight(name, weight) {
  const filenames = [
    `${name}.svg`,
    `${name}-${weight}.svg`,
  ];
  let missing = true;
  for (const filename of filenames) {
    const assetPath = join(PHOSPHOR_ROOT, 'assets', weight, filename);
    try {
      const paths = await readSvgFile(assetPath);
      missing = false;
      if (paths.length === 0) throw new Error(`Empty vector variant: ${assetPath}`);
      return paths;
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      if (
        error instanceof Error &&
        error.message.startsWith('Unable to read ') &&
        error.cause?.code === 'ENOENT'
      ) {
        continue;
      }
      if (error instanceof Error && error.message.startsWith('Unable to read ')) {
        throw error;
      }
      throw error;
    }
  }
  if (missing) {
    throw new Error(`Missing Phosphor ${weight} asset for ${name}`);
  }
  throw new Error(`Empty Phosphor ${weight} asset for ${name}`);
}

async function buildPhosphorLibrary(phosphorPackage) {
  if (!Array.isArray(phosphorIcons)) {
    throw new Error('Phosphor icons catalog must be an array');
  }
  const ids = new Set();
  const entries = [];
  const sourceUrl = packageRepository(
    phosphorPackage,
    'Phosphor package repository',
  );
  const packageName = requiredString(
    phosphorPackage.name,
    'Phosphor package name',
  );
  const packageVersion = requiredString(
    phosphorPackage.version,
    'Phosphor package version',
  );
  const packageLicense = requiredString(
    phosphorPackage.license,
    'Phosphor package license',
  );

  for (const [index, icon] of phosphorIcons.entries()) {
    if (icon === null || typeof icon !== 'object' || Array.isArray(icon)) {
      throw new Error(`Phosphor entry ${index} must be an object`);
    }
    const name = ensureSafeAssetName(
      requiredString(icon.name, `Phosphor entry ${index}.name`),
      'Phosphor icon name',
    );
    const pascalName = requiredString(
      icon.pascal_name,
      `Phosphor entry ${index}.pascal_name`,
    );
    const id = `phosphor.${name}`;
    if (ids.has(id)) throw new Error(`Duplicate entry ID: ${id}`);
    ids.add(id);

    const variants = {};
    for (const weight of PHOSPHOR_WEIGHTS) {
      const paths = await readPhosphorWeight(name, weight);
      if (paths.length === 0) {
        throw new Error(`Empty Phosphor ${weight} variant for ${name}`);
      }
      variants[weight] = { paths };
    }
    if (Object.keys(variants).length === 0) {
      throw new Error(`Empty Phosphor variants for ${name}`);
    }

    const categories = Array.isArray(icon.categories) ? icon.categories : [];
    const isTrademarked = categories.some(
      (category) =>
        typeof category === 'string' && category.trim().toLowerCase() === 'brands',
    );
    entries.push({
      id,
      name: humanizeIconName(name),
      tags: sortedTags(
        [
          name,
          pascalName,
          icon.categories,
          icon.figma_category,
          icon.tags,
        ],
        true,
      ),
      defaultSize: { width: 96, height: 96 },
      composition: 'circle',
      provenance: {
        sourceUrl,
        packageName,
        packageVersion,
        packageLicense,
        upstreamId: name,
        trademark: isTrademarked,
      },
      kind: 'vector',
      defaultVariant: 'regular',
      variants,
    });
  }

  return {
    catalogVersion: 1,
    id: 'phosphor',
    name: 'Phosphor',
    version: packageVersion,
    license: {
      name: 'MIT',
      url: 'https://opensource.org/license/mit/',
    },
    entries,
  };
}

function isVerifiedTempPath(tempPath) {
  const outputDirectoryPath = resolve(OUTPUT_DIRECTORY);
  const resolvedTempPath = resolve(tempPath);
  const relativePath = resolvedTempPath.slice(
    `${outputDirectoryPath}${sep}`.length,
  );
  return (
    dirname(resolvedTempPath) === outputDirectoryPath &&
    relativePath.startsWith('.icon-libraries.') &&
    relativePath.endsWith('.tmp') &&
    basename(relativePath) === relativePath
  );
}

async function writeAtomically(source) {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const temporaryPath = join(
    OUTPUT_DIRECTORY,
    `.icon-libraries.${process.pid}.${randomUUID()}.tmp`,
  );
  if (!isVerifiedTempPath(temporaryPath)) {
    throw new Error('Refusing to write an unverified temporary catalog path');
  }

  let temporaryCreated = false;
  let handle;
  try {
    handle = await open(temporaryPath, 'wx');
    temporaryCreated = true;
    await handle.writeFile(source, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, OUTPUT_PATH);
    temporaryCreated = false;
  } catch (error) {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        // Preserve the original write or rename failure.
      }
    }
    if (temporaryCreated && isVerifiedTempPath(temporaryPath)) {
      try {
        await rm(temporaryPath, { force: true });
      } catch {
        // Preserve the original write or rename failure.
      }
    }
    throw error;
  }
}


async function main() {
  const [simplePackage, phosphorPackage] = await Promise.all([
    readPackage(join(SIMPLE_ICONS_ROOT, 'package.json')),
    readPackage(join(PHOSPHOR_ROOT, 'package.json')),
  ]);
  const [simpleIconsLibrary, phosphorLibrary] = await Promise.all([
    buildSimpleIconsLibrary(simplePackage),
    buildPhosphorLibrary(phosphorPackage),
  ]);
  const source = renderCatalogModule(simpleIconsLibrary, phosphorLibrary);
  if (CHECK_ONLY) {
    let current;
    try {
      current = await readFile(OUTPUT_PATH, 'utf8');
    } catch (error) {
      throw new Error('Generated icon catalog is missing; run npm run generate:icons', {
        cause: error,
      });
    }
    if (current !== source) {
      throw new Error('Generated icon catalog is stale; run npm run generate:icons');
    }
    return;
  }
  await writeAtomically(source);
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
