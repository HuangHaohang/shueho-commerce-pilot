export type CreativeCanvasNodeType = "document" | "image" | "table";
export type CreativeCanvasRevisionOrigin = "harness" | "user";

export type CreativeCanvasDocumentContent = {
  kind: "document";
  title: string;
  body: string;
  callToAction: string;
  complianceNotes: string[];
};

export type CreativeCanvasTableRow = {
  id: string;
  cells: string[];
};

export type CreativeCanvasTableContent = {
  kind: "table";
  title: string;
  columns: string[];
  rows: CreativeCanvasTableRow[];
  notes: string[];
};

export type CreativeCanvasImageTextLayer = {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  align: "left" | "center" | "right";
};

export type CreativeCanvasEditorLayerBase = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
};

export type CreativeCanvasEditorTextLayer = CreativeCanvasEditorLayerBase & {
  kind: "text";
  text: string;
  fontSize: number;
  color: string;
  align: "left" | "center" | "right";
  fontWeight: 400 | 500 | 600 | 700;
};

export type CreativeCanvasEditorShapeLayer = CreativeCanvasEditorLayerBase & {
  kind: "shape";
  shape: "rectangle" | "ellipse";
  fill: string;
  stroke: string;
  strokeWidth: number;
};

export type CreativeCanvasEditorImageLayer = CreativeCanvasEditorLayerBase & {
  kind: "image";
  source: "base";
  fit: "contain" | "cover";
};

export type CreativeCanvasEditorDrawingLayer = CreativeCanvasEditorLayerBase & {
  kind: "drawing";
  points: Array<{ x: number; y: number }>;
  stroke: string;
  strokeWidth: number;
};

export type CreativeCanvasEditorLayer =
  | CreativeCanvasEditorTextLayer
  | CreativeCanvasEditorShapeLayer
  | CreativeCanvasEditorImageLayer
  | CreativeCanvasEditorDrawingLayer;

export type CreativeCanvasImageContent = {
  kind: "image";
  title: string;
  description: string;
  image: {
    artifactId: string;
    url: string;
    filename: string;
    model: string;
  };
  textLayers: CreativeCanvasImageTextLayer[];
  editorLayers?: CreativeCanvasEditorLayer[];
  complianceNotes: string[];
};

export type CreativeCanvasNodeContent =
  | CreativeCanvasDocumentContent
  | CreativeCanvasImageContent
  | CreativeCanvasTableContent;

export type CreativeCanvasLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  locked: boolean;
};

export type CreativeCanvasViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type CreativeCanvasNodeRecord = {
  id: string;
  sourceKind: "agent_message" | "image_generation" | "manual";
  sourceItemId: string;
  sourceBlockKey: string;
  sourceTurnId: string | null;
  sourceSequence: number;
  messageItemId: string | null;
  nodeType: CreativeCanvasNodeType;
  deliverableType: string | null;
  channel: string | null;
  title: string;
  revision: {
    id: string;
    number: number;
    origin: CreativeCanvasRevisionOrigin;
    content: CreativeCanvasNodeContent;
    createdAt: string;
  };
  revisionCount: number;
  previousRevisionId: string | null;
  layout: CreativeCanvasLayout;
};

export type CreativeCanvasMessageReference = {
  messageItemId: string;
  nodeId: string;
  nodeType: CreativeCanvasNodeType;
  title: string;
};

export type CreativeCanvasState = {
  threadId: string;
  nodes: CreativeCanvasNodeRecord[];
  messageRefs: CreativeCanvasMessageReference[];
  viewport: CreativeCanvasViewport | null;
  resolvedAt: string;
  sourceHistoryComplete?: boolean;
};

export type CreativeCanvasSourceNode = {
  sourceKind: "agent_message" | "image_generation";
  sourceItemId: string;
  sourceBlockKey: string;
  sourceTurnId: string | null;
  sourceSequence: number;
  messageItemId: string | null;
  nodeType: CreativeCanvasNodeType;
  deliverableType: string | null;
  channel: string | null;
  title: string;
  content: CreativeCanvasNodeContent;
  layout: CreativeCanvasLayout;
};

export type CreativeCanvasBlock = {
  key: string;
  type: CreativeCanvasNodeType;
  title: string;
  body: string;
  columns: string[];
  rows: Array<{ cells: string[] }>;
  textLayers: CreativeCanvasImageTextLayer[];
};
