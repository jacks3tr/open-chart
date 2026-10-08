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
  await waitFor(() => evaluate('Boolean(document.querySelector("[data-shape-entry=\\"flowchart.process\\"]"))'), 'process shape in palette');
  await test('icon libraries load independently and remain usable after switching', async () => {
    const selectLibrary = (id) => evaluate(`(() => {
      const select = document.querySelector('[aria-label="Shape panel category"]');
      select.value = ${JSON.stringify(id)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await selectLibrary('simple-icons');
    await waitFor(() => evaluate(`document.querySelector('.oc-rail-result-copy small')?.textContent === 'Simple Icons'`), 'Simple Icons results');
    assert.equal(await evaluate(`performance.getEntriesByType('resource').some((entry) => entry.name.includes('/generated/phosphor.js'))`), false,
      'Choosing Simple Icons must not fetch Phosphor');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 640, deviceScaleFactor: 1, mobile: false });
    await selectLibrary('phosphor');
    await waitFor(() => evaluate(`document.querySelector('.oc-rail-result-copy small')?.textContent === 'Phosphor'`), 'Phosphor results');
    await selectLibrary('simple-icons');
    await waitFor(() => evaluate(`document.querySelector('.oc-rail-result-copy small')?.textContent === 'Simple Icons'`), 'retained Simple Icons results');
    await selectLibrary('featured');
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await settle();
  });
  await waitFor(() => evaluate('Boolean(document.querySelector("[data-shape-entry=\\"flowchart.process\\"]"))'), 'restored process palette');
  await evaluate('document.querySelector("[data-shape-entry=\\"flowchart.process\\"]").click()');
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
    type, x, y, button: type === 'mouseMoved' && buttons === 0 ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1,
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
  for (const cancelled of [true, false]) {
    await test(`${cancelled ? 'cancel' : 'release'} before preview frame preserves the latest gesture`, async () => {
      const geometry = await readGeometry();
      const x = geometry.x + geometry.width / 2;
      const y = geometry.y + geometry.height / 2;
      const before = await evaluate('window.__editorSmoke.commits');
      await mouse('mouseMoved', x, y);
      await mouse('mousePressed', x, y, 1);
      // Dispatch a burst and its termination in one browser task; rAF cannot run between them.
      await evaluate(`(() => {
        const canvas = document.querySelector('.oc-canvas-overlay');
        for (let i = 1; i <= 6; i++) canvas.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, pointerId: 1, clientX: ${x} + i * 10, clientY: ${y} + i * 10,
          buttons: 1,
        }));
        canvas.dispatchEvent(new PointerEvent('${cancelled ? 'pointercancel' : 'pointerup'}', {
          bubbles: true, pointerId: 1, clientX: ${x} + 60, clientY: ${y} + 60,
        }));
      })()`);
      await mouse('mouseReleased', x + 60, y + 60);
      await settle();
      assert.equal(await evaluate('window.__editorSmoke.commits'), before + (cancelled ? 0 : 1));
      const after = await readGeometry();
      if (cancelled) assert.deepEqual(after, geometry);
      else {
        assert(after.x > geometry.x + 40, 'Latest move, not an earlier queued preview, must commit');
        assert(after.y > geometry.y + 40, 'Latest move must commit on both axes');
      }
      await settle();
      assert.equal(await evaluate('window.__editorSmoke.commits'), before + (cancelled ? 0 : 1));
    });
  }
  await test('cutting pasted shapes and connectors removes them together', async () => {
    await evaluate(`document.querySelector('[title="Open templates"]').click()`);
    await waitFor(() => evaluate(`Boolean(document.querySelector('[data-template-id="flowchart"]'))`), 'flowchart template');
    await evaluate(`document.querySelector('[data-template-id="flowchart"]').click()`);
    await waitFor(() => evaluate('Object.keys(window.__editorSmoke.document.edges).length > 0'), 'template connectors');
    const counts = () => evaluate(`({ nodes: Object.keys(window.__editorSmoke.document.nodes).length,
      edges: Object.keys(window.__editorSmoke.document.edges).length })`);
    const before = await counts();
    await evaluate(`document.querySelector('.oc-canvas-overlay').dispatchEvent(new KeyboardEvent('keydown',
      { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }))`);
    await settle();
    await evaluate(`document.querySelector('.oc-app').dispatchEvent(new ClipboardEvent('copy',
      { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }))`);
    await settle();
    await evaluate(`document.querySelector('.oc-app').dispatchEvent(new ClipboardEvent('paste',
      { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }))`);
    await settle();
    assert.deepEqual(await counts(), { nodes: before.nodes * 2, edges: before.edges * 2 });
    await evaluate(`document.querySelector('.oc-app').dispatchEvent(new ClipboardEvent('cut',
      { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }))`);
    await settle();
    assert.deepEqual(await counts(), before);
    assert.equal(await evaluate("document.body.textContent.includes('Cut selection')"), true);
  });
  await test('library swimlanes support label and size edits while the page grid stays independent', async () => {
    await evaluate(`(() => {
      const input = document.querySelector('[aria-label="Quick insert shapes and icons"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'swimlane');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await waitFor(() => evaluate(`Boolean(document.querySelector('[title="Insert Swimlane"]'))`), 'swimlane library result');
    await evaluate(`document.querySelector('[title="Insert Swimlane"]').click()`);
    await settle();
    const laneId = await evaluate(`Object.values(window.__editorSmoke.document.nodes).find((node) => node.data.shape?.entryId === 'architecture.swimlane')?.id`);
    assert(laneId, 'The library must insert a native swimlane');
    assert.equal(await evaluate(`Boolean(window.__editorSmoke.document.nodes[${JSON.stringify(laneId)}].container)`), true);
    await evaluate(`document.querySelector('[title="Show contextual panel"]')?.click()`);
    await settle();
    await evaluate(`(() => {
      const input = document.querySelector('.oc-inspector textarea');
      input.focus(); input.value = 'Production lane'; input.blur();
    })()`);
    await settle();
    assert.equal(await evaluate(`window.__editorSmoke.document.nodes[${JSON.stringify(laneId)}].label`), 'Production lane');
    await evaluate(`(() => {
      const input = [...document.querySelectorAll('.oc-inspector .oc-field')].find((field) => field.querySelector('span')?.textContent === 'W').querySelector('input');
      input.focus(); input.value = '420'; input.blur();
    })()`);
    await settle();
    assert.equal(await evaluate(`window.__editorSmoke.document.layout.overrides[${JSON.stringify(laneId)}].width`), 420);
    await evaluate(`document.querySelector('[title="Page settings"]').click()`);
    await settle();
    for (const hidden of [true, false]) {
      await evaluate(`([...document.querySelectorAll('.oc-page-view-options label')].find((label) => label.textContent.trim() === 'Grid')).querySelector('input').click()`);
      await settle();
      assert.equal(await evaluate(`document.querySelector('.oc-app').classList.contains('oc-grid-hidden')`), hidden);
    }
    await evaluate(`document.querySelector('[title="Page settings"]').click()`);
  });
  await test('homepage rejects oversized files and opens an editable diagram with library icons', async () => {
    const { targetId } = await cdp.send('Target.createTarget', { url: `http://127.0.0.1:${address.port}/` });
    const homepageTarget = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      return (await response.json()).find((candidate) => candidate.id === targetId);
    }, 'homepage tab');
    cdp.close();
    cdp = await connect(homepageTarget.webSocketDebuggerUrl);
    await waitFor(() => evaluate(`Boolean(document.querySelector('.web-home input[type="file"]'))`), 'homepage file input');
    await evaluate(`(() => {
      const input = document.querySelector('.web-home input[type="file"]');
      const files = new DataTransfer();
      files.items.add(new File([new Uint8Array(32 * 1024 * 1024 + 1)], 'oversized.openchart.json'));
      input.files = files.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor(() => evaluate(`document.querySelector('.web-error')?.textContent.includes('32 MiB')`), 'file size rejection');
    assert.equal(await evaluate(`Boolean(document.querySelector('.oc-app'))`), false);
    const documentSource = await readFile(join(root, 'examples/northstar-swimlanes.openchart.json'), 'utf8');
    await evaluate(`(() => {
      const input = document.querySelector('.web-home input[type="file"]');
      const files = new DataTransfer();
      files.items.add(new File([${JSON.stringify(documentSource)}], 'example.openchart.json'));
      input.files = files.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor(() => evaluate(`Boolean(document.querySelector('.oc-app'))`), 'opened homepage document');
    assert.equal(await evaluate(`Boolean(document.querySelector('.web-error'))`), false);
  });
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
