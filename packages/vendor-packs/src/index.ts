import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';

import * as yauzl from 'yauzl';
import { z } from 'zod';

export const DEFAULT_MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
export const DEFAULT_MAX_ENTRY_BYTES = 32 * 1024 * 1024;
export const DEFAULT_MAX_EXTRACTED_BYTES = 512 * 1024 * 1024;
export const DEFAULT_MAX_ENTRIES = 10_000;

export type VendorPackErrorCode =
  | 'ARCHIVE_INVALID'
  | 'ARCHIVE_TOO_LARGE'
  | 'ARCHIVE_UNSAFE'
  | 'DESCRIPTOR_INVALID'
  | 'DIGEST_MISMATCH'
  | 'DOWNLOAD_FAILED'
  | 'INSTALL_FAILED'
  | 'MANIFEST_INVALID'
  | 'NO_SUPPORTED_ASSETS'
  | 'READ_FAILED';

export class VendorPackError extends Error {
  public constructor(
    public readonly code: VendorPackErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'VendorPackError';
  }
}

export interface VendorPackLicense {
  readonly name: string;
  readonly text: string;
  readonly url?: string;
}

export interface VendorPackDescriptor {
  readonly id: string;
  readonly version: string;
  readonly sourceUrl: string;
  readonly expectedSha256: string;
  readonly license: VendorPackLicense;
}

export interface VendorPackAssetManifest {
  readonly path: string;
  readonly mediaType: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface VendorPackManifest {
  readonly schemaVersion: 1;
  readonly packId: string;
  readonly version: string;
  readonly sourceUrl: string;
  readonly archiveSha256: string;
  readonly installedAt: string;
  readonly license: VendorPackLicense;
  readonly assets: readonly VendorPackAssetManifest[];
}

export interface VendorPackInstallOptions {
  readonly rootDirectory: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
  readonly maxArchiveBytes?: number;
  readonly maxEntryBytes?: number;
  readonly maxExtractedBytes?: number;
  readonly maxEntries?: number;
  readonly signal?: AbortSignal;
}

export interface InstalledVendorPack {
  readonly directory: string;
  readonly manifest: VendorPackManifest;
}

const HASH_PATTERN = /^[0-9a-f]{64}$/i;
const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const WINDOWS_RESERVED_NAME_PATTERN = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;
const SUPPORTED_MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};
const MAX_LICENSE_NAME_LENGTH = 512;
const MAX_LICENSE_TEXT_LENGTH = 16 * 1024 * 1024;
const MAX_URL_LENGTH = 8_192;
const MAX_PATH_LENGTH = 32_767;

const licenseSchema = z
  .object({
    name: z.string().min(1).max(MAX_LICENSE_NAME_LENGTH),
    text: z.string().min(1).max(MAX_LICENSE_TEXT_LENGTH),
    url: z.string().max(MAX_URL_LENGTH).optional(),
  })
  .strict();

const assetManifestSchema = z
  .object({
    path: z.string().min(1).max(MAX_PATH_LENGTH),
    mediaType: z.string().min(1).max(128),
    bytes: z.number().int().nonnegative().safe(),
    sha256: z.string().regex(HASH_PATTERN),
  })
  .strict();

const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    packId: z.string().min(1),
    version: z.string().min(1),
    sourceUrl: z.string().url().max(MAX_URL_LENGTH),
    archiveSha256: z.string().regex(HASH_PATTERN),
    installedAt: z.string().datetime({ offset: true }),
    license: licenseSchema,
    assets: z.array(assetManifestSchema).min(1).max(DEFAULT_MAX_ENTRIES),
  })
  .strict();

interface ValidInstallOptions {
  readonly rootDirectory: string;
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => Date;
  readonly maxArchiveBytes: number;
  readonly maxEntryBytes: number;
  readonly maxExtractedBytes: number;
  readonly maxEntries: number;
  readonly signal?: AbortSignal;
}

interface ValidDescriptor {
  readonly id: string;
  readonly version: string;
  readonly sourceUrl: string;
  readonly expectedSha256: string;
  readonly license: VendorPackLicense;
}

interface ArchiveDownload {
  readonly archiveSha256: string;
}

type ExtractedAsset = VendorPackAssetManifest;

function vendorError(
  code: VendorPackErrorCode,
  message: string,
  cause?: unknown,
): VendorPackError {
  if (cause === undefined) return new VendorPackError(code, message);
  return new VendorPackError(code, message, { cause });
}

function isHttpsUrl(value: string): boolean {
  if (value.length === 0 || value.length > MAX_URL_LENGTH) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname.length > 0 && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function assertSafeSlug(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || !SLUG_PATTERN.test(value)) {
    throw new Error(`${field} must be a safe Windows path slug`);
  }
  if (value.endsWith('.') || value.endsWith(' ') || value === '.' || value === '..') {
    throw new Error(`${field} must not end with a dot or space`);
  }
  if (WINDOWS_RESERVED_NAME_PATTERN.test(value)) {
    throw new Error(`${field} is a reserved Windows device name`);
  }
  return value;
}

function assertSafeUrl(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isHttpsUrl(value)) {
    throw new Error(`${field} must be an HTTPS URL without credentials`);
  }
  return value;
}

function assertPositiveLimit(
  value: unknown,
  field: string,
  maximum: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > maximum
  ) {
    throw new Error(`${field} must be a positive safe integer no greater than ${maximum}`);
  }
  return value;
}

function validateLicense(input: unknown): VendorPackLicense {
  const parsed = licenseSchema.safeParse(input);
  if (!parsed.success) throw new Error('license metadata is invalid');
  if (parsed.data.url !== undefined) assertSafeUrl(parsed.data.url, 'license.url');
  return parsed.data.url === undefined
    ? { name: parsed.data.name, text: parsed.data.text }
    : { name: parsed.data.name, text: parsed.data.text, url: parsed.data.url };
}

function validateDescriptor(input: VendorPackDescriptor): ValidDescriptor {
  try {
    if (input === null || typeof input !== 'object') throw new Error('descriptor must be an object');
    const descriptor = input as Partial<VendorPackDescriptor>;
    const id = assertSafeSlug(descriptor.id, 'descriptor.id');
    const version = assertSafeSlug(descriptor.version, 'descriptor.version');
    const sourceUrl = assertSafeUrl(descriptor.sourceUrl, 'descriptor.sourceUrl');
    if (typeof descriptor.expectedSha256 !== 'string' || !HASH_PATTERN.test(descriptor.expectedSha256)) {
      throw new Error('descriptor.expectedSha256 must be a SHA-256 digest');
    }
    return {
      id,
      version,
      sourceUrl,
      expectedSha256: descriptor.expectedSha256.toLowerCase(),
      license: validateLicense(descriptor.license),
    };
  } catch (cause) {
    throw vendorError('DESCRIPTOR_INVALID', 'Vendor pack descriptor is invalid', cause);
  }
}

function validateInstallOptions(input: VendorPackInstallOptions): ValidInstallOptions {
  try {
    if (input === null || typeof input !== 'object') throw new Error('install options must be an object');
    const options = input as Partial<VendorPackInstallOptions>;
    if (typeof options.rootDirectory !== 'string' || options.rootDirectory.trim().length === 0) {
      throw new Error('rootDirectory must be a non-empty path');
    }
    const rootDirectory = resolve(options.rootDirectory);
    const fetcher = options.fetch ?? globalThis.fetch;
    if (typeof fetcher !== 'function') throw new Error('fetch must be a function');
    const now = options.now ?? (() => new Date());
    if (typeof now !== 'function') throw new Error('now must be a function');
    return {
      rootDirectory,
      fetch: fetcher,
      now,
      maxArchiveBytes: assertPositiveLimit(
        options.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES,
        'maxArchiveBytes',
        DEFAULT_MAX_ARCHIVE_BYTES,
      ),
      maxEntryBytes: assertPositiveLimit(
        options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES,
        'maxEntryBytes',
        DEFAULT_MAX_ENTRY_BYTES,
      ),
      maxExtractedBytes: assertPositiveLimit(
        options.maxExtractedBytes ?? DEFAULT_MAX_EXTRACTED_BYTES,
        'maxExtractedBytes',
        DEFAULT_MAX_EXTRACTED_BYTES,
      ),
      maxEntries: assertPositiveLimit(
        options.maxEntries ?? DEFAULT_MAX_ENTRIES,
        'maxEntries',
        DEFAULT_MAX_ENTRIES,
      ),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    };
  } catch (cause) {
    throw vendorError('DESCRIPTOR_INVALID', 'Vendor pack install options are invalid', cause);
  }
}

function assertValidInstalledAt(value: string): void {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('installedAt must be a valid date');
}

function normalizePathKey(path: string): string {
  return path.normalize('NFC').toLowerCase();
}

function safeRelativePathSegments(input: unknown, allowTrailingSlash: boolean): string[] {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_PATH_LENGTH) {
    throw new Error('archive path is invalid');
  }
  if (input.includes('\\') || input.includes('\0') || input.startsWith('/') || /^[A-Za-z]:/.test(input)) {
    throw new Error('archive path is absolute or contains invalid separators');
  }
  const hasTrailingSlash = input.endsWith('/');
  if (hasTrailingSlash && !allowTrailingSlash) throw new Error('manifest asset path must not end with a slash');
  const pathWithoutTrailingSlash = hasTrailingSlash ? input.slice(0, -1) : input;
  const segments = pathWithoutTrailingSlash.split('/');
  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
    throw new Error('archive path contains an empty segment');
  }
  for (const segment of segments) {
    if (
      segment === '.' ||
      segment === '..' ||
      segment.length > 255 ||
      segment.endsWith('.') ||
      segment.endsWith(' ') ||
      WINDOWS_RESERVED_NAME_PATTERN.test(segment) ||
      hasWindowsInvalidCharacters(segment)
    ) {
      throw new Error('archive path contains a Windows-invalid segment');
    }
  }
  return segments;
}

function hasWindowsInvalidCharacters(value: string): boolean {
  for (const character of value) {
    if (character.charCodeAt(0) < 0x20 || '<>:"|?*'.includes(character)) return true;
  }
  return false;
}

function supportedMediaType(path: string): string | undefined {
  return SUPPORTED_MEDIA_TYPES[extname(path).toLowerCase()];
}

function archiveUnsafePathError(cause: unknown): VendorPackError {
  return vendorError('ARCHIVE_UNSAFE', 'Archive contains an unsafe path', cause);
}

function archiveError(cause: unknown): VendorPackError {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/invalid (?:relative path|characters in fileName)|absolute path|fileName/i.test(message)) {
    return archiveUnsafePathError(cause);
  }
  return vendorError('ARCHIVE_INVALID', 'Archive is malformed or unreadable', cause);
}

async function isPathPresent(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (cause) {
    if (isNodeError(cause, 'ENOENT')) return false;
    throw cause;
  }
}

function isNodeError(cause: unknown, code: string): cause is NodeJS.ErrnoException {
  return cause instanceof Error && 'code' in cause && (cause as NodeJS.ErrnoException).code === code;
}

function isFileSystemError(cause: unknown): cause is NodeJS.ErrnoException {
  return (
    cause instanceof Error &&
    'code' in cause &&
    typeof (cause as NodeJS.ErrnoException).code === 'string' &&
    'syscall' in cause &&
    typeof (cause as NodeJS.ErrnoException).syscall === 'string'
  );
}

async function recoverPrevious(targetDirectory: string, previousDirectory: string): Promise<void> {
  const targetExists = await isPathPresent(targetDirectory);
  if (targetExists) return;
  const previousExists = await isPathPresent(previousDirectory);
  if (!previousExists) return;
  try {
    await rename(previousDirectory, targetDirectory);
  } catch (cause) {
    throw vendorError('INSTALL_FAILED', 'Unable to recover the previous vendor pack', cause);
  }
}

async function downloadArchive(
  descriptor: ValidDescriptor,
  options: ValidInstallOptions,
  destination: string,
): Promise<ArchiveDownload> {
  let response: Response;
  try {
    response = await options.fetch(
      descriptor.sourceUrl,
      options.signal === undefined
        ? { redirect: 'follow' }
        : { redirect: 'follow', signal: options.signal },
    );
  } catch (cause) {
    throw vendorError('DOWNLOAD_FAILED', 'Vendor pack download failed', cause);
  }

  const status = response.status;
  if ((typeof status === 'number' && (status < 200 || status >= 300)) || response.ok === false) {
    throw vendorError('DOWNLOAD_FAILED', `Vendor pack download returned HTTP ${status}`);
  }
  const responseUrl = response.url;
  if (typeof responseUrl !== 'string' || !isHttpsUrl(responseUrl)) {
    throw vendorError('DOWNLOAD_FAILED', 'Vendor pack response URL is not a safe HTTPS URL');
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength)) {
      throw vendorError('DOWNLOAD_FAILED', 'Vendor pack response has an invalid content length');
    }
    try {
      if (BigInt(contentLength) > BigInt(options.maxArchiveBytes)) {
        throw vendorError('ARCHIVE_TOO_LARGE', 'Vendor pack archive exceeds the configured byte limit');
      }
    } catch (cause) {
      if (cause instanceof VendorPackError) throw cause;
      throw vendorError('DOWNLOAD_FAILED', 'Vendor pack response has an invalid content length', cause);
    }
  }
  if (response.body === null) throw vendorError('DOWNLOAD_FAILED', 'Vendor pack response has no body');

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let bytes = 0;
  const hash = createHash('sha256');
  let failure: unknown;
  try {
    handle = await open(destination, 'wx');
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
      if (options.signal?.aborted) throw new Error('download aborted');
      if (!(chunk instanceof Uint8Array)) throw new Error('download body yielded a non-binary chunk');
      const buffer = Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > options.maxArchiveBytes) {
        throw vendorError('ARCHIVE_TOO_LARGE', 'Vendor pack archive exceeds the configured byte limit');
      }
      hash.update(buffer);
      let offset = 0;
      while (offset < buffer.length) {
        const result = await handle.write(buffer, offset, buffer.length - offset);
        if (result.bytesWritten <= 0) throw new Error('archive write made no progress');
        offset += result.bytesWritten;
      }
    }
  } catch (cause) {
    failure = cause;
  } finally {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch (cause) {
        failure = combineCleanupFailure(
          failure,
          vendorError('DOWNLOAD_FAILED', 'Unable to close the downloaded archive', cause),
        );
      }
    }
  }
  if (failure !== undefined) {
    if (failure instanceof VendorPackError) throw failure;
    throw vendorError('DOWNLOAD_FAILED', 'Vendor pack download failed while writing the archive', failure);
  }
  return { archiveSha256: hash.digest('hex') };
}

function assertEntryType(entry: yauzl.Entry, isDirectory: boolean): void {
  if (entry.isEncrypted() || (entry.generalPurposeBitFlag & 0x1) !== 0) {
    throw vendorError('ARCHIVE_UNSAFE', 'Archive contains an encrypted entry');
  }
  if ((entry.externalFileAttributes & 0x400) !== 0) {
    throw vendorError('ARCHIVE_UNSAFE', 'Archive contains a Windows reparse-point entry');
  }
  const madeBySystem = (entry.versionMadeBy >>> 8) & 0xff;
  if (madeBySystem === 3 || entry.externalFileAttributes > 0) {
    const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
    const unixType = unixMode & 0o170000;
    if (unixType !== 0 && unixType !== 0o100000 && unixType !== 0o040000) {
      throw vendorError('ARCHIVE_UNSAFE', 'Archive contains a symbolic link or special file');
    }
    if (isDirectory && unixType !== 0 && unixType !== 0o040000) {
      throw vendorError('ARCHIVE_UNSAFE', 'Archive directory has a non-directory file type');
    }
    if (!isDirectory && unixType === 0o040000) {
      throw vendorError('ARCHIVE_UNSAFE', 'Archive file has a directory file type');
    }
    if (!isDirectory && (entry.externalFileAttributes & 0x10) !== 0 && madeBySystem !== 3) {
      throw vendorError('ARCHIVE_UNSAFE', 'Archive file has a directory attribute');
    }
  }
}

function assertSafeArchivePath(
  entry: yauzl.Entry,
  fileKeys: Set<string>,
  directoryKeys: Set<string>,
  ancestorKeys: Set<string>,
): { readonly isDirectory: boolean; readonly path: string; readonly segments: string[] } {
  const path = entry.fileName;
  const isDirectory = path.endsWith('/');
  let segments: string[];
  try {
    segments = safeRelativePathSegments(path, isDirectory);
    const yauzlValidation = yauzl.validateFileName(path);
    if (yauzlValidation !== null) throw new Error(yauzlValidation);
  } catch (cause) {
    throw archiveUnsafePathError(cause);
  }
  const key = normalizePathKey(segments.join('/'));
  if (fileKeys.has(key) || directoryKeys.has(key) || (isDirectory === false && ancestorKeys.has(key))) {
    throw vendorError('ARCHIVE_UNSAFE', 'Archive contains duplicate or colliding paths');
  }
  for (let index = 1; index < segments.length; index += 1) {
    if (fileKeys.has(normalizePathKey(segments.slice(0, index).join('/')))) {
      throw vendorError('ARCHIVE_UNSAFE', 'Archive contains a file and directory path collision');
    }
  }
  return { isDirectory, path, segments };
}

async function writeAsset(
  zipFile: yauzl.ZipFile,
  entry: yauzl.Entry,
  stageDirectory: string,
  segments: readonly string[],
  options: ValidInstallOptions,
  extractedBytesBefore: number,
): Promise<ExtractedAsset> {
  const path = segments.join('/');
  const mediaType = supportedMediaType(path);
  if (mediaType === undefined) throw new Error('writeAsset called for an unsupported path');
  if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) {
    throw vendorError('ARCHIVE_INVALID', 'Archive entry has an invalid uncompressed size');
  }
  if (entry.uncompressedSize > options.maxEntryBytes) {
    throw vendorError('ARCHIVE_TOO_LARGE', 'Archive entry exceeds the configured byte limit');
  }
  if (extractedBytesBefore > options.maxExtractedBytes - entry.uncompressedSize) {
    throw vendorError('ARCHIVE_TOO_LARGE', 'Extracted vendor assets exceed the configured byte limit');
  }

  const destination = join(stageDirectory, 'assets', ...segments);
  try {
    await mkdir(dirname(destination), { recursive: true });
  } catch (cause) {
    throw vendorError('INSTALL_FAILED', 'Unable to create an asset directory', cause);
  }
  let output: Awaited<ReturnType<typeof open>>;
  try {
    output = await open(destination, 'wx');
  } catch (cause) {
    throw vendorError('INSTALL_FAILED', 'Unable to create an extracted asset', cause);
  }
  const hash = createHash('sha256');
  let bytes = 0;
  let failure: unknown;
  try {
    const stream = await zipFile.openReadStreamPromise(entry);
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      if (!(chunk instanceof Uint8Array)) throw new Error('archive entry yielded a non-binary chunk');
      const buffer = Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > options.maxEntryBytes || bytes > options.maxExtractedBytes - extractedBytesBefore) {
        throw vendorError('ARCHIVE_TOO_LARGE', 'Extracted vendor assets exceed the configured byte limit');
      }
      hash.update(buffer);
      let offset = 0;
      while (offset < buffer.length) {
        const result = await output.write(buffer, offset, buffer.length - offset);
        if (result.bytesWritten <= 0) {
          throw vendorError('INSTALL_FAILED', 'Asset write made no progress');
        }
        offset += result.bytesWritten;
      }
    }
  } catch (cause) {
    failure = cause;
  }
  try {
    await output.close();
  } catch (closeFailure) {
    const cause =
      failure === undefined
        ? closeFailure
        : new AggregateError(
            [failure, closeFailure],
            'Asset extraction and file close both failed',
            { cause: failure },
          );
    throw vendorError('INSTALL_FAILED', 'Unable to close an extracted asset', cause);
  }
  if (failure !== undefined) {
    if (failure instanceof VendorPackError) throw failure;
    if (isFileSystemError(failure)) {
      throw vendorError('INSTALL_FAILED', 'Unable to write an extracted asset', failure);
    }
    throw archiveError(failure);
  }
  if (bytes !== entry.uncompressedSize) {
    throw vendorError('ARCHIVE_INVALID', 'Archive entry size does not match its extracted bytes');
  }
  return { path, mediaType, bytes, sha256: hash.digest('hex') };
}

async function extractArchive(
  archivePath: string,
  stageDirectory: string,
  options: ValidInstallOptions,
): Promise<ExtractedAsset[]> {
  let zipFile: yauzl.ZipFile;
  try {
    zipFile = await yauzl.openPromise(archivePath, {
      decodeStrings: true,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
  } catch (cause) {
    throw archiveError(cause);
  }

  const assets: ExtractedAsset[] = [];
  const fileKeys = new Set<string>();
  const directoryKeys = new Set<string>();
  const ancestorKeys = new Set<string>();
  let extractedBytes = 0;
  let entryCount = 0;
  try {
    for await (const entry of zipFile.eachEntry()) {
      entryCount += 1;
      if (entryCount > options.maxEntries) {
        throw vendorError('ARCHIVE_TOO_LARGE', 'Archive contains too many entries');
      }
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) {
        throw vendorError('ARCHIVE_INVALID', 'Archive entry has an invalid uncompressed size');
      }
      const safePath = assertSafeArchivePath(entry, fileKeys, directoryKeys, ancestorKeys);
      assertEntryType(entry, safePath.isDirectory);
      const key = normalizePathKey(safePath.segments.join('/'));
      if (safePath.isDirectory) directoryKeys.add(key);
      else fileKeys.add(key);
      for (let index = 1; index < safePath.segments.length; index += 1) {
        ancestorKeys.add(normalizePathKey(safePath.segments.slice(0, index).join('/')));
      }
      if (safePath.isDirectory) {
        if (entry.uncompressedSize !== 0) {
          throw vendorError('ARCHIVE_INVALID', 'Archive directory contains file data');
        }
        continue;
      }
      if (supportedMediaType(safePath.path) === undefined) continue;
      const asset = await writeAsset(
        zipFile,
        entry,
        stageDirectory,
        safePath.segments,
        options,
        extractedBytes,
      );
      assets.push(asset);
      extractedBytes += asset.bytes;
    }
  } catch (cause) {
    if (cause instanceof VendorPackError) throw cause;
    throw archiveError(cause);
  } finally {
    zipFile.close();
  }
  if (assets.length === 0) throw vendorError('NO_SUPPORTED_ASSETS', 'Archive contains no supported image assets');
  assets.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return assets;
}

function makeManifest(
  descriptor: ValidDescriptor,
  archiveSha256: string,
  installedAt: string,
  assets: readonly ExtractedAsset[],
): VendorPackManifest {
  return {
    schemaVersion: 1,
    packId: descriptor.id,
    version: descriptor.version,
    sourceUrl: descriptor.sourceUrl,
    archiveSha256,
    installedAt,
    license: descriptor.license,
    assets,
  };
}

function validateManifest(
  raw: unknown,
  requestedId: string,
  requestedVersion: string,
): VendorPackManifest {
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw vendorError('MANIFEST_INVALID', 'Vendor pack manifest is invalid', parsed.error);
  }
  try {
    const manifest = parsed.data;
    assertSafeSlug(manifest.packId, 'manifest.packId');
    assertSafeSlug(manifest.version, 'manifest.version');
    if (manifest.packId !== requestedId || manifest.version !== requestedVersion) {
      throw new Error('manifest identity does not match the requested vendor pack');
    }
    assertSafeUrl(manifest.sourceUrl, 'manifest.sourceUrl');
    if (!HASH_PATTERN.test(manifest.archiveSha256)) throw new Error('manifest archive hash is invalid');
    assertValidInstalledAt(manifest.installedAt);
    const license = validateLicense(manifest.license);
    const seenPaths = new Set<string>();
    const ancestorPaths = new Set<string>();
    let previousPath: string | undefined;
    const assets = manifest.assets.map((asset) => {
      const segments = safeRelativePathSegments(asset.path, false);
      const path = segments.join('/');
      const key = normalizePathKey(path);
      if (seenPaths.has(key) || ancestorPaths.has(key)) throw new Error('manifest contains duplicate or colliding paths');
      for (let index = 1; index < segments.length; index += 1) {
        if (seenPaths.has(normalizePathKey(segments.slice(0, index).join('/')))) {
          throw new Error('manifest contains a file and directory path collision');
        }
        ancestorPaths.add(normalizePathKey(segments.slice(0, index).join('/')));
      }
      if (previousPath !== undefined && previousPath >= path) throw new Error('manifest assets are not sorted');
      previousPath = path;
      const mediaType = supportedMediaType(path);
      if (mediaType === undefined || mediaType !== asset.mediaType) throw new Error('manifest asset media type is invalid');
      if (!HASH_PATTERN.test(asset.sha256)) throw new Error('manifest asset hash is invalid');
      seenPaths.add(key);
      return { path, mediaType, bytes: asset.bytes, sha256: asset.sha256.toLowerCase() };
    });
    return {
      schemaVersion: 1,
      packId: manifest.packId,
      version: manifest.version,
      sourceUrl: manifest.sourceUrl,
      archiveSha256: manifest.archiveSha256.toLowerCase(),
      installedAt: manifest.installedAt,
      license,
      assets,
    };
  } catch (cause) {
    throw vendorError('MANIFEST_INVALID', 'Vendor pack manifest is invalid', cause);
  }
}

function combineCleanupFailure(
  primary: unknown,
  cleanupFailure: VendorPackError,
): VendorPackError {
  if (primary === undefined) return cleanupFailure;
  const normalized =
    primary instanceof VendorPackError
      ? primary
      : vendorError('INSTALL_FAILED', 'Vendor pack installation failed', primary);
  return vendorError(
    normalized.code,
    normalized.message,
    new AggregateError(
      [normalized, cleanupFailure],
      'Vendor pack operation and temporary cleanup both failed',
      { cause: normalized },
    ),
  );
}

export async function installVendorPack(
  descriptorInput: VendorPackDescriptor,
  optionsInput: VendorPackInstallOptions,
): Promise<InstalledVendorPack> {
  const descriptor = validateDescriptor(descriptorInput);
  const options = validateInstallOptions(optionsInput);
  let installedAt: string;
  try {
    const now = options.now();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('now must return a valid Date');
    installedAt = now.toISOString();
  } catch (cause) {
    throw vendorError('DESCRIPTOR_INVALID', 'Install clock returned an invalid date', cause);
  }

  const packParent = join(options.rootDirectory, descriptor.id);
  const targetDirectory = join(packParent, descriptor.version);
  const previousDirectory = join(packParent, `.${descriptor.version}.previous`);
  try {
    await mkdir(packParent, { recursive: true });
    await recoverPrevious(targetDirectory, previousDirectory);
  } catch (cause) {
    if (cause instanceof VendorPackError) throw cause;
    throw vendorError('INSTALL_FAILED', 'Unable to prepare the vendor pack directory', cause);
  }

  let downloadDirectory: string | undefined;
  let stageDirectory: string | undefined;
  let result: InstalledVendorPack | undefined;
  let failure: unknown;
  try {
    downloadDirectory = await mkdtemp(join(packParent, '.download-'));
    const archivePath = join(downloadDirectory, 'archive.zip');
    const download = await downloadArchive(descriptor, options, archivePath);
    if (download.archiveSha256 !== descriptor.expectedSha256) {
      throw vendorError('DIGEST_MISMATCH', 'Downloaded vendor pack digest does not match the descriptor');
    }

    stageDirectory = await mkdtemp(join(packParent, `.${descriptor.version}.staging-`));
    const assets = await extractArchive(archivePath, stageDirectory, options);
    const manifest = makeManifest(descriptor, download.archiveSha256, installedAt, assets);
    await writeFile(join(stageDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    let targetMoved = false;
    try {
      const targetExists = await isPathPresent(targetDirectory);
      if (await isPathPresent(previousDirectory)) {
        if (!targetExists) await recoverPrevious(targetDirectory, previousDirectory);
        await rm(previousDirectory, { recursive: true, force: true });
      }
      if (await isPathPresent(targetDirectory)) {
        await rename(targetDirectory, previousDirectory);
        targetMoved = true;
      }
      await rename(stageDirectory, targetDirectory);
      stageDirectory = undefined;
      result = { directory: targetDirectory, manifest };
    } catch (cause) {
      if (targetMoved) {
        try {
          if (await isPathPresent(targetDirectory)) await rm(targetDirectory, { recursive: true, force: true });
          await rename(previousDirectory, targetDirectory);
        } catch (rollbackCause) {
          throw vendorError('INSTALL_FAILED', 'Vendor pack update failed and rollback also failed', rollbackCause);
        }
      }
      throw vendorError('INSTALL_FAILED', 'Vendor pack update failed', cause);
    }
  } catch (cause) {
    failure =
      cause instanceof VendorPackError
        ? cause
        : vendorError('INSTALL_FAILED', 'Vendor pack installation failed', cause);
  } finally {
    const cleanupFailures: unknown[] = [];
    if (downloadDirectory !== undefined) {
      try {
        await rm(downloadDirectory, { recursive: true, force: true });
      } catch (cause) {
        cleanupFailures.push(cause);
      }
    }
    if (stageDirectory !== undefined) {
      try {
        await rm(stageDirectory, { recursive: true, force: true });
      } catch (cause) {
        cleanupFailures.push(cause);
      }
    }
    if (cleanupFailures.length > 0) {
      const cleanupCause =
        cleanupFailures.length === 1
          ? cleanupFailures[0]
          : new AggregateError(cleanupFailures, 'Multiple temporary directories could not be removed');
      const cleanupFailure = vendorError(
        'INSTALL_FAILED',
        result === undefined
          ? 'Vendor pack temporary cleanup failed'
          : 'Vendor pack installed but temporary cleanup failed',
        cleanupCause,
      );
      failure = combineCleanupFailure(failure, cleanupFailure);
    }
  }
  if (failure !== undefined) {
    if (failure instanceof Error) throw failure;
    throw vendorError('INSTALL_FAILED', 'Vendor pack installation failed', failure);
  }
  if (result === undefined) {
    throw vendorError('INSTALL_FAILED', 'Vendor pack installation produced no result');
  }
  return result;
}

export async function readInstalledVendorPack(
  rootDirectoryInput: string,
  packIdInput: string,
  versionInput: string,
): Promise<VendorPackManifest> {
  let rootDirectory: string;
  let packId: string;
  let version: string;
  try {
    if (typeof rootDirectoryInput !== 'string' || rootDirectoryInput.trim().length === 0) {
      throw new Error('rootDirectory must be a non-empty path');
    }
    rootDirectory = resolve(rootDirectoryInput);
    packId = assertSafeSlug(packIdInput, 'packId');
    version = assertSafeSlug(versionInput, 'version');
  } catch (cause) {
    throw vendorError('READ_FAILED', 'Vendor pack read request is invalid', cause);
  }
  const packParent = join(rootDirectory, packId);
  const targetDirectory = join(packParent, version);
  const previousDirectory = join(packParent, `.${version}.previous`);
  try {
    await recoverPrevious(targetDirectory, previousDirectory);
  } catch (cause) {
    throw vendorError('READ_FAILED', 'Unable to recover the installed vendor pack', cause);
  }
  let rawText: string;
  try {
    rawText = await readFile(join(targetDirectory, 'manifest.json'), 'utf8');
  } catch (cause) {
    throw vendorError('READ_FAILED', 'Unable to read the installed vendor pack manifest', cause);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(rawText) as unknown;
  } catch (cause) {
    throw vendorError('MANIFEST_INVALID', 'Vendor pack manifest is not valid JSON', cause);
  }
  return validateManifest(raw, packId, version);
}
