# Shapes and catalog

Insert diagram shapes or icons through the palette, quick insert, or full catalog. Favorites and recent shapes provide additional insertion entry points.

## Sub-features

- `shapes.palette` inserts a shape from a library preview.
- `shapes.quick-insert` searches and inserts a result by clicking it or pressing Enter.
- `shapes.catalog` searches the full catalog and inserts a result.
- `shapes.favorites` adds or removes a favorite and inserts it from the palette.
- `shapes.recent` inserts a recently used shape again.

## How to get to it (user POV)

- Click a preview under Flowchart, or expand a library with its Browse button.
- Use Quick insert shapes and icons, Control+Space, or Add your first shape on an empty canvas.
- Open the full catalog with More shapes, Manage shape libraries (M), the M shortcut, or Browse full catalog after a quick search.
- In the catalog, use Add Process to favorites. Favorites and Recent appear in the left palette after use.

## Driving it with CDP

Preconditions: Click New diagram in a fresh session. Run each insertion route independently or record the starting node count first.

- Palette. Run `await app.click('[data-shape-entry="flowchart.process"]')`. A process shape appears and becomes selected. Save with `await app.save('palette')`, parse the JSON, and assert one node with `data.shape.entryId === 'flowchart.process'`. Capture the canvas.
- Quick insert. Run `await app.fill('[aria-label="Quick insert shapes and icons"]', 'Process')`. Wait for `[title="Insert Process"]` and capture the result list. Click it with `await app.click('[title="Insert Process"]')`. The search clears and the new shape appears.
- Keyboard entry. Run `await app.key(' ', 2)` for Control+Space. Type with `await app.fill('[aria-label="Quick insert shapes and icons"]', 'Process')`. Record the first visible result before `await app.key('Enter')`. The saved node must match that result.
- Empty-canvas entry. Run `await app.click('button', 'Add your first shape')`. Assert `document.activeElement.getAttribute('aria-label')` is Quick insert shapes and icons, then use the same search recipe.
- Catalog entry. Run `await app.click('button', 'More shapes')`, or `await app.click('[title="Manage shape libraries (M)"]')`, or `await app.key('m')`. The Shape catalog dialog appears. After a quick search, `await app.click('.oc-rail-browse-all')` reaches the same dialog with the query carried over.
- Catalog insertion. Run `await app.fill('[aria-label="Search shape catalog"]', 'Process')`, then `await app.click('.oc-library-manager [aria-label="Add Process"]')`. The catalog closes automatically. Save and check the added shape.
- Favorite. In the catalog, run `await app.click('[aria-label="Add Process to favorites"]')`. Its accessible name becomes Remove Process from favorites. Close the catalog and run `await app.click('[aria-label="Add favorite Process"]')`. A second Process node must appear in the downloaded document. Reopen the catalog and use Remove Process from favorites to check removal.
- Recent. After inserting Process and returning to the palette overview, run `await app.click('[aria-label="Add recent Process"]')`. Confirm that the downloaded document has one additional Process node.

## Gotchas

- Catalog icons load lazily. Wait for the named result instead of asserting an empty list during loading.
- Quick insert Enter chooses the first result. Confirm its name before pressing Enter.
- The search result can retain a category filter. Use a fresh session or choose All libraries before a cross-library search.
- Insertion through a result clears quick search. A category filter can still hide Favorites and Recent. Use All libraries to return to the overview.
- Favorites and Recent persist in browser preferences, not the document. Observe local storage read-only when verifying preference persistence, and save the document before reloading the page.
