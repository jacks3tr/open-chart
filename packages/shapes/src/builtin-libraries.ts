import { technicalGeometry, type TechnicalSymbol } from './technical-geometry.js';
import {
  SHAPE_LIBRARY_CATALOG_VERSION,
  type ShapeDefinitionLibraryEntry,
  type ShapeLibrary,
} from './library-types.js';
import {
  SHAPE_DEFINITION_VERSION,
  type ShapeDefinition,
  type ShapeGeometryDefinition,
} from './types.js';

type BuiltinVariant =
  | 'text'
  | 'card'
  | 'ellipse'
  | 'diamond'
  | 'hexagon'
  | 'parallelogram'
  | 'database'
  | 'document'
  | 'cloud'
  | 'queue'
  | 'firewall'
  | 'router'
  | 'switch'
  | 'client'
  | 'user'
  | 'load-balancer'
  | 'triangle'
  | 'trapezoid'
  | 'note'
  | 'package'
  | 'bpmn-event'
  | 'bpmn-task'
  | 'bpmn-gateway'
  | 'uml-class'
  | 'uml-interface'
  | 'erd-entity'
  | 'erd-relationship'
  | 'actor'
  | 'folder'
  | 'predefined-process'
  | 'manual-operation'
  | 'display'
  | 'off-page'
  | 'multi-document'
  | 'architecture-zone'
  | 'arrow'
  | 'left-arrow'
  | 'callout'
  | 'swimlane'
  | 'uml-component'
  | 'deployment-node'
  | 'state-choice'
  | 'chevron'
  | 'lifeline'
  | 'rack'
  | 'message'
  | 'summing-junction'
  | 'manual-input'
  | 'delay'
  | 'up-arrow'
  | 'down-arrow';

const DETACHED_LABEL_VARIANTS = new Set<BuiltinVariant>([
  'queue',
  'firewall',
  'router',
  'switch',
  'client',
  'user',
  'load-balancer',
  'actor',
  'message',
  'bpmn-event',
  'bpmn-gateway',
  'summing-junction',
  'up-arrow',
  'down-arrow',
]);

interface BuiltinSpec {
  readonly id: string;
  readonly name: string;
  readonly tags: readonly string[];
  readonly variant: BuiltinVariant;
  readonly symbol?: TechnicalSymbol;
  readonly aliasOf?: string;
  readonly accent: string;
  readonly surface: string;
  readonly composition?: 'above' | 'left' | 'circle';
  readonly width?: number;
  readonly height?: number;
  readonly dashed?: boolean;
}

const MIT_LICENSE = {
  name: 'MIT',
  url: 'https://opensource.org/license/mit',
} as const;

const BUILTIN_SOURCE = 'openchart://libraries';

function basePaint(spec: BuiltinSpec): {
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly dash?: readonly number[];
} {
  return {
    fill: '=@Surface',
    stroke: '=@Accent',
    strokeWidth: 1.8,
    ...(spec.dashed === true ? { dash: [6, 3] } : {}),
  };
}

function variantGeometry(spec: BuiltinSpec): readonly ShapeGeometryDefinition[] {
  if (spec.variant === 'text') return [{ id: 'body', type: 'rect', fill: 'none', stroke: 'none' }];
  const paint = basePaint(spec);
  const line = (id: string, points: readonly (readonly [number, number])[]): ShapeGeometryDefinition => ({
    id, type: 'path', fill: 'none', stroke: '=@Accent', strokeWidth: 1.8,
    commands: points.map(([x, y], i) => ({ type: i === 0 ? 'move' as const : 'line' as const, x, y })),
  });
  const polygon = (points: readonly (readonly [number, number])[]): ShapeGeometryDefinition => ({
    id: 'body', type: 'polygon', points: points.map(([x, y]) => ({ x, y })), ...paint,
  });
  if (['erd.one', 'erd.zero-one', 'erd.one-many', 'erd.zero-many'].includes(spec.id)) return [
    line('relationship-line', [[.08, .36], [.92, .36]]),
    ...(spec.id.includes('zero') ? [{ id: 'optional', type: 'ellipse' as const, x: .22, y: .22, w: .18, h: .28, ...paint }]
      : [line('required', [[.32, .17], [.32, .55]])]),
    ...(spec.id.includes('many') ? [line('crowfoot', [[.89, .12], [.59, .36], [.89, .6]])]
      : [line('one', [[.69, .17], [.69, .55]])]),
  ];
  if (spec.id === 'basic.left-callout') return [polygon([[.2, .06], [.96, .06], [.96, .94], [.2, .94], [.2, .62], [.03, .5], [.2, .38]])];
  if (spec.id === 'basic.banner') return [polygon([[.04, .1], [.96, .1], [.82, .5], [.96, .9], [.04, .9], [.18, .5]])];
  if (spec.id === 'basic.ribbon') return [
    polygon([[.04, .25], [.22, .25], [.22, .9], [.04, .9], [.11, .57]]),
    { ...polygon([[.78, .25], [.96, .25], [.89, .57], [.96, .9], [.78, .9]]), id: 'right-tail' },
    { id: 'front', type: 'rect', x: .17, y: .08, w: .66, h: .66, radius: 3, ...paint },
    line('left-fold', [[.17, .74], [.22, .9]]), line('right-fold', [[.83, .74], [.78, .9]]),
  ];
  if (spec.id === 'uml.send-signal') return [polygon([[.04, .08], [.7, .08], [.96, .5], [.7, .92], [.04, .92]])];
  if (spec.id === 'uml.accept-event') return [polygon([[.04, .08], [.96, .08], [.96, .92], [.04, .92], [.3, .5]])];
  if (spec.id === 'erd.key-attribute') return [{ id: 'body', type: 'ellipse', ...paint }, line('key-underline', [[.24, .63], [.76, .63]])];
  if (spec.id === 'flowchart.stored-data' || spec.id === 'flowchart.online-storage') return [{
    id: 'body', type: 'path', commands: [
      { type: 'move', x: .2, y: .04 }, { type: 'line', x: .95, y: .04 },
      { type: 'cubic', c1x: .7, c1y: .2, c2x: .7, c2y: .8, x: .95, y: .96 },
      { type: 'line', x: .2, y: .96 }, { type: 'cubic', c1x: -.02, c1y: .8, c2x: -.02, c2y: .2, x: .2, y: .04 }, { type: 'close' },
    ], ...paint,
  }];
  if (spec.id === 'flowchart.direct-access-storage') return [{
    id: 'body', type: 'path', commands: [
      { type: 'move', x: .2, y: .04 }, { type: 'line', x: .8, y: .04 },
      { type: 'cubic', c1x: 1.02, c1y: .04, c2x: 1.02, c2y: .96, x: .8, y: .96 },
      { type: 'line', x: .2, y: .96 }, { type: 'cubic', c1x: -.02, c1y: .96, c2x: -.02, c2y: .04, x: .2, y: .04 }, { type: 'close' },
    ], ...paint,
  }, { id: 'disk-face', type: 'ellipse', x: .68, y: .04, w: .27, h: .92, ...paint }];
  if (spec.id === 'flowchart.sequential-access-storage') return [
    { id: 'body', type: 'ellipse', x: .08, y: .04, w: .8, h: .85, ...paint },
    line('tape-end', [[.48, .89], [.94, .89], [.94, .75]]),
  ];
  if (spec.id === 'flowchart.manual-file') return [polygon([[.05, .06], [.95, .06], [.5, .94]])];
  if (spec.id === 'flowchart.collate') return [polygon([[.08, .05], [.92, .05], [.08, .69], [.92, .69], [.08, .05]])];
  if (spec.id === 'flowchart.merge') return [polygon([[.05, .06], [.95, .06], [.5, .94]])];
  if (spec.id === 'flowchart.sort') return [polygon([[.5, .03], [.97, .5], [.5, .97], [.03, .5]]), line('divider', [[.03, .5], [.97, .5]])];
  if (spec.id === 'flowchart.card') return [polygon([[.18, .04], [.96, .04], [.96, .96], [.04, .96], [.04, .2]])];
  if (spec.id === 'flowchart.internal-storage') return [{ id: 'body', type: 'rect', radius: 4, ...paint },
    line('partition', [[.16, 0], [.16, 1]]), line('header', [[0, .18], [1, .18]])];
  if (spec.id === 'flowchart.or') return [{ id: 'body', type: 'ellipse', x: .17, y: .04, w: .66, h: .66, ...paint }, ...notationMarker('exclusive', .31, .18, .38, .38)];
  if (spec.id === 'flowchart.parallel-mode') return [polygon([[.04, .26], [.96, .26], [.96, .32], [.04, .32]]),
    { ...polygon([[.04, .55], [.96, .55], [.96, .61], [.04, .61]]), id: 'lower' }];
  if (spec.id === 'flowchart.communication-link') return [polygon([[.04, .35], [.42, .1], [.5, .37], [.96, .15], [.57, .7], [.5, .44], [.04, .66]])];
  if (spec.id === 'basic.double-chevron') return [polygon([[.04, .04], [.25, .04], [.52, .36], [.25, .68], [.04, .68], [.3, .36]]),
    { ...polygon([[.47, .04], [.68, .04], [.95, .36], [.68, .68], [.47, .68], [.73, .36]]), id: 'second' }];
  if (spec.id === 'bpmn.text-annotation' || spec.id === 'basic.bracket-container') return [line('bracket', [[.24, .04], [.04, .04], [.04, .96], [.24, .96]])];

  switch (spec.variant) {
    case 'manual-input':
      return [{ id: 'body', type: 'polygon', points: [{ x: .03, y: .2 }, { x: .97, y: .04 }, { x: .97, y: .96 }, { x: .03, y: .96 }], ...paint }];
    case 'delay':
      return [{ id: 'body', type: 'path', commands: [{ type: 'move', x: .05, y: .04 }, { type: 'line', x: .52, y: .04 },
        { type: 'cubic', c1x: 1.1, c1y: .04, c2x: 1.1, c2y: .96, x: .52, y: .96 }, { type: 'line', x: .05, y: .96 }, { type: 'close' }], ...paint }];
    case 'up-arrow':
    case 'down-arrow': {
      const points = [[.5, .03], [.95, .37], [.67, .37], [.67, .97], [.33, .97], [.33, .37], [.05, .37]];
      return [{ id: 'body', type: 'polygon', points: points.map(([x, y]) => ({ x: x!, y: (spec.variant === 'down-arrow' ? 1 - y! : y!) * .72 })), ...paint }];
    }
    case 'ellipse':
      return [{ id: 'body', type: 'ellipse', ...paint,
        ...(spec.id === 'uml.initial-state' || spec.id === 'uml.junction' ? { x: .2, y: .04, w: .6, h: .6 } : {}),
      }];
    case 'diamond':
      return [
        {
          id: 'body',
          type: 'polygon',
          points: [
            { x: 0.5, y: 0 },
            { x: 1, y: 0.5 },
            { x: 0.5, y: 1 },
            { x: 0, y: 0.5 },
          ],
          ...paint,
        },
      ];
    case 'hexagon':
      return [
        {
          id: 'body',
          type: 'polygon',
          points: [
            { x: 0.18, y: 0 },
            { x: 0.82, y: 0 },
            { x: 1, y: 0.5 },
            { x: 0.82, y: 1 },
            { x: 0.18, y: 1 },
            { x: 0, y: 0.5 },
          ],
          ...paint,
        },
      ];
    case 'parallelogram':
      return [
        {
          id: 'body',
          type: 'polygon',
          points: [
            { x: 0.14, y: 0 },
            { x: 1, y: 0 },
            { x: 0.86, y: 1 },
            { x: 0, y: 1 },
          ],
          ...paint,
        },
      ];
    case 'database':
      return [
        { id: 'body', type: 'path', ...paint, commands: [{ type: 'move', x: .05, y: .16 }, { type: 'line', x: .05, y: .82 },
          { type: 'cubic', c1x: .05, c1y: 1, c2x: .95, c2y: 1, x: .95, y: .82 }, { type: 'line', x: .95, y: .16 }, { type: 'close' }] },
        { id: 'top', type: 'ellipse', x: .05, y: .04, w: .9, h: .24, ...paint },
        { id: 'top-tone', type: 'ellipse', x: .08, y: .06, w: .84, h: .2, fill: '=@Accent', fillOpacity: .08 },
      ];
    case 'document':
      return [
        {
          id: 'body',
          type: 'path',
          commands: [
            { type: 'move', x: 0.04, y: 0.04 },
            { type: 'line', x: 0.96, y: 0.04 },
            { type: 'line', x: 0.96, y: 0.78 },
            { type: 'quadratic', cx: 0.72, cy: 0.62, x: 0.5, y: 0.82 },
            { type: 'quadratic', cx: 0.26, cy: 1, x: 0.04, y: 0.82 },
            { type: 'close' },
          ],
          ...paint,
        },
      ];
    case 'cloud':
    case 'queue':
    case 'firewall':
    case 'router':
    case 'switch':
    case 'client':
    case 'user':
    case 'load-balancer':
      return technicalGeometry(spec.variant);
    case 'card':
      return [{ id: 'body', type: 'rect', radius: 8, ...paint,
        ...(spec.id === 'uml.fork-node' || spec.id === 'uml.join-node' ? { y: .1, h: .22, radius: 2 } : {}),
      }];
    case 'triangle':
      return [{
        id: 'body', type: 'polygon',
        points: [{ x: 0.5, y: 0.03 }, { x: 0.97, y: 0.94 }, { x: 0.03, y: 0.94 }], ...paint,
      }];
    case 'trapezoid':
      return [{
        id: 'body', type: 'polygon',
        points: [{ x: 0.2, y: 0.04 }, { x: 0.8, y: 0.04 }, { x: 0.98, y: 0.96 }, { x: 0.02, y: 0.96 }], ...paint,
      }];
    case 'note':
      return [{
        id: 'body', type: 'path', commands: [
          { type: 'move', x: 0.04, y: 0.04 }, { type: 'line', x: 0.72, y: 0.04 },
          { type: 'line', x: 0.96, y: 0.28 }, { type: 'line', x: 0.96, y: 0.96 },
          { type: 'line', x: 0.04, y: 0.96 }, { type: 'close' },
          { type: 'move', x: 0.72, y: 0.04 }, { type: 'line', x: 0.72, y: 0.28 }, { type: 'line', x: 0.96, y: 0.28 },
        ], ...paint,
      }];
    case 'package':
      return [
        { id: 'body', type: 'rect', x: 0.04, y: 0.16, w: 0.92, h: 0.8, radius: 3, ...paint },
        { id: 'tab', type: 'rect', x: 0.08, y: 0.04, w: 0.34, h: 0.18, radius: 3, ...paint },
      ];
    case 'bpmn-event': {
      if (spec.id.startsWith('erd.')) return [
        { id: 'outer', type: 'ellipse', x: .03, y: .08, w: .94, h: .84, ...paint },
        { id: 'inner', type: 'ellipse', x: .09, y: .16, w: .82, h: .68, fill: 'none', stroke: '=@Accent', strokeWidth: 1.4 },
      ];
      return [
        { id: 'outer', type: 'ellipse', x: .17, y: .04, w: .66, h: .66, ...paint, strokeWidth: spec.id.includes('end-event') ? 3.2 : 1.8 },
        ...(spec.id.includes('intermediate') || spec.id === 'uml.final-state' ? [
          { id: 'inner', type: 'ellipse' as const, x: .22, y: .09, w: .56, h: .56,
            fill: spec.id === 'uml.final-state' ? '=@Accent' : 'none', stroke: '=@Accent', strokeWidth: 1.4 },
        ] : []),
        ...notationMarker(spec.id, .34, .21, .32, .32),
      ];
    }
    case 'bpmn-task':
      return [
        { id: 'body', type: 'rect', x: .02, y: .04, w: .96, h: .92, radius: 10, ...paint, dash: [] },
        { id: 'header-tone', type: 'rect', x: .03, y: .05, w: .94, h: .17, radius: 8, fill: '=@Accent', fillOpacity: .07 },
        ...(spec.id === 'bpmn.transaction' ? [{ id: 'transaction-border', type: 'rect' as const, x: .05, y: .09, w: .9, h: .82, radius: 8, fill: 'none', stroke: '=@Accent', strokeWidth: 1.2 }] : []),
        ...notationMarker(spec.id, .08, .09, .12, .18),
        ...(spec.id.includes('subprocess') ? [{ id: 'collapsed', type: 'rect' as const, x: .45, y: .75, w: .1, h: .15, radius: 1, ...paint }, ...notationMarker('parallel', .47, .78, .06, .09)] : []),
      ];
    case 'bpmn-gateway':
      return [
        { id: 'body', type: 'polygon', points: [{ x: .5, y: .03 }, { x: .83, y: .36 }, { x: .5, y: .69 }, { x: .17, y: .36 }], ...paint },
        ...notationMarker(spec.id, .37, .23, .26, .26),
      ];
    case 'uml-class':
      return [
        { id: 'body', type: 'rect', radius: 5, ...paint },
        { id: 'title-tone', type: 'rect', x: .01, y: .01, w: .98, h: .31, radius: 4, fill: '=@Accent', fillOpacity: .09 },
        { id: 'attributes', type: 'path', commands: [{ type: 'move', x: 0, y: 0.34 }, { type: 'line', x: 1, y: 0.34 }, { type: 'move', x: 0, y: 0.68 }, { type: 'line', x: 1, y: 0.68 }], fill: 'none', stroke: '=@Accent', strokeWidth: 1.2 },
      ];
    case 'uml-interface':
      return [
        { id: 'body', type: 'rect', radius: 5, ...paint },
        { id: 'title-tone', type: 'rect', x: .01, y: .01, w: .98, h: .31, radius: 4, fill: '=@Accent', fillOpacity: .09 },
        { id: 'divider', type: 'path', commands: [{ type: 'move', x: 0, y: 0.34 }, { type: 'line', x: 1, y: 0.34 }], fill: 'none', stroke: '=@Accent', strokeWidth: 1.2 },
      ];
    case 'erd-entity':
      return [
        { id: 'body', type: 'rect', radius: 5, ...paint },
        ...(spec.id === 'erd.weak-entity' ? [{ id: 'inner', type: 'rect' as const, x: .025, y: .035, w: .95, h: .93, radius: 3, ...paint, fill: 'none' }] : []),
        { id: 'header', type: 'rect', x: 0, y: 0, w: 1, h: 0.28, fill: '=@Accent', fillOpacity: 0.12, stroke: 'none' },
        { id: 'divider', type: 'path', commands: [{ type: 'move', x: 0, y: 0.28 }, { type: 'line', x: 1, y: 0.28 }], fill: 'none', stroke: '=@Accent', strokeWidth: 1 },
      ];
    case 'erd-relationship':
      return [polygon([[.5, .03], [.97, .5], [.5, .97], [.03, .5]]),
        ...(spec.id === 'erd.identifying-relationship' ? [{ ...polygon([[.5, .1], [.9, .5], [.5, .9], [.1, .5]]), id: 'inner', fill: 'none' }] : []),
      ];
    case 'actor':
      return [
        { id: 'head', type: 'ellipse', x: 0.38, y: 0.0144, w: 0.24, h: 0.1728, ...paint },
        { id: 'body', type: 'path', commands: [{ type: 'move', x: 0.5, y: 0.1872 }, { type: 'line', x: 0.5, y: 0.4896 }, { type: 'move', x: 0.5, y: 0.2736 }, { type: 'line', x: 0.24, y: 0.3744 }, { type: 'move', x: 0.5, y: 0.2736 }, { type: 'line', x: 0.76, y: 0.3744 }, { type: 'move', x: 0.5, y: 0.4896 }, { type: 'line', x: 0.28, y: 0.6768 }, { type: 'move', x: 0.5, y: 0.4896 }, { type: 'line', x: 0.72, y: 0.6768 }], fill: 'none', stroke: '=@Accent', strokeWidth: 2 },
      ];
    case 'folder':
      return [{ id: 'body', type: 'path', commands: [{ type: 'move', x: 0.04, y: 0.2 }, { type: 'line', x: 0.38, y: 0.2 }, { type: 'line', x: 0.46, y: 0.08 }, { type: 'line', x: 0.78, y: 0.08 }, { type: 'line', x: 0.96, y: 0.24 }, { type: 'line', x: 0.9, y: 0.92 }, { type: 'line', x: 0.06, y: 0.92 }, { type: 'close' }], ...paint }];
    case 'predefined-process':
      return [
        { id: 'body', type: 'rect', radius: 3, ...paint },
        { id: 'left-divider', type: 'path', commands: [{ type: 'move', x: 0.14, y: 0 }, { type: 'line', x: 0.14, y: 1 }], fill: 'none', stroke: '=@Accent', strokeWidth: 1.2 },
        { id: 'right-divider', type: 'path', commands: [{ type: 'move', x: 0.86, y: 0 }, { type: 'line', x: 0.86, y: 1 }], fill: 'none', stroke: '=@Accent', strokeWidth: 1.2 },
      ];
    case 'manual-operation':
      return [{ id: 'body', type: 'polygon', points: [{ x: 0.06, y: 0.04 }, { x: 0.94, y: 0.04 }, { x: 0.78, y: 0.96 }, { x: 0.22, y: 0.96 }], ...paint }];
    case 'display':
      return [{ id: 'body', type: 'path', commands: [
        { type: 'move', x: 0.12, y: 0.04 }, { type: 'line', x: 0.78, y: 0.04 },
        { type: 'cubic', c1x: 1, c1y: 0.2, c2x: 1, c2y: 0.8, x: 0.78, y: 0.96 },
        { type: 'line', x: 0.12, y: 0.96 }, { type: 'line', x: 0.02, y: 0.5 }, { type: 'close' },
      ], ...paint }];
    case 'off-page':
      return [{ id: 'body', type: 'polygon', points: [{ x: 0.05, y: 0.04 }, { x: 0.95, y: 0.04 }, { x: 0.95, y: 0.7 }, { x: 0.5, y: 0.96 }, { x: 0.05, y: 0.7 }], ...paint }];
    case 'multi-document':
      return [
        { id: 'back', type: 'rect', x: 0.12, y: 0.02, w: 0.8, h: 0.72, radius: 2, fill: '=@Surface', stroke: '=@Accent', strokeWidth: 1 },
        { id: 'middle', type: 'rect', x: 0.08, y: 0.09, w: 0.8, h: 0.72, radius: 2, fill: '=@Surface', stroke: '=@Accent', strokeWidth: 1.2 },
        { id: 'body', type: 'path', commands: [
          { type: 'move', x: 0.04, y: 0.16 }, { type: 'line', x: 0.84, y: 0.16 }, { type: 'line', x: 0.84, y: 0.78 },
          { type: 'quadratic', cx: 0.63, cy: 0.66, x: 0.44, y: 0.82 }, { type: 'quadratic', cx: 0.22, cy: 0.96, x: 0.04, y: 0.82 }, { type: 'close' },
        ], ...paint },
      ];
    case 'architecture-zone':
      return [
        { id: 'body', type: 'rect', radius: 10, ...paint },
        { id: 'header', type: 'rect', x: 0, y: 0, w: 1, h: 0.18, radius: 10, fill: '=@Accent', fillOpacity: 0.08, stroke: 'none' },
      ];
    case 'arrow':
      return [{ id: 'body', type: 'polygon', points: [
        { x: 0.03, y: 0.34 }, { x: 0.7, y: 0.34 }, { x: 0.7, y: 0.12 },
        { x: 0.97, y: 0.5 }, { x: 0.7, y: 0.88 }, { x: 0.7, y: 0.66 }, { x: 0.03, y: 0.66 },
      ], ...paint }];
    case 'left-arrow':
      return [{ id: 'body', type: 'polygon', points: [
        { x: 0.97, y: 0.34 }, { x: 0.3, y: 0.34 }, { x: 0.3, y: 0.12 },
        { x: 0.03, y: 0.5 }, { x: 0.3, y: 0.88 }, { x: 0.3, y: 0.66 }, { x: 0.97, y: 0.66 },
      ], ...paint }];
    case 'callout':
      return [{ id: 'body', type: 'path', commands: [
        { type: 'move', x: 0.04, y: 0.06 }, { type: 'line', x: 0.96, y: 0.06 },
        { type: 'line', x: 0.96, y: 0.72 }, { type: 'line', x: 0.62, y: 0.72 },
        { type: 'line', x: 0.5, y: 0.96 }, { type: 'line', x: 0.42, y: 0.72 },
        { type: 'line', x: 0.04, y: 0.72 }, { type: 'close' },
      ], ...paint }];
    case 'swimlane':
      if (spec.id === 'architecture.swimlane') return [
        { id: 'body', type: 'rect', fill: '=@Surface', stroke: 'none' },
        line('header-rule', [[0, .08], [1, .08]]),
      ];
      return [
        { id: 'body', type: 'rect', radius: 4, ...paint },
        { id: 'header', type: 'rect', x: 0, y: 0, w: 1, h: 0.16, fill: '=@Accent', fillOpacity: 0.1, stroke: 'none' },
        { id: 'divider', type: 'path', commands: [{ type: 'move', x: 0, y: 0.16 }, { type: 'line', x: 1, y: 0.16 }], fill: 'none', stroke: '=@Accent', strokeWidth: 1.2 },
      ];
    case 'uml-component':
      return [
        { id: 'body', type: 'rect', x: 0.12, y: 0.06, w: 0.84, h: 0.88, radius: 3, ...paint },
        { id: 'upper-tab', type: 'rect', x: 0.02, y: 0.25, w: 0.24, h: 0.16, radius: 2, ...paint },
        { id: 'lower-tab', type: 'rect', x: 0.02, y: 0.58, w: 0.24, h: 0.16, radius: 2, ...paint },
      ];
    case 'deployment-node':
      return [
        { id: 'front', type: 'rect', x: 0.08, y: 0.16, w: 0.82, h: 0.76, radius: 2, ...paint },
        { id: 'top', type: 'polygon', points: [{ x: 0.08, y: 0.16 }, { x: 0.22, y: 0.04 }, { x: 0.98, y: 0.04 }, { x: 0.9, y: 0.16 }], ...paint },
        { id: 'side', type: 'polygon', points: [{ x: 0.9, y: 0.16 }, { x: 0.98, y: 0.04 }, { x: 0.98, y: 0.8 }, { x: 0.9, y: 0.92 }], ...paint },
      ];
    case 'state-choice':
      return [{ id: 'body', type: 'polygon', points: [
        { x: 0.5, y: 0.04 }, { x: 0.96, y: 0.5 }, { x: 0.5, y: 0.96 }, { x: 0.04, y: 0.5 },
      ], ...paint }];
    case 'chevron':
      return [{ id: 'body', type: 'polygon', points: [
        { x: 0.04, y: 0.08 }, { x: 0.7, y: 0.08 }, { x: 0.96, y: 0.5 },
        { x: 0.7, y: 0.92 }, { x: 0.04, y: 0.92 }, { x: 0.3, y: 0.5 },
      ], ...paint }];
    case 'lifeline':
      return [
        { id: 'head', type: 'rect', x: 0.12, y: 0.02, w: 0.76, h: 0.2, radius: 3, ...paint },
        { id: 'line', type: 'path', commands: [{ type: 'move', x: 0.5, y: 0.22 }, { type: 'line', x: 0.5, y: 0.96 }], fill: 'none', stroke: '=@Accent', strokeWidth: 1.4, dash: [5, 4] },
      ];
    case 'rack':
      return [
        { id: 'body', type: 'rect', x: 0.08, y: 0.03, w: 0.84, h: 0.94, radius: 4, ...paint },
        ...[0.18, 0.34, 0.5, 0.66, 0.82].map((y, index) => ({
          id: `unit-${index}`,
          type: 'rect' as const,
          x: 0.16,
          y,
          w: 0.68,
          h: 0.09,
          radius: 2,
          fill: '=@Surface',
          stroke: '=@Accent',
          strokeWidth: 1,
        })),
      ];
    case 'message':
      return [
        { id: 'body', type: 'rect', x: 0.04, y: 0.05, w: 0.92, h: 0.62, radius: 3, ...paint },
        { id: 'fold', type: 'path', commands: [
          { type: 'move', x: 0.04, y: 0.1 }, { type: 'line', x: 0.5, y: 0.42 }, { type: 'line', x: 0.96, y: 0.1 },
        ], fill: 'none', stroke: '=@Accent', strokeWidth: 1.4 },
      ];
    case 'summing-junction':
      return [{ id: 'body', type: 'ellipse', x: .17, y: .04, w: .66, h: .66, ...paint }, ...notationMarker('parallel', .31, .18, .38, .38)];
  }
}

function notationMarker(id: string, x: number, y: number, w: number, h: number): readonly ShapeGeometryDefinition[] {
  const stroke = { fill: 'none', stroke: '=@Accent', strokeWidth: 1.8 };
  const line = (name: string, points: readonly (readonly [number, number])[]): ShapeGeometryDefinition => ({
    id: `marker-${name}`, type: 'path', ...stroke,
    commands: points.map(([px, py], index) => ({ type: index === 0 ? 'move' as const : 'line' as const, x: x + px * w, y: y + py * h })),
  });
  const ring: ShapeGeometryDefinition = { id: 'marker-ring', type: 'ellipse', x, y, w, h, ...stroke };
  if (id.includes('terminate')) return [{ ...ring, fill: '=@Accent' }];
  if (id.includes('timer')) return [ring, line('hands', [[.5, .1], [.5, .5], [.8, .68]])];
  if (id.includes('message') || id.includes('receive') || id.includes('send-task')) return [
    { id: 'marker-envelope', type: 'rect', x, y: y + h * .12, w, h: h * .76, ...stroke,
      ...(id.includes('end-event') || id.includes('send-task') ? { fill: '=@Accent', fillOpacity: .2 } : {}) },
    line('fold', [[0, .16], [.5, .53], [1, .16]]),
  ];
  if (id.includes('signal')) return [line('signal', [[.5, 0], [1, 1], [0, 1], [.5, 0]])];
  if (id.includes('error')) return [line('error', [[.15, 1], [.4, .15], [.58, .62], [.87, 0], [.63, .88], [.43, .4]])];
  if (id.includes('escalation')) return [line('escalation', [[.15, 1], [.5, 0], [.85, 1], [.5, .65], [.15, 1]])];
  if (id.includes('compensation')) return [line('compensate-a', [[.5, 0], [0, .5], [.5, 1], [.5, 0]]), line('compensate-b', [[1, 0], [.5, .5], [1, 1], [1, 0]])];
  if (id.includes('conditional') || id.includes('script') || id.includes('business-rule')) return [
    { id: 'marker-document', type: 'rect', x, y, w, h, ...stroke },
    ...[.25, .5, .75].map((n, i) => line(`row-${i}`, [[.2, n], [.8, n]])),
  ];
  if (id.includes('link')) return [line('link', [[0, .5], [1, .5], [.6, .1]]), line('link-tail', [[1, .5], [.6, .9]])];
  if (id.includes('inclusive')) return [ring];
  if (id.includes('event-based')) return [ring, line('pentagon', [[.5, .16], [.84, .4], [.7, .8], [.3, .8], [.16, .4], [.5, .16]])];
  if (id.includes('exclusive') || id === 'uml.flow-final') return [line('diagonal-a', [[.1, .1], [.9, .9]]), line('diagonal-b', [[.9, .1], [.1, .9]])];
  if (id.includes('parallel') || id.includes('complex')) return [
    line('horizontal', [[0, .5], [1, .5]]), line('vertical', [[.5, 0], [.5, 1]]),
    ...(id.includes('complex') ? [line('diagonal-a', [[.1, .1], [.9, .9]]), line('diagonal-b', [[.9, .1], [.1, .9]])] : []),
  ];
  if (id.includes('manual-task')) return [line('hand', [[.05, .62], [.3, .85], [.78, .85], [.96, .48], [.86, .4], [.7, .58], [.7, .15], [.57, .15], [.57, .5], [.48, .08], [.35, .08], [.35, .53], [.23, .22], [.11, .26], [.22, .64], [.05, .62]])];
  if (id.includes('user-task')) return [
    { id: 'marker-head', type: 'ellipse', x: x + w * .35, y, w: w * .3, h: h * .35, ...stroke },
    line('person', [[.1, 1], [.1, .7], [.3, .5], [.7, .5], [.9, .7], [.9, 1]]),
  ];
  if (id.includes('service-task')) return [ring,
    { id: 'marker-core', type: 'ellipse', x: x + w * .3, y: y + h * .3, w: w * .4, h: h * .4, ...stroke },
    line('gear-a', [[.5, -.15], [.5, .2]]), line('gear-b', [[.5, .8], [.5, 1.15]]),
    line('gear-c', [[-.15, .5], [.2, .5]]), line('gear-d', [[.8, .5], [1.15, .5]]),
  ];
  return [];
}

function definitionFor(spec: BuiltinSpec): ShapeDefinition {
  const width = spec.width ?? 180;
  const height = spec.height ?? 112;
  return {
    version: SHAPE_DEFINITION_VERSION,
    id: spec.id,
    name: spec.name,
    defaultSize: { width, height },
    composition: spec.composition ?? 'above',
    properties: [
      { name: 'Label', type: 'string', default: spec.name },
      { name: 'Accent', type: 'color', default: spec.accent },
      { name: 'Surface', type: 'color', default: spec.surface },
    ],
    geometry: spec.symbol === undefined ? variantGeometry(spec) : technicalGeometry(spec.symbol).map((geometry) =>
      spec.dashed === true && geometry.id === 'body' ? { ...geometry, dash: [6, 3] } : geometry),
    textAreas: [
      {
        id: 'label',
        bounds: spec.variant === 'text' ? { x: 0, y: 0, w: 1, h: 1 }
          : (spec.id === 'uml.fork-node' || spec.id === 'uml.join-node')
          ? { x: .08, y: .5, w: .84, h: .4 }
          : spec.symbol !== undefined || (DETACHED_LABEL_VARIANTS.has(spec.variant) && !spec.id.startsWith('erd.')) || spec.id === 'uml.initial-state' || spec.id === 'uml.junction' || ['erd.one', 'erd.zero-one', 'erd.one-many', 'erd.zero-many', 'flowchart.or', 'flowchart.parallel-mode', 'flowchart.collate', 'flowchart.communication-link', 'basic.double-chevron'].includes(spec.id)
          ? { x: 0.08, y: 0.76, w: 0.84, h: 0.2 }
          : spec.variant === 'uml-class' || spec.variant === 'uml-interface'
            ? { x: .08, y: .08, w: .84, h: .2 }
            : spec.variant === 'erd-entity' ? { x: .08, y: .04, w: .84, h: .2 }
              : spec.variant === 'architecture-zone' || spec.variant === 'swimlane' ? { x: .04, y: .025, w: .92, h: .12 }
                : spec.variant === 'lifeline' ? { x: .16, y: .055, w: .68, h: .13 }
                  : spec.id === 'basic.left-callout' ? { x: .27, y: .38, w: .6, h: .24 }
                    : spec.id === 'basic.ribbon' ? { x: .24, y: .3, w: .52, h: .24 }
                    : spec.id === 'flowchart.stored-data' || spec.id === 'flowchart.online-storage' ? { x: .17, y: .35, w: .54, h: .3 }
                    : spec.id === 'flowchart.direct-access-storage' ? { x: .18, y: .35, w: .47, h: .3 }
                    : spec.id === 'flowchart.merge' || spec.id === 'flowchart.manual-file' ? { x: .26, y: .24, w: .48, h: .2 }
                    : spec.id === 'flowchart.sort' ? { x: .3, y: .22, w: .4, h: .2 }
                    : spec.variant === 'triangle' ? { x: .27, y: .56, w: .46, h: .2 }
                      : spec.variant === 'chevron' ? { x: .32, y: .32, w: .42, h: .36 }
                      : { x: 0.12, y: 0.38, w: 0.76, h: 0.24 },
        text: '=@Label',
      },
    ],
    ports: [
      { id: 'west-in', direction: 'in', side: 'west', x: 0, y: 0.5 },
      { id: 'north-in', direction: 'in', side: 'north', x: 0.5, y: 0 },
      { id: 'east-out', direction: 'out', side: 'east', x: 1, y: 0.5 },
      { id: 'south-out', direction: 'out', side: 'south', x: 0.5, y: 1 },
    ],
  };
}

function libraryFromSpecs(
  id: string,
  name: string,
  specs: readonly BuiltinSpec[],
): ShapeLibrary {
  const entries: ShapeDefinitionLibraryEntry[] = specs.map((spec) => ({
    id: spec.id,
    name: spec.name,
    kind: 'definition',
    ...(spec.aliasOf === undefined ? {} : { aliasOf: spec.aliasOf }),
    tags: [...new Set([spec.name.toLowerCase(), ...spec.tags.map((tag) => tag.toLowerCase())])].sort(),
    defaultSize: {
      width: spec.width ?? 180,
      height: spec.height ?? 112,
    },
    composition: spec.composition ?? 'above',
    provenance: {
      sourceUrl: `${BUILTIN_SOURCE}/${id}/${spec.id}`,
      packageName: '@openchart/shapes',
      packageVersion: '0.0.0',
      packageLicense: 'MIT',
      upstreamId: spec.id,
    },
    definition: definitionFor(spec),
  }));
  return {
    catalogVersion: SHAPE_LIBRARY_CATALOG_VERSION,
    id,
    name,
    version: '1.0.0',
    license: MIT_LICENSE,
    entries,
  };
}

const GENERIC_SPECS = [
  { id: 'generic.service', name: 'Service', tags: ['application', 'component'], variant: 'card', symbol: 'service', aliasOf: 'integration.service', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'generic.database', name: 'Database', tags: ['data', 'storage'], variant: 'database', symbol: 'database', aliasOf: 'integration.database', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'generic.queue', name: 'Queue', tags: ['message', 'async'], variant: 'queue', symbol: 'queue', aliasOf: 'integration.queue', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'generic.function', name: 'Function', tags: ['serverless', 'compute'], variant: 'hexagon', symbol: 'function', aliasOf: 'integration.function', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'generic.user', name: 'User', tags: ['actor', 'person'], variant: 'user', symbol: 'user', accent: '#B45309', surface: '#FFFBEB' },
  { id: 'generic.client', name: 'Client', tags: ['desktop', 'browser'], variant: 'client', symbol: 'client', aliasOf: 'integration.client', accent: '#475569', surface: '#F8FAFC' },
  { id: 'generic.external-system', name: 'External system', tags: ['third party', 'boundary'], variant: 'card', symbol: 'service', accent: '#64748B', surface: '#F8FAFC', dashed: true },
  { id: 'generic.container', name: 'Container', tags: ['group', 'boundary'], variant: 'card', accent: '#64748B', surface: '#F8FAFC', dashed: true, width: 240, height: 160 },
  { id: 'generic.cloud', name: 'Cloud', tags: ['internet', 'hosted'], variant: 'cloud', symbol: 'cloud', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'generic.document', name: 'Document', tags: ['file', 'artifact'], variant: 'document', aliasOf: 'flowchart.document', accent: '#475569', surface: '#F8FAFC' },
] as const satisfies readonly BuiltinSpec[];

const FLOWCHART_SPECS = [
  { id: 'flowchart.process', name: 'Process', tags: ['step', 'action'], variant: 'card', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'flowchart.decision', name: 'Decision', tags: ['branch', 'condition'], variant: 'diamond', accent: '#B45309', surface: '#FFFBEB', width: 160, height: 120 },
  { id: 'flowchart.terminator', name: 'Start / End', tags: ['terminator'], variant: 'ellipse', accent: '#059669', surface: '#ECFDF5' },
  { id: 'flowchart.data', name: 'Data', tags: ['input', 'output'], variant: 'parallelogram', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'flowchart.document', name: 'Document', tags: ['report', 'file'], variant: 'document', accent: '#475569', surface: '#F8FAFC' },
  { id: 'flowchart.database', name: 'Database', tags: ['database', 'storage'], variant: 'database', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'flowchart.preparation', name: 'Preparation', tags: ['setup'], variant: 'hexagon', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'flowchart.manual-input', name: 'Manual input', tags: ['input', 'user'], variant: 'manual-input', accent: '#B45309', surface: '#FFFBEB' },
  { id: 'flowchart.connector', name: 'Connector', tags: ['link', 'continuation'], variant: 'ellipse', aliasOf: 'flowchart.on-page-connector', accent: '#64748B', surface: '#F8FAFC', width: 72, height: 72 },
  { id: 'flowchart.delay', name: 'Delay', tags: ['wait', 'timer'], variant: 'delay', accent: '#64748B', surface: '#F8FAFC' },
  { id: 'flowchart.predefined-process', name: 'Predefined process', tags: ['subroutine', 'procedure'], variant: 'predefined-process', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'flowchart.manual-operation', name: 'Manual operation', tags: ['manual', 'operation'], variant: 'manual-operation', accent: '#B45309', surface: '#FFFBEB' },
  { id: 'flowchart.display', name: 'Display', tags: ['screen', 'output'], variant: 'display', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'flowchart.off-page-connector', name: 'Off-page connector', tags: ['continuation', 'page'], variant: 'off-page', accent: '#64748B', surface: '#F8FAFC', width: 100, height: 100 },
  { id: 'flowchart.multiple-documents', name: 'Multiple documents', tags: ['documents', 'files'], variant: 'multi-document', accent: '#475569', surface: '#F8FAFC' },
  { id: 'flowchart.internal-storage', name: 'Internal storage', tags: ['memory', 'storage'], variant: 'predefined-process', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'flowchart.direct-access-storage', name: 'Direct access storage', tags: ['disk', 'storage'], variant: 'database', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'flowchart.sequential-access-storage', name: 'Sequential access storage', tags: ['tape', 'storage'], variant: 'ellipse', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'flowchart.card', name: 'Punched card', tags: ['card', 'legacy input'], variant: 'off-page', accent: '#64748B', surface: '#F8FAFC' },
  { id: 'flowchart.collate', name: 'Collate', tags: ['merge', 'sort'], variant: 'triangle', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'flowchart.extract', name: 'Extract', tags: ['split', 'filter'], variant: 'triangle', accent: '#B45309', surface: '#FFFBEB' },
  { id: 'flowchart.or', name: 'OR junction', tags: ['logic', 'junction'], variant: 'ellipse', accent: '#B45309', surface: '#FFFBEB', width: 80, height: 80 },
  { id: 'flowchart.merge', name: 'Merge', tags: ['iso', 'merge', 'combine'], variant: 'triangle', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'flowchart.sort', name: 'Sort', tags: ['iso', 'sort', 'order'], variant: 'diamond', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'flowchart.loop-limit', name: 'Loop limit', tags: ['iso', 'loop', 'iteration'], variant: 'hexagon', accent: '#B45309', surface: '#FFFBEB' },
  { id: 'flowchart.stored-data', name: 'Stored data', tags: ['iso', 'stored', 'data'], variant: 'database', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'flowchart.online-storage', name: 'Online storage', tags: ['iso', 'storage', 'online'], variant: 'database', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'flowchart.communication-link', name: 'Communication link', tags: ['iso', 'communication', 'link'], variant: 'chevron', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'flowchart.transmittal-tape', name: 'Transmittal tape', tags: ['iso', 'tape', 'transmittal'], variant: 'document', accent: '#64748B', surface: '#F8FAFC' },
  { id: 'flowchart.manual-file', name: 'Manual file', tags: ['iso', 'file', 'manual'], variant: 'trapezoid', accent: '#B45309', surface: '#FFFBEB' },
  { id: 'flowchart.annotation', name: 'Annotation', tags: ['iso', 'annotation', 'comment'], variant: 'callout', accent: '#64748B', surface: '#F8FAFC' },
  { id: 'flowchart.parallel-mode', name: 'Parallel mode', tags: ['iso', 'parallel', 'mode'], variant: 'chevron', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'flowchart.on-page-connector', name: 'On-page connector', tags: ['connector', 'continuation', 'on page'], variant: 'ellipse', accent: '#64748B', surface: '#F8FAFC', width: 72, height: 72 },
  { id: 'flowchart.summing-junction', name: 'Summing junction', tags: ['sum', 'junction', 'logic'], variant: 'summing-junction', accent: '#B45309', surface: '#FFFBEB', width: 80, height: 80, composition: 'circle' },
  { id: 'flowchart.direct-data', name: 'Direct data', tags: ['direct access', 'disk', 'storage'], variant: 'database', aliasOf: 'flowchart.direct-access-storage', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'flowchart.sequential-data', name: 'Sequential data', tags: ['sequential access', 'tape', 'storage'], variant: 'ellipse', aliasOf: 'flowchart.sequential-access-storage', accent: '#7C3AED', surface: '#F5F3FF' },
] as const satisfies readonly BuiltinSpec[];

const INTEGRATION_SPECS = [
  { id: 'integration.api-gateway', name: 'API gateway', tags: ['api', 'gateway', 'http'], variant: 'hexagon', symbol: 'gateway', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'integration.service', name: 'Service', tags: ['application', 'microservice'], variant: 'card', symbol: 'service', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'integration.queue', name: 'Queue', tags: ['message', 'async'], variant: 'queue', symbol: 'queue', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'integration.topic', name: 'Topic', tags: ['pubsub', 'message'], variant: 'ellipse', symbol: 'topic', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'integration.event-bus', name: 'Event bus', tags: ['event', 'broker'], variant: 'switch', symbol: 'event-bus', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'integration.stream', name: 'Stream', tags: ['kafka', 'event'], variant: 'queue', symbol: 'stream', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'integration.function', name: 'Function', tags: ['serverless', 'compute'], variant: 'hexagon', symbol: 'function', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'integration.database', name: 'Database', tags: ['data', 'storage'], variant: 'database', symbol: 'database', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'integration.cache', name: 'Cache', tags: ['redis', 'memory'], variant: 'database', symbol: 'cache', accent: '#DC2626', surface: '#FEF2F2' },
  { id: 'integration.webhook', name: 'Webhook', tags: ['callback', 'http'], variant: 'diamond', symbol: 'webhook', accent: '#B45309', surface: '#FFFBEB' },
  { id: 'integration.external-saas', name: 'External SaaS', tags: ['third party', 'vendor'], variant: 'cloud', symbol: 'cloud', accent: '#64748B', surface: '#F8FAFC', dashed: true },
  { id: 'integration.client', name: 'Client', tags: ['consumer', 'browser'], variant: 'client', symbol: 'client', accent: '#475569', surface: '#F8FAFC' },
  { id: 'integration.component', name: 'Component', tags: ['module', 'software', 'component'], variant: 'uml-component', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'integration.worker', name: 'Worker', tags: ['background', 'consumer', 'job'], variant: 'rack', symbol: 'worker', accent: '#475569', surface: '#F8FAFC' },
  { id: 'integration.scheduler', name: 'Scheduler', tags: ['cron', 'timer', 'orchestration'], variant: 'display', symbol: 'clock', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'integration.batch-job', name: 'Batch job', tags: ['batch', 'job', 'etl'], variant: 'chevron', symbol: 'workflow', accent: '#B45309', surface: '#FFFBEB' },
  { id: 'integration.service-registry', name: 'Service registry', tags: ['discovery', 'registry', 'catalog'], variant: 'database', symbol: 'registry', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'integration.object-storage', name: 'Object storage', tags: ['blob', 'bucket', 'storage'], variant: 'database', symbol: 'bucket', accent: '#B45309', surface: '#FFFBEB' },
  { id: 'integration.file-transfer', name: 'File transfer', tags: ['ftp', 'sftp', 'file'], variant: 'document', accent: '#475569', surface: '#F8FAFC' },
  { id: 'integration.event-store', name: 'Event store', tags: ['events', 'event sourcing', 'storage'], variant: 'database', symbol: 'database', accent: '#7C3AED', surface: '#F5F3FF' },
] as const satisfies readonly BuiltinSpec[];

const NETWORK_SPECS = [
  { id: 'network.router', name: 'Router', tags: ['routing', 'network'], variant: 'router', symbol: 'router', accent: '#2563EB', surface: '#EFF6FF', width: 112, height: 112 },
  { id: 'network.switch', name: 'Switch', tags: ['ethernet', 'lan'], variant: 'switch', symbol: 'switch', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'network.firewall', name: 'Firewall', tags: ['security', 'boundary'], variant: 'firewall', symbol: 'firewall', accent: '#DC2626', surface: '#FEF2F2' },
  { id: 'network.load-balancer', name: 'Load balancer', tags: ['traffic', 'distribution'], variant: 'load-balancer', symbol: 'load-balancer', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'network.server', name: 'Server', tags: ['host', 'compute'], variant: 'card', symbol: 'server', accent: '#475569', surface: '#F8FAFC' },
  { id: 'network.workstation', name: 'Workstation', tags: ['client', 'desktop'], variant: 'client', symbol: 'client', aliasOf: 'integration.client', accent: '#475569', surface: '#F8FAFC' },
  { id: 'network.cloud', name: 'Cloud network', tags: ['wan', 'hosted'], variant: 'cloud', symbol: 'cloud', aliasOf: 'generic.cloud', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'network.internet', name: 'Internet', tags: ['public', 'wan'], variant: 'cloud', symbol: 'globe', accent: '#64748B', surface: '#F8FAFC', dashed: true },
  { id: 'network.vpn', name: 'VPN', tags: ['tunnel', 'secure'], variant: 'hexagon', symbol: 'shield', accent: '#059669', surface: '#ECFDF5' },
  { id: 'network.gateway', name: 'Gateway', tags: ['edge', 'ingress'], variant: 'hexagon', symbol: 'gateway', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'network.subnet', name: 'Subnet', tags: ['cidr', 'container'], variant: 'card', accent: '#64748B', surface: '#F8FAFC', dashed: true, width: 240, height: 160 },
  { id: 'network.dns', name: 'DNS', tags: ['name resolution', 'domain'], variant: 'database', symbol: 'globe', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'network.access-point', name: 'Access point', tags: ['wifi', 'wireless', 'lan'], variant: 'router', symbol: 'wifi', accent: '#2563EB', surface: '#EFF6FF', width: 112, height: 112 },
  { id: 'network.nat', name: 'NAT gateway', tags: ['translation', 'gateway', 'network'], variant: 'hexagon', symbol: 'gateway', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'network.proxy', name: 'Proxy', tags: ['forward', 'gateway', 'http'], variant: 'card', symbol: 'gateway', accent: '#475569', surface: '#F8FAFC' },
  { id: 'network.vpc', name: 'VPC', tags: ['virtual', 'network', 'boundary'], variant: 'card', accent: '#64748B', surface: '#F8FAFC', dashed: true, width: 260, height: 180 },
  { id: 'network.endpoint', name: 'Endpoint', tags: ['host', 'device', 'edge'], variant: 'client', symbol: 'client', aliasOf: 'integration.client', accent: '#475569', surface: '#F8FAFC' },
  { id: 'network.tunnel', name: 'Secure tunnel', tags: ['vpn', 'encrypted', 'link'], variant: 'hexagon', symbol: 'shield', aliasOf: 'network.vpn', accent: '#059669', surface: '#ECFDF5' },
  { id: 'network.waf', name: 'Web application firewall', tags: ['security', 'firewall', 'http'], variant: 'firewall', symbol: 'firewall', accent: '#DC2626', surface: '#FEF2F2' },
  { id: 'network.ids', name: 'Intrusion detection', tags: ['security', 'ids', 'monitoring'], variant: 'firewall', symbol: 'monitor', accent: '#B45309', surface: '#FFFBEB' },
  { id: 'network.storage', name: 'Network storage', tags: ['nas', 'san', 'storage'], variant: 'database', symbol: 'database', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'network.wireless-controller', name: 'Wireless controller', tags: ['wifi', 'controller', 'wireless'], variant: 'switch', symbol: 'wifi', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'network.cdn-edge', name: 'CDN edge', tags: ['cdn', 'edge', 'cache'], variant: 'cloud', symbol: 'cloud', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'network.rack', name: 'Equipment rack', tags: ['rack', 'datacenter', 'equipment'], variant: 'rack', symbol: 'server', accent: '#475569', surface: '#F8FAFC', width: 150, height: 240 },
  { id: 'network.blade-chassis', name: 'Blade chassis', tags: ['server', 'blade', 'chassis'], variant: 'rack', symbol: 'server', accent: '#2563EB', surface: '#EFF6FF', width: 170, height: 190 },
  { id: 'network.security-appliance', name: 'Security appliance', tags: ['security', 'appliance', 'gateway'], variant: 'firewall', symbol: 'firewall', accent: '#DC2626', surface: '#FEF2F2' },
  { id: 'network.vpn-concentrator', name: 'VPN concentrator', tags: ['vpn', 'security', 'concentrator'], variant: 'router', symbol: 'shield', accent: '#059669', surface: '#ECFDF5' },
  { id: 'network.reverse-proxy', name: 'Reverse proxy', tags: ['proxy', 'reverse', 'http'], variant: 'load-balancer', symbol: 'load-balancer', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'network.mail-gateway', name: 'Mail gateway', tags: ['mail', 'gateway', 'smtp'], variant: 'message', symbol: 'topic', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'network.wan-optimizer', name: 'WAN optimizer', tags: ['wan', 'optimizer', 'network'], variant: 'switch', symbol: 'switch', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'network.dmz', name: 'DMZ boundary', tags: ['dmz', 'security', 'boundary'], variant: 'architecture-zone', accent: '#DC2626', surface: '#FEF2F2', dashed: true, width: 280, height: 180 },
] as const satisfies readonly BuiltinSpec[];

const ARCHITECTURE_SPECS = [
  { id: 'architecture.swimlane', name: 'Swimlane', tags: ['architecture', 'swimlane', 'lane', 'column', 'container'], variant: 'swimlane', accent: '#CBD5E1', surface: 'none', width: 360, height: 480 },
  { id: 'architecture.application', name: 'Application', tags: ['architecture', 'application', 'software'], variant: 'card', symbol: 'service', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'architecture.microservice', name: 'Microservice', tags: ['architecture', 'service', 'microservice'], variant: 'card', symbol: 'service', aliasOf: 'integration.service', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'architecture.api', name: 'API', tags: ['architecture', 'api', 'interface'], variant: 'hexagon', symbol: 'gateway', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'architecture.function', name: 'Serverless function', tags: ['architecture', 'function', 'serverless'], variant: 'hexagon', symbol: 'function', aliasOf: 'integration.function', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'architecture.message-broker', name: 'Message broker', tags: ['architecture', 'broker', 'messaging'], variant: 'queue', symbol: 'queue', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'architecture.event-stream', name: 'Event stream', tags: ['architecture', 'stream', 'events'], variant: 'queue', symbol: 'stream', aliasOf: 'integration.stream', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'architecture.relational-database', name: 'Relational database', tags: ['architecture', 'sql', 'database'], variant: 'database', symbol: 'database', aliasOf: 'integration.database', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'architecture.object-storage', name: 'Object storage', tags: ['architecture', 'blob', 'bucket', 'storage'], variant: 'database', symbol: 'bucket', aliasOf: 'integration.object-storage', accent: '#B45309', surface: '#FFFBEB' },
  { id: 'architecture.cache', name: 'Distributed cache', tags: ['architecture', 'cache', 'memory'], variant: 'database', symbol: 'cache', aliasOf: 'integration.cache', accent: '#DC2626', surface: '#FEF2F2' },
  { id: 'architecture.search-index', name: 'Search index', tags: ['architecture', 'search', 'index'], variant: 'database', symbol: 'search', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'architecture.load-balancer', name: 'Load balancer', tags: ['architecture', 'traffic', 'load balancer'], variant: 'load-balancer', symbol: 'load-balancer', aliasOf: 'network.load-balancer', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'architecture.api-gateway', name: 'API gateway', tags: ['architecture', 'gateway', 'api'], variant: 'hexagon', symbol: 'gateway', aliasOf: 'integration.api-gateway', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'architecture.cloud', name: 'Cloud', tags: ['architecture', 'cloud', 'provider'], variant: 'cloud', symbol: 'cloud', aliasOf: 'generic.cloud', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'architecture.region', name: 'Cloud region', tags: ['architecture', 'cloud', 'region', 'boundary'], variant: 'architecture-zone', accent: '#2563EB', surface: '#F8FAFC', dashed: true, width: 300, height: 200 },
  { id: 'architecture.availability-zone', name: 'Availability zone', tags: ['architecture', 'cloud', 'zone', 'boundary'], variant: 'architecture-zone', accent: '#0D9488', surface: '#F8FAFC', dashed: true, width: 270, height: 180 },
  { id: 'architecture.cluster', name: 'Compute cluster', tags: ['architecture', 'cluster', 'compute'], variant: 'architecture-zone', accent: '#7C3AED', surface: '#F5F3FF', width: 250, height: 170 },
  { id: 'architecture.container', name: 'Container workload', tags: ['architecture', 'container', 'workload'], variant: 'package', symbol: 'container', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'architecture.external-service', name: 'External service', tags: ['architecture', 'external', 'saas'], variant: 'cloud', symbol: 'cloud', aliasOf: 'integration.external-saas', accent: '#64748B', surface: '#F8FAFC', dashed: true },
  { id: 'architecture.system-boundary', name: 'System boundary', tags: ['architecture', 'system', 'boundary'], variant: 'architecture-zone', accent: '#475569', surface: '#F8FAFC', dashed: true, width: 320, height: 220 },
  { id: 'architecture.trust-boundary', name: 'Trust boundary', tags: ['architecture', 'security', 'boundary'], variant: 'architecture-zone', accent: '#DC2626', surface: '#FEF2F2', dashed: true, width: 320, height: 220 },
  { id: 'architecture.network-boundary', name: 'Network boundary', tags: ['architecture', 'network', 'boundary'], variant: 'architecture-zone', accent: '#0D9488', surface: '#F0FDFA', dashed: true, width: 300, height: 200 },
  { id: 'architecture.account-boundary', name: 'Cloud account', tags: ['architecture', 'account', 'boundary'], variant: 'architecture-zone', accent: '#7C3AED', surface: '#F5F3FF', dashed: true, width: 320, height: 220 },
  { id: 'architecture.environment', name: 'Environment', tags: ['architecture', 'environment', 'boundary'], variant: 'architecture-zone', accent: '#2563EB', surface: '#EFF6FF', dashed: true, width: 300, height: 200 },
  { id: 'architecture.kubernetes-cluster', name: 'Kubernetes cluster', tags: ['architecture', 'kubernetes', 'cluster'], variant: 'architecture-zone', accent: '#2563EB', surface: '#EFF6FF', width: 280, height: 190 },
  { id: 'architecture.namespace', name: 'Namespace', tags: ['architecture', 'kubernetes', 'namespace'], variant: 'architecture-zone', accent: '#0D9488', surface: '#F0FDFA', dashed: true, width: 250, height: 170 },
  { id: 'architecture.service-mesh', name: 'Service mesh', tags: ['architecture', 'mesh', 'network'], variant: 'architecture-zone', accent: '#7C3AED', surface: '#F5F3FF', dashed: true, width: 280, height: 190 },
  { id: 'architecture.edge-zone', name: 'Edge zone', tags: ['architecture', 'edge', 'boundary'], variant: 'architecture-zone', accent: '#B45309', surface: '#FFFBEB', dashed: true, width: 260, height: 180 },
  { id: 'architecture.data-platform', name: 'Data platform', tags: ['architecture', 'data', 'platform'], variant: 'architecture-zone', accent: '#7C3AED', surface: '#F5F3FF', width: 300, height: 200 },
  { id: 'architecture.private-subnet', name: 'Private subnet', tags: ['architecture', 'subnet', 'private', 'boundary'], variant: 'architecture-zone', accent: '#059669', surface: '#ECFDF5', dashed: true, width: 260, height: 170 },
  { id: 'architecture.public-subnet', name: 'Public subnet', tags: ['architecture', 'subnet', 'public', 'boundary'], variant: 'architecture-zone', accent: '#2563EB', surface: '#EFF6FF', dashed: true, width: 260, height: 170 },
  { id: 'architecture.security-zone', name: 'Security zone', tags: ['architecture', 'security', 'zone', 'boundary'], variant: 'architecture-zone', accent: '#DC2626', surface: '#FEF2F2', dashed: true, width: 280, height: 180 },
  { id: 'architecture.on-premises', name: 'On-premises datacenter', tags: ['architecture', 'datacenter', 'on premises'], variant: 'architecture-zone', accent: '#475569', surface: '#F8FAFC', width: 300, height: 200 },
  { id: 'architecture.compute-instance', name: 'Compute instance', tags: ['architecture', 'compute', 'vm'], variant: 'client', symbol: 'server', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'architecture.container-registry', name: 'Container registry', tags: ['architecture', 'container', 'registry'], variant: 'database', symbol: 'registry', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'architecture.secret-store', name: 'Secret store', tags: ['architecture', 'secret', 'security'], variant: 'database', symbol: 'key', accent: '#DC2626', surface: '#FEF2F2' },
  { id: 'architecture.observability', name: 'Observability service', tags: ['architecture', 'monitoring', 'observability'], variant: 'card', symbol: 'service', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'architecture.workflow', name: 'Workflow service', tags: ['architecture', 'workflow', 'orchestration'], variant: 'chevron', symbol: 'workflow', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'architecture.identity-provider', name: 'Identity provider', tags: ['architecture', 'identity', 'authentication'], variant: 'user', symbol: 'user', accent: '#B45309', surface: '#FFFBEB' },
] as const satisfies readonly BuiltinSpec[];

const BASIC_SPECS = [
  { id: 'basic.text', name: 'Text', tags: ['heading', 'label', 'annotation'], variant: 'text', accent: '#475569', surface: '#FFFFFF', width: 320, height: 48 },
  { id: 'basic.triangle', name: 'Triangle', tags: ['basic', 'shape'], variant: 'triangle', accent: '#475569', surface: '#F8FAFC' },
  { id: 'basic.trapezoid', name: 'Trapezoid', tags: ['basic', 'shape'], variant: 'trapezoid', accent: '#475569', surface: '#F8FAFC' },
  { id: 'basic.note', name: 'Note', tags: ['annotation', 'comment'], variant: 'note', accent: '#B45309', surface: '#FFFBEB' },
  { id: 'basic.package', name: 'Package', tags: ['artifact', 'module'], variant: 'package', aliasOf: 'uml.package', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'basic.folder', name: 'Folder', tags: ['file', 'directory'], variant: 'folder', accent: '#B45309', surface: '#FFFBEB' },
  { id: 'basic.actor', name: 'Actor', tags: ['person', 'role', 'basic'], variant: 'actor', aliasOf: 'uml.actor', accent: '#475569', surface: '#F8FAFC' },
  { id: 'basic.terminal', name: 'Terminal', tags: ['command', 'console'], variant: 'card', symbol: 'terminal', accent: '#334155', surface: '#F1F5F9' },
  { id: 'basic.comment', name: 'Comment', tags: ['annotation', 'callout'], variant: 'note', accent: '#64748B', surface: '#F8FAFC', dashed: true },
  { id: 'basic.right-arrow', name: 'Right arrow', tags: ['arrow', 'direction', 'right'], variant: 'arrow', accent: '#2563EB', surface: '#EFF6FF', width: 200, height: 90 },
  { id: 'basic.left-arrow', name: 'Left arrow', tags: ['arrow', 'direction', 'left'], variant: 'left-arrow', accent: '#475569', surface: '#F8FAFC', width: 200, height: 90 },
  { id: 'basic.block-arrow', name: 'Block arrow', tags: ['arrow', 'flow', 'block'], variant: 'arrow', aliasOf: 'basic.right-arrow', accent: '#0D9488', surface: '#F0FDFA', width: 220, height: 100 },
  { id: 'basic.chevron-arrow', name: 'Chevron arrow', tags: ['arrow', 'chevron', 'flow'], variant: 'arrow', aliasOf: 'basic.chevron', accent: '#7C3AED', surface: '#F5F3FF', width: 190, height: 88 },
  { id: 'basic.callout', name: 'Callout', tags: ['callout', 'annotation', 'speech'], variant: 'callout', accent: '#B45309', surface: '#FFFBEB', width: 220, height: 140 },
  { id: 'basic.info-callout', name: 'Info callout', tags: ['callout', 'info', 'annotation'], variant: 'callout', accent: '#2563EB', surface: '#EFF6FF', width: 220, height: 140 },
  { id: 'basic.warning-callout', name: 'Warning callout', tags: ['callout', 'warning', 'annotation'], variant: 'callout', accent: '#DC2626', surface: '#FEF2F2', width: 220, height: 140 },
  { id: 'basic.banner', name: 'Banner', tags: ['label', 'banner', 'annotation'], variant: 'trapezoid', accent: '#64748B', surface: '#F8FAFC', width: 220, height: 90 },
  { id: 'basic.bracket-container', name: 'Bracket container', tags: ['container', 'group', 'annotation'], variant: 'card', accent: '#64748B', surface: '#F8FAFC', dashed: true, width: 260, height: 160 },
  { id: 'basic.highlight-box', name: 'Highlight box', tags: ['highlight', 'annotation', 'box'], variant: 'card', accent: '#B45309', surface: '#FFFBEB', width: 240, height: 140 },
  { id: 'basic.chevron', name: 'Chevron', tags: ['arrow', 'chevron', 'process'], variant: 'chevron', accent: '#2563EB', surface: '#EFF6FF', width: 190, height: 90 },
  { id: 'basic.double-chevron', name: 'Double chevron', tags: ['arrow', 'chevron', 'sequence'], variant: 'chevron', accent: '#7C3AED', surface: '#F5F3FF', width: 220, height: 90 },
  { id: 'basic.up-arrow', name: 'Up arrow', tags: ['arrow', 'direction', 'up'], variant: 'up-arrow', accent: '#0D9488', surface: '#F0FDFA', width: 100, height: 150 },
  { id: 'basic.down-arrow', name: 'Down arrow', tags: ['arrow', 'direction', 'down'], variant: 'down-arrow', accent: '#B45309', surface: '#FFFBEB', width: 100, height: 150 },
  { id: 'basic.left-callout', name: 'Left callout', tags: ['callout', 'annotation', 'left'], variant: 'callout', accent: '#64748B', surface: '#F8FAFC' },
  { id: 'basic.process-chevron', name: 'Process chevron', tags: ['chevron', 'process', 'step'], variant: 'chevron', aliasOf: 'basic.chevron', accent: '#0D9488', surface: '#F0FDFA', width: 210, height: 96 },
  { id: 'basic.ribbon', name: 'Ribbon', tags: ['ribbon', 'banner', 'label'], variant: 'trapezoid', accent: '#7C3AED', surface: '#F5F3FF', width: 240, height: 90 },
  { id: 'basic.speech-bubble', name: 'Speech bubble', tags: ['speech', 'bubble', 'callout'], variant: 'callout', aliasOf: 'basic.callout', accent: '#2563EB', surface: '#EFF6FF', width: 210, height: 130 },
] as const satisfies readonly BuiltinSpec[];

const BPMN_SPECS = [
  { id: 'bpmn.start-event', name: 'Start event', tags: ['bpmn', 'event', 'start'], variant: 'bpmn-event', accent: '#059669', surface: '#ECFDF5', width: 96, height: 96, composition: 'circle' },
  { id: 'bpmn.intermediate-event', name: 'Intermediate event', tags: ['bpmn', 'event', 'intermediate'], variant: 'bpmn-event', accent: '#B45309', surface: '#FFFBEB', width: 96, height: 96, composition: 'circle' },
  { id: 'bpmn.end-event', name: 'End event', tags: ['bpmn', 'event', 'end'], variant: 'bpmn-event', accent: '#DC2626', surface: '#FEF2F2', width: 96, height: 96, composition: 'circle' },
  { id: 'bpmn.task', name: 'Task', tags: ['bpmn', 'activity', 'process'], variant: 'bpmn-task', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'bpmn.subprocess', name: 'Sub-process', tags: ['bpmn', 'activity', 'nested'], variant: 'bpmn-task', aliasOf: 'bpmn.collapsed-subprocess', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'bpmn.exclusive-gateway', name: 'Exclusive gateway', tags: ['bpmn', 'gateway', 'xor'], variant: 'bpmn-gateway', accent: '#B45309', surface: '#FFFBEB', width: 112, height: 112, composition: 'circle' },
  { id: 'bpmn.parallel-gateway', name: 'Parallel gateway', tags: ['bpmn', 'gateway', 'and'], variant: 'bpmn-gateway', accent: '#2563EB', surface: '#EFF6FF', width: 112, height: 112, composition: 'circle' },
  { id: 'bpmn.pool', name: 'Pool / lane', tags: ['bpmn', 'lane', 'participant'], variant: 'card', aliasOf: 'bpmn.pool-container', accent: '#64748B', surface: '#F8FAFC', dashed: true, width: 300, height: 180 },
  { id: 'bpmn.user-task', name: 'User task', tags: ['bpmn', 'task', 'user'], variant: 'bpmn-task', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'bpmn.service-task', name: 'Service task', tags: ['bpmn', 'task', 'service'], variant: 'bpmn-task', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'bpmn.script-task', name: 'Script task', tags: ['bpmn', 'task', 'script'], variant: 'bpmn-task', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'bpmn.business-rule-task', name: 'Business rule task', tags: ['bpmn', 'task', 'rule'], variant: 'bpmn-task', accent: '#B45309', surface: '#FFFBEB' },
  { id: 'bpmn.inclusive-gateway', name: 'Inclusive gateway', tags: ['bpmn', 'gateway', 'or'], variant: 'bpmn-gateway', accent: '#0D9488', surface: '#F0FDFA', width: 112, height: 112, composition: 'circle' },
  { id: 'bpmn.event-based-gateway', name: 'Event-based gateway', tags: ['bpmn', 'gateway', 'event'], variant: 'bpmn-gateway', accent: '#7C3AED', surface: '#F5F3FF', width: 112, height: 112, composition: 'circle' },
  { id: 'bpmn.data-object', name: 'Data object', tags: ['bpmn', 'data', 'artifact'], variant: 'note', accent: '#475569', surface: '#F8FAFC' },
  { id: 'bpmn.message-start-event', name: 'Message start event', tags: ['bpmn', 'event', 'message', 'start'], variant: 'bpmn-event', accent: '#059669', surface: '#ECFDF5', width: 96, height: 96, composition: 'circle' },
  { id: 'bpmn.timer-start-event', name: 'Timer start event', tags: ['bpmn', 'event', 'timer', 'start'], variant: 'bpmn-event', accent: '#059669', surface: '#ECFDF5', width: 96, height: 96, composition: 'circle' },
  { id: 'bpmn.signal-start-event', name: 'Signal start event', tags: ['bpmn', 'event', 'signal', 'start'], variant: 'bpmn-event', accent: '#059669', surface: '#ECFDF5', width: 96, height: 96, composition: 'circle' },
  { id: 'bpmn.message-intermediate-event', name: 'Message intermediate event', tags: ['bpmn', 'event', 'message', 'intermediate'], variant: 'bpmn-event', accent: '#B45309', surface: '#FFFBEB', width: 96, height: 96, composition: 'circle' },
  { id: 'bpmn.timer-intermediate-event', name: 'Timer intermediate event', tags: ['bpmn', 'event', 'timer', 'intermediate'], variant: 'bpmn-event', accent: '#B45309', surface: '#FFFBEB', width: 96, height: 96, composition: 'circle' },
  { id: 'bpmn.error-end-event', name: 'Error end event', tags: ['bpmn', 'event', 'error', 'end'], variant: 'bpmn-event', accent: '#DC2626', surface: '#FEF2F2', width: 96, height: 96, composition: 'circle' },
  { id: 'bpmn.terminate-end-event', name: 'Terminate end event', tags: ['bpmn', 'event', 'terminate', 'end'], variant: 'bpmn-event', accent: '#DC2626', surface: '#FEF2F2', width: 96, height: 96, composition: 'circle' },
  { id: 'bpmn.complex-gateway', name: 'Complex gateway', tags: ['bpmn', 'gateway', 'complex'], variant: 'bpmn-gateway', accent: '#7C3AED', surface: '#F5F3FF', width: 112, height: 112, composition: 'circle' },
  { id: 'bpmn.receive-task', name: 'Receive task', tags: ['bpmn', 'task', 'receive'], variant: 'bpmn-task', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'bpmn.send-task', name: 'Send task', tags: ['bpmn', 'task', 'send'], variant: 'bpmn-task', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'bpmn.manual-task', name: 'Manual task', tags: ['bpmn', 'task', 'manual'], variant: 'bpmn-task', accent: '#B45309', surface: '#FFFBEB' },
  { id: 'bpmn.transaction', name: 'Transaction', tags: ['bpmn', 'transaction', 'activity'], variant: 'bpmn-task', accent: '#7C3AED', surface: '#F5F3FF', dashed: true },
  { id: 'bpmn.collapsed-subprocess', name: 'Collapsed sub-process', tags: ['bpmn', 'subprocess', 'collapsed'], variant: 'bpmn-task', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'bpmn.pool-container', name: 'Pool', tags: ['bpmn', 'pool', 'participant'], variant: 'swimlane', accent: '#64748B', surface: '#F8FAFC', width: 360, height: 200 },
  { id: 'bpmn.lane', name: 'Lane', tags: ['bpmn', 'lane', 'swimlane'], variant: 'swimlane', accent: '#64748B', surface: '#F8FAFC', width: 340, height: 120 },
  { id: 'bpmn.message-end-event', name: 'Message end event', tags: ['bpmn', 'event', 'message', 'end'], variant: 'bpmn-event', accent: '#DC2626', surface: '#FEF2F2', width: 96, height: 96, composition: 'circle' },
  { id: 'bpmn.signal-end-event', name: 'Signal end event', tags: ['bpmn', 'event', 'signal', 'end'], variant: 'bpmn-event', accent: '#DC2626', surface: '#FEF2F2', width: 96, height: 96, composition: 'circle' },
  { id: 'bpmn.escalation-end-event', name: 'Escalation end event', tags: ['bpmn', 'event', 'escalation', 'end'], variant: 'bpmn-event', accent: '#DC2626', surface: '#FEF2F2', width: 96, height: 96, composition: 'circle' },
  { id: 'bpmn.compensation-intermediate-event', name: 'Compensation intermediate event', tags: ['bpmn', 'event', 'compensation'], variant: 'bpmn-event', accent: '#B45309', surface: '#FFFBEB', width: 96, height: 96, composition: 'circle' },
  { id: 'bpmn.conditional-intermediate-event', name: 'Conditional intermediate event', tags: ['bpmn', 'event', 'conditional'], variant: 'bpmn-event', accent: '#B45309', surface: '#FFFBEB', width: 96, height: 96, composition: 'circle' },
  { id: 'bpmn.link-intermediate-event', name: 'Link intermediate event', tags: ['bpmn', 'event', 'link'], variant: 'bpmn-event', accent: '#B45309', surface: '#FFFBEB', width: 96, height: 96, composition: 'circle' },
  { id: 'bpmn.data-store', name: 'Data store', tags: ['bpmn', 'data', 'store'], variant: 'database', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'bpmn.input-data-object', name: 'Input data object', tags: ['bpmn', 'data', 'input'], variant: 'note', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'bpmn.output-data-object', name: 'Output data object', tags: ['bpmn', 'data', 'output'], variant: 'note', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'bpmn.message', name: 'Message', tags: ['bpmn', 'message', 'communication'], variant: 'message', accent: '#475569', surface: '#F8FAFC' },
  { id: 'bpmn.group', name: 'Group', tags: ['bpmn', 'group', 'artifact'], variant: 'architecture-zone', accent: '#64748B', surface: '#F8FAFC', dashed: true, width: 280, height: 170 },
  { id: 'bpmn.text-annotation', name: 'Text annotation', tags: ['bpmn', 'annotation', 'text'], variant: 'callout', accent: '#64748B', surface: '#F8FAFC' },
] as const satisfies readonly BuiltinSpec[];

const UML_SPECS = [
  { id: 'uml.class', name: 'Class', tags: ['uml', 'type', 'object'], variant: 'uml-class', accent: '#2563EB', surface: '#EFF6FF', width: 220, height: 150 },
  { id: 'uml.abstract-class', name: 'Abstract class', tags: ['uml', 'class', 'abstract'], variant: 'uml-class', accent: '#7C3AED', surface: '#F5F3FF', width: 220, height: 150 },
  { id: 'uml.interface', name: 'Interface', tags: ['uml', 'contract', 'interface'], variant: 'uml-interface', accent: '#0D9488', surface: '#F0FDFA', width: 220, height: 130 },
  { id: 'uml.enumeration', name: 'Enumeration', tags: ['uml', 'enum', 'type'], variant: 'uml-class', accent: '#B45309', surface: '#FFFBEB', width: 200, height: 140 },
  { id: 'uml.component', name: 'Component', tags: ['uml', 'component', 'architecture'], variant: 'package', aliasOf: 'uml.component-node', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'uml.actor', name: 'Actor', tags: ['uml', 'use case', 'person'], variant: 'actor', accent: '#475569', surface: '#F8FAFC', width: 100, height: 130 },
  { id: 'uml.use-case', name: 'Use case', tags: ['uml', 'use case', 'behavior'], variant: 'ellipse', accent: '#2563EB', surface: '#EFF6FF', width: 190, height: 100 },
  { id: 'uml.package', name: 'Package', tags: ['uml', 'package', 'namespace'], variant: 'package', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'uml.node', name: 'Deployment node', tags: ['uml', 'deployment', 'node'], variant: 'architecture-zone', aliasOf: 'uml.deployment-node-3d', accent: '#475569', surface: '#F8FAFC', width: 210, height: 140 },
  { id: 'uml.artifact', name: 'Artifact', tags: ['uml', 'artifact', 'file'], variant: 'note', accent: '#B45309', surface: '#FFFBEB' },
  { id: 'uml.state', name: 'State', tags: ['uml', 'state machine', 'state'], variant: 'bpmn-task', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'uml.activity', name: 'Activity', tags: ['uml', 'activity', 'action'], variant: 'bpmn-task', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'uml.object', name: 'Object instance', tags: ['uml', 'object', 'instance'], variant: 'uml-interface', accent: '#475569', surface: '#F8FAFC', width: 210, height: 120 },
  { id: 'uml.template-class', name: 'Template class', tags: ['uml', 'class', 'template'], variant: 'uml-class', accent: '#7C3AED', surface: '#F5F3FF', width: 220, height: 150 },
  { id: 'uml.stereotype-class', name: 'Stereotype class', tags: ['uml', 'class', 'stereotype'], variant: 'uml-class', accent: '#0D9488', surface: '#F0FDFA', width: 220, height: 150 },
  { id: 'uml.component-node', name: 'Component', tags: ['uml', 'component', 'module'], variant: 'uml-component', accent: '#2563EB', surface: '#EFF6FF', width: 210, height: 130 },
  { id: 'uml.subsystem', name: 'Subsystem', tags: ['uml', 'component', 'subsystem'], variant: 'uml-component', accent: '#7C3AED', surface: '#F5F3FF', width: 220, height: 140 },
  { id: 'uml.deployment-node-3d', name: 'Deployment node', tags: ['uml', 'deployment', 'node'], variant: 'deployment-node', accent: '#475569', surface: '#F8FAFC', width: 210, height: 150 },
  { id: 'uml.device', name: 'Device', tags: ['uml', 'deployment', 'device'], variant: 'deployment-node', accent: '#2563EB', surface: '#EFF6FF', width: 200, height: 145 },
  { id: 'uml.execution-environment', name: 'Execution environment', tags: ['uml', 'deployment', 'runtime'], variant: 'deployment-node', accent: '#0D9488', surface: '#F0FDFA', width: 220, height: 150 },
  { id: 'uml.initial-state', name: 'Initial state', tags: ['uml', 'state', 'initial'], variant: 'ellipse', accent: '#475569', surface: '#475569', width: 64, height: 64, composition: 'circle' },
  { id: 'uml.final-state', name: 'Final state', tags: ['uml', 'state', 'final'], variant: 'bpmn-event', accent: '#475569', surface: '#F8FAFC', width: 72, height: 72, composition: 'circle' },
  { id: 'uml.choice', name: 'Choice', tags: ['uml', 'state', 'choice'], variant: 'state-choice', accent: '#B45309', surface: '#FFFBEB', width: 90, height: 90, composition: 'circle' },
  { id: 'uml.junction', name: 'Junction', tags: ['uml', 'state', 'junction'], variant: 'ellipse', accent: '#475569', surface: '#475569', width: 52, height: 52, composition: 'circle' },
  { id: 'uml.activity-partition', name: 'Activity partition', tags: ['uml', 'activity', 'partition'], variant: 'swimlane', accent: '#64748B', surface: '#F8FAFC', width: 340, height: 150 },
  { id: 'uml.fork-node', name: 'Fork node', tags: ['uml', 'activity', 'fork'], variant: 'card', accent: '#475569', surface: '#475569', width: 220, height: 64 },
  { id: 'uml.join-node', name: 'Join node', tags: ['uml', 'activity', 'join'], variant: 'card', accent: '#475569', surface: '#475569', width: 220, height: 64 },
  { id: 'uml.comment', name: 'UML comment', tags: ['uml', 'comment', 'note'], variant: 'note', accent: '#64748B', surface: '#F8FAFC', width: 220, height: 130 },
  { id: 'uml.lifeline', name: 'Lifeline', tags: ['uml', 'sequence', 'lifeline'], variant: 'lifeline', accent: '#2563EB', surface: '#EFF6FF', width: 150, height: 300 },
  { id: 'uml.actor-lifeline', name: 'Actor lifeline', tags: ['uml', 'sequence', 'actor', 'lifeline'], variant: 'lifeline', accent: '#475569', surface: '#F8FAFC', width: 150, height: 300 },
  { id: 'uml.object-lifeline', name: 'Object lifeline', tags: ['uml', 'sequence', 'object', 'lifeline'], variant: 'lifeline', accent: '#0D9488', surface: '#F0FDFA', width: 160, height: 300 },
  { id: 'uml.activation', name: 'Activation', tags: ['uml', 'sequence', 'activation', 'execution'], variant: 'card', accent: '#2563EB', surface: '#EFF6FF', width: 36, height: 180 },
  { id: 'uml.sequence-frame', name: 'Sequence frame', tags: ['uml', 'sequence', 'frame', 'interaction'], variant: 'architecture-zone', accent: '#64748B', surface: '#F8FAFC', width: 320, height: 220 },
  { id: 'uml.fragment-alt', name: 'Combined fragment: alt', tags: ['uml', 'sequence', 'fragment', 'alt'], variant: 'architecture-zone', accent: '#B45309', surface: '#FFFBEB', width: 300, height: 190 },
  { id: 'uml.fragment-loop', name: 'Combined fragment: loop', tags: ['uml', 'sequence', 'fragment', 'loop'], variant: 'architecture-zone', accent: '#7C3AED', surface: '#F5F3FF', width: 300, height: 190 },
  { id: 'uml.object-node', name: 'Object node', tags: ['uml', 'activity', 'object'], variant: 'uml-interface', accent: '#0D9488', surface: '#F0FDFA', width: 180, height: 100 },
  { id: 'uml.central-buffer', name: 'Central buffer', tags: ['uml', 'activity', 'buffer'], variant: 'uml-interface', accent: '#7C3AED', surface: '#F5F3FF', width: 180, height: 100 },
  { id: 'uml.datastore-node', name: 'Datastore node', tags: ['uml', 'activity', 'datastore'], variant: 'database', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'uml.flow-final', name: 'Flow final', tags: ['uml', 'activity', 'flow final'], variant: 'bpmn-event', accent: '#DC2626', surface: '#FEF2F2', width: 68, height: 68, composition: 'circle' },
  { id: 'uml.send-signal', name: 'Send signal action', tags: ['uml', 'activity', 'signal', 'send'], variant: 'chevron', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'uml.accept-event', name: 'Accept event action', tags: ['uml', 'activity', 'event', 'accept'], variant: 'chevron', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'uml.deployment-specification', name: 'Deployment specification', tags: ['uml', 'deployment', 'specification'], variant: 'note', accent: '#B45309', surface: '#FFFBEB' },
] as const satisfies readonly BuiltinSpec[];

const ERD_SPECS = [
  { id: 'erd.entity', name: 'Entity', tags: ['erd', 'table', 'database'], variant: 'erd-entity', accent: '#2563EB', surface: '#EFF6FF', width: 220, height: 150 },
  { id: 'erd.weak-entity', name: 'Weak entity', tags: ['erd', 'table', 'dependent'], variant: 'erd-entity', accent: '#7C3AED', surface: '#F5F3FF', width: 220, height: 150 },
  { id: 'erd.relationship', name: 'Relationship', tags: ['erd', 'relation', 'cardinality'], variant: 'erd-relationship', accent: '#B45309', surface: '#FFFBEB', width: 130, height: 100, composition: 'circle' },
  { id: 'erd.identifying-relationship', name: 'Identifying relationship', tags: ['erd', 'relation', 'identifying'], variant: 'erd-relationship', accent: '#7C3AED', surface: '#F5F3FF', width: 130, height: 100, composition: 'circle' },
  { id: 'erd.attribute', name: 'Attribute', tags: ['erd', 'field', 'column'], variant: 'ellipse', accent: '#0D9488', surface: '#F0FDFA', width: 150, height: 88 },
  { id: 'erd.key-attribute', name: 'Key attribute', tags: ['erd', 'primary key', 'field'], variant: 'ellipse', accent: '#B45309', surface: '#FFFBEB', width: 150, height: 88 },
  { id: 'erd.multivalued-attribute', name: 'Multivalued attribute', tags: ['erd', 'attribute', 'multiple'], variant: 'bpmn-event', accent: '#0D9488', surface: '#F0FDFA', width: 150, height: 88 },
  { id: 'erd.derived-attribute', name: 'Derived attribute', tags: ['erd', 'attribute', 'derived'], variant: 'ellipse', accent: '#64748B', surface: '#F8FAFC', dashed: true, width: 150, height: 88 },
  { id: 'erd.associative-entity', name: 'Associative entity', tags: ['erd', 'junction', 'entity'], variant: 'erd-entity', accent: '#0D9488', surface: '#F0FDFA', width: 220, height: 150 },
  { id: 'erd.category', name: 'Category / union', tags: ['erd', 'category', 'union'], variant: 'triangle', accent: '#7C3AED', surface: '#F5F3FF', width: 110, height: 90 },
  { id: 'erd.supertype', name: 'Supertype entity', tags: ['erd', 'supertype', 'entity'], variant: 'erd-entity', accent: '#2563EB', surface: '#EFF6FF', width: 220, height: 150 },
  { id: 'erd.subtype', name: 'Subtype entity', tags: ['erd', 'subtype', 'entity'], variant: 'erd-entity', accent: '#0D9488', surface: '#F0FDFA', width: 220, height: 150 },
  { id: 'erd.lookup-entity', name: 'Lookup entity', tags: ['erd', 'lookup', 'reference'], variant: 'erd-entity', accent: '#B45309', surface: '#FFFBEB', width: 220, height: 150 },
  { id: 'erd.fact-entity', name: 'Fact entity', tags: ['erd', 'fact', 'warehouse'], variant: 'erd-entity', accent: '#7C3AED', surface: '#F5F3FF', width: 220, height: 150 },
  { id: 'erd.dimension-entity', name: 'Dimension entity', tags: ['erd', 'dimension', 'warehouse'], variant: 'erd-entity', accent: '#0D9488', surface: '#F0FDFA', width: 220, height: 150 },
  { id: 'erd.composite-attribute', name: 'Composite attribute', tags: ['erd', 'attribute', 'composite'], variant: 'bpmn-event', accent: '#2563EB', surface: '#EFF6FF', width: 160, height: 92 },
  { id: 'erd.optional-attribute', name: 'Optional attribute', tags: ['erd', 'attribute', 'optional'], variant: 'ellipse', accent: '#64748B', surface: '#F8FAFC', dashed: true, width: 150, height: 88 },
  { id: 'erd.one', name: 'Cardinality one', tags: ['erd', 'cardinality', 'one'], variant: 'card', accent: '#475569', surface: '#F8FAFC', width: 64, height: 52 },
  { id: 'erd.zero-one', name: 'Cardinality zero or one', tags: ['erd', 'cardinality', 'zero one'], variant: 'ellipse', accent: '#475569', surface: '#F8FAFC', width: 72, height: 56 },
  { id: 'erd.one-many', name: 'Cardinality one or many', tags: ['erd', 'cardinality', 'one many'], variant: 'chevron', accent: '#2563EB', surface: '#EFF6FF', width: 100, height: 64 },
  { id: 'erd.zero-many', name: 'Cardinality zero or many', tags: ['erd', 'cardinality', 'zero many'], variant: 'chevron', accent: '#0D9488', surface: '#F0FDFA', width: 100, height: 64 },
  { id: 'erd.relationship-label', name: 'Relationship label', tags: ['erd', 'relationship', 'label'], variant: 'callout', accent: '#64748B', surface: '#F8FAFC', width: 160, height: 90 },
] as const satisfies readonly BuiltinSpec[];

const ORGCHART_SPECS = [
  { id: 'orgchart.executive', name: 'Executive', tags: ['org chart', 'executive', 'leadership'], variant: 'user', symbol: 'user', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'orgchart.manager', name: 'Manager', tags: ['org chart', 'manager', 'team'], variant: 'user', symbol: 'user', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'orgchart.employee', name: 'Employee', tags: ['org chart', 'employee', 'person'], variant: 'user', symbol: 'user', accent: '#475569', surface: '#F8FAFC' },
  { id: 'orgchart.team', name: 'Team', tags: ['org chart', 'team', 'group'], variant: 'architecture-zone', accent: '#0D9488', surface: '#F0FDFA', width: 260, height: 160 },
  { id: 'orgchart.department', name: 'Department', tags: ['org chart', 'department', 'organization'], variant: 'architecture-zone', accent: '#2563EB', surface: '#EFF6FF', width: 280, height: 180 },
  { id: 'orgchart.vacancy', name: 'Open position', tags: ['org chart', 'vacancy', 'position'], variant: 'card', accent: '#64748B', surface: '#F8FAFC', dashed: true },
] as const satisfies readonly BuiltinSpec[];

const MINDMAP_SPECS = [
  { id: 'mindmap.central-topic', name: 'Central topic', tags: ['mind map', 'central', 'topic'], variant: 'ellipse', accent: '#7C3AED', surface: '#F5F3FF', width: 220, height: 120 },
  { id: 'mindmap.main-topic', name: 'Main topic', tags: ['mind map', 'main', 'topic'], variant: 'card', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'mindmap.subtopic', name: 'Subtopic', tags: ['mind map', 'subtopic', 'branch'], variant: 'card', accent: '#0D9488', surface: '#F0FDFA', width: 160, height: 90 },
  { id: 'mindmap.idea', name: 'Idea', tags: ['mind map', 'idea', 'thought'], variant: 'callout', accent: '#B45309', surface: '#FFFBEB' },
  { id: 'mindmap.note', name: 'Mind map note', tags: ['mind map', 'note', 'annotation'], variant: 'note', accent: '#64748B', surface: '#F8FAFC' },
  { id: 'mindmap.branch-marker', name: 'Branch marker', tags: ['mind map', 'branch', 'marker'], variant: 'chevron', accent: '#475569', surface: '#F8FAFC', width: 130, height: 72 },
] as const satisfies readonly BuiltinSpec[];

const AWS_SPECS = [
  { id: 'aws.ec2', name: 'EC2 compute instance', tags: ['aws', 'amazon', 'compute', 'ec2', 'vm'], variant: 'rack', symbol: 'server', accent: '#FF9900', surface: '#FFF7ED' },
  { id: 'aws.lambda', name: 'Lambda function', tags: ['aws', 'amazon', 'lambda', 'serverless', 'function'], variant: 'hexagon', symbol: 'function', accent: '#FF9900', surface: '#FFF7ED' },
  { id: 'aws.elastic-load-balancing', name: 'Elastic Load Balancing', tags: ['aws', 'amazon', 'elb', 'load balancer'], variant: 'load-balancer', symbol: 'load-balancer', accent: '#8B5CF6', surface: '#F5F3FF' },
  { id: 'aws.api-gateway', name: 'API Gateway', tags: ['aws', 'amazon', 'api', 'gateway'], variant: 'hexagon', symbol: 'gateway', accent: '#8B5CF6', surface: '#F5F3FF' },
  { id: 'aws.s3', name: 'S3 object storage', tags: ['aws', 'amazon', 's3', 'bucket', 'object storage'], variant: 'database', symbol: 'bucket', accent: '#16A34A', surface: '#F0FDF4' },
  { id: 'aws.rds', name: 'RDS database', tags: ['aws', 'amazon', 'rds', 'sql', 'database'], variant: 'database', symbol: 'database', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'aws.dynamodb', name: 'DynamoDB table', tags: ['aws', 'amazon', 'dynamodb', 'nosql', 'database'], variant: 'database', symbol: 'database', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'aws.sqs', name: 'SQS queue', tags: ['aws', 'amazon', 'sqs', 'queue', 'messaging'], variant: 'queue', symbol: 'queue', accent: '#DB2777', surface: '#FDF2F8' },
  { id: 'aws.sns', name: 'SNS topic', tags: ['aws', 'amazon', 'sns', 'topic', 'pubsub'], variant: 'message', symbol: 'topic', accent: '#DB2777', surface: '#FDF2F8' },
  { id: 'aws.vpc', name: 'VPC', tags: ['aws', 'amazon', 'vpc', 'network', 'boundary'], variant: 'architecture-zone', accent: '#7C3AED', surface: '#F5F3FF', dashed: true, width: 280, height: 180 },
  { id: 'aws.cloudfront', name: 'CloudFront CDN', tags: ['aws', 'amazon', 'cloudfront', 'cdn', 'edge'], variant: 'cloud', symbol: 'cloud', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'aws.route53', name: 'Route 53 DNS', tags: ['aws', 'amazon', 'route53', 'dns'], variant: 'router', symbol: 'globe', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'aws.iam', name: 'IAM identity', tags: ['aws', 'amazon', 'iam', 'identity', 'security'], variant: 'user', symbol: 'user', accent: '#DC2626', surface: '#FEF2F2' },
  { id: 'aws.cloudwatch', name: 'CloudWatch monitoring', tags: ['aws', 'amazon', 'cloudwatch', 'monitoring', 'observability'], variant: 'display', symbol: 'monitor', accent: '#DB2777', surface: '#FDF2F8' },
  { id: 'aws.ecs', name: 'ECS container service', tags: ['aws', 'amazon', 'ecs', 'container', 'compute'], variant: 'deployment-node', symbol: 'container', accent: '#FF9900', surface: '#FFF7ED' },
  { id: 'aws.eks', name: 'EKS Kubernetes cluster', tags: ['aws', 'amazon', 'eks', 'kubernetes', 'cluster'], variant: 'architecture-zone', accent: '#FF9900', surface: '#FFF7ED', dashed: true, width: 260, height: 160 },
  { id: 'aws.elasticache', name: 'ElastiCache', tags: ['aws', 'amazon', 'elasticache', 'cache', 'redis'], variant: 'database', symbol: 'cache', accent: '#DC2626', surface: '#FEF2F2' },
  { id: 'aws.kinesis', name: 'Kinesis data stream', tags: ['aws', 'amazon', 'kinesis', 'stream', 'events'], variant: 'queue', symbol: 'stream', accent: '#8B5CF6', surface: '#F5F3FF' },
  { id: 'aws.step-functions', name: 'Step Functions workflow', tags: ['aws', 'amazon', 'step functions', 'workflow', 'orchestration'], variant: 'predefined-process', symbol: 'workflow', accent: '#DB2777', surface: '#FDF2F8' },
  { id: 'aws.secrets-manager', name: 'Secrets Manager', tags: ['aws', 'amazon', 'secrets manager', 'secret', 'security'], variant: 'firewall', symbol: 'key', accent: '#DC2626', surface: '#FEF2F2' },
  { id: 'aws.ebs', name: 'Elastic Block Store', tags: ['aws', 'amazon', 'ebs', 'block storage', 'disk'], variant: 'database', symbol: 'database', accent: '#16A34A', surface: '#F0FDF4' },
  { id: 'aws.efs', name: 'Elastic File System', tags: ['aws', 'amazon', 'efs', 'file storage', 'nfs'], variant: 'database', symbol: 'database', accent: '#16A34A', surface: '#F0FDF4' },
  { id: 'aws.fsx', name: 'Amazon FSx', tags: ['aws', 'amazon', 'fsx', 'file system', 'storage'], variant: 'database', symbol: 'database', accent: '#16A34A', surface: '#F0FDF4' },
  { id: 'aws.aurora', name: 'Amazon Aurora', tags: ['aws', 'amazon', 'aurora', 'relational', 'database'], variant: 'database', symbol: 'database', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'aws.redshift', name: 'Amazon Redshift', tags: ['aws', 'amazon', 'redshift', 'warehouse', 'analytics'], variant: 'database', symbol: 'database', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'aws.opensearch', name: 'OpenSearch Service', tags: ['aws', 'amazon', 'opensearch', 'search', 'analytics'], variant: 'display', symbol: 'search', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'aws.documentdb', name: 'Amazon DocumentDB', tags: ['aws', 'amazon', 'documentdb', 'document', 'database'], variant: 'database', symbol: 'database', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'aws.neptune', name: 'Amazon Neptune', tags: ['aws', 'amazon', 'neptune', 'graph', 'database'], variant: 'database', symbol: 'database', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'aws.eventbridge', name: 'Amazon EventBridge', tags: ['aws', 'amazon', 'eventbridge', 'event bus', 'events'], variant: 'message', symbol: 'event-bus', accent: '#DB2777', surface: '#FDF2F8' },
  { id: 'aws.msk', name: 'Managed Streaming for Apache Kafka', tags: ['aws', 'amazon', 'msk', 'kafka', 'streaming'], variant: 'queue', symbol: 'stream', accent: '#DB2777', surface: '#FDF2F8' },
  { id: 'aws.amazon-mq', name: 'Amazon MQ', tags: ['aws', 'amazon', 'mq', 'broker', 'messaging'], variant: 'queue', symbol: 'queue', accent: '#DB2777', surface: '#FDF2F8' },
  { id: 'aws.fargate', name: 'AWS Fargate', tags: ['aws', 'amazon', 'fargate', 'containers', 'serverless'], variant: 'deployment-node', symbol: 'container', accent: '#FF9900', surface: '#FFF7ED' },
  { id: 'aws.ecr', name: 'Elastic Container Registry', tags: ['aws', 'amazon', 'ecr', 'container registry', 'images'], variant: 'database', symbol: 'registry', accent: '#FF9900', surface: '#FFF7ED' },
  { id: 'aws.batch', name: 'AWS Batch', tags: ['aws', 'amazon', 'batch', 'compute', 'jobs'], variant: 'rack', symbol: 'server', accent: '#FF9900', surface: '#FFF7ED' },
  { id: 'aws.app-runner', name: 'AWS App Runner', tags: ['aws', 'amazon', 'app runner', 'web', 'containers'], variant: 'cloud', symbol: 'cloud', accent: '#FF9900', surface: '#FFF7ED' },
  { id: 'aws.cognito', name: 'Amazon Cognito', tags: ['aws', 'amazon', 'cognito', 'identity', 'authentication'], variant: 'user', symbol: 'user', accent: '#DC2626', surface: '#FEF2F2' },
  { id: 'aws.kms', name: 'Key Management Service', tags: ['aws', 'amazon', 'kms', 'keys', 'encryption', 'security'], variant: 'firewall', symbol: 'key', accent: '#DC2626', surface: '#FEF2F2' },
  { id: 'aws.waf', name: 'AWS WAF', tags: ['aws', 'amazon', 'waf', 'firewall', 'security'], variant: 'firewall', symbol: 'firewall', accent: '#DC2626', surface: '#FEF2F2' },
  { id: 'aws.shield', name: 'AWS Shield', tags: ['aws', 'amazon', 'shield', 'ddos', 'security'], variant: 'firewall', symbol: 'shield', accent: '#DC2626', surface: '#FEF2F2' },
  { id: 'aws.cloudtrail', name: 'AWS CloudTrail', tags: ['aws', 'amazon', 'cloudtrail', 'audit', 'logging'], variant: 'display', symbol: 'monitor', accent: '#DB2777', surface: '#FDF2F8' },
  { id: 'aws.config', name: 'AWS Config', tags: ['aws', 'amazon', 'config', 'compliance', 'inventory'], variant: 'display', symbol: 'monitor', accent: '#DB2777', surface: '#FDF2F8' },
  { id: 'aws.systems-manager', name: 'AWS Systems Manager', tags: ['aws', 'amazon', 'systems manager', 'operations', 'management'], variant: 'display', symbol: 'monitor', accent: '#DB2777', surface: '#FDF2F8' },
  { id: 'aws.cloudformation', name: 'AWS CloudFormation', tags: ['aws', 'amazon', 'cloudformation', 'infrastructure as code', 'iac'], variant: 'predefined-process', symbol: 'workflow', accent: '#DB2777', surface: '#FDF2F8' },
  { id: 'aws.codebuild', name: 'AWS CodeBuild', tags: ['aws', 'amazon', 'codebuild', 'build', 'ci'], variant: 'predefined-process', symbol: 'workflow', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'aws.codepipeline', name: 'AWS CodePipeline', tags: ['aws', 'amazon', 'codepipeline', 'pipeline', 'cicd'], variant: 'predefined-process', symbol: 'workflow', accent: '#2563EB', surface: '#EFF6FF' },
  { id: 'aws.glue', name: 'AWS Glue', tags: ['aws', 'amazon', 'glue', 'etl', 'data integration'], variant: 'predefined-process', symbol: 'workflow', accent: '#8B5CF6', surface: '#F5F3FF' },
  { id: 'aws.athena', name: 'Amazon Athena', tags: ['aws', 'amazon', 'athena', 'query', 'analytics'], variant: 'display', symbol: 'monitor', accent: '#8B5CF6', surface: '#F5F3FF' },
  { id: 'aws.emr', name: 'Amazon EMR', tags: ['aws', 'amazon', 'emr', 'spark', 'hadoop', 'analytics'], variant: 'deployment-node', symbol: 'container', accent: '#8B5CF6', surface: '#F5F3FF' },
  { id: 'aws.sagemaker', name: 'Amazon SageMaker', tags: ['aws', 'amazon', 'sagemaker', 'machine learning', 'ml', 'ai'], variant: 'hexagon', symbol: 'ai', accent: '#8B5CF6', surface: '#F5F3FF' },
  { id: 'aws.bedrock', name: 'Amazon Bedrock', tags: ['aws', 'amazon', 'bedrock', 'generative ai', 'foundation model', 'ai'], variant: 'hexagon', symbol: 'ai', accent: '#8B5CF6', surface: '#F5F3FF' },
] as const satisfies readonly BuiltinSpec[];

const AZURE_SPECS = [
  { id: 'azure.virtual-machine', name: 'Azure Virtual Machine', tags: ['azure', 'microsoft', 'vm', 'compute'], variant: 'rack', symbol: 'server', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.functions', name: 'Azure Functions', tags: ['azure', 'microsoft', 'functions', 'serverless'], variant: 'hexagon', symbol: 'function', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.load-balancer', name: 'Azure Load Balancer', tags: ['azure', 'microsoft', 'load balancer', 'traffic'], variant: 'load-balancer', symbol: 'load-balancer', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.api-management', name: 'API Management', tags: ['azure', 'microsoft', 'api', 'gateway'], variant: 'hexagon', symbol: 'gateway', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'azure.blob-storage', name: 'Blob Storage', tags: ['azure', 'microsoft', 'blob', 'object storage'], variant: 'database', symbol: 'bucket', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.sql-database', name: 'Azure SQL Database', tags: ['azure', 'microsoft', 'sql', 'database'], variant: 'database', symbol: 'database', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.cosmos-db', name: 'Cosmos DB', tags: ['azure', 'microsoft', 'cosmos', 'nosql', 'database'], variant: 'database', symbol: 'database', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'azure.service-bus', name: 'Service Bus queue', tags: ['azure', 'microsoft', 'service bus', 'queue', 'messaging'], variant: 'queue', symbol: 'queue', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.event-grid', name: 'Event Grid topic', tags: ['azure', 'microsoft', 'event grid', 'topic', 'events'], variant: 'message', symbol: 'event-bus', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'azure.virtual-network', name: 'Virtual Network', tags: ['azure', 'microsoft', 'vnet', 'network', 'boundary'], variant: 'architecture-zone', accent: '#0078D4', surface: '#EFF6FF', dashed: true, width: 280, height: 180 },
  { id: 'azure.front-door', name: 'Azure Front Door', tags: ['azure', 'microsoft', 'front door', 'cdn', 'edge'], variant: 'cloud', symbol: 'cloud', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.dns', name: 'Azure DNS', tags: ['azure', 'microsoft', 'dns'], variant: 'router', symbol: 'globe', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.key-vault', name: 'Key Vault', tags: ['azure', 'microsoft', 'key vault', 'secret', 'security'], variant: 'firewall', symbol: 'key', accent: '#B45309', surface: '#FFFBEB' },
  { id: 'azure.monitor', name: 'Azure Monitor', tags: ['azure', 'microsoft', 'monitor', 'observability'], variant: 'display', symbol: 'monitor', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.app-service', name: 'Azure App Service', tags: ['azure', 'microsoft', 'app service', 'web app', 'paas'], variant: 'cloud', symbol: 'cloud', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.aks', name: 'Azure Kubernetes Service', tags: ['azure', 'microsoft', 'aks', 'kubernetes', 'cluster'], variant: 'architecture-zone', accent: '#0078D4', surface: '#EFF6FF', dashed: true, width: 260, height: 160 },
  { id: 'azure.container-apps', name: 'Azure Container Apps', tags: ['azure', 'microsoft', 'container apps', 'container', 'compute'], variant: 'deployment-node', symbol: 'container', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.redis-cache', name: 'Azure Cache for Redis', tags: ['azure', 'microsoft', 'redis', 'cache'], variant: 'database', symbol: 'cache', accent: '#DC2626', surface: '#FEF2F2' },
  { id: 'azure.event-hubs', name: 'Event Hubs stream', tags: ['azure', 'microsoft', 'event hubs', 'stream', 'events'], variant: 'queue', symbol: 'stream', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'azure.logic-apps', name: 'Logic Apps workflow', tags: ['azure', 'microsoft', 'logic apps', 'workflow', 'orchestration'], variant: 'predefined-process', symbol: 'workflow', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'azure.vm-scale-sets', name: 'Virtual Machine Scale Sets', tags: ['azure', 'microsoft', 'vm scale sets', 'vmss', 'compute'], variant: 'rack', symbol: 'server', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.container-instances', name: 'Container Instances', tags: ['azure', 'microsoft', 'container instances', 'aci', 'containers'], variant: 'deployment-node', symbol: 'container', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.container-registry', name: 'Container Registry', tags: ['azure', 'microsoft', 'container registry', 'acr', 'images'], variant: 'database', symbol: 'registry', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.storage-account', name: 'Storage Account', tags: ['azure', 'microsoft', 'storage account', 'storage'], variant: 'database', symbol: 'bucket', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.files', name: 'Azure Files', tags: ['azure', 'microsoft', 'files', 'file storage', 'smb'], variant: 'database', symbol: 'database', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.managed-disks', name: 'Managed Disks', tags: ['azure', 'microsoft', 'managed disks', 'disk', 'block storage'], variant: 'database', symbol: 'database', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.postgresql-flexible-server', name: 'Azure Database for PostgreSQL', tags: ['azure', 'microsoft', 'postgresql', 'postgres', 'database'], variant: 'database', symbol: 'database', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'azure.mysql-flexible-server', name: 'Azure Database for MySQL', tags: ['azure', 'microsoft', 'mysql', 'database'], variant: 'database', symbol: 'database', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'azure.sql-managed-instance', name: 'SQL Managed Instance', tags: ['azure', 'microsoft', 'sql managed instance', 'database'], variant: 'database', symbol: 'database', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.synapse-analytics', name: 'Azure Synapse Analytics', tags: ['azure', 'microsoft', 'synapse', 'warehouse', 'analytics'], variant: 'display', symbol: 'monitor', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'azure.data-factory', name: 'Azure Data Factory', tags: ['azure', 'microsoft', 'data factory', 'etl', 'pipeline'], variant: 'predefined-process', symbol: 'workflow', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'azure.databricks', name: 'Azure Databricks', tags: ['azure', 'microsoft', 'databricks', 'spark', 'analytics'], variant: 'deployment-node', symbol: 'container', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'azure.stream-analytics', name: 'Stream Analytics', tags: ['azure', 'microsoft', 'stream analytics', 'stream', 'analytics'], variant: 'queue', symbol: 'stream', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'azure.application-gateway', name: 'Application Gateway', tags: ['azure', 'microsoft', 'application gateway', 'load balancer', 'waf'], variant: 'load-balancer', symbol: 'load-balancer', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.traffic-manager', name: 'Traffic Manager', tags: ['azure', 'microsoft', 'traffic manager', 'dns', 'routing'], variant: 'router', symbol: 'router', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.expressroute', name: 'ExpressRoute', tags: ['azure', 'microsoft', 'expressroute', 'private connection', 'network'], variant: 'router', symbol: 'router', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.vpn-gateway', name: 'VPN Gateway', tags: ['azure', 'microsoft', 'vpn gateway', 'vpn', 'network'], variant: 'router', symbol: 'shield', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.nat-gateway', name: 'NAT Gateway', tags: ['azure', 'microsoft', 'nat gateway', 'nat', 'network'], variant: 'router', symbol: 'router', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.firewall', name: 'Azure Firewall', tags: ['azure', 'microsoft', 'firewall', 'network security'], variant: 'firewall', symbol: 'firewall', accent: '#DC2626', surface: '#FEF2F2' },
  { id: 'azure.ddos-protection', name: 'Azure DDoS Protection', tags: ['azure', 'microsoft', 'ddos protection', 'security'], variant: 'firewall', symbol: 'shield', accent: '#DC2626', surface: '#FEF2F2' },
  { id: 'azure.entra-id', name: 'Microsoft Entra ID', tags: ['azure', 'microsoft', 'entra id', 'identity', 'authentication'], variant: 'user', symbol: 'user', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.managed-identities', name: 'Managed Identities', tags: ['azure', 'microsoft', 'managed identities', 'identity', 'security'], variant: 'user', symbol: 'user', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.defender-for-cloud', name: 'Defender for Cloud', tags: ['azure', 'microsoft', 'defender for cloud', 'security', 'posture'], variant: 'firewall', symbol: 'shield', accent: '#DC2626', surface: '#FEF2F2' },
  { id: 'azure.sentinel', name: 'Microsoft Sentinel', tags: ['azure', 'microsoft', 'sentinel', 'siem', 'security'], variant: 'display', symbol: 'monitor', accent: '#DC2626', surface: '#FEF2F2' },
  { id: 'azure.log-analytics', name: 'Log Analytics', tags: ['azure', 'microsoft', 'log analytics', 'logging', 'observability'], variant: 'display', symbol: 'monitor', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.application-insights', name: 'Application Insights', tags: ['azure', 'microsoft', 'application insights', 'apm', 'observability'], variant: 'display', symbol: 'monitor', accent: '#0078D4', surface: '#EFF6FF' },
  { id: 'azure.machine-learning', name: 'Azure Machine Learning', tags: ['azure', 'microsoft', 'machine learning', 'ml', 'ai'], variant: 'hexagon', symbol: 'ai', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'azure.ai-foundry', name: 'Microsoft Foundry', tags: ['azure', 'microsoft', 'foundry', 'ai foundry', 'generative ai', 'ai'], variant: 'hexagon', symbol: 'ai', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'azure.openai', name: 'Azure OpenAI Service', tags: ['azure', 'microsoft', 'openai', 'generative ai', 'llm', 'ai'], variant: 'hexagon', symbol: 'ai', accent: '#0D9488', surface: '#F0FDFA' },
  { id: 'azure.ai-search', name: 'Azure AI Search', tags: ['azure', 'microsoft', 'ai search', 'search', 'retrieval'], variant: 'display', symbol: 'search', accent: '#7C3AED', surface: '#F5F3FF' },
] as const satisfies readonly BuiltinSpec[];

const GCP_SPECS = [
  { id: 'gcp.compute-engine', name: 'Compute Engine', tags: ['gcp', 'google cloud', 'compute engine', 'vm'], variant: 'rack', symbol: 'server', accent: '#4285F4', surface: '#EFF6FF' },
  { id: 'gcp.cloud-functions', name: 'Cloud Functions', tags: ['gcp', 'google cloud', 'functions', 'serverless'], variant: 'hexagon', symbol: 'function', accent: '#F59E0B', surface: '#FFFBEB' },
  { id: 'gcp.cloud-load-balancing', name: 'Cloud Load Balancing', tags: ['gcp', 'google cloud', 'load balancer', 'traffic'], variant: 'load-balancer', symbol: 'load-balancer', accent: '#4285F4', surface: '#EFF6FF' },
  { id: 'gcp.api-gateway', name: 'API Gateway', tags: ['gcp', 'google cloud', 'api', 'gateway'], variant: 'hexagon', symbol: 'gateway', accent: '#4285F4', surface: '#EFF6FF' },
  { id: 'gcp.cloud-storage', name: 'Cloud Storage', tags: ['gcp', 'google cloud', 'object storage', 'bucket'], variant: 'database', symbol: 'bucket', accent: '#34A853', surface: '#F0FDF4' },
  { id: 'gcp.cloud-sql', name: 'Cloud SQL', tags: ['gcp', 'google cloud', 'sql', 'database'], variant: 'database', symbol: 'database', accent: '#4285F4', surface: '#EFF6FF' },
  { id: 'gcp.firestore', name: 'Firestore', tags: ['gcp', 'google cloud', 'firestore', 'nosql', 'database'], variant: 'database', symbol: 'database', accent: '#F59E0B', surface: '#FFFBEB' },
  { id: 'gcp.pub-sub', name: 'Pub/Sub topic', tags: ['gcp', 'google cloud', 'pubsub', 'topic', 'messaging'], variant: 'message', symbol: 'topic', accent: '#4285F4', surface: '#EFF6FF' },
  { id: 'gcp.eventarc', name: 'Eventarc', tags: ['gcp', 'google cloud', 'eventarc', 'events'], variant: 'queue', symbol: 'event-bus', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'gcp.vpc', name: 'VPC network', tags: ['gcp', 'google cloud', 'vpc', 'network', 'boundary'], variant: 'architecture-zone', accent: '#4285F4', surface: '#EFF6FF', dashed: true, width: 280, height: 180 },
  { id: 'gcp.cloud-cdn', name: 'Cloud CDN', tags: ['gcp', 'google cloud', 'cdn', 'edge'], variant: 'cloud', symbol: 'cloud', accent: '#4285F4', surface: '#EFF6FF' },
  { id: 'gcp.cloud-dns', name: 'Cloud DNS', tags: ['gcp', 'google cloud', 'dns'], variant: 'router', symbol: 'globe', accent: '#4285F4', surface: '#EFF6FF' },
  { id: 'gcp.secret-manager', name: 'Secret Manager', tags: ['gcp', 'google cloud', 'secret manager', 'security'], variant: 'firewall', symbol: 'key', accent: '#EA4335', surface: '#FEF2F2' },
  { id: 'gcp.cloud-monitoring', name: 'Cloud Monitoring', tags: ['gcp', 'google cloud', 'monitoring', 'observability'], variant: 'display', symbol: 'monitor', accent: '#4285F4', surface: '#EFF6FF' },
  { id: 'gcp.cloud-run', name: 'Cloud Run', tags: ['gcp', 'google cloud', 'cloud run', 'container', 'serverless'], variant: 'cloud', symbol: 'cloud', accent: '#4285F4', surface: '#EFF6FF' },
  { id: 'gcp.gke', name: 'Google Kubernetes Engine', tags: ['gcp', 'google cloud', 'gke', 'kubernetes', 'cluster'], variant: 'architecture-zone', accent: '#4285F4', surface: '#EFF6FF', dashed: true, width: 260, height: 160 },
  { id: 'gcp.memorystore', name: 'Memorystore', tags: ['gcp', 'google cloud', 'memorystore', 'redis', 'cache'], variant: 'database', symbol: 'cache', accent: '#EA4335', surface: '#FEF2F2' },
  { id: 'gcp.dataflow', name: 'Dataflow pipeline', tags: ['gcp', 'google cloud', 'dataflow', 'pipeline', 'stream'], variant: 'predefined-process', symbol: 'workflow', accent: '#34A853', surface: '#F0FDF4' },
  { id: 'gcp.cloud-tasks', name: 'Cloud Tasks queue', tags: ['gcp', 'google cloud', 'cloud tasks', 'queue', 'async'], variant: 'queue', symbol: 'queue', accent: '#F59E0B', surface: '#FFFBEB' },
  { id: 'gcp.workflows', name: 'Workflows orchestration', tags: ['gcp', 'google cloud', 'workflows', 'workflow', 'orchestration'], variant: 'predefined-process', symbol: 'workflow', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'gcp.app-engine', name: 'App Engine', tags: ['gcp', 'google cloud', 'app engine', 'paas', 'web'], variant: 'cloud', symbol: 'cloud', accent: '#4285F4', surface: '#EFF6FF' },
  { id: 'gcp.artifact-registry', name: 'Artifact Registry', tags: ['gcp', 'google cloud', 'artifact registry', 'container registry', 'packages'], variant: 'database', symbol: 'registry', accent: '#4285F4', surface: '#EFF6FF' },
  { id: 'gcp.cloud-build', name: 'Cloud Build', tags: ['gcp', 'google cloud', 'cloud build', 'build', 'ci'], variant: 'predefined-process', symbol: 'workflow', accent: '#4285F4', surface: '#EFF6FF' },
  { id: 'gcp.cloud-deploy', name: 'Cloud Deploy', tags: ['gcp', 'google cloud', 'cloud deploy', 'deployment', 'cicd'], variant: 'predefined-process', symbol: 'workflow', accent: '#4285F4', surface: '#EFF6FF' },
  { id: 'gcp.filestore', name: 'Filestore', tags: ['gcp', 'google cloud', 'filestore', 'file storage', 'nfs'], variant: 'database', symbol: 'database', accent: '#34A853', surface: '#F0FDF4' },
  { id: 'gcp.persistent-disk', name: 'Persistent Disk', tags: ['gcp', 'google cloud', 'persistent disk', 'block storage', 'disk'], variant: 'database', symbol: 'database', accent: '#34A853', surface: '#F0FDF4' },
  { id: 'gcp.cloud-spanner', name: 'Cloud Spanner', tags: ['gcp', 'google cloud', 'spanner', 'distributed sql', 'database'], variant: 'database', symbol: 'database', accent: '#4285F4', surface: '#EFF6FF' },
  { id: 'gcp.bigtable', name: 'Bigtable', tags: ['gcp', 'google cloud', 'bigtable', 'nosql', 'database'], variant: 'database', symbol: 'database', accent: '#4285F4', surface: '#EFF6FF' },
  { id: 'gcp.alloydb', name: 'AlloyDB for PostgreSQL', tags: ['gcp', 'google cloud', 'alloydb', 'postgresql', 'database'], variant: 'database', symbol: 'database', accent: '#4285F4', surface: '#EFF6FF' },
  { id: 'gcp.bigquery', name: 'BigQuery', tags: ['gcp', 'google cloud', 'bigquery', 'warehouse', 'analytics'], variant: 'database', symbol: 'database', accent: '#4285F4', surface: '#EFF6FF' },
  { id: 'gcp.dataproc', name: 'Dataproc', tags: ['gcp', 'google cloud', 'dataproc', 'spark', 'hadoop'], variant: 'deployment-node', symbol: 'container', accent: '#34A853', surface: '#F0FDF4' },
  { id: 'gcp.composer', name: 'Cloud Composer', tags: ['gcp', 'google cloud', 'composer', 'airflow', 'orchestration'], variant: 'predefined-process', symbol: 'workflow', accent: '#34A853', surface: '#F0FDF4' },
  { id: 'gcp.data-fusion', name: 'Cloud Data Fusion', tags: ['gcp', 'google cloud', 'data fusion', 'etl', 'integration'], variant: 'predefined-process', symbol: 'workflow', accent: '#34A853', surface: '#F0FDF4' },
  { id: 'gcp.vertex-ai', name: 'Vertex AI', tags: ['gcp', 'google cloud', 'vertex ai', 'machine learning', 'generative ai'], variant: 'hexagon', symbol: 'ai', accent: '#7C3AED', surface: '#F5F3FF' },
  { id: 'gcp.apigee', name: 'Apigee API Management', tags: ['gcp', 'google cloud', 'apigee', 'api management', 'gateway'], variant: 'hexagon', symbol: 'gateway', accent: '#4285F4', surface: '#EFF6FF' },
  { id: 'gcp.cloud-armor', name: 'Cloud Armor', tags: ['gcp', 'google cloud', 'cloud armor', 'waf', 'security'], variant: 'firewall', symbol: 'firewall', accent: '#EA4335', surface: '#FEF2F2' },
  { id: 'gcp.cloud-nat', name: 'Cloud NAT', tags: ['gcp', 'google cloud', 'cloud nat', 'nat', 'network'], variant: 'router', symbol: 'router', accent: '#4285F4', surface: '#EFF6FF' },
  { id: 'gcp.cloud-vpn', name: 'Cloud VPN', tags: ['gcp', 'google cloud', 'cloud vpn', 'vpn', 'network'], variant: 'router', symbol: 'shield', accent: '#4285F4', surface: '#EFF6FF' },
  { id: 'gcp.cloud-interconnect', name: 'Cloud Interconnect', tags: ['gcp', 'google cloud', 'cloud interconnect', 'private connectivity', 'network'], variant: 'router', symbol: 'router', accent: '#4285F4', surface: '#EFF6FF' },
  { id: 'gcp.network-connectivity-center', name: 'Network Connectivity Center', tags: ['gcp', 'google cloud', 'network connectivity center', 'ncc', 'network'], variant: 'router', symbol: 'router', accent: '#4285F4', surface: '#EFF6FF' },
  { id: 'gcp.iam', name: 'Cloud IAM', tags: ['gcp', 'google cloud', 'iam', 'identity', 'permissions'], variant: 'user', symbol: 'user', accent: '#EA4335', surface: '#FEF2F2' },
  { id: 'gcp.identity-platform', name: 'Identity Platform', tags: ['gcp', 'google cloud', 'identity platform', 'authentication', 'identity'], variant: 'user', symbol: 'user', accent: '#EA4335', surface: '#FEF2F2' },
  { id: 'gcp.cloud-kms', name: 'Cloud Key Management Service', tags: ['gcp', 'google cloud', 'kms', 'keys', 'encryption', 'security'], variant: 'firewall', symbol: 'key', accent: '#EA4335', surface: '#FEF2F2' },
  { id: 'gcp.security-command-center', name: 'Security Command Center', tags: ['gcp', 'google cloud', 'security command center', 'security', 'posture'], variant: 'display', symbol: 'monitor', accent: '#EA4335', surface: '#FEF2F2' },
  { id: 'gcp.cloud-logging', name: 'Cloud Logging', tags: ['gcp', 'google cloud', 'cloud logging', 'logs', 'observability'], variant: 'display', symbol: 'monitor', accent: '#4285F4', surface: '#EFF6FF' },
  { id: 'gcp.cloud-trace', name: 'Cloud Trace', tags: ['gcp', 'google cloud', 'cloud trace', 'tracing', 'observability'], variant: 'display', symbol: 'monitor', accent: '#4285F4', surface: '#EFF6FF' },
  { id: 'gcp.error-reporting', name: 'Error Reporting', tags: ['gcp', 'google cloud', 'error reporting', 'errors', 'observability'], variant: 'display', symbol: 'monitor', accent: '#4285F4', surface: '#EFF6FF' },
  { id: 'gcp.cloud-scheduler', name: 'Cloud Scheduler', tags: ['gcp', 'google cloud', 'cloud scheduler', 'cron', 'jobs'], variant: 'predefined-process', symbol: 'clock', accent: '#F59E0B', surface: '#FFFBEB' },
  { id: 'gcp.backup-dr', name: 'Backup and DR Service', tags: ['gcp', 'google cloud', 'backup', 'disaster recovery', 'dr'], variant: 'database', symbol: 'database', accent: '#34A853', surface: '#F0FDF4' },
  { id: 'gcp.cloud-workstations', name: 'Cloud Workstations', tags: ['gcp', 'google cloud', 'cloud workstations', 'developer', 'workstation'], variant: 'rack', symbol: 'server', accent: '#4285F4', surface: '#EFF6FF' },
] as const satisfies readonly BuiltinSpec[];

export const BUILTIN_SHAPE_LIBRARIES = [
  libraryFromSpecs('basic', 'Basic shapes', BASIC_SPECS),
  libraryFromSpecs('generic', 'Generic', GENERIC_SPECS),
  libraryFromSpecs('flowchart', 'Flowchart', FLOWCHART_SPECS),
  libraryFromSpecs('bpmn', 'BPMN', BPMN_SPECS),
  libraryFromSpecs('uml', 'UML', UML_SPECS),
  libraryFromSpecs('erd', 'ERD', ERD_SPECS),
  libraryFromSpecs('integration', 'Integration', INTEGRATION_SPECS),
  libraryFromSpecs('network', 'Network', NETWORK_SPECS),
  libraryFromSpecs('architecture', 'Cloud & architecture', ARCHITECTURE_SPECS),
  libraryFromSpecs('orgchart', 'Org chart', ORGCHART_SPECS),
  libraryFromSpecs('mindmap', 'Mind map', MINDMAP_SPECS),
  libraryFromSpecs('aws', 'AWS-style services', AWS_SPECS),
  libraryFromSpecs('azure', 'Azure-style services', AZURE_SPECS),
  libraryFromSpecs('gcp', 'GCP-style services', GCP_SPECS),
] as const satisfies readonly ShapeLibrary[];
