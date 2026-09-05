# Editor reliability and performance implementation plan

Goal: repair verified correctness, lifecycle, and avoidable hot-path costs without changing the canonical document/operation architecture.

Scope: regression tests first; lazy editor engine initialization; cancelled gesture rollback; layer-specific painting; worker reuse, deadlines, cancellation and document-switch protection; bounded live-session events and cheaper safe persistence rollback; independent CI gates and Windows native verification.

The wider product roadmap (new importers, editable PowerPoint, rich-text authoring, SDK publication and installers) is not represented as completed by this maintenance PR.

## Execution and acceptance

- [ ] Reproduce worker lifecycle and journal-retention failures using new behavioral tests on Windows CI.
- [ ] Inspect actual editor and operation-engine paths before applying targeted changes.
- [ ] Add cancellation, failure-recovery and stale-document regression cases alongside their fixes.
- [ ] Preserve revision checks, transaction replay, undo/redo and rollback after failed persistence.
- [ ] Separate fast checks, integration tests, fuzzing, benchmarks and Windows native validation; retain failures as failures.
- [ ] Review the final diff and run all checks on the exact PR head before merging.

Temporary branch-only verification/patch machinery must be removed before the PR is ready. No changes to main or branch protection are permitted during verification.
