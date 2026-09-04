import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { validateDocument } from '@openchart/ir';
import northstarInput from '../../../examples/northstar-integration.openchart.json';

import { OpenChartEditor } from './index.js';
import { createBlankInitialDocument } from './starter-templates.js';
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

createRoot(rootElement).render(
  <StrictMode>
    <OpenChartEditor initialDocument={createBlankInitialDocument(validation.document)} />
  </StrictMode>,
);
