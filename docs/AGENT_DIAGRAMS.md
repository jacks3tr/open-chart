# Create diagrams with code or MCP

OpenChart code is the editable text form of the UI document. It preserves pages,
layers, groups, containers, shapes, ports, styling, labels, connector routing,
and geometry. Both paths use the same document schema and renderer.

## Open a code file

Save this as `diagram.openchart`, or use
[`examples/api-database.openchart`](../examples/api-database.openchart).

```text
openchart 1
document {"title":"API and database"}
node api {"label":"API","kind":"service"}
node database {"label":"Database","kind":"database"}
edge query api -> database {"label":"SQL"}
place api {"x":80,"y":120,"width":200,"height":120}
place database {"x":400,"y":120,"width":200,"height":120}
```

Choose **Open file** on the home page or **Open…** in the editor. Edit the diagram
with the usual controls. Saving an opened `.openchart` file writes code again.
Browser saves download a new file; native saves update the opened file.
Comments and formatting are regenerated when you save, while document values
remain intact. The separate **Import page…** action retains its existing JSON
page-import behavior.

To convert between code and JSON from the repository root:

```powershell
npm run openchart -- import ./diagram.openchart ./diagram.openchart.json
npm run openchart -- export openchart ./diagram.openchart.json ./roundtrip.openchart
```

These commands require new output paths and refuse to overwrite files.
OpenChart code covers the whole document. Mermaid and D2 remain separate text
projections that cannot preserve all OpenChart properties.

## Connect an agent

Create a blank file, then start the existing MCP server against it:

```powershell
npm run openchart -- create ./diagram.openchart.json
npm run --silent openchart -- mcp --stdio ./diagram.openchart.json
```

For an MCP client's configuration, use absolute paths. Replace `F:/OpenChart`
and `F:/Diagrams/diagram.openchart.json` with your checkout and document paths:

```json
{
  "mcpServers": {
    "openchart": {
      "command": "node",
      "args": [
        "--import",
        "file:///F:/OpenChart/node_modules/tsx/dist/loader.mjs",
        "F:/OpenChart/packages/agent/src/cli.ts",
        "mcp",
        "--stdio",
        "F:/Diagrams/diagram.openchart.json"
      ]
    }
  }
}
```

Use Node.js 24 or later and install this checkout's dependencies with `npm ci`
first. The direct Node command works independently of the client's working
directory. Encode spaces as `%20` in the loader's `file:///` URL. If you launch
through npm instead, include `--silent` because
[MCP reserves stdout for protocol messages](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).
The transports support current MCP clients and the SDK's 2025 protocol fallback.

To edit the document currently open in the native Windows app, connect to its
authenticated loopback MCP endpoint. Read the URL and bearer token locally from
`%LOCALAPPDATA%/OpenChart/mcp.json`. Use that live endpoint when a person and an
agent edit together. The stdio server owns a separate file session, so changes
there require reopening the file in the UI.

## Build or edit through MCP

1. Call `get_code_format` to read the syntax, example, and document schema.
2. Call `get_document_info` for the current `rev`.
3. For an existing diagram, call `export` with `{"format":"openchart"}` and edit
   the returned code. Keep its IDs, UIDs, and properties to retain existing detail.
4. Call `apply_code` with `source`, `baseRev`, and a unique `txId`. It previews by
   default. Check the result, then repeat with `dryRun:false` to persist.
5. Call `get_screenshot` to inspect the diagram, or `export` to read its code.

For example, the mutation arguments have this form:

```json
{
  "source": "openchart 1\nnode api {\"label\":\"API\"}\nnode database {\"kind\":\"database\"}\nedge query api -> database",
  "baseRev": 0,
  "txId": "tx.create-diagram",
  "idempotencyKey": "create-diagram",
  "dryRun": false
}
```

`apply_code` replaces the complete content in one undoable transaction. It
retains the open document's ID, UID, and creation timestamp. A commit updates its
revision and modification timestamp. Stale revisions, malformed code, invalid
references, and disabled mutations fail without saving. Repeating a committed
idempotency key with identical input returns the original result.

For incremental edits, use `apply_operations`. Its schema exposes the same
operations used by the editor, including node and edge creation, labels, styles,
layout, pages, layers, groups, and containers. `replace_document_content` accepts
the complete content as structured data, including custom styles. Use
`apply_layout`, `apply_beauty_pass`, and `set_tokens` for the shared layout and
styling commands. `undo` and `redo` also persist through the file session.

The server retains its existing limit on transactions that delete more than
25 entities. Code replacement counts removed entities too. Start a new blank
document for a separate diagram rather than replacing an unrelated large one.
Code inputs and MCP text exports have a 1 MiB limit. Omit `pageId` when exporting
OpenChart code.

## Code syntax

Each statement occupies one line. Property objects use JSON, including escaped
newlines in labels. Blank lines and whole-line `#` or `//` comments are allowed.
IDs use lowercase letters, digits, hyphens, and dots, such as `service.api`.

| Statement | Properties |
| --- | --- |
| `document {...}` | Document metadata and optional theme. Export sets `defaults:false` to preserve empty sections. |
| `page ID {...}` | Page name, layer IDs, tab color, background color, and order. `backgroundColor:null` makes the page transparent. |
| `layer ID {...}` | Page, name, visibility, saved visibility, and locking. |
| `style ID {...}` | Style role and tokens. |
| `node ID {...}` | Label, kind, page, layer, style, parent, group/container settings, and data. |
| `port ID {...}` | Owning node, direction, side, and order. |
| `edge ID FROM -> TO {...}` | Label, semantic, page, layer, style, routing, and data. |
| `place NODE_ID {...}` | Position, size, rotation, stacking order, and pinning. |
| `route EDGE_ID {...}` | Waypoints and connector-label placement. |
| `layout {...}` | Layout engine, options, derived frames, and derived version. |

Property names and values match the JSON document schema returned by
`get_code_format`. Entity IDs and edge endpoints appear in the statement itself.
Exports include UIDs; short authored files can omit them for deterministic IDs.
Omitted metadata uses revision zero and an epoch timestamp until the first edit.

If a page, layer, or style section is absent, the parser supplies a default
unless `document` has `defaults:false`. Nodes default to `service`; edges default
to `flow`. Labels default to the entity ID. Nodes and edges default to the first
page and its first layer. Use explicit `pageId`, `layerId`, and `styleId` when a
document has several of them.

An edge endpoint can name an explicit port or a node. A node endpoint uses a
port called `NODE_ID.connection` with automatic placement and both directions.
Explicit ports take precedence. Use the exported port statements to preserve
the precise connections made in the UI.

Geometry uses the editor's units. `place` preserves exact values without running
layout. Unplaced nodes use the editor's grid fallback. Styling and shape-library
references live in the same `data` properties as UI-created shapes; exporting
an existing shape provides a complete example.
