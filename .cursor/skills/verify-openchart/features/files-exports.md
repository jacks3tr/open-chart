# Files and exports

Open and save editable OpenChart JSON, import a page, or export the active page. Browser actions download files. The native Windows app uses operating-system dialogs.

## Sub-features

- `files.open-save` opens, renames, saves, and reopens a document.
- `files.import-page` replaces the active page with the first page of another document, with undo.
- `exports.browser` downloads SVG, PNG, JPEG, PDF, PowerPoint, D2, or Mermaid.
- `exports.cli` exports an existing document to a new output path.

## How to get to it (user POV)

- On the home page, choose Open file. In an empty editor, choose Open diagram.
- In the editor, press Control+O or choose Open… in the file dialog.
- Save with the header's save control, Control+S, Control+Shift+S, or Save… in the file dialog.
- Open the file dialog with Export or the rail button titled Open file and export. Use Import page… or choose a format and Download.
- From a terminal, use `npm run openchart -- export` with a source document and fresh output path.

## Driving it with CDP

Preconditions: Use a disposable document. Keep `assert` and `readFile` available in the `withApp` callback. Use unique names for each download.

- Home open. Run `await app.click('button', 'Open file')`, then `await app.upload('.web-home input[type="file"]', 'examples/northstar-integration.openchart.json')`. The editor opens with the source title and content.
- Editor open. From a saved editor state, run `await app.key('o', 2)`, then `await app.upload('[aria-label="Open OpenChart document file"]', sourcePath)`, where `sourcePath` is the actual path returned by `app.save`. Alternatives are Open diagram on the empty canvas or Open… inside `.oc-output-dialog`. Capture the reopened canvas and compare a second saved JSON with the source.
- Rename and save. Run `await app.fill('[aria-label="Document title"]', 'Verification export')`, then `await app.key('Enter')`. Use `const sourcePath = await app.save('source')`. Assert the file title. To cover alternate save entries, wrap `app.click('.oc-save-state')`, `app.key('s', 10)`, or `app.click('.oc-output-dialog button', 'Save…')` in `app.download` with extension `.openchart.json`.
- Open export. Run `await app.click('[aria-label="Export"]')`, or `await app.click('[title="Open file and export"]')`. The dialog title is Open, save, import, and export.
- Download SVG. Click `.oc-output-dialog select:has(option[value="svg"])`, press Home, then Enter to select SVG. Assert that select's value is `svg`. Run `const output = await app.download('svg', () => app.click('.oc-output-dialog button', 'Download SVG'), '.svg')`. Read the file and assert it contains `<svg`, actual diagram text such as Meets policy?, and nonempty artwork. Inspect the exported SVG too.
- Other formats. From SVG, one ArrowDown selects PNG, followed by JPEG, PDF, PowerPoint, D2, and Mermaid. Press Enter, verify the select's value, then click the matching Download button through `app.download`. Extensions are `.png`, `.jpg`, `.pdf`, `.pptx`, `.d2`, and `.mmd`. Open the output in a suitable viewer and verify its active-page content. A nonzero file size alone is insufficient.
- Import page. Save the target baseline. Open the file dialog and run `await app.click('.oc-output-dialog button', 'Import page…')`, then `await app.upload('[aria-label="Import OpenChart document page"]', 'examples/northstar-integration.openchart.json')`. Assert the active page now contains the source's first-page content while other pages remain intact. Undo once and compare the saved document with the baseline after normalizing `rev`.

For CLI SVG verification, run this from PowerShell at the repository root:

```powershell
$cliEvidence = New-Item -ItemType Directory -Path (Join-Path '.openchart-acceptance/verify-openchart' ('cli-' + [guid]::NewGuid().ToString())) -Force
$cliSvg = Join-Path $cliEvidence.FullName 'northstar.svg'
('npm run openchart -- export svg examples/northstar-integration.openchart.json "' + $cliSvg + '"') | Set-Content -LiteralPath (Join-Path $cliEvidence.FullName 'command.txt')
npm run openchart -- export svg examples/northstar-integration.openchart.json $cliSvg 1> (Join-Path $cliEvidence.FullName 'stdout.txt') 2> (Join-Path $cliEvidence.FullName 'stderr.txt')
$cliExit = $LASTEXITCODE
$cliExit | Set-Content -LiteralPath (Join-Path $cliEvidence.FullName 'exit-code.txt')
if ($cliExit -ne 0) { throw "CLI export failed: $cliExit" }
if (-not (Select-String -LiteralPath $cliSvg -Pattern '<svg' -Quiet)) { throw 'SVG output is missing' }
```

Inspect the SVG against the included source diagram. Preserve the command, streams, exit code, and SVG. No service or temporary profile remains to clean up after this short-lived CLI command.

## Gotchas

- Browser Save downloads a new file. It does not overwrite the source path or persist the editor across a full page reload.
- Open can ask to discard unsaved changes. Save first. If verifying cancellation, dismiss the actual dialog and assert the original document remains unchanged. Do not globally auto-accept dialogs.
- Import page and Open are different actions. Import replaces only the active page and supports undo. Open replaces the whole editor document.
- Exports use the active page, including content beyond the artboard. PowerPoint contains artwork and a PNG fallback, not individually editable shapes. D2 and Mermaid are projections with reported losses.
- Print opens a separate browser flow and is outside this recipe. Browser downloads do not verify native dialogs or desktop atomic writes.
- CLI export refuses an existing destination. Keep evidence and use a fresh output directory for each run.
