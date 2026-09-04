import type { OpenChartDocument } from '@openchart/ir';

export * from './layout.js';
export * from './tokens.js';
export * from './rules.js';
export * from './beauty.js';

export const DEFAULT_CONTAINER_PADDING = 32;
export const CONTAINER_TITLE_HEIGHT = 36;
export const ASSISTED_LAYOUT_GAP = 16;

export interface ContainerPoint {
  readonly x: number;
  readonly y: number;
}

export interface ContainerFrame extends ContainerPoint {
  readonly width: number;
  readonly height: number;
}

export interface ContainerLayoutOptions {
  readonly previousFrames?: Readonly<Record<string, ContainerFrame>>;
  readonly firstOpen?: boolean;
  readonly fitContainerIds?: readonly string[];
}

export interface ResolvedContainer {
  readonly id: string;
  readonly title: string;
  readonly frame: ContainerFrame;
  readonly titleFrame: ContainerFrame;
  readonly contentFrame: ContainerFrame;
  readonly childIds: readonly string[];
  readonly padding: number;
  readonly magnetize: boolean;
  readonly assistedLayout: boolean;
  readonly clip: boolean;
  readonly autoGrow: boolean;
}

export interface ContainerLayoutResult {
  readonly frames: Readonly<Record<string, ContainerFrame>>;
  readonly containers: Readonly<Record<string, ResolvedContainer>>;
  readonly assistedLayoutApplied: readonly string[];
}

interface MutableFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Delta {
  readonly x: number;
  readonly y: number;
}

interface ContainerDefaults {
  readonly title: string;
  readonly padding: number;
  readonly magnetize: boolean;
  readonly assistedLayout: boolean;
  readonly clip: boolean;
  readonly autoGrow: boolean;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function copyFrame(frame: ContainerFrame): MutableFrame {
  return {
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
  };
}

function frameIsValid(value: unknown): value is ContainerFrame {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const frame = value as Partial<ContainerFrame>;
  return (
    typeof frame.x === 'number' &&
    Number.isFinite(frame.x) &&
    typeof frame.y === 'number' &&
    Number.isFinite(frame.y) &&
    typeof frame.width === 'number' &&
    Number.isFinite(frame.width) &&
    frame.width > 0 &&
    typeof frame.height === 'number' &&
    Number.isFinite(frame.height) &&
    frame.height > 0
  );
}

function validateFrames(
  document: OpenChartDocument,
  frames: Readonly<Record<string, ContainerFrame>>,
  label: string,
): Record<string, MutableFrame> {
  const result: Record<string, MutableFrame> = {};
  const nodeIds = Object.keys(document.nodes).sort(compareIds);
  for (const nodeId of nodeIds) {
    const frame = frames[nodeId];
    if (frame === undefined) {
      throw new Error(`Missing ${label} for node ${JSON.stringify(nodeId)}`);
    }
    if (!frameIsValid(frame)) {
      throw new Error(
        `${label[0]?.toUpperCase() ?? label}rame for node ${JSON.stringify(nodeId)} must have finite coordinates and positive width and height`,
      );
    }
    result[nodeId] = copyFrame(frame);
  }
  return result;
}

function validateOptionalFrames(
  frames: Readonly<Record<string, ContainerFrame>> | undefined,
): void {
  if (frames === undefined) {
    return;
  }
  for (const [nodeId, frame] of Object.entries(frames)) {
    if (!frameIsValid(frame)) {
      throw new Error(
        `Previous frame for node ${JSON.stringify(nodeId)} must have finite coordinates and positive width and height`,
      );
    }
  }
}

function containerDefaults(
  node: OpenChartDocument['nodes'][string],
): ContainerDefaults {
  const settings = node.container ?? {};
  return {
    title: settings.title ?? node.label,
    padding: settings.padding ?? DEFAULT_CONTAINER_PADDING,
    magnetize: settings.magnetize ?? true,
    assistedLayout: settings.assistedLayout ?? false,
    clip: settings.clip ?? false,
    autoGrow: settings.autoGrow ?? true,
  };
}

function translateDescendants(
  document: OpenChartDocument,
  frames: Record<string, MutableFrame>,
  ancestorId: string,
  delta: Delta,
): void {
  if (delta.x === 0 && delta.y === 0) {
    return;
  }
  for (const [nodeId, node] of Object.entries(document.nodes)) {
    let parentId = node.parentId;
    while (parentId !== undefined) {
      if (parentId === ancestorId) {
        const frame = frames[nodeId];
        if (frame !== undefined) {
          frame.x += delta.x;
          frame.y += delta.y;
        }
        break;
      }
      parentId = document.nodes[parentId]?.parentId;
    }
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (maximum < minimum) {
    return minimum;
  }
  return Math.min(Math.max(value, minimum), maximum);
}

export function reconcileContainers(
  document: OpenChartDocument,
  frames: Readonly<Record<string, ContainerFrame>>,
  options: ContainerLayoutOptions = {},
): ContainerLayoutResult {
  const resolvedFrames = validateFrames(document, frames, 'frame');
  validateOptionalFrames(options.previousFrames);

  const nodeIds = Object.keys(document.nodes).sort(compareIds);
  const containerIds = nodeIds.filter(
    (nodeId) => document.nodes[nodeId]?.container !== undefined,
  );
  const containerIdSet = new Set(containerIds);
  const childIdsByContainer = new Map<string, string[]>();
  for (const containerId of containerIds) {
    childIdsByContainer.set(containerId, []);
  }
  for (const nodeId of nodeIds) {
    const parentId = document.nodes[nodeId]?.parentId;
    if (parentId !== undefined && containerIdSet.has(parentId)) {
      childIdsByContainer.get(parentId)?.push(nodeId);
    }
  }
  for (const childIds of childIdsByContainer.values()) {
    childIds.sort(compareIds);
  }

  const defaultsByContainer = new Map<string, ContainerDefaults>();
  for (const containerId of containerIds) {
    const node = document.nodes[containerId];
    if (node !== undefined) {
      defaultsByContainer.set(containerId, containerDefaults(node));
    }
  }

  const depthByContainer = new Map<string, number>();
  const containerDepth = (containerId: string): number => {
    const cached = depthByContainer.get(containerId);
    if (cached !== undefined) {
      return cached;
    }
    let depth = 0;
    let parentId = document.nodes[containerId]?.parentId;
    const visited = new Set<string>();
    while (parentId !== undefined && containerIdSet.has(parentId)) {
      if (visited.has(parentId)) {
        break;
      }
      visited.add(parentId);
      depth += 1;
      parentId = document.nodes[parentId]?.parentId;
    }
    depthByContainer.set(containerId, depth);
    return depth;
  };

  const movementByContainer = new Map<string, Delta>();
  if (options.previousFrames !== undefined) {
    for (const containerId of containerIds) {
      const current = frames[containerId];
      const previous = options.previousFrames[containerId];
      if (current !== undefined && previous !== undefined) {
        movementByContainer.set(containerId, {
          x: current.x - previous.x,
          y: current.y - previous.y,
        });
      }
    }
  }

  for (const nodeId of nodeIds) {
    const node = document.nodes[nodeId];
    const frame = resolvedFrames[nodeId];
    if (node === undefined || frame === undefined) {
      continue;
    }
    let parentId = node.parentId;
    const visited = new Set<string>();
    while (parentId !== undefined && containerIdSet.has(parentId)) {
      if (visited.has(parentId)) {
        break;
      }
      visited.add(parentId);
      const defaults = defaultsByContainer.get(parentId);
      const delta = movementByContainer.get(parentId);
      if (defaults?.magnetize !== false && delta !== undefined) {
        frame.x += delta.x;
        frame.y += delta.y;
      }
      parentId = document.nodes[parentId]?.parentId;
    }
  }

  const assistedLayoutApplied: string[] = [];
  if (options.firstOpen === true) {
    const assistedContainers = containerIds
      .filter((containerId) => defaultsByContainer.get(containerId)?.assistedLayout)
      .sort((left, right) => {
        const depthDifference = containerDepth(left) - containerDepth(right);
        return depthDifference === 0 ? compareIds(left, right) : depthDifference;
      });
    for (const containerId of assistedContainers) {
      const childIds = childIdsByContainer.get(containerId) ?? [];
      const containerFrame = resolvedFrames[containerId];
      const defaults = defaultsByContainer.get(containerId);
      if (childIds.length === 0 || containerFrame === undefined || defaults === undefined) {
        continue;
      }
      let cellWidth = 0;
      let cellHeight = 0;
      for (const childId of childIds) {
        const childFrame = resolvedFrames[childId];
        if (childFrame !== undefined) {
          cellWidth = Math.max(cellWidth, childFrame.width);
          cellHeight = Math.max(cellHeight, childFrame.height);
        }
      }
      const columns = Math.max(1, Math.ceil(Math.sqrt(childIds.length)));
      const rows = Math.ceil(childIds.length / columns);
      const requiredWidth =
        columns * cellWidth + Math.max(0, columns - 1) * ASSISTED_LAYOUT_GAP +
        defaults.padding * 2;
      const requiredHeight =
        rows * cellHeight + Math.max(0, rows - 1) * ASSISTED_LAYOUT_GAP +
        CONTAINER_TITLE_HEIGHT +
        defaults.padding * 2;
      containerFrame.width = Math.max(containerFrame.width, requiredWidth);
      containerFrame.height = Math.max(containerFrame.height, requiredHeight);
      const originX = containerFrame.x + defaults.padding;
      const originY = containerFrame.y + CONTAINER_TITLE_HEIGHT + defaults.padding;
      for (const [index, childId] of childIds.entries()) {
        const childFrame = resolvedFrames[childId];
        if (childFrame === undefined) {
          continue;
        }
        const column = index % columns;
        const row = Math.floor(index / columns);
        const nextX = originX + column * (cellWidth + ASSISTED_LAYOUT_GAP);
        const nextY = originY + row * (cellHeight + ASSISTED_LAYOUT_GAP);
        const delta = { x: nextX - childFrame.x, y: nextY - childFrame.y };
        childFrame.x = nextX;
        childFrame.y = nextY;
        const childDefaults = defaultsByContainer.get(childId);
        if (childDefaults?.magnetize !== false) {
          translateDescendants(document, resolvedFrames, childId, delta);
        }
      }
      assistedLayoutApplied.push(containerId);
    }
  }

  const fitContainerIds = new Set(options.fitContainerIds ?? []);
  const resizeOrder = [...containerIds].sort((left, right) => {
    const depthDifference = containerDepth(right) - containerDepth(left);
    return depthDifference === 0 ? compareIds(left, right) : depthDifference;
  });
  for (const containerId of resizeOrder) {
    const containerFrame = resolvedFrames[containerId];
    const defaults = defaultsByContainer.get(containerId);
    const childIds = childIdsByContainer.get(containerId) ?? [];
    if (containerFrame === undefined || defaults === undefined) {
      continue;
    }

    if (fitContainerIds.has(containerId) && childIds.length > 0) {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const childId of childIds) {
        const childFrame = resolvedFrames[childId];
        if (childFrame === undefined) {
          continue;
        }
        minX = Math.min(minX, childFrame.x);
        minY = Math.min(minY, childFrame.y);
        maxX = Math.max(maxX, childFrame.x + childFrame.width);
        maxY = Math.max(maxY, childFrame.y + childFrame.height);
      }
      if (Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)) {
        containerFrame.x = minX - defaults.padding;
        containerFrame.y = minY - CONTAINER_TITLE_HEIGHT - defaults.padding;
        containerFrame.width = maxX - minX + defaults.padding * 2;
        containerFrame.height =
          maxY - minY + CONTAINER_TITLE_HEIGHT + defaults.padding * 2;
      }
      continue;
    }

    if (defaults.autoGrow && childIds.length > 0) {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const childId of childIds) {
        const childFrame = resolvedFrames[childId];
        if (childFrame === undefined) {
          continue;
        }
        minX = Math.min(minX, childFrame.x);
        minY = Math.min(minY, childFrame.y);
        maxX = Math.max(maxX, childFrame.x + childFrame.width);
        maxY = Math.max(maxY, childFrame.y + childFrame.height);
      }
      if (Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)) {
        const nextX =
          minX < containerFrame.x
            ? Math.min(containerFrame.x, minX - defaults.padding)
            : containerFrame.x;
        const nextY =
          minY < containerFrame.y
            ? Math.min(
                containerFrame.y,
                minY - CONTAINER_TITLE_HEIGHT - defaults.padding,
              )
            : containerFrame.y;
        const nextRight = Math.max(
          containerFrame.x + containerFrame.width,
          maxX > containerFrame.x + containerFrame.width
            ? maxX + defaults.padding
            : containerFrame.x + containerFrame.width,
        );
        const nextBottom = Math.max(
          containerFrame.y + containerFrame.height,
          maxY > containerFrame.y + containerFrame.height
            ? maxY + defaults.padding
            : containerFrame.y + containerFrame.height,
        );
        containerFrame.x = nextX;
        containerFrame.y = nextY;
        containerFrame.width = nextRight - nextX;
        containerFrame.height = nextBottom - nextY;
      }
      continue;
    }

    if (!defaults.autoGrow) {
      for (const childId of childIds) {
        const childFrame = resolvedFrames[childId];
        if (childFrame === undefined) {
          continue;
        }
        const nextX = clamp(
          childFrame.x,
          containerFrame.x + defaults.padding,
          containerFrame.x + containerFrame.width - defaults.padding - childFrame.width,
        );
        const nextY = clamp(
          childFrame.y,
          containerFrame.y + CONTAINER_TITLE_HEIGHT + defaults.padding,
          containerFrame.y +
            containerFrame.height - defaults.padding - childFrame.height,
        );
        const delta = { x: nextX - childFrame.x, y: nextY - childFrame.y };
        childFrame.x = nextX;
        childFrame.y = nextY;
        const childDefaults = defaultsByContainer.get(childId);
        if (childDefaults?.magnetize !== false) {
          translateDescendants(document, resolvedFrames, childId, delta);
        }
      }
    }
  }

  const resultFrames: Record<string, ContainerFrame> = {};
  for (const nodeId of nodeIds) {
    const frame = resolvedFrames[nodeId];
    if (frame !== undefined) {
      resultFrames[nodeId] = { ...frame };
    }
  }

  const containers: Record<string, ResolvedContainer> = {};
  for (const containerId of containerIds) {
    const frame = resultFrames[containerId];
    const defaults = defaultsByContainer.get(containerId);
    if (frame === undefined || defaults === undefined) {
      continue;
    }
    const titleFrame: ContainerFrame = {
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: CONTAINER_TITLE_HEIGHT,
    };
    const contentFrame: ContainerFrame = {
      x: frame.x + defaults.padding,
      y: frame.y + CONTAINER_TITLE_HEIGHT + defaults.padding,
      width: Math.max(0, frame.width - defaults.padding * 2),
      height: Math.max(
        0,
        frame.height - CONTAINER_TITLE_HEIGHT - defaults.padding * 2,
      ),
    };
    containers[containerId] = {
      id: containerId,
      title: defaults.title,
      frame,
      titleFrame,
      contentFrame,
      childIds: [...(childIdsByContainer.get(containerId) ?? [])],
      padding: defaults.padding,
      magnetize: defaults.magnetize,
      assistedLayout: defaults.assistedLayout,
      clip: defaults.clip,
      autoGrow: defaults.autoGrow,
    };
  }

  assistedLayoutApplied.sort(compareIds);
  return {
    frames: resultFrames,
    containers,
    assistedLayoutApplied,
  };
}

export function findInnermostContainer(
  document: OpenChartDocument,
  frames: Readonly<Record<string, ContainerFrame>>,
  point: ContainerPoint,
  excludedNodeId?: string,
): string | undefined {
  validateFrames(document, frames, 'frame');
  if (
    typeof point.x !== 'number' ||
    !Number.isFinite(point.x) ||
    typeof point.y !== 'number' ||
    !Number.isFinite(point.y)
  ) {
    throw new Error('Container point must have finite coordinates');
  }

  const nodeIds = Object.keys(document.nodes).sort(compareIds);
  const containerIds = nodeIds.filter(
    (nodeId) => document.nodes[nodeId]?.container !== undefined,
  );
  const containerIdSet = new Set(containerIds);
  const depth = (containerId: string): number => {
    let result = 0;
    let parentId = document.nodes[containerId]?.parentId;
    const visited = new Set<string>();
    while (parentId !== undefined && containerIdSet.has(parentId)) {
      if (visited.has(parentId)) {
        break;
      }
      visited.add(parentId);
      result += 1;
      parentId = document.nodes[parentId]?.parentId;
    }
    return result;
  };
  const isExcluded = (containerId: string): boolean => {
    if (excludedNodeId === undefined || containerId === excludedNodeId) {
      return excludedNodeId === containerId;
    }
    let parentId = document.nodes[containerId]?.parentId;
    const visited = new Set<string>();
    while (parentId !== undefined) {
      if (parentId === excludedNodeId) {
        return true;
      }
      if (visited.has(parentId)) {
        break;
      }
      visited.add(parentId);
      parentId = document.nodes[parentId]?.parentId;
    }
    return false;
  };

  const candidates: Array<{
    readonly id: string;
    readonly depth: number;
    readonly area: number;
  }> = [];
  for (const containerId of containerIds) {
    if (isExcluded(containerId)) {
      continue;
    }
    const frame = frames[containerId];
    if (
      frame !== undefined &&
      point.x >= frame.x &&
      point.x <= frame.x + frame.width &&
      point.y >= frame.y &&
      point.y <= frame.y + frame.height
    ) {
      candidates.push({
        id: containerId,
        depth: depth(containerId),
        area: frame.width * frame.height,
      });
    }
  }
  candidates.sort((left, right) => {
    if (left.depth !== right.depth) {
      return right.depth - left.depth;
    }
    if (left.area !== right.area) {
      return left.area - right.area;
    }
    return compareIds(left.id, right.id);
  });
  return candidates[0]?.id;
}
