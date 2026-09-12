# Beauty Pass

Preview layout and styling changes for the active page or selected shapes. Cancel keeps the document unchanged. Applying the preview creates one undoable edit.

## Sub-features

- `beauty.toolbar` opens a preview from the Beauty Pass button.
- `beauty.shortcut` opens it with Control+Alt+B.
- `beauty.scope` switches between Entire page and Selected shapes.
- `beauty.compare-cancel` compares Before and After, then cancels without changing the document.
- `beauty.apply-undo` applies a nonempty plan and restores the original with one undo.

## How to get to it (user POV)

- Click Beauty Pass in the formatting bar or press Control+Alt+B.
- In the dialog, choose Entire page or Selected shapes, then Before or After.
- Choose Cancel, Refresh preview, or Apply changes.

## Driving it with CDP

Preconditions: Open New diagram, then use Open templates and `[data-template-id="flowchart"]`. Save a baseline with `await app.save('before')`. Deselect with Escape for page scope. For selection scope, insert a Process shape and leave it selected.

- Toolbar. Run `await app.click('[title="Beauty Pass (Ctrl+Alt+B)"]')`. Wait until the Compare Beauty Pass controls appear and `.oc-beauty-loading` is absent. Capture the preview.
- Shortcut. In a fresh equivalent state, run `await app.key('b', 3)`. The same dialog must appear.
- Compare. Run `await app.click('.oc-beauty-comparison button', 'Before')` and capture. Run `await app.click('.oc-beauty-comparison button', 'After')` and capture again. Check the preview artwork, including connector routes and labels.
- Scope. Run `await app.click('[aria-label="Beauty Pass scope"] button', 'Entire page')`, or `await app.click('[aria-label="Beauty Pass scope"] button', 'Selected shapes (1)')` when exactly one shape is selected. Wait for recomputation before comparing or applying.
- Cancel. Run `await app.click('[aria-label="Cancel Beauty Pass"]')`. Save to a different name. Assert the complete JSON equals the baseline, including `rev`.
- Refresh. With the dialog open, run `await app.click('.oc-beauty-dialog button', 'Refresh preview')`. Wait for the preview to finish and inspect any error message before applying.
- Apply. Require Apply changes to be enabled. Run `await app.click('.oc-beauty-dialog button', 'Apply changes')`. The dialog closes. Capture and save the result. Assert the expected layout or style change and confirm that objects outside a selection pass retain their content and positions.
- Undo. Run `await app.click('[title="Undo (Ctrl+Z)"]')` once. Save again and compare the complete document with the baseline after normalizing only `rev`. Inspect the restored canvas.

## Gotchas

- An empty page disables Beauty Pass. An already tidy diagram can produce zero operations and disable Apply changes. That result proves the preview, not an apply-and-undo path.
- Selection scope requires selected shapes. Connector-only selections do not enable it.
- Manually positioned shapes stay in place. Templates and palette insertions are pinned, so they can exercise styling while preserving position. A layout-motion check needs a document with unpinned shapes.
- Preview work is asynchronous. Do not click Apply until it is enabled. If a changed document invalidates the preview, capture the error and regenerate it.
- UI cancel and saved-document equality must both pass. A closed dialog alone does not prove cancellation.
