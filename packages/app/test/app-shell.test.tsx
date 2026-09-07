import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import northstarInput from '../../../examples/northstar-integration.openchart.json';
import { validateDocument } from '@openchart/ir';

import { OpenChartEditor } from '../src/index.js';
import { canvasDropWorldPoint, resolveFrames } from '../src/openchart-editor.js';
import { buildSceneDescription } from '@openchart/scene';
import { renderSceneToSvg } from '@openchart/serialize';
import { parseDesktopDocument } from '../src/desktop-file.js';

describe('OpenChart application shell', () => {
  it('selects and exports derived positions outside the artboard with usable links', () => {
    const document = parseDesktopDocument(JSON.stringify(northstarInput));
    const node = Object.values(document.nodes)[0]!;
    document.layout.overrides[node.id] = { x: 5, y: 5, width: 120, height: 80, pinned: false };
    const frame = { x: -900, y: -600, width: 240, height: 150 };
    document.layout.derived = { [node.id]: frame };
    node.data.link = 'https://example.com/diagram?a=1&b=2';
    expect(resolveFrames(document, node.pageId)[node.id]).toEqual(frame);
    const scene = buildSceneDescription(document, { pageId: node.pageId });
    expect(scene.bounds.x).toBeLessThan(frame.x);
    expect(scene.bounds.y).toBeLessThan(frame.y);
    expect(renderSceneToSvg(scene)).toContain('<a href="https://example.com/diagram?a=1&amp;b=2"');
    node.data.link = 'javascript:alert(1)';
    expect(renderSceneToSvg(buildSceneDescription(document))).not.toContain('<a href=');
  });

  it('renders the canonical document into an accessible drafting workspace', () => {
    const validation = validateDocument(northstarInput);
    expect(validation.ok).toBe(true);
    if (!validation.ok) {
      return;
    }

    const markup = renderToStaticMarkup(
      <OpenChartEditor initialDocument={validation.document} />,
    );

    expect(markup).toContain('aria-label="OpenChart diagram editor"');
    expect(markup).toContain('class="oc-brand-symbol"');
    expect(markup).toContain('class="oc-brand-wordmark"');
    expect(markup).not.toContain('class="oc-brand-mark"');
    expect(markup).toContain('aria-label="Diagram tools"');
    expect(markup).toContain('title="Connector tool"');
    expect(markup).toContain('aria-label="Shape library"');
    expect(markup).toContain('aria-label="Quick insert shapes and icons"');
    expect(markup).toContain('title="Quick insert (Ctrl+Space)"');
    expect(markup).toContain('aria-label="Shape panel category"');
    expect(markup).toContain('<optgroup label="Diagram shapes">');
    expect(markup).toContain('<optgroup label="Decorative icons">');
    expect(markup).toContain('placeholder="Search 5,000+ shapes &amp; icons"');
    expect(markup).toContain('aria-controls="oc-rail-search-results"');
    expect(markup).toContain('aria-label="Catalog result types"');
    expect(markup).toContain('Diagram shapes');
    expect(markup).toContain('<span><i class="is-icon"></i>Icons</span>');
    expect(markup).toContain('data-shape-entry="flowchart.decision"');
    expect(markup).toContain('draggable="true"');
    expect(markup).toContain('aria-label="Drawing tools"');
    expect(markup).toContain('<option value="featured" selected="">All libraries</option>');
    expect(markup).toContain('aria-label="Network library preview"');
    expect(markup).toContain('aria-label="Browse Network"');
    expect(markup).toContain('aria-label="Browse AWS-style services"');
    expect(markup).toContain('aria-label="Browse Simple Icons"');
    const paletteEntries = [...markup.matchAll(/data-shape-entry="([^"]+)"/g)]
      .map((match) => match[1]);
    expect(new Set(paletteEntries).size).toBe(paletteEntries.length);
    const paletteLabels = [...markup.matchAll(/aria-label="Add ([^"]+)"/g)]
      .map((match) => match[1]);
    expect(new Set(paletteLabels).size).toBe(paletteLabels.length);
    expect(markup).toContain('title="Distribute selected shapes horizontally (Ctrl+Shift+H)"');
    expect(markup).toContain('title="Distribute selected shapes vertically (Ctrl+Alt+Shift+V)"');
    expect(markup).toContain('title="Equal spacing on dominant axis (Ctrl+Shift+E)"');
    expect(markup).toContain('>Distribute H</button>');
    expect(markup).toContain('>Distribute V</button>');
    expect(markup).toContain('>Equal space</button>');
    expect(markup).toContain('aria-label="Diagram canvas"');
    expect(markup).toContain('aria-label="Selection inspector"');
    expect(markup).toContain('aria-label="Document pages"');
    expect(markup).toContain('aria-label="Document title"');
    expect(markup).toContain('title="Save document (Ctrl+S)"');
    expect(markup).toContain('title="Export and print"');
    expect(markup).toContain('<span>Export</span>');
    expect(markup.match(/title="Beauty Pass \(Ctrl\+Alt\+B\)"/g)).toHaveLength(1);
    expect(markup).not.toContain('title="Run Beauty Pass"');
    expect(markup).not.toContain('class="oc-ai-diagramming"');
    expect(markup).toContain('Press Control Alt K for canvas navigation');
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain('class="oc-document-kicker"');
    expect(markup).toContain('<div class="oc-status"></div>');
    expect(markup).toContain('Northstar order-to-production architecture');
  });

  it('converts canvas drop screen coordinates through the current camera', () => {
    expect(
      canvasDropWorldPoint(410, 260, { left: 50, top: 80 }, { x: 100, y: -20, zoom: 2 }),
    ).toEqual({ x: 280, y: 70 });
  });

  it('validates editable desktop documents before replacing the live editor', () => {
    expect(parseDesktopDocument(JSON.stringify(northstarInput)).title).toBe(
      'Northstar order-to-production architecture',
    );
    expect(() => parseDesktopDocument('{"schemaVersion":1}')).toThrow(
      'not a valid OpenChart document',
    );
  });

  it('renders with default preferences when browser storage is unavailable', () => {
    const validation = validateDocument(northstarInput);
    expect(validation.ok).toBe(true);
    if (!validation.ok) {
      return;
    }
    const previousWindow = Reflect.get(globalThis, 'window');
    Reflect.set(globalThis, 'window', {
      localStorage: {
        getItem(): never {
          throw new Error('Storage blocked');
        },
      },
    });
    try {
      const markup = renderToStaticMarkup(
        <OpenChartEditor initialDocument={validation.document} />,
      );
      expect(markup).toContain('aria-label="OpenChart diagram editor"');
    } finally {
      if (previousWindow === undefined) {
        Reflect.deleteProperty(globalThis, 'window');
      } else {
        Reflect.set(globalThis, 'window', previousWindow);
      }
    }
  });
});
