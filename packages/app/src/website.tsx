import { useMemo, useRef, useState } from 'react';
import type { OpenChartDocument } from '@openchart/ir';
import { OperationEngine } from '@openchart/ops';
import { renderDocumentToSvg } from '@openchart/serialize';
import plus from '@phosphor-icons/core/regular/plus.svg';
import arrow from '@phosphor-icons/core/regular/arrow-up-right.svg';
import folder from '@phosphor-icons/core/regular/folder-open.svg';
import download from '@phosphor-icons/core/regular/download-simple.svg';
import grid from '@phosphor-icons/core/regular/squares-four.svg';
import file from '@phosphor-icons/core/regular/file.svg';
import { OpenChartEditor } from './openchart-editor.js';
import { createBlankInitialDocument } from './initial-document.js';
import { parseDesktopDocument } from './desktop-file.js';
import { STARTER_TEMPLATES, createStarterTemplateTransaction, type StarterTemplateDefinition } from './starter-templates.js';
import './website.css';

function Icon({ src }: { src: string }) { return <img className="web-icon" src={src} alt="" />; }

function templateDocument(base: OpenChartDocument, template: StarterTemplateDefinition) {
  const engine = new OperationEngine({ ...createBlankInitialDocument(base), title: template.name });
  const page = Object.values(base.pages)[0]!;
  const layer = Object.values(base.layers).find((candidate) => candidate.pageId === page.id)!;
  const transaction = createStarterTemplateTransaction(engine.document, template, {
    txId: `website-${template.id}`, pageId: page.id, layerId: layer.id,
  });
  const result = engine.apply(transaction.envelope);
  if (!result.ok) throw new Error(result.diagnostics[0]?.message ?? 'Could not create template');
  return engine.document;
}

export function OpenChartWebsite({ base }: { base: OpenChartDocument }) {
  const [active, setActive] = useState<{ document: OpenChartDocument; filename?: string }>();
  const [home, setHome] = useState(true);
  const [session, setSession] = useState(0);
  const [category, setCategory] = useState('All templates');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const templates = useMemo(() => STARTER_TEMPLATES.map((template) => {
    const document = templateDocument(base, template);
    return { template, document, preview: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderDocumentToSvg(document))}` };
  }), [base]);

  function open(document: OpenChartDocument, filename?: string) {
    if (active && !window.confirm('Start another diagram? Download your current work first if you want to keep it.')) return;
    setActive({ document, ...(filename === undefined ? {} : { filename }) }); setSession((value) => value + 1); setHome(false); setError('');
  }

  return <div className="web-shell" onKeyDownCapture={home ? (event) => event.stopPropagation() : undefined}>
    <header className="web-header">
      <button className="web-brand" onClick={() => setHome(true)} aria-label="OpenChart home"><img src="/openchart.svg" alt="" />OpenChart</button>
      <nav aria-label="Website navigation"><a href="https://github.com/jacks3tr/open-chart" target="_blank" rel="noreferrer">GitHub <Icon src={arrow} /></a></nav>
    </header>
    <main className="web-home" hidden={!home}>
      <div className="web-heading"><h1>Diagrams</h1><div className="web-actions"><button className="web-button web-secondary" onClick={() => input.current?.click()}><Icon src={folder} />Open file</button><button className="web-button web-primary" onClick={() => open(createBlankInitialDocument(base))}><Icon src={plus} />New diagram</button></div></div>
      <input ref={input} type="file" accept=".json,.openchart.json,.openchart,application/json" hidden onChange={(event) => {
        const selected = event.currentTarget.files?.[0]; event.currentTarget.value = '';
        if (selected) void selected.text().then((text) => open(parseDesktopDocument(text), selected.name)).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Unable to open this file.'));
      }} />
      {error && <p role="alert" className="web-error">{error}</p>}
      {active && <button className="web-resume" onClick={() => setHome(false)}>Your diagram is still open. <strong>Return to editor →</strong></button>}
      <section className="web-diagram" aria-labelledby="flow-example-title">
        <h2 id="flow-example-title">From thought to flow</h2>
        <svg viewBox="0 0 500 240" role="img" aria-label="An idea connects to a plan, branches into building and refining, then comes together as a finished result.">
          <defs><marker id="web-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0 0L6 3L0 6" fill="none" stroke="#8298ba" /></marker></defs>
          <g fill="none" stroke="#8298ba" strokeWidth="1.5" markerEnd="url(#web-arrow)"><path d="M105 120H160"/><path d="M230 120H253V58H288"/><path d="M230 120H253V183H288"/><path d="M383 58H418V120H452"/><path d="M383 183H418V120"/></g>
          <rect x="15" y="94" width="90" height="52" rx="26" fill="#eaf2ff" stroke="#82a9ef"/><path d="M195 85L230 120L195 155L160 120Z" fill="#fff" stroke="#789ddd"/><rect x="288" y="33" width="95" height="50" rx="9" fill="#fff" stroke="#789ddd"/><rect x="288" y="158" width="95" height="50" rx="9" fill="#fff" stroke="#789ddd"/><circle cx="468" cy="120" r="16" fill="#155eef"/><path d="M461 120L466 125L475 115" fill="none" stroke="white" strokeWidth="2"/>
          <g fontFamily="IBM Plex Sans, sans-serif" fontSize="14" fill="#223650" textAnchor="middle"><text x="60" y="125">An idea</text><text x="195" y="125">Plan</text><text x="335" y="63">Build</text><text x="335" y="188">Refine</text></g>
        </svg>
      </section>
      <section className="web-templates" aria-labelledby="templates-title"><div className="web-section-heading"><h2 id="templates-title">Templates</h2></div>
        <div className="web-filters" aria-label="Filter templates">{['All templates', 'Process', 'Architecture', 'Data & networks'].map((label) => <button key={label} aria-pressed={category === label} onClick={() => setCategory(label)}>{label === 'All templates' && <Icon src={grid} />}{label}</button>)}</div>
        <div className="web-template-grid">{templates.filter(({ template }) => category === 'All templates' || (category === 'Process' ? template.id === 'flowchart' : category === 'Architecture' ? ['mes-erp', 'integration', 'cloud'].includes(template.id) : ['uml-erd', 'network'].includes(template.id))).map(({ template, document, preview }) => <button className="web-template" key={template.id} onClick={() => open(document)}>
          <div className={`web-template-preview web-preview-${template.id}`}><img src={preview} alt={`${template.name} preview`} /><span>Use template <Icon src={arrow} /></span></div><div className="web-template-meta"><div><small>{template.section}</small><h3>{template.name}</h3></div><Icon src={arrow} /></div>
        </button>)}</div>
      </section>
      <section className="web-export" aria-labelledby="export-title"><div className="web-export-icon"><Icon src={download} /></div><div><h2 id="export-title">Export</h2><p>Download from the editor. Save as JSON to edit later.</p></div><div className="web-formats">{['SVG', 'PNG', 'PDF', 'PPTX', 'JSON'].map((format) => <span key={format}><Icon src={file} />{format}</span>)}</div></section>

    </main>
    {active && <div className="web-editor" hidden={home}><OpenChartEditor key={session} initialDocument={active.document} {...(active.filename === undefined ? {} : { initialFilename: active.filename })} /></div>}
  </div>;
}
