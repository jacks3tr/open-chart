# Contributing to OpenChart

Small, focused changes are easiest to review. Bug reports, documentation fixes,
and improvements to the local diagram workflow are welcome.

## Get started

1. Fork the repository and create a branch from `main`.
2. Follow the [README setup](README.md#try-it-locally). Use Node.js 24+ and npm.
3. Run `npm ci`, then `npm run dev --workspace @openchart/app`.
4. For desktop changes, install the linked Tauri prerequisites and use
   `npm run desktop:dev`.

Open an issue before starting a substantial feature or architecture change so
its scope can be discussed. For bugs, include the commit/version, Windows
version, reproduction steps, expected behavior, and actual behavior. Use a small,
synthetic diagram instead of production or customer data.

## Development conventions

- Keep diagram changes in the shared operation engine. GUI and agent paths must
  agree on validation, persistence, and undo behavior.
- Keep browser APIs in the UI/rendering boundary; core packages must remain
  usable from the CLI. ESLint enforces these boundaries.
- Add focused regression coverage when existing tests do not cover changed behavior.
- Use the existing TypeScript, React, Rust, and npm workspace structure.
- Update documentation when commands or visible behavior change.
- Commit source, required fixtures, configuration, and dependency lockfiles together.
  Exclude generated builds, caches, local agent notes, and benchmark output.

`npm ci` generates the icon catalog through the `prepare` script. If you change
its generator, run `npm run generate:icons` and `npm run check:icons`. The generated
JavaScript is ignored; its handwritten declaration file is tracked.

The brand mark is `packages/app/public/openchart.svg`. After changing it, regenerate
desktop icons with `npx tauri icon packages/app/public/openchart.svg --output apps/desktop/src-tauri/icons`.
Shared fonts and their upstream license live in `packages/scene/fonts`.

## Verify your change

Run relevant existing tests while developing. Before opening a pull request:

```powershell
npm run check
npm run build
```

Use these additional checks when the affected behavior requires them; CI runs
all gates on Windows:

```powershell
npm run test:editor
npm run fuzz:smoke
npm run benchmark
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
npm run desktop:build
```

Browser checks use Microsoft Edge. Set `OPENCHART_BROWSER` to an alternate local
Chromium-based browser executable if needed. Performance results depend on the
machine; report the environment and failures rather than lowering a threshold
to make a change pass. Reports go to ignored local artifact directories.

## Submit a pull request

Explain the problem, resulting behavior, and verification. Include a screenshot
for visible UI changes and list checks you could not run. Keep unrelated refactors
separate. Maintainers may request changes before merging.

Check `git diff --cached` before committing. Remove credentials, private URLs,
personal filesystem paths, and customer data from code, screenshots, and logs.
Git records an author name and email on each commit; configure GitHub's noreply
email if you do not want a personal email published.

Contributions are provided under the project's [MIT license](LICENSE).
Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). For vulnerabilities,
follow [SECURITY.md](SECURITY.md) instead of posting details publicly.
