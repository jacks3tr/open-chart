export const SHAPE_DEFINITION_VERSION = 1 as const;

export type ShapeComposition = 'above' | 'left' | 'circle';
export type ShapeAnchor =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';

export type ShapeDataValue =
  | null
  | boolean
  | number
  | string
  | readonly ShapeDataValue[]
  | { readonly [key: string]: ShapeDataValue };

/** Strings beginning with `=` are formulas; every other value is literal. */
export type ShapeFormulaValue = ShapeDataValue;

export interface ShapeFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ShapePoint {
  readonly x: number;
  readonly y: number;
}

export interface ShapeBoundsDefinition {
  readonly x?: ShapeFormulaValue;
  readonly y?: ShapeFormulaValue;
  readonly w?: ShapeFormulaValue;
  readonly h?: ShapeFormulaValue;
  /** Any combination of x, y, w, and h marks those components as pixels. */
  readonly absolute?: string;
  readonly anchor?: ShapeAnchor;
  readonly rotation?: ShapeFormulaValue;
}

export interface ShapeDefinitionValue {
  readonly name: string;
  readonly value: ShapeFormulaValue;
}

export interface ShapePropertyConstraint {
  readonly condition: ShapeFormulaValue;
  readonly resolution?: ShapeFormulaValue;
  readonly message?: string;
}

export type ShapePropertyType =
  | 'number'
  | 'string'
  | 'color'
  | 'date'
  | 'boolean'
  | 'array'
  | 'object'
  | 'formula'
  | 'picklist';

export interface ShapePropertyDefinition {
  readonly name: string;
  readonly label?: string;
  readonly type: ShapePropertyType;
  readonly default?: ShapeFormulaValue;
  readonly options?: readonly ShapeDataValue[];
  readonly constraints?: readonly ShapePropertyConstraint[];
}

export interface ShapeForRepeat {
  readonly type: 'for';
  readonly min: ShapeFormulaValue;
  readonly max: ShapeFormulaValue;
  readonly index?: string;
}

export interface ShapeMapRepeat {
  readonly type: 'map';
  readonly source: ShapeFormulaValue;
  readonly index?: string;
  readonly value?: string;
}

export type ShapeRepeatDefinition = ShapeForRepeat | ShapeMapRepeat;

interface ShapeConditionalDefinition {
  readonly condition?: ShapeFormulaValue;
  readonly repeat?: ShapeRepeatDefinition;
  readonly defs?: readonly ShapeDefinitionValue[];
}

interface ShapePaintDefinition {
  readonly fill?: ShapeFormulaValue;
  readonly fillOpacity?: ShapeFormulaValue;
  readonly stroke?: ShapeFormulaValue;
  readonly strokeOpacity?: ShapeFormulaValue;
  readonly strokeWidth?: ShapeFormulaValue;
  readonly dash?: readonly ShapeFormulaValue[];
}

interface ShapeBoxGeometryDefinition
  extends ShapeConditionalDefinition,
    ShapePaintDefinition {
  readonly id: string;
  readonly x?: ShapeFormulaValue;
  readonly y?: ShapeFormulaValue;
  readonly w?: ShapeFormulaValue;
  readonly h?: ShapeFormulaValue;
}

export interface ShapeRectGeometryDefinition extends ShapeBoxGeometryDefinition {
  readonly type: 'rect';
  readonly radius?: ShapeFormulaValue;
}

export interface ShapeEllipseGeometryDefinition extends ShapeBoxGeometryDefinition {
  readonly type: 'ellipse';
}

export interface ShapePolygonGeometryDefinition
  extends ShapeConditionalDefinition,
    ShapePaintDefinition {
  readonly id: string;
  readonly type: 'polygon';
  readonly points: readonly {
    readonly x: ShapeFormulaValue;
    readonly y: ShapeFormulaValue;
  }[];
}

export type ShapePathCommandDefinition =
  | {
      readonly type: 'move' | 'line';
      readonly x: ShapeFormulaValue;
      readonly y: ShapeFormulaValue;
    }
  | {
      readonly type: 'quadratic';
      readonly cx: ShapeFormulaValue;
      readonly cy: ShapeFormulaValue;
      readonly x: ShapeFormulaValue;
      readonly y: ShapeFormulaValue;
    }
  | {
      readonly type: 'cubic';
      readonly c1x: ShapeFormulaValue;
      readonly c1y: ShapeFormulaValue;
      readonly c2x: ShapeFormulaValue;
      readonly c2y: ShapeFormulaValue;
      readonly x: ShapeFormulaValue;
      readonly y: ShapeFormulaValue;
    }
  | { readonly type: 'close' };

export interface ShapePathGeometryDefinition
  extends ShapeConditionalDefinition,
    ShapePaintDefinition {
  readonly id: string;
  readonly type: 'path';
  readonly commands: readonly ShapePathCommandDefinition[];
}

export interface ShapeBooleanGeometryDefinition
  extends ShapeConditionalDefinition,
    ShapePaintDefinition {
  readonly id: string;
  readonly type: 'boolean';
  readonly operation: 'union' | 'intersection' | 'difference' | 'xor';
  readonly geometry: readonly ShapeGeometryDefinition[];
}

export type ShapeGeometryDefinition =
  | ShapeRectGeometryDefinition
  | ShapeEllipseGeometryDefinition
  | ShapePolygonGeometryDefinition
  | ShapePathGeometryDefinition
  | ShapeBooleanGeometryDefinition;

export interface ShapeTextAreaDefinition {
  readonly id: string;
  readonly bounds: ShapeBoundsDefinition;
  readonly text: ShapeFormulaValue;
  readonly editable?: boolean;
}

export interface ShapeLinkPointDefinition {
  readonly id: string;
  readonly x: ShapeFormulaValue;
  readonly y: ShapeFormulaValue;
}

export interface ShapePortDefinition extends ShapeLinkPointDefinition {
  readonly direction: 'in' | 'out';
  readonly side: 'north' | 'south' | 'east' | 'west';
}

export interface ShapeControlDefinition {
  readonly id: string;
  readonly location: {
    readonly x: ShapeFormulaValue;
    readonly y: ShapeFormulaValue;
  };
  readonly constraint?:
    | {
        readonly type: 'area';
        readonly x: ShapeFormulaValue;
        readonly y: ShapeFormulaValue;
        readonly w: ShapeFormulaValue;
        readonly h: ShapeFormulaValue;
      }
    | {
        readonly type: 'path';
        readonly points: readonly {
          readonly x: ShapeFormulaValue;
          readonly y: ShapeFormulaValue;
        }[];
      };
  readonly onmove: readonly {
    readonly type: 'set';
    readonly field: string;
    readonly formula: ShapeFormulaValue;
  }[];
}

export interface ShapeClipDefinition {
  readonly geometry: readonly ShapeGeometryDefinition[];
  readonly stroke?: ShapeFormulaValue;
  readonly strokeWidth?: ShapeFormulaValue;
}

export interface ShapeChildDefinition extends ShapeConditionalDefinition {
  readonly id: string;
  readonly bounds?: ShapeBoundsDefinition;
  readonly textAreas?: readonly ShapeTextAreaDefinition[];
  readonly linkPoints?: readonly ShapeLinkPointDefinition[];
  readonly ports?: readonly ShapePortDefinition[];
  readonly controls?: readonly ShapeControlDefinition[];
  readonly geometry?: readonly ShapeGeometryDefinition[];
  readonly clip?: ShapeClipDefinition;
  readonly shapes?: readonly ShapeChildDefinition[];
}

export interface ShapeDefinition {
  readonly version: typeof SHAPE_DEFINITION_VERSION;
  readonly id: string;
  readonly name: string;
  readonly defaultSize: {
    readonly width: number;
    readonly height: number;
  };
  readonly composition?: ShapeComposition;
  readonly properties?: readonly ShapePropertyDefinition[];
  readonly defs?: readonly ShapeDefinitionValue[];
  readonly textAreas?: readonly ShapeTextAreaDefinition[];
  readonly linkPoints?: readonly ShapeLinkPointDefinition[];
  readonly ports?: readonly ShapePortDefinition[];
  readonly controls?: readonly ShapeControlDefinition[];
  readonly geometry?: readonly ShapeGeometryDefinition[];
  readonly clip?: ShapeClipDefinition;
  readonly shapes?: readonly ShapeChildDefinition[];
}

export interface EvaluatedShapeBounds extends ShapeFrame {
  readonly rotation: number;
  readonly rotationOrigin: ShapePoint;
}

interface EvaluatedPaint {
  readonly fill?: string;
  readonly fillOpacity?: number;
  readonly stroke?: string;
  readonly strokeOpacity?: number;
  readonly strokeWidth?: number;
  readonly dash?: readonly number[];
}

export interface EvaluatedRectGeometry extends EvaluatedPaint {
  readonly id: string;
  readonly type: 'rect';
  readonly frame: ShapeFrame;
  readonly radius?: number;
}

export interface EvaluatedEllipseGeometry extends EvaluatedPaint {
  readonly id: string;
  readonly type: 'ellipse';
  readonly frame: ShapeFrame;
}

export interface EvaluatedPolygonGeometry extends EvaluatedPaint {
  readonly id: string;
  readonly type: 'polygon';
  readonly points: readonly ShapePoint[];
}

export type EvaluatedPathCommand =
  | { readonly type: 'move' | 'line'; readonly to: ShapePoint }
  | {
      readonly type: 'quadratic';
      readonly control: ShapePoint;
      readonly to: ShapePoint;
    }
  | {
      readonly type: 'cubic';
      readonly control1: ShapePoint;
      readonly control2: ShapePoint;
      readonly to: ShapePoint;
    }
  | { readonly type: 'close' };

export interface EvaluatedPathGeometry extends EvaluatedPaint {
  readonly id: string;
  readonly type: 'path';
  readonly commands: readonly EvaluatedPathCommand[];
}

export interface EvaluatedBooleanGeometry extends EvaluatedPaint {
  readonly id: string;
  readonly type: 'boolean';
  readonly operation: ShapeBooleanGeometryDefinition['operation'];
  readonly geometry: readonly EvaluatedGeometry[];
}

export type EvaluatedGeometry =
  | EvaluatedRectGeometry
  | EvaluatedEllipseGeometry
  | EvaluatedPolygonGeometry
  | EvaluatedPathGeometry
  | EvaluatedBooleanGeometry;

export interface EvaluatedTextArea {
  readonly id: string;
  readonly frame: ShapeFrame;
  readonly text: string;
  readonly editable: boolean;
}

export interface EvaluatedLinkPoint {
  readonly id: string;
  readonly point: ShapePoint;
}

export interface EvaluatedPort extends EvaluatedLinkPoint {
  readonly direction: ShapePortDefinition['direction'];
  readonly side: ShapePortDefinition['side'];
}

export interface EvaluatedControl {
  readonly id: string;
  readonly point: ShapePoint;
  readonly constraint?:
    | { readonly type: 'area'; readonly frame: ShapeFrame }
    | { readonly type: 'path'; readonly points: readonly ShapePoint[] };
  readonly onmove: ShapeControlDefinition['onmove'];
}

export interface EvaluatedClip {
  readonly geometry: readonly EvaluatedGeometry[];
  readonly stroke?: string;
  readonly strokeWidth?: number;
}

export interface EvaluatedShapeNode {
  readonly id: string;
  readonly bounds: EvaluatedShapeBounds;
  readonly geometry: readonly EvaluatedGeometry[];
  readonly textAreas: readonly EvaluatedTextArea[];
  readonly linkPoints: readonly EvaluatedLinkPoint[];
  readonly ports: readonly EvaluatedPort[];
  readonly controls: readonly EvaluatedControl[];
  readonly children: readonly EvaluatedShapeNode[];
  readonly clip?: EvaluatedClip;
}

export interface EvaluatedShape extends EvaluatedShapeNode {
  readonly definitionId: string;
  readonly name: string;
  readonly composition: ShapeComposition;
  readonly data: Readonly<Record<string, ShapeDataValue>>;
}

export type ShapeDiagnosticCode =
  | 'SCHEMA_INVALID'
  | 'FORMULA_INVALID'
  | 'PROPERTY_INVALID'
  | 'CONSTRAINT_FAILED'
  | 'DUPLICATE_ID';

export interface ShapeDiagnostic {
  readonly code: ShapeDiagnosticCode;
  readonly path: string;
  readonly message: string;
}

export interface ShapeEvaluationOptions {
  readonly frame?: ShapeFrame;
  readonly data?: Readonly<Record<string, ShapeDataValue>>;
}

export type ShapeEvaluationResult =
  | { readonly ok: true; readonly shape: EvaluatedShape }
  | { readonly ok: false; readonly diagnostics: readonly ShapeDiagnostic[] };

export type ShapeValidationResult =
  | { readonly ok: true; readonly definition: ShapeDefinition }
  | { readonly ok: false; readonly diagnostics: readonly ShapeDiagnostic[] };
