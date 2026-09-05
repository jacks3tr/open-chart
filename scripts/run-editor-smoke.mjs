/* global console, fetch, WebSocket, setTimeout, clearTimeout */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const pagePath = '/benchmark/editor-smoke.html';
async function browserExecutable() {
  if (process.env.OPENCHART_BROWSER) return process.env.OPENCHART_BROWSER;
  const candidates = process.platform === 'win32'
    ? [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]
      .filter(Boolean).map((directory) => join(directory, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
    : ['/usr/bin/chromium', '/usr/bin/google-chrome'];
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* Try next browser. */ }
  }
  throw new Error('No browser found. Set OPENCHART_BROWSER to a Chromium or Edge executable.');
}
async function waitFor(getValue, description) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const value = await getValue();
    if (value) return value;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolveOpen, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP connection timeout')), 10_000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolveOpen(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const response = JSON.parse(String(event.data));
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    clearTimeout(entry.timer);
    if (response.error) entry.reject(new Error(response.error.message));
    else entry.resolve(response.result);
  });
  return {
    send(method, params = {}) {
      const next = ++id;
      return new Promise((resolveRequest, reject) => {
        const timer = setTimeout(() => { pending.delete(next); reject(new Error(`CDP timeout: ${method}`)); }, 10_000);
        pending.set(next, { resolve: resolveRequest, reject, timer });
        socket.send(JSON.stringify({ id: next, method, params }));
      });
    },
    close() {
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('CDP closed')); }
      pending.clear();
      socket.close();
    },
  };
}

const profile = await mkdtemp(join(tmpdir(), 'openchart-editor-smoke-'));
let server;
let browser;
let cdp;
const results = [];
try {
  server = await createServer({ root: resolve(root, 'packages/app'), server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const address = server.httpServer.address();
  assert(address && typeof address !== 'string');
  browser = spawn(await browserExecutable(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    '--window-size=1440,1000', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    `http://127.0.0.1:${address.port}${pagePath}`,
  ], { stdio: 'ignore', windowsHide: true });
  browser.on('error', (error) => { console.error(error); });
  const port = await waitFor(async () => {
    try { return Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); }
    catch { return undefined; }
  }, 'browser debugger');
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    return (await response.json()).find((candidate) => candidate.type === 'page' && candidate.url.includes(pagePath));
  }, 'editor page');
  cdp = await connect(target.webSocketDebuggerUrl);
  const evaluate = async (expression) => {
    const response = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result?.value;
  };
  const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await waitFor(() => evaluate('Boolean(window.__editorSmoke?.camera && document.querySelector(".oc-canvas-overlay"))'), 'mounted editor');
  await settle();
  const test = async (name, run) => {
    try { await run(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
  };
  await test('initial engine is constructed once across viewport renders', async () => {
    assert.equal(await evaluate('window.__editorSmoke.initialClones'), 1);
  });
  await evaluate('document.querySelector("button[aria-label=\\"Add Process\\"]").click()');
  await settle();
  const readGeometry = () => evaluate(`(() => {
    const s = window.__editorSmoke;
    const rect = document.querySelector('.oc-canvas-overlay').getBoundingClientRect();
    const id = Object.keys(s.document.nodes)[0];
    const frame = s.document.layout.overrides[id];
    return { x: rect.left + (frame.x - s.camera.x) * s.camera.zoom,
      y: rect.top + (frame.y - s.camera.y) * s.camera.zoom,
      width: frame.width * s.camera.zoom, height: frame.height * s.camera.zoom };
  })()`);
  const geometry = await readGeometry();
  assert(geometry.width > 0, 'A real shape must be on the canvas');
  const mouse = (type, x, y, buttons = 0) => cdp.send('Input.dispatchMouseEvent', {
    type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1,
  });
  await test('hover paints only the overlay', async () => {
    await mouse('mouseMoved', geometry.x - 45, geometry.y - 45);
    await settle();
    await evaluate('window.__editorSmoke.paints = [0,0,0]');
    await mouse('mouseMoved', geometry.x + geometry.width / 2, geometry.y + geometry.height / 2);
    await settle();
    const paints = await evaluate('window.__editorSmoke.paints');
    assert.equal(paints[0], 0, 'Background was repainted on hover');
    assert.equal(paints[1], 0, 'Main layer was repainted on hover');
    assert(paints[2] > 0, 'The hover overlay must be painted');
  });
  const handle = (geometry, mode) => mode === 'resize'
    ? [geometry.x + geometry.width, geometry.y + geometry.height]
    : [geometry.x + geometry.width / 2, mode === 'rotate' ? geometry.y - 30 : geometry.y + geometry.height / 2];
  for (const mode of ['move', 'resize', 'rotate']) {
    await test(`cancelled ${mode} never commits a transaction`, async () => {
      const [x, y] = handle(await readGeometry(), mode);
      const before = await evaluate('window.__editorSmoke.commits');
      await mouse('mouseMoved', x, y);
      await mouse('mousePressed', x, y, 1);
      await settle();
      await evaluate('window.__editorSmoke.paints = [0,0,0]');
      await mouse('mouseMoved', x + 65, y + 40, 1);
      await settle();
      const paints = await evaluate('window.__editorSmoke.paints');
      assert(paints[1] > 0, `${mode} must actually draw a transform preview`);
      await evaluate("document.querySelector('.oc-canvas-overlay').dispatchEvent(new PointerEvent('pointercancel', {bubbles:true, pointerId:1}))");
      await mouse('mouseReleased', x + 65, y + 40);
      await settle();
      assert.equal(await evaluate('window.__editorSmoke.commits'), before);
    });
  }
  for (const mode of ['move', 'resize', 'rotate']) {
    await test(`completed ${mode} commits exactly once`, async () => {
      const [x, y] = handle(await readGeometry(), mode);
      const before = await evaluate('window.__editorSmoke.commits');
      await mouse('mouseMoved', x, y);
      await mouse('mousePressed', x, y, 1);
      await mouse('mouseMoved', x + 45, y + 45, 1);
      await settle();
      await mouse('mouseReleased', x + 45, y + 45);
      await settle();
      assert.equal(await evaluate('window.__editorSmoke.commits'), before + 1);
    });
  }
  console.log(JSON.stringify({ passed: results.every((result) => result.passed), tests: results }, null, 2));
  if (results.some((result) => !result.passed)) process.exitCode = 1;
} finally {
  cdp?.close();
  if (browser?.pid && browser.exitCode === null) {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
      await once(killer, 'exit');
    } else {
      browser.kill();
      await Promise.race([once(browser, 'exit'), delay(2000)]);
    }
  }
  await server?.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
