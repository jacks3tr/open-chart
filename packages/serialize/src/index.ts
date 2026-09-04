import type { OpenChartDocument } from '@openchart/ir';
import {
  buildSceneDescription,
  type SceneBuildOptions,
  type SceneDescription,
  type SceneDotGridItem,
  type SceneItem,
  type ScenePathCommand,
  type ScenePathItem,
} from '@openchart/scene';

export {
  D2ProjectionError,
  exportDocumentToD2,
  exportDocumentToMermaid,
  parseOpenChartD2,
  type D2Projection,
  type D2ProjectionEdge,
  type D2ProjectionNode,
  type D2ProjectionPort,
  type TextProjectionLoss,
  type TextProjectionResult,
} from './text-projections.js';

export type SvgRenderOptions = SceneBuildOptions;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeId(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_.-]/g, '-');
  return /^[A-Za-z_]/.test(sanitized) ? sanitized : `id-${sanitized}`;
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function opacityAttribute(opacity: number | undefined): string {
  return opacity === undefined ? '' : ` opacity="${formatNumber(opacity)}"`;
}

function paintAttributes(item: {
  readonly fill?: string;
  readonly fillOpacity?: number;
  readonly stroke?: string;
  readonly strokeOpacity?: number;
  readonly strokeWidth?: number;
  readonly dash?: readonly number[];
}): string {
  return [
    ` fill="${escapeXml(item.fill ?? 'none')}"`,
    item.fillOpacity === undefined ? '' : ` fill-opacity="${formatNumber(item.fillOpacity)}"`,
    item.stroke === undefined ? '' : ` stroke="${escapeXml(item.stroke)}"`,
    item.strokeOpacity === undefined ? '' : ` stroke-opacity="${formatNumber(item.strokeOpacity)}"`,
    item.strokeWidth === undefined ? '' : ` stroke-width="${formatNumber(item.strokeWidth)}"`,
    item.dash === undefined ? '' : ` stroke-dasharray="${item.dash.map(formatNumber).join(' ')}"`,
  ].join('');
}

function pathData(commands: readonly ScenePathCommand[]): string {
  return commands
    .map((command) => {
      switch (command.type) {
        case 'move':
          return `M ${formatNumber(command.to.x)} ${formatNumber(command.to.y)}`;
        case 'line':
          return `L ${formatNumber(command.to.x)} ${formatNumber(command.to.y)}`;
        case 'quadratic':
          return `Q ${formatNumber(command.control.x)} ${formatNumber(command.control.y)} ${formatNumber(command.to.x)} ${formatNumber(command.to.y)}`;
        case 'cubic':
          return `C ${formatNumber(command.control1.x)} ${formatNumber(command.control1.y)} ${formatNumber(command.control2.x)} ${formatNumber(command.control2.y)} ${formatNumber(command.to.x)} ${formatNumber(command.to.y)}`;
        case 'close':
          return 'Z';
      }
    })
    .join(' ');
}

function patternId(item: SceneDotGridItem): string {
  return `oc-pattern-${sanitizeId(item.id)}`;
}

function markerId(item: ScenePathItem, position: 'start' | 'end'): string {
  return `oc-marker-${position}-${sanitizeId(item.id)}`;
}

function markerShape(marker: NonNullable<ScenePathItem['markerEnd']>): string {
  const color = escapeXml(marker.fill);
  switch (marker.type) {
    case 'open-arrow':
      return `<path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
    case 'diamond':
      return `<path d="M 9 5 L 5 1 L 1 5 L 5 9 Z" fill="${color}"/>`;
    case 'circle':
      return `<circle cx="5" cy="5" r="3.2" fill="${color}"/>`;
    case 'bar':
      return `<path d="M 7.5 1.5 L 7.5 8.5" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>`;
    case 'crow-foot':
      return `<path d="M 1 5 L 9 1 M 1 5 L 9 5 M 1 5 L 9 9" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>`;
    case 'arrow':
      return `<path d="M 0 0 L 10 5 L 0 10 Z" fill="${color}"/>`;
  }
}

function clipId(item: Extract<SceneItem, { type: 'group' }>): string {
  return `oc-clip-${sanitizeId(item.id)}`;
}

function renderClipItem(item: NonNullable<Extract<SceneItem, { type: 'group' }>['clip']>['items'][number]): string {
  switch (item.type) {
    case 'rect':
      return `<rect x="${formatNumber(item.frame.x)}" y="${formatNumber(item.frame.y)}" width="${formatNumber(item.frame.width)}" height="${formatNumber(item.frame.height)}"${item.radius === undefined ? '' : ` rx="${formatNumber(item.radius)}"`}/>`;
    case 'circle':
      return `<circle cx="${formatNumber(item.center.x)}" cy="${formatNumber(item.center.y)}" r="${formatNumber(item.radius)}"/>`;
    case 'ellipse':
      return `<ellipse cx="${formatNumber(item.center.x)}" cy="${formatNumber(item.center.y)}" rx="${formatNumber(item.radiusX)}" ry="${formatNumber(item.radiusY)}"/>`;
    case 'polygon':
      return `<polygon points="${item.points.map((point) => `${formatNumber(point.x)},${formatNumber(point.y)}`).join(' ')}"/>`;
    case 'path':
      return `<path d="${pathData(item.commands)}"/>`;
  }
}

function collectItems(items: readonly SceneItem[]): readonly SceneItem[] {
  const collected: SceneItem[] = [];
  for (const item of items) {
    collected.push(item);
    if (item.type === 'group') {
      collected.push(...collectItems(item.children));
    }
  }
  return collected;
}

function renderDefinitions(items: readonly SceneItem[]): string {
  const definitions = items.flatMap((item) => {
    if (item.type === 'dot-grid') {
      return [
        `<pattern id="${patternId(item)}" width="${formatNumber(item.step)}" height="${formatNumber(item.step)}" patternUnits="userSpaceOnUse"><circle cx="${formatNumber(item.offset.x)}" cy="${formatNumber(item.offset.y)}" r="${formatNumber(item.radius)}" fill="${escapeXml(item.fill)}" fill-opacity="${formatNumber(item.fillOpacity)}"/></pattern>`,
      ];
    }
    if (item.type === 'path' && (item.markerStart !== undefined || item.markerEnd !== undefined)) {
      const markers: string[] = [];
      if (item.markerStart !== undefined) {
        markers.push(`<marker id="${markerId(item, 'start')}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${formatNumber(item.markerStart.size)}" markerHeight="${formatNumber(item.markerStart.size)}" markerUnits="strokeWidth" orient="auto-start-reverse">${markerShape(item.markerStart)}</marker>`);
      }
      if (item.markerEnd !== undefined) {
        markers.push(`<marker id="${markerId(item, 'end')}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${formatNumber(item.markerEnd.size)}" markerHeight="${formatNumber(item.markerEnd.size)}" markerUnits="strokeWidth" orient="auto-start-reverse">${markerShape(item.markerEnd)}</marker>`);
      }
      return markers;
    }
    if (item.type === 'group' && item.clip !== undefined) {
      return [
        `<clipPath id="${clipId(item)}" clipPathUnits="userSpaceOnUse">${item.clip.items.map(renderClipItem).join('')}</clipPath>`,
      ];
    }
    return [];
  });
  return definitions.length === 0 ? '' : `<defs>${definitions.join('')}</defs>`;
}

function renderItem(item: SceneItem): string {
  switch (item.type) {
    case 'group': {
      const entityAttribute =
        item.entityId === undefined
          ? ''
          : item.role === 'node'
            ? ` data-node-id="${escapeXml(item.entityId)}"`
            : item.role === 'edge'
              ? ` data-edge-id="${escapeXml(item.entityId)}"`
              : ` data-entity-id="${escapeXml(item.entityId)}"`;
      const ariaAttribute =
        item.ariaLabel === undefined ? '' : ` aria-label="${escapeXml(item.ariaLabel)}"`;
      const compositionAttribute =
        item.composition === undefined
          ? ''
          : ` data-composition="${item.composition}"`;
      const transformAttribute =
        item.transform === undefined || item.transform.rotation === 0
          ? ''
          : ` transform="rotate(${formatNumber(item.transform.rotation)} ${formatNumber(item.transform.origin.x)} ${formatNumber(item.transform.origin.y)})"`;
      const clipAttribute =
        item.clip === undefined ? '' : ` clip-path="url(#${clipId(item)})"`;
      return `<g id="${sanitizeId(item.id)}" class="scene-group scene-${item.role}"${entityAttribute}${ariaAttribute}${compositionAttribute}${transformAttribute}${clipAttribute}${opacityAttribute(item.opacity)}>${item.children.map(renderItem).join('')}</g>`;
    }
    case 'rect':
      return `<rect id="${sanitizeId(item.id)}" x="${formatNumber(item.frame.x)}" y="${formatNumber(item.frame.y)}" width="${formatNumber(item.frame.width)}" height="${formatNumber(item.frame.height)}"${item.radius === undefined ? '' : ` rx="${formatNumber(item.radius)}"`}${paintAttributes(item)}${opacityAttribute(item.opacity)}/>`;
    case 'circle':
      return `<circle id="${sanitizeId(item.id)}" cx="${formatNumber(item.center.x)}" cy="${formatNumber(item.center.y)}" r="${formatNumber(item.radius)}"${paintAttributes(item)}${opacityAttribute(item.opacity)}/>`;
    case 'ellipse':
      return `<ellipse id="${sanitizeId(item.id)}" cx="${formatNumber(item.center.x)}" cy="${formatNumber(item.center.y)}" rx="${formatNumber(item.radiusX)}" ry="${formatNumber(item.radiusY)}"${paintAttributes(item)}${opacityAttribute(item.opacity)}/>`;
    case 'polygon':
      return `<polygon id="${sanitizeId(item.id)}" points="${item.points.map((point) => `${formatNumber(point.x)},${formatNumber(point.y)}`).join(' ')}"${paintAttributes(item)}${opacityAttribute(item.opacity)}/>`;
    case 'path': {
      const lineCap = item.lineCap === undefined ? '' : ` stroke-linecap="${item.lineCap}"`;
      const lineJoin = item.lineJoin === undefined ? '' : ` stroke-linejoin="${item.lineJoin}"`;
      const markerStart =
        item.markerStart === undefined ? '' : ` marker-start="url(#${markerId(item, 'start')})"`;
      const markerEnd =
        item.markerEnd === undefined ? '' : ` marker-end="url(#${markerId(item, 'end')})"`;
      return `<path id="${sanitizeId(item.id)}" d="${pathData(item.commands)}"${paintAttributes(item)}${lineCap}${lineJoin}${markerStart}${markerEnd}${opacityAttribute(item.opacity)}/>`;
    }
    case 'text': {
      const weight =
        item.fontWeight === undefined ? '' : ` font-weight="${formatNumber(item.fontWeight)}"`;
      const style =
        item.fontStyle === undefined ? '' : ` font-style="${item.fontStyle}"`;
      const spacing =
        item.letterSpacing === undefined
          ? ''
          : ` letter-spacing="${formatNumber(item.letterSpacing)}"`;
      const decoration = item.underline === true ? ' text-decoration="underline"' : '';
      const anchor = item.anchor === undefined ? '' : ` text-anchor="${item.anchor}"`;
      return `<text id="${sanitizeId(item.id)}" x="${formatNumber(item.at.x)}" y="${formatNumber(item.at.y)}" fill="${escapeXml(item.fill)}" font-family="${escapeXml(item.fontFamily)}" font-size="${formatNumber(item.fontSize)}"${weight}${style}${spacing}${decoration}${anchor}${opacityAttribute(item.opacity)}>${escapeXml(item.value)}</text>`;
    }
    case 'dot-grid':
      return `<rect id="${sanitizeId(item.id)}" x="${formatNumber(item.frame.x)}" y="${formatNumber(item.frame.y)}" width="${formatNumber(item.frame.width)}" height="${formatNumber(item.frame.height)}" fill="url(#${patternId(item)})"${opacityAttribute(item.opacity)}/>`;
  }
}

export function renderSceneToSvg(scene: SceneDescription): string {
  const { bounds } = scene;
  if (
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    throw new Error('Scene bounds must have finite positive width and height');
  }

  const allItems = collectItems(scene.items);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="oc-title oc-desc" viewBox="${formatNumber(bounds.x)} ${formatNumber(bounds.y)} ${formatNumber(bounds.width)} ${formatNumber(bounds.height)}" width="${formatNumber(bounds.width)}" height="${formatNumber(bounds.height)}">`,
    `<title id="oc-title">${escapeXml(scene.title)}</title>`,
    `<desc id="oc-desc">${escapeXml(scene.description)}</desc>`,
    renderDefinitions(allItems),
    scene.items.map(renderItem).join('\n'),
    '</svg>',
  ].join('\n');
}

export function renderDocumentToSvg(
  document: OpenChartDocument,
  options: SvgRenderOptions = {},
): string {
  return renderSceneToSvg(buildSceneDescription(document, options));
}
