export type ThemeName = "clean" | "sketch";

export interface SceneSize { width: number; height: number }

export interface CameraState {
  /** Viewport-space pan offset applied after world zoom. */
  x: number;
  /** Viewport-space pan offset applied after world zoom. */
  y: number;
  /** Uniform world scale. Must be > 0. */
  zoom: number;
}

export interface CameraTarget {
  x?: number;
  y?: number;
  zoom?: number;
}

export interface Transform {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
}

export interface Style {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  radius?: number;
}

export interface BaseObject {
  id: string;
  type: DrawableType;
  transform: Transform;
  style: Style;
  visible: boolean;
  z: number;
  parentId?: string;
  description?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface RectObject extends BaseObject {
  type: "rect";
  width: number;
  height: number;
  text?: string;
}

export interface CircleObject extends BaseObject {
  type: "circle";
  radius: number;
  text?: string;
}

export interface EllipseObject extends BaseObject {
  type: "ellipse";
  rx: number;
  ry: number;
  text?: string;
}

export interface PointValue {
  x: number;
  y: number;
}

export interface PolygonObject extends BaseObject {
  type: "polygon";
  points: PointValue[];
  drawProgress?: number;
}

export interface PolylineObject extends BaseObject {
  type: "polyline";
  points: PointValue[];
  drawProgress?: number;
}

export interface TextObject extends BaseObject {
  type: "text";
  text: string;
}

export interface LineObject extends BaseObject {
  type: "line";
  x2: number;
  y2: number;
}

export interface PathObject extends BaseObject {
  type: "path";
  d: string;
  /**
   * Normalized stroke reveal progress. Omitted means fully drawn.
   * Renderers should clamp to [0, 1].
   */
  drawProgress?: number;
}

export interface GroupObject extends BaseObject {
  type: "group";
  children: string[];
}

export interface ConnectorObject extends BaseObject {
  type: "connector";
  from: AnchorRef;
  to: AnchorRef;
  kind: "straight" | "curve" | "orthogonal";
  label?: string;
}

export interface ImageObject extends BaseObject {
  type: "image";
  width: number;
  height: number;
  href: string;
  alt?: string;
}

export type DrawableObject =
  | RectObject
  | CircleObject
  | EllipseObject
  | PolygonObject
  | PolylineObject
  | TextObject
  | LineObject
  | PathObject
  | GroupObject
  | ConnectorObject
  | ImageObject;

export type DrawableType = DrawableObject["type"];

export type AnchorName = "center" | "top" | "bottom" | "left" | "right";

export interface AnchorRef {
  objectId: string;
  anchor?: AnchorName;
}

export type EasingName = "linear" | "easeIn" | "easeOut" | "easeInOut" | "spring";

export interface ActionBase {
  id: string;
  target: string;
  start: number;
  duration: number;
  easing?: EasingName;
}

export interface MoveAction extends ActionBase {
  type: "move";
  to: { x: number; y: number };
  path?: "linear" | "arc-up" | "arc-down";
  arcHeight?: number;
}

export interface FollowPathAction extends ActionBase {
  type: "followPath";
  /**
   * Explicit polyline in the target's transform coordinate space.
   * Evaluation uses distance along the polyline, never DOM/path measurement.
   */
  points: PointValue[];
}

export interface RotateAction extends ActionBase {
  type: "rotate";
  to: number;
}

export interface ScaleAction extends ActionBase {
  type: "scale";
  to: { x: number; y: number };
}

export interface OpacityAction extends ActionBase {
  type: "opacity";
  to: number;
}

export interface FillAction extends ActionBase {
  type: "fill";
  to: string;
}

export interface StrokeAction extends ActionBase {
  type: "stroke";
  to: string;
}

export interface ResizeAction extends ActionBase {
  type: "resize";
  to: { width: number; height: number };
}

export interface DrawAction extends ActionBase {
  type: "draw";
  /** Normalized target stroke reveal progress in [0, 1]. */
  to: number;
}

export interface VisibilityAction extends ActionBase {
  type: "visibility";
  visible: boolean;
}

export interface CameraAction {
  id: string;
  type: "camera";
  start: number;
  duration: number;
  easing?: EasingName;
  /** Absolute camera values. Omitted fields retain their current value. */
  to: CameraTarget;
}

export type Action =
  | CameraAction
  | MoveAction
  | FollowPathAction
  | RotateAction
  | ScaleAction
  | OpacityAction
  | FillAction
  | StrokeAction
  | ResizeAction
  | DrawAction
  | VisibilityAction;

export interface Marker {
  id: string;
  label: string;
  time: number;
}


export type ScalarValue = string | number | boolean | null;

export type InteractionTrigger =
  | { type: "click" | "focus" | "hover"; target: string }
  | { type: "custom"; name: string };

export type StateAction =
  | { type: "set"; key: string; value: ScalarValue }
  | { type: "toggle"; key: string }
  | { type: "increment"; key: string; by: number };

export interface Interaction {
  id: string;
  event: InteractionTrigger;
  actions: StateAction[];
}

export type Expression =
  | { kind: "literal"; value: ScalarValue }
  | { kind: "get"; path: string }
  | { kind: "op"; op: "add" | "sub" | "mul" | "div" | "min" | "max" | "clamp" | "lerp" | "eq" | "lt" | "gt" | "and" | "or" | "not"; args: Expression[] };

export type BindingProperty =
  | "x" | "y" | "rotation" | "scaleX" | "scaleY" | "opacity"
  | "fill" | "stroke" | "text";

export interface Binding {
  id: string;
  target: { objectId: string; property: BindingProperty };
  expression: Expression;
}

export interface EvaluationContext {
  inputs?: Record<string, ScalarValue>;
  state?: Record<string, ScalarValue>;
}

export interface SceneDocument {
  version: "1.0";
  scene: SceneSize & { theme?: ThemeName; background?: string; seed?: number; camera?: CameraState };
  objects: DrawableObject[];
  timeline: Action[];
  state?: Record<string, ScalarValue>;
  bindings?: Binding[];
  interactions?: Interaction[];
  markers?: Marker[];
}

export interface EvaluatedScene {
  version: SceneDocument["version"];
  scene: SceneDocument["scene"];
  /** Resolved camera at this absolute timeline time. */
  camera: CameraState;
  objects: DrawableObject[];
  time: number;
  duration: number;
}
