/**
 * Small, dependency-free connector geometry kernel.
 *
 * The routing code deliberately works on plain points and rectangles so it
 * can be used by both the canvas renderer and worker-side layout code.  All
 * public helpers are total over malformed runtime input: geometry predicates
 * return false, curve/path samplers return undefined/empty arrays, and the
 * route entry point returns a diagnostic.
 */

export type ConnectorSide = 'north' | 'south' | 'east' | 'west';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly id?: string;
}

export interface ConnectorAnchor extends Point {
  readonly side?: ConnectorSide;
}

export interface RouteConnectorOptions {
  readonly from: ConnectorAnchor;
  readonly to: ConnectorAnchor;
  readonly mode?: 'orthogonal' | 'straight' | 'curved';
  readonly strategy?: 'fast' | 'obstacle';
  readonly obstacles?: readonly Rect[];
  readonly clearance?: number;
  readonly jetty?: number;
}

export interface RouteDiagnostic {
  readonly code: 'UNROUTABLE' | 'INVALID_INPUT';
  readonly message: string;
}

export interface RouteSuccess {
  readonly ok: true;
  readonly mode: 'orthogonal' | 'straight' | 'curved';
  readonly strategy: 'fast' | 'obstacle';
  readonly points: readonly Point[];
}

export interface RouteFailure {
  readonly ok: false;
  readonly diagnostic: RouteDiagnostic;
}

export type RouteResult = RouteSuccess | RouteFailure;

export interface PointAtDistance extends Point {
  /** The requested normalized position, clamped to [0, 1]. */
  readonly t: number;
}

export interface CubicBezierSegment {
  readonly start: Point;
  readonly control1: Point;
  readonly control2: Point;
  readonly end: Point;
}

export type CubicSegment = CubicBezierSegment;

export interface OrthogonalEdge {
  readonly id: string;
  readonly uid?: string;
  readonly zIndex?: number;
  readonly points: readonly Point[];
}

export interface OrthogonalCrossing {
  readonly overEdgeId: string;
  readonly underEdgeId: string;
  readonly point: Point;
}

interface NormalizedRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly id?: string;
}

interface NormalizedAnchor {
  readonly point: Point;
  readonly side: ConnectorSide;
}

interface RoutePoint {
  readonly point: Point;
  readonly preserve: boolean;
}

interface GridNode {
  readonly x: number;
  readonly y: number;
  readonly special: boolean;
}

const DEFAULT_JETTY = 12;
const DEFAULT_CLEARANCE = 0;
const BEND_PENALTY = 24;
const EPSILON = 1e-9;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(value: unknown): value is Point {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

function isSide(value: unknown): value is ConnectorSide {
  return value === 'north' || value === 'south' || value === 'east' || value === 'west';
}

function isAnchor(value: unknown): value is ConnectorAnchor {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
    return false;
  }
  return value.side === undefined || isSide(value.side);
}

function normalizeRect(rect: unknown): NormalizedRect | undefined {
  if (!isRecord(rect)) {
    return undefined;
  }
  const { x, y, width, height, id } = rect;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) {
    return undefined;
  }
  const rightValue = x + width;
  const bottomValue = y + height;
  if (!Number.isFinite(rightValue) || !Number.isFinite(bottomValue)) {
    return undefined;
  }
  return {
    left: Math.min(x, rightValue),
    top: Math.min(y, bottomValue),
    right: Math.max(x, rightValue),
    bottom: Math.max(y, bottomValue),
    ...(typeof id === 'string' ? { id } : {}),
  };
}

function rectAsPublic(rect: NormalizedRect): Rect {
  return {
    x: rect.left,
    y: rect.top,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
    ...(rect.id === undefined ? {} : { id: rect.id }),
  };
}

function pointInsideRectInterior(point: Point, rect: NormalizedRect): boolean {
  return rect.right > rect.left &&
    rect.bottom > rect.top &&
    point.x > rect.left &&
    point.x < rect.right &&
    point.y > rect.top &&
    point.y < rect.bottom;
}

/**
 * Return true when any non-zero portion of a segment lies in a rectangle's
 * open interior.  Touching an edge or a corner is intentionally safe.
 */
export function segmentIntersectsRectInterior(
  from: Point,
  to: Point,
  rect: Rect,
): boolean {
  if (!isPoint(from) || !isPoint(to)) {
    return false;
  }
  const normalized = normalizeRect(rect);
  if (normalized === undefined || normalized.right <= normalized.left || normalized.bottom <= normalized.top) {
    return false;
  }
  if (from.x === to.x && from.y === to.y) {
    return pointInsideRectInterior(from, normalized);
  }

  let lower = 0;
  let upper = 1;
  const axes: readonly [number, number, number, number][] = [
    [from.x, to.x, normalized.left, normalized.right],
    [from.y, to.y, normalized.top, normalized.bottom],
  ];
  for (const [start, end, minimum, maximum] of axes) {
    const delta = end - start;
    if (delta === 0) {
      if (start <= minimum || start >= maximum) {
        return false;
      }
      continue;
    }
    let axisLower = (minimum - start) / delta;
    let axisUpper = (maximum - start) / delta;
    if (axisLower > axisUpper) {
      [axisLower, axisUpper] = [axisUpper, axisLower];
    }
    lower = Math.max(lower, axisLower);
    upper = Math.min(upper, axisUpper);
    if (!(upper > lower)) {
      return false;
    }
  }
  return upper > lower;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function distanceSquared(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function simplifyPoints(points: readonly Point[], preserveJets = false): readonly Point[] {
  const result: RoutePoint[] = [];
  points.forEach((point, index) => {
    if (!isPoint(point)) {
      return;
    }
    const preserve = preserveJets && (index === 1 || index === points.length - 2);
    const previous = result.at(-1);
    if (previous !== undefined && previous.point.x === point.x && previous.point.y === point.y) {
      return;
    }
    result.push({ point: { x: point.x, y: point.y }, preserve });
    while (result.length >= 3) {
      const first = result.at(-3);
      const middle = result.at(-2);
      const last = result.at(-1);
      if (first === undefined || middle === undefined || last === undefined || middle.preserve) {
        break;
      }
      const firstToMiddleX = middle.point.x - first.point.x;
      const firstToMiddleY = middle.point.y - first.point.y;
      const middleToLastX = last.point.x - middle.point.x;
      const middleToLastY = last.point.y - middle.point.y;
      if (firstToMiddleX * middleToLastY !== firstToMiddleY * middleToLastX ||
        (firstToMiddleX === 0 && middleToLastX !== 0) ||
        (firstToMiddleY === 0 && middleToLastY !== 0)) {
        break;
      }
      result.splice(result.length - 2, 1);
    }
  });
  return result.map(({ point }) => point);
}

function sideAxis(side: ConnectorSide): 'horizontal' | 'vertical' {
  return side === 'east' || side === 'west' ? 'horizontal' : 'vertical';
}

function sideSign(side: ConnectorSide): 1 | -1 {
  return side === 'east' || side === 'south' ? 1 : -1;
}

function deriveSide(anchor: Point, target: Point, fallback: ConnectorSide): ConnectorSide {
  const dx = target.x - anchor.x;
  const dy = target.y - anchor.y;
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) {
    return dx > 0 ? 'east' : 'west';
  }
  if (dy !== 0) {
    return dy > 0 ? 'south' : 'north';
  }
  return fallback;
}

function anchorWithSide(anchor: ConnectorAnchor, target: Point, fallback: ConnectorSide): NormalizedAnchor {
  return {
    point: { x: anchor.x, y: anchor.y },
    side: anchor.side ?? deriveSide(anchor, target, fallback),
  };
}

function jettyPoint(anchor: NormalizedAnchor, jetty: number): Point {
  switch (anchor.side) {
    case 'east':
      return { x: anchor.point.x + jetty, y: anchor.point.y };
    case 'west':
      return { x: anchor.point.x - jetty, y: anchor.point.y };
    case 'south':
      return { x: anchor.point.x, y: anchor.point.y + jetty };
    case 'north':
      return { x: anchor.point.x, y: anchor.point.y - jetty };
  }
}

function signOf(value: number): -1 | 0 | 1 {
  return value === 0 ? 0 : value > 0 ? 1 : -1;
}

function chooseHorizontalCorridor(start: Point, end: Point, startSide: ConnectorSide, endSide: ConnectorSide, jetty: number): number {
  const startDirection = sideSign(startSide);
  const endDirection = sideSign(endSide);
  const delta = end.x - start.x;
  if (startDirection > 0 && endDirection < 0) {
    return delta > 0 ? (start.x + end.x) / 2 : Math.max(start.x, end.x) + Math.max(jetty, 1);
  }
  if (startDirection < 0 && endDirection > 0) {
    return delta < 0 ? (start.x + end.x) / 2 : Math.min(start.x, end.x) - Math.max(jetty, 1);
  }
  return startDirection > 0
    ? Math.max(start.x, end.x) + Math.max(jetty, 1)
    : Math.min(start.x, end.x) - Math.max(jetty, 1);
}

function chooseVerticalCorridor(start: Point, end: Point, startSide: ConnectorSide, endSide: ConnectorSide, jetty: number): number {
  const startDirection = sideSign(startSide);
  const endDirection = sideSign(endSide);
  const delta = end.y - start.y;
  if (startDirection > 0 && endDirection < 0) {
    return delta > 0 ? (start.y + end.y) / 2 : Math.max(start.y, end.y) + Math.max(jetty, 1);
  }
  if (startDirection < 0 && endDirection > 0) {
    return delta < 0 ? (start.y + end.y) / 2 : Math.min(start.y, end.y) - Math.max(jetty, 1);
  }
  return startDirection > 0
    ? Math.max(start.y, end.y) + Math.max(jetty, 1)
    : Math.min(start.y, end.y) - Math.max(jetty, 1);
}

function buildOrthogonalCore(
  start: Point,
  end: Point,
  startSide: ConnectorSide,
  endSide: ConnectorSide,
  jetty: number,
): readonly Point[] {
  if (start.x === end.x && start.y === end.y) {
    return [start];
  }
  const startAxis = sideAxis(startSide);
  const endAxis = sideAxis(endSide);

  if (startAxis === endAxis && startAxis === 'horizontal') {
    if (start.y === end.y &&
      ((sideSign(startSide) > 0 && sideSign(endSide) < 0 && end.x >= start.x) ||
        (sideSign(startSide) < 0 && sideSign(endSide) > 0 && end.x <= start.x))) {
      return [start, end];
    }
    const corridorX = chooseHorizontalCorridor(start, end, startSide, endSide, jetty);
    if (start.y === end.y) {
      const detourY = start.y + Math.max(jetty, 1);
      return [
        start,
        { x: corridorX, y: start.y },
        { x: corridorX, y: detourY },
        { x: end.x, y: detourY },
        end,
      ];
    }
    return [
      start,
      { x: corridorX, y: start.y },
      { x: corridorX, y: end.y },
      end,
    ];
  }

  if (startAxis === endAxis && startAxis === 'vertical') {
    if (start.x === end.x &&
      ((sideSign(startSide) > 0 && sideSign(endSide) < 0 && end.y >= start.y) ||
        (sideSign(startSide) < 0 && sideSign(endSide) > 0 && end.y <= start.y))) {
      return [start, end];
    }
    const corridorY = chooseVerticalCorridor(start, end, startSide, endSide, jetty);
    if (start.x === end.x) {
      const detourX = start.x + Math.max(jetty, 1);
      return [
        start,
        { x: start.x, y: corridorY },
        { x: detourX, y: corridorY },
        { x: detourX, y: end.y },
        end,
      ];
    }
    return [
      start,
      { x: start.x, y: corridorY },
      { x: end.x, y: corridorY },
      end,
    ];
  }

  if (startAxis === 'horizontal') {
    const horizontalDirection = signOf(end.x - start.x);
    const verticalDirection = signOf(end.y - start.y);
    const horizontalExpected = sideSign(startSide);
    const verticalExpected = -sideSign(endSide);
    if ((horizontalDirection === 0 || horizontalDirection === horizontalExpected) &&
      (verticalDirection === 0 || verticalDirection === verticalExpected)) {
      return [start, { x: end.x, y: start.y }, end];
    }
    const corridorX = start.x + horizontalExpected * Math.max(Math.abs(end.x - start.x), jetty, 1);
    const corridorY = end.y + sideSign(endSide) * Math.max(jetty, 1);
    return [
      start,
      { x: corridorX, y: start.y },
      { x: corridorX, y: corridorY },
      { x: end.x, y: corridorY },
      end,
    ];
  }

  const verticalDirection = signOf(end.y - start.y);
  const horizontalDirection = signOf(end.x - start.x);
  const verticalExpected = sideSign(startSide);
  const horizontalExpected = -sideSign(endSide);
  if ((verticalDirection === 0 || verticalDirection === verticalExpected) &&
    (horizontalDirection === 0 || horizontalDirection === horizontalExpected)) {
    return [start, { x: start.x, y: end.y }, end];
  }
  const corridorY = start.y + verticalExpected * Math.max(Math.abs(end.y - start.y), jetty, 1);
  const corridorX = end.x + sideSign(endSide) * Math.max(jetty, 1);
  return [
    start,
    { x: start.x, y: corridorY },
    { x: corridorX, y: corridorY },
    { x: corridorX, y: end.y },
    end,
  ];
}

function combineRoutePoints(
  from: NormalizedAnchor,
  startJetty: Point,
  core: readonly Point[],
  endJetty: Point,
  to: NormalizedAnchor,
): readonly Point[] {
  const coreStart = core[0];
  const coreEnd = core.at(-1);
  const coreInterior = core.length > 1 &&
    coreStart !== undefined && coreEnd !== undefined &&
    coreStart.x === startJetty.x && coreStart.y === startJetty.y &&
    coreEnd.x === endJetty.x && coreEnd.y === endJetty.y
    ? core.slice(1, -1)
    : core;
  return simplifyPoints([
    from.point,
    startJetty,
    ...coreInterior,
    endJetty,
    to.point,
  ], true);
}

function inflatedRectangles(rects: readonly NormalizedRect[], clearance: number): readonly NormalizedRect[] {
  return rects.map((rect) => ({
    left: rect.left - clearance,
    top: rect.top - clearance,
    right: rect.right + clearance,
    bottom: rect.bottom + clearance,
    ...(rect.id === undefined ? {} : { id: rect.id }),
  }));
}

function pathIntersectsRectangles(points: readonly Point[], rects: readonly NormalizedRect[]): boolean {
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    for (const rect of rects) {
      if (segmentIntersectsRectInterior(previous, current, rectAsPublic(rect))) {
        return true;
      }
    }
  }
  return false;
}

function uniqueSorted(values: readonly number[]): number[] {
  const finiteValues = values.filter(Number.isFinite);
  return [...new Set(finiteValues)].sort((left, right) => left - right);
}

function gridNodeId(xIndex: number, yIndex: number, width: number): number {
  return yIndex * width + xIndex;
}

function findGridRoute(
  start: Point,
  end: Point,
  obstacles: readonly NormalizedRect[],
  clearance: number,
): readonly Point[] | undefined {
  if (start.x === end.x && start.y === end.y) {
    return [start];
  }
  const inflated = inflatedRectangles(obstacles, clearance);
  const xCoordinates = uniqueSorted([
    start.x,
    end.x,
    ...inflated.flatMap((rect) => [rect.left, rect.right]),
  ]);
  const yCoordinates = uniqueSorted([
    start.y,
    end.y,
    ...inflated.flatMap((rect) => [rect.top, rect.bottom]),
  ]);
  if (xCoordinates.length === 0 || yCoordinates.length === 0) {
    return undefined;
  }

  const width = xCoordinates.length;
  const height = yCoordinates.length;
  const startX = xCoordinates.indexOf(start.x);
  const startY = yCoordinates.indexOf(start.y);
  const endX = xCoordinates.indexOf(end.x);
  const endY = yCoordinates.indexOf(end.y);
  if (startX < 0 || startY < 0 || endX < 0 || endY < 0) {
    return undefined;
  }

  const nodes: GridNode[] = [];
  const allowed = new Uint8Array(width * height);
  for (let yIndex = 0; yIndex < height; yIndex += 1) {
    const y = yCoordinates[yIndex];
    if (y === undefined) {
      continue;
    }
    for (let xIndex = 0; xIndex < width; xIndex += 1) {
      const x = xCoordinates[xIndex];
      if (x === undefined) {
        continue;
      }
      const special = (xIndex === startX && yIndex === startY) || (xIndex === endX && yIndex === endY);
      const nodeId = gridNodeId(xIndex, yIndex, width);
      const blocked = !special && inflated.some((rect) => pointInsideRectInterior({ x, y }, rect));
      nodes[nodeId] = { x, y, special };
      allowed[nodeId] = blocked ? 0 : 1;
    }
  }
  const startNode = gridNodeId(startX, startY, width);
  const endNode = gridNodeId(endX, endY, width);
  if (allowed[startNode] !== 1 || allowed[endNode] !== 1) {
    return undefined;
  }

  // Five direction states (none, left, right, up, down) let the search prefer
  // shorter, less bendy routes while retaining deterministic tie-breaking.
  const stateCount = nodes.length * 5;
  const distances = new Float64Array(stateCount);
  distances.fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(stateCount);
  previous.fill(-1);
  const used = new Uint8Array(stateCount);
  const initialState = startNode * 5;
  distances[initialState] = 0;

  const directions: readonly { readonly dx: number; readonly dy: number; readonly state: number }[] = [
    { dx: 0, dy: -1, state: 3 },
    { dx: 1, dy: 0, state: 2 },
    { dx: 0, dy: 1, state: 4 },
    { dx: -1, dy: 0, state: 1 },
  ];

  for (let iteration = 0; iteration < stateCount; iteration += 1) {
    let currentState = -1;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (let state = 0; state < stateCount; state += 1) {
      const distanceAtState = distances[state] ?? Number.POSITIVE_INFINITY;
      if (!used[state] && (distanceAtState < currentDistance - EPSILON ||
        (Math.abs(distanceAtState - currentDistance) <= EPSILON && state < currentState))) {
        currentState = state;
        currentDistance = distanceAtState;
      }
    }
    if (currentState < 0 || !Number.isFinite(currentDistance)) {
      break;
    }
    used[currentState] = 1;
    const currentNode = Math.floor(currentState / 5);
    const previousDirection = currentState % 5;
    const current = nodes[currentNode];
    if (current === undefined) {
      continue;
    }
    const currentX = xCoordinates.indexOf(current.x);
    const currentY = yCoordinates.indexOf(current.y);
    for (const direction of directions) {
      const nextX = currentX + direction.dx;
      const nextY = currentY + direction.dy;
      if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
        continue;
      }
      const nextNodeId = gridNodeId(nextX, nextY, width);
      if (allowed[nextNodeId] !== 1) {
        continue;
      }
      const next = nodes[nextNodeId];
      if (next === undefined) {
        continue;
      }
      const currentPoint = { x: current.x, y: current.y };
      const nextPoint = { x: next.x, y: next.y };
      if (pathIntersectsRectangles([currentPoint, nextPoint], inflated)) {
        continue;
      }
      const edgeLength = Math.abs(next.x - current.x) + Math.abs(next.y - current.y);
      if (!(edgeLength > 0) || !Number.isFinite(edgeLength)) {
        continue;
      }
      const bend = previousDirection !== 0 && previousDirection !== direction.state ? BEND_PENALTY : 0;
      const candidateDistance = currentDistance + edgeLength + bend;
      const nextState = nextNodeId * 5 + direction.state;
      const oldDistance = distances[nextState] ?? Number.POSITIVE_INFINITY;
      const oldPrevious = previous[nextState] ?? -1;
      const currentCandidate = currentState;
      if (candidateDistance < oldDistance - EPSILON ||
        (Math.abs(candidateDistance - oldDistance) <= EPSILON && currentCandidate < oldPrevious)) {
        distances[nextState] = candidateDistance;
        previous[nextState] = currentState;
      }
    }
  }

  let finalState = -1;
  let finalDistance = Number.POSITIVE_INFINITY;
  for (let direction = 0; direction < 5; direction += 1) {
    const state = endNode * 5 + direction;
    const candidate = distances[state] ?? Number.POSITIVE_INFINITY;
    if (candidate < finalDistance - EPSILON ||
      (Math.abs(candidate - finalDistance) <= EPSILON && state < finalState)) {
      finalState = state;
      finalDistance = candidate;
    }
  }
  if (finalState < 0 || !Number.isFinite(finalDistance)) {
    return undefined;
  }

  const route: Point[] = [];
  const visitedStates = new Set<number>();
  let state = finalState;
  while (state >= 0 && !visitedStates.has(state)) {
    visitedStates.add(state);
    const nodeId = Math.floor(state / 5);
    const node = nodes[nodeId];
    if (node === undefined) {
      return undefined;
    }
    route.push({ x: node.x, y: node.y });
    state = previous[state] ?? -1;
  }
  if (state >= 0) {
    return undefined;
  }
  route.reverse();
  return simplifyPoints(route);
}

function invalidRoute(message: string): RouteFailure {
  return {
    ok: false,
    diagnostic: { code: 'INVALID_INPUT', message },
  };
}

function unroutableRoute(message: string): RouteFailure {
  return {
    ok: false,
    diagnostic: { code: 'UNROUTABLE', message },
  };
}

/** Route a connector with a fast orthogonal path or an obstacle-aware grid path. */
export function routeConnector(options: RouteConnectorOptions): RouteResult {
  if (!isRecord(options) || !isAnchor(options.from) || !isAnchor(options.to)) {
    return invalidRoute('Connector endpoints must contain finite coordinates');
  }
  const mode = options.mode ?? 'orthogonal';
  const strategy = options.strategy ?? 'fast';
  if (mode !== 'orthogonal' && mode !== 'straight' && mode !== 'curved') {
    return invalidRoute(`Unsupported connector mode "${String(mode)}"`);
  }
  if (strategy !== 'fast' && strategy !== 'obstacle') {
    return invalidRoute(`Unsupported connector strategy "${String(strategy)}"`);
  }
  const jetty = options.jetty ?? DEFAULT_JETTY;
  const clearance = options.clearance ?? DEFAULT_CLEARANCE;
  if (!isFiniteNumber(jetty) || jetty < 0) {
    return invalidRoute('Connector jetty must be a finite non-negative number');
  }
  if (!isFiniteNumber(clearance) || clearance < 0) {
    return invalidRoute('Connector clearance must be a finite non-negative number');
  }
  if (options.obstacles !== undefined && !Array.isArray(options.obstacles)) {
    return invalidRoute('Connector obstacles must be an array');
  }

  const rawObstacles = options.obstacles ?? [];
  const obstacles: NormalizedRect[] = [];
  for (const obstacle of rawObstacles) {
    const normalized = normalizeRect(obstacle);
    if (normalized === undefined) {
      return invalidRoute('Connector obstacles must contain finite coordinates and dimensions');
    }
    obstacles.push(normalized);
  }

  const from = anchorWithSide(options.from, options.to, 'east');
  const to = anchorWithSide(options.to, options.from, 'west');
  const startJetty = jettyPoint(from, jetty);
  const endJetty = jettyPoint(to, jetty);
  const core = buildOrthogonalCore(startJetty, endJetty, from.side, to.side, jetty);

  if (mode === 'straight') {
    const points = simplifyPoints([from.point, to.point]);
    return { ok: true, mode, strategy, points };
  }

  const fastPoints = combineRoutePoints(from, startJetty, core, endJetty, to);
  if (strategy === 'fast' || obstacles.length === 0) {
    return { ok: true, mode, strategy, points: fastPoints };
  }

  for (const obstacle of obstacles) {
    if (pointInsideRectInterior(from.point, obstacle) || pointInsideRectInterior(to.point, obstacle)) {
      const obstacleName = obstacle.id ?? 'unknown';
      return unroutableRoute(`Connector endpoint intersects obstacle "${obstacleName}"`);
    }
  }

  const inflated = inflatedRectangles(obstacles, clearance);
  if (!pathIntersectsRectangles(fastPoints, inflated)) {
    if (!pathIntersectsRectangles(fastPoints, obstacles)) {
      return { ok: true, mode, strategy, points: fastPoints };
    }
  }

  const gridCore = findGridRoute(startJetty, endJetty, obstacles, clearance);
  if (gridCore === undefined) {
    return unroutableRoute('No obstacle-safe route found');
  }
  const routedPoints = combineRoutePoints(from, startJetty, gridCore, endJetty, to);
  if (pathIntersectsRectangles(routedPoints, obstacles)) {
    return unroutableRoute('No obstacle-safe route found');
  }
  return { ok: true, mode, strategy, points: routedPoints };
}

/** Sample a polyline at normalized arclength. */
export function pointAtNormalizedDistance(
  points: readonly Point[],
  normalizedT: number,
): PointAtDistance | undefined {
  if (!isArray(points) || !isFiniteNumber(normalizedT) || points.length === 0 || points.some((point) => !isPoint(point))) {
    return undefined;
  }
  const t = clamp(normalizedT, 0, 1);
  const totalLength = points.reduce((total, point, index) => {
    const previous = points[index - 1];
    return previous === undefined ? total : total + distance(previous, point);
  }, 0);
  const first = points[0];
  if (first === undefined) {
    return undefined;
  }
  if (!(totalLength > 0) || !Number.isFinite(totalLength)) {
    return { x: first.x, y: first.y, t };
  }
  const targetDistance = totalLength * t;
  let traversed = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    const segmentLength = distance(previous, current);
    if (!(segmentLength > 0)) {
      continue;
    }
    if (targetDistance <= traversed + segmentLength || index === points.length - 1) {
      const localT = clamp((targetDistance - traversed) / segmentLength, 0, 1);
      return {
        x: previous.x + (current.x - previous.x) * localT,
        y: previous.y + (current.y - previous.y) * localT,
        t,
      };
    }
    traversed += segmentLength;
  }
  const last = points.at(-1);
  return last === undefined ? undefined : { x: last.x, y: last.y, t };
}

/** Return true when a point is within tolerance of a connector polyline. */
export function hitTestConnector(
  points: readonly Point[],
  point: Point,
  tolerance = 4,
): boolean {
  if (!isArray(points) || !isPoint(point) || !isFiniteNumber(tolerance) || tolerance < 0 || points.some((candidate) => !isPoint(candidate))) {
    return false;
  }
  if (points.length === 0) {
    return false;
  }
  const threshold = tolerance * tolerance;
  if (points.length === 1) {
    const first = points[0];
    return first !== undefined && distanceSquared(first, point) <= threshold;
  }
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (start === undefined || end === undefined) {
      continue;
    }
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const segmentT = lengthSquared > 0
      ? clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1)
      : 0;
    const closest = { x: start.x + dx * segmentT, y: start.y + dy * segmentT };
    if (distanceSquared(closest, point) <= threshold) {
      return true;
    }
  }
  return false;
}

/** Convert Catmull-Rom waypoints to centripetal cubic Bézier segments. */
export function catmullRomToCubicSegments(
  points: readonly Point[],
  alpha = 0.5,
): readonly CubicBezierSegment[] {
  if (!isArray(points) || points.length < 2 || !isFiniteNumber(alpha) || alpha < 0 || points.some((point) => !isPoint(point))) {
    return [];
  }
  const result: CubicBezierSegment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const p1 = points[index];
    const p2 = points[index + 1];
    if (p1 === undefined || p2 === undefined) {
      continue;
    }
    const p0 = points[index - 1] ?? p1;
    const p3 = points[index + 2] ?? p2;
    const d01 = Math.pow(distance(p0, p1), alpha);
    const d12 = Math.pow(distance(p1, p2), alpha);
    const d23 = Math.pow(distance(p2, p3), alpha);
    const t0 = 0;
    const t1 = Number.isFinite(d01) ? d01 : 0;
    const t2 = t1 + (Number.isFinite(d12) ? d12 : 0);
    const t3 = t2 + (Number.isFinite(d23) ? d23 : 0);
    let control1: Point;
    let control2: Point;
    if (!(t2 > t1) || !(t2 > t0) || !(t3 > t1)) {
      control1 = { x: p1.x, y: p1.y };
      control2 = { x: p2.x, y: p2.y };
    } else {
      const firstScale = (t2 - t1) / (3 * (t2 - t0));
      const secondScale = (t2 - t1) / (3 * (t3 - t1));
      control1 = {
        x: p1.x + (p2.x - p0.x) * firstScale,
        y: p1.y + (p2.y - p0.y) * firstScale,
      };
      control2 = {
        x: p2.x - (p3.x - p1.x) * secondScale,
        y: p2.y - (p3.y - p1.y) * secondScale,
      };
      if (!isPoint(control1) || !isPoint(control2)) {
        control1 = { x: p1.x, y: p1.y };
        control2 = { x: p2.x, y: p2.y };
      }
    }
    result.push({
      start: { x: p1.x, y: p1.y },
      control1,
      control2,
      end: { x: p2.x, y: p2.y },
    });
  }
  return result;
}

interface NormalizedEdge {
  readonly edge: OrthogonalEdge;
  readonly index: number;
}

function isOrthogonalEdge(value: unknown): value is OrthogonalEdge {
  if (!isRecord(value) || typeof value.id !== 'string' || !isArray(value.points)) {
    return false;
  }
  if (value.uid !== undefined && typeof value.uid !== 'string') {
    return false;
  }
  if (value.zIndex !== undefined && !isFiniteNumber(value.zIndex)) {
    return false;
  }
  return value.points.every((point) => isPoint(point));
}

function edgeIdentity(edge: OrthogonalEdge): string {
  return edge.uid ?? edge.id;
}

function compareEdges(left: NormalizedEdge, right: NormalizedEdge): number {
  const zIndex = (left.edge.zIndex ?? 0) - (right.edge.zIndex ?? 0);
  if (zIndex !== 0) {
    return zIndex;
  }
  const uid = compareStrings(edgeIdentity(left.edge), edgeIdentity(right.edge));
  return uid !== 0 ? uid : compareStrings(left.edge.id, right.edge.id) || left.index - right.index;
}

interface HorizontalSegment {
  readonly left: number;
  readonly right: number;
  readonly y: number;
}

interface VerticalSegment {
  readonly x: number;
  readonly top: number;
  readonly bottom: number;
}

function orthogonalSegments(points: readonly Point[]): readonly (HorizontalSegment | VerticalSegment)[] {
  const segments: (HorizontalSegment | VerticalSegment)[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (start === undefined || end === undefined) {
      continue;
    }
    if (start.y === end.y && start.x !== end.x) {
      segments.push({ left: Math.min(start.x, end.x), right: Math.max(start.x, end.x), y: start.y });
    } else if (start.x === end.x && start.y !== end.y) {
      segments.push({ x: start.x, top: Math.min(start.y, end.y), bottom: Math.max(start.y, end.y) });
    }
  }
  return segments;
}

function isHorizontalSegment(segment: HorizontalSegment | VerticalSegment): segment is HorizontalSegment {
  return 'y' in segment;
}

/** Find strict interior crossings between orthogonal connector segments. */
export function findOrthogonalCrossings(
  edges: readonly OrthogonalEdge[],
): readonly OrthogonalCrossing[] {
  if (!isArray(edges)) {
    return [];
  }
  const validEdges: NormalizedEdge[] = edges
    .map((edge, index) => (isOrthogonalEdge(edge) ? { edge, index } : undefined))
    .filter((edge): edge is NormalizedEdge => edge !== undefined)
    .sort(compareEdges);
  const crossings: OrthogonalCrossing[] = [];
  for (let leftIndex = 0; leftIndex < validEdges.length; leftIndex += 1) {
    const left = validEdges[leftIndex];
    if (left === undefined) {
      continue;
    }
    const leftSegments = orthogonalSegments(left.edge.points);
    for (let rightIndex = leftIndex + 1; rightIndex < validEdges.length; rightIndex += 1) {
      const right = validEdges[rightIndex];
      if (right === undefined) {
        continue;
      }
      const rightSegments = orthogonalSegments(right.edge.points);
      for (const first of leftSegments) {
        for (const second of rightSegments) {
          const horizontal = isHorizontalSegment(first) ? first : isHorizontalSegment(second) ? second : undefined;
          const vertical = isHorizontalSegment(first) ? (isHorizontalSegment(second) ? undefined : second) : isHorizontalSegment(second) ? first : undefined;
          if (horizontal === undefined || vertical === undefined ||
            !(vertical.x > horizontal.left && vertical.x < horizontal.right &&
              horizontal.y > vertical.top && horizontal.y < vertical.bottom)) {
            continue;
          }
          const leftIsOver = compareEdges(left, right) > 0;
          crossings.push({
            overEdgeId: leftIsOver ? left.edge.id : right.edge.id,
            underEdgeId: leftIsOver ? right.edge.id : left.edge.id,
            point: { x: vertical.x, y: horizontal.y },
          });
        }
      }
    }
  }
  crossings.sort((left, right) => {
    const x = left.point.x - right.point.x;
    if (x !== 0) {
      return x;
    }
    const y = left.point.y - right.point.y;
    if (y !== 0) {
      return y;
    }
    const over = compareStrings(left.overEdgeId, right.overEdgeId);
    return over !== 0 ? over : compareStrings(left.underEdgeId, right.underEdgeId);
  });
  return crossings;
}
