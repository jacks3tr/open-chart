import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { ZipFile } from 'yazl';

import {
  installVendorPack,
  readInstalledVendorPack,
  type VendorPackDescriptor,
} from '../src/index.js';

interface FixtureEntry {
  readonly path: string;
  readonly content: string;
  readonly mode?: number;
}

const ZIP_DATE = new Date('2026-01-01T00:00:00.000Z');

function digest(archive: Buffer): string {
  return createHash('sha256').update(archive).digest('hex');
}

async function createArchive(entries: readonly FixtureEntry[]): Promise<Buffer> {
  const zip = new ZipFile();
  for (const entry of entries) {
    zip.addBuffer(Buffer.from(entry.content), entry.path, {
      mtime: ZIP_DATE,
      ...(entry.mode === undefined ? {} : { mode: entry.mode }),
    });
  }
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on('data', (chunk: unknown) => {
      if (!(chunk instanceof Uint8Array)) {
        reject(new Error('ZIP fixture emitted a non-binary chunk'));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    zip.outputStream.once('error', reject);
    zip.outputStream.once('end', () => resolve(Buffer.concat(chunks)));
  });
  zip.end();
  return result;
}

function replaceArchiveName(
  archive: Buffer,
  currentName: string,
  nextName: string,
): Buffer {
  const current = Buffer.from(currentName);
  const replacement = Buffer.from(nextName);
  if (current.length !== replacement.length) {
    throw new Error('Patched ZIP names must have equal byte length');
  }
  const patched = Buffer.from(archive);
  let replacements = 0;
  let offset = 0;
  while (offset < patched.length) {
    const index = patched.indexOf(current, offset);
    if (index < 0) {
      break;
    }
    replacement.copy(patched, index);
    replacements += 1;
    offset = index + replacement.length;
  }
  if (replacements !== 2) {
    throw new Error(`Expected two ZIP filename records, found ${replacements}`);
  }
  return patched;
}

function archiveFetch(
  archive: Buffer,
  responseUrl = 'https://cdn.vendor.example/official-icons.zip',
): typeof globalThis.fetch {
  return () => {
    const response = new Response(new Uint8Array(archive), {
      status: 200,
      headers: { 'content-length': String(archive.length) },
    });
    Object.defineProperty(response, 'url', { value: responseUrl });
    return Promise.resolve(response);
  };
}

function descriptor(
  archive: Buffer,
  licenseText: string,
): VendorPackDescriptor {
  return {
    id: 'vendor-fixture',
    version: '2026.1',
    sourceUrl: 'https://vendor.example/official-icons.zip',
    expectedSha256: digest(archive),
    license: {
      name: 'Fixture asset license',
      text: licenseText,
      url: 'https://vendor.example/license',
    },
  };
}

describe('Windows-local vendor packs', () => {
  it('installs, transactionally updates, and reloads persisted license metadata', async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), 'openchart-vendor-'));
    try {
      const firstArchive = await createArchive([
        { path: 'icons/alpha.svg', content: '<svg id="alpha"/>' },
        { path: 'source/alpha.eps', content: 'x'.repeat(128) },
      ]);
      const first = await installVendorPack(
        descriptor(firstArchive, 'Fixture license revision one.'),
        {
          rootDirectory,
          fetch: archiveFetch(firstArchive),
          now: () => new Date('2026-08-30T12:00:00.000Z'),
          maxEntryBytes: 64,
        },
      );

      expect(first.manifest).toMatchObject({
        schemaVersion: 1,
        packId: 'vendor-fixture',
        version: '2026.1',
        archiveSha256: digest(firstArchive),
        installedAt: '2026-08-30T12:00:00.000Z',
        license: { text: 'Fixture license revision one.' },
      });
      expect(first.manifest.assets).toEqual([
        expect.objectContaining({
          path: 'icons/alpha.svg',
          mediaType: 'image/svg+xml',
          bytes: 17,
        }),
      ]);
      await expect(
        readFile(join(first.directory, 'assets', 'icons', 'alpha.svg'), 'utf8'),
      ).resolves.toBe('<svg id="alpha"/>');
      await expect(
        readFile(join(first.directory, 'assets', 'source', 'alpha.eps'), 'utf8'),
      ).rejects.toMatchObject({ code: 'ENOENT' });

      const updateArchive = await createArchive([
        { path: 'icons/beta.svg', content: '<svg id="beta"/>' },
        { path: 'icons/beta.png', content: 'fixture-png' },
      ]);
      const updated = await installVendorPack(
        descriptor(updateArchive, 'Fixture license revision two.'),
        {
          rootDirectory,
          fetch: archiveFetch(updateArchive),
          now: () => new Date('2026-08-30T12:05:00.000Z'),
        },
      );

      await expect(
        readFile(join(updated.directory, 'assets', 'icons', 'alpha.svg'), 'utf8'),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(
        readFile(join(updated.directory, 'assets', 'icons', 'beta.svg'), 'utf8'),
      ).resolves.toBe('<svg id="beta"/>');
      const reloaded = await readInstalledVendorPack(
        rootDirectory,
        'vendor-fixture',
        '2026.1',
      );
      expect(reloaded).toEqual(updated.manifest);
      expect(reloaded.license.text).toBe('Fixture license revision two.');
      expect(reloaded.assets.map((asset) => asset.path)).toEqual([
        'icons/beta.png',
        'icons/beta.svg',
      ]);
    } finally {
      await rm(rootDirectory, { recursive: true, force: true });
    }
  });

  it('rejects traversal and link entries without changing the installed pack', async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), 'openchart-vendor-'));
    try {
      const safeArchive = await createArchive([
        { path: 'icons/current.svg', content: '<svg id="current"/>' },
      ]);
      const installed = await installVendorPack(
        descriptor(safeArchive, 'Current fixture license.'),
        { rootDirectory, fetch: archiveFetch(safeArchive) },
      );

      const traversalBase = await createArchive([
        { path: 'safe.svg', content: '<svg id="unsafe"/>' },
      ]);
      const traversalArchive = replaceArchiveName(
        traversalBase,
        'safe.svg',
        '../x.svg',
      );
      await expect(
        installVendorPack(
          descriptor(traversalArchive, 'Traversal fixture license.'),
          { rootDirectory, fetch: archiveFetch(traversalArchive) },
        ),
      ).rejects.toMatchObject({ code: 'ARCHIVE_UNSAFE' });

      const linkArchive = await createArchive([
        {
          path: 'icons/link.svg',
          content: 'icons/current.svg',
          mode: 0o120777,
        },
      ]);
      await expect(
        installVendorPack(descriptor(linkArchive, 'Link fixture license.'), {
          rootDirectory,
          fetch: archiveFetch(linkArchive),
        }),
      ).rejects.toMatchObject({ code: 'ARCHIVE_UNSAFE' });

      await expect(
        readFile(join(installed.directory, 'assets', 'icons', 'current.svg'), 'utf8'),
      ).resolves.toBe('<svg id="current"/>');
      const reloaded = await readInstalledVendorPack(
        rootDirectory,
        'vendor-fixture',
        '2026.1',
      );
      expect(reloaded.archiveSha256).toBe(digest(safeArchive));
      expect(reloaded.license.text).toBe('Current fixture license.');
    } finally {
      await rm(rootDirectory, { recursive: true, force: true });
    }
  });
});
