import type { EdgeRouting, Node, OpenChartDocument } from '@openchart/ir';
import type { Operation, OperationEnvelope } from '@openchart/ops';

export type BorderPattern = 'solid' | 'dashed' | 'dotted';
export type TextAlignment = 'left' | 'center' | 'right';
export type TextStyleField =
  | 'fontWeight'
  | 'fontStyle'
  | 'fontSize'
  | 'fontFamily'
  | 'textAlign'
  | 'textColor'
  | 'underline'
  | 'lineHeight';
export type TextStyleValue = number | string | boolean;

export interface ShapeVisualStyleUpdate {
  readonly fillColor?: string;
  readonly borderColor?: string;
  readonly borderWidth?: number;
  readonly borderStyle?: BorderPattern;
  readonly cornerRadius?: number;
  readonly shadowEnabled?: boolean;
  readonly shadowStrength?: number;
  readonly opacity?: number;
}

export interface ConnectorVisualStyleUpdate {
  readonly strokeColor?: string;
  readonly lineWidth?: number;
  readonly lineStyle?: BorderPattern;
  readonly startMarker?: NonNullable<EdgeRouting['startMarker']>;
  readonly endMarker?: NonNullable<EdgeRouting['endMarker']>;
  readonly mode?: EdgeRouting['mode'];
  readonly cornerRadius?: number;
}

interface TransactionRequest { readonly txId: string; }

function operationEnvelope(document: OpenChartDocument, txId: string, operations: readonly Operation[]): OperationEnvelope | undefined {
  return operations.length === 0 ? undefined : { txId, actor: 'user', origin: 'gui', baseRev: document.rev, ops: operations };
}

function dataUpdateChanged(current: Node['data'], update: Readonly<Record<string, TextStyleValue>>): boolean {
  return Object.entries(update).some(([key, value]) => current[key] !== value);
}

export function createShapeVisualStyleTransaction(
  document: OpenChartDocument,
  nodeIds: readonly string[],
  update: ShapeVisualStyleUpdate,
  request: TransactionRequest,
): OperationEnvelope | undefined {
  const dataUpdate: Record<string, TextStyleValue> = {};
  for (const [key, value] of Object.entries(update)) {
    if (value !== undefined && (typeof value !== 'number' || Number.isFinite(value))) {
      dataUpdate[key] = value as TextStyleValue;
    }
  }
  if (Object.keys(dataUpdate).length === 0) return undefined;
  const operations = nodeIds.flatMap((id): Operation[] => {
    const node = document.nodes[id];
    if (node === undefined || !dataUpdateChanged(node.data, dataUpdate)) return [];
    return [{ op: 'set_node_data', id, data: { ...node.data, ...dataUpdate } }];
  });
  return operationEnvelope(document, request.txId, operations);
}

export function createSelectionTextStyleTransaction(
  document: OpenChartDocument,
  selectedIds: readonly string[],
  field: TextStyleField,
  value: TextStyleValue,
  request: TransactionRequest,
): OperationEnvelope | undefined {
  if (typeof value === 'number' && !Number.isFinite(value)) return undefined;
  const operations = selectedIds.flatMap((id): Operation[] => {
    const node = document.nodes[id];
    if (node !== undefined) {
      if (node.data[field] === value) return [];
      return [{ op: 'set_node_data', id, data: { ...node.data, [field]: value } }];
    }
    const edge = document.edges[id];
    if (edge === undefined || edge.data[field] === value) return [];
    return [{ op: 'set_edge_data', id, data: { ...edge.data, [field]: value } }];
  });
  return operationEnvelope(document, request.txId, operations);
}

export function createConnectorVisualStyleTransaction(
  document: OpenChartDocument,
  edgeIds: readonly string[],
  update: ConnectorVisualStyleUpdate,
  request: TransactionRequest,
): OperationEnvelope | undefined {
  const operations: Operation[] = [];
  const { strokeColor, lineWidth, lineStyle, startMarker, endMarker, mode, cornerRadius } = update;
  const usableLineWidth = lineWidth !== undefined && Number.isFinite(lineWidth) ? lineWidth : undefined;
  const usableCornerRadius = cornerRadius !== undefined && Number.isFinite(cornerRadius) ? cornerRadius : undefined;
  const routingUpdate: Partial<EdgeRouting> = {
    ...(usableLineWidth === undefined ? {} : { lineWidth: usableLineWidth }),
    ...(lineStyle === undefined ? {} : { lineStyle }),
    ...(startMarker === undefined ? {} : { startMarker }),
    ...(endMarker === undefined ? {} : { endMarker }),
    ...(mode === undefined ? {} : { mode }),
    ...(usableCornerRadius === undefined ? {} : { cornerRadius: usableCornerRadius }),
  };
  for (const id of edgeIds) {
    const edge = document.edges[id];
    if (edge === undefined) continue;
    if (strokeColor !== undefined && edge.data.strokeColor !== strokeColor) {
      operations.push({ op: 'set_edge_data', id, data: { ...edge.data, strokeColor } });
    }
    if (Object.keys(routingUpdate).length > 0) {
      const changed = Object.entries(routingUpdate).some(([key, value]) => edge.routing?.[key as keyof EdgeRouting] !== value);
      if (changed) {
        operations.push({
          op: 'set_edge_routing',
          id,
          routing: { ...edge.routing, mode: mode ?? edge.routing?.mode ?? 'orthogonal', ...routingUpdate },
        });
      }
    }
  }
  return operationEnvelope(document, request.txId, operations);
}

