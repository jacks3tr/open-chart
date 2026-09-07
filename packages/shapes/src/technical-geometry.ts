import type { ShapeGeometryDefinition as Geometry, ShapePathCommandDefinition } from './types.js';

/** Original OpenChart symbols. Coordinates use a 100-unit design grid; labels live below y=74. */
export type TechnicalSymbol = 'load-balancer' | 'router' | 'switch' | 'firewall' | 'client' | 'server'
  | 'service' | 'gateway' | 'function' | 'queue' | 'topic' | 'stream' | 'event-bus' | 'database'
  | 'cache' | 'bucket' | 'worker' | 'clock' | 'webhook' | 'cloud' | 'globe' | 'wifi' | 'shield'
  | 'key' | 'search' | 'monitor' | 'registry' | 'workflow' | 'container' | 'ai' | 'terminal' | 'user';

const ink = '=@Accent';
const surface = '=@Surface';
const outline = { fill: surface, stroke: ink, strokeWidth: 1.8 } as const;

function box(id: string, x: number, y: number, w: number, h: number, radius = 5): Geometry {
  return { id, type: 'rect', x: x / 100, y: y / 100, w: w / 100, h: h / 100, radius, ...outline };
}
function oval(id: string, x: number, y: number, w: number, h: number): Geometry {
  return { id, type: 'ellipse', x: x / 100, y: y / 100, w: w / 100, h: h / 100, ...outline };
}
function path(id: string, points: readonly (readonly [number, number])[], closed = false): Geometry {
  return { id, type: 'path', commands: [
    ...points.map(([x, y], i) => ({ type: i === 0 ? 'move' as const : 'line' as const, x: x / 100, y: y / 100 })),
    ...(closed ? [{ type: 'close' as const }] : []),
  ], fill: closed ? surface : 'none', stroke: ink, strokeWidth: 1.8 };
}
function curve(id: string, commands: readonly ShapePathCommandDefinition[], filled = false): Geometry {
  return { id, type: 'path', commands, fill: filled ? surface : 'none', stroke: ink, strokeWidth: 1.8 };
}
function tint(geometry: Geometry, opacity = 0.12): Geometry {
  return { ...geometry, fill: ink, fillOpacity: opacity, stroke: 'none' };
}
function solid(geometry: Geometry): Geometry { return { ...geometry, fill: ink, stroke: 'none' }; }

export function technicalGeometry(symbol: TechnicalSymbol): readonly Geometry[] {
  switch (symbol) {
    case 'load-balancer':
      return [
        box('body', 4, 5, 92, 62, 10), tint(box('face', 5, 6, 90, 60, 9), 0.06),
        path('fanout', [[22, 36], [46, 36], [46, 18], [70, 18]]),
        path('fanout-center', [[46, 36], [70, 36]]), path('fanout-lower', [[46, 36], [46, 54], [70, 54]]),
        solid(oval('ingress', 14, 30, 9, 12)),
        ...[12, 30, 48].flatMap((y, i) => [
          box(`target-${i}`, 73, y, 14, 12, 3), tint(box(`target-face-${i}`, 75, y + 2, 10, 8, 2), 0.25),
          path(`arrow-${i}`, [[65, y + 2], [70, y + 6], [65, y + 10]]),
        ]),
      ];
    case 'router':
      return [
        curve('body', [{ type: 'move', x: .12, y: .26 }, { type: 'line', x: .12, y: .48 },
          { type: 'cubic', c1x: .12, c1y: .73, c2x: .88, c2y: .73, x: .88, y: .48 },
          { type: 'line', x: .88, y: .26 }, { type: 'close' }], true),
        tint(box('face', 18, 39, 64, 15, 0)), oval('top', 12, 5, 76, 43),
        path('left', [[46, 26], [27, 26], [33, 19]]), path('left-tail', [[27, 26], [33, 33]]),
        path('right', [[54, 26], [73, 26], [67, 19]]), path('right-tail', [[73, 26], [67, 33]]),
        path('north', [[50, 23], [50, 12], [45, 17]]), path('north-tail', [[50, 12], [55, 17]]),
        path('south', [[50, 29], [50, 40], [45, 35]]), path('south-tail', [[50, 40], [55, 35]]),
        ...[37, 47, 57].map((x, i) => solid(oval(`status-${i}`, x, 55, 4, 3))),
      ];
    case 'switch':
      return [box('body', 5, 18, 90, 44, 7),
        tint(box('top', 7, 20, 86, 13, 4)), path('seam', [[5, 36], [95, 36]]),
        ...[15, 31, 47, 63].flatMap((x, i) => [box(`socket-${i}`, x, 42, 11, 12, 1),
          solid(box(`pin-${i}`, x + 3, 42, 5, 3, 0))]),
        solid(oval('power', 82, 46, 5, 7)), path('traffic', [[25, 27], [69, 27], [64, 23]]),
      ];
    case 'server':
    case 'worker':
      return [box('body', 16, 3, 68, 65, 8), tint(box('side', 18, 5, 8, 61, 3)),
        ...[12, 30, 48].flatMap((y, i) => [box(`unit-${i}`, 31, y, 43, 12, 3),
          solid(oval(`status-${i}`, 35, y + 4, 3, 4)), path(`slot-${i}`, [[44, y + 6], [66, y + 6]])]),
        ...(symbol === 'worker' ? [solid(path('job', [[72, 38], [65, 52], [75, 52], [68, 69], [89, 46], [78, 46], [84, 38]], true))] : []),
      ];
    case 'client':
      return [box('body', 9, 4, 82, 48, 7), tint(box('toolbar', 12, 7, 76, 8, 3)),
        path('seam', [[10, 17], [90, 17]]), ...[17, 23, 29].map((x, i) => solid(oval(`control-${i}`, x, 9, 2.5, 3.5))),
        tint(box('panel', 18, 24, 22, 20, 2)), path('content', [[47, 27], [77, 27]]), path('content-short', [[47, 36], [68, 36]]),
        path('stand', [[43, 52], [41, 64], [59, 64], [57, 52]]), path('foot', [[31, 65], [69, 65]]),
      ];
    case 'service':
    case 'terminal':
      return [box('body', 9, 5, 82, 62, 9), tint(box('header', 11, 7, 78, 13, 6)),
        path('divider', [[10, 22], [90, 22]]), ...[18, 25, 32].map((x, i) => solid(oval(`control-${i}`, x, 11, 3, 4))),
        ...(symbol === 'terminal' ? [path('prompt', [[24, 34], [34, 43], [24, 52]]), path('cursor', [[43, 52], [64, 52]])]
          : [tint(box('module', 21, 32, 20, 24, 4), .18), box('module-outline', 21, 32, 20, 24, 4),
            path('endpoint', [[50, 37], [75, 37]]), path('endpoint-short', [[50, 48], [66, 48]])]),
      ];
    case 'gateway':
      return [path('body', [[24, 5], [76, 5], [91, 36], [76, 67], [24, 67], [9, 36]], true),
        tint(path('inset', [[27, 9], [73, 9], [85, 36], [73, 63], [27, 63], [15, 36]], true), .08),
        box('portal', 39, 19, 22, 34, 4), tint(box('portal-face', 41, 21, 18, 30, 2), .2),
        path('inbound', [[17, 36], [32, 36], [27, 31]]), path('inbound-tail', [[32, 36], [27, 41]]),
        path('outbound', [[68, 36], [83, 36], [78, 31]]), path('outbound-tail', [[83, 36], [78, 41]]),
      ];
    case 'function':
      return [path('body', [[29, 5], [71, 5], [90, 36], [71, 67], [29, 67], [10, 36]], true),
        tint(path('face', [[31, 9], [69, 9], [84, 36], [69, 63], [31, 63], [16, 36]], true)),
        solid(path('bolt', [[54, 15], [36, 38], [49, 38], [43, 58], [65, 31], [51, 31]], true)),
      ];
    case 'queue':
    case 'stream':
      return [box('body', 4, 9, 92, 54, 9), tint(box('track', 6, 11, 88, 50, 7), .07),
        ...[16, 34, 52].flatMap((x, i) => [box(`message-${i}`, x, 23, 12, 26, 3),
          tint(box(`message-fill-${i}`, x + 2, 25, 8, 22, 1), .12 + i * .08)]),
        path('outbound', [[71, 36], [87, 36], [80, 29]]), path('arrow-tail', [[87, 36], [80, 43]]),
        ...(symbol === 'stream' ? [path('stream-top', [[17, 15], [63, 15]]), path('stream-bottom', [[17, 57], [63, 57]])] : []),
      ];
    case 'topic':
    case 'event-bus':
      return [path('distribution', [[20, 36], [50, 36], [50, 13], [79, 13]]),
        path('distribution-mid', [[50, 36], [79, 36]]), path('distribution-low', [[50, 36], [50, 59], [79, 59]]),
        ...(symbol === 'topic' ? [oval('body', 6, 22, 25, 28), tint(oval('hub', 10, 26, 17, 20), .25)]
          : [box('body', 7, 8, 20, 56, 6), tint(box('hub', 10, 11, 14, 50, 3), .2)]),
        ...[5, 28, 51].map((y, i) => box(`subscriber-${i}`, 77, y, 17, 16, 4)),
      ];
    case 'database':
      return [curve('body', [{ type: 'move', x: .16, y: .17 }, { type: 'line', x: .16, y: .54 },
        { type: 'cubic', c1x: .16, c1y: .72, c2x: .84, c2y: .72, x: .84, y: .54 },
        { type: 'line', x: .84, y: .17 }, { type: 'close' }], true),
        tint(box('side', 20, 23, 12, 29, 0), .09), oval('top', 16, 5, 68, 24),
        tint(oval('top-inset', 22, 9, 56, 15), .12),
        ...[.35, .49].map((y, i) => curve(`tier-${i}`, [{ type: 'move', x: .16, y },
          { type: 'cubic', c1x: .24, c1y: y + .13, c2x: .76, c2y: y + .13, x: .84, y }])),
      ];
    case 'cache':
    case 'ai':
      return [
        ...[30, 43, 56, 69].flatMap((n, i) => [path(`pin-top-${i}`, [[n, 3], [n, 13]]), path(`pin-bottom-${i}`, [[n, 59], [n, 69]])]),
        ...[24, 36, 48].flatMap((n, i) => [path(`pin-left-${i}`, [[12, n], [22, n]]), path(`pin-right-${i}`, [[78, n], [88, n]])]),
        box('body', 22, 13, 56, 46, 7), tint(box('core', 29, 20, 42, 32, 4), .15),
        ...(symbol === 'cache' ? [solid(path('bolt', [[54, 22], [39, 38], [49, 38], [44, 51], [62, 32], [52, 32]], true))]
          : [path('neurons', [[36, 27], [50, 36], [64, 27]]), path('neurons-low', [[36, 45], [50, 36], [64, 45]]),
            ...[[34, 24], [62, 24], [48, 33], [34, 42], [62, 42]].map(([x, y], i) => solid(oval(`neuron-${i}`, x!, y!, 4, 6)))]),
      ];
    case 'bucket':
      return [path('body', [[17, 18], [24, 61], [76, 61], [83, 18]], true),
        tint(path('face', [[21, 21], [28, 58], [72, 58], [79, 21]], true), .1), oval('rim', 17, 5, 66, 24),
        curve('handle', [{ type: 'move', x: .3, y: .27 }, { type: 'cubic', c1x: .3, c1y: .54, c2x: .7, c2y: .54, x: .7, y: .27 }]),
      ];
    case 'firewall':
    case 'shield':
    case 'key':
      return [curve('body', [{ type: 'move', x: .5, y: .04 }, { type: 'line', x: .83, y: .16 },
        { type: 'line', x: .8, y: .41 }, { type: 'cubic', c1x: .78, c1y: .55, c2x: .62, c2y: .65, x: .5, y: .7 },
        { type: 'cubic', c1x: .38, c1y: .65, c2x: .22, c2y: .55, x: .2, y: .41 },
        { type: 'line', x: .17, y: .16 }, { type: 'close' }], true),
        tint(path('half', [[50, 8], [78, 19], [75, 42], [67, 54], [50, 65]], true), .15),
        ...(symbol === 'firewall' ? [path('courses', [[29, 25], [71, 25]]), path('course-mid', [[27, 36], [73, 36]]),
          path('course-low', [[32, 47], [68, 47]]), path('joint-a', [[44, 25], [44, 36]]), path('joint-b', [[57, 36], [57, 47]])]
          : symbol === 'key' ? [oval('key-head', 36, 21, 18, 20), path('key-shaft', [[50, 39], [63, 53], [69, 46]]), path('key-tooth', [[57, 46], [62, 40]])]
            : [path('check', [[34, 37], [46, 49], [67, 25]])]),
      ];
    case 'clock':
      return [oval('body', 25, 4, 50, 65), tint(oval('dial', 29, 9, 42, 55), .09),
        path('hands', [[50, 18], [50, 37], [65, 46]]), solid(oval('pivot', 48, 34, 4, 5)),
        ...[[50, 11, 50, 15], [50, 58, 50, 62], [30, 36, 33, 36], [67, 36, 70, 36]].map(([x, y, x2, y2], i) => path(`tick-${i}`, [[x!, y!], [x2!, y2!]])),
      ];
    case 'cloud':
      return [curve('body', [{ type: 'move', x: .24, y: .63 },
        { type: 'cubic', c1x: .02, c1y: .63, c2x: .02, c2y: .3, x: .24, y: .3 },
        { type: 'cubic', c1x: .28, c1y: -.01, c2x: .64, c2y: -.01, x: .7, y: .26 },
        { type: 'cubic', c1x: .95, c1y: .2, c2x: 1, c2y: .63, x: .77, y: .63 }, { type: 'close' }], true),
        tint(curve('lower-tone', [{ type: 'move', x: .15, y: .48 }, { type: 'line', x: .85, y: .48 },
          { type: 'cubic', c1x: .87, c1y: .58, c2x: .82, c2y: .61, x: .77, y: .61 },
          { type: 'line', x: .24, y: .61 }, { type: 'cubic', c1x: .18, c1y: .61, c2x: .14, c2y: .56, x: .15, y: .48 }, { type: 'close' }], true)),
      ];
    case 'globe':
      return [oval('body', 24, 3, 52, 66), tint(oval('ocean', 27, 7, 46, 58), .08), oval('meridian', 38, 3, 24, 66),
        path('equator', [[24, 36], [76, 36]]), path('latitude-north', [[29, 20], [71, 20]]), path('latitude-south', [[29, 52], [71, 52]])];
    case 'wifi':
      return [box('body', 22, 49, 56, 17, 7), solid(oval('status', 47, 54, 6, 7)),
        ...[[.13, .87, .12], [.25, .75, .25], [.38, .62, .38]].map(([left, right, y], i) => curve(`radio-${i}`, [
          { type: 'move', x: left!, y: y! + .13 }, { type: 'cubic', c1x: .38, c1y: y! - .13, c2x: .62, c2y: y! - .13, x: right!, y: y! + .13 }])),
      ];
    case 'monitor':
    case 'search':
      return [box('body', 7, 6, 86, 59, 8), tint(box('header', 9, 8, 82, 9, 4), .12),
        ...(symbol === 'monitor' ? [path('baseline', [[17, 53], [83, 53]]), path('metric', [[17, 43], [29, 43], [38, 26], [49, 53], [60, 34], [68, 43], [83, 43]])]
          : [oval('lens', 30, 23, 27, 29), tint(oval('lens-fill', 33, 26, 21, 23), .12), path('handle', [[54, 48], [69, 59]])]),
      ];
    case 'registry':
      return [box('body', 14, 5, 72, 62, 7), tint(box('header', 16, 7, 68, 12, 4)),
        ...[27, 43].flatMap((y, i) => [box(`record-${i}`, 24, y, 13, 13, 2), path(`row-${i}`, [[45, y + 3], [75, y + 3]]), path(`row-detail-${i}`, [[45, y + 10], [65, y + 10]])]),
      ];
    case 'workflow':
    case 'webhook':
      return [path('route', [[24, 18], [52, 18], [52, 53], [77, 53]]),
        ...(symbol === 'webhook' ? [path('return', [[76, 39], [76, 18], [64, 18]]), path('return-arrow', [[69, 12], [64, 18], [69, 24]])] : []),
        box('source', 9, 7, 24, 23, 5), tint(box('source-fill', 12, 10, 18, 17, 3), .2),
        box('target', 66, 42, 25, 23, 5), solid(oval('step', 48, 31, 8, 10)),
      ];
    case 'container':
      return [path('top', [[17, 18], [36, 5], [84, 5], [65, 18]], true),
        path('side', [[65, 18], [84, 5], [84, 51], [65, 67]], true), tint(path('side-tone', [[67, 20], [81, 10], [81, 50], [67, 62]], true), .2),
        box('body', 17, 18, 48, 49, 3), ...[27, 39, 51].map((x, i) => path(`rib-${i}`, [[x, 28], [x, 56]])),
      ];
    case 'user':
      return [oval('head', 39, 4, 22, 26), tint(oval('head-tone', 43, 7, 16, 20), .15),
        curve('body', [{ type: 'move', x: .24, y: .67 }, { type: 'line', x: .24, y: .55 },
          { type: 'cubic', c1x: .24, c1y: .29, c2x: .76, c2y: .29, x: .76, y: .55 },
          { type: 'line', x: .76, y: .67 }, { type: 'close' }], true),
        tint(path('shoulders', [[29, 55], [71, 55], [71, 63], [29, 63]], true), .13),
      ];
  }
}
