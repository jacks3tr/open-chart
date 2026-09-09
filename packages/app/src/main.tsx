import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { validateDocument } from '@openchart/ir';
import northstarInput from '../../../examples/northstar-integration.openchart.json';

import { OpenChartEditor } from './index.js';
import { createBlankInitialDocument } from './initial-document.js';
import { isDesktopRuntime } from './desktop-file.js';
import { OpenChartWebsite } from './website.js';
import './openchart-editor.css';

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('OpenChart root element is missing');
}

const validation = validateDocument(northstarInput);
if (!validation.ok) {
  const message = validation.diagnostics
    .map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`)
    .join('\n');
  throw new Error(`The bundled OpenChart example is invalid:\n${message}`);
}

// Canvas text caches must start with the bundled fonts, not a fallback face.
await Promise.all([
  ...[400, 500, 600, 700].map((weight) => document.fonts.load(`${weight} 12px "IBM Plex Sans"`)),
  document.fonts.load('italic 400 12px "IBM Plex Sans"'),
  document.fonts.load('italic 700 12px "IBM Plex Sans"'),
  document.fonts.load('12px "IBM Plex Mono"'),
]);

createRoot(rootElement).render(
  <StrictMode>
    {isDesktopRuntime()
      ? <OpenChartEditor initialDocument={createBlankInitialDocument(validation.document)} />
      : <OpenChartWebsite base={validation.document} />}
  </StrictMode>,
);
