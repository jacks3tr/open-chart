import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { validateDocument } from '@openchart/ir';
import { buildSceneDescription, type SceneDescription } from '@openchart/scene';

import { renderDocumentToSvg, renderSceneToSvg } from '../src/index.js';

const fixturePath = fileURLToPath(
  new URL('../../../examples/northstar-integration.openchart.json', import.meta.url),
);

describe('renderDocumentToSvg', () => {
  it('renders a polished, accessible integration artboard from canonical IR', () => {
    const input: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const validation = validateDocument(input);
    if (!validation.ok) {
      throw new Error(`Invalid visual fixture: ${JSON.stringify(validation.diagnostics)}`);
    }

    const scene = buildSceneDescription(validation.document);
    const svg = renderSceneToSvg(scene);

    expect(renderDocumentToSvg(validation.document)).toBe(svg);
    expect(svg).toContain('<svg');
    expect(svg).toContain('role="img"');
    expect(svg).toContain('viewBox="0 0 1440 920"');
    expect(svg).toContain('Northstar ERP');
    expect(svg).toContain('INTEGRATION FABRIC');
    expect(svg).toContain('data-edge-id="edge.master-ingress"');
    expect(svg.match(/data-node-id=/g)).toHaveLength(6);
    expect(svg.match(/data-edge-id=/g)).toHaveLength(7);
    expect(svg).not.toContain('undefined');
    expect(svg).not.toContain('[object Object]');
  });

  it('serializes cubic paths with group rotation and clipping', () => {
    const scene: SceneDescription = {
      version: 1,
      bounds: { x: 0, y: 0, width: 100, height: 80 },
      title: 'Shape features',
      description: 'Cubic path, rotation, and clip proof.',
      items: [
        {
          id: 'artboard',
          type: 'group',
          role: 'artboard',
          children: [
            {
              id: 'shape-group',
              type: 'group',
              role: 'shape',
              composition: 'circle',
              transform: { rotation: 30, origin: { x: 40, y: 30 } },
              clip: {
                items: [
                  {
                    id: 'clip-window',
                    type: 'rect',
                    frame: { x: 10, y: 10, width: 60, height: 40 },
                    radius: 8,
                  },
                ],
              },
              children: [
                {
                  id: 'curve',
                  type: 'path',
                  commands: [
                    { type: 'move', to: { x: 20, y: 20 } },
                    {
                      type: 'cubic',
                      control1: { x: 30, y: 10 },
                      control2: { x: 50, y: 30 },
                      to: { x: 60, y: 20 },
                    },
                  ],
                  fill: 'none',
                  stroke: '#2563EB',
                  strokeWidth: 2,
                },
              ],
            },
          ],
        },
      ],
    };

    const svg = renderSceneToSvg(scene);
    expect(svg).toContain(
      '<clipPath id="oc-clip-shape-group" clipPathUnits="userSpaceOnUse"><rect x="10" y="10" width="60" height="40" rx="8"/></clipPath>',
    );
    expect(svg).toContain(
      'data-composition="circle" transform="rotate(30 40 30)" clip-path="url(#oc-clip-shape-group)"',
    );
    expect(svg).toContain('d="M 20 20 C 30 10 50 30 60 20"');
  });
});
