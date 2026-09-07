import { mkdir, writeFile } from 'node:fs/promises';
import { log } from 'node:console';
import { resolve } from 'node:path';
import { BUILTIN_SHAPE_LIBRARIES } from '../packages/shapes/src/builtin-libraries.js';
import { listShapeLibraries, resolveLibraryShape } from '../packages/shapes/src/libraries-index.js';
import { evaluateShapeDefinition } from '../packages/shapes/src/index.js';
import { buildShapeSceneDescription } from '../packages/scene/src/shapes.js';
import { renderSceneToSvg } from '../packages/serialize/src/index.js';

const output = resolve('.openchart-benchmarks/shape-audit');
await mkdir(output, { recursive: true });
const visible = listShapeLibraries();
const rows = [];
const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
for (const library of visible) {
  for (const entry of library.entries) {
    const result = resolveLibraryShape(library.id, entry.id);
    if (!result.ok) throw new Error(`${entry.id}: ${JSON.stringify(result.diagnostics)}`);
    const evaluated = evaluateShapeDefinition(result.definition);
    if (!evaluated.ok) throw new Error(`${entry.id}: ${JSON.stringify(evaluated.diagnostics)}`);
    rows.push({ id: entry.id, library: library.id, disposition: entry.kind === 'vector' ? 'Upstream artwork retained' : 'Native definition evaluated', geometry: evaluated.shape.geometry.length });
  }
}
for (const library of BUILTIN_SHAPE_LIBRARIES) {
  const cards = [];
  for (const entry of library.entries) {
    const result = evaluateShapeDefinition(entry.definition);
    if (!result.ok) throw new Error(`${entry.id}: ${JSON.stringify(result.diagnostics)}`);
    if (entry.aliasOf !== undefined) {
      if (!visible.some((candidate) => candidate.entries.some((target) => target.id === entry.aliasOf))) throw new Error(`Missing canonical shape for ${entry.id}`);
      rows.push({ id: entry.id, library: library.id, disposition: `Historical alias of ${entry.aliasOf}`, geometry: result.shape.geometry.length });
    }
    const scene = buildShapeSceneDescription([{ id: entry.id, shape: result.shape }], {
      bounds: { x: -12, y: -12, width: entry.defaultSize.width + 24, height: entry.defaultSize.height + 24 },
    });
    const svg = renderSceneToSvg(scene);
    cards.push(`<article${entry.aliasOf === undefined ? '' : ' class="alias"'}>${svg}<strong>${escape(entry.name)}</strong><small>${entry.id}</small>${entry.aliasOf === undefined ? '' : `<em>Alias → ${entry.aliasOf}</em>`}</article>`);
  }
  await writeFile(resolve(output, `${library.id}.html`), `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escape(library.name)} — shape audit</title><style>
    *{box-sizing:border-box}body{margin:0;padding:28px;font:14px 'Segoe UI',sans-serif;color:#183047;background:#f3f6fa}h1{margin:0 0 8px}nav{margin:0 0 20px;display:flex;gap:12px;flex-wrap:wrap}a{color:#185ac1}.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}article{padding:14px;background:white;border:1px solid #dce4ee;border-radius:12px;display:flex;align-items:center;flex-direction:column;gap:5px}svg{width:100%;height:132px}small,em{font-size:10px;color:#61758a;overflow-wrap:anywhere;text-align:center}.alias{border-style:dashed;background:#f7f8fa}.alias svg{opacity:.55}strong{font-size:12px;text-align:center}
    </style><h1>${escape(library.name)}</h1><p>Actual editable vector artwork · dashed cards are historical aliases hidden from discovery.</p><nav>${BUILTIN_SHAPE_LIBRARIES.map((item) => `<a href="${item.id}.html">${escape(item.name)}</a>`).join('')}</nav><div class="grid">${cards.join('')}</div></html>`, 'utf8');
}
await writeFile(resolve(output, 'audit.json'), `${JSON.stringify(rows, null, 2)}\n`);
log(JSON.stringify({ audited: rows.length, native: BUILTIN_SHAPE_LIBRARIES.reduce((sum, library) => sum + library.entries.length, 0), aliases: rows.filter((row) => row.disposition.startsWith('Historical')).length, output }));
