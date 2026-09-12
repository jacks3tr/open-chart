/* global fetch, WebSocket, setTimeout, clearTimeout */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { access, appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const exists = async (path) => access(path).then(() => true, () => false);

async function browserExecutable() {
  const candidates = process.env.OPENCHART_BROWSER ? [process.env.OPENCHART_BROWSER]
    : process.platform === 'win32'
      ? [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]
        .filter(Boolean).map((directory) => join(directory, 'Microsoft/Edge/Application/msedge.exe'))
      : ['/usr/bin/chromium', '/usr/bin/google-chrome'];
  for (const path of candidates) if (await exists(path)) return path;
  throw new Error('Set OPENCHART_BROWSER to an installed Edge or Chromium executable.');
}

async function waitFor(read, description) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await read();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolveOpen, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('CDP connection timeout')); }, 10_000);
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

export async function withApp(feature, drive) {
  const evidenceRoot = resolve(root, '.openchart-acceptance/verify-openchart');
  await mkdir(evidenceRoot, { recursive: true });
  const evidence = await mkdtemp(join(evidenceRoot, 'run-'));
  const scratch = await mkdtemp(join(resolve(tmpdir()), 'openchart-verify-'));
  const profile = join(scratch, 'browser');
  let server, browser, cdp, capture;
  let outcome = { passed: false };
  const record = async (action, detail = {}) => appendFile(join(evidence, 'actions.ndjson'),
    `${JSON.stringify({ time: new Date().toISOString(), feature, action, ...detail })}\n`);
  process.stdout.write(`Evidence: ${evidence}\n`);
  try {
    server = await createServer({ root: resolve(root, 'packages/app'), cacheDir: join(scratch, 'vite'),
      server: { host: '127.0.0.1', port: 0, strictPort: true } });
    await server.listen();
    const address = server.httpServer.address();
    assert(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/`;
    browser = spawn(await browserExecutable(), [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
      ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []), url,
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let browserError;
    browser.on('error', (error) => { browserError = error; });
    let browserLog = '';
    browser.stderr.on('data', (chunk) => { browserLog = (browserLog + String(chunk)).slice(-32_000); });
    await writeFile(join(evidence, 'instance.json'), json({ feature, root, url, runnerPid: process.pid, browserPid: browser.pid, scratch,
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      changes: execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).trim() }));
    const port = await waitFor(async () => {
      if (browserError) throw browserError;
      assert.equal(browser.exitCode, null, browserLog);
      const file = join(profile, 'DevToolsActivePort');
      return await exists(file) && Number((await readFile(file, 'utf8')).split('\n')[0]);
    }, 'owned browser debugger');
    const target = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      return (await response.json()).find((item) => item.type === 'page' && item.url === url);
    }, 'normal application page');
    cdp = await connect(target.webSocketDebuggerUrl);
    const evaluate = async (expression) => {
      const response = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) throw new Error(json(response.exceptionDetails));
      return response.result.value;
    };
    const wait = (expression) => waitFor(() => evaluate(expression), expression);
    const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.enable');
    await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true });
    await wait('Boolean(document.querySelector(".web-home .web-primary"))');
    const doctor = async () => {
      assert(server.httpServer.listening, 'Owned Vite server stopped');
      assert.equal(browser.exitCode, null, 'Owned browser stopped');
      const response = await fetch(url);
      assert(response.ok && (await response.text()).includes('/src/main.tsx'), 'Wrong application entry point');
      assert.equal(await evaluate('location.href'), url);
      assert(await evaluate(`Boolean(document.querySelector('[aria-label="OpenChart home"]'))`));
      return { url, root, runnerPid: process.pid, browserPid: browser.pid,
        browser: (await cdp.send('Browser.getVersion')).product, title: await evaluate('document.title') };
    };
    await writeFile(join(evidence, 'doctor.json'), json(await doctor()));
    const click = async (selector, text) => {
      await record('click', { selector, text });
      await wait(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
      const point = await evaluate(`(() => {
        const elements = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(el => el.checkVisibility()
          && (${JSON.stringify(text)} === undefined || el.textContent.trim() === ${JSON.stringify(text)}));
        if (elements.length !== 1) throw new Error('Expected one visible control: ' + ${JSON.stringify(selector)});
        const el = elements[0];
        if (el.disabled) throw new Error('Control is disabled');
        el.scrollIntoView({block: 'center'});
        const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
        if (!el.contains(document.elementFromPoint(x, y))) throw new Error('Control is covered');
        return {x, y};
      })()`);
      for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent',
        { type, ...point, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
      await settle();
    };
    const key = async (key, modifiers = 0) => {
      await record('key', { key, modifiers });
      const specialKeys = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46,
        Home: 36, End: 35, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
        PageUp: 33, PageDown: 34, F1: 112, F2: 113, F3: 114 };
      const windowsVirtualKeyCode = key.length === 1 ? key.toUpperCase().charCodeAt(0) : specialKeys[key];
      assert(windowsVirtualKeyCode, `Unsupported key: ${key}`);
      const code = key === ' ' ? 'Space' : /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}`
        : /^\d$/.test(key) ? `Digit${key}` : key;
      for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key, code, modifiers, windowsVirtualKeyCode });
      await settle();
    };
    const fill = async (selector, text) => {
      await click(selector);
      await key('a', 2);
      await record('type', { selector, text });
      await cdp.send('Input.insertText', { text });
      await settle();
    };
    const focus = async (selector) => {
      await record('focus', { selector });
      const { root: document } = await cdp.send('DOM.getDocument');
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: document.nodeId, selector });
      assert(nodeId, `No focus target: ${selector}`);
      await cdp.send('DOM.focus', { nodeId });
    };
    capture = async (name) => {
      await settle();
      await record('capture', { name });
      await writeFile(join(evidence, `${name}.aria.json`), json(await cdp.send('Accessibility.getFullAXTree')));
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(evidence, `${name}.png`), Buffer.from(data, 'base64'));
    };
    const download = async (name, action, extension) => {
      const directory = join(evidence, name);
      await mkdir(directory);
      await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: directory });
      await record('download', { name, extension });
      await action();
      return waitFor(async () => {
        const files = await readdir(directory);
        const filename = files.find((file) => file.endsWith(extension));
        return filename && !files.some((file) => file.endsWith('.crdownload')) && join(directory, filename);
      }, `download ${name}`);
    };
    const upload = async (selector, path) => {
      await record('choose-file', { selector, path: resolve(path) });
      const { root: document } = await cdp.send('DOM.getDocument');
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: document.nodeId, selector });
      assert(nodeId, `No file input: ${selector}`);
      await cdp.send('DOM.setFileInputFiles', { nodeId, files: [resolve(path)] });
      await settle();
    };
    const save = (name) => download(name, () => key('s', 2), '.openchart.json');
    await drive({ evidence, doctor, evaluate, wait, click, key, fill, focus, capture, download, upload, save,
      send: async (method, params) => { await record(method, { params }); return cdp.send(method, params); } });
    outcome = { passed: true };
  } catch (error) {
    outcome = { passed: false, error: error.stack ?? String(error) };
    await capture?.('failure').catch(() => undefined);
    throw error;
  } finally {
    try {
      if (browser?.pid && browser.exitCode === null) {
        const exited = once(browser, 'exit');
        await cdp?.send('Browser.close').catch(() => undefined);
        await Promise.race([exited, delay(2000)]);
        if (browser.exitCode === null && browser.signalCode === null) {
          if (process.platform === 'win32') {
            const killer = spawn('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
            assert.equal((await once(killer, 'exit'))[0], 0, 'Could not stop owned browser');
          } else browser.kill();
          await waitFor(() => browser.exitCode !== null || browser.signalCode !== null, 'browser shutdown');
        }
      }
    } finally {
      cdp?.close();
      await server?.close();
      assert.equal(dirname(scratch), resolve(tmpdir()));
      assert(basename(scratch).startsWith('openchart-verify-'));
      await rm(scratch, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
      await writeFile(join(evidence, 'result.json'), json({ feature, ...outcome }));
      const cleanup = { serverStopped: !server?.httpServer?.listening,
        browserStopped: !browser?.pid || browser.exitCode !== null || browser.signalCode !== null,
        scratchRemoved: !await exists(scratch), evidenceRetained: await exists(evidence) };
      await writeFile(join(evidence, 'cleanup.json'), json(cleanup));
      assert(Object.values(cleanup).every(Boolean), 'Cleanup incomplete; inspect cleanup.json');
    }
    process.stdout.write(json({ ...outcome, evidence }));
  }
}

async function templateProof(app) {
  await app.capture('00-home');
  await app.click('.web-home .web-primary');
  await app.wait('Boolean(document.querySelector(".oc-empty-canvas"))');
  await app.fill('[aria-label="Document title"]', 'Verification approval');
  await app.key('Enter');
  await app.capture('01-blank');
  const before = JSON.parse(await readFile(await app.save('before'), 'utf8'));
  assert.equal(before.title, 'Verification approval');
  assert.equal(Object.keys(before.nodes).length, 0);
  await app.click('.oc-empty-actions .is-primary');
  await app.wait(`Boolean(document.querySelector('[data-template-id="flowchart"]'))`);
  await app.capture('02-template-chooser');
  await app.click('[data-template-id="flowchart"]');
  await app.wait('document.querySelector(".oc-page-tabs .is-active")?.textContent.trim() === "Approval flowchart"');
  await app.capture('03-template');
  const saved = await app.save('template');
  const template = JSON.parse(await readFile(saved, 'utf8'));
  assert.equal(Object.keys(template.nodes).length, 10);
  assert.equal(Object.keys(template.edges).length, 8);
  assert(Object.values(template.nodes).some((node) => node.label === 'Meets policy?'));
  const content = (document) => ({ ...document, rev: 0 });
  await app.click('[title="Undo (Ctrl+Z)"]');
  await app.wait('Boolean(document.querySelector(".oc-empty-canvas"))');
  assert.deepEqual(content(JSON.parse(await readFile(await app.save('undone'), 'utf8'))), content(before));
  await app.capture('04-undone');
  await app.click('[title="Redo (Ctrl+Y)"]');
  await app.wait('!document.querySelector(".oc-empty-canvas")');
  assert.deepEqual(content(JSON.parse(await readFile(await app.save('redone'), 'utf8'))), content(template));
  await app.capture('05-redone');
  await app.key('o', 2);
  await app.upload('[aria-label="Open OpenChart document file"]', saved);
  await app.wait('document.querySelector(".oc-page-tabs .is-active")?.textContent.trim() === "Approval flowchart"');
  assert.deepEqual(JSON.parse(await readFile(await app.save('reopened'), 'utf8')), template);
  await app.capture('06-reopened');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await withApp('templates.empty-canvas', templateProof);
}
