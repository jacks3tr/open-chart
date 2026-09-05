import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import arrowClockwiseIcon from '@phosphor-icons/core/regular/arrow-clockwise.svg';
import arrowCounterClockwiseIcon from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg';
import arrowDownIcon from '@phosphor-icons/core/regular/arrow-down.svg';
import arrowUpIcon from '@phosphor-icons/core/regular/arrow-up.svg';
import arrowsSplitIcon from '@phosphor-icons/core/regular/arrows-split.svg';
import bracketsCurlyIcon from '@phosphor-icons/core/regular/brackets-curly.svg';
import circleIcon from '@phosphor-icons/core/regular/circle.svg';
import cloudCheckIcon from '@phosphor-icons/core/regular/cloud-check.svg';
import cloudIcon from '@phosphor-icons/core/regular/cloud.svg';
import codeIcon from '@phosphor-icons/core/regular/code.svg';
import cursorIcon from '@phosphor-icons/core/regular/cursor.svg';
import cylinderIcon from '@phosphor-icons/core/regular/cylinder.svg';
import databaseIcon from '@phosphor-icons/core/regular/database.svg';
import diamondIcon from '@phosphor-icons/core/regular/diamond.svg';
import dotsThreeIcon from '@phosphor-icons/core/regular/dots-three.svg';
import downloadIcon from '@phosphor-icons/core/regular/download-simple.svg';
import eyeIcon from '@phosphor-icons/core/regular/eye.svg';
import eyeSlashIcon from '@phosphor-icons/core/regular/eye-slash.svg';
import fileIcon from '@phosphor-icons/core/regular/file.svg';
import flowArrowIcon from '@phosphor-icons/core/regular/flow-arrow.svg';
import handIcon from '@phosphor-icons/core/regular/hand.svg';
import hexagonIcon from '@phosphor-icons/core/regular/hexagon.svg';
import keyboardIcon from '@phosphor-icons/core/regular/keyboard.svg';
import lassoIcon from '@phosphor-icons/core/regular/lasso.svg';
import layoutIcon from '@phosphor-icons/core/regular/layout.svg';
import linkSimpleIcon from '@phosphor-icons/core/regular/link-simple.svg';
import lockIcon from '@phosphor-icons/core/regular/lock.svg';
import lockOpenIcon from '@phosphor-icons/core/regular/lock-open.svg';
import magnifyingGlassIcon from '@phosphor-icons/core/regular/magnifying-glass.svg';
import minusIcon from '@phosphor-icons/core/regular/minus.svg';
import noteIcon from '@phosphor-icons/core/regular/note.svg';
import networkIcon from '@phosphor-icons/core/regular/network.svg';
import parallelogramIcon from '@phosphor-icons/core/regular/parallelogram.svg';
import plusIcon from '@phosphor-icons/core/regular/plus.svg';
import projectorIcon from '@phosphor-icons/core/regular/projector-screen-chart.svg';
import rectangleIcon from '@phosphor-icons/core/regular/rectangle.svg';
import rowsIcon from '@phosphor-icons/core/regular/rows.svg';
import shieldCheckIcon from '@phosphor-icons/core/regular/shield-check.svg';
import shapesIcon from '@phosphor-icons/core/regular/shapes.svg';
import sidebarIcon from '@phosphor-icons/core/regular/sidebar-simple.svg';
import sparkleIcon from '@phosphor-icons/core/regular/sparkle.svg';
import stackIcon from '@phosphor-icons/core/regular/stack.svg';
import textIcon from '@phosphor-icons/core/regular/text-t.svg';
import timerIcon from '@phosphor-icons/core/regular/timer.svg';
import treeIcon from '@phosphor-icons/core/regular/tree-structure.svg';
import userIcon from '@phosphor-icons/core/regular/user.svg';
import xIcon from '@phosphor-icons/core/regular/x.svg';
import { hitTestConnector } from '@openchart/connectors';
import {
  compileTokenOperations,
  reconcileContainers,
  TOKEN_PRESET_IDS,
  TOKEN_PRESETS,
  type LayoutMode,
  type TokenPresetId,
} from '@openchart/derive';
import {
  WINDOWS_COMMANDS,
  clearSelection,
  createClipboardPayload,
  createPasteStyleTransaction,
  createPasteTransaction,
  createSelectionState,
  createTransformTransaction,
  enterSelectionScope,
  exitSelectionScope,
  resizeSelection,
  resolveShortcut,
  rotateSelection,
  searchCommands,
  selectAll,
  selectAt,
  selectLasso,
  selectMarquee,
  snapBounds,
  translateSelection,
  type AlignmentGuide,
  type ClipboardPayload,
  type CommandDefinition,
  type InteractionPoint,
  type InteractionRect,
  type ResizeHandle,
  type SelectableItem,
  type SelectionState,
  type TransformFrame,
  type TransformPreview,
} from '@openchart/interact';
import type { Edge, EdgeLayoutOverride, Node, OpenChartDocument, Page, Port } from '@openchart/ir';
import { OperationEngine, type Operation, type OperationEnvelope } from '@openchart/ops';
import {
  SceneViewportRenderer,
  type CameraState,
} from '@openchart/render';
import {
  buildSceneDescription,
  type SceneConnectorGeometry,
  type SceneDescription,
  type ScenePathCommand,
} from '@openchart/scene';
import { renderSceneToSvg } from '@openchart/serialize';
import {
  evaluateShapeDefinition,
  type EvaluatedGeometry,
  type EvaluatedPathCommand,
} from '@openchart/shapes';
import {
  DECORATIVE_SHAPE_LIBRARY_SUMMARIES,
  getShapeLibraryEntry as getBuiltinShapeLibraryEntry,
  isDecorativeShapeLibraryId,
  listShapeLibraries as listBuiltinShapeLibraries,
  resolveLibraryShape as resolveBuiltinLibraryShape,
  searchShapeLibraries as searchBuiltinShapeLibraries,
} from '@openchart/shapes/libraries-core';
import type {
  ResolveLibraryShapeResult,
  ShapeLibraryEntry,
  ShapeLibrarySearchResult,
} from '@openchart/shapes/libraries';

import {
  isDesktopRuntime,
  openDesktopDocument,
  parseDesktopDocument,
  saveDesktopDocument,
  serializeOpenChartDocument,
  writeDesktopDocument,
} from './desktop-file.js';
import { createOpenChartPageImportTransaction } from './document-import.js';
import { disposeLayoutWorker, requestBeautyPass, requestLayout } from './layout-worker-client.js';
import { createEditorRasterCaches, paintCanvasLayer } from './canvas-layer.js';
import {
  loadBrowserTextExport,
  loadFullShapeCatalog,
  loadStarterTemplates,
  type FullShapeCatalogModule,
  type StarterTemplatesModule,
} from './lazy-features.js';
import { LiveDocumentSession } from './live-document-session.js';
import {
  createConnectorVisualStyleTransaction,
  createSelectionTextStyleTransaction,
  createShapeVisualStyleTransaction,
  type ConnectorVisualStyleUpdate,
  type ShapeVisualStyleUpdate,
} from './selection-styling.js';
import type { StarterTemplateId } from './starter-templates.js';

export interface OpenChartEditorProps {
  readonly initialDocument: OpenChartDocument;
}

type EditorTool = 'select' | 'connector' | 'pan' | 'lasso';
type ConnectorSide = 'north' | 'east' | 'south' | 'west';
type InspectorTab = 'design' | 'layers';
export type BrowserExportFormat = 'svg' | 'png' | 'jpeg' | 'd2' | 'mermaid';
type BrowserExportScale = 1 | 2 | 4;
type InsertNodeKind = 'service' | 'system' | 'database' | 'control' | 'container' | 'text';

interface ShapePaletteItem {
  readonly label: string;
  readonly kind: InsertNodeKind;
  readonly icon: string;
  readonly shape?: {
    readonly libraryId: string;
    readonly entryId: string;
  };
  readonly size?: {
    readonly width: number;
    readonly height: number;
  };
}

export interface CatalogShapeRef {
  readonly libraryId: string;
  readonly entryId: string;
}

const SHAPE_PALETTE: ReadonlyArray<{
  readonly label: string;
  readonly items: readonly ShapePaletteItem[];
}> = [
  {
    label: 'Essentials',
    items: [
      { label: 'Text', kind: 'text', icon: textIcon },
      { label: 'System boundary', kind: 'container', icon: rectangleIcon },
      { label: 'Note', kind: 'control', icon: noteIcon, shape: { libraryId: 'generic', entryId: 'generic.document' } },
      { label: 'Actor', kind: 'control', icon: userIcon, shape: { libraryId: 'generic', entryId: 'generic.user' } },
      { label: 'External system', kind: 'system', icon: bracketsCurlyIcon, shape: { libraryId: 'generic', entryId: 'generic.external-system' } },
      { label: 'Cloud', kind: 'service', icon: cloudIcon, shape: { libraryId: 'generic', entryId: 'generic.cloud' } },
    ],
  },
  {
    label: 'Flowchart',
    items: [
      { label: 'Process', kind: 'system', icon: rectangleIcon, shape: { libraryId: 'flowchart', entryId: 'flowchart.process' } },
      { label: 'Decision', kind: 'control', icon: diamondIcon, shape: { libraryId: 'flowchart', entryId: 'flowchart.decision' }, size: { width: 160, height: 120 } },
      { label: 'Start / End', kind: 'service', icon: circleIcon, shape: { libraryId: 'flowchart', entryId: 'flowchart.terminator' } },
      { label: 'Data', kind: 'control', icon: parallelogramIcon, shape: { libraryId: 'flowchart', entryId: 'flowchart.data' } },
      { label: 'Document', kind: 'control', icon: noteIcon, shape: { libraryId: 'flowchart', entryId: 'flowchart.document' } },
      { label: 'Stored data', kind: 'database', icon: cylinderIcon, shape: { libraryId: 'flowchart', entryId: 'flowchart.database' } },
      { label: 'Preparation', kind: 'control', icon: hexagonIcon, shape: { libraryId: 'flowchart', entryId: 'flowchart.preparation' } },
      { label: 'Manual input', kind: 'control', icon: parallelogramIcon, shape: { libraryId: 'flowchart', entryId: 'flowchart.manual-input' } },
      { label: 'Connector', kind: 'control', icon: circleIcon, shape: { libraryId: 'flowchart', entryId: 'flowchart.connector' }, size: { width: 72, height: 72 } },
      { label: 'Delay', kind: 'control', icon: timerIcon, shape: { libraryId: 'flowchart', entryId: 'flowchart.delay' } },
    ],
  },
  {
    label: 'Integration',
    items: [
      { label: 'API gateway', kind: 'control', icon: codeIcon, shape: { libraryId: 'integration', entryId: 'integration.api-gateway' } },
      { label: 'Service', kind: 'service', icon: flowArrowIcon, shape: { libraryId: 'integration', entryId: 'integration.service' } },
      { label: 'Queue', kind: 'service', icon: rowsIcon, shape: { libraryId: 'integration', entryId: 'integration.queue' } },
      { label: 'Topic', kind: 'service', icon: circleIcon, shape: { libraryId: 'integration', entryId: 'integration.topic' } },
      { label: 'Event bus', kind: 'service', icon: arrowsSplitIcon, shape: { libraryId: 'integration', entryId: 'integration.event-bus' } },
      { label: 'Stream', kind: 'service', icon: flowArrowIcon, shape: { libraryId: 'integration', entryId: 'integration.stream' } },
      { label: 'Function', kind: 'service', icon: hexagonIcon, shape: { libraryId: 'integration', entryId: 'integration.function' } },
      { label: 'Database', kind: 'database', icon: databaseIcon, shape: { libraryId: 'integration', entryId: 'integration.database' } },
      { label: 'Cache', kind: 'database', icon: cylinderIcon, shape: { libraryId: 'integration', entryId: 'integration.cache' } },
      { label: 'Webhook', kind: 'control', icon: linkSimpleIcon, shape: { libraryId: 'integration', entryId: 'integration.webhook' } },
      { label: 'External SaaS', kind: 'service', icon: cloudIcon, shape: { libraryId: 'integration', entryId: 'integration.external-saas' } },
      { label: 'Client', kind: 'service', icon: projectorIcon, shape: { libraryId: 'integration', entryId: 'integration.client' } },
    ],
  },
  {
    label: 'Architecture',
    items: [
      { label: 'Architecture app', kind: 'service', icon: projectorIcon, shape: { libraryId: 'architecture', entryId: 'architecture.application' } },
      { label: 'Microservice', kind: 'service', icon: flowArrowIcon, shape: { libraryId: 'architecture', entryId: 'architecture.microservice' } },
      { label: 'Architecture API gateway', kind: 'control', icon: codeIcon, shape: { libraryId: 'architecture', entryId: 'architecture.api-gateway' } },
      { label: 'Architecture cloud', kind: 'system', icon: cloudIcon, shape: { libraryId: 'architecture', entryId: 'architecture.cloud' } },
      { label: 'Kubernetes cluster', kind: 'system', icon: networkIcon, shape: { libraryId: 'architecture', entryId: 'architecture.kubernetes-cluster' }, size: { width: 260, height: 170 } },
      { label: 'Trust boundary', kind: 'system', icon: shieldCheckIcon, shape: { libraryId: 'architecture', entryId: 'architecture.trust-boundary' }, size: { width: 260, height: 170 } },
    ],
  },
  {
    label: 'Cloud',
    items: [
      { label: 'AWS EC2', kind: 'service', icon: projectorIcon, shape: { libraryId: 'aws', entryId: 'aws.ec2' } },
      { label: 'AWS S3', kind: 'database', icon: cylinderIcon, shape: { libraryId: 'aws', entryId: 'aws.s3' } },
      { label: 'AWS SQS', kind: 'service', icon: rowsIcon, shape: { libraryId: 'aws', entryId: 'aws.sqs' } },
      { label: 'AWS Lambda', kind: 'service', icon: hexagonIcon, shape: { libraryId: 'aws', entryId: 'aws.lambda' } },
      { label: 'Azure VM', kind: 'service', icon: projectorIcon, shape: { libraryId: 'azure', entryId: 'azure.virtual-machine' } },
      { label: 'Azure Blob Storage', kind: 'database', icon: cylinderIcon, shape: { libraryId: 'azure', entryId: 'azure.blob-storage' } },
      { label: 'Azure Service Bus', kind: 'service', icon: rowsIcon, shape: { libraryId: 'azure', entryId: 'azure.service-bus' } },
      { label: 'Azure Functions', kind: 'service', icon: hexagonIcon, shape: { libraryId: 'azure', entryId: 'azure.functions' } },
      { label: 'GCP Compute Engine', kind: 'service', icon: projectorIcon, shape: { libraryId: 'gcp', entryId: 'gcp.compute-engine' } },
      { label: 'GCP Cloud Storage', kind: 'database', icon: cylinderIcon, shape: { libraryId: 'gcp', entryId: 'gcp.cloud-storage' } },
      { label: 'GCP Pub/Sub', kind: 'service', icon: rowsIcon, shape: { libraryId: 'gcp', entryId: 'gcp.pub-sub' } },
      { label: 'GCP Cloud Functions', kind: 'service', icon: hexagonIcon, shape: { libraryId: 'gcp', entryId: 'gcp.cloud-functions' } },
    ],
  },
  {
    label: 'BPMN',
    items: [
      { label: 'BPMN Start event', kind: 'control', icon: circleIcon, shape: { libraryId: 'bpmn', entryId: 'bpmn.start-event' }, size: { width: 72, height: 72 } },
      { label: 'BPMN Task', kind: 'service', icon: rectangleIcon, shape: { libraryId: 'bpmn', entryId: 'bpmn.task' } },
      { label: 'BPMN User task', kind: 'service', icon: userIcon, shape: { libraryId: 'bpmn', entryId: 'bpmn.user-task' } },
      { label: 'BPMN Exclusive gateway', kind: 'control', icon: diamondIcon, shape: { libraryId: 'bpmn', entryId: 'bpmn.exclusive-gateway' }, size: { width: 96, height: 96 } },
      { label: 'BPMN Parallel gateway', kind: 'control', icon: plusIcon, shape: { libraryId: 'bpmn', entryId: 'bpmn.parallel-gateway' }, size: { width: 96, height: 96 } },
      { label: 'BPMN Pool', kind: 'system', icon: rowsIcon, shape: { libraryId: 'bpmn', entryId: 'bpmn.pool-container' }, size: { width: 360, height: 220 } },
    ],
  },
  {
    label: 'UML',
    items: [
      { label: 'UML Class', kind: 'control', icon: rectangleIcon, shape: { libraryId: 'uml', entryId: 'uml.class' } },
      { label: 'UML Interface', kind: 'control', icon: rectangleIcon, shape: { libraryId: 'uml', entryId: 'uml.interface' } },
      { label: 'UML Actor', kind: 'control', icon: userIcon, shape: { libraryId: 'uml', entryId: 'uml.actor' } },
      { label: 'UML Use case', kind: 'control', icon: circleIcon, shape: { libraryId: 'uml', entryId: 'uml.use-case' } },
      { label: 'UML Component', kind: 'service', icon: stackIcon, shape: { libraryId: 'uml', entryId: 'uml.component-node' } },
      { label: 'UML Deployment node', kind: 'system', icon: projectorIcon, shape: { libraryId: 'uml', entryId: 'uml.deployment-node-3d' } },
    ],
  },
  {
    label: 'ERD',
    items: [
      { label: 'ERD Entity', kind: 'database', icon: rectangleIcon, shape: { libraryId: 'erd', entryId: 'erd.entity' } },
      { label: 'ERD Weak entity', kind: 'database', icon: rectangleIcon, shape: { libraryId: 'erd', entryId: 'erd.weak-entity' } },
      { label: 'ERD Relationship', kind: 'control', icon: diamondIcon, shape: { libraryId: 'erd', entryId: 'erd.relationship' } },
      { label: 'ERD Attribute', kind: 'control', icon: circleIcon, shape: { libraryId: 'erd', entryId: 'erd.attribute' } },
      { label: 'ERD Associative entity', kind: 'database', icon: stackIcon, shape: { libraryId: 'erd', entryId: 'erd.associative-entity' } },
      { label: 'ERD Supertype', kind: 'database', icon: treeIcon, shape: { libraryId: 'erd', entryId: 'erd.supertype' } },
    ],
  },
  {
    label: 'Network',
    items: [
      { label: 'Router', kind: 'service', icon: treeIcon, shape: { libraryId: 'network', entryId: 'network.router' }, size: { width: 112, height: 112 } },
      { label: 'Switch', kind: 'service', icon: rowsIcon, shape: { libraryId: 'network', entryId: 'network.switch' } },
      { label: 'Firewall', kind: 'control', icon: shieldCheckIcon, shape: { libraryId: 'network', entryId: 'network.firewall' } },
      { label: 'Load balancer', kind: 'service', icon: arrowsSplitIcon, shape: { libraryId: 'network', entryId: 'network.load-balancer' } },
      { label: 'Server', kind: 'service', icon: projectorIcon, shape: { libraryId: 'network', entryId: 'network.server' } },
      { label: 'Workstation', kind: 'service', icon: projectorIcon, shape: { libraryId: 'network', entryId: 'network.workstation' } },
      { label: 'Cloud network', kind: 'system', icon: networkIcon, shape: { libraryId: 'network', entryId: 'network.cloud' } },
      { label: 'Internet', kind: 'system', icon: cloudIcon, shape: { libraryId: 'network', entryId: 'network.internet' } },
      { label: 'VPN', kind: 'control', icon: shieldCheckIcon, shape: { libraryId: 'network', entryId: 'network.vpn' } },
      { label: 'Gateway', kind: 'control', icon: flowArrowIcon, shape: { libraryId: 'network', entryId: 'network.gateway' } },
      { label: 'Subnet', kind: 'system', icon: bracketsCurlyIcon, shape: { libraryId: 'network', entryId: 'network.subnet' }, size: { width: 240, height: 160 } },
      { label: 'DNS', kind: 'database', icon: databaseIcon, shape: { libraryId: 'network', entryId: 'network.dns' } },
    ],
  },
];

const CONNECT_CREATE_SHAPE: ShapePaletteItem = {
  label: 'Process',
  kind: 'system',
  icon: rectangleIcon,
  shape: { libraryId: 'flowchart', entryId: 'flowchart.process' },
};

export interface EditorPreferences {
  readonly exportFormat: BrowserExportFormat;
  readonly exportScale: BrowserExportScale;
  readonly canvasNavigation: boolean;
  readonly recentShapes: readonly CatalogShapeRef[];
  readonly favoriteShapes: readonly CatalogShapeRef[];
}

interface EditorCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

interface CameraBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

type TextEditState =
  | {
      readonly kind: 'node';
      readonly id: string;
      readonly value: string;
    }
  | {
      readonly kind: 'edge';
      readonly id: string;
      readonly value: string;
      readonly labelT: number;
    };

interface SnapVisuals {
  readonly guides: readonly AlignmentGuide[];
  readonly coordinates?: InteractionPoint;
}

export interface ConnectorPortHit {
  readonly nodeId: string;
  readonly side: ConnectorSide;
  readonly point: InteractionPoint;
}

interface ConnectorDragPreview {
  readonly from: InteractionPoint;
  readonly to: InteractionPoint;
  readonly target?: ConnectorPortHit;
}

type Gesture =
  | {
      readonly mode: 'move';
      readonly startWorld: InteractionPoint;
      readonly selectedIds: readonly string[];
    }
  | {
      readonly mode: 'resize';
      readonly startWorld: InteractionPoint;
      readonly selectedIds: readonly string[];
      readonly handle: ResizeHandle;
    }
  | {
      readonly mode: 'rotate';
      readonly center: InteractionPoint;
      readonly startAngle: number;
      readonly selectedIds: readonly string[];
    }
  | {
      readonly mode: 'marquee';
      readonly startWorld: InteractionPoint;
    }
  | {
      readonly mode: 'lasso';
      readonly points: readonly InteractionPoint[];
    }
  | {
      readonly mode: 'pan';
      readonly startClient: InteractionPoint;
      readonly camera: EditorCamera;
    }
  | {
      readonly mode: 'waypoint';
      readonly edgeId: string;
      readonly waypointIndex: number;
      readonly startPointer: InteractionPoint;
      readonly current: InteractionPoint;
      readonly moved: boolean;
    }
  | {
      readonly mode: 'edge-label';
      readonly edgeId: string;
      readonly startPointer: InteractionPoint;
      readonly current: InteractionPoint;
      readonly labelT: number;
      readonly moved: boolean;
    }
  | {
      readonly mode: 'edge-segment';
      readonly edgeId: string;
      readonly segmentIndex: number;
      readonly startPointer: InteractionPoint;
      readonly current: InteractionPoint;
      readonly moved: boolean;
    }
  | {
      readonly mode: 'connector-create';
      readonly source: ConnectorPortHit;
      readonly startPointer: InteractionPoint;
      readonly current: InteractionPoint;
      readonly target?: ConnectorPortHit;
      readonly moved: boolean;
    }
  | {
      readonly mode: 'connector-reconnect';
      readonly edgeId: string;
      readonly endpoint: 'from' | 'to';
      readonly fixed: InteractionPoint;
      readonly startPointer: InteractionPoint;
      readonly current: InteractionPoint;
      readonly target?: ConnectorPortHit;
      readonly moved: boolean;
    };

const UID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const DEFAULT_NODE_SIZE: Readonly<Record<string, { readonly width: number; readonly height: number }>> = {
  system: { width: 310, height: 230 },
  service: { width: 300, height: 154 },
  database: { width: 300, height: 154 },
  control: { width: 310, height: 128 },
  container: { width: 420, height: 280 },
  text: { width: 260, height: 72 },
};

const LIBRARY_TONES: Readonly<Record<string, string>> = {
  generic: '#2563EB',
  flowchart: '#B45309',
  integration: '#00A7A5',
  network: '#7C3AED',
  aws: '#FF9900',
  azure: '#0078D4',
  gcp: '#4285F4',
  'simple-icons': '#475569',
  phosphor: '#64748B',
};

const SHAPE_LIBRARIES = [
  ...listBuiltinShapeLibraries().map((library) => ({
    id: library.id,
    label: library.name,
    count: library.entries.length,
    tone: LIBRARY_TONES[library.id] ?? '#64748B',
    kind: 'diagram' as const,
  })),
  ...DECORATIVE_SHAPE_LIBRARY_SUMMARIES.map((library) => ({
    id: library.id,
    label: library.name,
    count: library.count,
    tone: LIBRARY_TONES[library.id] ?? '#64748B',
    kind: 'icon' as const,
  })),
];
const SHAPE_LIBRARY_TOTAL = SHAPE_LIBRARIES.reduce((total, library) => total + library.count, 0);

function shapeKind(result: ShapeLibrarySearchResult): InsertNodeKind {
  const terms = `${result.entry.id} ${result.entry.tags.join(' ')}`;
  if (/database|storage|cache|dns/.test(terms)) {
    return 'database';
  }
  if (/boundary|container|subnet/.test(terms)) {
    return 'system';
  }
  if (/gateway|firewall|router|switch|decision|control/.test(terms)) {
    return 'control';
  }
  return 'service';
}

function shapePaletteItem(result: ShapeLibrarySearchResult): ShapePaletteItem {
  return {
    label: result.entry.name,
    kind: shapeKind(result),
    icon: shapesIcon,
    shape: { libraryId: result.libraryId, entryId: result.entry.id },
    size: result.entry.defaultSize,
  };
}

function catalogResultKind(result: ShapeLibrarySearchResult): 'Icon' | 'Diagram' {
  return result.libraryId === 'phosphor' || result.libraryId === 'simple-icons'
    ? 'Icon'
    : 'Diagram';
}

const MAX_RECENT_SHAPES = 12;
const MAX_FAVORITE_SHAPES = 64;

function sameCatalogShape(left: CatalogShapeRef, right: CatalogShapeRef): boolean {
  return left.libraryId === right.libraryId && left.entryId === right.entryId;
}

function validCatalogShapeRef(value: unknown): CatalogShapeRef | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const candidate = value as Partial<CatalogShapeRef>;
  if (
    typeof candidate.libraryId !== 'string' ||
    typeof candidate.entryId !== 'string' ||
    candidate.entryId.length === 0
  ) return undefined;
  const knownBuiltin = getBuiltinShapeLibraryEntry(candidate.libraryId, candidate.entryId) !== undefined;
  if (!knownBuiltin && !isDecorativeShapeLibraryId(candidate.libraryId)) return undefined;
  return { libraryId: candidate.libraryId, entryId: candidate.entryId };
}

function documentUsesDecorativeShapes(document: OpenChartDocument): boolean {
  return Object.values(document.nodes).some((node) => {
    const shape = node.data.shape;
    if (shape === null || typeof shape !== 'object' || Array.isArray(shape)) return false;
    const libraryId = (shape as { readonly libraryId?: unknown }).libraryId;
    return typeof libraryId === 'string' && isDecorativeShapeLibraryId(libraryId);
  });
}

export function normalizeCatalogShapeRefs(value: unknown, limit: number): readonly CatalogShapeRef[] {
  if (!Array.isArray(value)) return [];
  const normalized: CatalogShapeRef[] = [];
  for (const candidate of value) {
    const ref = validCatalogShapeRef(candidate);
    if (ref !== undefined && !normalized.some((existing) => sameCatalogShape(existing, ref))) {
      normalized.push(ref);
    }
    if (normalized.length >= limit) break;
  }
  return normalized;
}

export function recordRecentCatalogShape(
  current: readonly CatalogShapeRef[],
  ref: CatalogShapeRef,
): readonly CatalogShapeRef[] {
  return [ref, ...current.filter((candidate) => !sameCatalogShape(candidate, ref))]
    .slice(0, MAX_RECENT_SHAPES);
}

export function toggleFavoriteCatalogShape(
  current: readonly CatalogShapeRef[],
  ref: CatalogShapeRef,
): readonly CatalogShapeRef[] {
  const exists = current.some((candidate) => sameCatalogShape(candidate, ref));
  return exists
    ? current.filter((candidate) => !sameCatalogShape(candidate, ref))
    : [ref, ...current].slice(0, MAX_FAVORITE_SHAPES);
}

function catalogResultFromRef(
  ref: CatalogShapeRef,
  getEntry: (libraryId: string, entryId: string) => ShapeLibraryEntry | undefined,
): ShapeLibrarySearchResult | undefined {
  const entry = getEntry(ref.libraryId, ref.entryId);
  return entry === undefined ? undefined : { libraryId: ref.libraryId, entry };
}

function catalogRefFromItem(item: ShapePaletteItem): CatalogShapeRef | undefined {
  return item.shape === undefined
    ? undefined
    : { libraryId: item.shape.libraryId, entryId: item.shape.entryId };
}

function isCatalogSearchResult(
  result: ShapeLibrarySearchResult | undefined,
): result is ShapeLibrarySearchResult {
  return result !== undefined;
}

export function createShapeInsertionTransaction(
  document: OpenChartDocument,
  request: { readonly txId: string; readonly node: Node; readonly frame: TransformFrame },
): OperationEnvelope {
  return {
    txId: request.txId,
    actor: 'user',
    origin: 'gui',
    baseRev: document.rev,
    ops: [
      { op: 'create_node', node: request.node },
      { op: 'set_node_layout', id: request.node.id, layout: { ...request.frame, pinned: true } },
    ],
  };
}

function shapePath(commands: readonly EvaluatedPathCommand[]): string {
  return commands.map((command) => {
    switch (command.type) {
      case 'move':
        return `M ${command.to.x} ${command.to.y}`;
      case 'line':
        return `L ${command.to.x} ${command.to.y}`;
      case 'quadratic':
        return `Q ${command.control.x} ${command.control.y} ${command.to.x} ${command.to.y}`;
      case 'cubic':
        return `C ${command.control1.x} ${command.control1.y} ${command.control2.x} ${command.control2.y} ${command.to.x} ${command.to.y}`;
      case 'close':
        return 'Z';
    }
  }).join(' ');
}

function shapeGeometry(geometry: EvaluatedGeometry, key: string): ReactNode {
  const paint = {
    fill: geometry.fill ?? 'none',
    fillOpacity: geometry.fillOpacity,
    stroke: geometry.stroke ?? 'none',
    strokeOpacity: geometry.strokeOpacity,
    strokeWidth: geometry.strokeWidth,
    strokeDasharray: geometry.dash?.join(' '),
  };
  switch (geometry.type) {
    case 'rect':
      return <rect key={key} x={geometry.frame.x} y={geometry.frame.y} width={geometry.frame.width} height={geometry.frame.height} rx={geometry.radius} {...paint} />;
    case 'ellipse':
      return <ellipse key={key} cx={geometry.frame.x + geometry.frame.width / 2} cy={geometry.frame.y + geometry.frame.height / 2} rx={geometry.frame.width / 2} ry={geometry.frame.height / 2} {...paint} />;
    case 'polygon':
      return <polygon key={key} points={geometry.points.map((point) => `${point.x},${point.y}`).join(' ')} {...paint} />;
    case 'path':
      return <path key={key} d={shapePath(geometry.commands)} {...paint} />;
    case 'boolean':
      return <g key={key}>{geometry.geometry.map((part, index) => shapeGeometry(part, `${key}-${index}`))}</g>;
  }
}

function CatalogShapePreview({
  result,
  resolveShape,
}: {
  readonly result: ShapeLibrarySearchResult;
  readonly resolveShape: (libraryId: string, entryId: string) => ResolveLibraryShapeResult | undefined;
}) {
  const resolved = resolveShape(result.libraryId, result.entry.id);
  if (resolved === undefined || !resolved.ok) {
    return <Icon src={shapesIcon} size={24} />;
  }
  const { width, height } = resolved.definition.defaultSize;
  const scale = 38 / Math.max(width, height);
  const frame = { x: 24 - width * scale / 2, y: 24 - height * scale / 2, width: width * scale, height: height * scale };
  const evaluated = evaluateShapeDefinition(resolved.definition, { frame });
  if (!evaluated.ok) {
    return <Icon src={shapesIcon} size={24} />;
  }
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      {evaluated.shape.geometry.map((geometry, index) => shapeGeometry(geometry, `${result.entry.id}-${index}`))}
    </svg>
  );
}

const PREFERENCES_KEY = 'openchart.preferences.v1';
const DEFAULT_PREFERENCES: EditorPreferences = {
  exportFormat: 'png',
  exportScale: 2,
  canvasNavigation: false,
  recentShapes: [],
  favoriteShapes: [],
};

export function parseEditorPreferences(value: string | null): EditorPreferences {
  try {
    const parsed: unknown = JSON.parse(value ?? 'null');
    if (parsed === null || typeof parsed !== 'object') {
      return DEFAULT_PREFERENCES;
    }
    const stored = parsed as Partial<EditorPreferences>;
    return {
      exportFormat:
        stored.exportFormat === 'svg' ||
        stored.exportFormat === 'jpeg' ||
        stored.exportFormat === 'd2' ||
        stored.exportFormat === 'mermaid'
          ? stored.exportFormat
          : 'png',
      exportScale:
        stored.exportScale === 1 || stored.exportScale === 4 ? stored.exportScale : 2,
      canvasNavigation: stored.canvasNavigation === true,
      recentShapes: normalizeCatalogShapeRefs(stored.recentShapes, MAX_RECENT_SHAPES),
      favoriteShapes: normalizeCatalogShapeRefs(stored.favoriteShapes, MAX_FAVORITE_SHAPES),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function serializeEditorPreferences(preferences: EditorPreferences): string {
  return JSON.stringify(preferences);
}

function loadPreferences(): EditorPreferences {
  try {
    if (typeof window === 'undefined') {
      return DEFAULT_PREFERENCES;
    }
    return parseEditorPreferences(window.localStorage.getItem(PREFERENCES_KEY));
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function savePreferences(preferences: EditorPreferences): void {
  try {
    window.localStorage.setItem(PREFERENCES_KEY, serializeEditorPreferences(preferences));
  } catch {
    // Browser storage may be unavailable; the current session still works.
  }
}

function safeFilename(value: string): string {
  const filename = value
    .trim()
    .split('')
    .map((character) => character.charCodeAt(0) < 32 ? '-' : character)
    .join('')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/[. ]+$/g, '')
    .slice(0, 120);
  return filename.length > 0 ? filename : 'openchart-diagram';
}

function displayFilename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  window.document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function rasterizeScene(
  svg: string,
  scene: SceneDescription,
  format: Extract<BrowserExportFormat, 'png' | 'jpeg'>,
  scale: BrowserExportScale,
): Promise<Blob> {
  const source = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener('error', () => reject(new Error('The SVG preview could not be rasterized')), {
        once: true,
      });
      image.src = source;
    });
    const canvas = window.document.createElement('canvas');
    canvas.width = Math.round(scene.bounds.width * scale);
    canvas.height = Math.round(scene.bounds.height * scale);
    const context = canvas.getContext('2d');
    if (context === null) {
      throw new Error('Canvas export is unavailable');
    }
    if (format === 'jpeg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob === null ? reject(new Error('The browser returned an empty export')) : resolve(blob),
        format === 'png' ? 'image/png' : 'image/jpeg',
        format === 'jpeg' ? 0.92 : undefined,
      );
    });
  } finally {
    URL.revokeObjectURL(source);
  }
}

function printScene(scene: SceneDescription): void {
  const popup = window.open('', 'openchart-print', 'popup,width=1200,height=800');
  if (popup === null) {
    throw new Error('Allow the OpenChart print window and try again');
  }
  const svg = renderSceneToSvg(scene);
  popup.document.open();
  popup.document.write(`<!doctype html><html><head><title>${scene.title.replace(/[&<>]/g, '')}</title><style>html,body{margin:0;background:white}svg{display:block;width:100%;height:auto}@page{margin:8mm}</style></head><body>${svg}</body></html>`);
  popup.document.close();
  window.setTimeout(() => {
    popup.focus();
    popup.print();
  }, 0);
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function editorColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

const STYLE_SWATCHES = [
  '#0F172A', '#334155', '#64748B', '#CBD5E1', '#FFFFFF',
  '#2563EB', '#0F766E', '#7C3AED', '#B45309', '#DC2626', '#059669', '#D97706',
] as const;

function isConnectorMarker(
  value: string,
): value is NonNullable<ConnectorVisualStyleUpdate['startMarker']> {
  return value === 'none' ||
    value === 'arrow' ||
    value === 'open-arrow' ||
    value === 'diamond' ||
    value === 'circle' ||
    value === 'bar' ||
    value === 'crow-foot';
}

function ColorControl({ label, value, mixed = false, onChange }: {
  readonly label: string;
  readonly value: string;
  readonly mixed?: boolean;
  readonly onChange: (value: string) => void;
}) {
  const normalized = editorColor(value, '#64748B');
  return (
    <div className="oc-style-color-control">
      <div className="oc-style-control-heading"><span>{label}</span>{mixed ? <small>Mixed</small> : null}</div>
      <div className="oc-style-color-row">
        <input type="color" aria-label={`${label} color`} value={normalized} onChange={(event) => onChange(event.currentTarget.value)} />
        <input
          key={`${label}-${normalized}`}
          className="oc-hex-input"
          aria-label={`${label} hex color`}
          defaultValue={normalized.toUpperCase()}
          onBlur={(event) => {
            const candidate = event.currentTarget.value.trim();
            if (/^#[0-9a-f]{6}$/i.test(candidate)) onChange(candidate.toUpperCase());
            else event.currentTarget.value = normalized.toUpperCase();
          }}
        />
      </div>
      <div className="oc-style-swatches" aria-label={`${label} swatches`}>
        {STYLE_SWATCHES.map((swatch) => (
          <button type="button" key={swatch} className={normalized.toUpperCase() === swatch ? 'is-active' : undefined}
            style={{ background: swatch }} aria-label={`Set ${label.toLowerCase()} to ${swatch}`} onClick={() => onChange(swatch)} />
        ))}
      </div>
    </div>
  );
}

function oppositeConnectorSide(
  side: 'north' | 'east' | 'south' | 'west',
): 'north' | 'east' | 'south' | 'west' {
  return side === 'north'
    ? 'south'
    : side === 'south'
      ? 'north'
      : side === 'east'
        ? 'west'
        : 'east';
}

function canvasDimension(document: OpenChartDocument, key: 'canvasWidth' | 'canvasHeight'): number {
  const value = document.layout.options?.[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : key === 'canvasWidth'
      ? 1440
      : 920;
}

function orderedPages(document: OpenChartDocument): readonly Page[] {
  return Object.values(document.pages).sort((left, right) => {
    const order = (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER);
    return order === 0 ? compareIds(left.id, right.id) : order;
  });
}

function resolveFrames(document: OpenChartDocument): Readonly<Record<string, TransformFrame>> {
  const width = canvasDimension(document, 'canvasWidth');
  const nodeIds = Object.keys(document.nodes).sort(compareIds);
  const baseFrames: Record<string, TransformFrame> = {};
  for (let index = 0; index < nodeIds.length; index += 1) {
    const id = nodeIds[index];
    if (id === undefined) {
      continue;
    }
    const node = document.nodes[id];
    if (node === undefined) {
      continue;
    }
    const override = document.layout.overrides[id];
    const fallbackSize = DEFAULT_NODE_SIZE[node.kind] ?? DEFAULT_NODE_SIZE.service;
    const columns = Math.max(1, Math.floor((width - 120) / 340));
    const column = index % columns;
    const row = Math.floor(index / columns);
    baseFrames[id] = {
      x: override?.x ?? 80 + column * 340,
      y: override?.y ?? 180 + row * 210,
      width: override?.width ?? fallbackSize?.width ?? 300,
      height: override?.height ?? fallbackSize?.height ?? 154,
      ...(override?.rotation === undefined ? {} : { rotation: override.rotation }),
    };
  }
  const reconciled = reconcileContainers(document, baseFrames).frames;
  return Object.fromEntries(
    nodeIds.map((id) => {
      const frame = reconciled[id] ?? baseFrames[id];
      const rotation = baseFrames[id]?.rotation;
      if (frame === undefined) {
        throw new Error(`Unable to resolve frame for ${JSON.stringify(id)}`);
      }
      return [id, { ...frame, ...(rotation === undefined ? {} : { rotation }) }];
    }),
  );
}

function previewDocument(
  document: OpenChartDocument,
  preview: TransformPreview | null,
): OpenChartDocument {
  if (preview === null) {
    return document;
  }
  const next = structuredClone(document);
  for (const [id, frame] of Object.entries(preview.updates)) {
    next.layout.overrides[id] = {
      ...next.layout.overrides[id],
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      ...(frame.rotation === undefined ? {} : { rotation: frame.rotation }),
      pinned: true,
    };
  }
  return next;
}

function selectableItems(
  document: OpenChartDocument,
  pageId: string,
  frames: Readonly<Record<string, TransformFrame>>,
): readonly SelectableItem[] {
  return Object.values(document.nodes)
    .filter((node) => node.pageId === pageId && node.data.connectorAnchor !== true)
    .sort((left, right) => {
      const zIndex =
        (document.layout.overrides[left.id]?.zIndex ?? 0) -
        (document.layout.overrides[right.id]?.zIndex ?? 0);
      return zIndex === 0 ? compareIds(left.id, right.id) : zIndex;
    })
    .map((node, paintOrder) => {
      const layer = document.layers[node.layerId];
      const frame = frames[node.id];
      if (frame === undefined) {
        throw new Error(`Selectable node ${JSON.stringify(node.id)} has no frame`);
      }
      return {
        id: node.id,
        kind:
          node.container !== undefined
            ? 'container'
            : node.group !== undefined
              ? 'group'
              : 'node',
        bounds: frame,
        paintOrder,
        ...(node.parentId === undefined ? {} : { parentId: node.parentId }),
        hidden: layer?.visible !== true,
        locked: layer?.locked !== false,
      } satisfies SelectableItem;
    });
}

function selectionBounds(
  selectedIds: readonly string[],
  frames: Readonly<Record<string, TransformFrame>>,
): TransformFrame | undefined {
  const selected = selectedIds
    .map((id) => frames[id])
    .filter((frame): frame is TransformFrame => frame !== undefined);
  if (selected.length === 0) {
    return undefined;
  }
  const left = Math.min(...selected.map((frame) => frame.x));
  const top = Math.min(...selected.map((frame) => frame.y));
  const right = Math.max(...selected.map((frame) => frame.x + frame.width));
  const bottom = Math.max(...selected.map((frame) => frame.y + frame.height));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    ...(selected.length === 1 && selected[0]?.rotation !== undefined
      ? { rotation: selected[0].rotation }
      : {}),
  };
}

export type DistributionMode = 'horizontal' | 'vertical' | 'equal-spacing';

export function reorderSiblingNodes(
  siblings: readonly Node[],
  selectedIds: readonly string[],
  mode: 'front' | 'forward' | 'backward' | 'back',
): Node[] | undefined {
  const selected = new Set(selectedIds);
  let ordered = [...siblings];
  if (mode === 'front') {
    ordered = [
      ...ordered.filter((node) => !selected.has(node.id)),
      ...ordered.filter((node) => selected.has(node.id)),
    ];
  } else if (mode === 'back') {
    ordered = [
      ...ordered.filter((node) => selected.has(node.id)),
      ...ordered.filter((node) => !selected.has(node.id)),
    ];
  } else if (mode === 'forward') {
    for (let index = ordered.length - 2; index >= 0; index -= 1) {
      const current = ordered[index];
      const next = ordered[index + 1];
      if (
        current !== undefined &&
        next !== undefined &&
        selected.has(current.id) &&
        !selected.has(next.id)
      ) {
        ordered[index] = next;
        ordered[index + 1] = current;
      }
    }
  } else {
    for (let index = 1; index < ordered.length; index += 1) {
      const current = ordered[index];
      const previous = ordered[index - 1];
      if (
        current !== undefined &&
        previous !== undefined &&
        selected.has(current.id) &&
        !selected.has(previous.id)
      ) {
        ordered[index - 1] = current;
        ordered[index] = previous;
      }
    }
  }
  if (ordered.every((node, index) => node.id === siblings[index]?.id)) {
    return undefined;
  }
  return ordered;
}

function distributionCenter(frame: TransformFrame, axis: 'x' | 'y'): number {
  return axis === 'x' ? frame.x + frame.width / 2 : frame.y + frame.height / 2;
}

function distributionSize(frame: TransformFrame, axis: 'x' | 'y'): number {
  return axis === 'x' ? frame.width : frame.height;
}

function distributionStart(frame: TransformFrame, axis: 'x' | 'y'): number {
  return axis === 'x' ? frame.x : frame.y;
}

export function distributeSelectionPreview(
  document: OpenChartDocument,
  frames: Readonly<Record<string, TransformFrame>>,
  selectedIds: readonly string[],
  mode: DistributionMode,
): TransformPreview | undefined {
  const entries = [...new Set(selectedIds)]
    .map((id) => {
      const frame = frames[id];
      return frame === undefined || document.nodes[id] === undefined ? undefined : { id, frame };
    })
    .filter((entry): entry is { readonly id: string; readonly frame: TransformFrame } => entry !== undefined);
  if (entries.length < 3) return undefined;

  const xCenters = entries.map(({ frame }) => distributionCenter(frame, 'x'));
  const yCenters = entries.map(({ frame }) => distributionCenter(frame, 'y'));
  const xSpan = Math.max(...xCenters) - Math.min(...xCenters);
  const ySpan = Math.max(...yCenters) - Math.min(...yCenters);
  const axis: 'x' | 'y' = mode === 'horizontal' ? 'x' : mode === 'vertical' ? 'y' : xSpan >= ySpan ? 'x' : 'y';
  const sorted = entries.toSorted((left, right) => {
    const primary = distributionStart(left.frame, axis) - distributionStart(right.frame, axis);
    return primary === 0 ? left.id.localeCompare(right.id) : primary;
  });
  const targets = new Map<string, number>();
  const first = sorted[0];
  const last = sorted.at(-1);
  if (first === undefined || last === undefined) return undefined;

  const outerStart = distributionStart(first.frame, axis);
  const outerEnd = distributionStart(last.frame, axis) + distributionSize(last.frame, axis);
  const occupied = sorted.reduce(
    (total, entry) => total + distributionSize(entry.frame, axis),
    0,
  );
  const gap = (outerEnd - outerStart - occupied) / (sorted.length - 1);
  let cursor = outerStart;
  for (const entry of sorted) {
    targets.set(entry.id, cursor);
    cursor += distributionSize(entry.frame, axis) + gap;
  }

  const updates: Record<string, TransformFrame> = {};
  for (const { id, frame } of entries) {
    const target = targets.get(id);
    if (target === undefined) continue;
    const amount = target - distributionStart(frame, axis);
    if (Math.abs(amount) <= 1e-9) continue;
    const delta = axis === 'x' ? { x: amount, y: 0 } : { x: 0, y: amount };
    Object.assign(updates, translateSelection(document, frames, [id], delta).updates);
  }
  if (Object.keys(updates).length === 0) return undefined;
  const bounds = selectionBounds(entries.map(({ id }) => id), { ...frames, ...updates });
  return bounds === undefined ? undefined : { selectionBounds: bounds, updates };
}

function makeUid(): string {
  const bytes = new Uint8Array(26);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => UID_ALPHABET[value % UID_ALPHABET.length]).join('');
}

function nextEntityId(document: OpenChartDocument, prefix: string): string {
  let index = 1;
  while (document.nodes[`${prefix}-${index}`] !== undefined) {
    index += 1;
  }
  return `${prefix}-${index}`;
}

function nextMapId(record: Readonly<Record<string, unknown>>, prefix: string): string {
  let index = 1;
  while (record[`${prefix}-${index}`] !== undefined) {
    index += 1;
  }
  return `${prefix}-${index}`;
}

function allocateCopyId(
  record: Readonly<Record<string, unknown>>,
  reserved: Set<string>,
  sourceId: string,
): string {
  let index = 1;
  let candidate = `${sourceId}.copy-${index}`;
  while (record[candidate] !== undefined || reserved.has(candidate)) {
    index += 1;
    candidate = `${sourceId}.copy-${index}`;
  }
  reserved.add(candidate);
  return candidate;
}

function viewportCamera(
  camera: EditorCamera,
  viewport: ViewportSize,
): CameraState {
  return {
    ...camera,
    viewportWidth: Math.max(1, viewport.width),
    viewportHeight: Math.max(1, viewport.height),
  };
}

function fitCameraBounds(bounds: CameraBounds, viewport: ViewportSize): EditorCamera {
  const availableWidth = Math.max(1, viewport.width - 104);
  const availableHeight = Math.max(1, viewport.height - 104);
  const zoom = clamp(
    Math.min(availableWidth / bounds.width, availableHeight / bounds.height),
    0.1,
    1.25,
  );
  const worldWidth = viewport.width / zoom;
  const worldHeight = viewport.height / zoom;
  return {
    x: bounds.x - (worldWidth - bounds.width) / 2,
    y: bounds.y - (worldHeight - bounds.height) / 2,
    zoom,
  };
}

function fitCamera(scene: SceneDescription, viewport: ViewportSize): EditorCamera {
  return fitCameraBounds(scene.bounds, viewport);
}

function framesBounds(
  frames: Readonly<Record<string, TransformFrame>>,
): CameraBounds {
  const values = Object.values(frames);
  if (values.length === 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const margin = 64;
  const minX = Math.min(...values.map((frame) => frame.x));
  const minY = Math.min(...values.map((frame) => frame.y));
  const maxX = Math.max(...values.map((frame) => frame.x + frame.width));
  const maxY = Math.max(...values.map((frame) => frame.y + frame.height));
  return {
    x: minX - margin,
    y: minY - margin,
    width: Math.max(1, maxX - minX + margin * 2),
    height: Math.max(1, maxY - minY + margin * 2),
  };
}

function isTokenPresetId(value: string | undefined): value is TokenPresetId {
  return TOKEN_PRESET_IDS.some((presetId) => presetId === value);
}

function worldPoint(
  event: ReactPointerEvent<HTMLCanvasElement>,
  camera: EditorCamera,
): InteractionPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: camera.x + (event.clientX - rect.left) / camera.zoom,
    y: camera.y + (event.clientY - rect.top) / camera.zoom,
  };
}

export function canvasDropWorldPoint(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'top'>,
  camera: EditorCamera,
): InteractionPoint {
  return {
    x: camera.x + (clientX - rect.left) / camera.zoom,
    y: camera.y + (clientY - rect.top) / camera.zoom,
  };
}

function screenPoint(
  point: InteractionPoint,
  camera: EditorCamera,
): InteractionPoint {
  return {
    x: (point.x - camera.x) * camera.zoom,
    y: (point.y - camera.y) * camera.zoom,
  };
}

function handlePoints(bounds: TransformFrame): Readonly<Record<ResizeHandle, InteractionPoint>> {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return {
    'north-west': { x: bounds.x, y: bounds.y },
    north: { x: centerX, y: bounds.y },
    'north-east': { x: bounds.x + bounds.width, y: bounds.y },
    east: { x: bounds.x + bounds.width, y: centerY },
    'south-east': { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    south: { x: centerX, y: bounds.y + bounds.height },
    'south-west': { x: bounds.x, y: bounds.y + bounds.height },
    west: { x: bounds.x, y: centerY },
  };
}

function hitTransformControl(
  world: InteractionPoint,
  bounds: TransformFrame,
  camera: EditorCamera,
  rotatable: boolean,
): { readonly kind: 'resize'; readonly handle: ResizeHandle } | { readonly kind: 'rotate' } | undefined {
  const threshold = 10 / camera.zoom;
  for (const [handle, point] of Object.entries(handlePoints(bounds)) as [ResizeHandle, InteractionPoint][]) {
    if (Math.hypot(world.x - point.x, world.y - point.y) <= threshold) {
      return { kind: 'resize', handle };
    }
  }
  if (rotatable) {
    const rotatePoint = { x: bounds.x + bounds.width / 2, y: bounds.y - 30 / camera.zoom };
    if (Math.hypot(world.x - rotatePoint.x, world.y - rotatePoint.y) <= threshold) {
      return { kind: 'rotate' };
    }
  }
  return undefined;
}

function connectorAt(
  connectors: readonly SceneConnectorGeometry[],
  point: InteractionPoint,
  tolerance: number,
): SceneConnectorGeometry | undefined {
  return [...connectors]
    .reverse()
    .find((connector) => hitTestConnector(connectorHitPoints(connector), point, tolerance));
}

function connectorHitPoints(
  connector: SceneConnectorGeometry,
): readonly InteractionPoint[] {
  const points: InteractionPoint[] = [];
  let current: InteractionPoint | undefined;
  const push = (point: InteractionPoint): void => {
    const previous = points.at(-1);
    if (previous?.x !== point.x || previous.y !== point.y) {
      points.push(point);
    }
  };
  for (const command of connector.commands) {
    if (command.type === 'close') {
      continue;
    }
    if (command.type === 'move' || command.type === 'line' || current === undefined) {
      current = command.to;
      push(command.to);
      continue;
    }
    const from = current;
    for (let step = 1; step <= 12; step += 1) {
      const t = step / 12;
      const inverse = 1 - t;
      if (command.type === 'quadratic') {
        push({
          x: inverse * inverse * from.x + 2 * inverse * t * command.control.x + t * t * command.to.x,
          y: inverse * inverse * from.y + 2 * inverse * t * command.control.y + t * t * command.to.y,
        });
      } else {
        push({
          x:
            inverse ** 3 * from.x +
            3 * inverse * inverse * t * command.control1.x +
            3 * inverse * t * t * command.control2.x +
            t ** 3 * command.to.x,
          y:
            inverse ** 3 * from.y +
            3 * inverse * inverse * t * command.control1.y +
            3 * inverse * t * t * command.control2.y +
            t ** 3 * command.to.y,
        });
      }
    }
    current = command.to;
  }
  return points;
}

const CONNECTOR_HANDLE_OFFSET_PX = 11;
const CONNECTOR_DRAG_THRESHOLD_PX = 4;
const CONNECTOR_ANCHOR_KIND = 'connector-anchor';
const CONNECTOR_ANCHOR_SIZE = 0.01;
const MAX_BROWSER_DOCUMENT_BYTES = 32 * 1024 * 1024;

function isConnectorAnchorNode(node: Node | undefined): boolean {
  return node?.kind === CONNECTOR_ANCHOR_KIND && node.data.connectorAnchor === true;
}

export function buildConnectorCreateOperations(
  fromPort: Port,
  toPort: Port,
  edge: Edge,
): readonly Operation[] {
  return [
    { op: 'create_port', port: fromPort },
    { op: 'create_port', port: toPort },
    { op: 'create_edge', edge },
  ];
}

export function buildRelinkEdgeOperations(
  document: OpenChartDocument,
  edge: Edge,
  endpoint: 'from' | 'to',
  port: Port,
): readonly Operation[] {
  const operations: Operation[] = [
    { op: 'create_port', port },
    {
      op: 'set_edge_endpoints',
      id: edge.id,
      fromPortId: endpoint === 'from' ? port.id : edge.fromPortId,
      toPortId: endpoint === 'to' ? port.id : edge.toPortId,
    },
  ];
  const priorPortId = endpoint === 'from' ? edge.fromPortId : edge.toPortId;
  const priorPort = document.ports[priorPortId];
  const priorNode = priorPort === undefined ? undefined : document.nodes[priorPort.nodeId];
  if (priorPort !== undefined && isConnectorAnchorNode(priorNode)) {
    const anchorPortIds = new Set(
      Object.values(document.ports)
        .filter((candidate) => candidate.nodeId === priorPort.nodeId)
        .map((candidate) => candidate.id),
    );
    const referencedElsewhere = Object.values(document.edges).some((candidate) => {
      if (candidate.id === edge.id) {
        const otherPortId = endpoint === 'from' ? candidate.toPortId : candidate.fromPortId;
        return anchorPortIds.has(otherPortId);
      }
      return anchorPortIds.has(candidate.fromPortId) || anchorPortIds.has(candidate.toPortId);
    });
    if (!referencedElsewhere) {
      operations.push({ op: 'delete_node', id: priorPort.nodeId });
    }
  }
  return operations;
}

export function createConnectorTransaction(
  document: OpenChartDocument,
  request: {
    readonly txId: string;
    readonly pageId: string;
    readonly layerId: string;
    readonly styleId: string;
    readonly fromNodeId: string;
    readonly toNodeId: string;
    readonly fromSide: ConnectorSide;
    readonly toSide: ConnectorSide;
  },
): OperationEnvelope {
  const fromPortId = nextMapId(document.ports, `port.${request.fromNodeId}.out`);
  const toPortId = nextMapId(document.ports, `port.${request.toNodeId}.in`);
  const edgeId = nextMapId(document.edges, 'edge.connector');
  const fromPort: Port = {
    id: fromPortId,
    uid: makeUid(),
    nodeId: request.fromNodeId,
    direction: 'out',
    side: request.fromSide,
  };
  const toPort: Port = {
    id: toPortId,
    uid: makeUid(),
    nodeId: request.toNodeId,
    direction: 'in',
    side: request.toSide,
  };
  const edge: Edge = {
    id: edgeId,
    uid: makeUid(),
    fromPortId,
    toPortId,
    label: '',
    semantic: 'Flow',
    pageId: request.pageId,
    layerId: request.layerId,
    styleId: request.styleId,
    routing: {
      mode: 'orthogonal',
      avoidObstacles: true,
      cornerRadius: 9,
      jumpStyle: 'arc',
    },
    data: {},
  };
  return {
    txId: request.txId,
    actor: 'user',
    origin: 'gui',
    baseRev: document.rev,
    ops: buildConnectorCreateOperations(fromPort, toPort, edge),
  };
}

export function relinkEdgeTransaction(
  document: OpenChartDocument,
  request: {
    readonly txId: string;
    readonly edgeId: string;
    readonly endpoint: 'from' | 'to';
    readonly nodeId: string;
    readonly side: ConnectorSide | 'auto';
  },
): OperationEnvelope | undefined {
  const edge = document.edges[request.edgeId];
  const node = document.nodes[request.nodeId];
  const existingPortId = request.endpoint === 'from' ? edge?.fromPortId : edge?.toPortId;
  const existingPort = existingPortId === undefined ? undefined : document.ports[existingPortId];
  if (edge === undefined || node === undefined || existingPort === undefined) {
    return undefined;
  }
  if (
    existingPort.nodeId === request.nodeId &&
    (request.side === 'auto' || existingPort.side === request.side)
  ) {
    return undefined;
  }
  const port: Port = {
    id: nextMapId(
      document.ports,
      `port.${request.nodeId}.${request.endpoint === 'from' ? 'out' : 'in'}`,
    ),
    uid: makeUid(),
    nodeId: request.nodeId,
    direction: request.endpoint === 'from' ? 'out' : 'in',
    side: request.side,
  };
  return {
    txId: request.txId,
    actor: 'user',
    origin: 'gui',
    baseRev: document.rev,
    ops: buildRelinkEdgeOperations(document, edge, request.endpoint, port),
  };
}

export function detachEdgeEndpointTransaction(
  document: OpenChartDocument,
  request: {
    readonly txId: string;
    readonly edgeId: string;
    readonly endpoint: 'from' | 'to';
    readonly point: InteractionPoint;
  },
): OperationEnvelope | undefined {
  const edge = document.edges[request.edgeId];
  if (edge === undefined) {
    return undefined;
  }
  const existingPortId = request.endpoint === 'from' ? edge.fromPortId : edge.toPortId;
  const existingPort = document.ports[existingPortId];
  const existingNode = existingPort === undefined ? undefined : document.nodes[existingPort.nodeId];
  const layout = {
    x: request.point.x - CONNECTOR_ANCHOR_SIZE / 2,
    y: request.point.y - CONNECTOR_ANCHOR_SIZE / 2,
    width: CONNECTOR_ANCHOR_SIZE,
    height: CONNECTOR_ANCHOR_SIZE,
    pinned: true,
  } as const;
  if (existingPort !== undefined && isConnectorAnchorNode(existingNode)) {
    return {
      txId: request.txId,
      actor: 'user',
      origin: 'gui',
      baseRev: document.rev,
      ops: [{ op: 'set_node_layout', id: existingPort.nodeId, layout }],
    };
  }
  const anchorNodeId = nextMapId(document.nodes, 'node.connector-anchor');
  const anchorPortId = nextMapId(
    document.ports,
    `port.${anchorNodeId}.${request.endpoint === 'from' ? 'out' : 'in'}`,
  );
  const anchorNode: Node = {
    id: anchorNodeId,
    uid: makeUid(),
    kind: CONNECTOR_ANCHOR_KIND,
    label: '',
    pageId: edge.pageId,
    layerId: edge.layerId,
    styleId: edge.styleId,
    data: { connectorAnchor: true },
  };
  const anchorPort: Port = {
    id: anchorPortId,
    uid: makeUid(),
    nodeId: anchorNodeId,
    direction: request.endpoint === 'from' ? 'out' : 'in',
    side: 'auto',
  };
  return {
    txId: request.txId,
    actor: 'user',
    origin: 'gui',
    baseRev: document.rev,
    ops: [
      { op: 'create_node', node: anchorNode },
      { op: 'set_node_layout', id: anchorNodeId, layout },
      { op: 'create_port', port: anchorPort },
      {
        op: 'set_edge_endpoints',
        id: edge.id,
        fromPortId: request.endpoint === 'from' ? anchorPortId : edge.fromPortId,
        toPortId: request.endpoint === 'to' ? anchorPortId : edge.toPortId,
      },
    ],
  };
}

export function connectorDragExceededThreshold(
  start: InteractionPoint,
  current: InteractionPoint,
  zoom: number,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) * zoom >= CONNECTOR_DRAG_THRESHOLD_PX;
}

export function commitConnectorCreation(
  createConnector: (
    fromNodeId: string,
    toNodeId: string,
    fromSide: ConnectorSide,
    toSide: ConnectorSide,
  ) => void,
  source: ConnectorPortHit,
  target: ConnectorPortHit,
): void {
  createConnector(source.nodeId, target.nodeId, source.side, target.side);
}

function connectorPortPoint(
  bounds: InteractionRect,
  side: ConnectorSide,
  offset = 0,
): InteractionPoint {
  return side === 'north'
    ? { x: bounds.x + bounds.width / 2, y: bounds.y - offset }
    : side === 'east'
      ? { x: bounds.x + bounds.width + offset, y: bounds.y + bounds.height / 2 }
      : side === 'south'
        ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height + offset }
        : { x: bounds.x - offset, y: bounds.y + bounds.height / 2 };
}

export function connectorPortAt(
  items: readonly SelectableItem[],
  point: InteractionPoint,
  tolerance: number,
  offset = 0,
  nodeId?: string,
): ConnectorPortHit | undefined {
  let best: ConnectorPortHit | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of items) {
    if (
      item.kind !== 'node' ||
      item.hidden === true ||
      item.locked === true ||
      (nodeId !== undefined && item.id !== nodeId)
    ) {
      continue;
    }
    const sides: readonly ConnectorSide[] = ['north', 'east', 'south', 'west'];
    for (const side of sides) {
      const portPoint = connectorPortPoint(item.bounds, side, offset);
      const distance = Math.hypot(point.x - portPoint.x, point.y - portPoint.y);
      if (distance <= tolerance && distance < bestDistance) {
        bestDistance = distance;
        best = {
          nodeId: item.id,
          side,
          point: connectorPortPoint(item.bounds, side),
        };
      }
    }
  }
  return best;
}

function hoveredConnectorNodeId(
  items: readonly SelectableItem[],
  point: InteractionPoint,
  padding: number,
): string | undefined {
  return [...items]
    .filter((item) => item.kind === 'node' && item.hidden !== true && item.locked !== true)
    .sort((left, right) => right.paintOrder - left.paintOrder)
    .find((item) =>
      point.x >= item.bounds.x - padding &&
      point.x <= item.bounds.x + item.bounds.width + padding &&
      point.y >= item.bounds.y - padding &&
      point.y <= item.bounds.y + item.bounds.height + padding,
    )?.id;
}

function nearestConnectorSide(bounds: InteractionRect, point: InteractionPoint): ConnectorSide {
  const distances: readonly [ConnectorSide, number][] = [
    ['north', Math.abs(point.y - bounds.y)],
    ['east', Math.abs(point.x - (bounds.x + bounds.width))],
    ['south', Math.abs(point.y - (bounds.y + bounds.height))],
    ['west', Math.abs(point.x - bounds.x)],
  ];
  return [...distances].sort((left, right) => left[1] - right[1])[0]?.[0] ?? 'east';
}

function connectorTargetAt(
  items: readonly SelectableItem[],
  point: InteractionPoint,
  camera: EditorCamera,
  excludedNodeId?: string,
): ConnectorPortHit | undefined {
  const handleOffset = CONNECTOR_HANDLE_OFFSET_PX / camera.zoom;
  const explicit = connectorPortAt(items, point, 14 / camera.zoom, handleOffset);
  if (explicit !== undefined && explicit.nodeId !== excludedNodeId) {
    return explicit;
  }
  const item = [...items]
    .filter((candidate) =>
      candidate.kind === 'node' &&
      candidate.hidden !== true &&
      candidate.locked !== true &&
      candidate.id !== excludedNodeId &&
      point.x >= candidate.bounds.x &&
      point.x <= candidate.bounds.x + candidate.bounds.width &&
      point.y >= candidate.bounds.y &&
      point.y <= candidate.bounds.y + candidate.bounds.height,
    )
    .sort((left, right) => right.paintOrder - left.paintOrder)[0];
  if (item === undefined) {
    return undefined;
  }
  const side = nearestConnectorSide(item.bounds, point);
  return { nodeId: item.id, side, point: connectorPortPoint(item.bounds, side) };
}

function snapConnectorPoint(
  items: readonly SelectableItem[],
  point: InteractionPoint,
  camera: EditorCamera,
  viewport: ViewportSize,
  excludedNodeId?: string,
): { readonly point: InteractionPoint; readonly visuals: SnapVisuals } {
  const size = 1 / camera.zoom;
  const half = size / 2;
  const snap = snapBounds({
    movingId: 'connector.endpoint',
    bounds: { x: point.x - half, y: point.y - half, width: size, height: size },
    candidates: items
      .filter((item) => item.id !== excludedNodeId && item.hidden !== true && item.locked !== true)
      .map((item) => ({
        id: item.id,
        bounds: item.bounds,
        onScreen:
          item.bounds.x + item.bounds.width >= camera.x &&
          item.bounds.x <= camera.x + viewport.width / camera.zoom &&
          item.bounds.y + item.bounds.height >= camera.y &&
          item.bounds.y <= camera.y + viewport.height / camera.zoom,
      })),
    settings: {
      snapToGrid: true,
      snapToObjects: true,
      snapToGuides: true,
      threshold: 7 / camera.zoom,
      gridSize: 8,
    },
  });
  return {
    point: {
      x: snap.bounds.x + snap.bounds.width / 2,
      y: snap.bounds.y + snap.bounds.height / 2,
    },
    visuals: { guides: snap.alignmentGuides, coordinates: snap.coordinates },
  };
}

function connectorEndpointAt(
  connector: SceneConnectorGeometry,
  point: InteractionPoint,
  tolerance: number,
): 'from' | 'to' | undefined {
  const fromDistance = Math.hypot(point.x - connector.from.x, point.y - connector.from.y);
  const toDistance = Math.hypot(point.x - connector.to.x, point.y - connector.to.y);
  if (fromDistance <= tolerance && fromDistance <= toDistance) {
    return 'from';
  }
  return toDistance <= tolerance ? 'to' : undefined;
}

function selectConnector(
  selection: SelectionState,
  document: OpenChartDocument,
  edgeId: string,
  toggle: boolean,
): SelectionState {
  const selectedEdges = new Set(
    selection.selectedIds.filter((id) => document.edges[id] !== undefined),
  );
  if (toggle && selectedEdges.has(edgeId)) {
    selectedEdges.delete(edgeId);
  } else if (toggle) {
    selectedEdges.add(edgeId);
  } else {
    selectedEdges.clear();
    selectedEdges.add(edgeId);
  }
  return { scopeId: selection.scopeId, selectedIds: [...selectedEdges] };
}

function traceScenePath(
  context: CanvasRenderingContext2D,
  commands: readonly ScenePathCommand[],
  camera: EditorCamera,
): void {
  context.beginPath();
  for (const command of commands) {
    if (command.type === 'close') {
      context.closePath();
      continue;
    }
    const to = screenPoint(command.to, camera);
    if (command.type === 'move') {
      context.moveTo(to.x, to.y);
    } else if (command.type === 'line') {
      context.lineTo(to.x, to.y);
    } else if (command.type === 'quadratic') {
      const control = screenPoint(command.control, camera);
      context.quadraticCurveTo(control.x, control.y, to.x, to.y);
    } else {
      const control1 = screenPoint(command.control1, camera);
      const control2 = screenPoint(command.control2, camera);
      context.bezierCurveTo(
        control1.x,
        control1.y,
        control2.x,
        control2.y,
        to.x,
        to.y,
      );
    }
  }
}

function waypointAt(
  document: OpenChartDocument,
  edgeId: string,
  point: InteractionPoint,
  tolerance: number,
): number | undefined {
  const index = document.layout.edgeOverrides?.[edgeId]?.waypoints?.findIndex(
    (waypoint) => Math.hypot(waypoint.x - point.x, waypoint.y - point.y) <= tolerance,
  );
  return index === undefined || index < 0 ? undefined : index;
}

function positionAlongPolyline(
  points: readonly InteractionPoint[],
  point: InteractionPoint,
): number {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestPosition = 0;
  let traversed = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (from === undefined || to === undefined) {
      continue;
    }
    const deltaX = to.x - from.x;
    const deltaY = to.y - from.y;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const segmentLength = Math.sqrt(lengthSquared);
    const segmentT = lengthSquared <= 0
      ? 0
      : clamp(
          ((point.x - from.x) * deltaX + (point.y - from.y) * deltaY) /
            lengthSquared,
          0,
          1,
        );
    const projected = {
      x: from.x + deltaX * segmentT,
      y: from.y + deltaY * segmentT,
    };
    const candidateDistance = Math.hypot(point.x - projected.x, point.y - projected.y);
    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      bestPosition = traversed + segmentLength * segmentT;
    }
    traversed += segmentLength;
  }
  return bestPosition;
}

interface PolylineProjection {
  readonly point: InteractionPoint;
  readonly labelT: number;
  readonly segmentIndex: number;
  readonly segmentT: number;
  readonly distance: number;
}

function projectPointToPolyline(
  points: readonly InteractionPoint[],
  point: InteractionPoint,
): PolylineProjection | undefined {
  if (points.length < 2) {
    return undefined;
  }
  const lengths: number[] = [];
  let totalLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (from === undefined || to === undefined) {
      lengths.push(0);
      continue;
    }
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    lengths.push(length);
    totalLength += length;
  }
  if (totalLength <= 0) {
    const first = points[0];
    return first === undefined
      ? undefined
      : { point: first, labelT: 0, segmentIndex: 0, segmentT: 0, distance: Math.hypot(point.x - first.x, point.y - first.y) };
  }

  let traversed = 0;
  let best: PolylineProjection | undefined;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const segmentLength = lengths[index - 1] ?? 0;
    if (from === undefined || to === undefined || segmentLength <= 0) {
      traversed += segmentLength;
      continue;
    }
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const segmentT = clamp(((point.x - from.x) * dx + (point.y - from.y) * dy) / (segmentLength * segmentLength), 0, 1);
    const projected = { x: from.x + dx * segmentT, y: from.y + dy * segmentT };
    const distance = Math.hypot(point.x - projected.x, point.y - projected.y);
    if (best === undefined || distance < best.distance) {
      best = {
        point: projected,
        labelT: clamp((traversed + segmentLength * segmentT) / totalLength, 0, 1),
        segmentIndex: index - 1,
        segmentT,
        distance,
      };
    }
    traversed += segmentLength;
  }
  return best;
}

function projectLabelToConnector(
  points: readonly InteractionPoint[],
  point: InteractionPoint,
  zoom: number,
): PolylineProjection | undefined {
  const projection = projectPointToPolyline(points, point);
  if (projection === undefined) {
    return undefined;
  }
  const from = points[projection.segmentIndex];
  const to = points[projection.segmentIndex + 1];
  if (from === undefined || to === undefined) {
    return projection;
  }
  const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  if (Math.hypot(point.x - midpoint.x, point.y - midpoint.y) * zoom > 18) {
    return projection;
  }
  const midpointProjection = projectPointToPolyline(points, midpoint);
  return midpointProjection ?? projection;
}

function pointAtPolylineT(
  points: readonly InteractionPoint[],
  t: number,
): InteractionPoint | undefined {
  if (points.length === 0) return undefined;
  if (points.length === 1) return points[0];
  const lengths: number[] = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const length = from === undefined || to === undefined ? 0 : Math.hypot(to.x - from.x, to.y - from.y);
    lengths.push(length);
    total += length;
  }
  if (total <= 0) return points[0];
  const target = clamp(t, 0, 1) * total;
  let traversed = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const length = lengths[index - 1] ?? 0;
    if (from === undefined || to === undefined || length <= 0) {
      traversed += length;
      continue;
    }
    if (traversed + length >= target) {
      const localT = clamp((target - traversed) / length, 0, 1);
      return { x: from.x + (to.x - from.x) * localT, y: from.y + (to.y - from.y) * localT };
    }
    traversed += length;
  }
  return points[points.length - 1];
}

function edgeLabelDisplayPoint(
  points: readonly InteractionPoint[],
  layout: EdgeLayoutOverride | undefined,
  fallbackT = 0.5,
): InteractionPoint | undefined {
  const base = pointAtPolylineT(points, layout?.labelT ?? fallbackT);
  if (base === undefined) return undefined;
  const offset = layout?.labelOffset ?? 0;
  switch (layout?.labelPlacement ?? 'above') {
    case 'above':
      return { x: base.x, y: base.y - 10 - offset };
    case 'below':
      return { x: base.x, y: base.y + 10 + offset };
    case 'on':
      return { x: base.x, y: base.y + offset };
  }
}

function connectorSegmentAt(
  connector: SceneConnectorGeometry,
  point: InteractionPoint,
  tolerance: number,
): number | undefined {
  const projection = projectPointToPolyline(connector.points, point);
  return projection !== undefined && projection.distance <= tolerance ? projection.segmentIndex : undefined;
}

function edgeLabelAt(
  document: OpenChartDocument,
  connector: SceneConnectorGeometry,
  point: InteractionPoint,
  tolerance: number,
): boolean {
  const edge = document.edges[connector.edgeId];
  if (edge === undefined || edge.label.trim().length === 0) return false;
  const labelPoint = edgeLabelDisplayPoint(connector.points, document.layout.edgeOverrides?.[edge.id]);
  return labelPoint !== undefined && Math.hypot(point.x - labelPoint.x, point.y - labelPoint.y) <= tolerance;
}

export type ConnectorDoubleClickAction = 'edit-label' | 'add-waypoint';

export function connectorDoubleClickAction(request: {
  readonly label: string;
  readonly wasSelected: boolean;
  readonly labelHit: boolean;
}): ConnectorDoubleClickAction {
  return request.label.trim().length === 0 || !request.wasSelected || request.labelHit
    ? 'edit-label'
    : 'add-waypoint';
}

function connectorLabelTextWidth(value: string, characterWidth: number): number {
  return Math.max(20, value.length * characterWidth);
}

function connectorLabelEllipsis(value: string, maxWidth: number, characterWidth: number): string {
  if (value.length === 0 || connectorLabelTextWidth(value, characterWidth) <= maxWidth) return value;
  const maxCharacters = Math.max(1, Math.floor(maxWidth / characterWidth) - 1);
  return `${value.slice(0, maxCharacters).trimEnd()}…`;
}

export function connectorLabelEditorStyle(
  document: OpenChartDocument,
  request: {
    readonly edgeId: string;
    readonly points: readonly InteractionPoint[];
    readonly labelT: number;
    readonly value: string;
    readonly camera: { readonly x: number; readonly y: number; readonly zoom: number };
  },
): CSSProperties | undefined {
  const edge = document.edges[request.edgeId];
  if (edge === undefined) return undefined;
  const point = edgeLabelDisplayPoint(
    request.points,
    { ...document.layout.edgeOverrides?.[edge.id], labelT: request.labelT },
    request.labelT,
  );
  if (point === undefined) return undefined;
  const style = document.styles[edge.styleId];
  const tokenLabel = typeof style?.tokens.label === 'string' && style.tokens.label.trim().length > 0
    ? style.tokens.label
    : undefined;
  const fallbackLabel = tokenLabel ?? style?.role ?? edge.styleId;
  const lineLabel = request.value || edge.semantic || fallbackLabel;
  const caption = request.value && edge.semantic
    ? edge.semantic
    : request.value
      ? edge.semantic
      : fallbackLabel;
  const fontSize = clamp(typeof edge.data.fontSize === 'number' ? edge.data.fontSize : 10, 8, 96);
  const lineHeight = clamp(typeof edge.data.lineHeight === 'number' ? edge.data.lineHeight : 1.2, 0.8, 3);
  const characterWidth = 5.6 * (fontSize / 10);
  const visualLabel = connectorLabelEllipsis(lineLabel, 300, characterWidth);
  const visualCaption = caption === '' ? '' : connectorLabelEllipsis(caption, 210, 5.1);
  const labelWidth = Math.min(
    320,
    Math.max(
      68,
      Math.max(
        connectorLabelTextWidth(visualLabel, characterWidth),
        connectorLabelTextWidth(visualCaption, 5.1),
      ) + 18,
    ),
  );
  const labelLineAdvance = fontSize * lineHeight;
  const labelY = point.y - (visualCaption ? Math.max(16, labelLineAdvance) : fontSize * 0.8);
  const backgroundY = labelY - 13;
  const backgroundHeight = visualCaption ? 31 : 20;
  const width = Math.max(140, labelWidth * request.camera.zoom);
  const height = Math.max(34, backgroundHeight * request.camera.zoom);
  const centerX = (point.x - request.camera.x) * request.camera.zoom;
  const centerY = (backgroundY + backgroundHeight / 2 - request.camera.y) * request.camera.zoom;
  const textColor = typeof edge.data.textColor === 'string' && /^#[0-9a-f]{6}$/i.test(edge.data.textColor)
    ? edge.data.textColor
    : undefined;
  return {
    left: centerX - width / 2,
    top: centerY - height / 2,
    width,
    height,
    fontSize: clamp(fontSize * request.camera.zoom, 11, 28),
    fontFamily: typeof edge.data.fontFamily === 'string' ? edge.data.fontFamily : 'Segoe UI, Arial, sans-serif',
    fontWeight: typeof edge.data.fontWeight === 'number' ? edge.data.fontWeight : 700,
    fontStyle: edge.data.fontStyle === 'italic' ? 'italic' : 'normal',
    textAlign: edge.data.textAlign === 'left' ? 'left' : edge.data.textAlign === 'right' ? 'right' : 'center',
    ...(textColor === undefined ? {} : { color: textColor }),
    textDecoration: edge.data.underline === true ? 'underline' : 'none',
    lineHeight,
  };
}

export function edgeLabelTransaction(
  document: OpenChartDocument,
  request: {
    readonly txId: string;
    readonly edgeId: string;
    readonly label: string;
    readonly labelT?: number;
  },
): OperationEnvelope | undefined {
  const edge = document.edges[request.edgeId];
  if (edge === undefined) return undefined;
  const operations: Operation[] = [];
  if (edge.label !== request.label) {
    operations.push({ op: 'set_edge_label', id: edge.id, label: request.label });
  }
  const current = document.layout.edgeOverrides?.[edge.id];
  if (request.labelT !== undefined) {
    const labelT = clamp(request.labelT, 0, 1);
    if (current?.labelT !== labelT) {
      operations.push({
        op: 'set_edge_layout',
        id: edge.id,
        layout: { ...current, labelT },
      });
    }
  }
  if (operations.length === 0) return undefined;
  return {
    txId: request.txId,
    actor: 'user',
    origin: 'gui',
    baseRev: document.rev,
    ops: operations,
  };
}

export function edgeLabelPositionTransaction(
  document: OpenChartDocument,
  request: { readonly txId: string; readonly edgeId: string; readonly labelT: number },
): OperationEnvelope | undefined {
  const edge = document.edges[request.edgeId];
  if (edge === undefined) return undefined;
  const current = document.layout.edgeOverrides?.[edge.id];
  const labelT = clamp(request.labelT, 0, 1);
  if (current?.labelT === labelT) return undefined;
  return {
    txId: request.txId,
    actor: 'user',
    origin: 'gui',
    baseRev: document.rev,
    ops: [{ op: 'set_edge_layout', id: edge.id, layout: { ...current, labelT } }],
  };
}

type TextStyleField =
  | 'fontWeight'
  | 'fontStyle'
  | 'fontSize'
  | 'fontFamily'
  | 'textAlign'
  | 'textColor'
  | 'underline'
  | 'lineHeight';

export function edgeTextStyleTransaction(
  document: OpenChartDocument,
  request: {
    readonly txId: string;
    readonly edgeIds: readonly string[];
    readonly field: TextStyleField;
    readonly value: number | string | boolean;
  },
): OperationEnvelope | undefined {
  const edges = request.edgeIds
    .map((id) => document.edges[id])
    .filter((edge): edge is Edge => edge !== undefined);
  if (edges.length === 0) return undefined;
  return {
    txId: request.txId,
    actor: 'user',
    origin: 'gui',
    baseRev: document.rev,
    ops: edges.map((edge): Operation => ({
      op: 'set_edge_data',
      id: edge.id,
      data: { ...edge.data, [request.field]: request.value },
    })),
  };
}

function edgeLayoutWithWaypoints(
  current: EdgeLayoutOverride | undefined,
  waypoints: readonly InteractionPoint[],
): EdgeLayoutOverride | null {
  const rest = current === undefined
    ? {}
    : {
        ...(current.labelT === undefined ? {} : { labelT: current.labelT }),
        ...(current.labelPlacement === undefined ? {} : { labelPlacement: current.labelPlacement }),
        ...(current.labelOffset === undefined ? {} : { labelOffset: current.labelOffset }),
      };
  return waypoints.length === 0
    ? Object.keys(rest).length === 0 ? null : rest
    : { ...rest, waypoints: [...waypoints] };
}

export function edgeWaypointsTransaction(
  document: OpenChartDocument,
  request: {
    readonly txId: string;
    readonly edgeId: string;
    readonly waypoints: readonly InteractionPoint[];
  },
): OperationEnvelope | undefined {
  if (document.edges[request.edgeId] === undefined) return undefined;
  return {
    txId: request.txId,
    actor: 'user',
    origin: 'gui',
    baseRev: document.rev,
    ops: [{
      op: 'set_edge_layout',
      id: request.edgeId,
      layout: edgeLayoutWithWaypoints(document.layout.edgeOverrides?.[request.edgeId], request.waypoints),
    }],
  };
}

export function addEdgeWaypointTransaction(
  document: OpenChartDocument,
  request: {
    readonly txId: string;
    readonly edgeId: string;
    readonly geometryPoints: readonly InteractionPoint[];
    readonly point: InteractionPoint;
  },
): OperationEnvelope | undefined {
  const current = document.layout.edgeOverrides?.[request.edgeId]?.waypoints ?? [];
  const waypoints = [...current, request.point]
    .map((waypoint) => ({ waypoint, position: positionAlongPolyline(request.geometryPoints, waypoint) }))
    .sort((left, right) => left.position - right.position)
    .map(({ waypoint }) => waypoint);
  return edgeWaypointsTransaction(document, { txId: request.txId, edgeId: request.edgeId, waypoints });
}

function pointOnSegmentWithinTolerance(
  point: InteractionPoint,
  from: InteractionPoint,
  to: InteractionPoint,
  tolerance: number,
): boolean {
  const projection = projectPointToPolyline([from, to], point);
  return projection !== undefined && projection.distance <= tolerance && projection.segmentT > 0.02 && projection.segmentT < 0.98;
}

export function moveEdgeWaypointTransaction(
  document: OpenChartDocument,
  request: {
    readonly txId: string;
    readonly edgeId: string;
    readonly waypointIndex: number;
    readonly point: InteractionPoint;
    readonly from: InteractionPoint;
    readonly to: InteractionPoint;
    readonly collinearTolerance: number;
  },
): OperationEnvelope | undefined {
  const current = [...(document.layout.edgeOverrides?.[request.edgeId]?.waypoints ?? [])];
  if (current[request.waypointIndex] === undefined) return undefined;
  const previous = current[request.waypointIndex - 1] ?? request.from;
  const next = current[request.waypointIndex + 1] ?? request.to;
  if (pointOnSegmentWithinTolerance(request.point, previous, next, request.collinearTolerance)) {
    current.splice(request.waypointIndex, 1);
  } else {
    current[request.waypointIndex] = request.point;
  }
  return edgeWaypointsTransaction(document, { txId: request.txId, edgeId: request.edgeId, waypoints: current });
}

export function dragOrthogonalSegmentTransaction(
  document: OpenChartDocument,
  request: {
    readonly txId: string;
    readonly edgeId: string;
    readonly geometryPoints: readonly InteractionPoint[];
    readonly segmentIndex: number;
    readonly point: InteractionPoint;
  },
): OperationEnvelope | undefined {
  const from = request.geometryPoints[request.segmentIndex];
  const to = request.geometryPoints[request.segmentIndex + 1];
  if (from === undefined || to === undefined) return undefined;
  const horizontal = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
  const movedFrom = horizontal ? { x: from.x, y: request.point.y } : { x: request.point.x, y: from.y };
  const movedTo = horizontal ? { x: to.x, y: request.point.y } : { x: request.point.x, y: to.y };
  const current = [...(document.layout.edgeOverrides?.[request.edgeId]?.waypoints ?? [])];
  const endpointTolerance = 1;
  const replaceOrAppend = (original: InteractionPoint, moved: InteractionPoint): void => {
    const existingIndex = current.findIndex((waypoint) => Math.hypot(waypoint.x - original.x, waypoint.y - original.y) <= endpointTolerance);
    if (existingIndex >= 0) current[existingIndex] = moved;
    else current.push(moved);
  };
  replaceOrAppend(from, movedFrom);
  replaceOrAppend(to, movedTo);
  const waypoints = current
    .map((waypoint) => ({ waypoint, position: positionAlongPolyline(request.geometryPoints, waypoint) }))
    .sort((left, right) => left.position - right.position)
    .map(({ waypoint }) => waypoint)
    .filter((waypoint, index, all) => index === 0 || Math.hypot(waypoint.x - (all[index - 1]?.x ?? waypoint.x), waypoint.y - (all[index - 1]?.y ?? waypoint.y)) > 0.25);
  return edgeWaypointsTransaction(document, { txId: request.txId, edgeId: request.edgeId, waypoints });
}

interface CanvasStageProps {
  readonly document: OpenChartDocument;
  readonly scene: SceneDescription;
  readonly frames: Readonly<Record<string, TransformFrame>>;
  readonly displayFrames: Readonly<Record<string, TransformFrame>>;
  readonly items: readonly SelectableItem[];
  readonly selection: SelectionState;
  readonly camera: EditorCamera;
  readonly tool: EditorTool;
  readonly editing: TextEditState | null;
  readonly onCameraChange: (camera: EditorCamera) => void;
  readonly onViewportChange: (viewport: ViewportSize) => void;
  readonly onSelectionChange: (selection: SelectionState) => void;
  readonly onPreviewChange: (preview: TransformPreview | null) => void;
  readonly onTransformCommit: (preview: TransformPreview) => void;
  readonly onCreateConnector: (
    fromNodeId: string,
    toNodeId: string,
    fromSide: 'north' | 'east' | 'south' | 'west',
    toSide: 'north' | 'east' | 'south' | 'west',
  ) => void;
  readonly onCreateConnectedNode: (
    fromNodeId: string,
    fromSide: ConnectorSide,
    point: InteractionPoint,
  ) => void;
  readonly onRelinkEdge: (
    edgeId: string,
    endpoint: 'from' | 'to',
    nodeId: string,
    side: ConnectorSide,
  ) => void;
  readonly onDetachEdgeEndpoint: (
    edgeId: string,
    endpoint: 'from' | 'to',
    point: InteractionPoint,
  ) => void;
  readonly onAddEdgeWaypoint: (edgeId: string, point: InteractionPoint) => void;
  readonly onEdgeWaypointCommit: (
    edgeId: string,
    waypointIndex: number,
    point: InteractionPoint,
  ) => void;
  readonly onEdgeSegmentCommit: (
    edgeId: string,
    segmentIndex: number,
    point: InteractionPoint,
  ) => void;
  readonly onBeginTextEdit: (id: string, initialValue?: string) => void;
  readonly onBeginEdgeLabelEdit: (edgeId: string, labelT: number) => void;
  readonly onEdgeLabelPositionCommit: (edgeId: string, labelT: number) => void;
  readonly onEditTextChange: (value: string) => void;
  readonly onCommitTextEdit: () => void;
  readonly onCancelTextEdit: () => void;
  readonly onShapeDrop: (point: InteractionPoint) => void;
  readonly shapeDragActive: boolean;
}

function CanvasStage({
  document,
  scene,
  frames,
  displayFrames,
  items,
  selection,
  camera,
  tool,
  editing,
  onCameraChange,
  onViewportChange,
  onSelectionChange,
  onPreviewChange,
  onTransformCommit,
  onCreateConnector,
  onCreateConnectedNode,
  onRelinkEdge,
  onDetachEdgeEndpoint,
  onAddEdgeWaypoint,
  onEdgeWaypointCommit,
  onEdgeSegmentCommit,
  onBeginTextEdit,
  onBeginEdgeLabelEdit,
  onEdgeLabelPositionCommit,
  onEditTextChange,
  onCommitTextEdit,
  onCancelTextEdit,
  onShapeDrop,
  shapeDragActive,
}: CanvasStageProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const backgroundRef = useRef<HTMLCanvasElement | null>(null);
  const mainRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const latestPreviewRef = useRef<TransformPreview | null>(null);
  const fittedRef = useRef(false);
  const [viewport, setViewport] = useState<ViewportSize>({ width: 1, height: 1 });
  const [marquee, setMarquee] = useState<InteractionRect | null>(null);
  const [lasso, setLasso] = useState<readonly InteractionPoint[]>([]);
  const [snapVisuals, setSnapVisuals] = useState<SnapVisuals>({ guides: [] });
  const [connectorStartId, setConnectorStartId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [connectorDragPreview, setConnectorDragPreview] = useState<ConnectorDragPreview | null>(null);
  const [waypointPreview, setWaypointPreview] = useState<{
    readonly edgeId: string;
    readonly waypointIndex: number;
    readonly point: InteractionPoint;
  } | null>(null);
  const [labelPreview, setLabelPreview] = useState<{
    readonly edgeId: string;
    readonly labelT: number;
    readonly point: InteractionPoint;
  } | null>(null);
  const [segmentPreview, setSegmentPreview] = useState<{
    readonly edgeId: string;
    readonly segmentIndex: number;
    readonly from: InteractionPoint;
    readonly to: InteractionPoint;
  } | null>(null);
  const renderer = useMemo(() => new SceneViewportRenderer(scene), [scene]);
  const caches = useMemo(createEditorRasterCaches, []);
  useEffect(() => () => {
    caches.chromeCache.clear();
    caches.textCache.clear();
  }, [caches]);
  const moveSnapCandidates = useMemo(() => {
    const selected = new Set(selection.selectedIds);
    return items.filter((item) => !selected.has(item.id) && !item.hidden && !item.locked)
      .map((item) => ({
        id: item.id,
        bounds: item.bounds,
        onScreen:
          item.bounds.x + item.bounds.width >= camera.x &&
          item.bounds.x <= camera.x + viewport.width / camera.zoom &&
          item.bounds.y + item.bounds.height >= camera.y &&
          item.bounds.y <= camera.y + viewport.height / camera.zoom,
      }));
  }, [camera, items, selection.selectedIds, viewport]);
  const connectors = scene.connectors ?? [];
  const selectedBounds = useMemo(
    () => selectionBounds(selection.selectedIds, displayFrames),
    [displayFrames, selection.selectedIds],
  );
  const rotatable = selection.selectedIds.length > 0 && selection.selectedIds.every((id) => {
    const node = document.nodes[id];
    return node !== undefined && node.container === undefined && node.group === undefined;
  });

  const updatePreview = useCallback(
    (nextPreview: TransformPreview | null) => {
      latestPreviewRef.current = nextPreview;
      onPreviewChange(nextPreview);
    },
    [onPreviewChange],
  );

  useEffect(() => {
    if (tool !== 'connector') {
      setConnectorStartId(null);
    }
  }, [tool]);

  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) {
        return;
      }
      const nextViewport = {
        width: Math.max(1, Math.floor(entry.contentRect.width)),
        height: Math.max(1, Math.floor(entry.contentRect.height)),
      };
      setViewport(nextViewport);
      onViewportChange(nextViewport);
      if (!fittedRef.current && nextViewport.width > 100 && nextViewport.height > 100) {
        fittedRef.current = true;
        onCameraChange(fitCamera(scene, nextViewport));
      }
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [onCameraChange, onViewportChange, scene]);

  useEffect(() => {
    paintCanvasLayer(backgroundRef.current, renderer, viewportCamera(camera, viewport), 'background');
  }, [camera, renderer, viewport]);

  useEffect(() => {
    paintCanvasLayer(mainRef.current, renderer, viewportCamera(camera, viewport), 'main', caches);
  }, [caches, camera, renderer, viewport]);

  useEffect(() => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const overlay = paintCanvasLayer(overlayRef.current, renderer, viewportCamera(camera, viewport), 'overlay');
    if (overlay === undefined) {
      return;
    }
    overlay.setTransform(dpr, 0, 0, dpr, 0, 0);
    overlay.save();
    overlay.lineWidth = 1.5;
    overlay.strokeStyle = '#2563EB';
    overlay.fillStyle = '#FFFFFF';
    const selectedEdgeIds = new Set(
      selection.selectedIds.filter((id) => document.edges[id] !== undefined),
    );
    for (const connector of connectors) {
      if (!selectedEdgeIds.has(connector.edgeId)) {
        continue;
      }
      traceScenePath(overlay, connector.commands, camera);
      overlay.strokeStyle = 'rgba(37, 99, 235, 0.35)';
      overlay.lineWidth = 7;
      overlay.stroke();
      traceScenePath(overlay, connector.commands, camera);
      overlay.strokeStyle = '#2563EB';
      overlay.lineWidth = 1.5;
      overlay.setLineDash([5, 4]);
      overlay.stroke();
      overlay.setLineDash([]);
      for (const endpoint of [connector.from, connector.to]) {
        const screen = screenPoint(endpoint, camera);
        overlay.fillStyle = '#FFFFFF';
        overlay.strokeStyle = '#2563EB';
        overlay.beginPath();
        overlay.arc(screen.x, screen.y, 5, 0, Math.PI * 2);
        overlay.fill();
        overlay.stroke();
      }
      const waypoints = document.layout.edgeOverrides?.[connector.edgeId]?.waypoints ?? [];
      waypoints.forEach((waypoint, waypointIndex) => {
        const preview =
          waypointPreview?.edgeId === connector.edgeId &&
          waypointPreview.waypointIndex === waypointIndex
            ? waypointPreview.point
            : waypoint;
        const screen = screenPoint(preview, camera);
        overlay.fillStyle = '#FFFFFF';
        overlay.strokeStyle = '#D97706';
        overlay.fillRect(screen.x - 5, screen.y - 5, 10, 10);
        overlay.strokeRect(screen.x - 5, screen.y - 5, 10, 10);
      });
      if (connector.mode === 'orthogonal') {
        for (let segmentIndex = 0; segmentIndex < connector.points.length - 1; segmentIndex += 1) {
          const from = connector.points[segmentIndex];
          const to = connector.points[segmentIndex + 1];
          if (from === undefined || to === undefined) continue;
          const midpoint = screenPoint({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, camera);
          overlay.beginPath();
          overlay.arc(midpoint.x, midpoint.y, 3.25, 0, Math.PI * 2);
          overlay.fillStyle = '#EFF6FF';
          overlay.strokeStyle = '#2563EB';
          overlay.fill();
          overlay.stroke();
        }
      }
      const edge = document.edges[connector.edgeId];
      if (edge !== undefined && edge.label.trim().length > 0) {
        const labelPoint = labelPreview?.edgeId === edge.id
          ? labelPreview.point
          : edgeLabelDisplayPoint(connector.points, document.layout.edgeOverrides?.[edge.id]);
        if (labelPoint !== undefined) {
          const screen = screenPoint(labelPoint, camera);
          overlay.fillStyle = '#FFFFFF';
          overlay.strokeStyle = '#2563EB';
          overlay.fillRect(screen.x - 3.5, screen.y - 3.5, 7, 7);
          overlay.strokeRect(screen.x - 3.5, screen.y - 3.5, 7, 7);
        }
      }
    }
    if (segmentPreview !== null) {
      const from = screenPoint(segmentPreview.from, camera);
      const to = screenPoint(segmentPreview.to, camera);
      overlay.beginPath();
      overlay.moveTo(from.x, from.y);
      overlay.lineTo(to.x, to.y);
      overlay.strokeStyle = '#D97706';
      overlay.lineWidth = 3;
      overlay.setLineDash([6, 4]);
      overlay.stroke();
      overlay.setLineDash([]);
    }
    const connectionHandleItems = tool === 'connector'
      ? items
      : hoveredNodeId === null
        ? []
        : items.filter((item) => item.id === hoveredNodeId);
    const connectionHandleOffset = tool === 'connector' ? 0 : CONNECTOR_HANDLE_OFFSET_PX / camera.zoom;
    overlay.lineWidth = 1.25;
    for (const item of connectionHandleItems) {
      if (item.kind !== 'node' || item.hidden === true || item.locked === true) {
        continue;
      }
      const connectorStartNodeId = connectorStartId?.slice(0, connectorStartId.lastIndexOf(':'));
      const connectorStartSide = connectorStartId?.slice(connectorStartId.lastIndexOf(':') + 1);
      for (const side of ['north', 'east', 'south', 'west'] as const) {
        const screen = screenPoint(connectorPortPoint(item.bounds, side, connectionHandleOffset), camera);
        const active = item.id === connectorStartNodeId && side === connectorStartSide;
        overlay.beginPath();
        overlay.arc(screen.x, screen.y, active ? 5 : tool === 'connector' ? 3.5 : 4.25, 0, Math.PI * 2);
        overlay.fillStyle = active ? '#F59E0B' : '#FFFFFF';
        overlay.strokeStyle = active ? '#B45309' : tool === 'connector' ? '#2563EB' : '#0F766E';
        overlay.fill();
        overlay.stroke();
      }
    }
    if (connectorDragPreview !== null) {
      const from = screenPoint(connectorDragPreview.from, camera);
      const to = screenPoint(connectorDragPreview.to, camera);
      const middleX = (from.x + to.x) / 2;
      overlay.beginPath();
      overlay.moveTo(from.x, from.y);
      overlay.lineTo(middleX, from.y);
      overlay.lineTo(middleX, to.y);
      overlay.lineTo(to.x, to.y);
      overlay.lineWidth = 2;
      overlay.strokeStyle = connectorDragPreview.target === undefined ? '#2563EB' : '#0F766E';
      overlay.setLineDash([6, 4]);
      overlay.stroke();
      overlay.setLineDash([]);
      if (connectorDragPreview.target !== undefined) {
        overlay.beginPath();
        overlay.arc(to.x, to.y, 6, 0, Math.PI * 2);
        overlay.fillStyle = '#ECFDF5';
        overlay.strokeStyle = '#0F766E';
        overlay.fill();
        overlay.stroke();
      }
    }
    overlay.lineWidth = 1.5;
    overlay.strokeStyle = '#2563EB';
    overlay.fillStyle = '#FFFFFF';
    if (selectedBounds !== undefined) {
      const topLeft = screenPoint(selectedBounds, camera);
      overlay.strokeRect(
        Math.round(topLeft.x) + 0.5,
        Math.round(topLeft.y) + 0.5,
        selectedBounds.width * camera.zoom,
        selectedBounds.height * camera.zoom,
      );
      for (const point of Object.values(handlePoints(selectedBounds))) {
        const screen = screenPoint(point, camera);
        overlay.fillRect(screen.x - 4, screen.y - 4, 8, 8);
        overlay.strokeRect(screen.x - 4, screen.y - 4, 8, 8);
      }
      if (rotatable) {
        const rotate = screenPoint(
          {
            x: selectedBounds.x + selectedBounds.width / 2,
            y: selectedBounds.y - 30 / camera.zoom,
          },
          camera,
        );
        const north = screenPoint(
          { x: selectedBounds.x + selectedBounds.width / 2, y: selectedBounds.y },
          camera,
        );
        overlay.beginPath();
        overlay.moveTo(north.x, north.y);
        overlay.lineTo(rotate.x, rotate.y);
        overlay.stroke();
        overlay.beginPath();
        overlay.arc(rotate.x, rotate.y, 5, 0, Math.PI * 2);
        overlay.fill();
        overlay.stroke();
      }
    }
    if (marquee !== null) {
      const start = screenPoint({ x: marquee.x, y: marquee.y }, camera);
      overlay.fillStyle = 'rgba(37, 99, 235, 0.10)';
      overlay.strokeStyle = '#2563EB';
      overlay.setLineDash([5, 4]);
      overlay.fillRect(start.x, start.y, marquee.width * camera.zoom, marquee.height * camera.zoom);
      overlay.strokeRect(start.x, start.y, marquee.width * camera.zoom, marquee.height * camera.zoom);
      overlay.setLineDash([]);
    }
    if (lasso.length > 1) {
      overlay.beginPath();
      const first = screenPoint(lasso[0] ?? { x: 0, y: 0 }, camera);
      overlay.moveTo(first.x, first.y);
      for (const point of lasso.slice(1)) {
        const next = screenPoint(point, camera);
        overlay.lineTo(next.x, next.y);
      }
      overlay.strokeStyle = '#2563EB';
      overlay.setLineDash([4, 4]);
      overlay.stroke();
      overlay.setLineDash([]);
    }
    for (const guide of snapVisuals.guides) {
      overlay.beginPath();
      overlay.strokeStyle = guide.kind === 'user' ? '#D97706' : '#2563EB';
      overlay.setLineDash(guide.style === 'dotted' ? [2, 4] : []);
      if (guide.axis === 'x') {
        const x = (guide.position - camera.x) * camera.zoom;
        overlay.moveTo(x, 0);
        overlay.lineTo(x, viewport.height);
      } else {
        const y = (guide.position - camera.y) * camera.zoom;
        overlay.moveTo(0, y);
        overlay.lineTo(viewport.width, y);
      }
      overlay.stroke();
    }
    if (snapVisuals.coordinates !== undefined && selectedBounds !== undefined) {
      const at = screenPoint(
        {
          x: selectedBounds.x + selectedBounds.width / 2,
          y: selectedBounds.y + selectedBounds.height,
        },
        camera,
      );
      const label = `X ${Math.round(snapVisuals.coordinates.x)}  Y ${Math.round(snapVisuals.coordinates.y)}`;
      overlay.font = '600 11px Consolas, monospace';
      const metrics = overlay.measureText(label);
      overlay.fillStyle = '#0F172A';
      overlay.fillRect(at.x - metrics.width / 2 - 7, at.y + 10, metrics.width + 14, 22);
      overlay.fillStyle = '#FFFFFF';
      overlay.textAlign = 'center';
      overlay.textBaseline = 'middle';
      overlay.fillText(label, at.x, at.y + 21);
    }
    overlay.restore();
  }, [
    camera,
    connectorDragPreview,
    connectorStartId,
    connectors,
    document.edges,
    document.layout.edgeOverrides,
    hoveredNodeId,
    items,
    labelPreview,
    lasso,
    marquee,
    renderer,
    rotatable,
    selectedBounds,
    selection.selectedIds,
    segmentPreview,
    snapVisuals,
    tool,
    viewport,
    waypointPreview,
  ]);

  useEffect(() => {
    if (gestureRef.current === null && latestPreviewRef.current === null) return;
    gestureRef.current = null;
    setMarquee(null);
    setLasso([]);
    setWaypointPreview(null);
    setLabelPreview(null);
    setSegmentPreview(null);
    setConnectorDragPreview(null);
    setSnapVisuals({ guides: [] });
    updatePreview(null);
  }, [document, updatePreview]);

  const releaseGesture = useCallback(
    (canvas: HTMLCanvasElement, pointerId: number, cancelled = false) => {
      if (canvas.hasPointerCapture(pointerId)) {
        canvas.releasePointerCapture(pointerId);
      }
      const gesture = gestureRef.current;
      if (!cancelled && gesture?.mode === 'marquee' && marquee !== null) {
        onSelectionChange(selectMarquee(selection, items, marquee));
      } else if (!cancelled && gesture?.mode === 'lasso' && lasso.length >= 3) {
        onSelectionChange(selectLasso(selection, items, lasso));
      } else if (
        !cancelled &&
        (gesture?.mode === 'move' || gesture?.mode === 'resize' || gesture?.mode === 'rotate') &&
        latestPreviewRef.current !== null
      ) {
        onTransformCommit(latestPreviewRef.current);
      } else if (
        !cancelled &&
        gesture?.mode === 'waypoint' &&
        gesture.moved &&
        waypointPreview?.edgeId === gesture.edgeId &&
        waypointPreview.waypointIndex === gesture.waypointIndex
      ) {
        onEdgeWaypointCommit(
          gesture.edgeId,
          gesture.waypointIndex,
          waypointPreview.point,
        );
      } else if (!cancelled && gesture?.mode === 'edge-label' && gesture.moved) {
        onEdgeLabelPositionCommit(gesture.edgeId, gesture.labelT);
      } else if (!cancelled && gesture?.mode === 'edge-segment' && gesture.moved) {
        onEdgeSegmentCommit(gesture.edgeId, gesture.segmentIndex, gesture.current);
      } else if (!cancelled && gesture?.mode === 'connector-create' && gesture.moved) {
        if (gesture.target === undefined) {
          onCreateConnectedNode(gesture.source.nodeId, gesture.source.side, gesture.current);
        } else {
          commitConnectorCreation(onCreateConnector, gesture.source, gesture.target);
        }
      } else if (!cancelled && gesture?.mode === 'connector-reconnect' && gesture.moved) {
        if (gesture.target === undefined) {
          onDetachEdgeEndpoint(gesture.edgeId, gesture.endpoint, gesture.current);
        } else {
          onRelinkEdge(
            gesture.edgeId,
            gesture.endpoint,
            gesture.target.nodeId,
            gesture.target.side,
          );
        }
      }
      gestureRef.current = null;
      setMarquee(null);
      setLasso([]);
      setWaypointPreview(null);
      setLabelPreview(null);
      setSegmentPreview(null);
      setConnectorDragPreview(null);
      setHoveredNodeId(null);
      setSnapVisuals({ guides: [] });
      updatePreview(null);
    },
    [
      items,
      lasso,
      marquee,
      onCreateConnectedNode,
      onCreateConnector,
      onDetachEdgeEndpoint,
      onEdgeLabelPositionCommit,
      onEdgeSegmentCommit,
      onEdgeWaypointCommit,
      onRelinkEdge,
      onSelectionChange,
      onTransformCommit,
      selection,
      updatePreview,
      waypointPreview,
    ],
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0 && event.button !== 1) {
      return;
    }
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = worldPoint(event, camera);
    if (tool === 'pan' || event.button === 1) {
      gestureRef.current = {
        mode: 'pan',
        startClient: { x: event.clientX, y: event.clientY },
        camera,
      };
      return;
    }
    if (tool === 'connector') {
      const port = connectorPortAt(items, point, 12 / camera.zoom);
      if (port === undefined) {
        if (connectorStartId === null) {
          onSelectionChange(clearSelection(selection));
        } else {
          const separator = connectorStartId.lastIndexOf(':');
          const fromNodeId = separator < 0 ? connectorStartId : connectorStartId.slice(0, separator);
          const fromSide = separator < 0 ? 'east' : connectorStartId.slice(separator + 1) as 'north' | 'east' | 'south' | 'west';
          onCreateConnectedNode(fromNodeId, fromSide, point);
        }
        setConnectorStartId(null);
      } else {
        if (connectorStartId === null) {
          setConnectorStartId(`${port.nodeId}:${port.side}`);
          onSelectionChange({ scopeId: selection.scopeId, selectedIds: [port.nodeId] });
        } else {
          const separator = connectorStartId.lastIndexOf(':');
          const fromNodeId = separator < 0 ? connectorStartId : connectorStartId.slice(0, separator);
          const fromSide = separator < 0 ? 'east' : connectorStartId.slice(separator + 1) as 'north' | 'east' | 'south' | 'west';
          if (fromNodeId === port.nodeId) {
            setConnectorStartId(null);
            onSelectionChange({ scopeId: selection.scopeId, selectedIds: [port.nodeId] });
          } else {
            commitConnectorCreation(
              onCreateConnector,
              { nodeId: fromNodeId, side: fromSide, point },
              port,
            );
            setConnectorStartId(null);
          }
        }
      }
      return;
    }
    if (tool === 'lasso') {
      const points = [point];
      gestureRef.current = { mode: 'lasso', points };
      setLasso(points);
      return;
    }
    const selectedEdgeId = selection.selectedIds.length === 1 &&
      document.edges[selection.selectedIds[0] ?? ''] !== undefined
      ? selection.selectedIds[0]
      : undefined;
    if (selectedEdgeId !== undefined) {
      const selectedConnector = connectors.find((connector) => connector.edgeId === selectedEdgeId);
      if (selectedConnector !== undefined) {
        const endpoint = connectorEndpointAt(selectedConnector, point, 9 / camera.zoom);
        if (endpoint !== undefined) {
          const fixed = endpoint === 'from' ? selectedConnector.to : selectedConnector.from;
          gestureRef.current = {
            mode: 'connector-reconnect',
            edgeId: selectedEdgeId,
            endpoint,
            fixed,
            startPointer: point,
            current: point,
            moved: false,
          };
          setConnectorDragPreview({
            from: endpoint === 'from' ? point : fixed,
            to: endpoint === 'to' ? point : fixed,
          });
          return;
        }
        if (edgeLabelAt(document, selectedConnector, point, 16 / camera.zoom)) {
          const labelT = document.layout.edgeOverrides?.[selectedEdgeId]?.labelT ?? 0.5;
          const labelPoint = edgeLabelDisplayPoint(
            selectedConnector.points,
            document.layout.edgeOverrides?.[selectedEdgeId],
            labelT,
          ) ?? point;
          gestureRef.current = {
            mode: 'edge-label',
            edgeId: selectedEdgeId,
            startPointer: point,
            current: labelPoint,
            labelT,
            moved: false,
          };
          setLabelPreview({ edgeId: selectedEdgeId, labelT, point: labelPoint });
          return;
        }
      }
      const waypointIndex = waypointAt(document, selectedEdgeId, point, 8 / camera.zoom);
      if (waypointIndex !== undefined) {
        gestureRef.current = {
          mode: 'waypoint',
          edgeId: selectedEdgeId,
          waypointIndex,
          startPointer: point,
          current: point,
          moved: false,
        };
        setWaypointPreview({ edgeId: selectedEdgeId, waypointIndex, point });
        return;
      }
      if (selectedConnector?.mode === 'orthogonal') {
        const segmentIndex = connectorSegmentAt(selectedConnector, point, 7 / camera.zoom);
        if (segmentIndex !== undefined) {
          gestureRef.current = {
            mode: 'edge-segment',
            edgeId: selectedEdgeId,
            segmentIndex,
            startPointer: point,
            current: point,
            moved: false,
          };
          return;
        }
      }
    }
    if (tool === 'select' && hoveredNodeId !== null) {
      const port = connectorPortAt(
        items,
        point,
        9 / camera.zoom,
        CONNECTOR_HANDLE_OFFSET_PX / camera.zoom,
        hoveredNodeId,
      );
      if (port !== undefined) {
        gestureRef.current = {
          mode: 'connector-create',
          source: port,
          startPointer: point,
          current: point,
          moved: false,
        };
        setConnectorDragPreview({ from: port.point, to: point });
        onSelectionChange({ scopeId: selection.scopeId, selectedIds: [port.nodeId] });
        return;
      }
    }
    if (selectedBounds !== undefined && selection.selectedIds.length > 0) {
      const control = hitTransformControl(point, selectedBounds, camera, rotatable);
      if (control?.kind === 'resize') {
        gestureRef.current = {
          mode: 'resize',
          startWorld: point,
          selectedIds: selection.selectedIds,
          handle: control.handle,
        };
        return;
      }
      if (control?.kind === 'rotate') {
        const center = {
          x: selectedBounds.x + selectedBounds.width / 2,
          y: selectedBounds.y + selectedBounds.height / 2,
        };
        gestureRef.current = {
          mode: 'rotate',
          center,
          startAngle: Math.atan2(point.y - center.y, point.x - center.x),
          selectedIds: selection.selectedIds,
        };
        return;
      }
    }
    let nextSelection = selectAt(selection, items, point, { toggle: event.shiftKey });
    if (nextSelection.selectedIds.length === 0) {
      const connector = connectorAt(connectors, point, 7 / camera.zoom);
      if (connector !== undefined) {
        nextSelection = selectConnector(
          selection,
          document,
          connector.edgeId,
          event.shiftKey,
        );
      }
    }
    onSelectionChange(nextSelection);
    if (
      nextSelection.selectedIds.length > 0 &&
      nextSelection.selectedIds.every((id) => document.nodes[id] !== undefined)
    ) {
      gestureRef.current = {
        mode: 'move',
        startWorld: point,
        selectedIds: nextSelection.selectedIds,
      };
    } else if (nextSelection.selectedIds.length === 0) {
      gestureRef.current = { mode: 'marquee', startWorld: point };
      setMarquee({ x: point.x, y: point.y, width: 0, height: 0 });
    } else {
      gestureRef.current = null;
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const gesture = gestureRef.current;
    const point = worldPoint(event, camera);
    if (gesture === null) {
      setHoveredNodeId(hoveredConnectorNodeId(items, point, 18 / camera.zoom) ?? null);
      return;
    }
    if (gesture.mode === 'pan') {
      onCameraChange({
        ...gesture.camera,
        x: gesture.camera.x - (event.clientX - gesture.startClient.x) / gesture.camera.zoom,
        y: gesture.camera.y - (event.clientY - gesture.startClient.y) / gesture.camera.zoom,
      });
      return;
    }
    if (gesture.mode === 'connector-create') {
      const target = connectorTargetAt(items, point, camera, gesture.source.nodeId);
      const snapped = target === undefined
        ? snapConnectorPoint(items, point, camera, viewport, gesture.source.nodeId)
        : { point: target.point, visuals: { guides: [] } satisfies SnapVisuals };
      const moved = gesture.moved || connectorDragExceededThreshold(gesture.startPointer, point, camera.zoom);
      gestureRef.current = {
        ...gesture,
        current: snapped.point,
        moved,
        ...(target === undefined ? {} : { target }),
      };
      setConnectorDragPreview({
        from: gesture.source.point,
        to: snapped.point,
        ...(target === undefined ? {} : { target }),
      });
      setSnapVisuals(snapped.visuals);
      setHoveredNodeId(target?.nodeId ?? gesture.source.nodeId);
      return;
    }
    if (gesture.mode === 'connector-reconnect') {
      const target = connectorTargetAt(items, point, camera);
      const snapped = target === undefined
        ? snapConnectorPoint(items, point, camera, viewport)
        : { point: target.point, visuals: { guides: [] } satisfies SnapVisuals };
      const moved = gesture.moved || connectorDragExceededThreshold(gesture.startPointer, point, camera.zoom);
      gestureRef.current = {
        ...gesture,
        current: snapped.point,
        moved,
        ...(target === undefined ? {} : { target }),
      };
      const moving = snapped.point;
      setConnectorDragPreview({
        from: gesture.endpoint === 'from' ? moving : gesture.fixed,
        to: gesture.endpoint === 'to' ? moving : gesture.fixed,
        ...(target === undefined ? {} : { target }),
      });
      setSnapVisuals(snapped.visuals);
      setHoveredNodeId(target?.nodeId ?? null);
      return;
    }
    if (gesture.mode === 'edge-label') {
      const connector = connectors.find((candidate) => candidate.edgeId === gesture.edgeId);
      const projection = connector === undefined
        ? undefined
        : projectLabelToConnector(connector.points, point, camera.zoom);
      if (connector !== undefined && projection !== undefined) {
        const moved = gesture.moved || connectorDragExceededThreshold(gesture.startPointer, point, camera.zoom);
        const displayPoint = edgeLabelDisplayPoint(
          connector.points,
          { ...document.layout.edgeOverrides?.[gesture.edgeId], labelT: projection.labelT },
          projection.labelT,
        ) ?? projection.point;
        gestureRef.current = {
          ...gesture,
          current: displayPoint,
          labelT: projection.labelT,
          moved,
        };
        setLabelPreview({ edgeId: gesture.edgeId, labelT: projection.labelT, point: displayPoint });
      }
      return;
    }
    if (gesture.mode === 'edge-segment') {
      const connector = connectors.find((candidate) => candidate.edgeId === gesture.edgeId);
      const from = connector?.points[gesture.segmentIndex];
      const to = connector?.points[gesture.segmentIndex + 1];
      const moved = gesture.moved || connectorDragExceededThreshold(gesture.startPointer, point, camera.zoom);
      if (from !== undefined && to !== undefined) {
        const horizontal = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
        const previewFrom = horizontal ? { x: from.x, y: point.y } : { x: point.x, y: from.y };
        const previewTo = horizontal ? { x: to.x, y: point.y } : { x: point.x, y: to.y };
        gestureRef.current = { ...gesture, current: point, moved };
        setSegmentPreview({ edgeId: gesture.edgeId, segmentIndex: gesture.segmentIndex, from: previewFrom, to: previewTo });
      }
      return;
    }
    if (gesture.mode === 'marquee') {
      setMarquee({
        x: gesture.startWorld.x,
        y: gesture.startWorld.y,
        width: point.x - gesture.startWorld.x,
        height: point.y - gesture.startWorld.y,
      });
      return;
    }
    if (gesture.mode === 'lasso') {
      const prior = gesture.points[gesture.points.length - 1];
      if (prior === undefined || Math.hypot(point.x - prior.x, point.y - prior.y) * camera.zoom >= 4) {
        const points = [...gesture.points, point];
        gestureRef.current = { mode: 'lasso', points };
        setLasso(points);
      }
      return;
    }
    if (gesture.mode === 'waypoint') {
      const moved = gesture.moved || connectorDragExceededThreshold(gesture.startPointer, point, camera.zoom);
      gestureRef.current = { ...gesture, current: point, moved };
      setWaypointPreview({
        edgeId: gesture.edgeId,
        waypointIndex: gesture.waypointIndex,
        point,
      });
      return;
    }
    try {
      if (gesture.mode === 'move') {
        const rawDelta = {
          x: point.x - gesture.startWorld.x,
          y: point.y - gesture.startWorld.y,
        };
        let nextPreview = translateSelection(document, frames, gesture.selectedIds, rawDelta);
        const snap = snapBounds({
          movingId: gesture.selectedIds.join('|'),
          bounds: nextPreview.selectionBounds,
          candidates: moveSnapCandidates,
          settings: {
            snapToGrid: true,
            snapToObjects: true,
            snapToGuides: true,
            threshold: 7 / camera.zoom,
            gridSize: 8,
          },
        });
        if (snap.delta.x !== 0 || snap.delta.y !== 0) {
          nextPreview = translateSelection(document, frames, gesture.selectedIds, {
            x: rawDelta.x + snap.delta.x,
            y: rawDelta.y + snap.delta.y,
          });
        }
        setSnapVisuals({
          guides: snap.alignmentGuides,
          coordinates: snap.coordinates,
        });
        updatePreview(nextPreview);
      } else if (gesture.mode === 'resize') {
        updatePreview(
          resizeSelection(
            document,
            frames,
            gesture.selectedIds,
            gesture.handle,
            {
              x: point.x - gesture.startWorld.x,
              y: point.y - gesture.startWorld.y,
            },
            { fromCenter: event.altKey, keepAspectRatio: event.shiftKey },
          ),
        );
      } else {
        const angle = Math.atan2(point.y - gesture.center.y, point.x - gesture.center.x);
        const deltaDegrees = ((angle - gesture.startAngle) * 180) / Math.PI;
        updatePreview(
          rotateSelection(document, frames, gesture.selectedIds, deltaDegrees, {
            ...(event.shiftKey ? { snapIncrement: 15 } : {}),
          }),
        );
      }
    } catch {
      updatePreview(null);
    }
  };

  const handleWheel = (event: ReactWheelEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.ctrlKey || Math.abs(event.deltaY) > Math.abs(event.deltaX) * 2) {
      const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const anchor = {
        x: camera.x + screen.x / camera.zoom,
        y: camera.y + screen.y / camera.zoom,
      };
      const zoom = clamp(camera.zoom * Math.exp(-event.deltaY * 0.0015), 0.1, 4);
      onCameraChange({
        x: anchor.x - screen.x / zoom,
        y: anchor.y - screen.y / zoom,
        zoom,
      });
    } else {
      onCameraChange({
        ...camera,
        x: camera.x + event.deltaX / camera.zoom,
        y: camera.y + event.deltaY / camera.zoom,
      });
    }
  };

  const handleDoubleClick = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (tool === 'connector') {
      return;
    }
    const point = worldPoint(event, camera);
    const next = selectAt(selection, items, point);
    const id = next.selectedIds[0];
    if (id !== undefined) {
      onSelectionChange(next);
      onBeginTextEdit(id);
      return;
    }
    const connector = connectorAt(connectors, point, 7 / camera.zoom);
    if (connector !== undefined) {
      const edge = document.edges[connector.edgeId];
      const wasSelected = selection.selectedIds.length === 1 && selection.selectedIds[0] === connector.edgeId;
      onSelectionChange(selectConnector(selection, document, connector.edgeId, false));
      if (edge === undefined) return;
      const projection = projectLabelToConnector(connector.points, point, camera.zoom);
      const labelT = document.layout.edgeOverrides?.[edge.id]?.labelT ?? projection?.labelT ?? 0.5;
      const action = connectorDoubleClickAction({
        label: edge.label,
        wasSelected,
        labelHit: edgeLabelAt(document, connector, point, 18 / camera.zoom),
      });
      if (action === 'edit-label') {
        onBeginEdgeLabelEdit(edge.id, labelT);
      } else {
        onAddEdgeWaypoint(connector.edgeId, point);
      }
    }
  };

  const editFrame = editing?.kind === 'node' ? displayFrames[editing.id] : undefined;
  const editNode = editing?.kind === 'node' ? document.nodes[editing.id] : undefined;
  const editConnector = editing?.kind === 'edge'
    ? connectors.find((connector) => connector.edgeId === editing.id)
    : undefined;
  const editStyle: CSSProperties | undefined =
    editing?.kind === 'edge'
      ? editConnector === undefined
        ? undefined
        : connectorLabelEditorStyle(document, {
            edgeId: editing.id,
            points: editConnector.points,
            labelT: editing.labelT,
            value: editing.value,
            camera,
          })
      : editFrame === undefined
        ? undefined
        : editNode?.kind === 'text'
        ? {
            left: (editFrame.x - camera.x) * camera.zoom,
            top: (editFrame.y - camera.y) * camera.zoom,
            width: Math.max(120, editFrame.width * camera.zoom),
            height: Math.max(44, editFrame.height * camera.zoom),
            fontSize: clamp(18 * camera.zoom, 13, 28),
            fontFamily: typeof editNode.data.fontFamily === 'string'
              ? editNode.data.fontFamily
              : 'Aptos Display, Segoe UI, sans-serif',
            fontWeight: typeof editNode.data.fontWeight === 'number' ? editNode.data.fontWeight : 700,
            fontStyle: editNode.data.fontStyle === 'italic' ? 'italic' : 'normal',
            textAlign: editNode.data.textAlign === 'center'
              ? 'center'
              : editNode.data.textAlign === 'right'
                ? 'right'
                : 'left',
            color: typeof editNode.data.textColor === 'string' && /^#[0-9a-f]{6}$/i.test(editNode.data.textColor)
              ? editNode.data.textColor
              : undefined,
            textDecoration: editNode.data.underline === true ? 'underline' : 'none',
          }
    : {
            left: (editFrame.x + 15 - camera.x) * camera.zoom,
            top: (editFrame.y + 22 - camera.y) * camera.zoom,
            width: Math.max(120, (editFrame.width - 30) * camera.zoom),
            height: Math.max(38, 48 * camera.zoom),
            fontSize: clamp(18 * camera.zoom, 13, 24),
            fontFamily: typeof editNode?.data.fontFamily === 'string'
              ? editNode.data.fontFamily
              : 'Aptos Display, Segoe UI, sans-serif',
            fontWeight: typeof editNode?.data.fontWeight === 'number' ? editNode.data.fontWeight : 700,
            fontStyle: editNode?.data.fontStyle === 'italic' ? 'italic' : 'normal',
            textAlign: editNode?.data.textAlign === 'center'
              ? 'center'
              : editNode?.data.textAlign === 'right'
                ? 'right'
                : 'left',
            color: typeof editNode?.data.textColor === 'string' && /^#[0-9a-f]{6}$/i.test(editNode.data.textColor)
              ? editNode.data.textColor
              : undefined,
            textDecoration: editNode?.data.underline === true ? 'underline' : 'none',
          };

  return (
    <div
      className={`oc-canvas-stage${shapeDragActive ? ' is-shape-drag-target' : ''}`}
      ref={stageRef}
      aria-label="Diagram canvas"
      onDragOver={(event: ReactDragEvent<HTMLDivElement>) => {
        if (!shapeDragActive) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(event: ReactDragEvent<HTMLDivElement>) => {
        if (!shapeDragActive) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        onShapeDrop(canvasDropWorldPoint(event.clientX, event.clientY, rect, camera));
      }}
    >
      <canvas className="oc-canvas-layer" ref={backgroundRef} aria-hidden="true" />
      <canvas className="oc-canvas-layer" ref={mainRef} aria-hidden="true" />
      <canvas
        className={`oc-canvas-layer oc-canvas-overlay oc-tool-${tool}`}
        ref={overlayRef}
        tabIndex={0}
        aria-label="Interactive diagram canvas. Press Control Alt K for canvas navigation."
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => releaseGesture(event.currentTarget, event.pointerId)}
        onPointerCancel={(event) => releaseGesture(event.currentTarget, event.pointerId, true)}
        onLostPointerCapture={(event) => releaseGesture(event.currentTarget, event.pointerId, true)}
        onPointerLeave={() => {
          if (gestureRef.current === null) {
            setHoveredNodeId(null);
          }
        }}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
      />
      {editing !== null && editStyle !== undefined ? (
        <textarea
          className="oc-text-editor"
          style={editStyle}
          aria-label="Edit selected shape text"
          value={editing.value}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onEditTextChange(event.target.value)}
          onBlur={onCommitTextEdit}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onCancelTextEdit();
              return;
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onCommitTextEdit();
            }
          }}
          autoFocus
        />
      ) : null}
      <div className="oc-canvas-readout" aria-hidden="true">
        <span>{Math.round(camera.zoom * 100)}%</span>
      </div>
    </div>
  );
}

function Icon({ src, size = 18 }: { readonly src: string; readonly size?: number }) {
  return <img className="oc-icon" src={src} width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
}

function OpenChartBrand() {
  return (
    <div className="oc-brand" role="img" aria-label="OpenChart">
      <svg
        className="oc-brand-symbol"
        viewBox="0 0 32 32"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id="oc-brand-gradient" x1="6" y1="26" x2="27" y2="6" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#155EEF" />
            <stop offset="1" stopColor="#00A7B7" />
          </linearGradient>
        </defs>
        <path
          className="oc-logo-arc"
          d="M25.8 8.7A12 12 0 1 0 26.1 22.8"
          fill="none"
          stroke="url(#oc-brand-gradient)"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <path
          className="oc-logo-trend"
          d="m8.3 21.5 5.2-5.4 4.1 3.1 7.2-8.1m-4.2 0h4.2v4.2"
          fill="none"
          stroke="url(#oc-brand-gradient)"
          strokeWidth="2.35"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle className="oc-logo-node oc-logo-node-one" cx="8.3" cy="21.5" r="1.75" />
        <circle className="oc-logo-node oc-logo-node-two" cx="13.5" cy="16.1" r="1.75" />
        <circle className="oc-logo-node oc-logo-node-three" cx="17.6" cy="19.2" r="1.75" />
        <circle className="oc-logo-node oc-logo-live" cx="24.8" cy="11.1" r="2" />
      </svg>
      <span className="oc-brand-wordmark" aria-hidden="true">
        <span>Open</span><span className="oc-brand-chart">Chart</span>
      </span>
    </div>
  );
}

function ToolIcon({ kind }: { readonly kind: EditorTool }) {
  const icons: Readonly<Record<EditorTool, string>> = {
    select: cursorIcon,
    connector: flowArrowIcon,
    pan: handIcon,
    lasso: lassoIcon,
  };
  return <Icon src={icons[kind]} size={16} />;
}

export function OpenChartEditor({ initialDocument }: OpenChartEditorProps) {
  const [engineRef] = useState(() => ({ current: new OperationEngine(initialDocument) }));
  const [document, setDocument] = useState(engineRef.current.document);
  const [documentPath, setDocumentPath] = useState<string>();
  const [savedRevision, setSavedRevision] = useState(initialDocument.rev);
  const [browserSaveName, setBrowserSaveName] = useState<string>();
  const [activePageId, setActivePageId] = useState(
    () => orderedPages(initialDocument)[0]?.id ?? '',
  );
  const [selection, setSelection] = useState<SelectionState>(() => createSelectionState());
  const [preview, setPreview] = useState<TransformPreview | null>(null);
  const [camera, setCamera] = useState<EditorCamera>({ x: 0, y: 0, zoom: 0.72 });
  const [viewport, setViewport] = useState<ViewportSize>({ width: 1, height: 1 });
  const [tool, setTool] = useState<EditorTool>('select');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('design');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const [shortcutQuery, setShortcutQuery] = useState('');
  const [preferences, setPreferences] = useState<EditorPreferences>(loadPreferences);
  const [outputOpen, setOutputOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [shapeManagerOpen, setShapeManagerOpen] = useState(false);
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const [shapeLibraryId, setShapeLibraryId] = useState('all');
  const [shapeQuery, setShapeQuery] = useState('');
  const [railShapeQuery, setRailShapeQuery] = useState('');
  const [railLibraryId, setRailLibraryId] = useState('featured');
  const [draggedShape, setDraggedShape] = useState<ShapePaletteItem | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findCursor, setFindCursor] = useState(-1);
  const [canvasNavigation, setCanvasNavigation] = useState(preferences.canvasNavigation);
  const [linkEditor, setLinkEditor] = useState<{ readonly id: string; readonly value: string } | null>(null);
  const [editing, setEditing] = useState<TextEditState | null>(null);
  const [status, setStatus] = useState('Ready');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('layered');
  const [derivationBusy, setDerivationBusy] = useState(false);
  const derivationRef = useRef<AbortController | null>(null);
  useEffect(() => () => {
    derivationRef.current?.abort();
    derivationRef.current = null;
    disposeLayoutWorker();
  }, []);
  const [clipboard, setClipboard] = useState<ClipboardPayload | null>(null);
  const [styleSourceId, setStyleSourceId] = useState<string | null>(null);
  const [fullShapeCatalog, setFullShapeCatalog] = useState<FullShapeCatalogModule>();
  const [starterTemplateModule, setStarterTemplateModule] = useState<StarterTemplatesModule>();
  const transactionCounter = useRef(0);
  const commandDispatcher = useRef<(commandId: string) => void>(() => undefined);
  const quickInsertInputRef = useRef<HTMLInputElement | null>(null);
  const openDocumentInputRef = useRef<HTMLInputElement | null>(null);
  const importDocumentInputRef = useRef<HTMLInputElement | null>(null);
  const desktopRuntime = isDesktopRuntime();
  const documentPathRef = useRef(documentPath);
  documentPathRef.current = documentPath;
  const liveSessionRef = useRef<LiveDocumentSession | null>(null);
  const searchCatalog = fullShapeCatalog?.searchShapeLibraries ?? searchBuiltinShapeLibraries;
  const getCatalogEntry = fullShapeCatalog?.getShapeLibraryEntry ?? getBuiltinShapeLibraryEntry;
  const resolveCatalogShape = fullShapeCatalog?.resolveLibraryShape ?? resolveBuiltinLibraryShape;
  const shapeResults = useMemo(
    () => searchCatalog(shapeQuery, {
      ...(shapeLibraryId === 'all' ? {} : { libraryIds: [shapeLibraryId] }),
      limit: 60,
    }),
    [searchCatalog, shapeLibraryId, shapeQuery],
  );
  const railShapeResults = useMemo(
    () => {
      if (railShapeQuery.trim().length > 0) {
        return searchCatalog(railShapeQuery, {
          ...(railLibraryId === 'featured' ? {} : { libraryIds: [railLibraryId] }),
          limit: 18,
        });
      }
      return railLibraryId === 'featured'
        ? []
        : searchCatalog('', { libraryIds: [railLibraryId], limit: 18 });
    },
    [railLibraryId, railShapeQuery, searchCatalog],
  );
  const recentShapeResults = useMemo(
    () => preferences.recentShapes
      .map((ref) => catalogResultFromRef(ref, getCatalogEntry))
      .filter(isCatalogSearchResult),
    [getCatalogEntry, preferences.recentShapes],
  );
  const favoriteShapeResults = useMemo(
    () => preferences.favoriteShapes
      .map((ref) => catalogResultFromRef(ref, getCatalogEntry))
      .filter(isCatalogSearchResult),
    [getCatalogEntry, preferences.favoriteShapes],
  );

  useEffect(() => {
    const shouldLoadFullCatalog =
      shapeManagerOpen ||
      railShapeQuery.trim().length > 0 ||
      (railLibraryId !== 'featured' && isDecorativeShapeLibraryId(railLibraryId)) ||
      (shapeLibraryId !== 'all' && isDecorativeShapeLibraryId(shapeLibraryId)) ||
      preferences.recentShapes.some((ref) => isDecorativeShapeLibraryId(ref.libraryId)) ||
      preferences.favoriteShapes.some((ref) => isDecorativeShapeLibraryId(ref.libraryId)) ||
      documentUsesDecorativeShapes(document);
    if (!shouldLoadFullCatalog || fullShapeCatalog !== undefined) return;
    let cancelled = false;
    void loadFullShapeCatalog().then((catalog) => {
      if (!cancelled) setFullShapeCatalog(catalog);
    }).catch((error: unknown) => {
      if (!cancelled) {
        setStatus(error instanceof Error ? error.message : 'Decorative icon catalog could not be loaded');
      }
    });
    return () => { cancelled = true; };
  }, [
    document,
    fullShapeCatalog,
    preferences.favoriteShapes,
    preferences.recentShapes,
    railLibraryId,
    railShapeQuery,
    shapeLibraryId,
    shapeManagerOpen,
  ]);

  useEffect(() => {
    if (!templateOpen || starterTemplateModule !== undefined) return;
    let cancelled = false;
    void loadStarterTemplates().then((templates) => {
      if (!cancelled) setStarterTemplateModule(templates);
    }).catch((error: unknown) => {
      if (!cancelled) {
        setStatus(error instanceof Error ? error.message : 'Starter templates could not be loaded');
      }
    });
    return () => { cancelled = true; };
  }, [starterTemplateModule, templateOpen]);
  liveSessionRef.current ??= new LiveDocumentSession({
    getEngine: () => engineRef.current,
    replaceEngine: (nextEngine) => {
      engineRef.current = nextEngine;
    },
    publish: (nextDocument) => {
      setDocument(nextDocument);
      setSelection((current) => ({
        scopeId: current.scopeId,
        selectedIds: current.selectedIds.filter(
          (id) =>
            nextDocument.nodes[id] !== undefined ||
            nextDocument.edges[id] !== undefined,
        ),
      }));
    },
    persist: async (nextDocument) => {
      const path = documentPathRef.current;
      if (path !== undefined) {
        await writeDesktopDocument(nextDocument, path);
        setSavedRevision(nextDocument.rev);
      }
    },
    setStatus,
  });
  const liveSession = liveSessionRef.current;
  const documentDirty = document.rev !== savedRevision;

  const nextTransactionId = useCallback((label: string): string => {
    transactionCounter.current += 1;
    return `gui-${label}-${transactionCounter.current}`;
  }, []);

  const persistPreferences = useCallback((next: EditorPreferences): void => {
    setPreferences(next);
    setCanvasNavigation(next.canvasNavigation);
    savePreferences(next);
  }, []);

  const frames = useMemo(() => resolveFrames(document), [document]);
  const displayDocument = useMemo(() => previewDocument(document, preview), [document, preview]);
  const displayFrames = useMemo(
    () => (preview === null ? frames : { ...frames, ...preview.updates }),
    [frames, preview],
  );
  const scene = useMemo(
    () => buildSceneDescription(displayDocument, {
      pageId: activePageId,
      routingStrategy: preview === null ? 'document' : 'fast',
      ...(fullShapeCatalog === undefined
        ? {}
        : { shapeResolver: fullShapeCatalog.resolveLibraryShape }),
    }),
    [activePageId, displayDocument, fullShapeCatalog, preview],
  );
  const items = useMemo(
    () => selectableItems(document, activePageId, frames),
    [activePageId, document, frames],
  );
  const navigationItems = useMemo(
    () => items
      .filter(
        (item) =>
          !item.hidden &&
          !item.locked &&
          (item.parentId ?? null) === selection.scopeId,
      )
      .toSorted((left, right) => {
        const vertical = left.bounds.y - right.bounds.y;
        return vertical === 0 ? left.bounds.x - right.bounds.x : vertical;
      }),
    [items, selection.scopeId],
  );
  const pages = useMemo(() => orderedPages(document), [document]);
  const activePage = document.pages[activePageId] ?? pages[0];
  const selectedNodeIds = selection.selectedIds.filter((id) => document.nodes[id] !== undefined);
  const selectedEdgeIds = selection.selectedIds.filter((id) => document.edges[id] !== undefined);
  const selectedNodes = selectedNodeIds.map((id) => document.nodes[id]).filter((node): node is Node => node !== undefined);
  const selectedEdges = selectedEdgeIds.map((id) => document.edges[id]).filter((edge): edge is Edge => edge !== undefined);
  const selectedNode = selection.selectedIds.length === 1 ? selectedNodes[0] : undefined;
  const selectedEdge = selection.selectedIds.length === 1 ? selectedEdges[0] : undefined;
  const selectedNodeInspector = selectedNode ?? (selectedEdges.length === 0 ? selectedNodes[0] : undefined);
  const selectedEdgeInspector = selectedEdge ?? (selectedNodes.length === 0 ? selectedEdges[0] : undefined);
  const selectedTextData = selectedNodeInspector?.data ?? selectedEdgeInspector?.data;
  const nodeDataMixed = (field: string): boolean =>
    selectedNodes.length > 1 && selectedNodes.some((node) => node.data[field] !== selectedNodes[0]?.data[field]);
  const edgeDataMixed = (field: string): boolean =>
    selectedEdges.length > 1 && selectedEdges.some((edge) => edge.data[field] !== selectedEdges[0]?.data[field]);
  const edgeRoutingMixed = (field: keyof NonNullable<Edge['routing']>): boolean =>
    selectedEdges.length > 1 && selectedEdges.some((edge) => edge.routing?.[field] !== selectedEdges[0]?.routing?.[field]);
  const selectionDataMixed = (field: string): boolean => {
    const records = [...selectedNodes.map((node) => node.data), ...selectedEdges.map((edge) => edge.data)];
    return records.length > 1 && records.some((record) => record[field] !== records[0]?.[field]);
  };
  const selectedEdgeFromNode = selectedEdge === undefined
    ? undefined
    : document.nodes[document.ports[selectedEdge.fromPortId]?.nodeId ?? ''];
  const selectedEdgeToNode = selectedEdge === undefined
    ? undefined
    : document.nodes[document.ports[selectedEdge.toPortId]?.nodeId ?? ''];
  const selectedFrame = selectedNode === undefined ? undefined : frames[selectedNode.id];
  const canDistributeSelection = new Set(
    selection.selectedIds.filter((id) => frames[id] !== undefined),
  ).size >= 3;
  const selectedNodeStyle = selectedNodeInspector === undefined ? undefined : document.styles[selectedNodeInspector.styleId];
  const selectedFillColor = selectedNodeInspector === undefined
    ? '#FFFFFF'
    : editorColor(selectedNodeInspector.data.fillColor, editorColor(selectedNodeStyle?.tokens.surface, '#FFFFFF'));
  const selectedBorderColor = selectedNodeInspector === undefined
    ? '#64748B'
    : editorColor(selectedNodeInspector.data.borderColor, editorColor(selectedNodeStyle?.tokens.accent, '#64748B'));
  const selectedEdgeStyle = selectedEdgeInspector === undefined ? undefined : document.styles[selectedEdgeInspector.styleId];
  const selectedEdgeStrokeColor = selectedEdgeInspector === undefined
    ? '#64748B'
    : editorColor(selectedEdgeInspector.data.strokeColor, editorColor(selectedEdgeStyle?.tokens.stroke, '#64748B'));
  const activePresetId = isTokenPresetId(document.theme?.presetId)
    ? document.theme.presetId
    : 'openchart-light';

  const commit = useCallback(
    (
      envelope: OperationEnvelope,
      message: string,
      nextSelection?: SelectionState,
    ): boolean => {
      const result = liveSession.applyLocal(envelope);
      if (!result.ok) {
        setStatus(result.diagnostics[0]?.message ?? 'The edit could not be applied');
        return false;
      }
      if (nextSelection !== undefined) {
        setSelection(nextSelection);
      } else {
        setSelection((current) => ({
          scopeId: current.scopeId,
          selectedIds: current.selectedIds.filter(
            (id) =>
              liveSession.document.nodes[id] !== undefined ||
              liveSession.document.edges[id] !== undefined,
          ),
        }));
      }
      setStatus(message);
      return true;
    },
    [liveSession],
  );

  const applyThemePreset = useCallback(
    (presetId: TokenPresetId) => {
      const operations = compileTokenOperations(document, presetId);
      if (operations.length === 0) {
        setStatus(`${TOKEN_PRESETS[presetId].label} is already applied`);
        return;
      }
      commit(
        {
          txId: nextTransactionId('theme'),
          actor: 'user',
          origin: 'gui',
          baseRev: document.rev,
          ops: operations,
        },
        `${TOKEN_PRESETS[presetId].label} applied`,
      );
    },
    [commit, document, nextTransactionId],
  );

  const runAutoLayout = useCallback(async (): Promise<void> => {
    if (activePageId.length === 0 || derivationRef.current !== null) {
      return;
    }
    const controller = new AbortController();
    const sourceEngine = engineRef.current;
    derivationRef.current = controller;
    setDerivationBusy(true);
    setStatus(`Arranging ${layoutMode} layout…`);
    try {
      const result = await requestLayout(document, {
        pageId: activePageId,
        mode: layoutMode,
        direction: 'RIGHT',
      }, { signal: controller.signal });
      if (derivationRef.current !== controller) return;
      if (engineRef.current !== sourceEngine || sourceEngine.document !== document) {
        setStatus('Layout discarded because the document changed');
        return;
      }
      const changed =
        document.layout.engine !== result.engine ||
        document.layout.derivedVersion !== result.derivedVersion ||
        JSON.stringify(document.layout.derived) !== JSON.stringify(result.frames);
      if (changed) {
        const applied = commit(
          {
            txId: nextTransactionId('layout'),
            actor: 'user',
            origin: 'layout',
            baseRev: document.rev,
            ops: [{
              op: 'set_derived_layout',
              engine: result.engine,
              derivedVersion: result.derivedVersion,
              frames: result.frames,
            }],
          },
          `${layoutMode[0]?.toUpperCase() ?? ''}${layoutMode.slice(1)} layout applied`,
        );
        if (!applied) return;
      } else {
        setStatus('Layout is already current');
      }
      setCamera(fitCameraBounds(framesBounds(result.frames), viewport));
    } catch (error) {
      if (derivationRef.current === controller) {
        setStatus(error instanceof Error ? error.message : 'Automatic layout failed');
      }
    } finally {
      if (derivationRef.current === controller) {
        derivationRef.current = null;
        setDerivationBusy(false);
      }
    }
  }, [activePageId, commit, derivationBusy, document, layoutMode, nextTransactionId, viewport]);

  const runBeautyPass = useCallback(async (): Promise<void> => {
    if (activePageId.length === 0 || derivationRef.current !== null) {
      return;
    }
    const controller = new AbortController();
    const sourceEngine = engineRef.current;
    derivationRef.current = controller;
    setDerivationBusy(true);
    setStatus('Running the eleven-step Beauty Pass…');
    try {
      const plan = await requestBeautyPass(document, {
        pageId: activePageId,
        layoutMode,
        direction: 'RIGHT',
        presetId: activePresetId,
      }, { signal: controller.signal });
      if (derivationRef.current !== controller) return;
      if (engineRef.current !== sourceEngine || sourceEngine.document !== document) {
        setStatus('Beauty Pass discarded because the document changed');
        return;
      }
      if (plan.operations.length > 0) {
        const applied = commit(
          {
            txId: nextTransactionId('beauty'),
            actor: 'user',
            origin: 'beauty',
            baseRev: document.rev,
            ops: plan.operations,
          },
          `Beauty Pass complete · ${plan.operations.length} edits · one undo`,
        );
        if (!applied) {
          return;
        }
      } else {
        setStatus('Beauty Pass is already current');
      }
      setCamera(fitCameraBounds(plan.fitBounds, viewport));
    } catch (error) {
      if (derivationRef.current === controller) {
        setStatus(error instanceof Error ? error.message : 'Beauty Pass failed');
      }
    } finally {
      if (derivationRef.current === controller) {
        derivationRef.current = null;
        setDerivationBusy(false);
      }
    }
  }, [
    activePageId,
    activePresetId,
    commit,
    derivationBusy,
    document,
    layoutMode,
    nextTransactionId,
    viewport,
  ]);

  const commitTransform = useCallback(
    (nextPreview: TransformPreview, message?: string) => {
      commit(
        createTransformTransaction(document, nextPreview, {
          txId: nextTransactionId('transform'),
        }),
        message ?? `Moved ${Object.keys(nextPreview.updates).length} object${Object.keys(nextPreview.updates).length === 1 ? '' : 's'}`,
      );
    },
    [commit, document, nextTransactionId],
  );

  const beginTextEdit = useCallback(
    (id: string, initialValue?: string) => {
      const node = document.nodes[id];
      if (node !== undefined) {
        setEditing({ kind: 'node', id, value: initialValue ?? node.label });
      }
    },
    [document.nodes],
  );

  const beginEdgeLabelEdit = useCallback(
    (edgeId: string, labelT: number) => {
      const edge = document.edges[edgeId];
      if (edge !== undefined) {
        setEditing({ kind: 'edge', id: edgeId, value: edge.label, labelT: clamp(labelT, 0, 1) });
      }
    },
    [document.edges],
  );

  const cancelTextEdit = useCallback(() => {
    if (editing !== null) {
      setEditing(null);
      setStatus('Text edit cancelled');
    }
  }, [editing]);

  const commitTextEdit = useCallback(() => {
    if (editing === null) {
      return;
    }
    if (editing.kind === 'node') {
      const node = document.nodes[editing.id];
      if (node !== undefined && node.label !== editing.value.trim() && editing.value.trim().length > 0) {
        commit(
          {
            txId: nextTransactionId('text'),
            actor: 'user',
            origin: 'gui',
            baseRev: document.rev,
            ops: [{ op: 'set_node_label', id: editing.id, label: editing.value.trim() }],
          },
          'Text updated',
        );
      }
    } else {
      const envelope = edgeLabelTransaction(document, {
        txId: nextTransactionId('edge-label'),
        edgeId: editing.id,
        label: editing.value.trim(),
        labelT: editing.labelT,
      });
      if (envelope !== undefined) {
        commit(envelope, editing.value.trim().length === 0 ? 'Connector label removed' : 'Connector label updated');
      }
    }
    setEditing(null);
  }, [commit, document, editing, nextTransactionId]);

  const activeLayerId = activePage?.layerIds.find((id) => document.layers[id]?.visible) ?? activePage?.layerIds[0];

  const addNode = useCallback(
    (item: ShapePaletteItem, worldPosition?: InteractionPoint): string | undefined => {
      if (activePage === undefined || activeLayerId === undefined) {
        setStatus('Create a visible page layer before adding a shape');
        return undefined;
      }
      if (document.layers[activeLayerId]?.locked === true) {
        setStatus('Unlock the active layer before adding a shape');
        return undefined;
      }
      const { kind } = item;
      const styleIds = Object.keys(document.styles).sort(compareIds);
      const preferredStyle =
        kind === 'system'
          ? 'style.source'
          : kind === 'control'
            ? 'style.operations'
            : 'style.fabric';
      const styleId = document.styles[preferredStyle] === undefined ? styleIds[0] : preferredStyle;
      if (styleId === undefined) {
        setStatus('This document has no style available for a new shape');
        return undefined;
      }
      const id = nextEntityId(document, `node.${kind}`);
      const size = item.size ?? (item.shape === undefined
        ? DEFAULT_NODE_SIZE[kind] ?? DEFAULT_NODE_SIZE.service ?? { width: 300, height: 154 }
        : { width: 180, height: 112 });
      const frame = {
        x: (worldPosition?.x ?? camera.x + viewport.width / camera.zoom / 2) - size.width / 2,
        y: (worldPosition?.y ?? camera.y + viewport.height / camera.zoom / 2) - size.height / 2,
        width: size.width,
        height: size.height,
      };
      const label = item.label;
      const node: Node = {
        id,
        uid: makeUid(),
        kind,
        label,
        pageId: activePage.id,
        layerId: activeLayerId,
        styleId,
        data:
          item.shape !== undefined
            ? { shape: item.shape }
            : kind === 'text'
            ? { eyebrow: 'NOTE', subtitle: 'Double-click to edit' }
            : { eyebrow: kind.toUpperCase(), subtitle: 'New architecture element', status: 'DRAFT' },
        ...(kind === 'container'
          ? {
              container: {
                title: label,
                magnetize: true,
                clip: false,
                autoGrow: true,
              },
            }
          : {}),
      };
      const applied = commit(
        createShapeInsertionTransaction(document, {
          txId: nextTransactionId('create'),
          node,
          frame,
        }),
        `${label} added`,
        { scopeId: selection.scopeId, selectedIds: [id] },
      );
      const catalogRef = catalogRefFromItem(item);
      if (applied && catalogRef !== undefined) {
        persistPreferences({
          ...preferences,
          recentShapes: recordRecentCatalogShape(preferences.recentShapes, catalogRef),
        });
      }
      return applied ? id : undefined;
    },
    [
      activeLayerId,
      activePage,
      camera,
      commit,
      document,
      nextTransactionId,
      persistPreferences,
      preferences,
      selection.scopeId,
      viewport,
    ],
  );

  const addCatalogShape = useCallback(
    (result: ShapeLibrarySearchResult) => {
      addNode(shapePaletteItem(result));
      setShapeManagerOpen(false);
      setShapeQuery('');
    },
    [addNode],
  );

  const toggleFavoriteShape = useCallback(
    (ref: CatalogShapeRef) => {
      persistPreferences({
        ...preferences,
        favoriteShapes: toggleFavoriteCatalogShape(preferences.favoriteShapes, ref),
      });
    },
    [persistPreferences, preferences],
  );

  const createConnector = useCallback(
    (
      fromNodeId: string,
      toNodeId: string,
      fromSide: ConnectorSide = 'east',
      toSide: ConnectorSide = 'west',
    ) => {
      const currentDocument = liveSession.document;
      if (
        activePage === undefined ||
        activeLayerId === undefined ||
        fromNodeId === toNodeId ||
        currentDocument.nodes[fromNodeId] === undefined ||
        currentDocument.nodes[toNodeId] === undefined
      ) {
        setStatus('Choose two different shapes on the active page');
        return;
      }
      const layer = currentDocument.layers[activeLayerId];
      if (layer?.locked === true) {
        setStatus('Unlock the active layer before adding a connector');
        return;
      }
      const styleId = Object.values(currentDocument.styles)
        .filter((style) => style.role.toLowerCase().includes('flow'))
        .sort((left, right) => compareIds(left.id, right.id))[0]?.id ??
        Object.keys(currentDocument.styles).sort(compareIds)[0];
      if (styleId === undefined) {
        setStatus('This document has no style available for a connector');
        return;
      }
      const envelope = createConnectorTransaction(currentDocument, {
        txId: nextTransactionId('connector'),
        pageId: activePage.id,
        layerId: activeLayerId,
        styleId,
        fromNodeId,
        toNodeId,
        fromSide,
        toSide,
      });
      const edgeId = envelope.ops.find((operation) => operation.op === 'create_edge')?.edge.id;
      if (edgeId === undefined) {
        setStatus('Unable to prepare connector operations');
        return;
      }
      commit(
        envelope,
        'Connector added',
        { scopeId: selection.scopeId, selectedIds: [edgeId] },
      );
    },
    [
      activeLayerId,
      activePage,
      commit,
      liveSession,
      nextTransactionId,
      selection.scopeId,
    ],
  );

  const createConnectedNode = useCallback(
    (
      fromNodeId: string,
      fromSide: 'north' | 'east' | 'south' | 'west',
      point: InteractionPoint,
    ) => {
      const toNodeId = addNode(CONNECT_CREATE_SHAPE, point);
      if (toNodeId === undefined) {
        return;
      }
      createConnector(fromNodeId, toNodeId, fromSide, oppositeConnectorSide(fromSide));
      setStatus('Process created and connected');
    },
    [addNode, createConnector],
  );

  const addEdgeWaypoint = useCallback(
    (edgeId: string, point: InteractionPoint) => {
      const geometry = scene.connectors?.find((connector) => connector.edgeId === edgeId);
      if (geometry === undefined) {
        return;
      }
      const envelope = addEdgeWaypointTransaction(document, {
        txId: nextTransactionId('edge-waypoint'),
        edgeId,
        geometryPoints: geometry.points,
        point,
      });
      if (envelope !== undefined) {
        commit(
          envelope,
          'Connector waypoint added',
          { scopeId: selection.scopeId, selectedIds: [edgeId] },
        );
      }
    },
    [commit, document, nextTransactionId, scene.connectors, selection.scopeId],
  );

  const commitEdgeWaypoint = useCallback(
    (edgeId: string, waypointIndex: number, point: InteractionPoint) => {
      const geometry = scene.connectors?.find((connector) => connector.edgeId === edgeId);
      if (geometry === undefined) {
        return;
      }
      const envelope = moveEdgeWaypointTransaction(document, {
        txId: nextTransactionId('move-waypoint'),
        edgeId,
        waypointIndex,
        point,
        from: geometry.from,
        to: geometry.to,
        collinearTolerance: 7 / camera.zoom,
      });
      if (envelope !== undefined) {
        const priorCount = document.layout.edgeOverrides?.[edgeId]?.waypoints?.length ?? 0;
        const nextLayout = envelope.ops[0]?.op === 'set_edge_layout' ? envelope.ops[0].layout : undefined;
        const nextCount = nextLayout?.waypoints?.length ?? 0;
        commit(
          envelope,
          nextCount < priorCount ? 'Connector waypoint removed' : 'Connector waypoint moved',
          { scopeId: selection.scopeId, selectedIds: [edgeId] },
        );
      }
    },
    [camera.zoom, commit, document, nextTransactionId, scene.connectors, selection.scopeId],
  );

  const commitEdgeSegment = useCallback(
    (edgeId: string, segmentIndex: number, point: InteractionPoint) => {
      const geometry = scene.connectors?.find((connector) => connector.edgeId === edgeId);
      if (geometry === undefined || geometry.mode !== 'orthogonal') {
        return;
      }
      const envelope = dragOrthogonalSegmentTransaction(document, {
        txId: nextTransactionId('drag-edge-segment'),
        edgeId,
        geometryPoints: geometry.points,
        segmentIndex,
        point,
      });
      if (envelope !== undefined) {
        commit(
          envelope,
          'Connector segment adjusted',
          { scopeId: selection.scopeId, selectedIds: [edgeId] },
        );
      }
    },
    [commit, document, nextTransactionId, scene.connectors, selection.scopeId],
  );

  const commitEdgeLabelPosition = useCallback(
    (edgeId: string, labelT: number) => {
      const envelope = edgeLabelPositionTransaction(document, {
        txId: nextTransactionId('edge-label-position'),
        edgeId,
        labelT,
      });
      if (envelope !== undefined) {
        commit(
          envelope,
          'Connector label moved',
          { scopeId: selection.scopeId, selectedIds: [edgeId] },
        );
      }
    },
    [commit, document, nextTransactionId, selection.scopeId],
  );

  const relinkEdge = useCallback(
    (
      edge: Edge,
      endpoint: 'from' | 'to',
      nodeId: string,
      side: ConnectorSide | 'auto' = 'auto',
    ) => {
      const currentDocument = liveSession.document;
      const envelope = relinkEdgeTransaction(currentDocument, {
        txId: nextTransactionId('relink-edge'),
        edgeId: edge.id,
        endpoint,
        nodeId,
        side,
      });
      if (envelope === undefined) {
        return;
      }
      commit(
        envelope,
        `${endpoint === 'from' ? 'Source' : 'Target'} endpoint updated`,
        { scopeId: selection.scopeId, selectedIds: [edge.id] },
      );
    },
    [commit, liveSession, nextTransactionId, selection.scopeId],
  );

  const detachEdgeEndpoint = useCallback(
    (edgeId: string, endpoint: 'from' | 'to', point: InteractionPoint) => {
      const currentDocument = liveSession.document;
      const envelope = detachEdgeEndpointTransaction(currentDocument, {
        txId: nextTransactionId('detach-edge'),
        edgeId,
        endpoint,
        point,
      });
      if (envelope === undefined) {
        return;
      }
      commit(
        envelope,
        `${endpoint === 'from' ? 'Source' : 'Target'} endpoint detached`,
        { scopeId: selection.scopeId, selectedIds: [edgeId] },
      );
    },
    [commit, liveSession, nextTransactionId, selection.scopeId],
  );

  const pasteClipboard = useCallback(
    (offset: InteractionPoint) => {
      if (clipboard === null || activePage === undefined || activeLayerId === undefined) {
        setStatus('Nothing is available to paste');
        return;
      }
      if (document.layers[activeLayerId]?.locked === true) {
        setStatus('Unlock the active layer before pasting');
        return;
      }
      const existingIds: Readonly<Record<string, unknown>> = {
        ...document.nodes,
        ...document.ports,
        ...document.edges,
      };
      const reservedIds = new Set<string>();
      const paste = createPasteTransaction(document, clipboard, {
        txId: nextTransactionId('paste'),
        pageId: activePage.id,
        layerId: activeLayerId,
        offset,
        allocateId: (_kind, sourceId) => allocateCopyId(existingIds, reservedIds, sourceId),
        allocateUid: () => makeUid(),
      });
      commit(
        paste.envelope,
        `Pasted ${paste.pastedNodeIds.length} object${paste.pastedNodeIds.length === 1 ? '' : 's'}`,
        {
          scopeId: selection.scopeId,
          selectedIds: paste.pastedRootNodeIds,
        },
      );
    },
    [activeLayerId, activePage, clipboard, commit, document, nextTransactionId, selection.scopeId],
  );

  const createGroup = useCallback(() => {
    if (selection.selectedIds.length < 2 || activePage === undefined || activeLayerId === undefined) {
      setStatus('Select at least two objects to group');
      return;
    }
    const selected = selection.selectedIds.filter((id) => document.nodes[id] !== undefined);
    const bounds = selectionBounds(selected, frames);
    const styleId = document.nodes[selected[0] ?? '']?.styleId;
    if (bounds === undefined || styleId === undefined) {
      return;
    }
    const id = nextEntityId(document, 'group');
    const ops: Operation[] = [
      {
        op: 'create_node',
        node: {
          id,
          uid: makeUid(),
          kind: 'group',
          label: 'Group',
          pageId: activePage.id,
          layerId: activeLayerId,
          styleId,
          data: {},
          group: {},
          ...(selection.scopeId === null ? {} : { parentId: selection.scopeId }),
        },
      },
      { op: 'set_node_layout', id, layout: { ...bounds, rotation: undefined, pinned: true } },
      ...selected.map((nodeId): Operation => ({ op: 'set_node_parent', id: nodeId, parentId: id })),
    ];
    commit(
      {
        txId: nextTransactionId('group'),
        actor: 'user',
        origin: 'gui',
        baseRev: document.rev,
        ops,
      },
      `Grouped ${selected.length} objects`,
      { scopeId: selection.scopeId, selectedIds: [id] },
    );
  }, [activeLayerId, activePage, commit, document, frames, nextTransactionId, selection]);

  const ungroupSelection = useCallback(() => {
    const groupIds = selection.selectedIds.filter((id) => document.nodes[id]?.group !== undefined);
    if (groupIds.length === 0) {
      setStatus('Select a group to ungroup');
      return;
    }
    const childIds: string[] = [];
    const ops: Operation[] = [];
    for (const groupId of groupIds) {
      const parentId = document.nodes[groupId]?.parentId ?? null;
      for (const node of Object.values(document.nodes).sort((left, right) => compareIds(left.id, right.id))) {
        if (node.parentId === groupId) {
          childIds.push(node.id);
          ops.push({ op: 'set_node_parent', id: node.id, parentId });
        }
      }
      ops.push({ op: 'delete_node', id: groupId });
    }
    commit(
      {
        txId: nextTransactionId('ungroup'),
        actor: 'user',
        origin: 'gui',
        baseRev: document.rev,
        ops,
      },
      'Group released',
      { scopeId: selection.scopeId, selectedIds: childIds },
    );
  }, [commit, document, nextTransactionId, selection]);

  const alignSelection = useCallback(
    (direction: 'up' | 'right' | 'down' | 'left') => {
      if (selection.selectedIds.length < 2) {
        setStatus('Select at least two objects to align');
        return;
      }
      const referenceId = selection.selectedIds.at(-1);
      const reference = referenceId === undefined ? undefined : frames[referenceId];
      if (reference === undefined) {
        return;
      }
      const updates: Record<string, TransformFrame> = {};
      for (const id of selection.selectedIds) {
        if (id === referenceId) {
          continue;
        }
        const frame = frames[id];
        if (frame === undefined) {
          continue;
        }
        const delta =
          direction === 'left'
            ? { x: reference.x - frame.x, y: 0 }
            : direction === 'right'
              ? {
                  x:
                    reference.x + reference.width -
                    (frame.x + frame.width),
                  y: 0,
                }
              : direction === 'up'
                ? { x: 0, y: reference.y - frame.y }
                : {
                    x: 0,
                    y:
                      reference.y + reference.height -
                      (frame.y + frame.height),
                  };
        if (Math.abs(delta.x) <= 1e-9 && Math.abs(delta.y) <= 1e-9) {
          continue;
        }
        Object.assign(
          updates,
          translateSelection(document, frames, [id], delta).updates,
        );
      }
      if (Object.keys(updates).length === 0) {
        return;
      }
      const resolvedFrames = { ...frames, ...updates };
      const bounds = selectionBounds(selection.selectedIds, resolvedFrames);
      if (bounds !== undefined) {
        commitTransform(
          { selectionBounds: bounds, updates },
          `Aligned ${selection.selectedIds.length} objects ${direction}`,
        );
      }
    },
    [commitTransform, document, frames, selection.selectedIds],
  );

  const distributeSelection = useCallback(
    (mode: DistributionMode) => {
      const preview = distributeSelectionPreview(document, frames, selection.selectedIds, mode);
      if (preview === undefined) {
        setStatus('Select at least three shapes to distribute');
        return;
      }
      commitTransform(
        preview,
        mode === 'horizontal'
          ? 'Distributed selection horizontally'
          : mode === 'vertical'
            ? 'Distributed selection vertically'
            : 'Equal spacing applied',
      );
    },
    [commitTransform, document, frames, selection.selectedIds],
  );

  const reorderSelection = useCallback(
    (mode: 'front' | 'forward' | 'backward' | 'back') => {
      const selected = new Set(selection.selectedIds);
      if (selected.size === 0) {
        return;
      }
      const siblings = Object.values(document.nodes)
        .filter(
          (node) =>
            node.pageId === activePageId &&
            (node.parentId ?? null) === selection.scopeId,
        )
        .sort((left, right) => {
          const zIndex =
            (document.layout.overrides[left.id]?.zIndex ?? 0) -
            (document.layout.overrides[right.id]?.zIndex ?? 0);
          return zIndex === 0 ? compareIds(left.id, right.id) : zIndex;
        });
      if (siblings.length < 2) {
        return;
      }
      const ordered = reorderSiblingNodes(siblings, selection.selectedIds, mode);
      if (ordered === undefined) {
        setStatus('Selection is already in that position');
        return;
      }
      commit(
        {
          txId: nextTransactionId('z-order'),
          actor: 'user',
          origin: 'gui',
          baseRev: document.rev,
          ops: ordered.map(
            (node, zIndex): Operation => ({
              op: 'set_node_z_index',
              id: node.id,
              zIndex,
            }),
          ),
        },
        mode === 'front'
          ? 'Brought selection to front'
          : mode === 'back'
            ? 'Sent selection to back'
            : mode === 'forward'
              ? 'Brought selection forward'
              : 'Sent selection backward',
      );
    },
    [activePageId, commit, document, nextTransactionId, selection],
  );

  const updateTextStyle = useCallback(
    (field: TextStyleField, value: number | string | boolean) => {
      const envelope = createSelectionTextStyleTransaction(
        document,
        selection.selectedIds,
        field,
        value,
        { txId: nextTransactionId('text-style') },
      );
      if (envelope === undefined) {
        setStatus('Select an object to format its text');
        return;
      }
      commit(envelope, 'Text style updated');
    },
    [commit, document, nextTransactionId, selection.selectedIds],
  );

  const updateShapeVisualStyle = useCallback(
    (update: ShapeVisualStyleUpdate, message: string) => {
      const envelope = createShapeVisualStyleTransaction(
        document,
        selectedNodeIds,
        update,
        { txId: nextTransactionId('shape-style') },
      );
      if (envelope === undefined) {
        setStatus(selectedNodeIds.length === 0 ? 'Select one or more shapes to style' : 'Selection already has that style');
        return;
      }
      commit(envelope, message);
    },
    [commit, document, nextTransactionId, selectedNodeIds],
  );

  const updateConnectorVisualStyle = useCallback(
    (update: ConnectorVisualStyleUpdate, message: string) => {
      const envelope = createConnectorVisualStyleTransaction(
        document,
        selectedEdgeIds,
        update,
        { txId: nextTransactionId('connector-style') },
      );
      if (envelope === undefined) {
        setStatus(selectedEdgeIds.length === 0 ? 'Select one or more connectors to style' : 'Selection already has that style');
        return;
      }
      commit(envelope, message);
    },
    [commit, document, nextTransactionId, selectedEdgeIds],
  );

  const renderTextFormattingControls = (
    data: Node['data'],
    mixed: (field: string) => boolean,
  ): ReactNode => (
    <div className="oc-style-panel-section">
      <div className="oc-section-title">Text</div>
      <div className="oc-style-grid">
        <label className="oc-field oc-field-wide">
          <span>Font</span>
          <select
            aria-label="Inspector font family"
            value={typeof data.fontFamily === 'string' ? data.fontFamily : 'Aptos Display, Segoe UI, sans-serif'}
            onChange={(event) => updateTextStyle('fontFamily', event.currentTarget.value)}
          >
            <option value="Aptos Display, Segoe UI, sans-serif">Aptos</option>
            <option value="Segoe UI, Arial, sans-serif">Segoe UI</option>
            <option value="Arial, sans-serif">Arial</option>
            <option value="Georgia, serif">Georgia</option>
            <option value="Cascadia Code, Consolas, monospace">Cascadia Code</option>
            <option value="Consolas, monospace">Consolas</option>
          </select>
          {mixed('fontFamily') ? <small className="oc-mixed-note">Mixed</small> : null}
        </label>
        <label className="oc-field">
          <span>Size</span>
          <input type="number" min={8} max={96} step={1}
            value={typeof data.fontSize === 'number' ? data.fontSize : 18}
            onChange={(event) => updateTextStyle('fontSize', clamp(Number(event.currentTarget.value), 8, 96))} />
        </label>
        <label className="oc-field">
          <span>Line height</span>
          <input type="number" min={0.8} max={3} step={0.05}
            value={typeof data.lineHeight === 'number' ? data.lineHeight : 1.2}
            onChange={(event) => updateTextStyle('lineHeight', clamp(Number(event.currentTarget.value), 0.8, 3))} />
        </label>
      </div>
      <div className="oc-text-format oc-text-format-wide">
        <button type="button" aria-pressed={data.fontWeight === 700} className={data.fontWeight === 700 ? 'is-active' : ''}
          onClick={() => updateTextStyle('fontWeight', data.fontWeight === 700 && !mixed('fontWeight') ? 400 : 700)}><strong>B</strong></button>
        <button type="button" aria-pressed={data.fontStyle === 'italic'} className={data.fontStyle === 'italic' ? 'is-active' : ''}
          onClick={() => updateTextStyle('fontStyle', data.fontStyle === 'italic' && !mixed('fontStyle') ? 'normal' : 'italic')}><em>I</em></button>
        <button type="button" aria-pressed={data.underline === true} className={data.underline === true ? 'is-active' : ''}
          onClick={() => updateTextStyle('underline', !(data.underline === true && !mixed('underline')))}><span style={{ textDecoration: 'underline' }}>U</span></button>
        {(['left', 'center', 'right'] as const).map((alignment) => (
          <button type="button" key={alignment} aria-pressed={data.textAlign === alignment && !mixed('textAlign')}
            className={data.textAlign === alignment && !mixed('textAlign') ? 'is-active' : ''}
            onClick={() => updateTextStyle('textAlign', alignment)} title={`Align ${alignment}`}>{alignment === 'left' ? '≡←' : alignment === 'right' ? '→≡' : '≡'}</button>
        ))}
      </div>
      <ColorControl
        label="Text"
        value={editorColor(data.textColor, '#0F172A')}
        mixed={mixed('textColor')}
        onChange={(value) => updateTextStyle('textColor', value)}
      />
    </div>
  );

  const renderShapeAppearanceControls = (node: Node): ReactNode => (
    <div className="oc-style-panel-section">
      <div className="oc-section-title">Appearance</div>
      <ColorControl label="Fill" value={selectedFillColor} mixed={nodeDataMixed('fillColor')}
        onChange={(value) => updateShapeVisualStyle({ fillColor: value }, 'Shape fill updated')} />
      <ColorControl label="Border" value={selectedBorderColor} mixed={nodeDataMixed('borderColor')}
        onChange={(value) => updateShapeVisualStyle({ borderColor: value }, 'Shape border updated')} />
      <div className="oc-style-grid">
        <label className="oc-field">
          <span>Border width</span>
          <input type="number" min={0.5} max={10} step={0.5}
            value={typeof node.data.borderWidth === 'number' ? node.data.borderWidth : 1.5}
            onChange={(event) => updateShapeVisualStyle({ borderWidth: clamp(Number(event.currentTarget.value), 0.5, 10) }, 'Border width updated')} />
          {nodeDataMixed('borderWidth') ? <small className="oc-mixed-note">Mixed</small> : null}
        </label>
        <label className="oc-field">
          <span>Border</span>
          <select value={typeof node.data.borderStyle === 'string' ? node.data.borderStyle : 'solid'}
            onChange={(event) => updateShapeVisualStyle({ borderStyle: event.currentTarget.value as 'solid' | 'dashed' | 'dotted' }, 'Border pattern updated')}>
            <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
          </select>
          {nodeDataMixed('borderStyle') ? <small className="oc-mixed-note">Mixed</small> : null}
        </label>
        <label className="oc-field">
          <span>Roundness</span>
          <input type="number" min={0} max={64} step={1}
            value={typeof node.data.cornerRadius === 'number' ? node.data.cornerRadius : 10}
            onChange={(event) => updateShapeVisualStyle({ cornerRadius: clamp(Number(event.currentTarget.value), 0, 64) }, 'Corner rounding updated')} />
          {nodeDataMixed('cornerRadius') ? <small className="oc-mixed-note">Mixed</small> : null}
        </label>
        <label className="oc-field">
          <span>Opacity %</span>
          <input type="number" min={10} max={100} step={5}
            value={Math.round((typeof node.data.opacity === 'number' ? node.data.opacity : 1) * 100)}
            onChange={(event) => updateShapeVisualStyle({ opacity: clamp(Number(event.currentTarget.value) / 100, 0.1, 1) }, 'Opacity updated')} />
          {nodeDataMixed('opacity') ? <small className="oc-mixed-note">Mixed</small> : null}
        </label>
      </div>
      <button type="button" className={`oc-wide-button oc-toggle ${node.data.shadowEnabled === true && !nodeDataMixed('shadowEnabled') ? 'is-active' : ''}`}
        aria-pressed={node.data.shadowEnabled === true && !nodeDataMixed('shadowEnabled')}
        onClick={() => updateShapeVisualStyle({ shadowEnabled: !(node.data.shadowEnabled === true && !nodeDataMixed('shadowEnabled')) }, 'Shadow updated')}>
        <span>Shadow</span><strong>{node.data.shadowEnabled === true && !nodeDataMixed('shadowEnabled') ? 'ON' : nodeDataMixed('shadowEnabled') ? 'MIXED' : 'OFF'}</strong>
      </button>
      <label className="oc-field oc-field-wide">
        <span>Shadow strength</span>
        <input type="range" min={0} max={1} step={0.05}
          value={typeof node.data.shadowStrength === 'number' ? node.data.shadowStrength : 0.45}
          onChange={(event) => updateShapeVisualStyle({ shadowEnabled: true, shadowStrength: clamp(Number(event.currentTarget.value), 0, 1) }, 'Shadow strength updated')} />
        {nodeDataMixed('shadowStrength') ? <small className="oc-mixed-note">Mixed</small> : null}
      </label>
    </div>
  );

  const renderConnectorAppearanceControls = (edge: Edge): ReactNode => (
    <div className="oc-style-panel-section">
      <div className="oc-section-title">Appearance</div>
      <ColorControl label="Line" value={selectedEdgeStrokeColor} mixed={edgeDataMixed('strokeColor')}
        onChange={(value) => updateConnectorVisualStyle({ strokeColor: value }, 'Connector color updated')} />
      <div className="oc-style-grid">
        <label className="oc-field"><span>Width</span><input type="number" min={0.5} max={10} step={0.5}
          value={edge.routing?.lineWidth ?? 2.5}
          onChange={(event) => updateConnectorVisualStyle({ lineWidth: clamp(Number(event.currentTarget.value), 0.5, 10) }, 'Connector width updated')} />
          {edgeRoutingMixed('lineWidth') ? <small className="oc-mixed-note">Mixed</small> : null}</label>
        <label className="oc-field"><span>Dash</span><select value={edge.routing?.lineStyle ?? 'solid'}
          onChange={(event) => updateConnectorVisualStyle({ lineStyle: event.currentTarget.value as 'solid' | 'dashed' | 'dotted' }, 'Connector dash updated')}>
          <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select>
          {edgeRoutingMixed('lineStyle') ? <small className="oc-mixed-note">Mixed</small> : null}</label>
        <label className="oc-field"><span>Route</span><select value={edge.routing?.mode ?? 'orthogonal'}
          onChange={(event) => updateConnectorVisualStyle({ mode: event.currentTarget.value as 'straight' | 'orthogonal' | 'curved' }, 'Connector route updated')}>
          <option value="straight">Straight</option><option value="orthogonal">Orthogonal</option><option value="curved">Curved</option></select>
          {edgeRoutingMixed('mode') ? <small className="oc-mixed-note">Mixed</small> : null}</label>
        <label className="oc-field"><span>Corner</span><input type="number" min={0} max={64} step={1} value={edge.routing?.cornerRadius ?? 9}
          onChange={(event) => updateConnectorVisualStyle({ cornerRadius: clamp(Number(event.currentTarget.value), 0, 64) }, 'Connector corners updated')} /></label>
      </div>
      <div className="oc-style-grid">
        {(['startMarker', 'endMarker'] as const).map((field) => (
          <label className="oc-field" key={field}><span>{field === 'startMarker' ? 'Start' : 'End'}</span>
            <select value={edge.routing?.[field] ?? (field === 'startMarker' ? 'none' : 'arrow')}
              onChange={(event) => {
                const marker = event.currentTarget.value;
                if (!isConnectorMarker(marker)) return;
                updateConnectorVisualStyle(
                  field === 'startMarker' ? { startMarker: marker } : { endMarker: marker },
                  `Connector ${field === 'startMarker' ? 'start' : 'end'} updated`,
                );
              }}>
              <option value="none">None</option><option value="arrow">Arrow</option><option value="open-arrow">Open arrow</option>
              <option value="circle">Dot</option><option value="diamond">Diamond</option><option value="bar">Bar</option><option value="crow-foot">Crow's foot</option>
            </select>{edgeRoutingMixed(field) ? <small className="oc-mixed-note">Mixed</small> : null}</label>
        ))}
      </div>
    </div>
  );

  const announceNavigation = useCallback(
    (item: SelectableItem, index: number): void => {
      const node = document.nodes[item.id];
      const label =
        typeof node?.data.altText === 'string' && node.data.altText.trim().length > 0
          ? node.data.altText.trim()
          : node?.label ?? item.id;
      const centerX = item.bounds.x + item.bounds.width / 2;
      const centerY = item.bounds.y + item.bounds.height / 2;
      const horizontal = centerX < scene.bounds.width / 3
        ? 'left'
        : centerX > scene.bounds.width * 2 / 3
          ? 'right'
          : 'center';
      const vertical = centerY < scene.bounds.height / 3
        ? 'top'
        : centerY > scene.bounds.height * 2 / 3
          ? 'bottom'
          : 'middle';
      setStatus(
        `Canvas navigation. ${label}. ${node?.kind ?? item.kind}. ${horizontal} ${vertical}. ${index + 1} of ${navigationItems.length}.`,
      );
    },
    [document.nodes, navigationItems.length, scene.bounds.height, scene.bounds.width],
  );

  const moveObjectCursor = useCallback(
    (direction: 1 | -1) => {
      if (!canvasNavigation || navigationItems.length === 0) {
        return;
      }
      const selectedId = selection.selectedIds[0];
      const currentIndex = navigationItems.findIndex((item) => item.id === selectedId);
      const nextIndex =
        currentIndex < 0
          ? direction > 0
            ? 0
            : navigationItems.length - 1
          : (currentIndex + direction + navigationItems.length) % navigationItems.length;
      const next = navigationItems[nextIndex];
      if (next !== undefined) {
        setSelection({ scopeId: selection.scopeId, selectedIds: [next.id] });
        announceNavigation(next, nextIndex);
      }
    },
    [announceNavigation, canvasNavigation, navigationItems, selection],
  );

  const moveObjectDirection = useCallback(
    (direction: 'left' | 'right' | 'up' | 'down') => {
      if (!canvasNavigation || navigationItems.length === 0) {
        return;
      }
      const current = navigationItems.find((item) => item.id === selection.selectedIds[0]);
      if (current === undefined) {
        const first = navigationItems[0];
        if (first !== undefined) {
          setSelection({ scopeId: selection.scopeId, selectedIds: [first.id] });
          announceNavigation(first, 0);
        }
        return;
      }
      const currentX = current.bounds.x + current.bounds.width / 2;
      const currentY = current.bounds.y + current.bounds.height / 2;
      const horizontal = direction === 'left' || direction === 'right';
      const candidates = navigationItems
        .filter((item) => {
          const x = item.bounds.x + item.bounds.width / 2;
          const y = item.bounds.y + item.bounds.height / 2;
          return direction === 'left'
            ? x < currentX
            : direction === 'right'
              ? x > currentX
              : direction === 'up'
                ? y < currentY
                : y > currentY;
        })
        .map((item) => {
          const x = item.bounds.x + item.bounds.width / 2;
          const y = item.bounds.y + item.bounds.height / 2;
          const primary = horizontal ? Math.abs(x - currentX) : Math.abs(y - currentY);
          const cross = horizontal ? Math.abs(y - currentY) : Math.abs(x - currentX);
          return { item, score: primary + cross * 2 };
        })
        .toSorted((left, right) => left.score - right.score);
      const next = candidates[0]?.item;
      if (next === undefined) {
        setStatus(`No object ${direction} of ${document.nodes[current.id]?.label ?? current.id}`);
        return;
      }
      const nextIndex = navigationItems.findIndex((item) => item.id === next.id);
      setSelection({ scopeId: selection.scopeId, selectedIds: [next.id] });
      announceNavigation(next, nextIndex);
    },
    [announceNavigation, canvasNavigation, document.nodes, navigationItems, selection],
  );

  const findMatches = useMemo(() => {
    const query = findQuery.trim().toLowerCase();
    if (query.length === 0) {
      return [];
    }
    return items.filter((item) => {
      const node = document.nodes[item.id];
      return (
        !item.hidden &&
        !item.locked &&
        (item.parentId ?? null) === selection.scopeId &&
        `${item.id} ${node?.label ?? ''}`.toLowerCase().includes(query)
      );
    });
  }, [document.nodes, findQuery, items, selection.scopeId]);

  const moveFindCursor = useCallback(
    (direction: 1 | -1) => {
      if (findMatches.length === 0) {
        setStatus(findQuery.trim().length === 0 ? 'Type a search term' : 'No matching objects');
        return;
      }
      const nextIndex =
        (findCursor + direction + findMatches.length) % findMatches.length;
      const match = findMatches[nextIndex];
      if (match !== undefined) {
        setFindCursor(nextIndex);
        setSelection({ scopeId: selection.scopeId, selectedIds: [match.id] });
        setStatus(`${nextIndex + 1} of ${findMatches.length}: ${document.nodes[match.id]?.label ?? match.id}`);
      }
    },
    [document.nodes, findCursor, findMatches, findQuery, selection.scopeId],
  );

  const replaceEditorDocument = useCallback(
    (opened: {
      readonly document: OpenChartDocument;
      readonly path?: string;
      readonly browserName?: string;
    }): void => {
      const nextEngine = new OperationEngine(opened.document);
      const pageId = orderedPages(nextEngine.document)[0]?.id ?? '';
      const nextScene = buildSceneDescription(nextEngine.document, {
        pageId,
        routingStrategy: 'document',
        ...(fullShapeCatalog === undefined
          ? {}
          : { shapeResolver: fullShapeCatalog.resolveLibraryShape }),
      });
      liveSession.reset(nextEngine);
      derivationRef.current?.abort();
      derivationRef.current = null;
      setDerivationBusy(false);
      documentPathRef.current = opened.path;
      setDocumentPath(opened.path);
      setSavedRevision(nextEngine.document.rev);
      setBrowserSaveName(opened.browserName);
      setActivePageId(pageId);
      setSelection(createSelectionState());
      setPreview(null);
      setEditing(null);
      setClipboard(null);
      setStyleSourceId(null);
      setTool('select');
      setCamera(fitCamera(nextScene, viewport));
      setOutputOpen(false);
      transactionCounter.current = 0;
    },
    [fullShapeCatalog, liveSession, viewport],
  );

  const openDocument = useCallback(async (): Promise<void> => {
    if (fileBusy || derivationBusy) {
      setStatus(derivationBusy ? 'Wait for layout or Beauty Pass to finish' : 'A file operation is already running');
      return;
    }
    if (documentDirty && !window.confirm('Discard unsaved changes and open another document?')) {
      return;
    }
    if (!desktopRuntime) {
      openDocumentInputRef.current?.click();
      return;
    }
    setFileBusy(true);
    try {
      const opened = await openDesktopDocument();
      if (opened === undefined) {
        return;
      }
      replaceEditorDocument(opened);
      setStatus(`Opened ${displayFilename(opened.path)}`);
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setFileBusy(false);
    }
  }, [derivationBusy, desktopRuntime, documentDirty, fileBusy, replaceEditorDocument]);

  const openBrowserDocument = useCallback(
    async (file: File): Promise<void> => {
      setFileBusy(true);
      try {
        if (file.size > MAX_BROWSER_DOCUMENT_BYTES) {
          setStatus('The selected file exceeds the 32 MiB document limit');
          return;
        }
        const opened = parseDesktopDocument(await file.text());
        replaceEditorDocument({ document: opened, browserName: file.name });
        setStatus(`Opened ${file.name}`);
      } catch (error: unknown) {
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        setFileBusy(false);
      }
    },
    [replaceEditorDocument],
  );

  const importOpenChartDocument = useCallback(
    async (file: File): Promise<void> => {
      if (activePage === undefined || activeLayerId === undefined) {
        setStatus('Create a visible page layer before importing');
        return;
      }
      setFileBusy(true);
      try {
        if (file.size > MAX_BROWSER_DOCUMENT_BYTES) {
          setStatus('The selected file exceeds the 32 MiB document limit');
          return;
        }
        const source = parseDesktopDocument(await file.text());
        const imported = createOpenChartPageImportTransaction(document, source, {
          txId: nextTransactionId('import-openchart'),
          targetPageId: activePage.id,
          targetLayerId: activeLayerId,
          makeUid,
        });
        if (
          commit(
            imported.envelope,
            `Imported ${file.name}`,
            { scopeId: selection.scopeId, selectedIds: imported.nodeIds },
          )
        ) {
          setOutputOpen(false);
        }
      } catch (error: unknown) {
        setStatus(error instanceof Error ? error.message : 'The OpenChart document could not be imported');
      } finally {
        setFileBusy(false);
      }
    },
    [activeLayerId, activePage, commit, document, nextTransactionId, selection.scopeId],
  );

  const saveDocument = useCallback(
    async (saveAs: boolean): Promise<void> => {
      if (!desktopRuntime) {
        const filename = `${safeFilename(document.title)}.openchart.json`;
        downloadBlob(
          new Blob([serializeOpenChartDocument(document)], { type: 'application/json' }),
          filename,
        );
        setBrowserSaveName(filename);
        setSavedRevision(document.rev);
        setOutputOpen(false);
        setStatus(`Saved ${filename}`);
        return;
      }
      if (fileBusy) {
        return;
      }
      setFileBusy(true);
      try {
        const savedPath = await saveDesktopDocument(
          document,
          saveAs ? undefined : documentPath,
          safeFilename(document.title),
        );
        if (savedPath === undefined) {
          return;
        }
        documentPathRef.current = savedPath;
        setDocumentPath(savedPath);
        setSavedRevision(document.rev);
        setOutputOpen(false);
        setStatus(`Saved ${displayFilename(savedPath)}`);
      } catch (error: unknown) {
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        setFileBusy(false);
      }
    },
    [desktopRuntime, document, documentPath, fileBusy],
  );

  const executeCommand = useCallback(
    (commandId: string) => {
      const nudge = (x: number, y: number): void => {
        const nodeIds = selection.selectedIds.filter((id) => document.nodes[id] !== undefined);
        if (nodeIds.length === 0) {
          return;
        }
        try {
          commitTransform(translateSelection(document, frames, nodeIds, { x, y }));
        } catch {
          setStatus('Show the hidden layer before nudging its shapes');
        }
      };
      switch (commandId) {
        case 'open-document':
          void openDocument();
          return;
        case 'save-document':
          void saveDocument(false);
          return;
        case 'save-document-as':
          void saveDocument(true);
          return;
        case 'select-tool':
          setTool('select');
          return;
        case 'connector-tool':
          setTool('connector');
          return;
        case 'pan':
          setTool('pan');
          return;
        case 'freehand-select':
          setTool('lasso');
          return;
        case 'deselect':
          if (shortcutOpen) {
            setShortcutOpen(false);
          } else if (outputOpen) {
            setOutputOpen(false);
          } else if (preferencesOpen) {
            setPreferencesOpen(false);
          } else if (templateOpen) {
            setTemplateOpen(false);
          } else if (shapeManagerOpen) {
            setShapeManagerOpen(false);
          } else if (pageMenuOpen) {
            setPageMenuOpen(false);
          } else if (linkEditor !== null) {
            setLinkEditor(null);
          } else if (findOpen) {
            setFindOpen(false);
          } else if (editing !== null) {
            cancelTextEdit();
          } else {
            setSelection((current) => clearSelection(current));
          }
          return;
        case 'shape-manager':
          setShapeManagerOpen((open) => !open);
          return;
        case 'show-shortcuts':
          setShortcutOpen((open) => !open);
          return;
        case 'zoom-in':
          setCamera((current) => ({ ...current, zoom: clamp(current.zoom * 1.15, 0.1, 4) }));
          return;
        case 'zoom-out':
          setCamera((current) => ({ ...current, zoom: clamp(current.zoom / 1.15, 0.1, 4) }));
          return;
        case 'zoom-reset':
          setCamera(fitCamera(scene, viewport));
          return;
        case 'undo': {
          const result = liveSession.undoLocal();
          if (result.ok) {
            setSelection((current) => ({
              scopeId: current.scopeId,
              selectedIds: current.selectedIds.filter(
                (id) =>
                  liveSession.document.nodes[id] !== undefined ||
                  liveSession.document.edges[id] !== undefined,
              ),
            }));
            setStatus('Undid last transaction');
          } else {
            setStatus(result.diagnostics[0]?.message ?? 'Nothing to undo');
          }
          return;
        }
        case 'redo': {
          const result = liveSession.redoLocal();
          if (result.ok) {
            setSelection((current) => ({
              scopeId: current.scopeId,
              selectedIds: current.selectedIds.filter(
                (id) =>
                  liveSession.document.nodes[id] !== undefined ||
                  liveSession.document.edges[id] !== undefined,
              ),
            }));
            setStatus('Redid last transaction');
          } else {
            setStatus(result.diagnostics[0]?.message ?? 'Nothing to redo');
          }
          return;
        }
        case 'beauty-pass':
          void runBeautyPass();
          return;
        case 'select-all':
          setSelection((current) => selectAll(current, items));
          return;
        case 'enter-scope':
          setSelection((current) => enterSelectionScope(current, items));
          return;
        case 'exit-scope':
          setSelection((current) => exitSelectionScope(current, items));
          return;
        case 'nudge-up':
          nudge(0, -8);
          return;
        case 'nudge-right':
          nudge(8, 0);
          return;
        case 'nudge-down':
          nudge(0, 8);
          return;
        case 'nudge-left':
          nudge(-8, 0);
          return;
        case 'fine-nudge-up':
          nudge(0, -1);
          return;
        case 'fine-nudge-right':
          nudge(1, 0);
          return;
        case 'fine-nudge-down':
          nudge(0, 1);
          return;
        case 'fine-nudge-left':
          nudge(-1, 0);
          return;
        case 'copy':
          {
            const nodeIds = selection.selectedIds.filter((id) => document.nodes[id] !== undefined);
            if (nodeIds.length > 0) {
              setClipboard(createClipboardPayload(document, nodeIds, frames));
              setStatus(`Copied ${nodeIds.length} object${nodeIds.length === 1 ? '' : 's'}`);
            }
          }
          return;
        case 'cut':
          {
            const nodeIds = selection.selectedIds.filter((id) => document.nodes[id] !== undefined);
            if (nodeIds.length > 0) {
              setClipboard(createClipboardPayload(document, nodeIds, frames));
              commit(
              {
                txId: nextTransactionId('cut'),
                actor: 'user',
                origin: 'gui',
                baseRev: document.rev,
                ops: nodeIds.map((id) => ({ op: 'delete_node', id })),
              },
              'Cut selection',
              clearSelection(selection),
            );
          }
          }
          return;
        case 'paste':
          pasteClipboard({ x: 24, y: 24 });
          return;
        case 'paste-in-place':
          pasteClipboard({ x: 0, y: 0 });
          return;
        case 'delete-selection': {
          const edgeIds = selection.selectedIds.filter((id) => document.edges[id] !== undefined);
          const nodeIds = selection.selectedIds.filter((id) => document.nodes[id] !== undefined);
          if (edgeIds.length === 0 && nodeIds.length === 0) {
            setStatus('Nothing selected to delete');
            return;
          }
          commit(
            {
              txId: nextTransactionId('delete-selection'),
              actor: 'user',
              origin: 'gui',
              baseRev: document.rev,
              ops: [...edgeIds.map((id) => ({ op: 'delete_edge' as const, id })), ...nodeIds.map((id) => ({ op: 'delete_node' as const, id }))],
            },
            `Deleted ${edgeIds.length + nodeIds.length} object${edgeIds.length + nodeIds.length === 1 ? '' : 's'}`,
            clearSelection(selection),
          );
          return;
        }
        case 'duplicate':
          {
            const nodeIds = selection.selectedIds.filter((id) => document.nodes[id] !== undefined);
            if (nodeIds.length > 0) {
              if (
                activePage !== undefined &&
                activeLayerId !== undefined &&
                document.layers[activeLayerId]?.locked === true
              ) {
                setStatus('Unlock the active layer before duplicating');
                return;
              }
              const payload = createClipboardPayload(document, nodeIds, frames);
              const existingIds: Readonly<Record<string, unknown>> = {
                ...document.nodes,
                ...document.ports,
                ...document.edges,
              };
              const reservedIds = new Set<string>();
              if (activePage !== undefined && activeLayerId !== undefined) {
                const paste = createPasteTransaction(document, payload, {
                  txId: nextTransactionId('duplicate'),
                  pageId: activePage.id,
                  layerId: activeLayerId,
                  offset: { x: 24, y: 24 },
                  allocateId: (_kind, sourceId) => allocateCopyId(existingIds, reservedIds, sourceId),
                  allocateUid: () => makeUid(),
                });
                commit(paste.envelope, 'Duplicated selection', {
                  scopeId: selection.scopeId,
                  selectedIds: paste.pastedRootNodeIds,
                });
              }
            }
          }
          return;
        case 'copy-style':
          if (selectedNode !== undefined) {
            setStyleSourceId(selectedNode.id);
            setStatus('Style copied');
          }
          return;
        case 'paste-style':
          {
          const nodeIds = selection.selectedIds.filter((id) => document.nodes[id] !== undefined);
          if (styleSourceId !== null && nodeIds.length > 0) {
            commit(
              createPasteStyleTransaction(document, styleSourceId, nodeIds, {
                txId: nextTransactionId('paste-style'),
              }),
              'Style applied',
            );
          }
          }
          return;
        case 'bold': {
          const targets = selection.selectedIds
            .map((id) => document.nodes[id]?.data ?? document.edges[id]?.data)
            .filter((data): data is NonNullable<typeof data> => data !== undefined);
          updateTextStyle(
            'fontWeight',
            targets.length > 0 && targets.every((data) => data.fontWeight === 700)
              ? 400
              : 700,
          );
          return;
        }
        case 'italic': {
          const targets = selection.selectedIds
            .map((id) => document.nodes[id]?.data ?? document.edges[id]?.data)
            .filter((data): data is NonNullable<typeof data> => data !== undefined);
          updateTextStyle(
            'fontStyle',
            targets.length > 0 && targets.every((data) => data.fontStyle === 'italic')
              ? 'normal'
              : 'italic',
          );
          return;
        }
        case 'underline': {
          const targets = selection.selectedIds
            .map((id) => document.nodes[id]?.data ?? document.edges[id]?.data)
            .filter((data): data is NonNullable<typeof data> => data !== undefined);
          updateTextStyle(
            'underline',
            !(targets.length > 0 && targets.every((data) => data.underline === true)),
          );
          return;
        }
        case 'font-size-up':
        case 'font-size-down': {
          const current = selectedTextData?.fontSize;
          const size = typeof current === 'number' && Number.isFinite(current)
            ? current
            : selectedEdge === undefined ? 18 : 10;
          updateTextStyle(
            'fontSize',
            clamp(size + (commandId === 'font-size-up' ? 2 : -2), 8, 96),
          );
          return;
        }
        case 'link':
          if (selectedNode === undefined) {
            setStatus('Select an object before adding a link');
          } else {
            setLinkEditor({
              id: selectedNode.id,
              value: typeof selectedNode.data.link === 'string' ? selectedNode.data.link : '',
            });
          }
          return;
        case 'group':
          createGroup();
          return;
        case 'ungroup':
          ungroupSelection();
          return;
        case 'edit-text':
          if (selectedNode !== undefined) {
            beginTextEdit(selectedNode.id);
          }
          return;
        case 'reroute-selection': {
          const edges = selection.selectedIds
            .map((id) => document.edges[id])
            .filter((edge): edge is Edge => edge !== undefined);
          if (edges.length === 0) {
            setStatus('Select one or more connectors to re-route');
            return;
          }
          const ops: Operation[] = edges.map((edge) => {
            const current = document.layout.edgeOverrides?.[edge.id];
            const layout = {
              ...(current?.labelT === undefined ? {} : { labelT: current.labelT }),
              ...(current?.labelPlacement === undefined
                ? {}
                : { labelPlacement: current.labelPlacement }),
              ...(current?.labelOffset === undefined
                ? {}
                : { labelOffset: current.labelOffset }),
            };
            return {
              op: 'set_edge_layout',
              id: edge.id,
              layout: Object.keys(layout).length === 0 ? null : layout,
            };
          });
          commit(
            {
              txId: nextTransactionId('reroute'),
              actor: 'user',
              origin: 'gui',
              baseRev: document.rev,
              ops,
            },
            `Re-routed ${edges.length} connector${edges.length === 1 ? '' : 's'}`,
          );
          return;
        }
        case 'toggle-obstacle-avoidance': {
          const edges = selection.selectedIds
            .map((id) => document.edges[id])
            .filter((edge): edge is Edge => edge !== undefined);
          if (edges.length === 0) {
            setStatus('Select one or more connectors to change routing');
            return;
          }
          const avoidObstacles = edges.some(
            (edge) => edge.routing?.avoidObstacles !== true,
          );
          commit(
            {
              txId: nextTransactionId('obstacle-routing'),
              actor: 'user',
              origin: 'gui',
              baseRev: document.rev,
              ops: edges.map((edge) => ({
                op: 'set_edge_routing',
                id: edge.id,
                routing: {
                  mode: edge.routing?.mode ?? 'orthogonal',
                  ...(edge.routing?.cornerRadius === undefined
                    ? {}
                    : { cornerRadius: edge.routing.cornerRadius }),
                  ...(edge.routing?.jumpStyle === undefined
                    ? {}
                    : { jumpStyle: edge.routing.jumpStyle }),
                  avoidObstacles,
                },
              })),
            },
            `Obstacle avoidance ${avoidObstacles ? 'enabled' : 'disabled'}`,
          );
          return;
        }
        case 'align-up':
          alignSelection('up');
          return;
        case 'align-right':
          alignSelection('right');
          return;
        case 'align-down':
          alignSelection('down');
          return;
        case 'align-left':
          alignSelection('left');
          return;
        case 'distribute-horizontal':
          distributeSelection('horizontal');
          return;
        case 'distribute-vertical':
          distributeSelection('vertical');
          return;
        case 'equal-spacing':
          distributeSelection('equal-spacing');
          return;
        case 'bring-front':
          reorderSelection('front');
          return;
        case 'bring-forward':
          reorderSelection('forward');
          return;
        case 'send-backward':
          reorderSelection('backward');
          return;
        case 'send-back':
          reorderSelection('back');
          return;
        case 'find':
          setFindOpen(true);
          setFindCursor(-1);
          return;
        case 'find-next':
          if (!findOpen) {
            setFindOpen(true);
          } else {
            moveFindCursor(1);
          }
          return;
        case 'find-previous':
          if (!findOpen) {
            setFindOpen(true);
          } else {
            moveFindCursor(-1);
          }
          return;
        case 'canvas-navigation':
          persistPreferences({
            ...preferences,
            canvasNavigation: !canvasNavigation,
          });
          setStatus(
            canvasNavigation
              ? 'Canvas navigation off'
              : 'Canvas navigation on. Use Tab or Control plus an arrow to move between objects.',
          );
          return;
        case 'next-object':
          moveObjectCursor(1);
          return;
        case 'previous-object':
          moveObjectCursor(-1);
          return;
        case 'next-page':
        case 'previous-page': {
          const index = pages.findIndex((page) => page.id === activePageId);
          const delta = commandId === 'next-page' ? 1 : -1;
          const next = pages[index + delta];
          if (next !== undefined) {
            setActivePageId(next.id);
            setSelection(createSelectionState());
          }
          return;
        }
        default: {
          const command: CommandDefinition | undefined = WINDOWS_COMMANDS.find(
            (candidate) => candidate.id === commandId,
          );
          setStatus(command?.available === false ? command.unavailableReason ?? 'Command unavailable' : `${command?.label ?? commandId} is not wired yet`);
        }
      }
    },
    [
      activeLayerId,
      activePage,
      activePageId,
      alignSelection,
      beginTextEdit,
      canvasNavigation,
      commit,
      commitTextEdit,
      commitTransform,
      createGroup,
      distributeSelection,
      document,
      editing,
      findOpen,
      frames,
      items,
      linkEditor,
      liveSession,
      moveFindCursor,
      moveObjectCursor,
      nextTransactionId,
      openDocument,
      pages,
      pageMenuOpen,
      pasteClipboard,
      persistPreferences,
      preferences,
      preferencesOpen,
      reorderSelection,
      runBeautyPass,
      saveDocument,
      scene,
      selectedNode,
      selection,
      shortcutOpen,
      shapeManagerOpen,
      styleSourceId,
      outputOpen,
      templateOpen,
      ungroupSelection,
      updateTextStyle,
      viewport,
    ],
  );
  commandDispatcher.current = executeCommand;

  useEffect(() => {
    if (!desktopRuntime) return;
    let cancelled = false;
    let stop: (() => Promise<void>) | undefined;
    const timer = window.setTimeout(() => {
      void import('./live-mcp.js')
        .then(async ({ startLiveMcpBridge }) => {
          if (cancelled) return;
          stop = await startLiveMcpBridge(liveSession);
          if (cancelled) await stop();
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setStatus(`MCP host unavailable: ${error instanceof Error ? error.message : String(error)}`);
          }
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      void stop?.();
    };
  }, [desktopRuntime, liveSession]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      const isTextTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLButtonElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      const isCanvasTarget =
        target instanceof HTMLCanvasElement && target.classList.contains('oc-canvas-overlay');
      if (
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.shiftKey &&
        event.code === 'Space' &&
        !isTextTarget &&
        editing === null
      ) {
        event.preventDefault();
        quickInsertInputRef.current?.focus();
        return;
      }
      const direction = event.key === 'ArrowLeft'
        ? 'left'
        : event.key === 'ArrowRight'
          ? 'right'
          : event.key === 'ArrowUp'
            ? 'up'
            : event.key === 'ArrowDown'
              ? 'down'
              : undefined;
      if (
        canvasNavigation &&
        isCanvasTarget &&
        !isTextTarget &&
        event.ctrlKey &&
        !event.altKey &&
        direction !== undefined
      ) {
        event.preventDefault();
        moveObjectDirection(direction);
        return;
      }
      if (
        isCanvasTarget &&
        !isTextTarget &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.shiftKey &&
        event.key.length === 1 &&
        selection.selectedIds.length === 1
      ) {
        const selectedId = selection.selectedIds[0];
        if (selectedId !== undefined && document.nodes[selectedId] !== undefined) {
          event.preventDefault();
          beginTextEdit(selectedId, event.key);
          return;
        }
      }
      const command = resolveShortcut(
        {
          key: event.key,
          ctrl: event.ctrlKey,
          alt: event.altKey,
          shift: event.shiftKey,
        },
        { textEditing: isTextTarget || editing !== null },
      );
      if (command === undefined) {
        return;
      }
      if (
        (
          command.id === 'next-object' ||
          command.id === 'previous-object' ||
          command.id === 'enter-scope' ||
          command.id === 'exit-scope'
        ) &&
        (!canvasNavigation || !isCanvasTarget)
      ) {
        return;
      }
      event.preventDefault();
      commandDispatcher.current(command.id);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [beginTextEdit, canvasNavigation, document.nodes, editing, moveObjectDirection, selection.selectedIds]);

  useEffect(() => {
    if (
      !outputOpen &&
      !preferencesOpen &&
      !templateOpen &&
      !shortcutOpen &&
      !shapeManagerOpen &&
      linkEditor === null
    ) {
      return;
    }
    const dialog = window.document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
    if (dialog === null) {
      return;
    }
    const keepFocusInside = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') {
        return;
      }
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => !element.hidden);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (first === undefined || last === undefined) {
        return;
      }
      if (event.shiftKey && window.document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && window.document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', keepFocusInside);
    return () => dialog.removeEventListener('keydown', keepFocusInside);
  }, [linkEditor, outputOpen, preferencesOpen, shapeManagerOpen, shortcutOpen, templateOpen]);

  useEffect(() => {
    const selectionStale = (id: string): boolean => {
      const layerId = document.nodes[id]?.layerId ?? document.edges[id]?.layerId;
      const layer = layerId === undefined ? undefined : document.layers[layerId];
      return layer?.locked === true || layer?.visible !== true;
    };
    setSelection((current) => {
      if (!current.selectedIds.some(selectionStale)) return current;
      return {
        scopeId: current.scopeId,
        selectedIds: current.selectedIds.filter((id) => !selectionStale(id)),
      };
    });
  }, [document]);

  useEffect(() => {
    if (!findOpen || findMatches.length === 0 || findCursor >= 0) {
      return;
    }
    const first = findMatches[0];
    if (first !== undefined) {
      setFindCursor(0);
      setSelection({ scopeId: selection.scopeId, selectedIds: [first.id] });
      setStatus(`1 of ${findMatches.length}: ${document.nodes[first.id]?.label ?? first.id}`);
    }
  }, [document.nodes, findCursor, findMatches, findOpen, selection.scopeId]);

  const updateSelectedLayout = (field: 'x' | 'y' | 'width' | 'height' | 'rotation', value: number): void => {
    if (selectedNode === undefined || !Number.isFinite(value)) {
      return;
    }
    const current = frames[selectedNode.id];
    if (current === undefined) {
      return;
    }
    const next = {
      ...current,
      [field]: field === 'width' || field === 'height' ? Math.max(16, value) : value,
    };
    commitTransform({ selectionBounds: next, updates: { [selectedNode.id]: next } });
  };

  const createPage = (): void => {
    const pageId = nextMapId(document.pages, 'page');
    const layerId = `${pageId}.base`;
    const order = pages.length;
    if (
      commit(
        {
          txId: nextTransactionId('page'),
          actor: 'user',
          origin: 'gui',
          baseRev: document.rev,
          ops: [
            {
              op: 'create_page',
              page: {
                id: pageId,
                uid: makeUid(),
                name: `Page ${pages.length + 1}`,
                layerIds: [layerId],
                order,
              },
              baseLayer: {
                id: layerId,
                uid: makeUid(),
                name: 'Base',
                pageId,
                visible: true,
                locked: false,
              },
            },
            ...pages.map(
              (page, index): Operation => ({
                op: 'set_page_order',
                id: page.id,
                order: index,
              }),
            ),
            { op: 'set_page_order', id: pageId, order },
          ],
        },
        'Page created',
      )
    ) {
      setActivePageId(pageId);
      setSelection(createSelectionState());
    }
  };

  const createLayer = (): void => {
    if (activePage === undefined) {
      return;
    }
    const id = nextMapId(document.layers, `${activePage.id}.layer`);
    commit(
      {
        txId: nextTransactionId('layer'),
        actor: 'user',
        origin: 'gui',
        baseRev: document.rev,
        ops: [
          {
            op: 'create_layer',
            layer: {
              id,
              uid: makeUid(),
              name: `Layer ${activePage.layerIds.length}`,
              pageId: activePage.id,
              visible: true,
              locked: false,
            },
          },
        ],
      },
      'Layer created',
    );
  };

  const reorderPages = (pageId: string, delta: -1 | 1): void => {
    const index = pages.findIndex((page) => page.id === pageId);
    const targetIndex = index + delta;
    if (index < 0 || targetIndex < 0 || targetIndex >= pages.length) {
      return;
    }
    const reordered = [...pages];
    const [moved] = reordered.splice(index, 1);
    if (moved === undefined) {
      return;
    }
    reordered.splice(targetIndex, 0, moved);
    commit(
      {
        txId: nextTransactionId('page-order'),
        actor: 'user',
        origin: 'gui',
        baseRev: document.rev,
        ops: reordered.map(
          (page, order): Operation => ({
            op: 'set_page_order',
            id: page.id,
            order,
          }),
        ),
      },
      'Page order updated',
    );
  };

  const reorderLayer = (layerId: string, delta: -1 | 1): void => {
    if (activePage === undefined) {
      return;
    }
    const index = activePage.layerIds.indexOf(layerId);
    const targetIndex = index + delta;
    if (index <= 0 || targetIndex <= 0 || targetIndex >= activePage.layerIds.length) {
      return;
    }
    const layerIds = [...activePage.layerIds];
    const [moved] = layerIds.splice(index, 1);
    if (moved === undefined) {
      return;
    }
    layerIds.splice(targetIndex, 0, moved);
    commit(
      {
        txId: nextTransactionId('layer-order'),
        actor: 'user',
        origin: 'gui',
        baseRev: document.rev,
        ops: [{ op: 'reorder_layers', pageId: activePage.id, layerIds }],
      },
      'Layer order updated',
    );
  };

  const duplicateActivePage = (): void => {
    if (activePage === undefined) {
      return;
    }
    const pageId = nextMapId(document.pages, 'page');
    const sourceLayerIds = activePage.layerIds;
    const layerMap = new Map<string, string>();
    sourceLayerIds.forEach((sourceId, index) => {
      layerMap.set(sourceId, index === 0 ? `${pageId}.base` : `${pageId}.layer-${index}`);
    });
    const baseSource = document.layers[sourceLayerIds[0] ?? ''];
    const baseLayerId = layerMap.get(sourceLayerIds[0] ?? '');
    if (baseSource === undefined || baseLayerId === undefined) {
      setStatus('The source page has no valid base layer');
      return;
    }
    const nodeReserved = new Set<string>();
    const portReserved = new Set<string>();
    const edgeReserved = new Set<string>();
    const nodeMap = new Map<string, string>();
    const sourceNodes = Object.values(document.nodes)
      .filter((node) => node.pageId === activePage.id)
      .sort((left, right) => compareIds(left.id, right.id));
    sourceNodes.forEach((node) => {
      nodeMap.set(node.id, allocateCopyId(document.nodes, nodeReserved, node.id));
    });
    const sourcePorts = Object.values(document.ports)
      .filter((port) => nodeMap.has(port.nodeId))
      .sort((left, right) => compareIds(left.id, right.id));
    const portMap = new Map<string, string>();
    sourcePorts.forEach((port) => {
      portMap.set(port.id, allocateCopyId(document.ports, portReserved, port.id));
    });
    const sourceEdges = Object.values(document.edges)
      .filter(
        (edge) =>
          edge.pageId === activePage.id &&
          portMap.has(edge.fromPortId) &&
          portMap.has(edge.toPortId),
      )
      .sort((left, right) => compareIds(left.id, right.id));
    const sourcePageIndex = pages.findIndex((page) => page.id === activePage.id);
    const targetPageIndex = sourcePageIndex < 0 ? pages.length : sourcePageIndex + 1;
    const pageOrderIds = pages.map((page) => page.id);
    pageOrderIds.splice(targetPageIndex, 0, pageId);
    const ops: Operation[] = [
      {
        op: 'create_page',
        page: {
          id: pageId,
          uid: makeUid(),
          name: `${activePage.name} copy`,
          layerIds: [baseLayerId],
          order: targetPageIndex,
          ...(activePage.color === undefined ? {} : { color: activePage.color }),
        },
        baseLayer: {
          ...baseSource,
          id: baseLayerId,
          uid: makeUid(),
          pageId,
          locked: false,
        },
      },
    ];
    ops.push(
      ...pageOrderIds.map(
        (id, order): Operation => ({ op: 'set_page_order', id, order }),
      ),
    );
    for (const sourceLayerId of sourceLayerIds.slice(1)) {
      const source = document.layers[sourceLayerId];
      const id = layerMap.get(sourceLayerId);
      if (source !== undefined && id !== undefined) {
        ops.push({
          op: 'create_layer',
          layer: { ...source, id, uid: makeUid(), pageId },
        });
      }
    }
    for (const source of sourceNodes) {
      const id = nodeMap.get(source.id);
      const layerId = layerMap.get(source.layerId);
      const parentId =
        source.parentId === undefined ? undefined : nodeMap.get(source.parentId);
      if (id === undefined || layerId === undefined) {
        continue;
      }
      if (source.parentId !== undefined && parentId === undefined) {
        throw new Error(`Unable to map duplicated parent ${JSON.stringify(source.parentId)}`);
      }
      ops.push({
        op: 'create_node',
        node: {
          ...source,
          id,
          uid: makeUid(),
          pageId,
          layerId,
          ...(parentId === undefined ? {} : { parentId }),
        },
      });
      const layout = document.layout.overrides[source.id];
      if (layout !== undefined) {
        ops.push({ op: 'set_node_layout', id, layout: { ...layout } });
      }
    }
    for (const source of sourcePorts) {
      const id = portMap.get(source.id);
      const nodeId = nodeMap.get(source.nodeId);
      if (id !== undefined && nodeId !== undefined) {
        ops.push({ op: 'create_port', port: { ...source, id, uid: makeUid(), nodeId } });
      }
    }
    for (const source of sourceEdges) {
      const id = allocateCopyId(document.edges, edgeReserved, source.id);
      const fromPortId = portMap.get(source.fromPortId);
      const toPortId = portMap.get(source.toPortId);
      const layerId = layerMap.get(source.layerId);
      if (fromPortId !== undefined && toPortId !== undefined && layerId !== undefined) {
        ops.push({
          op: 'create_edge',
          edge: {
            ...source,
            id,
            uid: makeUid(),
            fromPortId,
            toPortId,
            pageId,
            layerId,
          },
        });
      }
    }
    if (
      commit(
        {
          txId: nextTransactionId('duplicate-page'),
          actor: 'user',
          origin: 'gui',
          baseRev: document.rev,
          ops,
        },
        `Duplicated ${activePage.name}`,
      )
    ) {
      setActivePageId(pageId);
      setSelection(createSelectionState());
      setPageMenuOpen(false);
    }
  };

  const deleteActivePage = (): void => {
    if (activePage === undefined || pages.length <= 1) {
      setStatus('A document must keep at least one page');
      return;
    }
    const currentIndex = pages.findIndex((page) => page.id === activePage.id);
    const fallback = pages[currentIndex + 1] ?? pages[currentIndex - 1];
    if (
      commit(
        {
          txId: nextTransactionId('delete-page'),
          actor: 'user',
          origin: 'gui',
          baseRev: document.rev,
          ops: [
            { op: 'delete_page', id: activePage.id },
            ...pages
              .filter((page) => page.id !== activePage.id)
              .map(
                (page, order): Operation => ({
                  op: 'set_page_order',
                  id: page.id,
                  order,
                }),
              ),
          ],
        },
        `${activePage.name} deleted`,
      )
    ) {
      setActivePageId(fallback?.id ?? '');
      setSelection(createSelectionState());
      setPageMenuOpen(false);
    }
  };

  const exportDiagram = async (): Promise<void> => {
    if (exportBusy) {
      return;
    }
    setExportBusy(true);
    try {
      const format = preferences.exportFormat;
      if (format === 'd2' || format === 'mermaid') {
        const { createBrowserTextExport } = await loadBrowserTextExport();
        const exported = createBrowserTextExport(document, format, activePage?.id);
        downloadBlob(
          new Blob([exported.content], { type: exported.mimeType }),
          `${safeFilename(document.title)}.${exported.extension}`,
        );
        const label = format === 'd2' ? 'D2' : 'Mermaid';
        setStatus(
          `Exported ${label}${exported.losses.length === 0
            ? ''
            : ` · ${exported.losses.length} projection notice${exported.losses.length === 1 ? '' : 's'}`}`,
        );
        setOutputOpen(false);
        return;
      }
      const svg = renderSceneToSvg(scene);
      const blob = format === 'svg'
        ? new Blob([svg], { type: 'image/svg+xml' })
        : await rasterizeScene(svg, scene, format, preferences.exportScale);
      const extension = format === 'jpeg' ? 'jpg' : format;
      downloadBlob(blob, `${safeFilename(document.title)}.${extension}`);
      setStatus(
        `Exported ${format.toUpperCase()}${format === 'svg' ? '' : ` at ${preferences.exportScale}×`}`,
      );
      setOutputOpen(false);
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : 'The diagram could not be exported');
    } finally {
      setExportBusy(false);
    }
  };

  const printDiagram = (): void => {
    try {
      printScene(scene);
      setStatus('Print preview opened');
      setOutputOpen(false);
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : 'Print preview could not be opened');
    }
  };

  const chooseTemplate = async (templateId: StarterTemplateId | 'blank'): Promise<void> => {
    if (activePage === undefined || activeLayerId === undefined) {
      setStatus('Create a visible page layer before applying a starter');
      return;
    }
    if (templateId === 'blank') {
      if (activePage.layerIds.some((id) => document.layers[id]?.locked === true)) {
        setStatus('Unlock all page layers before clearing the canvas');
        return;
      }
    } else if (document.layers[activeLayerId]?.locked === true) {
      setStatus('Unlock the active layer before applying a template');
      return;
    }
    try {
      const templates = starterTemplateModule ?? await loadStarterTemplates();
      if (templateId === 'blank') {
        const envelope = templates.createBlankPageTransaction(document, {
          txId: nextTransactionId('blank-template'),
          pageId: activePage.id,
        });
        if (envelope !== undefined) {
          if (!commit(envelope, 'Blank canvas applied', createSelectionState())) return;
        } else {
          setStatus('Canvas is already blank');
        }
        setTemplateOpen(false);
        return;
      }
      const template = templates.getStarterTemplate(templateId);
      const transaction = templates.createStarterTemplateTransaction(document, template, {
        txId: nextTransactionId(`template-${template.id}`),
        pageId: activePage.id,
        layerId: activeLayerId,
        makeUid,
      });
      if (
        commit(
          transaction.envelope,
          `${template.name} starter applied`,
          { scopeId: selection.scopeId, selectedIds: transaction.nodeIds },
        )
      ) {
        setTemplateOpen(false);
      }
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : 'Starter template could not be applied');
    }
  };

  const shortcutResults = searchCommands(shortcutQuery);
  const saveStateLabel = documentDirty
    ? 'Unsaved changes'
    : documentPath !== undefined
      ? 'Saved locally'
      : browserSaveName === undefined
        ? 'Local document'
        : 'Saved to downloads';

  return (
    <main className={`oc-app${inspectorOpen ? ' oc-inspector-open' : ''}`} aria-label="OpenChart diagram editor">
      <header className="oc-topbar">
        <OpenChartBrand />
        <div className="oc-document-title">
          <input
            aria-label="Document title"
            defaultValue={document.title}
            key={`${document.documentId}-${document.title}`}
            onBlur={(event) => {
              const title = event.currentTarget.value.trim();
              if (title.length === 0 || title === document.title) {
                event.currentTarget.value = document.title;
                return;
              }
              commit({
                txId: nextTransactionId('document-title'),
                actor: 'user',
                origin: 'gui',
                baseRev: document.rev,
                ops: [{ op: 'set_document_title', title }],
              }, 'Document renamed');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              } else if (event.key === 'Escape') {
                event.currentTarget.value = document.title;
                event.currentTarget.blur();
              }
            }}
            title="Rename document"
          />
        </div>
        <button
          type="button"
          className={`oc-save-state${documentDirty ? ' is-dirty' : ''}`}
          disabled={fileBusy}
          onClick={() => void saveDocument(false)}
          title={documentPath ?? browserSaveName ?? 'Save document (Ctrl+S)'}
        >
          <Icon src={cloudCheckIcon} size={16} />{saveStateLabel}
        </button>
        <nav className="oc-header-actions" aria-label="Document actions">
          <button type="button" aria-label="Export" onClick={() => setOutputOpen(true)} aria-expanded={outputOpen} title="Export and print">
            <Icon src={downloadIcon} size={17} /><span>Export</span>
          </button>
          <button type="button" onClick={() => setShortcutOpen(true)} title="Shortcuts (F1)">
            <Icon src={keyboardIcon} size={18} /><span>Shortcuts</span>
          </button>
          <button
            type="button"
            className={inspectorOpen ? 'is-active' : ''}
            aria-pressed={inspectorOpen}
            onClick={() => setInspectorOpen((open) => !open)}
            title={`${inspectorOpen ? 'Hide' : 'Show'} contextual panel`}
          >
            <Icon src={sidebarIcon} size={18} /><span>Panel</span>
          </button>
        </nav>
      </header>

      <nav className="oc-formatbar" aria-label="Formatting bar">
        <div className="oc-toolbar" aria-label="Diagram tools">
          {(['select', 'connector', 'pan', 'lasso'] as const).map((candidate) => (
            <button
              className={tool === candidate ? 'is-active' : ''}
              type="button"
              key={candidate}
              aria-pressed={tool === candidate}
              onClick={() => setTool(candidate)}
              title={`${candidate[0]?.toUpperCase() ?? ''}${candidate.slice(1)} tool`}
            >
              <ToolIcon kind={candidate} />
            </button>
          ))}
          <span className="oc-toolbar-divider" />
          <label className="oc-font-size-select">
            <span className="oc-visually-hidden">Font size</span>
            <select
              aria-label="Font size"
              disabled={selectedTextData === undefined}
              value={typeof selectedTextData?.fontSize === 'number' ? selectedTextData.fontSize : selectedEdge === undefined ? 18 : 10}
              onChange={(event) => updateTextStyle('fontSize', Number(event.currentTarget.value))}
            >
              {[8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 72, 96].map((size) => (
                <option value={size} key={size}>{size} pt</option>
              ))}
            </select>
          </label>
          <label>
            <span className="oc-visually-hidden">Font family</span>
            <select
              aria-label="Font family"
              disabled={selectedTextData === undefined}
              value={typeof selectedTextData?.fontFamily === 'string'
                ? selectedTextData.fontFamily
                : selectedEdge === undefined
                  ? 'Aptos Display, Segoe UI, sans-serif'
                  : 'Segoe UI, Arial, sans-serif'}
              onChange={(event) => updateTextStyle('fontFamily', event.currentTarget.value)}
            >
              <option value="Aptos Display, Segoe UI, sans-serif">Aptos</option>
              <option value="Segoe UI, Arial, sans-serif">Segoe UI</option>
              <option value="Arial, sans-serif">Arial</option>
              <option value="Georgia, serif">Georgia</option>
              <option value="Cascadia Code, Consolas, monospace">Cascadia Code</option>
              <option value="Consolas, monospace">Consolas</option>
            </select>
          </label>
          <button
            type="button"
            className={selectedTextData?.fontWeight === 700 ? 'is-active' : ''}
            aria-pressed={selectedTextData?.fontWeight === 700}
            onClick={() => executeCommand('bold')}
            disabled={selectedTextData === undefined}
            title="Bold (Ctrl+B)"
          ><strong>B</strong></button>
          <button
            type="button"
            className={selectedTextData?.fontStyle === 'italic' ? 'is-active' : ''}
            aria-pressed={selectedTextData?.fontStyle === 'italic'}
            onClick={() => executeCommand('italic')}
            disabled={selectedTextData === undefined}
            title="Italic (Ctrl+I)"
          ><em>I</em></button>
          <button
            type="button"
            className={selectedTextData?.underline === true ? 'is-active' : ''}
            aria-pressed={selectedTextData?.underline === true}
            onClick={() => executeCommand('underline')}
            disabled={selectedTextData === undefined}
            title="Underline (Ctrl+U)"
          ><span style={{ textDecoration: 'underline' }}>U</span></button>
          <button
            type="button"
            className={selectedTextData?.textAlign === 'left' || (selectedTextData?.textAlign === undefined && selectedEdge === undefined) ? 'is-active' : ''}
            aria-pressed={selectedTextData?.textAlign === 'left' || (selectedTextData?.textAlign === undefined && selectedEdge === undefined)}
            onClick={() => updateTextStyle('textAlign', 'left')}
            disabled={selectedTextData === undefined}
            title="Align left"
          >≡</button>
          <button
            type="button"
            className={selectedTextData?.textAlign === 'center' || (selectedTextData?.textAlign === undefined && selectedEdge !== undefined) ? 'is-active' : ''}
            aria-pressed={selectedTextData?.textAlign === 'center' || (selectedTextData?.textAlign === undefined && selectedEdge !== undefined)}
            onClick={() => updateTextStyle('textAlign', 'center')}
            disabled={selectedTextData === undefined}
            title="Align center"
          >≡</button>
          <button
            type="button"
            className={selectedTextData?.textAlign === 'right' ? 'is-active' : ''}
            aria-pressed={selectedTextData?.textAlign === 'right'}
            onClick={() => updateTextStyle('textAlign', 'right')}
            disabled={selectedTextData === undefined}
            title="Align right"
          >≡</button>
          <label className="oc-color-field">
            <span className="oc-visually-hidden">Text color</span>
            <input
              type="color"
              aria-label="Text color"
              disabled={selectedTextData === undefined}
              value={typeof selectedTextData?.textColor === 'string' && /^#[0-9a-f]{6}$/i.test(selectedTextData.textColor)
                ? selectedTextData.textColor
                : '#0F172A'}
              onChange={(event) => updateTextStyle('textColor', event.currentTarget.value)}
            />
          </label>
          <label className="oc-font-size-select">
            <span className="oc-visually-hidden">Line height</span>
            <select
              aria-label="Line height"
              disabled={selectedTextData === undefined}
              value={typeof selectedTextData?.lineHeight === 'number' ? selectedTextData.lineHeight : 1.2}
              onChange={(event) => updateTextStyle('lineHeight', Number(event.currentTarget.value))}
            >
              {[1, 1.1, 1.2, 1.35, 1.5, 1.75, 2].map((lineHeight) => (
                <option value={lineHeight} key={lineHeight}>{lineHeight}×</option>
              ))}
            </select>
          </label>
          <span className="oc-toolbar-divider" />
          <button type="button" onClick={() => executeCommand('undo')} title="Undo (Ctrl+Z)"><Icon src={arrowCounterClockwiseIcon} size={17} /></button>
          <button type="button" onClick={() => executeCommand('redo')} title="Redo (Ctrl+Y)"><Icon src={arrowClockwiseIcon} size={17} /></button>
        </div>
        <div className="oc-compose-bar" role="group" aria-label="Layout and Beauty Pass controls">
          <label>
            <span>Layout</span>
            <select
              aria-label="Layout mode"
              value={layoutMode}
              disabled={derivationBusy}
              onChange={(event) => setLayoutMode(event.currentTarget.value as LayoutMode)}
            >
              <option value="layered">Layered</option>
              <option value="tree">Tree</option>
              <option value="radial">Radial</option>
              <option value="force">Force</option>
            </select>
          </label>
          <button type="button" disabled={derivationBusy} onClick={() => void runAutoLayout()} title="Apply automatic layout">
            <Icon src={layoutIcon} size={16} />Arrange
          </button>
          <button
            type="button"
            disabled={!canDistributeSelection}
            onClick={() => executeCommand('distribute-horizontal')}
            title="Distribute selected shapes horizontally (Ctrl+Shift+H)"
          >Distribute H</button>
          <button
            type="button"
            disabled={!canDistributeSelection}
            onClick={() => executeCommand('distribute-vertical')}
            title="Distribute selected shapes vertically (Ctrl+Alt+Shift+V)"
          >Distribute V</button>
          <button
            type="button"
            disabled={!canDistributeSelection}
            onClick={() => executeCommand('equal-spacing')}
            title="Equal spacing on dominant axis (Ctrl+Shift+E)"
          >Equal space</button>
          <label>
            <span>Theme</span>
            <select
              aria-label="Theme preset"
              value={activePresetId}
              disabled={derivationBusy}
              onChange={(event) => {
                if (isTokenPresetId(event.currentTarget.value)) {
                  applyThemePreset(event.currentTarget.value);
                }
              }}
            >
              {TOKEN_PRESET_IDS.map((presetId) => (
                <option value={presetId} key={presetId}>{TOKEN_PRESETS[presetId].label}</option>
              ))}
            </select>
          </label>
          <button className="oc-beauty-button" type="button" disabled={derivationBusy} onClick={() => void runBeautyPass()} title="Beauty Pass (Ctrl+Alt+B)">
            <Icon src={sparkleIcon} size={16} />{derivationBusy ? 'Working…' : 'Beauty Pass'}
          </button>
        </div>
      </nav>

      <nav className="oc-primary-rail" aria-label="Editor panels">
        <button type="button" className="is-active" title="Shapes panel" aria-pressed="true"><Icon src={shapesIcon} /></button>
        <button type="button" title="Open templates" onClick={() => setTemplateOpen(true)}><Icon src={layoutIcon} /></button>
        <button type="button" title="Open layers" onClick={() => { setInspectorTab('layers'); setInspectorOpen(true); }}><Icon src={stackIcon} /></button>
        <button type="button" title="Open file and export" onClick={() => setOutputOpen(true)}><Icon src={fileIcon} /></button>
      </nav>

      <aside className="oc-shape-rail" aria-label="Shape library">
        <div className="oc-rail-heading">
          <strong>Shapes</strong>
          <button type="button" title="Manage shape libraries (M)" onClick={() => setShapeManagerOpen(true)}><Icon src={magnifyingGlassIcon} size={18} /></button>
        </div>
        <label className="oc-rail-category">
          <span>Library</span>
          <select
            aria-label="Shape panel category"
            value={railLibraryId}
            onChange={(event) => setRailLibraryId(event.currentTarget.value)}
          >
            <option value="featured">Featured</option>
            <optgroup label="Diagram shapes">
              {SHAPE_LIBRARIES.filter((library) => library.kind === 'diagram').map((library) => (
                <option value={library.id} key={library.id}>{library.label}</option>
              ))}
            </optgroup>
            <optgroup label="Decorative icons">
              {SHAPE_LIBRARIES.filter((library) => library.kind === 'icon').map((library) => (
                <option value={library.id} key={library.id}>{library.label}</option>
              ))}
            </optgroup>
          </select>
        </label>
        <div className="oc-rail-search">
          <label>
            <span aria-hidden="true"><Icon src={magnifyingGlassIcon} size={15} /></span>
            <input
              ref={quickInsertInputRef}
              type="search"
              value={railShapeQuery}
              onChange={(event) => setRailShapeQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && railShapeQuery.length > 0) {
                  event.preventDefault();
                  setRailShapeQuery('');
                  return;
                }
                if (event.key === 'Enter' && railShapeResults[0] !== undefined) {
                  event.preventDefault();
                  addNode(shapePaletteItem(railShapeResults[0]));
                  setRailShapeQuery('');
                  return;
                }
                if (event.key === 'ArrowDown') {
                  const firstResult = event.currentTarget
                    .closest('.oc-shape-rail')
                    ?.querySelector<HTMLButtonElement>('.oc-rail-search-results button');
                  if (firstResult !== null && firstResult !== undefined) {
                    event.preventDefault();
                    firstResult.focus();
                  }
                }
              }}
              placeholder="Search 5,000+ shapes & icons"
              aria-label="Quick insert shapes and icons"
              aria-controls="oc-rail-search-results"
              title="Quick insert (Ctrl+Space)"
              autoComplete="off"
            />
          </label>
          <div className="oc-rail-kind-legend" aria-label="Catalog result types">
            <span><i className="is-diagram" />Diagram shapes</span>
            <span><i className="is-icon" />Icons</span>
          </div>
        </div>
        {railShapeQuery.trim().length > 0 || railLibraryId !== 'featured' ? (
          <div className="oc-rail-search-results" id="oc-rail-search-results" role="region" aria-label="Quick insert results" aria-live="polite">
            {railShapeResults.map((result) => {
              const kind = catalogResultKind(result);
              return (
                <button
                  type="button"
                  key={`${result.libraryId}-${result.entry.id}`}
                  data-catalog-kind={kind.toLowerCase()}
                  draggable
                  onDragStart={(event) => {
                    const item = shapePaletteItem(result);
                    setDraggedShape(item);
                    event.dataTransfer.effectAllowed = 'copy';
                    event.dataTransfer.setData('application/x-openchart-shape', `${result.libraryId}:${result.entry.id}`);
                  }}
                  onDragEnd={() => setDraggedShape(null)}
                  onClick={() => {
                    addNode(shapePaletteItem(result));
                    setRailShapeQuery('');
                  }}
                  title={`Insert ${result.entry.name}`}
                >
                  <span className="oc-rail-result-preview"><CatalogShapePreview result={result} resolveShape={resolveCatalogShape} /></span>
                  <span className="oc-rail-result-copy">
                    <strong>{result.entry.name}</strong>
                    <small>{SHAPE_LIBRARIES.find((library) => library.id === result.libraryId)?.label ?? result.libraryId}</small>
                  </span>
                  <em className={`oc-catalog-kind is-${kind.toLowerCase()}`}>{kind}</em>
                </button>
              );
            })}
            {railShapeResults.length === 0 ? <p>No matching shapes or icons</p> : null}
            <button
              type="button"
              className="oc-rail-browse-all"
              onClick={() => {
                setShapeQuery(railShapeQuery);
                setShapeLibraryId(railLibraryId === 'featured' ? 'all' : railLibraryId);
                setShapeManagerOpen(true);
              }}
            >Browse full catalog <span>↗</span></button>
          </div>
        ) : (
        <div className="oc-shape-scroll">
          {favoriteShapeResults.length > 0 ? (
            <section className="oc-shape-library is-pinned" aria-label="Favorite shapes">
              <div className="oc-library-heading"><strong>Favorites</strong><span>{favoriteShapeResults.length}</span></div>
              <div className="oc-shape-list">
                {favoriteShapeResults.map((result) => (
                  <button
                    type="button"
                    key={`favorite-${result.libraryId}-${result.entry.id}`}
                    onClick={() => addNode(shapePaletteItem(result))}
                    title={`Add ${result.entry.name}`}
                    aria-label={`Add favorite ${result.entry.name}`}
                  >
                    <span className="oc-mini-shape-preview"><CatalogShapePreview result={result} resolveShape={resolveCatalogShape} /></span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          {recentShapeResults.length > 0 ? (
            <section className="oc-shape-library" aria-label="Recently used shapes">
              <div className="oc-library-heading"><strong>Recent</strong><span>{recentShapeResults.length}</span></div>
              <div className="oc-shape-list">
                {recentShapeResults.map((result) => (
                  <button
                    type="button"
                    key={`recent-${result.libraryId}-${result.entry.id}`}
                    onClick={() => addNode(shapePaletteItem(result))}
                    title={`Add ${result.entry.name}`}
                    aria-label={`Add recent ${result.entry.name}`}
                  >
                    <span className="oc-mini-shape-preview"><CatalogShapePreview result={result} resolveShape={resolveCatalogShape} /></span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          {SHAPE_PALETTE.map((section) => (
            <section className="oc-shape-library" key={section.label} aria-label={`${section.label} shapes`}>
              <div className="oc-library-heading"><strong>{section.label}</strong><span>{section.items.length}</span></div>
              <div className="oc-shape-list">
                {section.items.map((item) => (
                  <button
                    type="button"
                    key={`${section.label}-${item.label}`}
                    draggable
                    onDragStart={(event) => {
                      setDraggedShape(item);
                      event.dataTransfer.effectAllowed = 'copy';
                      event.dataTransfer.setData('application/x-openchart-shape', item.shape?.entryId ?? item.label);
                    }}
                    onDragEnd={() => setDraggedShape(null)}
                    onClick={() => addNode(item)}
                    title={`Add ${item.label}`}
                    aria-label={`Add ${item.label}`}
                    data-shape-entry={item.shape?.entryId}
                  >
                    <Icon src={item.icon} size={23} />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
        )}
        <div className="oc-rail-library">
          <button type="button" onClick={() => setShapeManagerOpen(true)}><Icon src={plusIcon} size={16} />More shapes</button>
          <span>{SHAPE_LIBRARIES.length} libraries · <span className="oc-count">{SHAPE_LIBRARY_TOTAL.toLocaleString('en-US')}</span> shapes</span>
        </div>
      </aside>

      <section className="oc-workspace">
        <CanvasStage
          document={document}
          scene={scene}
          frames={frames}
          displayFrames={displayFrames}
          items={items}
          selection={selection}
          camera={camera}
          tool={tool}
          editing={editing}
          shapeDragActive={draggedShape !== null}
          onShapeDrop={(point) => {
            if (draggedShape !== null) {
              addNode(draggedShape, point);
              setDraggedShape(null);
            }
          }}
          onCameraChange={setCamera}
          onViewportChange={setViewport}
          onSelectionChange={setSelection}
          onPreviewChange={setPreview}
          onTransformCommit={commitTransform}
          onCreateConnector={createConnector}
          onCreateConnectedNode={createConnectedNode}
          onRelinkEdge={(edgeId, endpoint, nodeId, side) => {
            const edge = liveSession.document.edges[edgeId];
            if (edge !== undefined) {
              relinkEdge(edge, endpoint, nodeId, side);
            }
          }}
          onDetachEdgeEndpoint={detachEdgeEndpoint}
          onAddEdgeWaypoint={addEdgeWaypoint}
          onEdgeWaypointCommit={commitEdgeWaypoint}
          onEdgeSegmentCommit={commitEdgeSegment}
          onBeginTextEdit={beginTextEdit}
          onBeginEdgeLabelEdit={beginEdgeLabelEdit}
          onEdgeLabelPositionCommit={commitEdgeLabelPosition}
          onEditTextChange={(value) => setEditing((current) => current === null ? null : { ...current, value })}
          onCommitTextEdit={commitTextEdit}
          onCancelTextEdit={cancelTextEdit}
        />
        {findOpen ? (
          <div className="oc-findbar" role="search" aria-label="Find diagram objects">
            <span aria-hidden="true"><Icon src={magnifyingGlassIcon} size={15} /></span>
            <input
              value={findQuery}
              onChange={(event) => {
                setFindQuery(event.target.value);
                setFindCursor(-1);
              }}
              placeholder="Find objects…"
              aria-label="Find objects"
              autoFocus
            />
            <span className="oc-find-count">
              {findQuery.trim().length === 0
                ? '—'
                : findMatches.length === 0
                  ? '0'
                  : `${findCursor + 1}/${findMatches.length}`}
            </span>
            <button type="button" onClick={() => moveFindCursor(-1)} aria-label="Previous match"><Icon src={arrowUpIcon} size={14} /></button>
            <button type="button" onClick={() => moveFindCursor(1)} aria-label="Next match"><Icon src={arrowDownIcon} size={14} /></button>
            <button type="button" onClick={() => setFindOpen(false)} aria-label="Close find"><Icon src={xIcon} size={14} /></button>
          </div>
        ) : null}
      </section>

      <aside className={`oc-inspector${inspectorOpen ? ' is-open' : ''}`} aria-label="Selection inspector">
        <div className="oc-inspector-tabs">
          <button type="button" className={inspectorTab === 'design' ? 'is-active' : ''} onClick={() => setInspectorTab('design')}>Design</button>
          <button type="button" className={inspectorTab === 'layers' ? 'is-active' : ''} onClick={() => setInspectorTab('layers')}>Layers</button>
        </div>
        {inspectorTab === 'layers' ? (
          <div className="oc-inspector-body">
            <div className="oc-panel-heading"><span>{activePage?.name ?? 'Page layers'}</span><button type="button" onClick={createLayer} aria-label="Add layer"><Icon src={plusIcon} size={15} /></button></div>
            <div className="oc-layer-list">
              {(activePage?.layerIds ?? []).map((layerId, index) => {
                const layer = document.layers[layerId];
                if (layer === undefined) {
                  return null;
                }
                return (
                  <div className="oc-layer-row" key={layer.id}>
                    <button
                      type="button"
                      aria-label={`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`}
                      onClick={() => commit({
                        txId: nextTransactionId('layer-visible'), actor: 'user', origin: 'gui', baseRev: document.rev,
                        ops: [{ op: 'set_layer_visibility', id: layer.id, visible: !layer.visible }],
                      }, `${layer.name} ${layer.visible ? 'hidden' : 'shown'}`)}
                    ><Icon src={layer.visible ? eyeIcon : eyeSlashIcon} size={15} /></button>
                    <input
                      key={`${layer.id}-${document.rev}`}
                      defaultValue={layer.name}
                      aria-label={`Rename ${layer.name}`}
                      onBlur={(event) => {
                        const name = event.currentTarget.value.trim();
                        if (name.length > 0 && name !== layer.name) {
                          commit({
                            txId: nextTransactionId('layer-name'), actor: 'user', origin: 'gui', baseRev: document.rev,
                            ops: [{ op: 'rename_layer', id: layer.id, name }],
                          }, 'Layer renamed');
                        }
                      }}
                    />
                    <div className="oc-layer-actions">
                      <button type="button" disabled={index <= 1} onClick={() => reorderLayer(layer.id, -1)} aria-label={`Move ${layer.name} up`}><Icon src={arrowUpIcon} size={13} /></button>
                      <button type="button" disabled={index === 0 || index >= (activePage?.layerIds.length ?? 0) - 1} onClick={() => reorderLayer(layer.id, 1)} aria-label={`Move ${layer.name} down`}><Icon src={arrowDownIcon} size={13} /></button>
                      <button
                        type="button"
                        disabled={index === 0}
                        aria-label={`${layer.locked ? 'Unlock' : 'Lock'} ${layer.name}`}
                        onClick={() => commit({
                          txId: nextTransactionId('layer-lock'), actor: 'user', origin: 'gui', baseRev: document.rev,
                          ops: [{ op: 'set_layer_locked', id: layer.id, locked: !layer.locked }],
                        }, `${layer.name} ${layer.locked ? 'unlocked' : 'locked'}`)}
                      ><Icon src={layer.locked ? lockIcon : lockOpenIcon} size={14} /></button>
                      <button
                        type="button"
                        disabled={index === 0}
                        aria-label={`Delete ${layer.name}`}
                        onClick={() => commit({
                          txId: nextTransactionId('delete-layer'), actor: 'user', origin: 'gui', baseRev: document.rev,
                          ops: [{ op: 'delete_layer', id: layer.id }],
                        }, `${layer.name} deleted`)}
                      ><Icon src={xIcon} size={13} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
            <button className="oc-wide-button" type="button" onClick={() => {
              if (activePage !== undefined) {
                commit({ txId: nextTransactionId('save-layer-view'), actor: 'user', origin: 'gui', baseRev: document.rev, ops: [{ op: 'save_layer_view', pageId: activePage.id }] }, 'Layer view saved');
              }
            }}>Save layer view</button>
          </div>
        ) : selectedEdges.length > 1 && selectedNodes.length === 0 && selectedEdgeInspector !== undefined ? (
          <div className="oc-inspector-body">
            <div className="oc-selection-summary"><span>CONNECTORS</span><strong>{selectedEdges.length} selected</strong><small>Formatting applies to every selected connector.</small></div>
            {renderConnectorAppearanceControls(selectedEdgeInspector)}
            {renderTextFormattingControls(selectedEdgeInspector.data, edgeDataMixed)}
          </div>
        ) : selectedNodes.length > 1 && selectedEdges.length === 0 && selectedNodeInspector !== undefined ? (
          <div className="oc-inspector-body">
            <div className="oc-selection-summary"><span>SHAPES</span><strong>{selectedNodes.length} selected</strong><small>Formatting applies to every selected shape.</small></div>
            {renderShapeAppearanceControls(selectedNodeInspector)}
            {renderTextFormattingControls(selectedNodeInspector.data, nodeDataMixed)}
          </div>
        ) : selectedNodes.length > 0 && selectedEdges.length > 0 && selectedTextData !== undefined ? (
          <div className="oc-inspector-body">
            <div className="oc-selection-summary"><span>MIXED SELECTION</span><strong>{selection.selectedIds.length} objects</strong><small>Shared text formatting applies across shapes and connector labels.</small></div>
            {renderTextFormattingControls(selectedTextData, selectionDataMixed)}
          </div>
        ) : selectedEdge !== undefined ? (
          <div className="oc-inspector-body">
            <div className="oc-selection-summary">
              <span>CONNECTOR</span>
              <strong>{selectedEdge.label || selectedEdge.semantic || 'Untitled flow'}</strong>
              <small>{selectedEdge.id}</small>
            </div>
            <label className="oc-field oc-field-wide">
              <span>Label</span>
              <input
                key={`${selectedEdge.id}-label-${document.rev}`}
                defaultValue={selectedEdge.label}
                onBlur={(event) => {
                  const label = event.currentTarget.value.trim();
                  if (label !== selectedEdge.label) {
                    commit({
                      txId: nextTransactionId('edge-label'), actor: 'user', origin: 'gui', baseRev: document.rev,
                      ops: [{ op: 'set_edge_label', id: selectedEdge.id, label }],
                    }, 'Connector label updated');
                  }
                }}
              />
            </label>
            <label className="oc-field oc-field-wide">
              <span>Meaning</span>
              <input
                key={`${selectedEdge.id}-semantic-${document.rev}`}
                defaultValue={selectedEdge.semantic}
                onBlur={(event) => {
                  const semantic = event.currentTarget.value.trim();
                  if (semantic !== selectedEdge.semantic) {
                    commit({
                      txId: nextTransactionId('edge-semantic'), actor: 'user', origin: 'gui', baseRev: document.rev,
                      ops: [{ op: 'set_edge_semantic', id: selectedEdge.id, semantic }],
                    }, 'Connector meaning updated');
                  }
                }}
              />
            </label>
            {renderTextFormattingControls(selectedEdge.data, edgeDataMixed)}
            <div className="oc-style-panel-section">
              <div className="oc-section-title">Appearance</div>
              <ColorControl label="Line" value={selectedEdgeStrokeColor} mixed={edgeDataMixed('strokeColor')}
                onChange={(value) => updateConnectorVisualStyle({ strokeColor: value }, 'Connector color updated')} />
            </div>
            <div className="oc-section-title">Route</div>
            <label className="oc-field oc-field-wide">
              <span>From</span>
              <select
                aria-label="Connector source shape"
                value={selectedEdgeFromNode?.id ?? ''}
                onChange={(event) => relinkEdge(selectedEdge, 'from', event.currentTarget.value)}
              >
                {Object.values(document.nodes)
                  .filter((node) =>
                    node.pageId === selectedEdge.pageId &&
                    node.container === undefined &&
                    node.group === undefined &&
                    !isConnectorAnchorNode(node),
                  )
                  .sort((left, right) => compareIds(left.id, right.id))
                  .map((node) => <option value={node.id} key={node.id}>{node.label}</option>)}
              </select>
            </label>
            <label className="oc-field oc-field-wide">
              <span>To</span>
              <select
                aria-label="Connector target shape"
                value={selectedEdgeToNode?.id ?? ''}
                onChange={(event) => relinkEdge(selectedEdge, 'to', event.currentTarget.value)}
              >
                {Object.values(document.nodes)
                  .filter((node) =>
                    node.pageId === selectedEdge.pageId &&
                    node.container === undefined &&
                    node.group === undefined &&
                    !isConnectorAnchorNode(node),
                  )
                  .sort((left, right) => compareIds(left.id, right.id))
                  .map((node) => <option value={node.id} key={node.id}>{node.label}</option>)}
              </select>
            </label>
            <label className="oc-field oc-field-wide">
              <span>Mode</span>
              <select
                aria-label="Connector routing mode"
                value={selectedEdge.routing?.mode ?? 'orthogonal'}
                onChange={(event) => commit({
                  txId: nextTransactionId('edge-mode'), actor: 'user', origin: 'gui', baseRev: document.rev,
                  ops: [{
                    op: 'set_edge_routing',
                    id: selectedEdge.id,
                    routing: {
                      ...selectedEdge.routing,
                      mode: event.currentTarget.value as 'orthogonal' | 'straight' | 'curved',
                    },
                  }],
                }, 'Connector routing mode updated')}
              >
                <option value="orthogonal">Orthogonal</option>
                <option value="curved">Curved</option>
                <option value="straight">Straight</option>
              </select>
            </label>
            <label className="oc-field oc-field-wide">
              <span>Corner radius</span>
              <input
                aria-label="Connector corner radius"
                type="number"
                min={0}
                max={64}
                step={1}
                value={selectedEdge.routing?.cornerRadius ?? 9}
                onChange={(event) => {
                  const cornerRadius = clamp(Number(event.currentTarget.value), 0, 64);
                  if (!Number.isFinite(cornerRadius)) return;
                  commit({
                    txId: nextTransactionId('edge-corner-radius'), actor: 'user', origin: 'gui', baseRev: document.rev,
                    ops: [{
                      op: 'set_edge_routing',
                      id: selectedEdge.id,
                      routing: {
                        ...selectedEdge.routing,
                        mode: selectedEdge.routing?.mode ?? 'orthogonal',
                        cornerRadius,
                      },
                    }],
                  }, 'Connector corner radius updated');
                }}
              />
            </label>
            <label className="oc-field oc-field-wide">
              <span>Width</span>
              <input
                aria-label="Connector line width"
                type="number"
                min={0.5}
                max={10}
                step={0.5}
                value={selectedEdge.routing?.lineWidth ?? 2.5}
                onChange={(event) => {
                  const lineWidth = clamp(Number(event.currentTarget.value), 0.5, 10);
                  if (!Number.isFinite(lineWidth)) return;
                  commit({
                    txId: nextTransactionId('edge-line-width'), actor: 'user', origin: 'gui', baseRev: document.rev,
                    ops: [{
                      op: 'set_edge_routing',
                      id: selectedEdge.id,
                      routing: {
                        ...selectedEdge.routing,
                        mode: selectedEdge.routing?.mode ?? 'orthogonal',
                        lineWidth,
                      },
                    }],
                  }, 'Connector line width updated');
                }}
              />
            </label>
            <label className="oc-field oc-field-wide">
              <span>Line</span>
              <select
                aria-label="Connector line style"
                value={selectedEdge.routing?.lineStyle ?? 'solid'}
                onChange={(event) => commit({
                  txId: nextTransactionId('edge-line-style'), actor: 'user', origin: 'gui', baseRev: document.rev,
                  ops: [{
                    op: 'set_edge_routing',
                    id: selectedEdge.id,
                    routing: {
                      ...selectedEdge.routing,
                      mode: selectedEdge.routing?.mode ?? 'orthogonal',
                      lineStyle: event.currentTarget.value as 'solid' | 'dashed' | 'dotted',
                    },
                  }],
                }, 'Connector line style updated')}
              >
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </select>
            </label>
            <label className="oc-field oc-field-wide">
              <span>Style</span>
              <select
                aria-label="Connector visual style"
                value={selectedEdge.styleId}
                onChange={(event) => commit({
                  txId: nextTransactionId('edge-style'), actor: 'user', origin: 'gui', baseRev: document.rev,
                  ops: [{ op: 'set_edge_style', id: selectedEdge.id, styleId: event.currentTarget.value }],
                }, 'Connector style updated')}
              >
                {Object.values(document.styles)
                  .filter((style) => style.role.toLowerCase().includes('flow') || style.id === selectedEdge.styleId)
                  .sort((left, right) => compareIds(left.id, right.id))
                  .map((style) => <option value={style.id} key={style.id}>{style.role}</option>)}
              </select>
            </label>
            <label className="oc-field oc-field-wide">
              <span>Start</span>
              <select
                aria-label="Connector start marker"
                value={selectedEdge.routing?.startMarker ?? 'none'}
                onChange={(event) => commit({
                  txId: nextTransactionId('edge-start-marker'), actor: 'user', origin: 'gui', baseRev: document.rev,
                  ops: [{
                    op: 'set_edge_routing',
                    id: selectedEdge.id,
                    routing: {
                      ...selectedEdge.routing,
                      mode: selectedEdge.routing?.mode ?? 'orthogonal',
                      startMarker: event.currentTarget.value as 'none' | 'arrow' | 'open-arrow' | 'diamond' | 'circle' | 'bar' | 'crow-foot',
                    },
                  }],
                }, 'Connector start marker updated')}
              >
                <option value="none">None</option>
                <option value="arrow">Arrow</option>
                <option value="open-arrow">Open arrow</option>
                <option value="diamond">Diamond</option>
                <option value="circle">Circle</option>
                <option value="bar">Bar</option>
                <option value="crow-foot">Crow's foot</option>
              </select>
            </label>
            <label className="oc-field oc-field-wide">
              <span>End</span>
              <select
                aria-label="Connector end marker"
                value={selectedEdge.routing?.endMarker ?? 'arrow'}
                onChange={(event) => commit({
                  txId: nextTransactionId('edge-end-marker'), actor: 'user', origin: 'gui', baseRev: document.rev,
                  ops: [{
                    op: 'set_edge_routing',
                    id: selectedEdge.id,
                    routing: {
                      ...selectedEdge.routing,
                      mode: selectedEdge.routing?.mode ?? 'orthogonal',
                      endMarker: event.currentTarget.value as 'none' | 'arrow' | 'open-arrow' | 'diamond' | 'circle' | 'bar' | 'crow-foot',
                    },
                  }],
                }, 'Connector end marker updated')}
              >
                <option value="none">None</option>
                <option value="arrow">Arrow</option>
                <option value="open-arrow">Open arrow</option>
                <option value="diamond">Diamond</option>
                <option value="circle">Circle</option>
                <option value="bar">Bar</option>
                <option value="crow-foot">Crow's foot</option>
              </select>
            </label>
            <label className="oc-field oc-field-wide">
              <span>Jumps</span>
              <select
                aria-label="Connector line jump style"
                value={selectedEdge.routing?.jumpStyle ?? 'arc'}
                onChange={(event) => commit({
                  txId: nextTransactionId('edge-jump'), actor: 'user', origin: 'gui', baseRev: document.rev,
                  ops: [{
                    op: 'set_edge_routing',
                    id: selectedEdge.id,
                    routing: {
                      ...selectedEdge.routing,
                      mode: selectedEdge.routing?.mode ?? 'orthogonal',
                      jumpStyle: event.currentTarget.value as 'arc' | 'gap' | 'square' | 'none',
                    },
                  }],
                }, 'Line jump style updated')}
              >
                <option value="arc">Arc</option>
                <option value="gap">Gap</option>
                <option value="square">Square</option>
                <option value="none">None</option>
              </select>
            </label>
            <label className="oc-field oc-field-wide">
              <span>Label position</span>
              <select
                aria-label="Connector label position"
                value={document.layout.edgeOverrides?.[selectedEdge.id]?.labelPlacement ?? 'above'}
                onChange={(event) => commit({
                  txId: nextTransactionId('edge-label-placement'), actor: 'user', origin: 'gui', baseRev: document.rev,
                  ops: [{
                    op: 'set_edge_layout',
                    id: selectedEdge.id,
                    layout: {
                      ...(document.layout.edgeOverrides?.[selectedEdge.id] ?? {}),
                      labelPlacement: event.currentTarget.value as 'above' | 'below' | 'on',
                    },
                  }],
                }, 'Connector label position updated')}
              >
                <option value="above">Above line</option>
                <option value="on">On line</option>
                <option value="below">Below line</option>
              </select>
            </label>
            <button
              type="button"
              className={`oc-wide-button oc-toggle ${selectedEdge.routing?.avoidObstacles === true ? 'is-active' : ''}`}
              aria-pressed={selectedEdge.routing?.avoidObstacles === true}
              onClick={() => executeCommand('toggle-obstacle-avoidance')}
            >
              <span>Obstacle avoidance</span>
              <strong>{selectedEdge.routing?.avoidObstacles === true ? 'ON' : 'OFF'}</strong>
            </button>
            <p className="oc-connector-help">
              Double-click the line to add a waypoint, then drag its amber handle.
            </p>
            <div className="oc-inspector-actions">
              <button type="button" onClick={() => executeCommand('reroute-selection')}>
                Re-route <kbd>Ctrl Alt R</kbd>
              </button>
              <button
                type="button"
                className="is-danger"
                onClick={() => commit({
                  txId: nextTransactionId('delete-edge'), actor: 'user', origin: 'gui', baseRev: document.rev,
                  ops: [{ op: 'delete_edge', id: selectedEdge.id }],
                }, 'Connector deleted', clearSelection(selection))}
              >
                Delete connector
              </button>
            </div>
          </div>
        ) : selectedNode === undefined || selectedFrame === undefined ? (
          <div className="oc-empty-inspector">
            <span className="oc-empty-glyph"><Icon src={shapesIcon} size={30} /></span>
            <strong>No object selected</strong>
            <p>Click a shape to edit its geometry, style, and content.</p>
            <kbd>F1</kbd><span>opens every Windows shortcut</span>
          </div>
        ) : (
          <div className="oc-inspector-body">
            <div className="oc-selection-summary">
              <span>{selectedNode.kind.toUpperCase()}</span>
              <strong>{selectedNode.label}</strong>
              <small>{selectedNode.id}</small>
            </div>
            <label className="oc-field oc-field-wide">
              <span>Label</span>
              <input
                key={`${selectedNode.id}-label-${document.rev}`}
                defaultValue={selectedNode.label}
                onBlur={(event) => {
                  const label = event.currentTarget.value.trim();
                  if (label.length > 0 && label !== selectedNode.label) {
                    commit({ txId: nextTransactionId('label'), actor: 'user', origin: 'gui', baseRev: document.rev, ops: [{ op: 'set_node_label', id: selectedNode.id, label }] }, 'Label updated');
                  }
                }}
              />
            </label>
            <label className="oc-field oc-field-wide oc-alt-text-field">
              <span>Alt text</span>
              <textarea
                key={`${selectedNode.id}-alt-text-${document.rev}`}
                defaultValue={typeof selectedNode.data.altText === 'string' ? selectedNode.data.altText : ''}
                placeholder="Describe this object for screen readers and exports"
                rows={3}
                onBlur={(event) => {
                  const altText = event.currentTarget.value.trim();
                  if (altText !== (typeof selectedNode.data.altText === 'string' ? selectedNode.data.altText : '')) {
                    commit({
                      txId: nextTransactionId('alt-text'),
                      actor: 'user',
                      origin: 'gui',
                      baseRev: document.rev,
                      ops: [{
                        op: 'set_node_data',
                        id: selectedNode.id,
                        data: { ...selectedNode.data, altText },
                      }],
                    }, 'Alternate text updated');
                  }
                }}
              />
            </label>
            <div className="oc-section-title">Position &amp; size</div>
            <div className="oc-field-grid">
              {(['x', 'y', 'width', 'height'] as const).map((field) => (
                <label className="oc-field" key={field}>
                  <span>{field === 'width' ? 'W' : field === 'height' ? 'H' : field.toUpperCase()}</span>
                  <input
                    key={`${selectedNode.id}-${field}-${document.rev}`}
                    type="number"
                    defaultValue={Math.round(selectedFrame[field])}
                    onBlur={(event) => updateSelectedLayout(field, Number(event.currentTarget.value))}
                  />
                </label>
              ))}
              {selectedNode.container === undefined && selectedNode.group === undefined ? (
                <label className="oc-field oc-field-wide">
                  <span>Rotation</span>
                  <input
                    key={`${selectedNode.id}-rotation-${document.rev}`}
                    type="number"
                    defaultValue={Math.round(selectedFrame.rotation ?? 0)}
                    onBlur={(event) => updateSelectedLayout('rotation', Number(event.currentTarget.value))}
                  />
                </label>
              ) : null}
            </div>
            {renderTextFormattingControls(selectedNode.data, nodeDataMixed)}
            {renderShapeAppearanceControls(selectedNode)}
            <div className="oc-section-title">Style preset</div>
            <div className="oc-style-list">
              {Object.values(document.styles).sort((left, right) => compareIds(left.id, right.id)).map((style) => {
                const accent = typeof style.tokens.accent === 'string' ? style.tokens.accent : '#64748B';
                return (
                  <button
                    type="button"
                    key={style.id}
                    className={selectedNode.styleId === style.id ? 'is-active' : ''}
                    onClick={() => commit({ txId: nextTransactionId('style'), actor: 'user', origin: 'gui', baseRev: document.rev, ops: [{ op: 'set_node_style', id: selectedNode.id, styleId: style.id }] }, 'Style applied')}
                  >
                    <span style={{ background: accent }} />
                    {style.role.replaceAll('/', ' · ')}
                  </button>
                );
              })}
            </div>
            <div className="oc-inspector-actions">
              <button type="button" onClick={() => beginTextEdit(selectedNode.id)}>Edit text <kbd>F2</kbd></button>
              <button type="button" onClick={() => executeCommand('duplicate')}>Duplicate <kbd>Ctrl D</kbd></button>
            </div>
          </div>
        )}
      </aside>

      <footer className="oc-bottombar" aria-label="Document pages">
        <div className="oc-page-tabs">
          {pages.map((page) => (
            <button
              type="button"
              key={page.id}
              className={page.id === activePageId ? 'is-active' : ''}
              onClick={() => {
                setActivePageId(page.id);
                setSelection(createSelectionState());
              }}
            >
              <span className="oc-page-color" style={{ background: page.color ?? '#2563EB' }} />
              {page.name}
            </button>
          ))}
          <button type="button" className="oc-add-page" onClick={createPage} title="Add page"><Icon src={plusIcon} size={15} /></button>
          <button type="button" className="oc-page-settings" onClick={() => setPageMenuOpen((open) => !open)} title="Page settings"><Icon src={dotsThreeIcon} size={17} /></button>
        </div>
        <div className="oc-status">
          {selection.selectedIds.length > 0 ? <span>{selection.selectedIds.length} selected</span> : null}
          {selection.scopeId !== null ? <span className="oc-scope">Inside {selection.scopeId}</span> : null}
        </div>
        <div className="oc-zoom-controls">
          <button type="button" onClick={() => executeCommand('zoom-out')} aria-label="Zoom out"><Icon src={minusIcon} size={14} /></button>
          <button type="button" onClick={() => executeCommand('zoom-reset')}>{Math.round(camera.zoom * 100)}%</button>
          <button type="button" onClick={() => executeCommand('zoom-in')} aria-label="Zoom in"><Icon src={plusIcon} size={14} /></button>
        </div>
      </footer>

      <div className="oc-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {status}
      </div>
      <input
        ref={openDocumentInputRef}
        className="oc-visually-hidden"
        type="file"
        accept=".json,application/json"
        aria-label="Open OpenChart document file"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file !== undefined) void openBrowserDocument(file);
        }}
      />
      <input
        ref={importDocumentInputRef}
        className="oc-visually-hidden"
        type="file"
        accept=".json,application/json"
        aria-label="Import OpenChart document page"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file !== undefined) void importOpenChartDocument(file);
        }}
      />

      {outputOpen ? (
        <div className="oc-command-backdrop" role="presentation" onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            setOutputOpen(false);
          }
        }}>
          <section className="oc-output-dialog" role="dialog" aria-modal="true" aria-labelledby="oc-output-title">
            <div className="oc-command-header">
              <div>
                <span>LOCAL DOCUMENT</span>
                <h2 id="oc-output-title">Open, save, import, and export</h2>
              </div>
              <button type="button" onClick={() => setOutputOpen(false)} aria-label="Close export and print">Esc</button>
            </div>
            <div className="oc-modal-body">
              <div className="oc-setting-row oc-file-row">
                <span>
                  <strong>Editable OpenChart document</strong>
                  <small title={documentPath}>
                    {desktopRuntime
                      ? documentPath ?? 'Not saved to disk yet'
                      : browserSaveName ?? 'Open and Save use local JSON files'}
                  </small>
                </span>
                <div className="oc-file-buttons">
                  <button type="button" disabled={fileBusy || derivationBusy} onClick={() => void openDocument()}>Open…</button>
                  <button type="button" disabled={fileBusy} onClick={() => void saveDocument(false)}>
                    {desktopRuntime && documentPath !== undefined ? 'Save' : 'Save…'}
                  </button>
                  {desktopRuntime && documentPath !== undefined ? (
                    <button type="button" disabled={fileBusy} onClick={() => void saveDocument(true)}>Save as…</button>
                  ) : null}
                  <button
                    type="button"
                    disabled={fileBusy || derivationBusy}
                    onClick={() => importDocumentInputRef.current?.click()}
                    title="Replace the active page with the first page of another OpenChart document; Undo restores the prior page"
                  >
                    Import page…
                  </button>
                </div>
              </div>
              <label className="oc-setting-row">
                <span><strong>Download format</strong><small>Uses the same scene shown on the canvas.</small></span>
                <select
                  autoFocus
                  value={preferences.exportFormat}
                  onChange={(event) => persistPreferences({
                    ...preferences,
                    exportFormat: event.currentTarget.value as BrowserExportFormat,
                  })}
                >
                  <option value="svg">SVG · vector</option>
                  <option value="png">PNG · lossless</option>
                  <option value="jpeg">JPEG · compact</option>
                  <option value="d2">D2 · editable text projection</option>
                  <option value="mermaid">Mermaid · flowchart text projection</option>
                </select>
              </label>
              <label className="oc-setting-row">
                <span><strong>Raster scale</strong><small>Applies to PNG and JPEG.</small></span>
                <select
                  value={preferences.exportScale}
                  disabled={preferences.exportFormat !== 'png' && preferences.exportFormat !== 'jpeg'}
                  onChange={(event) => persistPreferences({
                    ...preferences,
                    exportScale: Number(event.currentTarget.value) as BrowserExportScale,
                  })}
                >
                  <option value={1}>1×</option>
                  <option value={2}>2×</option>
                  <option value={4}>4×</option>
                </select>
              </label>
              <p className="oc-modal-note">
                D2 and Mermaid export the active page and report known projection losses. Tagged PDF and vector PowerPoint remain available through the local Windows CLI.
              </p>
            </div>
            <div className="oc-modal-actions">
              <button type="button" onClick={() => { setOutputOpen(false); setTemplateOpen(true); }}>Templates</button>
              <button type="button" onClick={() => { setOutputOpen(false); setPreferencesOpen(true); }}>Preferences</button>
              <button type="button" onClick={printDiagram}>Print</button>
              <button type="button" className="is-primary" disabled={exportBusy} onClick={() => void exportDiagram()}>
                {exportBusy ? 'Exporting…' : `Download ${preferences.exportFormat.toUpperCase()}`}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {preferencesOpen ? (
        <div className="oc-command-backdrop" role="presentation" onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            setPreferencesOpen(false);
          }
        }}>
          <section className="oc-preferences-dialog" role="dialog" aria-modal="true" aria-labelledby="oc-preferences-title">
            <div className="oc-command-header">
              <div><span>LOCAL PREFERENCES</span><h2 id="oc-preferences-title">Editor preferences</h2></div>
              <button type="button" onClick={() => setPreferencesOpen(false)} aria-label="Close preferences">Esc</button>
            </div>
            <div className="oc-modal-body">
              <label className="oc-setting-row">
                <span><strong>Default export</strong><small>Remembered on this Windows profile.</small></span>
                <select
                  autoFocus
                  value={preferences.exportFormat}
                  onChange={(event) => persistPreferences({
                    ...preferences,
                    exportFormat: event.currentTarget.value as BrowserExportFormat,
                  })}
                >
                  <option value="svg">SVG</option>
                  <option value="png">PNG</option>
                  <option value="jpeg">JPEG</option>
                  <option value="d2">D2</option>
                  <option value="mermaid">Mermaid</option>
                </select>
              </label>
              <label className="oc-setting-row">
                <span><strong>Default raster scale</strong><small>Higher scales use more memory.</small></span>
                <select
                  value={preferences.exportScale}
                  disabled={preferences.exportFormat !== 'png' && preferences.exportFormat !== 'jpeg'}
                  onChange={(event) => persistPreferences({
                    ...preferences,
                    exportScale: Number(event.currentTarget.value) as BrowserExportScale,
                  })}
                >
                  <option value={1}>1×</option>
                  <option value={2}>2×</option>
                  <option value={4}>4×</option>
                </select>
              </label>
              <label className="oc-setting-row oc-checkbox-row">
                <span><strong>Canvas navigation</strong><small>Use Tab and Control plus arrow keys to inspect objects.</small></span>
                <input
                  type="checkbox"
                  checked={preferences.canvasNavigation}
                  onChange={(event) => persistPreferences({
                    ...preferences,
                    canvasNavigation: event.currentTarget.checked,
                  })}
                />
              </label>
            </div>
            <div className="oc-modal-actions">
              <button type="button" onClick={() => applyThemePreset('high-contrast')}>Apply high contrast</button>
              <button type="button" className="is-primary" onClick={() => setPreferencesOpen(false)}>Done</button>
            </div>
          </section>
        </div>
      ) : null}

      {templateOpen ? (
        <div className="oc-command-backdrop" role="presentation" onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            setTemplateOpen(false);
          }
        }}>
          <section className="oc-template-dialog" role="dialog" aria-modal="true" aria-labelledby="oc-template-title">
            <div className="oc-command-header">
              <div><span>STARTING POINT</span><h2 id="oc-template-title">Choose a starting point</h2></div>
              <button type="button" onClick={() => setTemplateOpen(false)} aria-label="Close template chooser">Esc</button>
            </div>
            <p>Start blank or replace the active page with editable professional starter content. One undo restores the previous page.</p>
            <div className="oc-template-section-title">Blank</div>
            <div className="oc-template-grid">
              <button type="button" autoFocus onClick={() => void chooseTemplate('blank')}>
                <span aria-hidden="true">□</span>
                <strong>Blank canvas</strong>
                <small>Clear the active page in one undoable action.</small>
              </button>
            </div>
            <div className="oc-template-section-title">Professional starters</div>
            <div className="oc-template-grid">
              {starterTemplateModule === undefined ? (
                <p>Loading starter templates…</p>
              ) : starterTemplateModule.STARTER_TEMPLATES.map((template) => (
                <button
                  type="button"
                  key={template.id}
                  data-template-id={template.id}
                  onClick={() => void chooseTemplate(template.id)}
                >
                  <span className="oc-template-kind">{template.section}</span>
                  <strong>{template.name}</strong>
                  <small>{template.description}</small>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {pageMenuOpen && activePage !== undefined ? (
        <section className="oc-page-menu" role="dialog" aria-label="Page settings">
          <div className="oc-page-menu-heading">
            <span>PAGE SETTINGS</span>
            <button type="button" onClick={() => setPageMenuOpen(false)} aria-label="Close page settings"><Icon src={xIcon} size={14} /></button>
          </div>
          <label>
            <span>Name</span>
            <input
              key={`${activePage.id}-${document.rev}`}
              defaultValue={activePage.name}
              onBlur={(event) => {
                const name = event.currentTarget.value.trim();
                if (name.length > 0 && name !== activePage.name) {
                  commit({
                    txId: nextTransactionId('page-name'), actor: 'user', origin: 'gui', baseRev: document.rev,
                    ops: [{ op: 'rename_page', id: activePage.id, name }],
                  }, 'Page renamed');
                }
              }}
            />
          </label>
          <div className="oc-page-color-picker">
            <span>Tab color</span>
            <div>
              {['#2563EB', '#00A7A5', '#FF6A3D', '#7C3AED', '#64748B', '#D97706'].map((color) => (
                <button
                  type="button"
                  key={color}
                  className={activePage.color === color ? 'is-active' : ''}
                  style={{ background: color }}
                  onClick={() => commit({
                    txId: nextTransactionId('page-color'), actor: 'user', origin: 'gui', baseRev: document.rev,
                    ops: [{ op: 'set_page_color', id: activePage.id, color }],
                  }, 'Page color updated')}
                  aria-label={`Set page color ${color}`}
                />
              ))}
            </div>
          </div>
          <div className="oc-page-menu-actions">
            <button type="button" disabled={pages[0]?.id === activePage.id} onClick={() => reorderPages(activePage.id, -1)}>← Move left</button>
            <button type="button" disabled={pages.at(-1)?.id === activePage.id} onClick={() => reorderPages(activePage.id, 1)}>Move right →</button>
            <button type="button" onClick={duplicateActivePage}>Duplicate page</button>
            <button type="button" className="is-danger" disabled={pages.length <= 1} onClick={deleteActivePage}>Delete page</button>
          </div>
        </section>
      ) : null}

      {shapeManagerOpen ? (
        <div className="oc-command-backdrop" role="presentation" onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            setShapeManagerOpen(false);
          }
        }}>
          <section className="oc-library-manager" role="dialog" aria-modal="true" aria-labelledby="oc-library-title">
            <div className="oc-command-header">
              <div><span>LOCAL CATALOG</span><h2 id="oc-library-title">Shape catalog</h2></div>
              <button type="button" onClick={() => setShapeManagerOpen(false)} aria-label="Close shape manager">Esc</button>
            </div>
            <label className="oc-command-search">
              <span><Icon src={magnifyingGlassIcon} size={16} /></span>
              <input autoFocus value={shapeQuery} onChange={(event) => setShapeQuery(event.currentTarget.value)} placeholder="Search all shapes, icons, and services" aria-label="Search shape catalog" />
            </label>
            <div className="oc-library-browser">
              <nav className="oc-library-list" aria-label="Shape catalog libraries">
                <button type="button" className={shapeLibraryId === 'all' ? 'is-active' : undefined} aria-pressed={shapeLibraryId === 'all'} onClick={() => setShapeLibraryId('all')}>
                  <span className="oc-library-swatch" style={{ background: '#2563EB' }} />
                  <span><strong>All shapes</strong><small>Complete catalog</small></span>
                  <em>{SHAPE_LIBRARY_TOTAL.toLocaleString('en-US')}</em>
                </button>
                <span className="oc-library-kind-heading">Diagram shapes</span>
                {SHAPE_LIBRARIES.filter((library) => library.kind === 'diagram').map((library) => (
                  <button type="button" key={library.id} className={shapeLibraryId === library.id ? 'is-active' : undefined} aria-pressed={shapeLibraryId === library.id} onClick={() => setShapeLibraryId(library.id)}>
                    <span className="oc-library-swatch" style={{ background: library.tone }} />
                    <span><strong>{library.label}</strong><small>{library.id}</small></span>
                    <em>{library.count.toLocaleString('en-US')}</em>
                  </button>
                ))}
                <span className="oc-library-kind-heading">Decorative icons</span>
                {SHAPE_LIBRARIES.filter((library) => library.kind === 'icon').map((library) => (
                  <button type="button" key={library.id} className={shapeLibraryId === library.id ? 'is-active' : undefined} aria-pressed={shapeLibraryId === library.id} onClick={() => setShapeLibraryId(library.id)}>
                    <span className="oc-library-swatch" style={{ background: library.tone }} />
                    <span><strong>{library.label}</strong><small>{library.id}</small></span>
                    <em>{library.count.toLocaleString('en-US')}</em>
                  </button>
                ))}
              </nav>
              <div className="oc-shape-results" aria-live="polite">
                {shapeResults.map((result) => {
                  const ref = { libraryId: result.libraryId, entryId: result.entry.id };
                  const favorite = preferences.favoriteShapes.some((candidate) => sameCatalogShape(candidate, ref));
                  return (
                    <div className="oc-shape-result-card" key={`${result.libraryId}-${result.entry.id}`}>
                      <button type="button" className="oc-shape-result-insert" onClick={() => addCatalogShape(result)} title={`Add ${result.entry.name}`} aria-label={`Add ${result.entry.name}`}>
                        <span className="oc-shape-preview"><CatalogShapePreview result={result} resolveShape={resolveCatalogShape} /></span>
                        <span><strong>{result.entry.name}</strong><small>{SHAPE_LIBRARIES.find((library) => library.id === result.libraryId)?.label ?? result.libraryId}</small></span>
                      </button>
                      <button
                        type="button"
                        className={`oc-shape-favorite${favorite ? ' is-active' : ''}`}
                        aria-pressed={favorite}
                        aria-label={`${favorite ? 'Remove' : 'Add'} ${result.entry.name} ${favorite ? 'from' : 'to'} favorites`}
                        title={favorite ? 'Remove from favorites' : 'Add to favorites'}
                        onClick={() => toggleFavoriteShape(ref)}
                      >★</button>
                    </div>
                  );
                })}
                {shapeResults.length === 0 ? <p>No matching shapes</p> : null}
              </div>
            </div>
            <div className="oc-library-total">
              <span>Showing {shapeResults.length} result{shapeResults.length === 1 ? '' : 's'}</span>
              <strong>{SHAPE_LIBRARY_TOTAL.toLocaleString('en-US')} local shapes</strong>
            </div>
          </section>
        </div>
      ) : null}

      {linkEditor !== null ? (
        <div className="oc-command-backdrop" role="presentation" onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            setLinkEditor(null);
          }
        }}>
          <form
            className="oc-link-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="oc-link-title"
            onSubmit={(event) => {
              event.preventDefault();
              const node = document.nodes[linkEditor.id];
              if (node === undefined) {
                setLinkEditor(null);
                return;
              }
              const value = linkEditor.value.trim();
              if (value.length > 0) {
                try {
                  const parsed = new URL(value);
                  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
                    setStatus('Links must use HTTP or HTTPS');
                    return;
                  }
                } catch {
                  setStatus('Enter a complete HTTP or HTTPS URL');
                  return;
                }
              }
              if (commit({
                txId: nextTransactionId('link'), actor: 'user', origin: 'gui', baseRev: document.rev,
                ops: [{ op: 'set_node_data', id: node.id, data: { ...node.data, link: value } }],
              }, value.length === 0 ? 'Link removed' : 'Link updated')) {
                setLinkEditor(null);
              }
            }}
          >
            <div className="oc-command-header">
              <div><span>OBJECT ACTION</span><h2 id="oc-link-title">Add or edit link</h2></div>
              <button type="button" onClick={() => setLinkEditor(null)} aria-label="Close link editor">Esc</button>
            </div>
            <label>
              <span>Destination URL</span>
              <input
                type="url"
                value={linkEditor.value}
                onChange={(event) => setLinkEditor({ ...linkEditor, value: event.target.value })}
                placeholder="https://…"
                autoFocus
              />
            </label>
            <div className="oc-link-actions">
              <button type="button" onClick={() => setLinkEditor(null)}>Cancel</button>
              <button type="submit">Apply link</button>
            </div>
          </form>
        </div>
      ) : null}

      {shortcutOpen ? (
        <div className="oc-command-backdrop" role="presentation" onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            setShortcutOpen(false);
          }
        }}>
          <section className="oc-command-palette" role="dialog" aria-modal="true" aria-labelledby="oc-command-title">
            <div className="oc-command-header">
              <div><span>REFERENCE</span><h2 id="oc-command-title">Windows shortcuts</h2></div>
              <button type="button" onClick={() => setShortcutOpen(false)} aria-label="Close shortcut overlay">Esc</button>
            </div>
            <label className="oc-command-search">
              <span aria-hidden="true"><Icon src={magnifyingGlassIcon} size={16} /></span>
              <input
                value={shortcutQuery}
                onChange={(event) => setShortcutQuery(event.target.value)}
                placeholder="Search commands, tools, or keys…"
                aria-label="Search shortcuts"
                autoFocus
              />
            </label>
            <div className="oc-command-results">
              {shortcutResults.map((command) => (
                <button
                  type="button"
                  key={command.id}
                  disabled={command.available === false}
                  onClick={() => {
                    executeCommand(command.id);
                    if (command.available !== false) {
                      setShortcutOpen(false);
                    }
                  }}
                >
                  <span><small>{command.category}</small><strong>{command.label}</strong>{command.unavailableReason === undefined ? null : <em>{command.unavailableReason}</em>}</span>
                  <span className="oc-key-row">{command.shortcuts.map((shortcut) => <kbd key={shortcut}>{shortcut}</kbd>)}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
