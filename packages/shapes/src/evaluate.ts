import { evaluateShapeFormula, type FormulaScope } from './formula.js';
import { validateShapeDefinition } from './schema.js';
import type {
  EvaluatedBooleanGeometry,
  EvaluatedClip,
  EvaluatedControl,
  EvaluatedEllipseGeometry,
  EvaluatedGeometry,
  EvaluatedLinkPoint,
  EvaluatedPathCommand,
  EvaluatedPathGeometry,
  EvaluatedPolygonGeometry,
  EvaluatedPort,
  EvaluatedRectGeometry,
  EvaluatedShape,
  EvaluatedShapeBounds,
  EvaluatedShapeNode,
  EvaluatedTextArea,
  ShapeAnchor,
  ShapeBoundsDefinition,
  ShapeChildDefinition,
  ShapeClipDefinition,
  ShapeControlDefinition,
  ShapeDataValue,
  ShapeDefinition,
  ShapeDefinitionValue,
  ShapeDiagnostic,
  ShapeDiagnosticCode,
  ShapeEvaluationOptions,
  ShapeEvaluationResult,
  ShapeFormulaValue,
  ShapeFrame,
  ShapeGeometryDefinition,
  ShapeLinkPointDefinition,
  ShapePathCommandDefinition,
  ShapePoint,
  ShapePortDefinition,
  ShapePropertyDefinition,
  ShapeRepeatDefinition,
  ShapeTextAreaDefinition,
} from './types.js';

const MAX_REPEAT_COUNT = 10_000;

interface EvaluationState {
  readonly claimedIds: Set<string>;
  readonly propertyNames: ReadonlySet<string>;
}

interface ResolvedPaint {
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  strokeOpacity?: number;
  strokeWidth?: number;
  dash?: readonly number[];
}

interface ExpandedScope {
  readonly scope: Map<string, ShapeDataValue>;
  readonly suffix: string;
}

interface DefinitionsResult {
  readonly scope: Map<string, ShapeDataValue>;
  readonly names: ReadonlySet<string>;
}

class ShapeEvaluationFailure extends Error {
  public constructor(public readonly diagnostic: ShapeDiagnostic) {
    super(diagnostic.message);
    this.name = 'ShapeEvaluationFailure';
  }
}

function fail(
  code: ShapeDiagnosticCode,
  path: string,
  message: string,
): never {
  throw new ShapeEvaluationFailure({ code, path, message });
}

function evaluateValue(
  value: ShapeFormulaValue,
  scope: FormulaScope,
  path: string,
): ShapeDataValue {
  const result = evaluateShapeFormula(value, scope, path);
  if (!result.ok) {
    throw new ShapeEvaluationFailure(result.diagnostic);
  }
  return result.value;
}

function finiteNumber(value: ShapeDataValue, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('FORMULA_INVALID', path, 'Expected a finite number');
  }
  return value;
}

function nonnegativeNumber(value: ShapeDataValue, path: string): number {
  const number = finiteNumber(value, path);
  if (number < 0) {
    fail('FORMULA_INVALID', path, 'Expected a non-negative number');
  }
  return number;
}

function booleanValue(value: ShapeDataValue, path: string): boolean {
  if (typeof value !== 'boolean') {
    fail('FORMULA_INVALID', path, 'Expected a boolean');
  }
  return value;
}

function stringValue(value: ShapeDataValue, path: string): string {
  if (typeof value !== 'string') {
    fail('FORMULA_INVALID', path, 'Expected a string');
  }
  return value;
}

function textValue(value: ShapeDataValue, path: string): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return String(value);
  }
  fail('FORMULA_INVALID', path, 'Expected a scalar text value');
}

function qualifyId(prefix: string, id: string): string {
  return prefix.length === 0 ? id : `${prefix}.${id}`;
}

function claimId(state: EvaluationState, id: string, path: string): void {
  if (state.claimedIds.has(id)) {
    fail('DUPLICATE_ID', path, `Evaluated id ${JSON.stringify(id)} is already in use`);
  }
  state.claimedIds.add(id);
}

function withDimensions(
  scope: FormulaScope,
  bounds: ShapeFrame,
  preservedNames: ReadonlySet<string> = new Set(),
): Map<string, ShapeDataValue> {
  const next = new Map(scope);
  if (!preservedNames.has('Width')) {
    next.set('Width', bounds.width);
  }
  if (!preservedNames.has('Height')) {
    next.set('Height', bounds.height);
  }
  return next;
}

function evaluateDefinitions(
  definitions: readonly ShapeDefinitionValue[] | undefined,
  parentScope: FormulaScope,
  path: string,
): DefinitionsResult {
  const scope = new Map(parentScope);
  const names = new Set<string>();
  for (let index = 0; index < (definitions?.length ?? 0); index += 1) {
    const definition = definitions?.[index];
    if (definition === undefined) {
      continue;
    }
    const definitionPath = `${path}.${index}`;
    if (names.has(definition.name)) {
      fail(
        'DUPLICATE_ID',
        `${definitionPath}.name`,
        `Definition ${JSON.stringify(definition.name)} is declared more than once`,
      );
    }
    const value = evaluateValue(
      definition.value,
      scope,
      `${definitionPath}.value`,
    );
    names.add(definition.name);
    scope.set(definition.name, value);
  }
  return { scope, names };
}

function isRecord(value: ShapeDataValue): value is Readonly<Record<string, ShapeDataValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDataArray(value: ShapeDataValue): value is readonly ShapeDataValue[] {
  return Array.isArray(value);
}

function normalizedCoordinate(value: number): number {
  const normalized = Math.round(value * 1_000_000_000) / 1_000_000_000;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function frameOnly(bounds: ShapeFrame): ShapeFrame {
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function sameDataValue(left: ShapeDataValue, right: ShapeDataValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function propertyValueIsValid(
  property: ShapePropertyDefinition,
  value: ShapeDataValue,
): boolean {
  switch (property.type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
      return typeof value === 'string';
    case 'color':
      return (
        typeof value === 'string' &&
        (/^#[0-9a-f]{3,8}$/i.test(value) || /^[a-z][a-z0-9_-]{0,63}$/i.test(value))
      );
    case 'date':
      return (
        typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}(?:T.*(?:Z|[+-]\d{2}:\d{2}))?$/.test(value) &&
        !Number.isNaN(Date.parse(value))
      );
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isRecord(value);
    case 'formula':
      return true;
    case 'picklist':
      return (
        property.options !== undefined &&
        property.options.some((option) => sameDataValue(option, value))
      );
  }
}

function resolveProperties(
  definition: ShapeDefinition,
  supplied: Readonly<Record<string, ShapeDataValue>>,
  baseScope: FormulaScope,
): {
  readonly data: Readonly<Record<string, ShapeDataValue>>;
  readonly scope: Map<string, ShapeDataValue>;
  readonly propertyNames: ReadonlySet<string>;
} {
  const properties = definition.properties ?? [];
  const propertyNames = new Set<string>();
  for (let index = 0; index < properties.length; index += 1) {
    const property = properties[index];
    if (property === undefined) {
      continue;
    }
    if (propertyNames.has(property.name)) {
      fail(
        'DUPLICATE_ID',
        `properties.${index}.name`,
        `Property ${JSON.stringify(property.name)} is declared more than once`,
      );
    }
    propertyNames.add(property.name);
  }

  for (const key of Object.keys(supplied).sort()) {
    if (!propertyNames.has(key)) {
      fail('PROPERTY_INVALID', `data.${key}`, `Unknown shape property ${JSON.stringify(key)}`);
    }
  }

  const data: Record<string, ShapeDataValue> = {};
  const scope = new Map(baseScope);
  for (let index = 0; index < properties.length; index += 1) {
    const property = properties[index];
    if (property === undefined) {
      continue;
    }
    const hasSupplied = Object.prototype.hasOwnProperty.call(supplied, property.name);
    const authoredValue = hasSupplied ? supplied[property.name] : property.default;
    if (authoredValue === undefined) {
      continue;
    }
    const value = evaluateValue(
      authoredValue,
      scope,
      hasSupplied ? `data.${property.name}` : `properties.${index}.default`,
    );
    if (!propertyValueIsValid(property, value)) {
      fail(
        'PROPERTY_INVALID',
        hasSupplied ? `data.${property.name}` : `properties.${index}.default`,
        `Property ${JSON.stringify(property.name)} is not a valid ${property.type}`,
      );
    }
    data[property.name] = value;
    scope.set(property.name, value);
  }

  for (let propertyIndex = 0; propertyIndex < properties.length; propertyIndex += 1) {
    const property = properties[propertyIndex];
    if (property === undefined || !(property.name in data)) {
      continue;
    }
    for (
      let constraintIndex = 0;
      constraintIndex < (property.constraints?.length ?? 0);
      constraintIndex += 1
    ) {
      const constraint = property.constraints?.[constraintIndex];
      if (constraint === undefined) {
        continue;
      }
      const constraintPath = `properties.${propertyIndex}.constraints.${constraintIndex}`;
      const valid = booleanValue(
        evaluateValue(constraint.condition, scope, `${constraintPath}.condition`),
        `${constraintPath}.condition`,
      );
      if (valid) {
        continue;
      }
      if (constraint.resolution === undefined) {
        fail(
          'CONSTRAINT_FAILED',
          constraintPath,
          constraint.message ?? `Constraint failed for property ${JSON.stringify(property.name)}`,
        );
      }
      const resolved = evaluateValue(
        constraint.resolution,
        scope,
        `${constraintPath}.resolution`,
      );
      if (!propertyValueIsValid(property, resolved)) {
        fail(
          'PROPERTY_INVALID',
          `${constraintPath}.resolution`,
          `Constraint resolution for ${JSON.stringify(property.name)} is not a valid ${property.type}`,
        );
      }
      data[property.name] = resolved;
      scope.set(property.name, resolved);
    }
  }

  return { data, scope, propertyNames };
}

function evaluateCondition(
  condition: ShapeFormulaValue | undefined,
  scope: FormulaScope,
  path: string,
): boolean {
  if (condition === undefined) {
    return true;
  }
  return booleanValue(evaluateValue(condition, scope, path), path);
}

function evaluateRepeat(
  repeat: ShapeRepeatDefinition | undefined,
  scope: FormulaScope,
  path: string,
): readonly ExpandedScope[] {
  if (repeat === undefined) {
    return [{ scope: new Map(scope), suffix: '' }];
  }

  if (repeat.type === 'for') {
    const minimum = finiteNumber(evaluateValue(repeat.min, scope, `${path}.min`), `${path}.min`);
    const maximum = finiteNumber(evaluateValue(repeat.max, scope, `${path}.max`), `${path}.max`);
    if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum)) {
      fail('FORMULA_INVALID', path, 'For-repeat bounds must be safe integers');
    }
    if (maximum < minimum) {
      return [];
    }
    const count = maximum - minimum + 1;
    if (count > MAX_REPEAT_COUNT) {
      fail('FORMULA_INVALID', path, `Repeat count exceeds ${MAX_REPEAT_COUNT}`);
    }
    const indexName = repeat.index ?? 'Index';
    return Array.from({ length: count }, (_, offset) => {
      const value = minimum + offset;
      const repeatedScope = new Map(scope);
      repeatedScope.set(indexName, value);
      return { scope: repeatedScope, suffix: `[${value}]` };
    });
  }

  const source = evaluateValue(repeat.source, scope, `${path}.source`);
  if (!isDataArray(source)) {
    fail('FORMULA_INVALID', `${path}.source`, 'Map-repeat source must be an array');
  }
  if (source.length > MAX_REPEAT_COUNT) {
    fail('FORMULA_INVALID', path, `Repeat count exceeds ${MAX_REPEAT_COUNT}`);
  }
  const indexName = repeat.index ?? 'Index';
  const valueName = repeat.value ?? 'Value';
  return source.map((value, index) => {
    const repeatedScope = new Map(scope);
    repeatedScope.set(indexName, index);
    repeatedScope.set(valueName, value);
    return { scope: repeatedScope, suffix: `[${index}]` };
  });
}

const ANCHORS: Readonly<Record<ShapeAnchor, readonly [number, number]>> = {
  'top-left': [0, 0],
  top: [0.5, 0],
  'top-right': [1, 0],
  left: [0, 0.5],
  center: [0.5, 0.5],
  right: [1, 0.5],
  'bottom-left': [0, 1],
  bottom: [0.5, 1],
  'bottom-right': [1, 1],
};

function resolveBounds(
  definition: ShapeBoundsDefinition | undefined,
  parent: EvaluatedShapeBounds,
  scope: FormulaScope,
  path: string,
): EvaluatedShapeBounds {
  const x = finiteNumber(
    evaluateValue(definition?.x ?? 0, scope, `${path}.x`),
    `${path}.x`,
  );
  const y = finiteNumber(
    evaluateValue(definition?.y ?? 0, scope, `${path}.y`),
    `${path}.y`,
  );
  const widthValue = nonnegativeNumber(
    evaluateValue(definition?.w ?? 1, scope, `${path}.w`),
    `${path}.w`,
  );
  const heightValue = nonnegativeNumber(
    evaluateValue(definition?.h ?? 1, scope, `${path}.h`),
    `${path}.h`,
  );
  const absolute = definition?.absolute ?? '';
  const width = absolute.includes('w') ? widthValue : widthValue * parent.width;
  const height = absolute.includes('h') ? heightValue : heightValue * parent.height;
  const anchorPosition = {
    x: parent.x + (absolute.includes('x') ? x : x * parent.width),
    y: parent.y + (absolute.includes('y') ? y : y * parent.height),
  };
  const [anchorX, anchorY] = ANCHORS[definition?.anchor ?? 'top-left'];
  const rotation = finiteNumber(
    evaluateValue(definition?.rotation ?? 0, scope, `${path}.rotation`),
    `${path}.rotation`,
  );
  return {
    x: normalizedCoordinate(anchorPosition.x - anchorX * width),
    y: normalizedCoordinate(anchorPosition.y - anchorY * height),
    width: normalizedCoordinate(width),
    height: normalizedCoordinate(height),
    rotation: normalizedCoordinate(rotation),
    rotationOrigin: {
      x: normalizedCoordinate(anchorPosition.x),
      y: normalizedCoordinate(anchorPosition.y),
    },
  };
}

function resolvePoint(
  x: ShapeFormulaValue,
  y: ShapeFormulaValue,
  bounds: ShapeFrame,
  scope: FormulaScope,
  path: string,
): ShapePoint {
  const relativeX = finiteNumber(evaluateValue(x, scope, `${path}.x`), `${path}.x`);
  const relativeY = finiteNumber(evaluateValue(y, scope, `${path}.y`), `${path}.y`);
  return {
    x: normalizedCoordinate(bounds.x + relativeX * bounds.width),
    y: normalizedCoordinate(bounds.y + relativeY * bounds.height),
  };
}

function resolveBoxFrame(
  definition: {
    readonly x?: ShapeFormulaValue;
    readonly y?: ShapeFormulaValue;
    readonly w?: ShapeFormulaValue;
    readonly h?: ShapeFormulaValue;
  },
  bounds: ShapeFrame,
  scope: FormulaScope,
  path: string,
): ShapeFrame {
  const x = finiteNumber(evaluateValue(definition.x ?? 0, scope, `${path}.x`), `${path}.x`);
  const y = finiteNumber(evaluateValue(definition.y ?? 0, scope, `${path}.y`), `${path}.y`);
  const width = nonnegativeNumber(
    evaluateValue(definition.w ?? 1, scope, `${path}.w`),
    `${path}.w`,
  );
  const height = nonnegativeNumber(
    evaluateValue(definition.h ?? 1, scope, `${path}.h`),
    `${path}.h`,
  );
  return {
    x: normalizedCoordinate(bounds.x + x * bounds.width),
    y: normalizedCoordinate(bounds.y + y * bounds.height),
    width: normalizedCoordinate(width * bounds.width),
    height: normalizedCoordinate(height * bounds.height),
  };
}

function resolvePaint(
  definition: ShapeGeometryDefinition,
  scope: FormulaScope,
  path: string,
): ResolvedPaint {
  const paint: ResolvedPaint = {};
  if (definition.fill !== undefined) {
    paint.fill = stringValue(
      evaluateValue(definition.fill, scope, `${path}.fill`),
      `${path}.fill`,
    );
  }
  if (definition.stroke !== undefined) {
    paint.stroke = stringValue(
      evaluateValue(definition.stroke, scope, `${path}.stroke`),
      `${path}.stroke`,
    );
  }
  for (const [field, authored] of [
    ['fillOpacity', definition.fillOpacity],
    ['strokeOpacity', definition.strokeOpacity],
  ] as const) {
    if (authored === undefined) {
      continue;
    }
    const opacity = finiteNumber(evaluateValue(authored, scope, `${path}.${field}`), `${path}.${field}`);
    if (opacity < 0 || opacity > 1) {
      fail('FORMULA_INVALID', `${path}.${field}`, 'Opacity must be between zero and one');
    }
    paint[field] = opacity;
  }
  if (definition.strokeWidth !== undefined) {
    paint.strokeWidth = nonnegativeNumber(
      evaluateValue(definition.strokeWidth, scope, `${path}.strokeWidth`),
      `${path}.strokeWidth`,
    );
  }
  if (definition.dash !== undefined) {
    paint.dash = definition.dash.map((entry, index) =>
      nonnegativeNumber(
        evaluateValue(entry, scope, `${path}.dash.${index}`),
        `${path}.dash.${index}`,
      ),
    );
  }
  return paint;
}

function evaluatePathCommand(
  command: ShapePathCommandDefinition,
  bounds: ShapeFrame,
  scope: FormulaScope,
  path: string,
): EvaluatedPathCommand {
  switch (command.type) {
    case 'move':
    case 'line':
      return {
        type: command.type,
        to: resolvePoint(command.x, command.y, bounds, scope, path),
      };
    case 'quadratic':
      return {
        type: 'quadratic',
        control: resolvePoint(command.cx, command.cy, bounds, scope, `${path}.control`),
        to: resolvePoint(command.x, command.y, bounds, scope, path),
      };
    case 'cubic':
      return {
        type: 'cubic',
        control1: resolvePoint(command.c1x, command.c1y, bounds, scope, `${path}.control1`),
        control2: resolvePoint(command.c2x, command.c2y, bounds, scope, `${path}.control2`),
        to: resolvePoint(command.x, command.y, bounds, scope, path),
      };
    case 'close':
      return { type: 'close' };
  }
}

function evaluateGeometryList(
  definitions: readonly ShapeGeometryDefinition[] | undefined,
  bounds: EvaluatedShapeBounds,
  parentScope: FormulaScope,
  prefix: string,
  path: string,
  state: EvaluationState,
): readonly EvaluatedGeometry[] {
  const output: EvaluatedGeometry[] = [];
  for (let index = 0; index < (definitions?.length ?? 0); index += 1) {
    const definition = definitions?.[index];
    if (definition === undefined) {
      continue;
    }
    const definitionPath = `${path}.${index}`;
    if (!evaluateCondition(definition.condition, parentScope, `${definitionPath}.condition`)) {
      continue;
    }
    const repeated = evaluateRepeat(definition.repeat, parentScope, `${definitionPath}.repeat`);
    for (const instance of repeated) {
      const definitionsResult = evaluateDefinitions(
        definition.defs,
        instance.scope,
        `${definitionPath}.defs`,
      );
      const scope = definitionsResult.scope;
      const id = `${qualifyId(prefix, definition.id)}${instance.suffix}`;
      claimId(state, id, `${definitionPath}.id`);
      const paint = resolvePaint(definition, scope, definitionPath);
      switch (definition.type) {
        case 'rect': {
          const radius =
            definition.radius === undefined
              ? undefined
              : nonnegativeNumber(
                  evaluateValue(definition.radius, scope, `${definitionPath}.radius`),
                  `${definitionPath}.radius`,
                );
          const geometry: EvaluatedRectGeometry = {
            id,
            type: 'rect',
            frame: resolveBoxFrame(definition, bounds, scope, definitionPath),
            ...paint,
            ...(radius === undefined ? {} : { radius }),
          };
          output.push(geometry);
          break;
        }
        case 'ellipse': {
          const geometry: EvaluatedEllipseGeometry = {
            id,
            type: 'ellipse',
            frame: resolveBoxFrame(definition, bounds, scope, definitionPath),
            ...paint,
          };
          output.push(geometry);
          break;
        }
        case 'polygon': {
          const geometry: EvaluatedPolygonGeometry = {
            id,
            type: 'polygon',
            points: definition.points.map((point, pointIndex) =>
              resolvePoint(
                point.x,
                point.y,
                bounds,
                scope,
                `${definitionPath}.points.${pointIndex}`,
              ),
            ),
            ...paint,
          };
          output.push(geometry);
          break;
        }
        case 'path': {
          const geometry: EvaluatedPathGeometry = {
            id,
            type: 'path',
            commands: definition.commands.map((command, commandIndex) =>
              evaluatePathCommand(
                command,
                bounds,
                scope,
                `${definitionPath}.commands.${commandIndex}`,
              ),
            ),
            ...paint,
          };
          output.push(geometry);
          break;
        }
        case 'boolean': {
          const geometry: EvaluatedBooleanGeometry = {
            id,
            type: 'boolean',
            operation: definition.operation,
            geometry: evaluateGeometryList(
              definition.geometry,
              bounds,
              scope,
              id,
              `${definitionPath}.geometry`,
              state,
            ),
            ...paint,
          };
          output.push(geometry);
          break;
        }
      }
    }
  }
  return output;
}

function evaluateTextAreas(
  definitions: readonly ShapeTextAreaDefinition[] | undefined,
  bounds: EvaluatedShapeBounds,
  scope: FormulaScope,
  prefix: string,
  path: string,
  state: EvaluationState,
): readonly EvaluatedTextArea[] {
  return (definitions ?? []).map((definition, index) => {
    const definitionPath = `${path}.${index}`;
    const id = qualifyId(prefix, definition.id);
    claimId(state, id, `${definitionPath}.id`);
    return {
      id,
      frame: frameOnly(
        resolveBounds(definition.bounds, bounds, scope, `${definitionPath}.bounds`),
      ),
      text: textValue(evaluateValue(definition.text, scope, `${definitionPath}.text`), `${definitionPath}.text`),
      editable: definition.editable ?? true,
    };
  });
}

function evaluateLinkPoints(
  definitions: readonly ShapeLinkPointDefinition[] | undefined,
  bounds: EvaluatedShapeBounds,
  scope: FormulaScope,
  prefix: string,
  path: string,
  state: EvaluationState,
): readonly EvaluatedLinkPoint[] {
  return (definitions ?? []).map((definition, index) => {
    const definitionPath = `${path}.${index}`;
    const id = qualifyId(prefix, definition.id);
    claimId(state, id, `${definitionPath}.id`);
    return {
      id,
      point: resolvePoint(definition.x, definition.y, bounds, scope, definitionPath),
    };
  });
}

function evaluatePorts(
  definitions: readonly ShapePortDefinition[] | undefined,
  bounds: EvaluatedShapeBounds,
  scope: FormulaScope,
  prefix: string,
  path: string,
  state: EvaluationState,
): readonly EvaluatedPort[] {
  return (definitions ?? []).map((definition, index) => {
    const definitionPath = `${path}.${index}`;
    const id = qualifyId(prefix, definition.id);
    claimId(state, id, `${definitionPath}.id`);
    return {
      id,
      direction: definition.direction,
      side: definition.side,
      point: resolvePoint(definition.x, definition.y, bounds, scope, definitionPath),
    };
  });
}

function evaluateControlConstraint(
  definition: ShapeControlDefinition,
  bounds: EvaluatedShapeBounds,
  scope: FormulaScope,
  path: string,
): EvaluatedControl['constraint'] {
  const constraint = definition.constraint;
  if (constraint === undefined) {
    return undefined;
  }
  if (constraint.type === 'path') {
    return {
      type: 'path',
      points: constraint.points.map((point, index) =>
        resolvePoint(point.x, point.y, bounds, scope, `${path}.points.${index}`),
      ),
    };
  }
  return {
    type: 'area',
    frame: resolveBoxFrame(constraint, bounds, scope, path),
  };
}

function evaluateControls(
  definitions: readonly ShapeControlDefinition[] | undefined,
  bounds: EvaluatedShapeBounds,
  scope: FormulaScope,
  prefix: string,
  path: string,
  state: EvaluationState,
): readonly EvaluatedControl[] {
  return (definitions ?? []).map((definition, index) => {
    const definitionPath = `${path}.${index}`;
    const id = qualifyId(prefix, definition.id);
    claimId(state, id, `${definitionPath}.id`);
    for (let actionIndex = 0; actionIndex < definition.onmove.length; actionIndex += 1) {
      const action = definition.onmove[actionIndex];
      if (action !== undefined && !state.propertyNames.has(action.field)) {
        fail(
          'PROPERTY_INVALID',
          `${definitionPath}.onmove.${actionIndex}.field`,
          `Control field ${JSON.stringify(action.field)} is not a declared property`,
        );
      }
    }
    const constraint = evaluateControlConstraint(
      definition,
      bounds,
      scope,
      `${definitionPath}.constraint`,
    );
    return {
      id,
      point: resolvePoint(
        definition.location.x,
        definition.location.y,
        bounds,
        scope,
        `${definitionPath}.location`,
      ),
      ...(constraint === undefined ? {} : { constraint }),
      onmove: definition.onmove,
    };
  });
}

function evaluateClip(
  definition: ShapeClipDefinition | undefined,
  bounds: EvaluatedShapeBounds,
  scope: FormulaScope,
  prefix: string,
  path: string,
  state: EvaluationState,
): EvaluatedClip | undefined {
  if (definition === undefined) {
    return undefined;
  }
  const clip: {
    geometry: readonly EvaluatedGeometry[];
    stroke?: string;
    strokeWidth?: number;
  } = {
    geometry: evaluateGeometryList(
      definition.geometry,
      bounds,
      scope,
      qualifyId(prefix, 'clip'),
      `${path}.geometry`,
      state,
    ),
  };
  if (definition.stroke !== undefined) {
    clip.stroke = stringValue(
      evaluateValue(definition.stroke, scope, `${path}.stroke`),
      `${path}.stroke`,
    );
  }
  if (definition.strokeWidth !== undefined) {
    clip.strokeWidth = nonnegativeNumber(
      evaluateValue(definition.strokeWidth, scope, `${path}.strokeWidth`),
      `${path}.strokeWidth`,
    );
  }
  return clip;
}

function evaluateChildren(
  definitions: readonly ShapeChildDefinition[] | undefined,
  parentBounds: EvaluatedShapeBounds,
  parentScope: FormulaScope,
  prefix: string,
  path: string,
  state: EvaluationState,
): readonly EvaluatedShapeNode[] {
  const output: EvaluatedShapeNode[] = [];
  for (let index = 0; index < (definitions?.length ?? 0); index += 1) {
    const definition = definitions?.[index];
    if (definition === undefined) {
      continue;
    }
    const definitionPath = `${path}.${index}`;
    if (!evaluateCondition(definition.condition, parentScope, `${definitionPath}.condition`)) {
      continue;
    }
    const repeated = evaluateRepeat(definition.repeat, parentScope, `${definitionPath}.repeat`);
    for (const instance of repeated) {
      const definitionsResult = evaluateDefinitions(
        definition.defs,
        instance.scope,
        `${definitionPath}.defs`,
      );
      const bounds = resolveBounds(
        definition.bounds,
        parentBounds,
        definitionsResult.scope,
        `${definitionPath}.bounds`,
      );
      const scope = withDimensions(
        definitionsResult.scope,
        bounds,
        definitionsResult.names,
      );
      const id = `${qualifyId(prefix, definition.id)}${instance.suffix}`;
      claimId(state, id, `${definitionPath}.id`);
      const textAreas = evaluateTextAreas(
        definition.textAreas,
        bounds,
        scope,
        id,
        `${definitionPath}.textAreas`,
        state,
      );
      const linkPoints = evaluateLinkPoints(
        definition.linkPoints,
        bounds,
        scope,
        id,
        `${definitionPath}.linkPoints`,
        state,
      );
      const ports = evaluatePorts(
        definition.ports,
        bounds,
        scope,
        id,
        `${definitionPath}.ports`,
        state,
      );
      const controls = evaluateControls(
        definition.controls,
        bounds,
        scope,
        id,
        `${definitionPath}.controls`,
        state,
      );
      const geometry = evaluateGeometryList(
        definition.geometry,
        bounds,
        scope,
        id,
        `${definitionPath}.geometry`,
        state,
      );
      const clip = evaluateClip(
        definition.clip,
        bounds,
        scope,
        id,
        `${definitionPath}.clip`,
        state,
      );
      const children = evaluateChildren(
        definition.shapes,
        bounds,
        scope,
        id,
        `${definitionPath}.shapes`,
        state,
      );
      output.push({
        id,
        bounds,
        textAreas,
        linkPoints,
        ports,
        controls,
        geometry,
        children,
        ...(clip === undefined ? {} : { clip }),
      });
    }
  }
  return output;
}

function rootBounds(frame: ShapeFrame): EvaluatedShapeBounds {
  return {
    ...frame,
    rotation: 0,
    rotationOrigin: { x: frame.x, y: frame.y },
  };
}

function resolveRootFrame(
  definition: ShapeDefinition,
  frame: ShapeFrame | undefined,
): ShapeFrame {
  const resolved = frame ?? {
    x: 0,
    y: 0,
    width: definition.defaultSize.width,
    height: definition.defaultSize.height,
  };
  if (
    !Number.isFinite(resolved.x) ||
    !Number.isFinite(resolved.y) ||
    !Number.isFinite(resolved.width) ||
    !Number.isFinite(resolved.height) ||
    resolved.width <= 0 ||
    resolved.height <= 0
  ) {
    fail('PROPERTY_INVALID', 'frame', 'Shape frame must have finite positive dimensions');
  }
  return resolved;
}

/** Validate and deterministically evaluate a declarative shape definition. */
export function evaluateShapeDefinition(
  input: unknown,
  options: ShapeEvaluationOptions = {},
): ShapeEvaluationResult {
  const validation = validateShapeDefinition(input);
  if (!validation.ok) {
    return validation;
  }

  try {
    const definition = validation.definition;
    const frame = resolveRootFrame(definition, options.frame);
    const bounds = rootBounds(frame);
    const baseScope = withDimensions(new Map(), frame);
    const propertyResult = resolveProperties(definition, options.data ?? {}, baseScope);
    const definitionsResult = evaluateDefinitions(
      definition.defs,
      propertyResult.scope,
      'defs',
    );
    const scope = withDimensions(definitionsResult.scope, frame, definitionsResult.names);
    const state: EvaluationState = {
      claimedIds: new Set([definition.id]),
      propertyNames: propertyResult.propertyNames,
    };
    const textAreas = evaluateTextAreas(
      definition.textAreas,
      bounds,
      scope,
      '',
      'textAreas',
      state,
    );
    const linkPoints = evaluateLinkPoints(
      definition.linkPoints,
      bounds,
      scope,
      '',
      'linkPoints',
      state,
    );
    const ports = evaluatePorts(definition.ports, bounds, scope, '', 'ports', state);
    const controls = evaluateControls(
      definition.controls,
      bounds,
      scope,
      '',
      'controls',
      state,
    );
    const geometry = evaluateGeometryList(
      definition.geometry,
      bounds,
      scope,
      '',
      'geometry',
      state,
    );
    const clip = evaluateClip(definition.clip, bounds, scope, '', 'clip', state);
    const children = evaluateChildren(
      definition.shapes,
      bounds,
      scope,
      '',
      'shapes',
      state,
    );
    const shape: EvaluatedShape = {
      id: definition.id,
      definitionId: definition.id,
      name: definition.name,
      composition: definition.composition ?? 'above',
      data: propertyResult.data,
      bounds,
      textAreas,
      linkPoints,
      ports,
      controls,
      geometry,
      children,
      ...(clip === undefined ? {} : { clip }),
    };
    return { ok: true, shape };
  } catch (error: unknown) {
    if (error instanceof ShapeEvaluationFailure) {
      return { ok: false, diagnostics: [error.diagnostic] };
    }
    throw error;
  }
}
