# Shape catalog

The native catalog contains 397 discoverable diagram entries and 33 historical
aliases. All 430 native definitions remain resolvable, so existing documents keep
their shape references. Search includes alias names and keywords on the canonical
entry. Provider-specific services remain separate because they identify different
products. Simple Icons and Phosphor retain their upstream artwork and provenance.

## Artwork

Technical symbols are original editable vectors: load balancers show routing
fan-out, routers show directional ports, switches show sockets, servers show rack
units, and caches use chip silhouettes. Storage, messaging, security, compute and
cloud families share stroke weight, restrained accent layers and clear label space.
AWS-, Azure- and GCP-style entries use these OpenChart symbols with provider colors;
they are not official vendor icon reproductions.

Flowchart, BPMN, UML and ERD entries preserve recognizable diagram notation while
improving outlines, type markers and text placement. Basic arrows, ribbons and
callouts have distinct silhouettes. Container headers reserve room for content.
These libraries are visual diagramming tools, not notation validators.

The **All libraries** overview groups up to six shape previews per library.
Use a library header's **+** to open its filtered list, and **← All libraries**
to return. Native libraries show their complete lists; large icon packs show
up to 60 results with access to the full catalog. Icon artwork loads on demand.

Palette tiles render the same geometry used on the canvas. Previews evaluate at
the shape's native dimensions before scaling to avoid oversized thumbnail strokes.
Shapes continue to use existing colors, text editing, ports, exports and undo.

## Audit

Run from the repository root:

```powershell
npx tsx scripts/audit-shapes.mjs
npm run check
```

The audit evaluates all 5,399 entries, verifies alias targets, and writes
`.openchart-benchmarks/shape-audit/audit.json` plus one HTML contact sheet per native
library. Open `network.html` and follow the library links to review every native
shape through the existing SVG scene renderer. Dashed cards mark hidden aliases.
Generated files are ignored by Git. Evaluation verifies executable definitions;
contact sheets are the separate visual-review surface.

The native-library review covers basic shapes, generic, flowchart, BPMN, UML, ERD,
integration, network, architecture, org chart, mind map, and the three cloud
service libraries. Upstream decorative icons are evaluated but not individually
redrawn.
