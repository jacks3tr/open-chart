import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';

import { OpenChartDocumentSession } from '../src/session.js';
import { renderDocumentScreenshot } from '../src/screenshot.js';
import { OpenChartToolKernel } from '../src/tools.js';
import {
  startOpenChartWindowsMcpHost,
  type OpenChartWindowsHostHandle,
} from '../src/windows-host.js';

const temporaryDirectories: string[] = [];
const hosts: OpenChartWindowsHostHandle[] = [];
const clients: Client[] = [];
const repositoryRoot = dirname(
  dirname(dirname(fileURLToPath(new URL('.', import.meta.url)))),
);
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  await Promise.allSettled(hosts.splice(0).map((host) => host.close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('OpenChart Windows MCP host', () => {
  it('requires loopback Host, local Origin, and bearer auth before forwarding MCP', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openchart-windows-host-'));
    temporaryDirectories.push(directory);
    const documentPath = join(directory, 'northstar.openchart.json');
    await copyFile(
      join(repositoryRoot, 'examples', 'northstar-integration.openchart.json'),
      documentPath,
    );
    const token = 'openchart-test-token-0000000000000000';
    const session = await OpenChartDocumentSession.open(documentPath);
    const host = await startOpenChartWindowsMcpHost(
      new OpenChartToolKernel(session, renderDocumentScreenshot),
      {
        preferredPort: 0,
        token,
        discoveryDirectory: join(directory, 'discovery'),
      },
    );
    hosts.push(host);

    expect(host.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const discovery: unknown = JSON.parse(await readFile(host.discoveryPath, 'utf8'));
    expect(discovery).toMatchObject({
      version: 1,
      transport: 'streamable-http',
      url: host.url,
      authorization: { type: 'bearer', token },
    });
    const acl = await execFileAsync('icacls.exe', [host.discoveryPath], {
      windowsHide: true,
    });
    const identity = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
    expect(acl.stdout).toContain(`${identity}:(F)`);
    expect(acl.stdout).not.toMatch(/Everyone|Authenticated Users|BUILTIN\\Users/i);

    const hostileHost = await fetch(host.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        host: 'evil.example',
      },
      body: '{}',
    });
    expect(hostileHost.status).toBe(400);

    const unauthenticated = await fetch(host.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get('access-control-allow-origin')).toBeNull();

    const hostileOrigin = await fetch(host.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        origin: 'https://evil.example',
      },
      body: '{}',
    });
    expect(hostileOrigin.status).toBe(403);

    const client = new Client(
      { name: 'openchart-windows-host-test', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(host.url), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    const listed = await client.listTools();
    expect(listed.tools.map(({ name }) => name)).toContain('get_screenshot');

    await client.close();
    clients.pop();
    await host.close();
    hosts.pop();
    await expect(readFile(host.discoveryPath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
