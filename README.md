# OpenChart

OpenChart is a Windows-only local diagram editor for integration diagrams,
architecture diagrams, and system-connectivity maps. A human in the GUI and an
agent over MCP or CLI edit the same document through one intermediate
representation and one operation engine.

There are no accounts, no cloud sync, and no collaboration service. Diagrams
are files on disk.

## What it does

- Native Windows app with Open, Save, and Save As
- Canonical JSON documents with atomic, undoable operations
- Shape libraries, connectors, pages, layers, and text styling
- Deterministic layout and a one-transaction Beauty Pass
- MCP and CLI over the same document the editor shows
- Export to SVG, PNG, JPEG, PDF, and PowerPoint

## Requirements

- Windows
- Node.js 24 or later
- A Rust toolchain if you are building the desktop app

## Setup

```powershell
git clone https://github.com/jacks3tr/open-chart.git
cd open-chart
npm ci
npm run check
```

Run the editor in the browser:

```powershell
npm run dev --workspace @openchart/app
```

Run the native Windows app:

```powershell
npm run desktop:dev
```

Build the local executable:

```powershell
npm run desktop:build
```

The release binary is
`apps/desktop/src-tauri/target/release/openchart-desktop.exe`.

Apply operations or serve MCP from the CLI:

```powershell
npm run openchart -- apply .\ops.json .\diagram.openchart.json
npm run openchart -- mcp --stdio .\diagram.openchart.json
```

`ops.json` is one operation envelope. A successful apply writes the journal,
then replaces the document atomically. Failures print structured JSON to
stderr and leave the file unchanged.

The native MCP host writes `%LOCALAPPDATA%\OpenChart\mcp.json` with the
loopback port and a bearer token. That file stays on the current Windows
user account.

## Architecture

The document is data. The canvas is a view. The agent is a peer author.

Every mutation goes through the operation engine. The GUI, MCP server, and
CLI are projections of the same IR. See
[docs/OPENCHART_PLAN.md](docs/OPENCHART_PLAN.md) for the full design and
[docs/PHASE_9_PLAN.md](docs/PHASE_9_PLAN.md) for the current product-depth
work.

## License

MIT. See [LICENSE](LICENSE).
