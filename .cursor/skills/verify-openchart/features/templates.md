# Templates

Start a diagram from a home-page card or replace the active editor page with a template. Editor replacement is undoable. The home page opens a new editor session.

## Sub-features

- `templates.home` opens a template card, with category filters on the home page.
- `templates.empty-canvas` opens the chooser from Start from template.
- `templates.rail` opens the same chooser from the template rail.
- `templates.file-dialog` opens the chooser from Templates in the file dialog.
- `templates.replace` applies a starter or Blank canvas to the active page. Cancel preserves content, and undo restores the previous page.

## How to get to it (user POV)

- On Diagrams, choose New diagram or a template card. Filter cards with All templates, Process, Architecture, or Data & networks.
- In an empty editor, choose Start from template.
- In any editor, choose the rail button titled Open templates.
- Choose Export or the rail button titled Open file and export, then Templates.

## Driving it with CDP

Preconditions: Use a fresh `withApp` session. The default runner exercises `templates.empty-canvas` end to end.

- Home entry. Run `await app.click('button', 'Process')`, then `await app.click('button.web-template:has(img[alt="Approval flowchart preview"])')`. The editor opens with title Approval flowchart and the matching active page tab.
- Empty-canvas entry. Run `await app.click('button', 'New diagram')`, then `await app.click('button', 'Start from template')`. The dialog titled Choose a starting point appears.
- Rail entry. From the editor, run `await app.click('[title="Open templates"]')`. The same dialog appears.
- File-dialog entry. Run `await app.click('[aria-label="Export"]')`, then `await app.click('.oc-output-dialog button', 'Templates')`. The chooser replaces the file dialog.
- Apply. Wait with `await app.wait('Boolean(document.querySelector("[data-template-id]"))')`, capture the chooser, then run `await app.click('[data-template-id="flowchart"]')`. Wait for the active page tab to read Approval flowchart. `await app.save('template')` must produce 10 nodes and 8 edges, including the node label Meets policy?. Capture the canvas.
- Cancel. Save a baseline, open the chooser, and run `await app.click('[aria-label="Close template chooser"]')`. A second save must equal the baseline.
- Clear. In the chooser, run `await app.click('.oc-blank-template button')`. The empty-canvas controls return. One `await app.click('[title="Undo (Ctrl+Z)"]')` restores the prior page content.
- Undo and redo. After applying a template, use the toolbar buttons titled Undo (Ctrl+Z) and Redo (Ctrl+Y), or `await app.key('z', 2)` and `await app.key('y', 2)`. Compare full downloaded documents after normalizing only `rev`. The default helper includes these assertions.

The chooser IDs are `mes-erp`, `flowchart`, `integration`, `cloud`, `uml-erd`, and `network`. Verify the selected card's rendered content and resulting file when a particular template changes.

## Gotchas

- The home cards and editor chooser have different selectors and session behavior. A home-card proof does not cover editor replacement or undo.
- Starter and blank operations replace the active page. Use only disposable documents. Other pages must retain their content.
- A locked active layer prevents starter application. Any locked page layer prevents Blank canvas.
- Chooser content loads asynchronously. Wait for the requested `data-template-id` before clicking it.
- Returning home keeps the current editor mounted. Starting another diagram asks for confirmation. Save the disposable document before accepting that prompt.
