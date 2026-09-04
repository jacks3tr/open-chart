# OpenChart — Phase 9: Product Depth and Visual Excellence

**Status:** in progress · last implementation/research pass 3 September 2026
**Supersedes:** nothing. Phases 0–8 of `OPENCHART_PLAN.md` are the engine and are
largely built. This document is the plan for the part that is *not* built: the
content and surface depth that turns a correct engine into a product a diagram
author would choose over Lucidchart.

---

## 0. Why this plan exists

`OPENCHART_PLAN.md` is a very good engine plan, and the engine exists. What does
not yet exist is the product goal:

> a Lucidchart clone that replicates its core diagram-building functionality with
> AAA-quality visuals, prioritising stunningly beautiful integration diagrams,
> architecture diagrams, and system-connectivity visualisations.

The engine does not care how many shapes ship. The product does. The Phase 9
baseline was a technically excellent editor with **forty-four diagram shapes and
plain-string labels**. The current implementation checkpoint has **267 built-in
declarative diagram definitions**, 5,000+ searchable icon/catalog entries, inline
shape/icon quick search, stronger text formatting, explicit connector ports, and
professional connector endpoint markers. The remaining gap is depth and polish,
not a missing editor foundation.

Every claim below marked **[V]** was verified against this repository on
2026-09-02 with the command shown. Claims marked **[R]** come from online
research into Lucidchart and carry the confidence noted. Claims marked **[U]**
are unverified and must not be treated as fact when sequencing work.

### 0.1 Implementation checkpoint — 3 September 2026

The following is implemented in the shared worktree and must be preserved:

- **267 real declarative diagram definitions** across Basic, Generic, Flowchart,
  BPMN, UML, ERD, Integration, Network, Cloud & Architecture, Org chart, and
  Mind map libraries.
- **Full-catalog quick insert** in the primary shape rail, with real previews,
  library labels, Diagram/Icon badges, keyboard insertion, and a handoff into the
  full 5,000+ entry catalog. Curated palette and search results can also be
  dragged directly onto an exact canvas position while retaining click-to-insert.
- **Text UX beyond plain labels:** direct typing on a selected object enters edit
  mode; Escape cancels; font family, size, bold, italic, underline, text colour,
  and alignment are applied through canonical node data/operations and rendered
  consistently across canvas/cache/SVG. Per-range rich text is still outstanding.
- **Professional connector authoring:** explicit north/east/south/west port
  targeting, movable waypoints, route modes, corner radius, label placement,
  line jumps, obstacle avoidance control, editable endpoints, and a
  connect-to-create gesture that can branch a new process directly from a chosen
  source port onto empty canvas.
- **Per-object visual overrides:** shape fill/border colour and text colour can
  be customized without replacing the semantic style role; themes remain the
  baseline when no local override is present.
- **Connector notation backend:** independently configurable start/end markers
  (`none`, filled/open arrow, diamond, circle, bar, crow-foot) survive IR
  validation, canvas rendering, and SVG/export projection. Per-edge width and
  solid/dashed/dotted styling are also canonical routing properties. Legacy
  documents keep the existing no-start/arrow-end and style-token defaults.

This checkpoint is not Phase 9 completion. It is the new floor for subsequent
work; future slices should deepen libraries, text runs, drag-to-create/branching,
and visual styling rather than reimplementing these capabilities.

---

## 1. Verified state of the repository

Reproduce with: `npm run typecheck && npm run lint && npm run build`.

| Property | Verified value |
|---|---|
| TypeScript source (excl. `dist`) | 24,382 lines across 13 packages **[V]** |
| Editor shell | `packages/app/src/openchart-editor.tsx`, 4,863 lines **[V]** |
| Git history | **none** — zero commits, everything untracked **[V]** |
| `npm run typecheck` | passes **[V]** |
| `npm run lint` (`--max-warnings=0`) | passes **[V]** |
| `npm run build` | passes; main bundle 11.7 MB (3.4 MB gzip) **[V]** |
| `npm test` | passes: 42 files / 91 tests on 2026-09-03 **[V]** |

Census command:

```bash
npx tsx -e "import {listShapeLibraries,getShapeLibrary} from './packages/shapes/src/libraries-index.js';
const l=listShapeLibraries(); console.log(l.map(x=>[x.id,getShapeLibrary(x.id)?.entries.length]))"
```

### 1.1 Test-suite uncertainty is resolved

The earlier Phase 9 baseline could not establish whether the root suite was slow
or hung. On 2026-09-03, `npm test` completed normally: **42 test files / 91 tests
passed in 10.91 s**. `npm run build` also completed successfully. This removes the
largest baseline uncertainty and means future Phase 9 slices can use the root
suite as a normal acceptance gate.

### 1.2 The headline number is misleading

The catalogue contains **5,013 entries**. Broken down: **[V]**

| Library | Entries | What it actually is |
|---|---:|---|
| `simple-icons` | 3,457 | brand logos (CC0) |
| `phosphor` | 1,512 | UI glyphs (MIT) |
| `network` | 12 | real diagram shapes |
| `integration` | 12 | real diagram shapes |
| `generic` | 10 | real diagram shapes |
| `flowchart` | 10 | real diagram shapes |
| **Total** | **5,013** | **44 diagram shapes (0.9%)** |

Ninety-nine percent of the library is icons. A user opening OpenChart to draw a
flowchart gets **ten shapes**: process, decision, terminator, data, document,
database, preparation, manual-input, connector, delay. **[V]**

The repository's own fidelity review already flagged this as P3:
*"Lucid's default shape library contains more section utility controls and more
visible generic shapes."* The editor-chrome review graded this P3 because it
compared the editor *chrome*, not the content depth. Against the actual brief —
"robust shape/icon library", "professional and capable diagrams and flowcharts" —
it is P0.

---

## 2. What Lucidchart actually offers (research synthesis)

Research refreshed on **3 September 2026** against current Lucid Help Center
pages, including “Add and customize shapes in Lucidchart” (updated 13 August
2026), “Add and style text in Lucidchart” (updated 24 June 2026), “Create a
flowchart in Lucidchart” (updated 28 May 2026), and the new cloud-frames material
(updated 27 August 2026). These checks sharpen the parity targets below:

- Shape insertion is not just palette click/drag: Lucid supports dragging from
  the shape menu, dragging a line from an existing shape into an auto-prompted
  new shape, and directional round-node branching. OpenChart should therefore
  treat **drag-to-place and connect-to-create** as core authoring, not polish.
- Flowchart connectors default to an arrow but expose endpoint style and size.
  Source and destination arrow styles are also part of Lucid's structured
  process import. OpenChart's endpoint-marker work is therefore a required
  professional-notation feature, not a niche ERD enhancement.
- Current Lucid text controls include font family/size, bold/italic/underline,
  text color and alignment, plus strike-through, super/subscript, bullets,
  numbered lists, line spacing, padding and indentation. OpenChart's current
  whole-object font/alignment controls are only an intermediate slice; per-range
  rich text remains a Phase 9 requirement.
- Lucid is actively deepening architecture workflows with AWS/Azure/GCP cloud
  frames and Cloud Agent tooling. OpenChart remains intentionally local-first and
  does not need the cloud-data backend, but its architecture shape depth,
  containers/boundaries, routing, and output quality must be strong enough that
  a manually authored architecture diagram is first-class.

Sources: Lucid help centre, Lucid developer docs, Lucid community, and review
aggregators. Confidence noted per item.

**Connectors** are Lucid's deepest and most-criticised area.

- Two-tier model: *regular* lines (endpoint pinned to a fixed spot) vs. **smart
  lines** (endpoint recomputes around the perimeter) **[R, high]**.
- A Lucid PM publicly confirmed in April 2025 that smart lines **mis-route past
  roughly three shapes out**, moving endpoints to top/bottom and overlapping
  neighbours — *"working as designed, though not as expected"*, still on the
  backlog **[R, high]**.
- Automatic routing ("auto line routing") is **scoped to containers only**.
  There is **no canvas-global obstacle-avoiding router** **[R, high]**.
- Lucid **does not support user-defined connection points**; the official
  workaround is stacking small boxes **[R, high]**.
- Line shapes: straight / curved / elbow / two-way, **elbow is the default**.
  Width 0.5–10 px. Extras: double, jump, text pill, marker, custom dash **[R, high]**.
- Snap guides have exact semantics: **dotted = edges align, solid = centrelines
  align** **[R, high]**.

**Shape libraries.** Lucid ships many libraries through Shape Manager, including
flowchart, BPMN 2.0, UML, ERD, network, AWS/Azure/GCP, wireframes, mind map, org
chart, and containers **[R, medium]**. The exact count of shapes in the standard
library is **unverified** **[U]** — reasonable estimate 500–1,000 usable shapes
across all libraries, but do not plan against this number.

**Friction points users report** — these are OpenChart's openings **[R, medium]**:

- Smart-line mis-routing (above).
- No global obstacle avoidance.
- No user-defined connection points.
- Performance degradation on large documents.
- Aggressive feature gating — swimlanes, mind maps and wireframes sit behind
  paid tiers.

---

## 3. Gap analysis

Severity is against the user's stated priorities, not against Lucid.

### P0 — blocks the brief

| # | Gap | Evidence |
|---|---|---|
| 1 | **44 diagram shapes.** No BPMN, UML, ERD, basic shapes, arrows, callouts, wireframes, mind map, org chart, swimlanes, or cloud-provider architecture. | census **[V]** |
| 2 | **No rich text.** `NodeSchema.label` and `EdgeSchema.label` are `z.string()`. No bold/italic/underline, no per-run font, size or colour, no alignment, no bullets, no hyperlinks. | `packages/ir/src/index.ts` **[V]** |
| 3 | **One arrowhead.** The scene renderer hardcodes `markerEnd: { type: 'arrow', size: 7 }`. No line-end variety, no double lines, no text pills. | `packages/scene/src/index.ts:1561,1574` **[V]** |

### P1 — materially affects perceived quality

| # | Gap | Note |
|---|---|---|
| 4 | No bundled template gallery for the three priority genres. | Phase 7 shipped templates; depth unknown **[U]** |
| 5 | Main bundle 11.7 MB. The icon catalogue is inlined; it should be lazy-loaded. | build output **[V]** |
| 6 | Shape styling is token-driven (`Style = {role, tokens}`). Free-form per-shape fill, gradient, border and shadow editing may be limited. | IR **[V]**, editor behaviour **[U]** |

### P2 — parity, not advantage

| # | Gap |
|---|---|
| 7 | No Visio / draw.io / BPMN import. |
| 8 | Minimap, presentation mode — presence unknown **[U]**. |

### Where OpenChart is already ahead

Do not regress these.

- **`side: 'auto'` ports.** Shapes declare four directional ports
  (`west-in`, `north-in`, `east-out`, `south-out`), but the editor creates ports
  with `side: 'auto'` at connect time **[V]** — so the router picks the best side
  instead of forcing the user to hit one of sixteen fixed points. This is
  strictly better than Lucid's model.
- **Canvas-global routing.** `EdgeRouting.avoidObstacles` exists in the IR **[V]**.
  Lucid has no canvas-global router at all **[R, high]**. Ship it as the default.
- **Line jumps** with `arc | gap | square` **[V]** — matches Lucid **[R, high]**.
- **Local-first.** No account, no cloud, no latency. Lucid cannot match this.

---

## 4. Plan

Non-goals (unchanged from `OPENCHART_PLAN.md` §1.2, and now re-asserted):
landing pages, authentication, billing, cloud sync, collaboration, comments,
sharing. Do not build them, do not design for them.

### 9.1 — Shape library, wave 1: the genres in the brief

Author shapes as `kind: 'definition'` entries using the existing declarative
runtime (geometry, textareas, ports, controls, clipping, nested shapes —
`packages/shapes/src/types.ts`). Do **not** add raw SVG blobs; definitions
compose, theme, and stay editable.

Target ~450 curated definitions across:

| Library | Count | Contents |
|---|---:|---|
| `basic` | ~45 | arrows, chevrons, callouts, banners, stars, brackets, braces, badges |
| `flowchart-ext` | ~40 | full ISO set: predefined process, stored data, internal storage, sequential access, direct data, manual operation, collate, sort, merge, extract, or, junction, off-page connector, loop limit, display, punch card, magnetic disk |
| `bpmn` | ~50 | start/message/timer/error/end events, exclusive/parallel/inclusive/complex gateways, task, subprocess, transaction, data object/store/message, pools and lanes |
| `uml` | ~60 | class, interface, enum, package, note, actor, use case, component, node, artifact, deployment node, state, activity, decision, fork, join, lifeline |
| `erd` | ~20 | entity, weak entity, relationship, weak relationship, attribute, multivalued, derived, key |
| `cloud` | ~80 | region, VPC, subnet, AZ, load balancer, API gateway, CDN, cache, queue, topic, stream, function, container registry, managed DB, object store, identity, WAF, per-provider variants |
| `network-ext` | ~40 | rack, L2/L3 switch, router, firewall, IDS/IPS, WAF, VPN concentrator, SD-WAN, satellite, IoT gateway, PLC, terminal server |
| `orgchart` | ~10 | position, assistant, department, vacancy |
| `mindmap` | ~8 | central topic, main topic, subtopic, floating topic, callout |
| `wireframe` | ~40 | browser, mobile frame, button, input, checkbox, radio, select, modal, tab bar, card, table, image placeholder |

Every entry needs: `id`, `name`, lowercase `tags`, `defaultSize`, `composition`,
`provenance`, `definition`, and at least one `textArea` bound to `=@Label`.

**Exit:** a 1,000-shape corpus drawn from all libraries renders correctly at
0.5×/1×/2×; every definition passes `validateShapeLibraries`; a flowchart, a
BPMN process, and a UML class diagram can each be drawn without a missing shape.

### 9.2 — Rich text

Add a `TextSpan` union to the IR and thread it through scene → canvas →
inline editor.

- `label: string | TextSpan[]`, backwards compatible: a bare string is one span.
- Span attributes: `weight`, `style`, `underline`, `fontFamily`, `size`, `color`,
  `href`, `baseline`.
- Block attributes: horizontal align, vertical align, bullet list, line height, padding.
- Inline editor: select a range → formatting applies to the selection.
- Renderer: `measureText` per span; the text raster cache keys on span content.

**Exit:** bold/italic/underline/colour/size apply to a selection and survive
save, reload, undo/redo, and copy/paste; export matches the screen.

### 9.3 — Connector line ends and line styles

- Line-end set at both ends: none, arrow, open arrow, diamond, filled diamond,
  circle, filled circle, bar, crow's-foot, double arrow.
- Line styles: single, double, dashed variants, text pill, marker.
- Bind `s` to cycle straight → elbow → curved while drawing.

**Exit:** every combination renders correctly at all zooms, exports, and
round-trips; the arrowhead set covers the ERD crow's-foot notation that §9.1
introduces.

### 9.4 — Make the advantages visible

- Turn on canvas-global obstacle avoidance by default. Lucid cannot do this.
- Ship user-defined connection points. Lucid cannot do this.
- Add a "Tidy up" one-key auto-layout for the selected subgraph.

### 9.5 — Templates for the three genres

Six bundled, genuinely beautiful starters: integration (two), architecture
(two), system connectivity (two). Each must be a real diagram, not a placeholder.

### 9.6 — Bundle and polish

- Lazy-load the icon catalogue; target under 2 MB initial bundle.
- Re-run the Lucid editor-chrome fidelity review against the new libraries.

---

## 5. Sequencing

9.1 and 9.2 are independent and can run in parallel. 9.3 depends on nothing but
should land before 9.5, because the templates need good line ends. 9.6 last.

Do **not** start 9.4 or 9.5 until 9.1 is complete — pretty templates over a
44-shape library would be polish on a hole.

---

## 6. Acceptance

The phase is done when a user who has never seen OpenChart can, without a
missing shape, draw:

1. a BPMN 2.0 process with pools, lanes, gateways and message events;
2. a UML class diagram with inheritance, composition and multiplicity;
3. a three-tier AWS-style architecture with VPC boundary, subnets and managed services;
4. an integration flow with queues, topics, dead-lettering and retry;

and each of the four looks better than the equivalent drawn in Lucidchart,
with the document surviving save → reload → undo → export identical.

---

## 7. Open items

1. **No commits exist.** Everything is untracked. There is no baseline to revert
   to. This should be fixed first.
2. **Lucid's standard-library shape count is unverified.** Do not plan to a number.
3. **`side: 'auto'` port behaviour is verified in code but not observed in the
   running editor.** Worth confirming by hand before 9.4.

