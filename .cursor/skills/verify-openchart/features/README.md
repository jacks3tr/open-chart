# OpenChart verification map

Read the matching recipe before driving the app. These five entries cover common editor workflows. The primary proof uses the browser development version of the Windows editor.

## Baseline preconditions

- Run from the checkout root with Node.js 24+, installed npm dependencies, the generated icon catalog, and Edge or Chromium.
- Use `withApp` from [the skill](../SKILL.md). Every call starts at the normal home page with a fresh browser profile and an allocated port.
- Click New diagram when a recipe needs a blank editor. Use templates or the included `examples/northstar-integration.openchart.json` when it needs content.
- Read `doctor.json` before driving. Never reuse another run's browser, port, or scratch state.
- Browser documents live in memory until downloaded. Editor preferences use `openchart.preferences.v1` in local storage. A fresh profile isolates both.

## Recipes

| Feature | Entry points and behavior |
| --- | --- |
| [Templates](templates.md) | Home cards, empty canvas, template rail, and the file dialog. Template replacement, cancellation, and undo. |
| [Shapes and catalog](shapes.md) | Palette, quick insert, full catalog, favorites, and recent shapes. |
| [Pages and layers](pages-layers.md) | Page tabs, page settings, and the Layers panel. |
| [Beauty Pass](beauty-pass.md) | Toolbar and shortcut, page or selection scope, preview, cancel, apply, and undo. |
| [Files and exports](files-exports.md) | Open, Save, Import page, browser downloads, and CLI export. |

## Driving conventions

Use `app` from a `withApp` callback. Recipes use `assert` from `node:assert/strict` and `readFile` from `node:fs/promises` where needed. Start each independent recipe from its baseline. Use `app.click('button', 'Exact text')` or an existing ARIA label, title, or data attribute.

Before an editor shortcut, run `await app.focus('.oc-canvas-overlay')` unless the recipe needs focus in a text input. Buttons suppress shortcuts without Control or Alt, and text inputs suppress many editor commands.

For native selects, click the select and use Home, ArrowDown, and Enter to choose its displayed option. Verify its value afterward. For canvas gestures, measure the current canvas and shape location before sending `Input.dispatchMouseEvent`. Do not copy screen coordinates between runs.

## Proof and coverage

Capture the entry control and resulting screen, then assert the downloaded document or export when the action changes content. Include the feature ID and entry point in `withApp`, such as `templates.empty-canvas`. A screenshot without the action record is incomplete evidence.

`node scripts/verify-openchart.mjs` proves the empty-canvas approval template, toolbar undo and redo, Control+S, and Control+O reopening. It does not exercise every entry in this map. After changes, drive each affected entry point rather than treating another route to the same screen as proof.

This initial map does not cover connector gestures, grouping, all formatting controls, links, find, print dialogs, native window behavior, or MCP end to end. Reuse existing focused tests for those areas and add a recipe when the task needs one. Desktop file dialogs and the authenticated live MCP host require a separately owned desktop instance. Do not publish `%LOCALAPPDATA%/OpenChart/mcp.json`, which contains a credential.
