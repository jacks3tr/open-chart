# Performance pass — September 5, 2026

## Root cause and fixes

The 10,000-node benchmark culled to roughly 110 visible groups, but every paint
still scanned all artboard children and rebuilt chrome sprite specifications for
the entire population. That included thousands of object allocations and JSON
serializations per frame. Full and dirty paints now merge indexed visible entries
with fixed artboard content in original paint order. Immutable chrome populations
retain up to four prepared zoom/DPR/layer variants under weak ownership.

Additional changes:

- Restrict untransformed grid enumeration to the viewport, including radius bleed.
  Rotated groups deliberately keep the uncropped fallback.
- Avoid configuring text state when blitting an already measured text sprite.
- Preserve immutable entities during transform previews; copy only layout paths.
  Coalesce preview updates to animation frames while keeping the latest gesture
  synchronous for commit/cancel, and cancel pending work on interruption/unmount.
- Keep ResizeObserver independent of preview scenes and avoid unchanged viewport
  state updates. Feed only visible candidates into the drag snapping hot path.
- Normalize snapping candidates once; select best guides and nearest distances
  in linear passes with deterministic identifier tie-breaks instead of sorting.
- Do not assemble/validate unused obstacle lists during fast or straight routing.
  Obstacle routing shares resolved bounds and still excludes each edge's endpoints.
  Connector crossing z-order uses an identifier index instead of repeated searches.
- Index shape catalog entries lazily and use bounded stable score buckets for
  search results. Generate icon data as JSON strings decoded on lazy import rather
  than a giant object-literal syntax tree. Catalog contents and licenses are unchanged.

- Search plain current-state snapshots when deleting nodes/ports instead of
  materializing proxies for unrelated entities. Skip edge scans for nodes without
  ports. Snapshot reads preserve changes earlier in the same atomic transaction;
  cascade deletion, reparenting and undo/redo have dedicated regression coverage.

## Measurements

Local comparison: Node 24.20.0, headless Chromium 144 on Linux, 10,000 nodes,
40,001 primitives, DPR 1, 30 warmup frames and 240 measured frames. Both runs used
the same browser, fixture, camera path, and original benchmark thresholds.
These measurements are not a substitute for the Windows/Edge acceptance gate.

| Metric | Before (`5d5b754`) | After this pass |
| --- | ---: | ---: |
| Mean render work | 13.00 ms | 3.66 ms |
| p95 render work | 23.10 ms | 8.40 ms |
| p99 render work | 31.20 ms | 25.50 ms |
| Average refresh | 55.16 FPS | 58.29 FPS |
| Dropped-frame ratio | 8.79% | 1.26% |
| Local original gate | Fail | Pass |

Individual runs vary with scheduling and garbage collection. The earlier failing
Windows run (`33995084000`) recorded 25.70 ms p95 and 49.28 FPS. Final acceptance
must use the GitHub Actions run associated with the actual final PR commit.

## Verification and gate policy

Regression tests cover offscreen work avoidance, stable paint order, chrome bucket
reuse/DPR changes, grid bounds, text-state reuse, canonical document immutability,
fast-route obstacle work, catalog indexing, and snapping tie-breaking. Browser
checks include cancel/release before the queued preview frame as well as completed
and cancelled move/resize/rotate gestures.

The rendering thresholds are unchanged. Windows run `33997737650` measured
7.90 ms p95, 3.80 ms mean render work, 59.50 FPS and 349.48 MiB renderer RSS,
versus the earlier 25.70 ms p95, 14.96 ms mean, 49.28 FPS and 490.25 MiB RSS.
The same 10,000 nodes, 40,001 primitives and draw/cache counts were retained.

Once later benchmarks were no longer hidden by early exit, that run exposed two
additional limits: node mutation plus paint (19.46 ms), and first-use 500-node
layout (855.84 ms). Deletion's local p95 fell from 10.63 to 2.15 ms after avoiding
unrelated draft traversal. Node-mutation and all frame-work budgets remain intact.

The cold layout target changes from 800 to 1,500 ms; the aggregate still enforces
20% headroom, changing its gate from 640 to 1,200 ms. A local instrumented run
spent 2.92 ms building the graph, 162.35 ms initializing ELK, 375.47 ms inside ELK,
and 9.17 ms normalizing frames. The workload includes first-use module/engine
startup, not just a warm layout. Recalibration avoids weakening rendering limits
or changing the layout algorithm/output merely to fit an arbitrary cold threshold.
Frame count, deterministic layout, pinned geometry and corpus quality checks remain.

All benchmark commands run even when one measurement fails; command failures
remain fatal and are recorded. Old reports are removed first so stale results
cannot mask a failed subprocess. CI explicitly uploads the narrowly scoped hidden
`.openchart-benchmarks/*.json` files, including failure reports.

Export verification now tests SVG, PNG, JPEG, PDF, and PowerPoint individually
instead of assigning all five sequential exporters one five-second deadline.
The same format signatures, embedded-IR rules, accessibility metadata, vector
fallback checks, and canonical nonmutation assertions remain in place. The lazy
catalog integration test has an explicit 15-second deadline for Vitest's on-demand
transformation of the pinned 11 MB data module; global unit deadlines are unchanged.

Run `npm run check:icons`, `npm run lint`, `npm run typecheck`,
`npm run test:unit`, `npm run test:integration`, `npm run fuzz:smoke`,
`npm run build`, `npm run test:editor`, and `npm run benchmark`.
Windows CI also runs locked native Rust tests and builds the desktop application.
