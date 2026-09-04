import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { OpenChartToolKernel } from './tools.js';
import { createOpenChartMcpHandler } from './mcp.js';

const LOOPBACK_HOST = '127.0.0.1';
const DEFAULT_PORT = 4777;
const DEFAULT_PORT_ATTEMPTS = 20;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const execFileAsync = promisify(execFile);

export interface OpenChartWindowsHostOptions {
  readonly preferredPort?: number;
  readonly maxPortAttempts?: number;
  readonly token?: string;
  readonly discoveryDirectory?: string;
}

export interface OpenChartWindowsHostHandle {
  readonly url: string;
  readonly port: number;
  readonly discoveryPath: string;
  close(): Promise<void>;
}

interface DiscoveryFile {
  readonly version: 1;
  readonly instanceId: string;
  readonly transport: 'streamable-http';
  readonly url: string;
  readonly authorization: {
    readonly type: 'bearer';
    readonly token: string;
  };
  readonly pid: number;
}

class RequestBoundaryError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'RequestBoundaryError';
  }
}

function currentWindowsIdentity(): string {
  const username = process.env.USERNAME;
  if (username === undefined || username.length === 0) {
    throw new Error('USERNAME is required to secure the OpenChart discovery file');
  }
  const domain = process.env.USERDOMAIN;
  return domain === undefined || domain.length === 0
    ? username
    : `${domain}\\${username}`;
}

async function applyUserOnlyAcl(path: string, directory: boolean): Promise<void> {
  const permission = directory ? '(OI)(CI)(F)' : '(F)';
  await execFileAsync(
    'icacls.exe',
    [path, '/inheritance:r', '/grant:r', `${currentWindowsIdentity()}:${permission}`],
    { windowsHide: true },
  );
}

async function writeDiscoveryFile(
  directory: string,
  discovery: DiscoveryFile,
): Promise<string> {
  await mkdir(directory, { recursive: true });
  await applyUserOnlyAcl(directory, true);
  const discoveryPath = join(directory, 'mcp.json');
  const tempPath = join(directory, `.mcp.${discovery.instanceId}.tmp`);
  try {
    await writeFile(tempPath, `${JSON.stringify(discovery, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    await applyUserOnlyAcl(tempPath, false);
    await rename(tempPath, discoveryPath);
    await applyUserOnlyAcl(discoveryPath, false);
    return discoveryPath;
  } catch (error: unknown) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

async function removeDiscoveryFileIfOwned(
  discoveryPath: string,
  instanceId: string,
): Promise<void> {
  try {
    const parsed: unknown = JSON.parse(await readFile(discoveryPath, 'utf8'));
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'instanceId' in parsed &&
      parsed.instanceId === instanceId
    ) {
      await unlink(discoveryPath);
    }
  } catch (error: unknown) {
    if (
      error === null ||
      typeof error !== 'object' ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      throw error;
    }
  }
}

function isLoopbackAddress(address: string | undefined): boolean {
  return (
    address === LOOPBACK_HOST ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  );
}

function validHost(value: string | undefined, port: number): boolean {
  if (value === undefined) return false;
  const normalized = value.toLowerCase();
  return (
    normalized === `${LOOPBACK_HOST}:${port}` ||
    normalized === `localhost:${port}`
  );
}

function singleHeader(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

function validOrigin(value: string | undefined, port: number): boolean {
  if (value === undefined) return true;
  try {
    const origin = new URL(value);
    return (
      (origin.protocol === 'http:' || origin.protocol === 'https:') &&
      (origin.hostname === LOOPBACK_HOST || origin.hostname === 'localhost') &&
      Number(origin.port) === port
    );
  } catch {
    return false;
  }
}

function validBearer(value: string | undefined, token: string): boolean {
  if (value === undefined || !value.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(value.slice('Bearer '.length));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

async function readBoundedBody(request: IncomingMessage): Promise<Buffer> {
  const declaredLength = Number(request.headers['content-length'] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new RequestBoundaryError(413, 'Request body exceeds the 2 MiB limit');
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    length += buffer.length;
    if (length > MAX_REQUEST_BYTES) {
      throw new RequestBoundaryError(413, 'Request body exceeds the 2 MiB limit');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, length);
}

async function forwardResponse(
  source: Response,
  target: ServerResponse,
): Promise<void> {
  target.statusCode = source.status;
  source.headers.forEach((value, key) => {
    if (!key.toLowerCase().startsWith('access-control-')) target.setHeader(key, value);
  });
  target.setHeader('cache-control', 'no-store');
  target.end(Buffer.from(await source.arrayBuffer()));
}

async function listen(
  listener: (request: IncomingMessage, response: ServerResponse) => void,
  preferredPort: number,
  attempts: number,
): Promise<{ readonly server: Server; readonly port: number }> {
  const ports = preferredPort === 0
    ? [0]
    : Array.from({ length: attempts }, (_, index) => preferredPort + index);
  for (const port of ports) {
    const server = createServer(listener);
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, LOOPBACK_HOST, () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      const address = server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('OpenChart MCP host did not receive an IPv4 port');
      }
      return { server, port: address.port };
    } catch (error: unknown) {
      server.close();
      if (
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'EADDRINUSE'
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error(`No loopback port was available from ${preferredPort}`);
}

/** Start the authenticated Windows-only socket around the shared MCP handler. */
export async function startOpenChartWindowsMcpHost(
  kernel: OpenChartToolKernel,
  options: OpenChartWindowsHostOptions = {},
): Promise<OpenChartWindowsHostHandle> {
  if (process.platform !== 'win32') {
    throw new Error('The OpenChart loopback MCP host is Windows-only');
  }
  const preferredPort = options.preferredPort ?? DEFAULT_PORT;
  const attempts = options.maxPortAttempts ?? DEFAULT_PORT_ATTEMPTS;
  if (!Number.isInteger(preferredPort) || preferredPort < 0 || preferredPort > 65535) {
    throw new Error('preferredPort must be an integer from 0 through 65535');
  }
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 50) {
    throw new Error('maxPortAttempts must be an integer from 1 through 50');
  }
  const token = options.token ?? randomBytes(32).toString('base64url');
  if (token.length < 32) throw new Error('Bearer token must contain at least 32 characters');
  const localAppData = process.env.LOCALAPPDATA;
  const discoveryDirectory =
    options.discoveryDirectory ??
    (localAppData === undefined ? undefined : join(localAppData, 'OpenChart'));
  if (discoveryDirectory === undefined) {
    throw new Error('LOCALAPPDATA is required for OpenChart MCP discovery');
  }

  const handler = createOpenChartMcpHandler(kernel);
  let activePort = 0;
  const listener = (request: IncomingMessage, response: ServerResponse): void => {
    void (async () => {
      if (!isLoopbackAddress(request.socket.remoteAddress)) {
        sendJson(response, 403, { ok: false, code: 'REMOTE_HOST_REJECTED' });
        return;
      }
      if (!validHost(request.headers.host, activePort)) {
        sendJson(response, 400, { ok: false, code: 'HOST_REJECTED' });
        return;
      }
      if (!validOrigin(singleHeader(request.headers['origin']), activePort)) {
        sendJson(response, 403, { ok: false, code: 'ORIGIN_REJECTED' });
        return;
      }
      if (!validBearer(singleHeader(request.headers['authorization']), token)) {
        sendJson(
          response,
          401,
          { ok: false, code: 'AUTHENTICATION_REQUIRED' },
          { 'www-authenticate': 'Bearer' },
        );
        return;
      }
      if (request.url !== '/mcp') {
        sendJson(response, 404, { ok: false, code: 'NOT_FOUND' });
        return;
      }
      if (request.method !== 'POST') {
        sendJson(response, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' }, {
          allow: 'POST',
        });
        return;
      }
      try {
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers)) {
          if (value === undefined || key === 'authorization' || key === 'host') continue;
          headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        }
        const body = await readBoundedBody(request);
        const result = await handler.fetch(
          new Request(`http://${LOOPBACK_HOST}:${activePort}/mcp`, {
            method: 'POST',
            headers,
            body: body.toString('utf8'),
          }),
        );
        await forwardResponse(result, response);
      } catch (error: unknown) {
        const boundary = error instanceof RequestBoundaryError ? error : undefined;
        sendJson(response, boundary?.status ?? 500, {
          ok: false,
          code: boundary === undefined ? 'MCP_REQUEST_FAILED' : 'REQUEST_TOO_LARGE',
        });
      }
    })();
  };

  const { server, port } = await listen(listener, preferredPort, attempts);
  activePort = port;
  const instanceId = randomUUID();
  const url = `http://${LOOPBACK_HOST}:${port}/mcp`;
  let discoveryPath: string;
  try {
    discoveryPath = await writeDiscoveryFile(discoveryDirectory, {
      version: 1,
      instanceId,
      transport: 'streamable-http',
      url,
      authorization: { type: 'bearer', token },
      pid: process.pid,
    });
  } catch (error: unknown) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await handler.close();
    throw error;
  }

  let closePromise: Promise<void> | undefined;
  return {
    url,
    port,
    discoveryPath,
    close: () => {
      closePromise ??= (async () => {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
        });
        await handler.close();
        await removeDiscoveryFileIfOwned(discoveryPath, instanceId);
      })();
      return closePromise;
    },
  };
}
