# Editor reliability and performance

## Implemented scope

- Initialize the shared operation engine once per mounted editor.
- Cancel pointer transforms and selection gestures without committing; clear previews on canonical document changes and lost pointer capture.
- Paint background, diagram content, and interaction overlay independently. Reuse byte-bounded raster caches and bound the text-measurement cache.
- Memoize snapping candidates rather than rebuilding their bounds on every pointer event.
- Reuse the layout worker; correlate concurrent replies, cancel requests, reject deadlines/worker failures, and discard stale results after edits or document replacement.
- Bound the live operation journal (default 1,000 events) with monotonic sequence numbers and an explicit truncation signal. Undo/replay history is intentionally separate and unchanged.
- Restore failed persisted mutations using shallow engine checkpoints instead of cloning all transaction payloads. Block document replacement/local history edits while agent mutations are queued or saving.
- Run quality, integration, fuzzing, performance, real-browser editor checks, and Windows native tests/builds as independent CI gates. The aggregate `check` requires every gate.
- Retain the historical roadmap as history rather than presenting superseded gaps as current defects.

## Verification

Behavioral tests reproduced worker lifecycle, journal retention, repeated engine construction, hover repainting, and cancelled-transform failures before production changes. Added checkpoint, cancellation, deadline, failed-save, and bounded-cache coverage.

Run `npm run check`, `npm run test:editor`, `npm run fuzz:smoke`, and `npm run benchmark` on Windows. CI also tests Rust persistence and builds the actual Tauri executable. Browser tests run against the real React editor, not mocked DOM behavior.

Two multi-operation MCP scenarios have explicit 30-second deadlines and connection/rasterization stage diagnostics; ordinary unit-test timeouts remain unchanged.

Merge requires inspection of the final diff and passing gates on the exact PR head. Temporary branch-only bootstrap/verification workflows must not remain in the merged tree.

## Explicit follow-ups, not completion claims

Incremental scene/index updates, spatial-neighborhood snapping, pointer-frame coalescing, full editor decomposition, additional importers, per-range rich text, editable PowerPoint, SDK publication, and signed installers are not implemented by this maintenance change. No measured editor speedup is claimed without a reference-machine comparison.
