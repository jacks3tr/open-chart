---
name: verify-openchart
description: Verify OpenChart's browser editor through real mouse, keyboard, and file actions. Use after editor changes or to reproduce a user workflow, with screenshots and saved documents as evidence. Includes a feature map and existing CLI and desktop checks.
---

# Verify OpenChart

Read [the feature map](features/README.md), then the recipe for the changed behavior. Run only the relevant paths. The default proof covers the empty-canvas template entry, undo, redo, and a JSON file round trip.

## Launch

Run commands from the repository root with Node.js 24+ and npm. If dependencies are absent, run `npm ci`. Its `prepare` step generates the ignored icon catalog. If only that catalog is missing, run `npm run generate:icons`.

The documented development command is `npm run dev --workspace @openchart/app`. It starts Vite on loopback and prints its URL. Stop that foreground command with Ctrl+C. For scripted verification, use:

```powershell
node scripts/verify-openchart.mjs
```

The helper starts the same `packages/app` entry with Vite on an allocated loopback port. It launches headless Edge on Windows, or Chromium on Linux. Set `OPENCHART_BROWSER` to another installed Chromium executable if needed. It adds no dependencies.

Each run owns its browser profile, Vite cache, ports, and download directory. The browser opens `/`, where the home page appears before the editor. No authentication or seed service is required. Templates and the bundled example provide disposable data. Do not attach to the user's browser or desktop app.

Readiness requires the visible home-page New diagram control and a successful doctor check. The helper runs that check before any feature actions. Its default viewport is 1440 by 1000 pixels. For a layout change, also drive the affected interaction at the relevant smaller viewport with `app.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false })`.

## Doctor

Call `await app.doctor()` whenever the page or controls behave unexpectedly. This read-only check requires the owned server and browser to be running, the HTTP entry to load `/src/main.tsx`, the page URL to match, and the OpenChart home control to exist. It returns the root, URL, process IDs, page title, and browser version.

The initial result is saved in `doctor.json`. `instance.json` records the checkout revision, working-tree status, process IDs, and scratch path. Check those before investigating a stale build. Browser mode has no auth check. Do not read the desktop MCP discovery token to diagnose a browser run.

## Drive

Use the exported `withApp(feature, drive)` for a mapped recipe. It owns launch, doctor, evidence, and teardown. Run this PowerShell pattern from the root, replacing the callback with the relevant recipe:

```powershell
@'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { withApp } from './scripts/verify-openchart.mjs';
await withApp('shapes.palette', async (app) => {
	await app.click('button', 'New diagram');
	await app.click('[data-shape-entry="flowchart.process"]');
	const document = JSON.parse(await readFile(await app.save('inserted'), 'utf8'));
	assert.equal(Object.keys(document.nodes).length, 1);
	await app.capture('inserted');
});
'@ | node --input-type=module
```

Keep assertions inside the callback so `result.json` reports failures. Feature IDs name the entry point actually exercised. A successful callback alone does not prove a feature unless it asserts the expected result.

Use DOM reads, accessibility snapshots, screenshots, and downloaded files to observe state. Use the helper's mouse and keyboard actions to change it. Do not use React state, `OperationEngine`, `window.__editorSmoke`, or a benchmark page to prepare or prove this workflow. The existing `npm run test:editor` remains useful for its instrumented gesture checks.

## Evidence

The helper prints a unique directory under `.openchart-acceptance/verify-openchart/run-*`. This directory is already ignored by Git. It contains:

- `instance.json` and `doctor.json` identify the app and checkout.
- `actions.ndjson` records actions in order, with the feature ID and exact controls.
- Named PNG screenshots and matching `.aria.json` accessibility snapshots capture visible results.
- Named download directories retain actual saved JSON or exported files.
- `result.json` records assertion success or failure. `cleanup.json` records teardown results.

Capture the control before an action and the result afterward. Inspect the PNGs. Canvas shapes are not individual DOM elements, so an accessibility tree alone cannot prove their appearance. Pair screenshots with actual downloaded document values, connector endpoints, or exported content as appropriate. For persistence, reopen the saved file through Open and save it again for comparison. A save notification does not prove the file contents.

For CLI checks, retain the command, stdout, stderr, exit code, and output artifact. Use fresh output paths because CLI export refuses overwrite. For mutations, inspect the resulting file and journal. Mock only an external service at its existing production boundary. If a check uses a dry-run or test mode, inspect its actual file and network effects before describing it as harmless.

Report which entry points ran, which were skipped, the reason for any skip, and the evidence directory. Browser downloads do not prove native Save dialogs, desktop persistence, or live MCP behavior.

## Cleanup

`withApp` cleans up in `finally`, including after failed assertions. It closes the browser through CDP, falls back to the PID it spawned, closes its Vite server, and removes its temporary browser profile and cache. It checks that the temporary path belongs to this run before deletion. Evidence stays outside that path.

After the process exits, read `cleanup.json` and confirm the named screenshots and downloads still exist. If the runner was forcibly terminated, inspect `instance.json` and the current command lines for its PIDs before stopping anything. Stop only processes whose command lines match this run's scratch profile or runner. Remove only that recorded scratch directory after checking its resolved location. Never kill processes by name or clean the evidence directory as teardown.

## Helpers

The helper is [scripts/verify-openchart.mjs](../../../scripts/verify-openchart.mjs). It runs directly with Node or through the import shown above.

| Call | Behavior |
| --- | --- |
| `app.click(selector, text)` | Clicks exactly one visible, enabled, uncovered CSS match. Optional `text` matches its trimmed text exactly. |
| `app.fill(selector, text)` | Clicks an input, selects its text, and types. Commit blur-based fields with Tab or Enter as the recipe specifies. |
| `app.focus(selector)` | Focuses a DOM control through CDP. Focus `.oc-canvas-overlay` before editor shortcuts to preserve selection without clicking a shape. |
| `app.key(key, modifiers)` | Sends a key. Modifier bits are Alt `1`, Control `2`, Shift `8`. Control+Alt is `3`. |
| `app.wait(expression)` | Polls a read-only page expression for up to 30 seconds. Wait for resulting UI state after asynchronous actions. |
| `app.evaluate(expression)` | Reads DOM or browser-visible state. Do not use it to mutate app state. |
| `app.save(name)` | Presses Control+S and returns the completed `.openchart.json` download path. |
| `app.download(name, action, extension)` | Sets a fresh download directory, runs the user action, and returns its completed file path. |
| `app.upload(selector, path)` | Supplies a local file to the app's real file input after opening the picker through the UI. |
| `app.capture(name)` | Saves a PNG and accessibility tree with this name. |
| `app.send(method, params)` | Sends and records a CDP command for viewport changes or pointer gestures. |

Use distinct simple names for captures and downloads within a run. Keep them inside the evidence directory. `app.evidence` exposes that directory for custom assertions and reports.

For shared gesture behavior, reuse `npm run test:editor`. For CLI changes, reuse `npm run test:integration`. For desktop changes, use the native commands in [CONTRIBUTING.md](../../../CONTRIBUTING.md) and inspect the actual Windows app. Run broader checks when the changed contracts require them.

Use `/maintain-verification-skill` to update this map as the app changes.
