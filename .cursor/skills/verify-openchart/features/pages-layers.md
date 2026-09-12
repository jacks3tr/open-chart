# Pages and layers

Organize diagrams into pages and layers. Page tabs choose the active page, while the Layers panel controls names, order, visibility, and locking.

## Sub-features

- `pages.create-switch` creates and navigates pages.
- `pages.settings` renames, colors, reorders, duplicates, or deletes a page.
- `layers.create` adds and renames a layer on the active page.
- `layers.visibility-lock` hides or locks a layer, with state preserved in the saved document.
- `layers.order-delete` reorders or deletes a non-base layer and saves a layer view.

## How to get to it (user POV)

- Use Add page and the page tabs along the bottom. PageDown and PageUp switch pages when focus is outside a text field.
- Open Page settings next to the tabs.
- Open the rail button titled Open layers, or choose Layers in the contextual panel.

## Driving it with CDP

Preconditions: Click New diagram in a fresh session. Add a new page before the layer steps so it has exactly one Base layer.

- Create and switch. Run `await app.click('[title="Add page"]')`. Assert `.oc-page-tabs .is-active` reads Page 2. Save and assert two pages. Focus the canvas with `await app.focus('.oc-canvas-overlay')`. Use `await app.key('PageUp')` then `await app.key('PageDown')` to check both directions. For tabs, run `await app.click('.oc-page-tabs button', 'Page 2')`.
- Rename. Run `await app.click('[title="Page settings"]')`, then `await app.fill('[aria-label="Page settings"] > label input', 'Verification page')` and `await app.key('Tab')`. The active tab changes to Verification page, and the saved page name must match.
- Color. Run `await app.click('[aria-label="Set page color #00A7A5"]')`. Confirm the tab color visually and the saved page's `color` value.
- Background and grid. Fill `[aria-label="Background hex color"]` and press Tab. Verify the page's `backgroundColor` and the canvas color independently of the tab color. Click the Transparent label to set `backgroundColor` to null, then verify undo and a transparent PNG export. Click Grid to toggle the editor grid; this must not change the saved document or exported SVG. Reload and reopen the document to verify the grid preference persists.
- Duplicate. In Page settings, run `await app.click('button', 'Duplicate page')`. The new page must contain copies of the source page's shapes and connectors with distinct IDs. Save before and after for comparison.
- Reorder or delete. Within Page settings, use `await app.click('button', '← Move left')`, `await app.click('button', 'Move right →')`, or `await app.click('button', 'Delete page')`. Assert page order or removal in both tabs and the downloaded file. Delete only pages created by this run, then verify undo restores the page.
- Open layers. Close Page settings with `await app.click('[aria-label="Close page settings"]')` if it is open. Run `await app.click('[title="Open layers"]')`. The panel shows Base on the new page. The alternate panel entry is `await app.click('.oc-inspector-tabs button', 'Layers')` after opening the contextual panel.
- Add and rename. Run `await app.click('[aria-label="Add layer"]')`. Layer 1 appears. Run `await app.fill('[aria-label="Rename Layer 1"]', 'Verification layer')`, then `await app.key('Tab')`. Save and assert the layer belongs to the active page.
- Visibility and lock. Use `await app.click('[aria-label="Hide Verification layer"]')` and `await app.click('[aria-label="Lock Verification layer"]')`. The controls become Show Verification layer and Unlock Verification layer. Save and assert `visible === false` and `locked === true`. Reverse the controls and verify the values return.
- Order and delete. Add another layer. Run `await app.click('[aria-label="Move Verification layer down"]')`, then `await app.click('[aria-label="Move Verification layer up"]')`. Compare the page's `layerIds` order after each move. Run `await app.click('[aria-label="Delete Verification layer"]')` and check the remaining layer map. Capture the panel before and after.
- Save the view. Run `await app.click('button', 'Save layer view')`. Download the document and assert each layer on the active page has `defaultVisible` equal to its current `visible` value.

## Gotchas

- The first layer is the base layer. Its lock, delete, and reorder controls are disabled. Use a newly created non-base layer for those checks.
- New layers use the current layer count in their name. The Layer 1 recipe assumes a newly created page with only Base.
- Renaming fields commit on blur. Reading the textbox before Tab does not prove the document changed.
- Hidden or locked layers need a shape assigned to that layer to prove rendering or interaction behavior. The boolean checks alone cover only stored settings.
- Page deletion is disabled when only one page remains. Use the downloaded document to verify copies and deletions, since tab counts alone miss lost shapes or connectors.
