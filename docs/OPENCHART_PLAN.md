# OpenChart — Build Plan

**A local, single-user, AAA-quality diagram editor for integration, architecture, and system-connectivity diagrams — where every diagram is equally editable by a human in the GUI and by an AI agent through a machine-facing IR twin.**

Version 1.0 · 29 August 2026 · Status: design-complete, ready to build

---

## Accepted execution decisions · 30 August 2026

These decisions supersede any conflicting exploratory wording later in this
document:

1. The product and repository are named **OpenChart**. The CLI is `openchart`.
2. OpenChart is a **Windows-only** product. Cross-platform packaging and
   platform compatibility work are outside the objective.
3. Product code lives in this OpenChart repository.
4. Rust is a thin Tauri host for the Windows window, loopback listener,
   authentication, and filesystem access. A TypeScript `DocumentSession` owns
   semantic state and the operation engine; Rust forwards requests through a
   typed request/response IPC boundary and never implements document semantics.
5. Committed transactions are strictly all-or-nothing. `create_*` rejects ID
   collisions, intentional upsert is explicit, and retry safety comes from
   idempotency keys. Partial mutation via `continueOnError` is not supported.
6. Direct `.openchart.json` edits are proposals: validate, calculate a semantic
   diff, and apply that diff as one typed operation transaction after acceptance.
   File watching never bypasses the operation engine.
7. Schema versioning and migrations begin in Phase 0. Backward compatibility is
   promised only from the first tagged public preview.
8. Loopback MCP authentication is required by default.
9. The existing SPEL/Plex/ABRA integration diagrams are the primary real-world
   acceptance reference. OpenChart must preserve their content and editability
   while producing visibly stronger hierarchy, typography, spacing, routing,
   and composition. Basic connectors and initial SVG/PNG proof are pulled into
   the first renderer vertical slice; the complete routing and export surfaces
   remain in their dedicated phases.

---

## 0. Executive summary

**What this is.** A native desktop app (Tauri 2) that clones the *core diagram builder* of Lucidchart — canvas, shapes, connectors, styling, layout, export — and nothing else. No landing page, no accounts, no billing, no realtime collaboration. It runs offline, reads and writes plain files on your disk.

**What makes it different.** The document is not a blob owned by the GUI. It is a **canonical Intermediate Representation (IR)** that lives at the centre, and *every* mutation — a mouse drag, a keyboard shortcut, an MCP tool call from Claude, a CLI batch job — travels through **one op engine** into that IR. The GUI is a projection. The MCP server is a projection. The `.d2` / `.mmd` text files are projections. There is no second code path, no "agent mode," no sync layer bolted on afterwards. This is the architectural spine of the project and everything below is arranged around it.

**The three genres it is tuned for.** Integration diagrams (services, protocols, message flows), architecture diagrams (cloud infrastructure, tiers, boundaries), and system-connectivity maps (network topology, data flows, dependency graphs). Section 9 specifies what each genre needs and how the app delivers it.

**Visual bar.** Not "clean." The target is that a first-time user dragging six boxes onto a canvas and hitting one button produces something that looks like it came out of a Stripe or AWS Solutions Architecture deck. Section 10 is a hard-coded design system plus a **Beauty Pass** — a single deterministic operation (also agent-callable) that converts a correctly-wired but ugly graph into a publication-quality diagram.

**Performance bar.** 10,000 shapes at 60 fps during pan/zoom; 1,000 shapes at 60 fps during drag with *live* connector rerouting; cold open of a 10,000-shape document under 1.5 s. Lucid's own published target is 95% of documents above 30 fps — we target 95% at 60.

---

## 1. Scope boundary — explicit

### 1.1 In scope (the core builder)

| Domain | Included |
|---|---|
| Canvas | Infinite canvas, pages, layers, groups, containers, camera, minimap |
| Shapes | Declarative shape runtime, shape libraries, custom shapes, ports, shape data |
| Connectors | Anchors, orthogonal/curved/straight routing, obstacle avoidance, line jumps, labels, protocol chips |
| Styling | Fills (solid/gradient/image), strokes, shadows, opacity, corner radius, text styling, themes, design tokens |
| Layout | Auto-layout (layered, force, radial, tree), identity-keyed pinning, alignment/distribution |
| Text | Rich text per shape, per-label, connector labels, free text |
| Interaction | Selection, transform, snapping, smart guides, keyboard, undo/redo, clipboard |
| Agent surface | Canonical IR, op engine, MCP server, headless CLI, DSL import/export, screenshot tool |
| Export | SVG, PNG, JPEG, PDF, PPTX, clipboard, print |

### 1.2 Explicitly out of scope — do not build, do not design for

Landing page, marketing site, pricing, signup/login, SSO, accounts, sessions, billing, subscriptions, entitlements, trial gating. Realtime collaboration, presence cursors, comments, @-mentions, sharing links, permissions, revision history as a *service*, team/workspace management, cloud storage, sync, webhooks, notifications, email.

Two consequences worth stating up front:

- **No collaboration means no CRDT is required in v1.** We get undo/redo, an op journal, and time travel from the op engine alone (§6). The journal is designed so a CRDT could be layered on later without rework, but we do not pay for it now.
- **"Revision history" exists only as local time travel** over the append-only journal — no server, no sharing.

---

## 2. Research synthesis — what Lucid actually does

Findings from a structured research pass across Lucid's engineering blog, help centre, developer docs, and patent filings. Marked **[V]** verified from a primary source, **[I]** informed inference.

### 2.1 Rendering: they went to a single canvas, twice **[V]**

Lucid's CTO documented the full evolution ("Big content in a little canvas," 2015):

- **2009** — one `<canvas>` *per object*. Won because canvas operations were slow but browser compositing was fast.
- **2011** — offscreen eviction: drop rendered items far off-screen, re-render on approach. Added because browsers ran out of memory.
- **2014** — per-object canvases broke on *large single objects* (long swimlanes, long connectors). The decisive measurement: *"a majority of our frame times were spent in the browser's own layout, rendering, and composition code."*
- **2015 (Blackbird)** — flattened everything onto a **single canvas** with **dirty-rectangle re-rendering**. Plus a **second full-screen canvas on top for UI hints** (handles, selection, guides), re-rendered *every frame*.

The second canvas exists for a specific reason that matters to us: [V] they first kept the handles as DOM, but DOM and canvas could not be synced — in Firefox and Safari the DOM *"either lead[s] or trail[s] the canvas update by one frame."* **Do not put interactive overlays in DOM.** This is verified, expensive, and directly actionable.

Also [V]: Lucid's scrollbars are entirely emulated in HTML/CSS/JS, because Safari disables JS during native scroll.

**Current state [V]:** WebGL is the primary renderer with a **Canvas2D fallback** (toggle: More → View → Rendering → "Use WebGL"; `lucid.app/diagnostic` reports renderer status). Shapes, connectors, and text are **not DOM nodes**. The layering model is: canvas / shapes–objects–widgets / contextual UI / fixed UI / modal UI, and only the last three are DOM.

### 2.2 Performance: rbush and a 1,000× win **[V]**

- **Spatial index: rbush (R-tree)** — *"increased spatial search performance by a factor of over 1,000."* The query it serves: given a rect that must be redrawn, return the ordered list of items overlapping it. That is simultaneously the dirty-rect enumeration and the hit-test.
- **Text**: they render their own text; the bottleneck was *pre*-rasterization work (parsing, spell-checking, layout, wrapping). Fixing it gave a **10× increase in text processing performance**.
- **Production FPS telemetry**, bucketed at 60/30/10/2 fps. Pre-Blackbird: 25% of documents below 10 fps. Post: 5%. Their targets: 99% ≥ 10 fps, 95% ≥ 30 fps.
- **Soft scale limit [V]:** under **10,000 total objects** for optimal performance. Staff restate it as "aim to stay under 10,000 objects per document." There is no hard cap.
- **A documented performance cliff worth learning from [V]:** conditional formatting. ~190 rules produced 1–3 s per interaction that *accumulated linearly* (30 interactions → 30 s+), 1.7 GB in Chrome, reproducible cross-browser. A rule engine that re-evaluates globally on every mutation will eat you. Ours is incremental and dependency-tracked (§10.6).

Not publicly documented: worker usage, LOD, text-measurement caching, exact zoom clamps, internal serialization format.

### 2.3 Connectors: perimeter anchoring plus user joints, not dynamic obstacle routing **[V]**

This is the most importantfinding for the routing engine, and it is a genuine gap we can beat:

- Four line shapes: **Straight, Curved, Elbow (default), Two-way**. Elbow bends are 90° and snap to the background grid, with an **adjustable corner radius in px**.
- Lines **auto-reroute on move** to maintain the connection — but there is **no documented obstacle-avoiding re-route**.
- **Magnetic connection points** appear red on hover; drop onto a border and hold until it highlights to create a "smart line." Blue directional nodes quick-add a shape plus line.
- **Waypoints**: elbow lines expose a node at each section centre; dragging creates a filled anchor; right-click offers *Remove joint* / *Reset line*.
- Styling: width 0.5–10 px, custom dash patterns (`"5, 5"`), **double** lines, **jump** (per-line), **text pill**, **marker** (labelled circle mid-line). Endpoint markers are per-end with size control.
- **Line jumps** are a *document* setting (Document settings → Lines → Show line jumps), with per-document jump style.

**The gap:** Lucid's model is perimeter anchoring + user-placed joints. For dense integration diagrams, real obstacle-avoiding orthogonal routing is dramatically better looking. We ship both: a deterministic O(1) router as the default and a true libavoid-class router as an opt-in mode (§8).

### 2.4 The shape format is fully documented — copy it **[V]**

`developer.lucid.co` specifies their custom-shape format in detail, and it is an excellent model:

- Libraries ship as **`.lcsz`** packages: `shapelibraries/<name>/{images/, shapes/*.shape, library.manifest}`.
- **`.shape` files are JSON or HJSON** declarative trees: `{locked, images, geometry[], style}`.
- **Geometry primitives**: `rect | ellipse | polygon | path | BooleanOperation`, each with `condition` (formula), `repeat` (`ForRepeat`/`MapRepeat`), `localFill`, `defs`.
- **Sub-shapes** nest arbitrarily, each with `bounds{x,y,w,h, anchor (9 options), absolute, rotation}`. Coordinates are **relative 0–1** unless flagged absolute. Evaluation order is fixed: Conditions → Repeat → Definitions → Bounds → TextAreas → LinkPoints → Geometry → Sub-shapes.
- **Clipping**: `{geometry[], stroke}` — the mask is the boolean intersection of child geometry.
- **Shape data**: typed custom fields (`number|string|color|date|boolean|array|object|formula|picklist`) with defaults and constraints, referenced in formulas as `@PropertyName`.
- **Shape controls**: `{uri:"control", location{x,y}, constraint, onmove:[setPropertyAction]}` — on-canvas drag handles bound to properties.
- `library.manifest` carries per-shape defaults: `width, height, fillColor, strokeColor, strokeWidth, rotation, opacity, aspectRatio, link`.

We adopt this model nearly verbatim (§9). It is proven, declarative, expressible in JSON, and therefore trivially agent-authorable — which matters enormously for our dual-editability requirement.

### 2.5 Containers are geometric, not hierarchical **[V]**

*"Place other shapes within the container's bounding box to nest them inside."* Container properties: **`magnetize`** (children move with container, default true), **`containerTitle`**, **`assistedLayout`** (auto-arrange children into a grid on first open). **All container bounding boxes are incompatible with rotation** — a constraint we should keep, because it removes a huge class of geometry bugs.

### 2.6 Styling and themes **[V]**

- **Fill**: solid, linear gradient, radial gradient, image. (No pattern fill exists in their model.)
- **Border**: colour, style, width.
- **Shadow**: real, with **distance, blur, colour, and angle**.
- **Opacity**, **corner rounding** (px), **text shadow**.
- **Format painter**: single click = one-shot, double click = sticky until Esc.
- **Themes** are *six named styles* — Primary, Secondary, Accent, Highlight, Success, Error — not a token system. Primary/Secondary/Accent auto-map to flowchart shape classes. Manually restyled shapes win over the theme. Default when unset is "Chalk."
- **Conditional formatting** is a real rule engine: IF (shape type / connected-shapes count / text / shape data / shape location / formula) → THEN (shape style, icons, text badge, dynamic shapes), with AND/OR and ELSE chains.
- **Page backgrounds**: grid style **Line or Dot**, size adjustable, snap-to-grid/objects/guides.

We take the six-style theme idea but generalise it into a proper token system (§10), because tokens are what let an agent restyle an entire diagram with one tool call.

### 2.7 Interaction details worth stealing **[V]**

Three specifics that separate an expensive-feeling app from a cheap one:

1. **Align is relative to the object you right-click**, not to the selection bounds.
2. **Guides are dotted when edges align and solid when centrepoints align.** While moving, the object's **X/Y render beneath it** and **distance measurements between objects** appear.
3. **Four-way lock granularity** — Lock / Lock size and position / Lock style / Lock content — each with a distinct affordance (solid red outline, dotted yellow outline, X's in corners).

Plus: Shift = aspect ratio, Alt = resize from centre, Alt+drag = duplicate, Alt+Shift+drag = duplicate constrained to one axis, Ctrl/Cmd+drag = marquee even when starting on top of a shape, Enter/Shift+Enter = enter/exit group, Ctrl+Alt+S = freehand lasso select.

The verified shortcut table is reproduced in §11.5.

### 2.8 What is *not* verifiable, and what we do about it

No public source exists for Lucid's internal serialization, worker usage, LOD, text-measurement caching, zoom clamps, or antialiasing policy. We treat these as our own design decisions and document the reasoning rather than pretending to match.

---

## 3. Product thesis

> **The diagram is data. The canvas is a view. The agent is a peer author.**

Three commitments follow, and every design decision in this document is downstream of one of them.

1. **One source of truth.** The canonical IR holds *semantics only* — nodes, ports, edges, groups, styles. Never geometry. Geometry is derived and disposable.
2. **One mutation path.** The op engine. The GUI does not touch the document; it emits ops. Neither does the MCP server, the CLI, or the DSL importer. Undo, validation, journaling, agent audit, and time travel all come free from this single choke point.
3. **One renderer contract, three consumers.** A resolved `SceneDescription` feeds (a) the Canvas2D painter, (b) the SVG serializer, (c) the rasterizer. On screen and exported are the same picture by construction.

The payoff for the dual-editability requirement is that **there is no "agent support" feature to build and no sync layer to maintain.** An agent editing a diagram over MCP and a human dragging a box are the same event, validated by the same code, journaled in the same stream, undone by the same keystroke.

---

## 4. Architecture

### 4.1 The spine

```
                        ┌──────────────────────────────────────────┐
                        │            CANONICAL IR  (truth)         │
                        │ semantics only · no rendered geometry    │
                        │   nodes · ports · edges · groups · styles │
                        └───────────────────┬──────────────────────┘
                                            │
                        ┌───────────────────▼──────────────────────┐
                        │                 OP ENGINE                │
                        │  validate → apply → derive → notify      │
                        │  invertible · serializable · coalescable │
                        └───┬──────────┬──────────┬──────────┬─────┘
                            │          │          │          │
        ┌───────────────────┘          │          │          └──────────────────┐
        ▼                              ▼          ▼                             ▼
 ┌─────────────┐              ┌────────────┐  ┌──────────────┐          ┌──────────────┐
 │  GUI canvas │              │ MCP server │  │  CLI (headless)│         │ DSL importer │
 │  (emits ops)│              │ (emits ops)│  │  (emits ops)   │         │ (emits ops)  │
 └──────┬──────┘              └─────┬──────┘  └───────┬───────┘          └──────┬───────┘
        │                           │                 │                          │
        └───────────────────────────┴─────────────────┴──────────────────────────┘
                                    │
                     ┌──────────────▼───────────────┐
                     │      DERIVED LAYERS (cache)   │
                     │  layout · routing · textflow  │
                     │  keyed by (irHash, options)   │
                     └──────────────┬────────────────┘
                                    ▼
                     ┌──────────────────────────────┐
                     │       SceneDescription        │
                     └───┬──────────────┬───────┬───┘
                         ▼              ▼       ▼
                  Canvas2D painter   SVG      PNG/PDF
```

### 4.2 Layering inside the app

| Layer | Package | Depends on | DOM? | Runs in a worker? |
|---|---|---|---|---|
| `ir` | Schema, types, validation, ID rules | nothing | no | yes |
| `ops` | Op taxonomy, apply, invert, coalesce, journal | `ir` | no | yes |
| `derive` | Layout, routing, text flow | `ir`, `ops` | no | yes |
| `scene` | Resolved `SceneDescription` | `ir`, `derive` | no | yes |
| `render` | Canvas2D painter | `scene` | **yes** | no |
| `serialize` | SVG / PNG / PDF / PPTX / D2 / Mermaid | `scene` | partial | partial |
| `shapes` | Shape runtime, libraries | `ir` | no | yes |
| `interact` | Selection, transform, snapping, keyboard | `ops`, `render` | yes | no |
| `app` | React chrome, panels, menus | all | yes | no |
| `agent` | MCP server, CLI, DSL | `ops`, `scene`, `serialize` | partial | no |

**Hard rule: everything from `ir` through `serialize` is DOM-free and GUI-free.** That is what lets the MCP server, the CLI, and a CI job use the exact same engine the GUI uses. If a core package ever imports React or touches `document`, the build fails (enforced by a lint rule).

### 4.3 Process model

```
┌─ Tauri main process (Rust, thin host) ─────────────────────┐
│ window · file dialogs · fs · menu · authenticated MCP HTTP  │
└──────────────────────┬─────────────────────────────────────┘
                       │ typed request/response IPC
┌─ WebView (Windows WebView2) ───────────────────────────────┐
│ DocumentSession: canonical IR · op engine · journal bridge  │
│ main thread: app · interact · render                        │
│ worker #1: layout (ELK.js)                                  │
│ worker #2: routing (libavoid WASM)                           │
│ worker #3: derive (text flow, crossing/jump analysis)        │
└─────────────────────────────────────────────────────────────┘
```

Rust owns the loopback socket, host validation, and bearer authentication, then forwards each request over a typed request/response IPC boundary. The TypeScript `DocumentSession` owns live state and dispatches every tool through the same operation engine used by the GUI and CLI. Rust never implements document semantics. The headless CLI instantiates that same TypeScript session without a window.

---

## 5. The canonical IR

### 5.1 Design rules

1. **Semantics only.** No positions, no sizes, no routes, no bounding boxes. Those are derived.
2. **Two identities per entity.** `id` is a mutable, hierarchical, *agent-addressable* semantic path (`aws.vpc.prod.subnet-a.api-gw`). `uid` is an immutable ULID, never surfaced in text projections, used as the diff/merge key. Renaming changes `id` and leaves `uid` alone.
3. **Ports are first-class citizens** with their own ids (`api-gw.out`). This is the single biggest structural gap in Mermaid, JGF, and Cytoscape JSON, and it is non-negotiable for integration diagrams.
4. **Maps, not arrays.** `nodes`, `edges`, `ports`, `styles` are objects keyed by id. Arrays force LCS-based diffing and break agent edits under reordering.
5. **Styles are named and referenced**, never inlined at 400 sites.
6. **Provenance is explicit**: every datum is `authored | inferred | locked`. This is what resolves the manual-override-versus-auto-layout conflict.
7. **Never store derived data.** `layout.derived` is a cache with a version hash; it is validated and discarded if stale.

### 5.2 Schema v1

```jsonc
{
  "$schema": "https://openchart.app/ir/v1.json",
  "irVersion": 1,
  "id": "doc_01J9X",
  "name": "Checkout Service — Integration Map",
  "rev": 87,

  "nodes": {
    "aws.vpc.prod": {
      "uid": "u_9f2a",
      "kind": "group",
      "label": "Production VPC",
      "shape": "aws/vpc",
      "style": "boundary/aws-vpc",
      "children": ["aws.vpc.prod.subnet-pub"],
      "meta": { "provenance": "authored" }
    },
    "aws.vpc.prod.subnet-pub": {
      "uid": "u_3b71",
      "kind": "group",
      "parent": "aws.vpc.prod",
      "label": "Public Subnet A",
      "shape": "aws/subnet",
      "style": "boundary/aws-subnet",
      "children": ["aws.vpc.prod.subnet-pub.api-gw"]
    },
    "aws.vpc.prod.subnet-pub.api-gw": {
      "uid": "u_c410",
      "kind": "node",
      "parent": "aws.vpc.prod.subnet-pub",
      "label": "API Gateway",
      "sublabel": "REST · us-east-1",
      "shape": "aws/api-gateway",
      "style": "service/network",
      "ports": {
        "in":  { "uid": "u_p1", "dir": "in",  "side": "west",  "order": 0 },
        "out": { "uid": "u_p2", "dir": "out", "side": "east",  "order": 0 }
      },
      "data": { "protocol": "HTTPS", "tier": "edge", "owner": "platform" },
      "meta": { "provenance": "authored" }
    }
  },

  "edges": {
    "e_checkout": {
      "uid": "u_e1",
      "kind": "flow",
      "from": "aws.vpc.prod.subnet-pub.api-gw.out",
      "to":   "svc.checkout.in",
      "label": "HTTPS",
      "semantic": "sync-call",
      "style": "flow/sync",
      "routing": { "mode": "orthogonal", "avoid": true },
      "meta": { "provenance": "authored" }
    }
  },

  "styles": {
    "service/network": {
      "fill":   { "type": "tint", "tint": "network", "alpha": 0.12 },
      "stroke": { "token": "stroke", "width": 1 },
      "radius": 8,
      "shadow": "e1",
      "icon":   { "set": "aws", "name": "api-gateway", "size": 32, "composition": "above" },
      "text":   { "role": "node", "color": "text-hi" }
    },
    "flow/sync": { "stroke": { "token": "connector", "width": 1.5, "dash": null }, "arrow": "solid-sm" }
  },

  "tokens": {
    "$ref": "preset/openchart-light",
    "overrides": { "accent": "#2563EB" }
  },

  "layout": {
    "engine": "elk",
    "options": { "elk.direction": "RIGHT", "spacing.nodeNode": 40 },
    "overrides": {
      "aws.vpc.prod.subnet-pub.api-gw": { "x": 320, "y": 180, "pinned": true }
    },
    "derivedVersion": "sha256:8f2c…",
    "derived": { "…": "cached positions, routes, text flow — never read by an agent" }
  },

  "pages": {
    "page_1": { "uid": "u_pg1", "name": "Integration", "root": "aws.vpc.prod", "order": 0 }
  },

  "meta": {
    "created": "2026-08-29T…", "modified": "2026-08-29T…",
    "lastModifiedBy": "agent",
    "legend": { "visible": true, "position": "bottom-right" }
  }
}
```

### 5.3 Identity rules

- `id` grammar: `[a-z0-9-]+(\.[a-z0-9-]+)*`, lowercase, dot-separated, unique among siblings.
- An agent can **guess** an id (`api-gw.out`) — this is the whole point, and it is why UUIDs are wrong as the primary handle.
- `uid` is a ULID: lexicographically sortable, collision-free, immutable.
- **Invariant enforced by the op engine:** `uid` is identity; `id` is address. A `rename_node` op rewrites `id` in place, rewrites all references (including `parent`, `children`, port refs in edges, and layout overrides), and leaves every `uid` untouched.

### 5.4 Provenance and the override problem

Auto-layout versus manual placement is the classic conflict. The resolution, borrowed from Structurizr's layout-merge strategy and improved:

- Layout writes **only** to `layout.derived`.
- Human manual placement writes an entry to `layout.overrides[id]` with `pinned: true` and sets `meta.provenance = "authored"`.
- Re-layout **preserves every pinned node** and re-solves the rest around them.
- A node that was auto-placed and then nudged becomes pinned. A node that was pinned can be released (`unpin`), at which point the next layout is free to move it.
- **Never** store absolute pins in the semantic layer — that is the Graphviz `pos` / D2 `top|left` trap, where a re-layout either silently ignores your pin or fights it.

The same mechanism serves the agent: an agent that emits `{"op":"set_layout","ids":[…],"engine":"elk"}` does not destroy the human's carefully placed nodes, and a human who drags a box does not get it snapped back by the next layout pass.

---

## 6. The op engine

### 6.1 Contract

Every op is a plain JSON object that is:

- **Serializable** — journalable to NDJSON, replayable, diffable.
- **Validatable before apply** — returns structured diagnostics, never throws mid-apply.
- **Invertible** — the inverse is *derived*, not hand-written.
- **Coalescable** — a drag is one op, not four hundred.

```ts
interface Op {
  op: OpKind;                  // discriminated union
  id?: EntityId;               // target address
  [k: string]: unknown;
}

interface OpEnvelope {
  txId: string;                // groups ops into one transaction
  actor: "user" | "agent";
  origin: "gui" | "mcp" | "cli" | "dsl" | "layout" | "beauty";
  baseRev?: number;            // optimistic concurrency
  idempotencyKey?: string;
  ops: Op[];
}
```

### 6.2 Why ops compile to Immer patches

Two candidate designs: (a) ops are primary and undo uses hand-written inverses; (b) patches are primary and ops are sugar.

**We take a hybrid that is neither: ops are the authoring unit, and each op compiles to an Immer recipe whose inverse patches are captured automatically.**

- Agents and the DSL emit **semantic ops** (`connect`, `set_style`, `apply_layout`) — not array-index paths, not raw JSON Patch.
- `applyOp(doc, op)` runs `produce(doc, recipe, (patches, inversePatches) => …)`. Undo is `applyPatches(doc, inversePatches)` — exact, free, and impossible to desync.
- **Hand-written `invert()` functions are rejected** as a design. They are the single largest source of undo bugs in editors of this class; every new op silently needs a correct twin.

This gives human-readable journaling and exact undo from one mechanism — the best of both.

### 6.3 Op taxonomy

**Structural** — `create_node`, `create_group`, `create_edge`, `create_port`, `delete_node`, `delete_edge`, `reparent`, `reorder`, `rename_node`
**Geometric** — `move_node`, `resize_node`, `pin_node`, `unpin_node`, `move_waypoint`, `reset_route`
**Style** — `set_style` (with `ids[]` + `unset[]`), `set_tokens`, `apply_theme`, `copy_style`, `paste_style`
**Content** — `set_text`, `set_data`, `set_label`
**Layout** — `apply_layout`, `align`, `distribute`, `beauty_pass`
**Routing** — `set_routing_mode`, `reroute`
**Document** — `add_page`, `delete_page`, `rename_page`, `add_layer`, `set_layer_visibility`
**Meta** — `set_provenance`, `set_legend`

### 6.4 Semantics that matter

**Strict create, explicit upsert.** `create_node` with an existing `id` is a structured collision error. Intentional create-or-update behavior uses an explicit `upsert_node` op. Retries are made safe by the transaction `idempotencyKey`, so create semantics never silently overwrite an existing entity.

**Dry run by default on first contact.** `apply_operations` returns, without mutating: the resolved ops, a compact rendered diff, and any diagnostics. The agent re-sends with `dryRun: false`. Cheap, and it eliminates most agent-induced corruption.

**Transactions.** All-or-nothing. One `txId`, **one undo entry**, per-op status in the dry-run response. A committed transaction with any invalid operation applies nothing; partial committed transactions are not supported.

**Optimistic concurrency.** `baseRev` must equal the document's current `rev`. On mismatch, return a structured error carrying the current `rev` and a *minimal* diff of what moved — the agent re-reads and retries (the GitHub MCP `sha` pattern).

**Coalescing.** By `(origin, targetKind, timeWindow)`: dragging coalesces to one op on pointer-up; typing coalesces on a 600 ms idle or on blur; slider drags coalesce on commit.

**Op caps.** 5,000 ops per transaction, 1 MB per envelope — a runaway agent is stopped by the same guardrail that stops a runaway script.

### 6.5 The journal

Append-only NDJSON beside the document, one line per committed transaction:

```jsonc
{"seq":412,"rev":87,"txId":"t_2f9","t":"2026-08-29T14:02:11Z","actor":"agent","origin":"mcp",
 "ops":[{"op":"connect","id":"e_metrics","from":"…","to":"…"}],
 "inverse":[{"op":"add","path":"/edges/e_metrics","value":{…}}],
 "summary":"agent: +1 edge, connected api-gw.out → svc.checkout.in"}
```

Buys, at essentially zero cost: cross-session undo, time travel, crash recovery, a perfect audit trail of what an agent changed, and cheap `Automerge`-style diffs later if collaboration is ever added.

### 6.6 The round-trip law

The property test that protects the whole architecture:

> For every op `o` and document `d` where `o` is valid: `apply(invert(o), apply(o, d)) ≡ d`.

Fuzzed with an agent-like generator (§18.3). If this ever fails, undo is broken, the journal is broken, and the agent contract is broken — so it gates every merge.

---

## 7. Derived layers

Three tiers, strictly separated:

| Tier | Contents | Persisted? | Read by agents? |
|---|---|---|---|
| **T0 canonical** | Semantics, styles, tokens, provenance | yes | yes |
| **T1 derived** | Positions, sizes, routes, text layout, clip paths | cached with a version hash | no (exposed read-only via `get_nodes` if asked) |
| **T2 ephemeral** | Camera, selection, hover, panel state, clip | session file only, git-ignored | no |

T1 invalidation is content-addressed: `derivedVersion = hash(canonicalSemantics ‖ layoutOptions ‖ shapeLibVersions ‖ tokenHash)`. On load, recompute and compare; if stale, discard and re-derive. **Never trust a stale cache** — a corrupt derived layer must be unrecoverable-but-harmless, never a corrupted document.

Derivation is **incremental and lazy**: moving one node re-routes only the edges whose cached route bounding box intersects the dirty rect, re-flows only that node's text, and re-lays out nothing.

---

## 8. Rendering engine

### 8.1 Decision: hand-rolled Canvas2D, one renderer

Evaluated against SVG DOM, PixiJS/WebGL, regl, Konva, Fabric, Paper.js, and an SVG/Canvas LOD hybrid.

**Chosen: hand-rolled Canvas2D.** Reasons, in priority order:

1. **Pixel-identical across all three WebViews.** Tauri ships WKWebView (macOS), WebView2 (Windows), WebKitGTK (Linux) — three SVG filter implementations and three font rasterizers. WebKit's `feGaussianBlur` uses a 3-pass box blur with documented banding. Effects must therefore be *baked into cached bitmaps*, not expressed as filters. Canvas2D gives us one rasterizer contract: ours.
2. **WebGL on Tauri/Linux is a trap.** WebGL can silently fall back to a software rasterizer, and `WEBGL_debug_renderer_info` is masked — it reports `Apple GPU` on every Linux machine, so you cannot even detect it. Lucid needs a Canvas2D fallback for exactly this class of reason; we simply start there.
3. **Full control of the AAA look** — gradients, baked soft shadows, custom arrowheads, dash patterns, protocol chips.
4. **Export fidelity is independent of the on-screen renderer** because both consume the same `SceneDescription` (§8.6).
5. **Headroom.** With dirty rects and a sprite cache, Canvas2D comfortably handles 10–20k shapes.

Rejected: SVG DOM (WebKitGTK filter divergence, ~1.5–3k node ceiling); PixiJS (rasterizes text, loses AA quality, inherits the WebGL trap); Konva (~2–5k ceiling and you fight its scene graph for Lucid-grade connector behaviour); the SVG/Canvas hybrid (two renderers = two visual bug surfaces and divergent export).

### 8.2 The three canvases

Directly following Lucid's Blackbird findings:

| Canvas | Contents | Repaint policy |
|---|---|---|
| `#bg` | Page background, grid, static container fills | dirty rect, on camera or document change |
| `#main` | Shapes, icons, connectors, text, chips | **dirty rect** from an rbush query |
| `#overlay` | Selection handles, smart guides, marquee, hover, snap indicators, coordinate readouts | **full clear and redraw every frame** |

DOM is used for exactly three things: the app chrome (toolbar, panels, menus), context menus, and **one** text-editing surface. Following Lucid's verified finding, nothing that must track the canvas frame-for-frame lives in DOM.

### 8.3 Dirty rectangles

1. A mutation (or camera change) produces a set of world-space rects, each padded by a **routing margin** and a **shadow bleed** margin.
2. Union overlapping rects; cap at 4 rects (beyond that, fall back to a single union rect — cheaper than 12 small clears).
3. Query rbush for the ordered list of items overlapping each rect. Lucid measured **>1,000×** speedup from this exact design.
4. Clear, clip, re-draw in z-order.
5. Coalesce everything through one `requestAnimationFrame`.

### 8.4 The chrome sprite cache

The single biggest performance and consistency lever, and it is unusually well-suited to our target genres: architecture diagrams are *enormously* repetitive — 100 identical EC2 icons, 40 identical subnets.

Each shape's **chrome** (shadow + border + fill + corner radius) is rendered once into an offscreen canvas, keyed by:

```
hash(shapeKind ‖ sizeBucket ‖ styleTokenHash ‖ zoomBucket ‖ dpr)
```

Then blitted for every shape sharing that key. `sizeBucket` quantizes to 8 px; `zoomBucket` to powers of 2.

This:
- makes shadows cost **nothing** at draw time (they are baked, so `shadowBlur`'s notorious per-draw cost disappears);
- guarantees **identical pixels on every platform**, because we never use a platform filter;
- turns a 10,000-shape frame into a few hundred `drawImage` calls.

LRU-bounded at 256 MB. One-off shapes fall back to direct draw. Text and icons are drawn per-shape on top (icons are separately cached by `(set, name, size, color)`).

### 8.5 Text

- Drawn to canvas at all times **except while editing**.
- On edit: hide that shape's canvas text, position a single `contenteditable` (Tiptap/ProseMirror) over it with matched font metrics, focus it, and on commit write rich text back to the IR as an op. Because no canvas text is drawn during editing, Lucid's DOM/canvas one-frame desync problem cannot occur.
- **Rasterize per (text, style, zoom bucket)** into an offscreen canvas; re-rasterize on bucket change. Bucket = power of two, so worst case is a 2× resample for one frame, corrected on zoom-settle (120 ms debounce).
- **Never use `foreignObject`** — it is the number one cause of SVG export breakage and WebKit/Chromium divergence.
- **Never bake text metrics into saved files.** WebView2 (DirectWrite), WKWebView (CoreText), and WebKitGTK (Cairo-FreeType) produce different metrics. Measure at load with `measureText`, cache in memory, re-measure on platform change.

### 8.6 The scene contract

```ts
interface SceneDescription {
  version: number;
  bounds: Rect;
  items: SceneItem[];          // z-ordered
}
type SceneItem =
  | { t: "shape";  id: Id; frame: Rect; chrome: ResolvedChrome; icon?: ResolvedIcon;
                   text?: ResolvedText; clip?: Path2D; }
  | { t: "line";   id: Id; path: Path2D; stroke: ResolvedStroke; markers: ResolvedMarker[];
                   label?: ResolvedText; jumps?: JumpSpec[]; }
  | { t: "group";  id: Id; frame: Rect; children: SceneItem[]; }
```

Three consumers, one picture:

| Consumer | Output |
|---|---|
| `render/canvas` | on-screen pixels |
| `serialize/svg` | SVG (with an embedded IR copy for round-trip) |
| `serialize/raster` | PNG / JPEG / PDF / PPTX |

Export is therefore **not** a re-implementation and cannot drift from the screen.

### 8.7 Level of detail

| Zoom | Rendering |
|---|---|
| ≥ 0.75 | Full: chrome, icon, all text, shadows, chips, line jumps |
| 0.4 – 0.75 | Chrome + icon; sublabels and chips suppressed |
| 0.15 – 0.4 | Chrome only, no text, no jumps, no icons below 12 px |
| < 0.15 | Filled rects for nodes; containers only; connectors at 1 px, no labels |

### 8.8 Camera

- World→screen as a single affine matrix applied inside the painter. **No CSS transforms on content** — Lucid emulates scrollbars for a reason, and native scroll is not usable.
- Zoom range 0.02× – 32×, anchored at the cursor; wheel zoom with `ctrlKey`, trackpad pinch, and a trackpad/mouse/auto navigation-mode setting (Lucid ships exactly this and it matters for feel).
- `devicePixelRatio` scaling with a 2× cap on the backing store.
- Animated zoom with configurable speed and step, disableable (reduced motion).

---

## 9. Shapes, libraries, and the three genres

### 9.1 Shape runtime

We adopt Lucid's `.shape` model nearly verbatim (§2.4) because it is proven, declarative, JSON-shaped, and therefore agent-authorable — a `.shape` file is a legitimate artifact for an agent to write.

- Geometry primitives: `rect`, `ellipse`, `polygon`, `path`, `BooleanOperation`.
- Normalized 0–1 bounds with a 9-way `anchor` plus optional absolute `xywh`.
- Fixed evaluation order: Conditions → Repeat → Definitions → Bounds → TextAreas → LinkPoints → Geometry → Sub-shapes.
- Clipping as boolean intersection of child geometry, with a re-added outline stroke.
- Typed shape data with `@Property` formulas and constraints.
- Shape controls: on-canvas handles bound to properties (`{uri:"control", location, constraint, onmove}`).

Extensions we add that Lucid lacks: **ports declared in the shape definition** (so a standard library shape ships sensible connection points), and an explicit `composition` hint (`above | left | circle`) consumed by the design system.

### 9.2 Libraries and the licensing reality

Vendor icon packs are **not** ours to redistribute. AWS permits use in diagrams and documentation but the set is not open source; Azure icons carry explicit click-through terms (no crop, flip, rotate, distort, or recolor; Microsoft reserves all other rights); GCP icons are trademark-restricted.

**Therefore:**

- **Ship**: an original generic set (MIT-ours), plus **Simple Icons** (CC0, ~3,300 brand SVGs — ideal for Kafka, Redis, Postgres, Stripe) and **Phosphor** (MIT, 6 weights) for generic glyphs.
- **Do not ship**: AWS/Azure/GCP packs. Instead ship a **first-run pack installer** that downloads the official set from the vendor and caches it locally, with the vendor's licence text displayed and stored. This is both correct and better — the packs update quarterly and the user always has the current set.
- An importer for user-supplied SVG / Visio stencils / `.lcsz`.

Target libraries at 1.0: Generic, Flowchart, Integration, Cloud (AWS/Azure/GCP via installer), Network, UML (class/sequence/state), ERD, BPMN 2.0, Dynamic (progress/donut/pie).

### 9.3 Genre 1 — Integration diagrams

*Services, protocols, message flows, third-party dependencies.*

Needs: protocol chips at edge midpoints (`HTTPS`, `gRPC`, `Kafka`, `mTLS`); sync vs async distinguished by **dash pattern plus a legend entry**, never by colour alone; request/response directionality (always arrowed, never double-headed); fan-out bundling for one-to-many; external-system boundary styling distinct from internal; sequence-diagram mode (lifelines, activation, `alt/opt/loop` fragments) generated from the same IR.

Shape set: service, API gateway, queue, topic, stream, function, database, cache, external SaaS, client. Built heavily on Simple Icons for recognisable third parties.

Layout: `elk.layered` LEFT→RIGHT with strict port sides; bus-style bundling for fan-out.

### 9.4 Genre 2 — Architecture diagrams

*Cloud infrastructure, tiers, trust boundaries, availability zones.*

Needs: nested containers with proper semantics (VPC → subnet → instance), each with a **title bar** and **tint-only fill**; magnetize (children move with parent); `assistedLayout` on first open; non-rotatable container frames (Lucid's constraint, kept deliberately — it removes an entire bug class); per-cloud icon fidelity; availability-zone and region grouping; trust-boundary dashed strokes.

Shape set: the vendor packs plus generic serverless, container, load balancer, firewall, CDN, identity.

Layout: `elk.layered` with `hierarchyHandling: INCLUDE_CHILDREN` so containers are laid out as units, then orthogonal routing with `FIXED_SIDE` ports.

### 9.5 Genre 3 — System connectivity maps

*Network topology, data flows, dependency graphs, service meshes.*

Needs: high node counts; force and radial layouts; edge bundling; clustering by tag; degree-based node sizing; filtering/dim-by-query (hide everything except the neighbourhood of a selected node); crossing minimisation and line jumps doing heavy lifting; optional geographic backdrop with positioned pins.

Layout: `elk.force` or `elk.radial` for exploration, `elk.layered` for presentation; `elk.mrtree` for hierarchy.

### 9.6 Containers

- Containment is derived from geometry, matching Lucid: a node is a child of the innermost container whose frame contains its centre. `parent` in the IR is authoritative; geometry is reconciled to it, not the reverse.
- `magnetize` (default true) — children translate with the container.
- `assistedLayout` — auto-arrange children into a grid on first open.
- Auto-grow: a container's frame expands to fit children with padding; never shrinks below its manual frame unless explicitly `fit`.
- Clipping children to the container frame is opt-in.

---

## 10. Visual design system

The bar: **a six-box diagram should come out of the Beauty Pass looking like it belongs in an AWS Solutions Architecture deck.**

### 10.1 Why this section exists

Lucid gives users a format panel and gets out of the way. The predictable result is the "default Lucidchart look" — saturated fills, mismatched icon weights, inconsistent radii, hairline connectors. The fix is not more controls; it is **a design system powerful enough that the defaults are beautiful**, exposed as tokens so an agent can restyle a whole diagram with one tool call.

### 10.2 Colour

Light theme:

```
--canvas:        #FBFCFE   /* off-white; never pure #FFFFFF */
--surface:       #FFFFFF
--surface-alt:   #F1F4F9
--stroke:        #E2E8F0
--stroke-strong: #CBD5E1
--text-hi:       #0F172A
--text-mid:      #475569
--text-lo:       #94A3B8

/* semantic tiers — one per service category, max 6 visible at once */
--compute:  #2563EB   --storage:  #7C3AED   --data:     #0D9488
--network:  #64748B   --identity: #B45309   --external: #94A3B8
--danger:   #DC2626   --success:  #059669
```

Dark theme: canvas `#0B0F17`, surface `#131A25`, stroke `#243040`, text `#E6EDF6`; **desaturate accents ~10% and raise lightness** (compute `#2563EB` → `#60A5FA`) so they stop vibrating against dark surfaces.

**Rules, enforced by the design system, not by the user's restraint:**

1. **Shapes get a 10–14% tint of their semantic hue, never full saturation.** Full-saturation fills on large shapes are the single clearest marker of an amateur diagram. Icons and logos stay at full colour.
2. **Gradients only on page backgrounds and container headers** — max 2 stops, ≤ 8° hue shift. Never on semantic shapes.
3. **Encode category by colour + icon + label.** Never colour alone (accessibility, and it survives greyscale printing).
4. Contrast ≥ 4.5:1 for all text against its fill.
5. Max 6 semantic colours visible per diagram; the palette refuses a 7th and suggests a grouping.

### 10.3 Typography

**Inter** (primary) + **JetBrains Mono** (protocols, ports, IDs). Both SIL OFL 1.1 — bundling is fine, ship the licence. Fallback stack: `Inter, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`. Nunito is too round for infrastructure; Roboto is acceptable but Inter's tighter apertures read better at 11–12 px.

| Role | Size | Weight | Colour | Tracking |
|---|---|---|---|---|
| Diagram title | 24 | 600 | text-hi | −0.02em |
| Group / container label | 13 | 600 | text-mid | +0.04em, UPPERCASE |
| Node label | 12 | 500 | text-hi | 0 |
| Sub-label / metadata | 11 | 400 | text-lo | 0 |
| Protocol chip | 10 | 600 | accent | +0.06em, UPPERCASE, mono |

Hard floor: **10 px**. Nothing smaller, ever.

### 10.4 Depth, radius, stroke

```
--e1: 0 1px 2px rgba(15,23,42,.06), 0 1px 3px rgba(15,23,42,.04)   /* nodes */
--e2: 0 4px 12px rgba(15,23,42,.08), 0 1px 3px rgba(15,23,42,.06)  /* panels */
```

- **Two elevation tiers only.** Never a coloured shadow.
- **Radius scale: 8 px nodes, 12 px containers, 999 px chips.** One scale, no exceptions.
- **Strokes: 1 px default, 1.5 px on hover/select, 2 px dashed (6-3) for container boundaries.** Never 3 px+ on a diagram shape.
- **No glassmorphism.** `backdrop-filter` breaks PNG/PDF export and destroys text contrast. Depth comes from a solid surface plus `e1`.

### 10.5 Connectors

- **1.5 px uniform, `#94A3B8`, no taper.**
- Orthogonal routing with 8 px corner radius (configurable, as Lucid does).
- Arrowheads small and solid, ~6 px. **Always directional — never double-headed** (Azure's own architecture guidance; double-headed arrows are genuinely ambiguous).
- **Dashed = async, solid = sync**, and the legend says so.
- Protocol chips: pill, 18 px tall, 0 8 px padding, 10 px/600 uppercase mono, fill 12% accent, text full accent, 1 px border at 25% accent, sitting on an opaque canvas-coloured rect so the line never runs through the text.

### 10.6 Composition

Three icon-and-label patterns only — consistency matters more than the choice:

1. **Icon-above** (default for service nodes): 32 px icon centred, 8 px gap, 12 px label, 11 px sub-label. This is what AWS and Azure official diagrams look like.
2. **Icon-left** (default for dense trees): 20–24 px icon, 16 px gap, vertically centred label.
3. **Icon-in-circle**: 40 px circle at 12% semantic tint with a 20 px glyph — for generic concepts with no vendor icon (API gateway, queue).

**Spacing**: 8 px base grid; 24 px minimum gutter between siblings; 32 px inner padding on containers; 16 px between icon and label.

**Never mix icon stroke weights.** Lucide/Feather *or* Phosphor — not both.

### 10.7 Themes are tokens

We take Lucid's six named styles (Primary, Secondary, Accent, Highlight, Success, Error) and generalise them into a token document: colour, spacing, typography, radius, elevation, connector semantics. Switching a theme restyles everything **except** shapes with `meta.provenance == "authored"` manual style overrides — Lucid's precedence rule, which is the correct one.

Shipped presets: `openchart-light`, `openchart-dark`, `aws-official`, `azure-official`, `mono-print`, `high-contrast`.

### 10.8 Conditional formatting — done incrementally

Lucid's public performance cliff (§2.2) is a global re-evaluation bug. Ours is built to avoid it by construction:

- Each rule declares the fields and entity sets it reads; the op engine maintains a **dependency index** from `(field, entity)` → `ruleId[]`.
- A mutation re-evaluates **only** rules whose dependencies changed.
- Rules are pure functions over `(node, data, neighbours)` — no I/O, no ordering dependence.
- Evaluated in a worker; results cached by `(ruleHash, inputHash)`.
- Budget: 1,000 rules must evaluate in < 16 ms incrementally, with a CI gate.

### 10.9 The Beauty Pass

One deterministic operation, available as a button, a keyboard shortcut, and an MCP tool. It is the single highest-leverage feature in the product for the stated visual goal.

```
1.  Infer semantics      tag nodes by shape/name/label → tier → semantic colour
2.  Infer hierarchy      detect containment → group into containers; infer missing boundaries
3.  Assign ports         per shape definition; side chosen by flow direction
4.  Auto-layout          ELK layered per container, INCLUDE_CHILDREN; force/radial for meshes
5.  Route                orthogonal + obstacle avoidance; crossing minimisation; line jumps
6.  Snap to grid         8 px grid; equalise sibling sizes; normalise gaps
7.  Apply tokens         tints, radii, strokes, shadows, typography ladder
8.  Semantics → style    sync = solid, async = dashed, protocol → chip
9.  Generate legend      from colours, dash patterns, and icon set in use
10. Add title block      title, version, date, author — corner-anchored
11. Fit camera           with margin
```

Every step is an op, so the whole pass is **one undo entry** and is fully inspectable in the journal. It is idempotent: running it twice produces no diff after the first. That property is asserted in CI.

**Non-negotiables the Beauty Pass enforces:** every icon has a label; every arrow has a direction; every colour has a legend entry; every diagram has a title block.

---

## 11. Interaction and UX

### 11.1 Selection

Click selects. Shift+click toggles. Marquee selects; **Ctrl/Cmd+drag starts a marquee even when the pointer begins on top of a shape** (Lucid's answer to click-through — a small detail that removes a lot of frustration). Ctrl/Cmd+A selects all; Esc deselects. Enter drills into a group/container, Shift+Enter exits. Ctrl+Alt+S enables freehand lasso.

Marquee semantics: **partial overlap selects** for marquee (matches user expectation for shape-like objects), **full containment required** for lasso. Locked and hidden-layer objects are not selectable by marquee; hidden-layer objects are never drawn.

### 11.2 Transform

Eight handles plus a rotation handle at top-left. Shift = aspect ratio, Alt = resize from centre, Alt+drag = duplicate, Alt+Shift+drag = duplicate constrained to one axis. Arrow keys nudge; Shift+arrow fine-nudges (1 px vs grid step).

Rotation snaps to 15° with Shift held; **containers and groups with children cannot be rotated** (Lucid's constraint, kept — rotation of a container tree is a geometric swamp and nobody needs it).

Multi-select transforms as one AABB. Resize scales children proportionally inside containers.

### 11.3 Snapping and guides — the details that signal quality

Three independent toggles: **snap to grid**, **snap to objects**, **snap to guides**.

Adopting Lucid's verified semantics exactly:

- **Dotted guide = edges align. Solid guide = centrepoints align.**
- While moving, the object's **X/Y coordinates render beneath it**.
- **Distance measurements between objects** appear live during drags.
- Equal-spacing guides when three or more objects are evenly spaced.
- Object guides only appear for on-screen objects.
- User-placed guides via right-click on the canvas.

### 11.4 Group drill-down, layers, pages

- **Align is relative to the object you right-click**, not the selection bounds. Distribute retains the two extreme objects and equalises the gaps between the rest.
- **Four-way lock**: Lock / Lock size and position / Lock style / Lock content, each with a distinct affordance. A locked child still moves with its unlocked parent.
- Layers are **page-scoped** (they do not carry across pages), with hide, lock, reorder, and a "save layer view" that persists the default visibility. A base page layer is always present and non-lockable.
- Pages live in a bottom bar with rename, duplicate, delete, reorder, colour, and "create document from page."

### 11.5 Keyboard (verified Lucidchart bindings, plus our additions marked ✦)

| Action | Win/Linux | macOS |
|---|---|---|
| Select / deselect | `V` / `Esc` | `V` / `Esc` |
| Shape manager | `M` | `M` |
| Pan | Space+drag, right-drag | Space+drag |
| Zoom in / out / reset | `Ctrl +/-/0` | `Cmd +/-/0` |
| Undo / redo | `Ctrl+Z` / `Ctrl+Y` ✦`Ctrl+Shift+Z` | `Cmd+Z` / `Cmd+Y` ✦`Cmd+Shift+Z` |
| Cut / copy / paste | `Ctrl+X/C/V` | `Cmd+X/C/V` |
| ✦ Paste in place | `Ctrl+Shift+V` | `Cmd+Shift+V` |
| Duplicate | `Ctrl+D` | `Cmd+D` |
| Select all / add-remove | `Ctrl+A` / `Ctrl+click` | `Cmd+A` / `Cmd+click` |
| Copy / paste text style | `Ctrl+Alt+C/V` | `Opt+Cmd+C/V` |
| Bold / italic / link | `Ctrl+B/I/K` | `Cmd+B/I/K` |
| Font size up / down | `Ctrl+Shift+>/<` | `Shift+Cmd+>/<` |
| Edit text | `F2` | `F2` |
| Nudge / fine nudge | Arrows / Shift+Arrows | Arrows / Shift+Arrows |
| Align directionally | `Ctrl+Arrow` | `Cmd+Arrow` |
| Group / ungroup | `Ctrl+G` / `Ctrl+Shift+G` | `Cmd+G` / `Shift+Cmd+G` |
| Front / forward | `Ctrl+Alt+]` / `Ctrl+]` | `Opt+Cmd+]` / `Cmd+]` |
| Backward / back | `Ctrl+[` / `Ctrl+Alt+[` | `Cmd+[` / `Opt+Cmd+[` |
| Aspect / from-centre (hold) | `Shift` / `Alt` | `Shift` / `Option` |
| Freehand select | `Ctrl+Alt+S` | `Cmd+Opt+S` |
| Find / next / prev | `Ctrl+F` / `F3` / `Shift+F3` | `Cmd+F` / `F3` / `Shift+F3` |
| Next / prev page | `PageDown` / `PageUp` | `PageDown` / `PageUp` |
| Shortcut overlay | `F1` | `F1` |
| Canvas-nav mode | `Ctrl+Alt+K` | `Cmd+Opt+K` |
| Nav: next/prev object | `Tab` / `Shift+Tab` | `Tab` / `Shift+Tab` |
| Nav: enter/exit container | `Enter` / `Shift+Enter` | `Enter` / `Shift+Enter` |
| ✦ Beauty Pass | `Ctrl+Alt+B` | `Cmd+Opt+B` |
| ✦ Re-route selection | `Ctrl+Alt+R` | `Cmd+Opt+R` |
| ✦ Toggle obstacle avoidance | `Ctrl+Alt+O` | `Cmd+Opt+O` |

`F1` opens an in-app, searchable shortcut overlay — cheap to build, disproportionately useful.

### 11.6 Accessibility

Canvas navigation mode (Tab order L→R top→bottom, directional `Cmd+Arrow`, `Enter`/`Shift+Enter` traversal) is a first-class feature, not an afterthought. Screen-reader announcements of shape text and relative position. Per-node alt text, exported into tagged PDFs. High-contrast token preset. Reduced-motion respects the OS setting (disables animated zoom and Beauty Pass animation). Lucid has no dark mode or high-contrast mode — we do, because tokens make it nearly free.

---

## 12. Connector routing

### 12.1 Two-speed routing

**Fast path — the default, used during drags.** Deterministic, O(1), no search:

1. Pick exit and entry sides from the port's declared `side`, or by quadrant when floating.
2. Emit a perpendicular **jetty** (~12 px) from each anchor — this alone makes diagrams look deliberate rather than accidental.
3. Choose the path shape from the quadrant: straight when aligned, Z (two bends) when offset on the flow axis, U (four bends) when the target is behind the source.
4. Round corners with an arc of the configured radius (default 8 px).
5. If the straight segment crosses an obstacle, apply a local detour around the blocking AABB.

This is the mxGraph `OrthConnector` class of router — table-driven, no cost function. It is what makes 60 fps dragging with 1,000 live connectors possible.

**Slow path — opt-in per connector or per page, run on idle.** Orthogonal visibility graph + A*, the libavoid/Adaptagrams design (used by Inkscape and Graphviz):

1. Feature points = shape corners (inflated by a clearance margin) + connector endpoints.
2. Cast one horizontal and one vertical line through each → an OVG of Θ(n²) nodes.
3. Edges join consecutive collinear points whose segment does not cross a shape interior.
4. A\* with an admissible Manhattan heuristic; cost = Σ length + bends × bendPenalty + crossings × crossingPenalty (already-routed edges act as soft obstacles).
5. Post-passes: collinear merge, **nudge** segments into corridor centres, and **shared-line packing** so parallel runs offset instead of overlapping.

Runs in a worker over WASM. Only edges whose cached route bbox intersects the dirty rect are re-solved.

**Stability**: seed A\* with the previous route so small moves do not reshuffle the whole drawing, and order edges deterministically by `uid` to prevent flicker.

### 12.2 Anchors

- **Declared ports** (preferred) — a port has a `side` hint and an `order`; multiple ports on one side distribute along it.
- **Floating anchor** (fallback) — cast a ray from the shape centre to the opposite endpoint's reference point and intersect the perimeter. This is draw.io's floating-connector behaviour and is what makes a freshly-drawn line land somewhere sensible.
- Ports are first-class IR entities, which is why our D2/Mermaid export is strictly higher-fidelity than those formats' native capabilities.

### 12.3 Line jumps

Post-route pass. Sweep-and-prune over segment AABBs (rbush) to find crossings; the "over" edge is chosen by z-order with `uid` as a stable tiebreak; emit a semicircular arc whose radius scales with line width (or a gap, or a square hop — user-selectable). Skipped below 0.4 zoom and off-screen.

### 12.4 Curved and straight

- **Curved**: Catmull-Rom through the waypoints converted to cubic Béziers — `C1 = P1 + (P2−P0)·α/6`, `C2 = P2 − (P3−P1)·α/6`, with α distance-based (centripetal) to avoid the cusps and self-intersections uniform parameterisation produces.
- **Straight**: direct segment, with endpoint trimming at the perimeter.
- **Two-way**: markers at both ends, distinct from a double-headed arrow.

### 12.5 Labels and chips

Edge labels are positioned at the path midpoint by default with `above | below | on` placement; draggable along the path with the offset stored as a normalised `t` so it survives re-routing. Protocol chips render as pills on an opaque backing rect.

---

## 13. Layout engines

### 13.1 Choice

**ELK.js in a worker.** Nine algorithms, actively maintained, and `elk.layered` is the best open layered implementation available — network-simplex layering, layer-sweep crossing minimisation with two-sided greedy switching, Brandes–Köpf coordinate assignment, and ORTHOGONAL/POLYLINE/SPLINES edge routing with proper port constraints.

**Licence note:** ELK is EPL-2.0 OR GPL-3.0-or-later. EPL is a per-file weak copyleft — your application is not infected, but modifications to ELK itself must be published. For a locally distributed desktop app this is acceptable. If that is ever unacceptable, the fallback is **`@dagrejs/dagre`** (MIT, Sugiyama skeleton with Brandes–Köpf) — weaker, but licence-clean and adequate for layered and tree cases. Design the layout adapter interface so the engine is swappable without touching anything else.

**Do not** depend on `webcola` (npm last published 2022 despite active repo commits) or on `dagre` 0.8.5 (dead).

### 13.2 Engine mapping

| Genre | Engine | Key options |
|---|---|---|
| Integration | `elk.layered` RIGHT | `FIXED_SIDE` ports, `spacing.edgeNode`, bus bundling for fan-out |
| Architecture | `elk.layered` DOWN/RIGHT | `hierarchyHandling: INCLUDE_CHILDREN`, `mergeHierarchyCrossingEdges` |
| Connectivity mesh | `elk.force` | Barnes–Hut, link distance, collide |
| Hierarchy / org | `elk.mrtree` | Reingold–Tilford |
| Radial dependency | `elk.radial` | — |
| Manual | none | pinned overrides only |

### 13.3 The layout contract

Layout is **advisory and reversible**:

1. Read canonical semantics plus pinned overrides.
2. Build an ELK graph with ports and containment.
3. Run in the worker; apply results to `layout.derived`.
4. **Pinned nodes keep their positions**; everything else is re-solved around them.
5. One undo entry. `meta.provenance` on every moved node becomes `inferred` (unless pinned).

Layout never writes to the canonical layer. Ever.

---

## 14. The agent surface

This is the second half of the product thesis, and it is designed in from day one rather than added later.

### 14.1 Three access paths, one engine

| Path | Use case | Transport |
|---|---|---|
| **MCP server** | live editing with the app open | in-process HTTP on `127.0.0.1` |
| **Headless CLI** | CI, batch authoring, app closed | stdio / argv |
| **File watch** | agent writes the `.openchart.json` directly | filesystem |

All three compile to the same ops and hit the same op engine. There is no second implementation.

### 14.2 MCP server

**Transport.** Streamable HTTP, POST-only, bound to `127.0.0.1:4777/mcp`, following the current spec revision (2026-07-28: per-request capability negotiation in `_meta`, `server/discover`, `outputSchema` + `structuredContent`, tool annotations).

In-process, deliberately — this is the Figma desktop precedent (`http://127.0.0.1:3845/mcp`). A stdio server is a separate process that cannot see live window state.

**Discovery.** On launch the app writes `%LOCALAPPDATA%\OpenChart\mcp.json` with the port and a bearer token. The file is protected with a user-only Windows ACL and contains the complete local connection information.

```bash
openchart mcp configure
```

Port-scan fallback if 4777 is taken.

**Security.** Bind loopback only (never `0.0.0.0`); validate `Origin` and `Host`; per-install bearer token in a `0600` file; no wildcard CORS; reject non-local hosts. Per the spec, servers must validate `Origin`, should bind loopback, and should authenticate.

**A headless stdio sidecar** (`openchart mcp --stdio`) opens a file directly for CI and for clients that only speak stdio. Same tool surface, same engine, no GUI.

### 14.3 Tool surface

Reads carry `readOnlyHint: true`. Only five tools mutate.

| Tool | Purpose |
|---|---|
| `get_document_info` | counts, pages, layers, bounds, `rev`, token preset in use |
| `find_nodes` | cheap filtered lookup (`filter`, `limit`, `cursor`, `fields`) — token economy |
| `get_nodes` | hydrated subgraph by ids + depth |
| `get_screenshot` | **PNG of a region or the whole page** — lets the agent *look* at its work |
| `get_operations` | read the journal by `txId` or `sinceRev` |
| `get_history` | recent transactions, human-readable summaries |
| `apply_operations` | the one write tool |
| `undo` / `redo` | transaction-granular |
| `apply_layout` | run a layout engine on a subgraph |
| `apply_beauty_pass` | §10.9 |
| `set_tokens` | restyle the document via design tokens |
| `export` | SVG / PNG / PDF / D2 / Mermaid to a path |

**`get_screenshot` is the highest-value tool in the set** and the reason it exists is specific to this project: the stated goal is *stunning* output, and an agent cannot judge beauty from JSON. Render → look → refine is a loop the agent can run, and it is the mechanism by which an agent-authored diagram reaches the visual bar.

### 14.4 `apply_operations` contract

```jsonc
{
  "baseRev": 87,
  "txId": "t_2f9",
  "idempotencyKey": "agent-turn-14",
  "dryRun": true,
  "ops": [
    { "op": "create_node", "id": "svc.checkout", "kind": "node", "parent": "aws.vpc.prod",
      "label": "Checkout", "shape": "generic/service", "style": "service/compute",
      "ports": { "in": { "dir": "in", "side": "west" }, "out": { "dir": "out", "side": "east" } } },
    { "op": "connect", "id": "e_place", "from": "svc.checkout.out", "to": "svc.ledger.in",
      "label": "gRPC", "semantic": "sync-call" }
  ]
}
```

Response:

```jsonc
{
  "rev": 88, "txId": "t_2f9", "applied": 2,
  "created": [{ "tempId": "t1", "id": "svc.checkout", "uid": "u_7c21" }],
  "changedIds": ["svc.checkout", "e_place"],
  "warnings": [{ "code": "PORT_SIDE_CONFLICT", "id": "svc.ledger.in",
                 "message": "…", "hint": "…" }],
  "subgraph": { "…": "compact render of touched nodes, capped at 50" }
}
```

**Design rules that come straight from how agents actually behave:**

- **Custom typed op array with stable ids — not RFC 6902 JSON Patch, not RFC 7386 Merge Patch.** JSON Patch's array-index paths (`/children/3`) break under reordering, `add`/`remove` shift indices, and the ops are not idempotent. Merge Patch has no array semantics and uses `null` for delete. Both are well-documented sources of LLM errors.
- **Idempotency keys make retries safe.** Agents retry. Replaying a committed key returns the original result; `create_node` itself remains strict.
- **Errors are structured and self-correcting**: `{op, index, code, path, expected, hint}`, returned with `isError: true` so the client feeds them back.
- **Never dump the whole document.** `find_nodes` is the cheap lookup; `get_nodes` is the hydrate; `subgraph` is capped.
- **One transaction = one undo entry**, so `undo` after an agent turn reverts exactly that turn.
- **Guardrails**: a `mutations_enabled` toggle, read-only mode, a cap of 5,000 ops per call, and elicitation-gated confirmation for destructive batches (more than 25 deletes, or whole-document overwrite).

### 14.5 Text projections

| Format | Direction | Rationale |
|---|---|---|
| **D2** | import + export | Best container + port fidelity of any diagram DSL (MPL-2.0); ships `d2format`; its `container.child` absolute ids match our id philosophy exactly |
| **Mermaid** | export (+ limited import) | Ubiquity; flowchart and C4. Loses ports and absolute positions — accepted loss |
| **Structurizr DSL** | export | C4-native; their own MCP server is the closest precedent to ours |
| **ELK JSON** | internal | Handoff to `elkjs`, then transfer layout back |
| **Draw.io / Excalidraw JSON** | import, one-way | Ingest existing diagrams; keep geometry, lose semantics |

**Round-trip law:** `parse(emit_d2(ir)) ≡ ir` for the D2-expressible subset, asserted as a property test. The subset is documented explicitly so users know what survives.

### 14.6 File-watch mode

If the `.openchart.json` on disk changes while the app is open, the app validates it, calculates a semantic diff against the loaded revision, and shows a non-blocking banner. Accepting the change compiles that diff into one typed operation transaction; rejecting it leaves the live document untouched. **Never silently clobber a user's open document and never replace state outside the operation engine.** Unsaved local changes make the proposal a conflict requiring an explicit choice.

---

## 15. Persistence

### 15.1 Files

```
my-diagram.openchart.json          canonical IR + layout overrides + derived cache
my-diagram.openchart.journal.ndjson   append-only transaction log
my-diagram.openchart.session.json  camera, selection, panel state — git-ignored
```

Session state is deliberately separate (the tldraw document/session split): it keeps the committed file diff-clean, which matters a lot once agents and humans are both editing and you want to read a git diff.

### 15.2 Write policy

- Autosave debounced 1.5 s, forced on idle and on window blur.
- **Atomic**: write `*.tmp` → `fsync` → `rename`. A crash mid-write never truncates the document.
- Journal append is synchronous-before-document-write, so the log is always at least as current as the document.
- On open: load document, replay any journal entries with `rev > document.rev`, verify `derivedVersion`, reconcile.
- Every document keeps the last 20 autosave snapshots in the app data directory, plus manual named snapshots.

### 15.3 Why not SQLite

A single JSON file is greppable, diffable, human-readable, and mergeable — decisive advantages when an agent is a co-author and you want `git diff` to be meaningful. SQLite waits until cross-document search or an asset store justifies it; if that day comes, use `@tauri-apps/plugin-sql` (MIT/Apache). **Never `wa-sqlite`** — its npm licence field is `None`, which is legally unusable.

---

## 16. Export

All exporters consume `SceneDescription`, so fidelity cannot drift from the screen.

| Target | Implementation | Notes |
|---|---|---|
| **SVG** | own serializer | Vector-perfect, embeds the IR in a `data-*` attribute for round-trip; optional SVGO pass |
| **PNG / JPEG** | `@resvg/resvg-js` (MPL-2.0) or offscreen canvas at N× | Scale 1–16×; transparency; crop-to-content. **No 300 DPI cap** (Lucid has one) |
| **PDF** | `pdf-lib` (MIT) | True vector; tagged/accessible output; layer-per-page option; page tiles |
| **PPTX** | `pptxgenjs` (MIT) | Native shapes where possible |
| **D2 / Mermaid / Structurizr** | own serializers | §14.5 |

Export options: crop to content or custom region, scale, transparent background, layers (visible / all / per-layer pages), embed fonts, include or strip the IR payload, light/dark token override at export time.

---

## 17. Performance

### 17.1 Budget

| Scenario | Target |
|---|---|
| Cold open, 10,000-shape document | < 1,500 ms to interactive |
| Pan / zoom, 10,000 shapes | 60 fps sustained |
| Drag a node, 1,000 shapes with live rerouting | 60 fps sustained |
| Drag a node, 10,000 shapes | ≥ 30 fps, full-quality reroute on drop |
| Create / delete / style a node | < 1 frame to paint |
| Text edit keystroke → repaint | < 8 ms |
| Auto-layout, 500 nodes | < 800 ms in worker, UI never blocks |
| Beauty Pass, 200 nodes | < 1,200 ms |
| Incremental rule eval, 1,000 rules | < 16 ms |
| Memory, 10,000-shape document | < 600 MB RSS |

### 17.2 Frame budget

p95 < 16.7 ms, p99 < 33 ms. Lucid's own production targets are 99% ≥ 10 fps and 95% ≥ 30 fps; we target **95% ≥ 60 fps** because we are not carrying a decade of backwards compatibility or a collaboration runtime.

### 17.3 The techniques that get us there

rbush dirty-rect enumeration (Lucid's measured 1,000× win) · chrome sprite cache (§8.4) · viewport culling · zoom LOD (§8.7) · two-speed routing (§12.1) · layout and routing in workers · text raster cache keyed by zoom bucket · transient Zustand subscriptions that bypass React entirely during drags (no shape is a React component) · `requestAnimationFrame` coalescing · batched transactions.

### 17.4 Instrumentation

A built-in stats overlay (frame times, draw call count, cache hit rate, worker latency, dirty-rect count, memory) and a headless benchmark runner that produces a JSON report. Benchmarks run in CI and **fail the build on budget regression** — performance that is not gated is performance that regresses.

---

## 18. Testing

### 18.1 Unit

Op engine (apply, invert, coalesce, validate), IR validation, ID/reference integrity, geometry math (anchor rays, corner rounding, Catmull-Rom), shape-runtime evaluation, token resolution.

### 18.2 Property-based

- **Round-trip**: `apply(invert(o), apply(o, d)) ≡ d` for every op kind.
- **DSL**: `parse(emit_d2(ir)) ≡ ir` on the documented subset.
- **Layout determinism**: same input → byte-identical output; idempotent on re-run.
- **Beauty Pass idempotence**: `pass(pass(d)) ≡ pass(d)`.
- **Reference integrity**: after any op sequence, every `parent`, `children`, `port`, and `edge` endpoint resolves.

### 18.3 Fuzz

An agent-like generator emits random op sequences (including malformed ones — dangling ids, duplicate ids, cycles in containment, out-of-range styles, 5,000-op batches). Assertions: the document never becomes invalid, no op partially applies, undo always restores the pre-transaction state, and the process never panics. This is what makes the agent surface safe to expose.

### 18.4 Visual golden files

~40 canonical diagrams (the three genres, light/dark, various zoom levels) rendered headlessly to PNG and compared by perceptual hash. This is the regression suite for "AAA visuals" — it is the only way to catch a shadow that got 2 px softer or a tint that drifted.

### 18.5 MCP contract tests

A real MCP client exercises every tool against a running server: `dryRun` correctness, `baseRev` conflict handling, idempotency-key replay, strict create collisions, transaction atomicity, and annotation accuracy.

### 18.6 Manual

A per-phase interaction checklist covering every shortcut in §11.5 and every guide/snap behaviour in §11.3.

---

## 19. Tech stack

| Concern | Choice | Licence | Why |
|---|---|---|---|
| Shell | **Tauri 2.x** | Apache-2.0 / MIT | 5–15 MB binary, ~80–150 MB RSS vs Electron's 300 MB+ |
| UI chrome | **React 19** | MIT | No shape is a React component, so reconciliation cost is bounded |
| Language | **TypeScript** (strict) | Apache-2.0 | The IR contract demands it |
| Transient state | **Zustand 5** + `subscribeWithSelector` | MIT | Bypasses React entirely during drags |
| Undo | **Immer** `produceWithPatches` | MIT | Exact inverses, no hand-written `invert()` |
| Spatial index | **rbush** | MIT | Non-negotiable; Lucid measured 1,000× |
| Renderer | **hand-rolled Canvas2D** | — | §8.1 |
| Layout | **ELK.js** in a worker | EPL-2.0 / GPL-3 | Best open layered layout; `@dagrejs/dagre` (MIT) is the licence-clean fallback |
| Routing | **libavoid WASM** in a worker | LGPL-2.1 (dual commercial) | Best-in-class obstacle avoidance; our O(1) router is the default path |
| Geometry | `polygon-clipping`, `bezier-js`, `earcut` | MIT / MIT / ISC | Prefer `polygon-clipping` over the stale `martinez` |
| Text editing | **Tiptap** (ProseMirror) | MIT | Single overlay instance; best schema control |
| Fonts | **Inter** + **JetBrains Mono** | SIL OFL 1.1 | Bundle the licence; never bake metrics |
| Export | `resvg-js`, `pdf-lib`, `svgo`, `pptxgenjs` | MPL-2 / MIT / MIT / MIT | |
| MCP SDK | `@modelcontextprotocol/server` v2 | MIT (Apache-2.0 for new contributions) | Tracks the 2026-07-28 spec |

### 19.1 Traps, and how we avoid them

1. **Tauri/Linux WebGL silently falls back to software rendering**, and `WEBGL_debug_renderer_info` is masked (reports `Apple GPU` on every Linux box). → We use Canvas2D and are structurally immune.
2. **Text metrics are not portable** across DirectWrite / CoreText / Cairo-FreeType. → Measure at load, cache in memory, never persist metrics.
3. **SVG filters diverge** across the three WebViews (WebKit's `feGaussianBlur` has documented banding). → All effects are baked into cached bitmaps.
4. **tldraw is commercially licensed** with a mandatory watermark on the free tier. → Not used. Its architecture is worth reading; its licence is not acceptable.
5. **React Flow is DOM-per-node**, ~1–2k node ceiling, and ships no obstacle-avoiding routing. → Not used.
6. **ELK's EPL-2.0** is per-file weak copyleft. → Acceptable here; adapter interface keeps `@dagrejs/dagre` (MIT) as a drop-in fallback.
7. **`wa-sqlite`'s npm licence is `None`** — legally unusable. → JSON on disk.
8. **`webcola` npm is stale** (last publish 2022). → `elk.force` or `d3-force`.
9. **DOM overlays desync from canvas by one frame** in Firefox and Safari (Lucid's verified finding). → Handles and guides live on a second canvas, not in DOM.

---

## 20. Repository layout

```
openchart/
├── packages/
│   ├── ir/            schema, types, validation, ids, provenance
│   ├── ops/           op taxonomy, apply, invert, coalesce, journal
│   ├── derive/        layout, routing, text flow, conditional formatting
│   ├── scene/         SceneDescription builder
│   ├── shapes/        shape runtime, geometry eval, libraries
│   ├── render/        Canvas2D painter, sprite cache, camera, LOD
│   ├── interact/      selection, transform, snapping, guides, keyboard
│   ├── serialize/     svg, png, pdf, pptx, d2, mermaid, structurizr, drawio
│   ├── agent/         MCP server, tool surface, CLI
│   └── app/           React chrome: toolbar, panels, menus, pages
├── apps/
│   ├── desktop/       Tauri shell (Rust + web assets)
│   └── benchmark/     headless perf harness
├── packages/*/test/   colocated
└── docs/
    ├── ir-spec.md     normative IR specification
    ├── op-spec.md     normative op specification
    └── mcp.md         tool reference
```

**CI lint rule:** `packages/{ir,ops,derive,scene,shapes}` may not import `react`, `react-dom`, or any DOM global. Enforced by `eslint-plugin-import` boundary rules. This is what keeps the headless core genuinely headless — and it is the rule that makes the agent path a first-class citizen rather than a bolt-on.

---

## 21. Roadmap

Each phase has a testable exit criterion. No phase begins before the previous one's criterion passes.

### Phase 0 — Foundations · 2 weeks
Repo, tooling, CI, lint boundaries. IR schema v1 + validator. Op engine with apply/invert/coalesce. JSON persistence with atomic writes and the journal. Headless CLI that applies an op file to a document and prints the result.

**Exit:** `openchart apply ops.json doc.openchart.json` round-trips a 50-node document; the round-trip property test passes; undo restores exactly.

### Phase 1 — Renderer · 3 weeks
Canvas2D painter with three layers. Camera, culling, dirty rects via rbush. Chrome sprite cache. LOD. Text raster cache. Stats overlay.

**Exit:** 10,000 generated shapes pan and zoom at 60 fps; every phase-0 document renders identically to its SVG export (perceptual hash within tolerance).

### Phase 2 — Shapes and libraries · 2 weeks
Shape runtime (geometry, bounds, anchors, clipping, textareas, controls). Generic + flowchart + integration + network libraries. Simple Icons and Phosphor integrated. Vendor pack installer. Containers with magnetize, titles, assisted layout, auto-grow.

**Exit:** 1,000 shapes from 6 libraries render correctly at all zoom levels; containers nest, magnetize, and auto-grow; vendor packs install and update.

### Phase 3 — Interaction · 3 weeks
Selection and marquee/lasso. Transform handles, rotation, duplication. Snapping and smart guides with Lucid's dotted/solid semantics and live coordinate/distance readouts. Full keyboard map + `F1` overlay. Pages, layers, groups. Text editing overlay. Undo/redo, clipboard, format painter.

**Exit:** every shortcut in §11.5 works; the manual interaction checklist passes; a 200-shape diagram can be built end-to-end without touching the mouse for styling.

### Phase 4 — Connectors · 3 weeks
Anchors and ports. Fast O(1) router with jetties and rounded corners. Curved (centripetal Catmull-Rom) and straight. Line jumps. Labels and protocol chips. libavoid WASM worker for the obstacle-avoiding mode. Waypoint editing.

**Exit:** 1,000 connectors reroute at 60 fps during drag; the obstacle-avoiding router produces zero shape-overlapping segments on the test corpus; jumps render correctly at all zooms.

### Phase 5 — Layout, tokens, Beauty Pass · 3 weeks
ELK worker and the layout adapter. Force, radial, tree. Pinned overrides. Token system and six presets. Conditional formatting with dependency-tracked incremental evaluation. **Beauty Pass** with all eleven steps. Legend and title-block generation.

**Exit:** Beauty Pass on 20 deliberately-ugly seed diagrams produces output that passes a blind human review at ≥ 4/5; idempotence property test passes; 1,000 rules evaluate incrementally in < 16 ms.

### Phase 6 — Agent surface · 2 weeks
MCP server (in-process HTTP + headless stdio). Full tool surface including `get_screenshot`. CLI parity. D2 and Mermaid import/export with round-trip tests. File-watch mode. Guardrails and elicitation gating.

**Exit:** an external agent authors a 30-node integration diagram from a natural-language description over MCP, calls `get_screenshot`, self-corrects the layout, and the result passes the golden-file review; every MCP contract test passes.

### Phase 7 — Export and polish · 2 weeks
SVG/PNG/PDF/PPTX exporters. Print. Preferences. Accessibility pass (canvas-nav mode, alt text, tagged PDF, high-contrast preset). First-run experience and templates.

**Exit:** every exporter matches the on-screen render within perceptual tolerance; the app passes a keyboard-only walkthrough.

### Phase 8 — Performance and hardening · 2 weeks
Benchmark harness in CI with budget gates. Profiling and optimisation against the §17.1 budget. Crash recovery, snapshot rotation, corrupted-file repair. Property and fuzz suites at full depth.

**Exit:** every §17.1 budget met with 20% headroom; the fuzzer runs 10⁶ random op sequences with zero document corruption or partial applies.

**Total: 22 weeks.** Phase 0–3 is the "usable editor" milestone at week 10; Phase 5 is the "beautiful" milestone at week 16; Phase 6 is the "agent is a peer author" milestone at week 18.

---

## 22. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Hand-rolled renderer is slower than hoped | Medium | High | Phase 1 has a hard budget gate before Phase 2 begins; the chrome sprite cache is the primary lever and is built in Phase 1, not deferred |
| Text rendering quality on canvas | Medium | High | Zoom-bucket rasterisation with re-raster on settle; golden-file visual tests at 0.5×/1×/2×; if canvas text proves inadequate, the fallback is per-shape DOM text with the shapes themselves still on canvas (we do **not** fall back to full SVG) |
| ELK licensing becomes a problem | Low | Medium | The layout adapter isolates ELK; `@dagrejs/dagre` (MIT) is a drop-in, weaker-but-adequate fallback |
| libavoid WASM build friction | Medium | Medium | The obstacle-avoiding router is a progressive enhancement — the O(1) router is the default and ships in Phase 4 regardless; libavoid lands behind a flag |
| Tauri WebView divergence in text metrics | Medium | Medium | Never persist text metrics; measure at load; golden files rendered per-platform in CI |
| Beauty Pass produces generic-looking output | Medium | High | It is eleven separable steps, each independently tunable and individually skippable; the style-token layer is designed for iteration after visual review, not frozen at first implementation |
| Agent corrupts a document | Low | High | `dryRun` by default, `baseRev` concurrency, transaction atomicity, strict create plus idempotency keys, 5,000-op cap, atomic writes with snapshot rotation, and 10⁶-sequence fuzzing |
| Scope creep into collaboration | Medium | Medium | §1.2 is a written non-goal; the journal is the only forward-compatibility investment, and it is free |
| Perf budget misses on 10k shapes | Medium | Medium | Lucid's measured cliff is at 10,000 too; LOD and the sprite cache are the levers, and both are Phase 1 deliverables with gates |

---

## 23. Open decisions

1. **ELK vs dagre at 1.0** — quality versus licence cleanliness. Recommendation: ship ELK, keep the adapter honest by running dagre in CI as a second backend.
2. **libavoid at 1.0** — ship behind a flag in Phase 4, promote to default if the visual review prefers it.
3. **Sequence-diagram mode** — as a first-class page type generated from the flow IR, or as a separate diagram kind? Leaning toward a page *view* over the same IR (no data duplication), but this needs a spike.
4. **Templates at 1.0** — how many bundled templates are needed after the SPEL/Plex/ABRA acceptance corpus proves the core workflow.
5. **Snapshot cadence** — time-based, action-count-based, or both.

---

## Appendix A — Verified-source index

Rendering evolution and Blackbird: `lucid.co/techblog/2015/05/19/big-content-in-a-little-canvas`
Canvas-app design layering: `lucid.co/techblog/2023/08/25/design-for-canvas-based-applications`
WebGL renderer + Canvas2D fallback: `help.lucid.co/hc/en-us/articles/360049892331`, `/17480912789908-Troubleshooting-WebGL`
Scale limits: `help.lucid.co/hc/en-us/articles/31077555289492`
Shape libraries: `help.lucid.co/hc/en-us/articles/14931750819476-Shape-libraries-in-Lucidchart`
Custom shape format: `developer.lucid.co/docs/custom-shape-library`, `/docs/geometry-schema`, `/docs/bounds`, `/docs/clipping`, `/docs/shape-data-properties`, `/docs/textareas`
Standard Import schema: `developer.lucid.co/docs/shapes-si`, `/docs/reference-si`, `/docs/container-library-si`
Connectors and line styling: `help.lucid.co/hc/en-us/articles/16157138194836-Add-and-style-lines-in-Lucidchart`
Document settings and line jumps: `help.lucid.co/hc/en-us/articles/15578781626772-Adjust-document-and-board-settings`
Themes: `help.lucid.co/hc/en-us/articles/31943184130452`
Conditional formatting: `help.lucid.co/hc/en-us/articles/16293796201108`
Layers: `help.lucid.co/hc/en-us/articles/16296419779476-Add-layers-to-a-Lucidchart-document`
Keyboard shortcuts: `community.lucid.co/…/list-of-available-keyboard-shortcuts-in-lucid-11502`
Accessibility: `help.lucid.co/hc/en-us/articles/18956546325140`
Export formats: `help.lucid.co/hc/en-us/articles/16324571257492`

Routing: Adaptagrams/libavoid `adaptagrams.org/documentation/libavoid.html`; Wybrow & Marriott GD'09 (`users.monash.edu/~mwybrow/papers/wybrow-gd-2009.pdf`); mxGraph `mxEdgeStyle.js`; ELK layered reference `eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html`; dagre wiki `github.com/dagrejs/dagre/wiki`

IR and round-trip: ELK JSON + `transferLayout` `eclipse.dev/elk/documentation/tooldevelopers/graphdatastructure/jsonformat.html`; D2 layouts and plugin protocol `d2lang.com/tour/layouts/`; Structurizr manual layout `docs.structurizr.com/ui/diagrams/manual-layout`; Excalidraw schema `docs.excalidraw.com/docs/codebase/json-schema`

Diagram aesthetics: Azure Well-Architected design-diagram guidance `learn.microsoft.com/en-us/azure/well-architected/architect-role/design-diagrams`; AWS / Azure / GCP icon sets; Simple Icons (CC0); Phosphor (MIT)

MCP: specification `modelcontextprotocol.io/specification/2026-07-28/`; TypeScript SDK v2 `ts.sdk.modelcontextprotocol.io/v2/`; Figma desktop MCP local-server installation `developers.figma.com/docs/figma-mcp-server/local-server-installation/`; Playwright MCP `github.com/microsoft/playwright-mcp`

---

## Appendix B — The five decisions this plan is really making

1. **Canvas2D, not SVG, not WebGL** — because pixel identity across three WebViews matters more than any other property, and every effect is baked rather than filtered.
2. **Chrome sprite cache** — shadows and gradients cost zero at draw time, and 10,000 shapes become a few hundred `drawImage` calls.
3. **Ops compile to Immer patches** — agents write semantic ops; undo is derived, exact, and free; no hand-written inverses anywhere.
4. **Identity-keyed layout overrides** — the only mechanism that reconciles auto-layout with human intent without fighting.
5. **One op engine, four origins** — GUI, MCP, CLI, and DSL are the same code path. Dual editability is not a feature to build; it is what you get when there is only one way to change the document.

