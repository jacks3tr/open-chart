import { ID_PATTERN } from '@openchart/ir';
import { z, type ZodIssue } from 'zod';

import {
  SHAPE_DEFINITION_VERSION,
  type ShapeBooleanGeometryDefinition,
  type ShapeChildDefinition,
  type ShapeClipDefinition,
  type ShapeControlDefinition,
  type ShapeDefinition,
  type ShapeDefinitionValue,
  type ShapeEllipseGeometryDefinition,
  type ShapeFormulaValue,
  type ShapeGeometryDefinition,
  type ShapeLinkPointDefinition,
  type ShapePathCommandDefinition,
  type ShapePathGeometryDefinition,
  type ShapePolygonGeometryDefinition,
  type ShapePortDefinition,
  type ShapePropertyConstraint,
  type ShapePropertyDefinition,
  type ShapeRectGeometryDefinition,
  type ShapeRepeatDefinition,
  type ShapeTextAreaDefinition,
  type ShapeValidationResult,
} from './types.js';

const MAX_AUTHORED_ARRAY_LENGTH = 10_000;
const MAX_AUTHORED_NODE_COUNT = 100_000;
const MAX_AUTHORED_DEPTH = 128;
const MAX_STRING_LENGTH = 65_536;
const MAX_FORMULA_LENGTH = 4_097;

const idSchema = z.string().max(MAX_STRING_LENGTH).regex(ID_PATTERN, {
  message: 'Expected a lowercase dot-separated identifier',
});

const symbolSchema = z.string().max(MAX_STRING_LENGTH).regex(/^[A-Za-z_][A-Za-z0-9_-]*$/, {
  message: 'Expected a symbol name beginning with a letter or underscore',
});

function boundedStringIssue(
  ctx: z.core.$RefinementCtx,
  maximum: number,
  kind: 'formula' | 'string',
): void {
  ctx.addIssue({
    code: 'too_big',
    maximum,
    origin: 'string',
    inclusive: true,
    message:
      kind === 'formula'
        ? `Formula strings must be at most ${maximum} characters`
        : `Strings must be at most ${maximum} characters`,
  });
}

const ordinaryStringSchema = z.string().max(MAX_STRING_LENGTH);

/** Formula-capable strings have a deliberately smaller cap. */
const formulaStringSchema = z.string().superRefine((value, ctx) => {
  if (value.startsWith('=') && value.length > MAX_FORMULA_LENGTH) {
    boundedStringIssue(ctx, MAX_FORMULA_LENGTH, 'formula');
  } else if (value.length > MAX_STRING_LENGTH) {
    boundedStringIssue(ctx, MAX_STRING_LENGTH, 'string');
  }
});

const formulaValueSchema: z.ZodType<ShapeFormulaValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    formulaStringSchema,
    z.array(formulaValueSchema).max(MAX_AUTHORED_ARRAY_LENGTH),
    z.record(ordinaryStringSchema, formulaValueSchema),
  ]),
);

const formulaValueArraySchema = z
  .array(formulaValueSchema)
  .max(MAX_AUTHORED_ARRAY_LENGTH);

const nameValueSchema: z.ZodType<ShapeDefinitionValue> = z.strictObject({
  name: symbolSchema,
  value: formulaValueSchema,
});

const propertyConstraintSchema: z.ZodType<ShapePropertyConstraint> = z.strictObject({
  condition: formulaValueSchema,
  resolution: formulaValueSchema.exactOptional(),
  message: ordinaryStringSchema.exactOptional(),
});

const propertySchema: z.ZodType<ShapePropertyDefinition> = z.strictObject({
  name: symbolSchema,
  label: ordinaryStringSchema.exactOptional(),
  type: z.enum([
    'number',
    'string',
    'color',
    'date',
    'boolean',
    'array',
    'object',
    'formula',
    'picklist',
  ]),
  default: formulaValueSchema.exactOptional(),
  options: formulaValueArraySchema.exactOptional(),
  constraints: z
    .array(propertyConstraintSchema)
    .max(MAX_AUTHORED_ARRAY_LENGTH)
    .exactOptional(),
});

const repeatForSchema = z.strictObject({
  type: z.literal('for'),
  min: formulaValueSchema,
  max: formulaValueSchema,
  index: symbolSchema.exactOptional(),
});

const repeatMapSchema = z.strictObject({
  type: z.literal('map'),
  source: formulaValueSchema,
  index: symbolSchema.exactOptional(),
  value: symbolSchema.exactOptional(),
});

const repeatSchema: z.ZodType<ShapeRepeatDefinition> = z.union([
  repeatForSchema,
  repeatMapSchema,
]);

const conditionalSchema = {
  condition: formulaValueSchema.exactOptional(),
  repeat: repeatSchema.exactOptional(),
  defs: z
    .array(nameValueSchema)
    .max(MAX_AUTHORED_ARRAY_LENGTH)
    .exactOptional(),
} as const;

const paintSchema = {
  fill: formulaValueSchema.exactOptional(),
  fillOpacity: formulaValueSchema.exactOptional(),
  stroke: formulaValueSchema.exactOptional(),
  strokeOpacity: formulaValueSchema.exactOptional(),
  strokeWidth: formulaValueSchema.exactOptional(),
  dash: formulaValueArraySchema.exactOptional(),
} as const;

const boundsSchema = z
  .strictObject({
    x: formulaValueSchema.exactOptional(),
    y: formulaValueSchema.exactOptional(),
    w: formulaValueSchema.exactOptional(),
    h: formulaValueSchema.exactOptional(),
    absolute: ordinaryStringSchema
      .superRefine((value, ctx) => {
        if (
          value.length === 0 ||
          value.length > 4 ||
          !/^[xywh]+$/.test(value) ||
          new Set(value).size !== value.length
        ) {
          ctx.addIssue({
            code: 'custom',
            message: 'absolute must contain a unique combination of x, y, w, and h',
          });
        }
      })
      .exactOptional(),
    anchor: z
      .enum([
      'top-left',
      'top',
      'top-right',
      'left',
      'center',
      'right',
      'bottom-left',
      'bottom',
      'bottom-right',
      ])
      .exactOptional(),
    rotation: formulaValueSchema.exactOptional(),
  });

const polygonPointSchema = z.strictObject({
  x: formulaValueSchema,
  y: formulaValueSchema,
});

const pathMoveLineSchema = z.strictObject({
  type: z.enum(['move', 'line']),
  x: formulaValueSchema,
  y: formulaValueSchema,
});

const pathQuadraticSchema = z.strictObject({
  type: z.literal('quadratic'),
  cx: formulaValueSchema,
  cy: formulaValueSchema,
  x: formulaValueSchema,
  y: formulaValueSchema,
});

const pathCubicSchema = z.strictObject({
  type: z.literal('cubic'),
  c1x: formulaValueSchema,
  c1y: formulaValueSchema,
  c2x: formulaValueSchema,
  c2y: formulaValueSchema,
  x: formulaValueSchema,
  y: formulaValueSchema,
});

const pathCloseSchema = z.strictObject({
  type: z.literal('close'),
});

const pathCommandSchema: z.ZodType<ShapePathCommandDefinition> = z.union([
  pathMoveLineSchema,
  pathQuadraticSchema,
  pathCubicSchema,
  pathCloseSchema,
]);

const pathCommandsSchema = z
  .array(pathCommandSchema)
  .max(MAX_AUTHORED_ARRAY_LENGTH);

const geometrySchema: z.ZodType<ShapeGeometryDefinition> = z.lazy(() =>
  z.union([
    rectGeometrySchema,
    ellipseGeometrySchema,
    polygonGeometrySchema,
    pathGeometrySchema,
    booleanGeometrySchema,
  ]),
);

const geometryArraySchema = z
  .array(geometrySchema)
  .max(MAX_AUTHORED_ARRAY_LENGTH);

const boxGeometryFields = {
  ...conditionalSchema,
  ...paintSchema,
  id: idSchema,
  x: formulaValueSchema.exactOptional(),
  y: formulaValueSchema.exactOptional(),
  w: formulaValueSchema.exactOptional(),
  h: formulaValueSchema.exactOptional(),
} as const;

const rectGeometrySchema: z.ZodType<ShapeRectGeometryDefinition> = z.strictObject({
  ...boxGeometryFields,
  type: z.literal('rect'),
  radius: formulaValueSchema.exactOptional(),
});

const ellipseGeometrySchema: z.ZodType<ShapeEllipseGeometryDefinition> = z.strictObject({
  ...boxGeometryFields,
  type: z.literal('ellipse'),
});

const polygonGeometrySchema: z.ZodType<ShapePolygonGeometryDefinition> = z.strictObject({
  ...conditionalSchema,
  ...paintSchema,
  id: idSchema,
  type: z.literal('polygon'),
  points: z
    .array(polygonPointSchema)
    .max(MAX_AUTHORED_ARRAY_LENGTH),
});

const pathGeometrySchema: z.ZodType<ShapePathGeometryDefinition> = z.strictObject({
  ...conditionalSchema,
  ...paintSchema,
  id: idSchema,
  type: z.literal('path'),
  commands: pathCommandsSchema,
});

const booleanGeometrySchema: z.ZodType<ShapeBooleanGeometryDefinition> = z.strictObject({
  ...conditionalSchema,
  ...paintSchema,
  id: idSchema,
  type: z.literal('boolean'),
  operation: z.enum(['union', 'intersection', 'difference', 'xor']),
  geometry: geometryArraySchema,
});

const textAreaSchema: z.ZodType<ShapeTextAreaDefinition> = z.strictObject({
  id: idSchema,
  bounds: boundsSchema,
  text: formulaValueSchema,
  editable: z.boolean().exactOptional(),
});

const linkPointSchema: z.ZodType<ShapeLinkPointDefinition> = z.strictObject({
  id: idSchema,
  x: formulaValueSchema,
  y: formulaValueSchema,
});

const portSchema: z.ZodType<ShapePortDefinition> = z.strictObject({
  id: idSchema,
  x: formulaValueSchema,
  y: formulaValueSchema,
  direction: z.enum(['in', 'out']),
  side: z.enum(['north', 'south', 'east', 'west']),
});

const areaConstraintSchema = z.strictObject({
  type: z.literal('area'),
  x: formulaValueSchema,
  y: formulaValueSchema,
  w: formulaValueSchema,
  h: formulaValueSchema,
});

const pathConstraintSchema = z.strictObject({
  type: z.literal('path'),
  points: z
    .array(polygonPointSchema)
    .max(MAX_AUTHORED_ARRAY_LENGTH),
});

const controlMoveSchema = z.strictObject({
  type: z.literal('set'),
  field: symbolSchema,
  formula: formulaValueSchema,
});

const controlSchema: z.ZodType<ShapeControlDefinition> = z.strictObject({
  id: idSchema,
  location: z.strictObject({
    x: formulaValueSchema,
    y: formulaValueSchema,
  }),
  constraint: z
    .union([areaConstraintSchema, pathConstraintSchema])
    .exactOptional(),
  onmove: z
    .array(controlMoveSchema)
    .max(MAX_AUTHORED_ARRAY_LENGTH),
});

const clipSchema: z.ZodType<ShapeClipDefinition> = z.strictObject({
  geometry: geometryArraySchema,
  stroke: formulaValueSchema.exactOptional(),
  strokeWidth: formulaValueSchema.exactOptional(),
});

const childShapeSchema: z.ZodType<ShapeChildDefinition> = z.lazy(() =>
  z.strictObject({
    ...conditionalSchema,
    id: idSchema,
    bounds: boundsSchema.exactOptional(),
    textAreas: z
      .array(textAreaSchema)
      .max(MAX_AUTHORED_ARRAY_LENGTH)
      .exactOptional(),
    linkPoints: z
      .array(linkPointSchema)
      .max(MAX_AUTHORED_ARRAY_LENGTH)
      .exactOptional(),
    ports: z
      .array(portSchema)
      .max(MAX_AUTHORED_ARRAY_LENGTH)
      .exactOptional(),
    controls: z
      .array(controlSchema)
      .max(MAX_AUTHORED_ARRAY_LENGTH)
      .exactOptional(),
    geometry: geometryArraySchema.exactOptional(),
    clip: clipSchema.exactOptional(),
    shapes: z
      .array(childShapeSchema)
      .max(MAX_AUTHORED_ARRAY_LENGTH)
      .exactOptional(),
  }),
);

const shapeDefinitionSchema: z.ZodType<ShapeDefinition> = z.strictObject({
  version: z.literal(SHAPE_DEFINITION_VERSION),
  id: idSchema,
  name: ordinaryStringSchema,
  defaultSize: z.strictObject({
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  }),
  composition: z.enum(['above', 'left', 'circle']).exactOptional(),
  properties: z
    .array(propertySchema)
    .max(MAX_AUTHORED_ARRAY_LENGTH)
    .exactOptional(),
  defs: z
    .array(nameValueSchema)
    .max(MAX_AUTHORED_ARRAY_LENGTH)
    .exactOptional(),
  textAreas: z
    .array(textAreaSchema)
    .max(MAX_AUTHORED_ARRAY_LENGTH)
    .exactOptional(),
  linkPoints: z
    .array(linkPointSchema)
    .max(MAX_AUTHORED_ARRAY_LENGTH)
    .exactOptional(),
  ports: z
    .array(portSchema)
    .max(MAX_AUTHORED_ARRAY_LENGTH)
    .exactOptional(),
  controls: z
    .array(controlSchema)
    .max(MAX_AUTHORED_ARRAY_LENGTH)
    .exactOptional(),
  geometry: geometryArraySchema.exactOptional(),
  clip: clipSchema.exactOptional(),
  shapes: z
    .array(childShapeSchema)
    .max(MAX_AUTHORED_ARRAY_LENGTH)
    .exactOptional(),
});

/** Runtime schema for declarative shape definitions. */
export const ShapeDefinitionSchema: z.ZodType<ShapeDefinition, unknown> =
  shapeDefinitionSchema;

function formatPath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? '$' : path.map(String).join('.');
}

function schemaDiagnostic(issue: ZodIssue): {
  readonly code: 'SCHEMA_INVALID';
  readonly path: string;
  readonly message: string;
} {
  return {
    code: 'SCHEMA_INVALID',
    path: formatPath(issue.path),
    message: issue.message,
  };
}

function preflightDiagnostic(
  input: unknown,
): {
  readonly code: 'SCHEMA_INVALID';
  readonly path: string;
  readonly message: string;
} | undefined {
  const pending: Array<{ readonly value: unknown; readonly path: string; readonly depth: number }> = [
    { value: input, path: '$', depth: 0 },
  ];
  const seen = new WeakSet<object>();
  let nodeCount = 0;

  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined) {
      break;
    }
    nodeCount += 1;
    if (nodeCount > MAX_AUTHORED_NODE_COUNT) {
      return {
        code: 'SCHEMA_INVALID',
        path: entry.path,
        message: `Shape definition exceeds ${MAX_AUTHORED_NODE_COUNT} authored values`,
      };
    }
    if (typeof entry.value !== 'object' || entry.value === null) {
      continue;
    }
    if (entry.depth >= MAX_AUTHORED_DEPTH) {
      return {
        code: 'SCHEMA_INVALID',
        path: entry.path,
        message: `Shape definition exceeds nesting depth ${MAX_AUTHORED_DEPTH}`,
      };
    }
    if (seen.has(entry.value)) {
      return {
        code: 'SCHEMA_INVALID',
        path: entry.path,
        message: 'Shape definitions cannot contain shared or cyclic object references',
      };
    }
    seen.add(entry.value);

    const values = Array.isArray(entry.value)
      ? entry.value.map((value, index) => [String(index), value] as const)
      : Object.entries(entry.value);
    if (values.length > MAX_AUTHORED_ARRAY_LENGTH) {
      return {
        code: 'SCHEMA_INVALID',
        path: entry.path,
        message: `Authored collections must contain at most ${MAX_AUTHORED_ARRAY_LENGTH} entries`,
      };
    }
    for (let index = values.length - 1; index >= 0; index -= 1) {
      const child = values[index];
      if (child === undefined) {
        continue;
      }
      pending.push({
        value: child[1],
        path: entry.path === '$' ? child[0] : `${entry.path}.${child[0]}`,
        depth: entry.depth + 1,
      });
    }
  }
  return undefined;
}

/** Parse and validate an unknown authored shape definition without evaluating formulas. */
export function validateShapeDefinition(input: unknown): ShapeValidationResult {
  const preflight = preflightDiagnostic(input);
  if (preflight !== undefined) {
    return { ok: false, diagnostics: [preflight] };
  }
  const parsed = ShapeDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      diagnostics: parsed.error.issues.map(schemaDiagnostic),
    };
  }

  return { ok: true, definition: parsed.data };
}
