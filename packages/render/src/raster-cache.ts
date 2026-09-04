export interface RasterSurface {
  readonly width: number;
  readonly height: number;
}

export type RasterSurfaceFactory<Surface extends RasterSurface = RasterSurface> = (
  width: number,
  height: number,
) => Surface;

export interface RasterCacheStats {
  readonly entries: number;
  readonly bytes: number;
  readonly maxBytes: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
}

interface RasterCacheEntry<Surface extends RasterSurface> {
  readonly bytes: number;
  readonly surface: Surface;
}

const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

function normalizeDimension(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new TypeError(`Raster cache ${label} must be finite`);
  }
  if (value <= 0) {
    throw new RangeError(`Raster cache ${label} must be positive`);
  }

  const normalized = Math.ceil(value);
  if (!Number.isSafeInteger(normalized)) {
    throw new RangeError(`Raster cache ${label} must normalize to a safe integer`);
  }
  return normalized;
}

function rgbaBytes(width: number, height: number): number {
  const pixels = width * height;
  const bytes = pixels * 4;
  if (!Number.isSafeInteger(pixels) || !Number.isSafeInteger(bytes)) {
    throw new RangeError('Raster cache dimensions produce an unsafe RGBA byte count');
  }
  return bytes;
}

function cacheKey(key: string, width: number, height: number): string {
  return JSON.stringify([key, width, height]);
}

export class RasterCache<Surface extends RasterSurface = RasterSurface> {
  private readonly factory: RasterSurfaceFactory<Surface>;
  private readonly maxBytes: number;
  private readonly cache = new Map<string, RasterCacheEntry<Surface>>();
  private storedBytes = 0;
  private hitCount = 0;
  private missCount = 0;
  private evictionCount = 0;

  public constructor(factory: RasterSurfaceFactory<Surface>, maxBytes = DEFAULT_MAX_BYTES) {
    if (typeof factory !== 'function') {
      throw new TypeError('Raster cache factory must be a function');
    }
    if (!Number.isFinite(maxBytes)) {
      throw new TypeError('Raster cache maxBytes must be finite');
    }
    if (maxBytes <= 0) {
      throw new RangeError('Raster cache maxBytes must be positive');
    }

    const normalizedMaxBytes = Math.floor(maxBytes);
    if (!Number.isSafeInteger(normalizedMaxBytes) || normalizedMaxBytes <= 0) {
      throw new RangeError('Raster cache maxBytes must normalize to a positive safe integer');
    }

    this.factory = factory;
    this.maxBytes = normalizedMaxBytes;
  }

  public get stats(): RasterCacheStats {
    return Object.freeze({
      entries: this.cache.size,
      bytes: this.storedBytes,
      maxBytes: this.maxBytes,
      hits: this.hitCount,
      misses: this.missCount,
      evictions: this.evictionCount,
    });
  }

  public clear(): void {
    this.cache.clear();
    this.storedBytes = 0;
  }

  public getOrCreate(
    key: string,
    width: number,
    height: number,
    render: (surface: Surface) => void,
  ): Surface {
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError('Raster cache key must be a non-empty string');
    }

    const normalizedWidth = normalizeDimension(width, 'width');
    const normalizedHeight = normalizeDimension(height, 'height');
    const bytes = rgbaBytes(normalizedWidth, normalizedHeight);
    const keyWithDimensions = cacheKey(key, normalizedWidth, normalizedHeight);
    const existing = this.cache.get(keyWithDimensions);
    if (existing !== undefined) {
      this.hitCount += 1;
      this.cache.delete(keyWithDimensions);
      this.cache.set(keyWithDimensions, existing);
      return existing.surface;
    }

    this.missCount += 1;
    const surface = this.factory(normalizedWidth, normalizedHeight);
    if (
      surface === null ||
      typeof surface !== 'object' ||
      surface.width !== normalizedWidth ||
      surface.height !== normalizedHeight
    ) {
      throw new TypeError(
        `Raster cache factory must return a surface with dimensions ${normalizedWidth}x${normalizedHeight}`,
      );
    }

    render(surface);
    if (bytes > this.maxBytes) {
      return surface;
    }

    while (this.storedBytes > this.maxBytes - bytes) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      const oldest = this.cache.get(oldestKey);
      this.cache.delete(oldestKey);
      if (oldest !== undefined) {
        this.storedBytes -= oldest.bytes;
      }
      this.evictionCount += 1;
    }

    this.cache.set(keyWithDimensions, { bytes, surface });
    this.storedBytes += bytes;
    return surface;
  }
}
