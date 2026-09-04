import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const DEFAULT_BENCHMARK_PATH = '/packages/render/benchmark/render-10k.html';
const BENCHMARK_TIMEOUT_MS = 45_000;
const MAX_RENDERER_RSS_BYTES = 600 * 1024 * 1024;
const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
]);

function outputArgument() {
  const index = process.argv.indexOf('--output');
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error('--output requires a file path');
  }
  return resolve(REPO_ROOT, value);
}

function benchmarkPathArgument() {
  const index = process.argv.indexOf('--benchmark-path');
  if (index === -1) return DEFAULT_BENCHMARK_PATH;
  const value = process.argv[index + 1];
  if (
    value === undefined ||
    value.startsWith('--') ||
    !value.startsWith('/') ||
    value.includes('\\') ||
    value.includes('%') ||
    value.includes('?') ||
    value.includes('#') ||
    extname(value).toLowerCase() !== '.html'
  ) {
    throw new Error('--benchmark-path requires a repository-local absolute HTML path');
  }
  const filePath = resolve(REPO_ROOT, value.replace(/^\/+/, ''));
  if (!isWithinRepo(filePath)) {
    throw new Error('--benchmark-path must stay inside the OpenChart repository');
  }
  return value;
}

async function findEdge() {
  if (process.platform !== 'win32') {
    throw new Error('The OpenChart render benchmark requires Windows and Microsoft Edge');
  }
  const roots = [
    process.env['ProgramFiles(x86)'],
    process.env.ProgramFiles,
    process.env.LOCALAPPDATA,
  ].filter((value) => typeof value === 'string' && value.length > 0);
  for (const root of roots) {
    const candidate = join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next standard Windows installation root.
    }
  }
  throw new Error('Microsoft Edge was not found in a standard Windows installation directory');
}

function isWithinRepo(path) {
  return path === REPO_ROOT || path.startsWith(`${REPO_ROOT}${sep}`);
}

async function serveFile(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405).end('Method Not Allowed');
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
  } catch {
    response.writeHead(400).end('Bad Request');
    return;
  }
  let filePath = resolve(REPO_ROOT, pathname.replace(/^\/+/, ''));
  if (!isWithinRepo(filePath)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const details = await stat(filePath);
    if (details.isDirectory()) filePath = join(filePath, 'index.html');
    const fileDetails = await stat(filePath);
    if (!fileDetails.isFile() || !isWithinRepo(filePath)) {
      response.writeHead(404).end('Not Found');
      return;
    }
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': MIME_TYPES.get(extname(filePath)) ?? 'application/octet-stream',
      'Content-Length': fileDetails.size,
    });
    if (request.method === 'HEAD') {
      response.end();
    } else {
      createReadStream(filePath).pipe(response);
    }
  } catch {
    response.writeHead(404).end('Not Found');
  }
}

async function startServer() {
  const server = createServer((request, response) => void serveFile(request, response));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('Unable to resolve the render benchmark server address');
  }
  return { server, port: address.port };
}

async function waitForDevToolsPort(userDataDirectory) {
  const portFile = join(userDataDirectory, 'DevToolsActivePort');
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const [portText] = (await readFile(portFile, 'utf8')).trim().split(/\r?\n/);
      const port = Number(portText);
      if (Number.isSafeInteger(port) && port > 0) return port;
    } catch {
      // Edge creates the file after its debugging endpoint is ready.
    }
    await delay(50);
  }
  throw new Error('Timed out waiting for the Edge DevTools endpoint');
}

async function waitForPageTarget(port, benchmarkPath) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find(
          (candidate) =>
            candidate.type === 'page' &&
            typeof candidate.url === 'string' &&
            candidate.url.includes(benchmarkPath) &&
            typeof candidate.webSocketDebuggerUrl === 'string',
        );
        if (target !== undefined) return target.webSocketDebuggerUrl;
      }
    } catch {
      // The target list races with the first page navigation.
    }
    await delay(50);
  }
  throw new Error('Timed out waiting for the Edge benchmark page');
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('Unable to open CDP WebSocket')), {
      once: true,
    });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (typeof message.id !== 'number') return;
    const request = pending.get(message.id);
    if (request === undefined) return;
    pending.delete(message.id);
    if (message.error !== undefined) {
      request.reject(new Error(message.error.message ?? 'CDP request failed'));
    } else {
      request.resolve(message.result);
    }
  });
  return {
    send(method, params = {}) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolveRequest, rejectRequest) => {
        pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}

async function waitForBenchmarkResult(cdp) {
  const deadline = Date.now() + BENCHMARK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const evaluation = await cdp.send('Runtime.evaluate', {
      expression:
        'window.__openChartBenchmark ?? (window.__openChartBenchmarkError ? { passed: false, error: window.__openChartBenchmarkError } : null)',
      returnByValue: true,
    });
    const value = evaluation.result?.value;
    if (value !== null && value !== undefined) return value;
    await delay(100);
  }
  throw new Error('Timed out waiting for the render benchmark result');
}

async function measureEdgeMemory(rootProcessId) {
  if (!Number.isSafeInteger(rootProcessId) || rootProcessId <= 0) {
    throw new Error(`Edge root process id is invalid: ${JSON.stringify(rootProcessId)}`);
  }
  const script = [
    `$rootProcessId = ${rootProcessId}`,
    '$processes = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, WorkingSetSize, PrivatePageCount, CommandLine)',
    '$ids = [System.Collections.Generic.HashSet[int]]::new()',
    '[void]$ids.Add($rootProcessId)',
    'do {',
    '  $added = $false',
    '  foreach ($process in $processes) {',
    '    if ($ids.Contains([int]$process.ParentProcessId) -and -not $ids.Contains([int]$process.ProcessId)) {',
    '      [void]$ids.Add([int]$process.ProcessId)',
    '      $added = $true',
    '    }',
    '  }',
    '} while ($added)',
    '$owned = @($processes | Where-Object { $ids.Contains([int]$_.ProcessId) })',
    '$renderers = @($owned | Where-Object { $_.CommandLine -match "(?:^|\\s)--type=renderer(?:\\s|$)" })',
    '$rendererRss = ($renderers | Measure-Object -Property WorkingSetSize -Maximum).Maximum',
    'if ($null -eq $rendererRss) { $rendererRss = 0 }',
    '$treeWorkingSet = ($owned | Measure-Object -Property WorkingSetSize -Sum).Sum',
    '$treePrivate = ($owned | Measure-Object -Property PrivatePageCount -Sum).Sum',
    '[pscustomobject]@{ rendererRssBytes = [int64]$rendererRss; processTreeWorkingSetBytes = [int64]$treeWorkingSet; processTreePrivateBytes = [int64]$treePrivate; processCount = $owned.Count } | ConvertTo-Json -Compress',
  ].join('\n');
  const powershell = spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  powershell.stdout.setEncoding('utf8');
  powershell.stderr.setEncoding('utf8');
  let stdout = '';
  let stderr = '';
  powershell.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  powershell.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const [exitCode] = await once(powershell, 'exit');
  if (exitCode !== 0) {
    throw new Error(`Could not measure Edge memory: ${stderr.trim() || `exit ${exitCode}`}`);
  }
  const result = JSON.parse(stdout.trim());
  for (const key of [
    'rendererRssBytes',
    'processTreeWorkingSetBytes',
    'processTreePrivateBytes',
    'processCount',
  ]) {
    const value = result[key];
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Edge memory returned an invalid ${key}: ${JSON.stringify(stdout)}`);
    }
  }
  return result;
}

async function closeServer(server) {
  if (server.listening) {
    const closed = new Promise((resolveClose) => server.close(resolveClose));
    server.closeAllConnections?.();
    await Promise.race([closed, delay(2000)]);
  }
}

async function removeOwnedTempDirectory(path) {
  const resolvedPath = resolve(path);
  const temporaryRoot = resolve(tmpdir());
  if (resolvedPath === temporaryRoot || !resolvedPath.startsWith(`${temporaryRoot}${sep}`)) {
    throw new Error(`Refusing to remove unowned temporary directory ${JSON.stringify(resolvedPath)}`);
  }
  await rm(resolvedPath, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 250,
  });
}

async function terminateBrowserProcess(processHandle) {
  if (processHandle === undefined || processHandle.exitCode !== null) return;
  if (process.platform === 'win32' && processHandle.pid !== undefined) {
    const killer = spawn(
      'taskkill',
      ['/PID', String(processHandle.pid), '/T', '/F'],
      { windowsHide: true, stdio: 'ignore' },
    );
    await Promise.race([once(killer, 'exit'), delay(3000)]).catch(() => undefined);
  } else {
    processHandle.kill('SIGKILL');
  }
  if (processHandle.exitCode === null) {
    processHandle.kill();
    await Promise.race([once(processHandle, 'exit'), delay(3000)]).catch(() => undefined);
  }
}

async function main() {
  const outputPath = outputArgument();
  const benchmarkPath = benchmarkPathArgument();
  await access(resolve(REPO_ROOT, benchmarkPath.replace(/^\/+/, '')));
  const edgePath = await findEdge();
  const { server, port } = await startServer();
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'openchart-render-benchmark-'));
  let edgeProcess;
  let cdp;
  let edgeErrors = '';
  try {
    const benchmarkUrl = `http://127.0.0.1:${port}${benchmarkPath}`;
    edgeProcess = spawn(
      edgePath,
      [
        '--headless=new',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDirectory}`,
        '--no-first-run',
        '--disable-default-apps',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--window-size=1320,900',
        benchmarkUrl,
      ],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    edgeProcess.stderr.setEncoding('utf8');
    edgeProcess.stderr.on('data', (chunk) => {
      edgeErrors = `${edgeErrors}${chunk}`.slice(-4000);
    });
    const devToolsPort = await waitForDevToolsPort(userDataDirectory);
    const targetUrl = await waitForPageTarget(devToolsPort, benchmarkPath);
    cdp = await connectCdp(targetUrl);
    await cdp.send('Runtime.enable');
    const pageResult = await waitForBenchmarkResult(cdp);
    const memory = await measureEdgeMemory(edgeProcess.pid);
    const result = {
      ...pageResult,
      ...memory,
      passed:
        pageResult.passed === true && memory.rendererRssBytes < MAX_RENDERER_RSS_BYTES,
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath !== undefined) {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, serialized, 'utf8');
    }
    process.stdout.write(serialized);
    if (result.passed !== true) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(edgeErrors.length === 0 ? message : `${message}\nEdge diagnostics:\n${edgeErrors}`, {
      cause: error,
    });
  } finally {
    if (cdp !== undefined) {
      await cdp.send('Browser.close').catch(() => undefined);
      await delay(250);
    }
    cdp?.close();
    await terminateBrowserProcess(edgeProcess);
    await closeServer(server);
    // Chromium can release profile SQLite journal handles a fraction after the
    // process exit event on Windows. Give those handles time to settle before
    // removing the benchmark-owned profile directory.
    await delay(500);
    await removeOwnedTempDirectory(userDataDirectory);
  }
}

main().catch((error) => {
  process.stderr.write(`OpenChart render benchmark failed: ${error.stack ?? error}\n`);
  process.exitCode = 1;
});
