import { describe, expect, it } from 'vitest';

import type { SceneDescription } from '@openchart/scene';

import { renderSceneToSvg } from '../src/index.js';

describe('renderSceneToSvg text formatting', () => {
  it('serializes text color and underline semantics without changing plain text defaults', () => {
    const scene: SceneDescription = {
      version: 1,
      bounds: { x: 0, y: 0, width: 240, height: 100 },
      title: 'Text formatting',
      description: 'Whole-object text formatting proof.',
      items: [
        {
          type: 'text',
          id: 'plain',
          value: 'Plain',
          at: { x: 20, y: 30 },
          fill: '#10213A',
          fontFamily: 'Segoe UI, sans-serif',
          fontSize: 16,
        },
        {
          type: 'text',
          id: 'styled',
          value: 'Styled',
          at: { x: 20, y: 70 },
          fill: '#7C3AED',
          fontFamily: 'Segoe UI, sans-serif',
          fontSize: 16,
          underline: true,
        },
      ],
    };

    const svg = renderSceneToSvg(scene);

    expect(svg).toContain('id="plain" x="20" y="30" fill="#10213A"');
    expect(svg).toContain('id="styled" x="20" y="70" fill="#7C3AED"');
    expect(svg).toContain('text-decoration="underline"');
    expect(svg.match(/text-decoration=/g)).toHaveLength(1);
  });
});
