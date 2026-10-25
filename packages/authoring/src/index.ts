import { applyMatrix, canonicalMorphPathToString, defaultCamera, defaultStyle, defaultTransform, evaluate, morphPathCompatibility, objectBounds, parseMorphPathData, transformMatrix, type Action, type AnchorName, type Binding, type BindingProperty, type CameraState, type CameraTarget, type ConnectorObject, type DrawableObject, type Easing, type Expression, type Interaction, type InteractionTrigger, type Marker, type PointValue, type ScalarValue, type SceneDocument, type StateAction, type StateMachine, type ThemeName } from "@anim8/core";

export interface SceneOptions {
  width?: number;
  height?: number;
  theme?: ThemeName;
  background?: string;
  seed?: number;
  camera?: Partial<CameraState>;
}

export interface MotionOptions {
  duration?: number;
  easing?: Easing;
  path?: "linear" | "arc-up" | "arc-down";
  arcHeight?: number;
  /** Explicitly replace an already-active action on the same property. */
  interrupt?: boolean;
  /** Margin used when the destination is a semantic scene position. */
  margin?: number;
}

export interface FollowPathOptions {
  duration?: number;
  easing?: Easing;
  interrupt?: boolean;
}

export interface MorphOptions {
  duration?: number;
  easing?: Easing;
  interrupt?: boolean;
}

export interface CameraMotionOptions {
  duration?: number;
  easing?: Easing;
  interrupt?: boolean;
}

export interface PulseOptions {
  /** Total pulse duration across expand + settle. Defaults to 360ms. */
  duration?: number;
  /** Multiplicative peak scale relative to the current scale. Defaults to 1.08. */
  scale?: number;
  easing?: Easing;
}

export interface ShakeOptions {
  /** Total shake duration across four primitive moves. Defaults to 360ms. */
  duration?: number;
  /** Scene-coordinate offset from the current position. Defaults to 8. */
  distance?: number;
  axis?: "x" | "y";
  easing?: Easing;
}

export type SemanticPosition =
  | "center"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export interface ShapeOptions {
  id?: string;
  x?: number;
  y?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  color?: string;
  width?: number;
  height?: number;
  /** Corner radius for rectangles. */
  radius?: number;
}

export interface StrokeShapeOptions extends ShapeOptions {
  /** Omitted means fully drawn. Use 0 to author a stroke that can draw in. */
  drawProgress?: number;
}

type WithoutSchedule<T> = T extends Action ? Omit<T, "id" | "start"> : never;
export type PendingAction = WithoutSchedule<Action>;
type Pending = PendingAction;

export interface Keyframe {
  /** Normalized target time in (0, 1]. The current evaluated pose is implicit at 0. */
  offset: number;
  position?: PointValue;
  rotation?: number;
  scale?: number | { x: number; y: number };
  opacity?: number;
  fill?: string;
  stroke?: string;
  /** Easing for the segment ending at this keyframe. */
  easing?: Easing;
}

export interface KeyframeOptions {
  duration: number;
  easing?: Easing;
}

export class NodeHandle {
  constructor(public readonly id: string, private readonly owner: SceneBuilder) {}
  moveTo(to: { x: number; y: number } | NodeHandle | SemanticPosition, options: MotionOptions = {}): Pending {
    const point = typeof to === "string"
      ? this.owner.semanticPositionOf(this.id, to, options.margin ?? 24)
      : to instanceof NodeHandle
        ? this.owner.positionOf(to.id)
        : to;
    return { type: "move", target: this.id, to: point, duration: options.duration ?? 600, easing: options.easing ?? "easeInOut", ...(options.path && options.path !== "linear" ? { path: options.path } : {}), ...(options.arcHeight !== undefined ? { arcHeight: options.arcHeight } : {}), ...(options.interrupt ? { interrupt: true } : {}) };
  }
  followPath(points: readonly PointValue[], options: FollowPathOptions = {}): Pending {
    this.owner.assertFollowPath(points);
    return {
      type: "followPath",
      target: this.id,
      points: points.map(point => ({ ...point })),
      duration: options.duration ?? 800,
      easing: options.easing ?? "easeInOut",
      ...(options.interrupt ? { interrupt: true } : {}),
    };
  }
  rotate(to: number, options: MotionOptions = {}): Pending {
    return { type: "rotate", target: this.id, to, duration: options.duration ?? 600, easing: options.easing ?? "easeInOut", ...(options.interrupt ? { interrupt: true } : {}) };
  }
  scale(to: number | { x: number; y: number }, options: MotionOptions = {}): Pending {
    const value = typeof to === "number" ? { x: to, y: to } : to;
    return { type: "scale", target: this.id, to: value, duration: options.duration ?? 600, easing: options.easing ?? "easeInOut", ...(options.interrupt ? { interrupt: true } : {}) };
  }
  resize(to: { width: number; height: number }, options: MotionOptions = {}): Pending {
    this.owner.assertResizable(this.id, to);
    return { type: "resize", target: this.id, to, duration: options.duration ?? 600, easing: options.easing ?? "easeInOut", ...(options.interrupt ? { interrupt: true } : {}) };
  }
  draw(to = 1, options: MotionOptions = {}): Pending {
    this.owner.assertDrawableStroke(this.id, to);
    return { type: "draw", target: this.id, to, duration: options.duration ?? 600, easing: options.easing ?? "easeInOut", ...(options.interrupt ? { interrupt: true } : {}) };
  }
  morphTo(to: string, options: MorphOptions = {}): Pending {
    const canonical = this.owner.assertMorphable(this.id, to);
    return { type: "morph", target: this.id, to: canonical, duration: options.duration ?? 600, easing: options.easing ?? "easeInOut", ...(options.interrupt ? { interrupt: true } : {}) };
  }
  fadeTo(to: number, options: MotionOptions = {}): Pending {
    return { type: "opacity", target: this.id, to, duration: options.duration ?? 400, easing: options.easing ?? "easeInOut", ...(options.interrupt ? { interrupt: true } : {}) };
  }
  highlight(color = "#fef08a", options: MotionOptions = {}): Pending {
    return { type: "fill", target: this.id, to: color, duration: options.duration ?? 300, easing: options.easing ?? "easeInOut", ...(options.interrupt ? { interrupt: true } : {}) };
  }
  show(): Pending {
    return { type: "visibility", target: this.id, visible: true, duration: 0 };
  }
  hide(): Pending {
    return { type: "visibility", target: this.id, visible: false, duration: 0 };
  }
  pulse(options: PulseOptions = {}): void {
    this.owner.pulse(this, options);
  }
  shake(options: ShakeOptions = {}): void {
    this.owner.shake(this, options);
  }
  bind(property: BindingProperty, expression: Expression): void {
    this.owner.bind(this, property, expression);
  }
  onClick(...actions: StateAction[]): void {
    this.owner.interaction({ type: "click", target: this.id }, actions);
  }
  onFocus(...actions: StateAction[]): void {
    this.owner.interaction({ type: "focus", target: this.id }, actions);
  }
  onHover(...actions: StateAction[]): void {
    this.owner.interaction({ type: "hover", target: this.id }, actions);
  }
}

export class SceneBuilder {
  private objects: DrawableObject[] = [];
  private timeline: Action[] = [];
  private markers: Marker[] = [];
  private stateValues: Record<string, ScalarValue> = {};
  private bindings: Binding[] = [];
  private interactions: Interaction[] = [];
  private stateMachines: StateMachine[] = [];
  private cursor = 0;
  private idCounter = 0;

  constructor(private readonly options: SceneOptions = {}) {}

  private next(prefix: string): string { return `${prefix}_${++this.idCounter}`; }

  private baseCamera(): CameraState {
    const base = defaultCamera();
    const configured = this.options.camera;
    if (!configured) return base;
    const camera = {
      x: configured.x ?? base.x,
      y: configured.y ?? base.y,
      zoom: configured.zoom ?? base.zoom,
    };
    if (!Number.isFinite(camera.x) || !Number.isFinite(camera.y) || !Number.isFinite(camera.zoom) || camera.zoom <= 0) {
      throw new Error("Camera x/y must be finite numbers and zoom must be a finite number > 0.");
    }
    return camera;
  }

  private styleFor(options: ShapeOptions): ReturnType<typeof defaultStyle> {
    return {
      ...defaultStyle(),
      ...(options.fill !== undefined ? { fill: options.fill } : {}),
      ...(options.stroke !== undefined ? { stroke: options.stroke } : {}),
      ...(options.strokeWidth !== undefined ? { strokeWidth: options.strokeWidth } : {}),
      ...(options.color !== undefined ? { color: options.color } : {}),
      ...(options.radius !== undefined ? { radius: options.radius } : {}),
    };
  }

  private objectById(id: string): DrawableObject {
    const object = this.objects.find(item => item.id === id);
    if (!object) throw new Error(`Unknown object '${id}'.`);
    return object;
  }

  private evaluatedObject(id: string): DrawableObject {
    if (this.timeline.length === 0 || this.cursor === 0) return this.objectById(id);
    const frame = evaluate({
      version: "1.0",
      scene: { width: this.options.width ?? 800, height: this.options.height ?? 450 },
      objects: this.objects,
      timeline: this.timeline,
    }, this.cursor);
    const object = frame.objects.find(item => item.id === id);
    if (!object) throw new Error(`Unknown object '${id}'.`);
    return object;
  }

  private validatePoints(points: readonly PointValue[], minimum: number, kind: string): void {
    if (points.length < minimum) throw new Error(`${kind} requires at least ${minimum} points.`);
    for (const point of points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        throw new Error(`${kind} point coordinates must be finite numbers.`);
      }
    }
  }

  private validateDrawProgress(progress: number | undefined): void {
    if (progress !== undefined && (!Number.isFinite(progress) || progress < 0 || progress > 1)) {
      throw new Error("drawProgress must be a finite number between 0 and 1.");
    }
  }

  assertFollowPath(points: readonly PointValue[]): void {
    this.validatePoints(points, 2, "followPath");
    let totalLength = 0;
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1]!;
      const point = points[index]!;
      totalLength += Math.hypot(point.x - previous.x, point.y - previous.y);
    }
    if (totalLength === 0) throw new Error("followPath requires at least one non-zero-length segment.");
  }

  assertResizable(id: string, to: { width: number; height: number }): void {
    const object = this.objectById(id);
    if (!Number.isFinite(to.width) || to.width < 0 || !Number.isFinite(to.height) || to.height < 0) {
      throw new Error("Resize width and height must be finite numbers >= 0.");
    }
    if (object.type !== "rect" && object.type !== "image" && object.type !== "ellipse" && object.type !== "circle") {
      throw new Error(`Object '${id}' of type '${object.type}' cannot be resized geometrically; use scale instead.`);
    }
    if (object.type === "circle" && to.width !== to.height) {
      throw new Error("Circle resize requires equal width and height; use ellipse for non-uniform geometry.");
    }
  }

  assertDrawableStroke(id: string, to: number): void {
    const object = this.objectById(id);
    if (object.type !== "path" && object.type !== "polygon" && object.type !== "polyline") {
      throw new Error(`Object '${id}' of type '${object.type}' does not expose drawProgress.`);
    }
    if (!Number.isFinite(to) || to < 0 || to > 1) {
      throw new Error("Draw progress must be a finite number between 0 and 1.");
    }
  }

  assertMorphable(id: string, to: string): string {
    const object = this.evaluatedObject(id);
    if (object.type !== "path") {
      throw new Error(`Object '${id}' of type '${object.type}' is not an SVG path and cannot be morphed.`);
    }

    const fromPath = parseMorphPathData(object.d);
    if (!fromPath.ok) throw new Error(`Morph source path is invalid: ${fromPath.message}`);
    const toPath = parseMorphPathData(to);
    if (!toPath.ok) throw new Error(`Morph target path is invalid: ${toPath.message}`);

    const compatibility = morphPathCompatibility(fromPath.path, toPath.path);
    if (!compatibility.ok) throw new Error(compatibility.message);
    return canonicalMorphPathToString(toPath.path);
  }

  /**
   * Returns a scene-space semantic point. Shape-aware semantic destinations are
   * available directly through NodeHandle.moveTo("top-right"), etc.
   */
  at(position: SemanticPosition, margin = 24): { x: number; y: number } {
    if (!Number.isFinite(margin) || margin < 0) throw new Error("Semantic position margin must be a finite number >= 0.");
    const width = this.options.width ?? 800;
    const height = this.options.height ?? 450;
    const horizontal = position.includes("left") ? "left" : position.includes("right") ? "right" : "center";
    const vertical = position.includes("top") ? "top" : position.includes("bottom") ? "bottom" : "center";
    return {
      x: horizontal === "left" ? margin : horizontal === "right" ? width - margin : width / 2,
      y: vertical === "top" ? margin : vertical === "bottom" ? height - margin : height / 2,
    };
  }

  cameraTo(to: CameraTarget, options: CameraMotionOptions = {}): Pending {
    const values = [to.x, to.y, to.zoom];
    if (values.every(value => value === undefined)) {
      throw new Error("Camera target must set at least one of x, y, or zoom.");
    }
    if ((to.x !== undefined && !Number.isFinite(to.x)) ||
        (to.y !== undefined && !Number.isFinite(to.y)) ||
        (to.zoom !== undefined && (!Number.isFinite(to.zoom) || to.zoom <= 0))) {
      throw new Error("Camera x/y must be finite numbers and zoom must be a finite number > 0.");
    }
    return {
      type: "camera",
      to: { ...to },
      duration: options.duration ?? 600,
      easing: options.easing ?? "easeInOut",
      ...(options.interrupt ? { interrupt: true } : {}),
    };
  }

  semanticPositionOf(id: string, position: SemanticPosition, margin = 24): { x: number; y: number } {
    if (!Number.isFinite(margin) || margin < 0) throw new Error("Semantic position margin must be a finite number >= 0.");
    const object = this.evaluatedObject(id);
    if (object.parentId) {
      throw new Error(`Semantic scene positioning is only defined for root objects; '${id}' belongs to '${object.parentId}'.`);
    }

    const bounds = objectBounds(object);
    const matrix = transformMatrix({ ...object.transform, x: 0, y: 0 });
    const corners = [
      applyMatrix(matrix, { x: bounds.minX, y: bounds.minY }),
      applyMatrix(matrix, { x: bounds.maxX, y: bounds.minY }),
      applyMatrix(matrix, { x: bounds.maxX, y: bounds.maxY }),
      applyMatrix(matrix, { x: bounds.minX, y: bounds.maxY }),
    ];
    const minX = Math.min(...corners.map(point => point.x));
    const maxX = Math.max(...corners.map(point => point.x));
    const minY = Math.min(...corners.map(point => point.y));
    const maxY = Math.max(...corners.map(point => point.y));
    const width = this.options.width ?? 800;
    const height = this.options.height ?? 450;
    const horizontal = position.includes("left") ? "left" : position.includes("right") ? "right" : "center";
    const vertical = position.includes("top") ? "top" : position.includes("bottom") ? "bottom" : "center";

    return {
      x: horizontal === "left"
        ? margin - minX
        : horizontal === "right"
          ? width - margin - maxX
          : width / 2 - (minX + maxX) / 2,
      y: vertical === "top"
        ? margin - minY
        : vertical === "bottom"
          ? height - margin - maxY
          : height / 2 - (minY + maxY) / 2,
    };
  }

  box(text = "", options: ShapeOptions = {}): NodeHandle {
    const id = options.id ?? this.next("box");
    this.objects.push({
      id, type: "rect", width: options.width ?? 100, height: options.height ?? 60, text,
      transform: { ...defaultTransform(), x: options.x ?? 0, y: options.y ?? 0 },
      style: this.styleFor(options),
      visible: true, z: this.objects.length,
    });
    return new NodeHandle(id, this);
  }

  circle(text = "", options: ShapeOptions = {}): NodeHandle {
    const id = options.id ?? this.next("circle");
    this.objects.push({
      id, type: "circle", radius: (options.width ?? options.height ?? 60) / 2, text,
      transform: { ...defaultTransform(), x: options.x ?? 0, y: options.y ?? 0 },
      style: this.styleFor(options),
      visible: true, z: this.objects.length,
    });
    return new NodeHandle(id, this);
  }

  ellipse(text = "", options: ShapeOptions = {}): NodeHandle {
    const id = options.id ?? this.next("ellipse");
    const width = options.width ?? 100;
    const height = options.height ?? 60;
    if (!Number.isFinite(width) || width < 0 || !Number.isFinite(height) || height < 0) {
      throw new Error("Ellipse width and height must be finite numbers >= 0.");
    }
    this.objects.push({
      id, type: "ellipse", rx: width / 2, ry: height / 2, text,
      transform: { ...defaultTransform(), x: options.x ?? 0, y: options.y ?? 0 },
      style: this.styleFor(options),
      visible: true, z: this.objects.length,
    });
    return new NodeHandle(id, this);
  }

  polygon(points: readonly PointValue[], options: StrokeShapeOptions = {}): NodeHandle {
    this.validatePoints(points, 3, "Polygon");
    this.validateDrawProgress(options.drawProgress);
    const id = options.id ?? this.next("polygon");
    this.objects.push({
      id, type: "polygon", points: points.map(point => ({ ...point })),
      ...(options.drawProgress !== undefined ? { drawProgress: options.drawProgress } : {}),
      transform: { ...defaultTransform(), x: options.x ?? 0, y: options.y ?? 0 },
      style: this.styleFor(options),
      visible: true, z: this.objects.length,
    });
    return new NodeHandle(id, this);
  }

  polyline(points: readonly PointValue[], options: StrokeShapeOptions = {}): NodeHandle {
    this.validatePoints(points, 2, "Polyline");
    this.validateDrawProgress(options.drawProgress);
    const id = options.id ?? this.next("polyline");
    this.objects.push({
      id, type: "polyline", points: points.map(point => ({ ...point })),
      ...(options.drawProgress !== undefined ? { drawProgress: options.drawProgress } : {}),
      transform: { ...defaultTransform(), x: options.x ?? 0, y: options.y ?? 0 },
      style: { ...this.styleFor(options), fill: options.fill ?? "none" },
      visible: true, z: this.objects.length,
    });
    return new NodeHandle(id, this);
  }

  path(d: string, options: StrokeShapeOptions = {}): NodeHandle {
    this.validateDrawProgress(options.drawProgress);
    const id = options.id ?? this.next("path");
    this.objects.push({
      id, type: "path", d,
      ...(options.drawProgress !== undefined ? { drawProgress: options.drawProgress } : {}),
      transform: { ...defaultTransform(), x: options.x ?? 0, y: options.y ?? 0 },
      style: { ...this.styleFor(options), fill: options.fill ?? "none" },
      visible: true, z: this.objects.length,
    });
    return new NodeHandle(id, this);
  }

  text(text: string, options: ShapeOptions = {}): NodeHandle {
    const id = options.id ?? this.next("text");
    this.objects.push({
      id, type: "text", text,
      transform: { ...defaultTransform(), x: options.x ?? 0, y: options.y ?? 0 },
      style: this.styleFor(options), visible: true, z: this.objects.length,
    });
    return new NodeHandle(id, this);
  }

  group(children: NodeHandle[], options: Pick<ShapeOptions, "id" | "x" | "y"> = {}): NodeHandle {
    const id = options.id ?? this.next("group");
    if (this.objects.some(object => object.id === id)) throw new Error(`Duplicate object id '${id}'.`);
    const x = options.x ?? 0;
    const y = options.y ?? 0;
    const childIds = children.map(child => child.id);
    for (const childId of childIds) {
      const child = this.objects.find(object => object.id === childId);
      if (!child) throw new Error(`Unknown child '${childId}'.`);
      if (child.parentId) throw new Error(`Object '${childId}' already belongs to group '${child.parentId}'.`);
      child.parentId = id;
      child.transform.x -= x;
      child.transform.y -= y;
    }
    this.objects.push({
      id, type: "group", children: childIds,
      transform: { ...defaultTransform(), x, y },
      style: defaultStyle(), visible: true, z: this.objects.length,
    });
    return new NodeHandle(id, this);
  }

  connect(from: NodeHandle, to: NodeHandle, options: { from?: AnchorName; to?: AnchorName; kind?: ConnectorObject["kind"]; routing?: ConnectorObject["routing"]; label?: string } = {}): NodeHandle {
    const id = this.next("connector");
    this.objects.push({
      id, type: "connector", from: { objectId: from.id, ...(options.from ? { anchor: options.from } : {}) }, to: { objectId: to.id, ...(options.to ? { anchor: options.to } : {}) },
      kind: options.kind ?? "straight", ...(options.routing ? { routing: structuredClone(options.routing) } : {}), ...(options.label ? { label: options.label } : {}),
      transform: defaultTransform(), style: { ...defaultStyle(), fill: "none" }, visible: true, z: this.objects.length,
    });
    return new NodeHandle(id, this);
  }

  positionOf(id: string): { x: number; y: number } {
    const object = this.objects.find(item => item.id === id);
    if (!object) throw new Error(`Unknown object '${id}'.`);
    if (this.timeline.length === 0 || this.cursor === 0) return { x: object.transform.x, y: object.transform.y };
    const frame = evaluate({ version: "1.0", scene: { width: this.options.width ?? 800, height: this.options.height ?? 450 }, objects: this.objects, timeline: this.timeline }, this.cursor);
    const evaluated = frame.objects.find(item => item.id === id);
    return evaluated ? { x: evaluated.transform.x, y: evaluated.transform.y } : { x: object.transform.x, y: object.transform.y };
  }

  private scheduleAt(start: number, action: Pending): string {
    if (!Number.isFinite(start) || start < 0) throw new Error("Action start must be a finite number >= 0.");
    if (!Number.isFinite(action.duration) || action.duration < 0) throw new Error("Action duration must be a finite number >= 0.");
    const id = this.next(action.type);
    this.timeline.push({ ...structuredClone(action), id, start } as Action);
    return id;
  }

  sequence(...actions: Pending[]): string[] {
    const ids: string[] = [];
    for (const action of actions) {
      ids.push(this.scheduleAt(this.cursor, action));
      this.cursor += action.duration;
    }
    return ids;
  }

  parallel(...actions: Pending[]): string[] {
    const start = this.cursor;
    let end = start;
    const ids: string[] = [];
    for (const action of actions) {
      ids.push(this.scheduleAt(start, action));
      end = Math.max(end, start + action.duration);
    }
    this.cursor = end;
    return ids;
  }

  /** Schedule actions at an absolute timeline time. */
  atTime(time: number, ...actions: Pending[]): string[] {
    if (!Number.isFinite(time) || time < 0) throw new Error("Absolute timeline time must be a finite number >= 0.");
    let end = this.cursor;
    const ids: string[] = [];
    for (const action of actions) {
      ids.push(this.scheduleAt(time, action));
      end = Math.max(end, time + action.duration);
    }
    this.cursor = end;
    return ids;
  }

  /** Schedule actions relative to the current authoring cursor. */
  after(delay: number, ...actions: Pending[]): string[] {
    if (!Number.isFinite(delay) || delay < 0) throw new Error("Relative delay must be a finite number >= 0.");
    const start = this.cursor + delay;
    return this.atTime(start, ...actions);
  }

  /** Start each action after a fixed offset while allowing overlap. */
  stagger(gap: number, ...actions: Pending[]): string[] {
    if (!Number.isFinite(gap) || gap < 0) throw new Error("Stagger gap must be a finite number >= 0.");
    const start = this.cursor;
    let end = start;
    const ids: string[] = [];
    actions.forEach((action, index) => {
      const actionStart = start + gap * index;
      ids.push(this.scheduleAt(actionStart, action));
      end = Math.max(end, actionStart + action.duration);
    });
    this.cursor = end;
    return ids;
  }

  /** Repeat a sequence of pending actions a fixed number of times. */
  repeat(count: number, ...actions: Pending[]): string[] {
    if (!Number.isInteger(count) || count < 0 || count > 10_000) {
      throw new Error("Repeat count must be an integer between 0 and 10000.");
    }
    const ids: string[] = [];
    for (let iteration = 0; iteration < count; iteration += 1) {
      ids.push(...this.sequence(...actions));
    }
    return ids;
  }

  /**
   * Compile timed keyframes into ordinary primitive actions.
   *
   * The current evaluated pose is the implicit value at offset 0. A keyframe at
   * offset 0 is allowed to intentionally establish an immediate value.
   */
  keyframes(target: NodeHandle, frames: readonly Keyframe[], options: KeyframeOptions): string[] {
    if (!Number.isFinite(options.duration) || options.duration <= 0) {
      throw new Error("Keyframe duration must be a finite number > 0.");
    }
    if (frames.length === 0) throw new Error("Keyframes require at least one target frame.");

    let previousOffset = 0;
    const start = this.cursor;
    const ids: string[] = [];
    for (const [index, frame] of frames.entries()) {
      if (!Number.isFinite(frame.offset) || frame.offset < 0 || frame.offset > 1) {
        throw new Error(`Keyframe offset at index ${index} must be between 0 and 1.`);
      }
      if (frame.offset < previousOffset || (index > 0 && frame.offset === previousOffset)) {
        throw new Error("Keyframe offsets must be strictly increasing.");
      }

      const segmentStart = start + previousOffset * options.duration;
      const segmentDuration = (frame.offset - previousOffset) * options.duration;
      const easing = frame.easing ?? options.easing ?? "easeInOut";
      const pending: Pending[] = [];

      if (frame.position) {
        pending.push({
          type: "move",
          target: target.id,
          to: { ...frame.position },
          duration: segmentDuration,
          easing,
        });
      }
      if (frame.rotation !== undefined) {
        pending.push({ type: "rotate", target: target.id, to: frame.rotation, duration: segmentDuration, easing });
      }
      if (frame.scale !== undefined) {
        const scale = typeof frame.scale === "number"
          ? { x: frame.scale, y: frame.scale }
          : { ...frame.scale };
        pending.push({ type: "scale", target: target.id, to: scale, duration: segmentDuration, easing });
      }
      if (frame.opacity !== undefined) {
        pending.push({ type: "opacity", target: target.id, to: frame.opacity, duration: segmentDuration, easing });
      }
      if (frame.fill !== undefined) {
        pending.push({ type: "fill", target: target.id, to: frame.fill, duration: segmentDuration, easing });
      }
      if (frame.stroke !== undefined) {
        pending.push({ type: "stroke", target: target.id, to: frame.stroke, duration: segmentDuration, easing });
      }

      for (const action of pending) ids.push(this.scheduleAt(segmentStart, action));
      previousOffset = frame.offset;
    }

    if (frames.at(-1)!.offset !== 1) {
      throw new Error("The final keyframe offset must be 1.");
    }
    this.cursor = Math.max(this.cursor, start + options.duration);
    return ids;
  }

  private pendingProperties(action: Pending | Action): readonly string[] {
    switch (action.type) {
      case "move":
      case "followPath": return ["x", "y"];
      case "rotate": return ["rotation"];
      case "scale": return ["scaleX", "scaleY"];
      case "opacity": return ["opacity"];
      case "fill": return ["fill"];
      case "stroke": return ["stroke"];
      case "resize": return ["width", "height"];
      case "draw": return ["drawProgress"];
      case "morph": return ["d"];
      case "visibility": return ["visible"];
      case "camera": return [
        ...(action.to.x !== undefined ? ["camera.x"] : []),
        ...(action.to.y !== undefined ? ["camera.y"] : []),
        ...(action.to.zoom !== undefined ? ["camera.zoom"] : []),
      ];
    }
  }

  /**
   * Retarget an active action without jumping by explicitly interrupting it at
   * the requested absolute time.
   */
  retarget(actionId: string, replacement: Pending, at = this.cursor): string {
    const original = this.timeline.find(action => action.id === actionId);
    if (!original) throw new Error(`Unknown action '${actionId}'.`);
    if (!Number.isFinite(at) || at <= original.start || at >= original.start + original.duration) {
      throw new Error("Retarget time must fall strictly inside the original action.");
    }

    const sameTarget =
      original.type === "camera" || replacement.type === "camera"
        ? original.type === "camera" && replacement.type === "camera"
        : original.target === replacement.target;
    const conflicts = this.pendingProperties(original).some(property =>
      this.pendingProperties(replacement).includes(property)
    );
    if (!sameTarget || !conflicts) {
      throw new Error("Retarget replacement must write the same target and at least one of the original action's properties.");
    }

    const id = this.scheduleAt(at, { ...replacement, interrupt: true } as Pending);
    this.cursor = Math.max(this.cursor, at + replacement.duration);
    return id;
  }

  /**
   * Freeze an active action at its sampled pose. Cancelling before it starts
   * removes it outright; cancelling after it ends is a no-op.
   */
  cancel(actionId: string, at = this.cursor): string | undefined {
    const index = this.timeline.findIndex(action => action.id === actionId);
    if (index < 0) throw new Error(`Unknown action '${actionId}'.`);
    const original = this.timeline[index]!;
    if (!Number.isFinite(at) || at < 0) throw new Error("Cancellation time must be a finite number >= 0.");

    if (at <= original.start) {
      this.timeline.splice(index, 1);
      return undefined;
    }
    if (at >= original.start + original.duration || original.duration === 0) return undefined;

    const document: SceneDocument = {
      version: "1.0",
      scene: {
        width: this.options.width ?? 800,
        height: this.options.height ?? 450,
        camera: this.baseCamera(),
      },
      objects: this.objects,
      timeline: this.timeline,
    };
    const frame = evaluate(document, at);
    let hold: Pending | undefined;

    if (original.type === "camera") {
      const to: CameraTarget = {};
      if (original.to.x !== undefined) to.x = frame.camera.x;
      if (original.to.y !== undefined) to.y = frame.camera.y;
      if (original.to.zoom !== undefined) to.zoom = frame.camera.zoom;
      hold = { type: "camera", to, duration: 0, easing: "linear", interrupt: true };
    } else {
      const object = frame.objects.find(item => item.id === original.target);
      if (!object) throw new Error(`Unknown target '${original.target}'.`);
      switch (original.type) {
        case "move":
        case "followPath":
          hold = { type: "move", target: original.target, to: { x: object.transform.x, y: object.transform.y }, duration: 0, easing: "linear", interrupt: true };
          break;
        case "rotate":
          hold = { type: "rotate", target: original.target, to: object.transform.rotation, duration: 0, easing: "linear", interrupt: true };
          break;
        case "scale":
          hold = { type: "scale", target: original.target, to: { x: object.transform.scaleX, y: object.transform.scaleY }, duration: 0, easing: "linear", interrupt: true };
          break;
        case "opacity":
          hold = { type: "opacity", target: original.target, to: object.transform.opacity, duration: 0, easing: "linear", interrupt: true };
          break;
        case "fill":
          hold = { type: "fill", target: original.target, to: object.style.fill ?? "none", duration: 0, easing: "linear", interrupt: true };
          break;
        case "stroke":
          hold = { type: "stroke", target: original.target, to: object.style.stroke ?? "none", duration: 0, easing: "linear", interrupt: true };
          break;
        case "resize": {
          if (object.type === "rect" || object.type === "image") {
            hold = { type: "resize", target: original.target, to: { width: object.width, height: object.height }, duration: 0, easing: "linear", interrupt: true };
          } else if (object.type === "circle") {
            hold = { type: "resize", target: original.target, to: { width: object.radius * 2, height: object.radius * 2 }, duration: 0, easing: "linear", interrupt: true };
          } else if (object.type === "ellipse") {
            hold = { type: "resize", target: original.target, to: { width: object.rx * 2, height: object.ry * 2 }, duration: 0, easing: "linear", interrupt: true };
          }
          break;
        }
        case "draw":
          if (object.type === "path" || object.type === "polygon" || object.type === "polyline") {
            hold = { type: "draw", target: original.target, to: object.drawProgress ?? 1, duration: 0, easing: "linear", interrupt: true };
          }
          break;
        case "morph":
          if (object.type === "path") {
            hold = { type: "morph", target: original.target, to: object.d, duration: 0, easing: "linear", interrupt: true };
          }
          break;
        case "visibility":
          return undefined;
      }
    }

    if (!hold) throw new Error(`Action '${actionId}' cannot be cancelled safely.`);
    const id = this.scheduleAt(at, hold);
    this.cursor = Math.max(this.cursor, at);
    return id;
  }

  step(label: string, build: () => void): void {
    this.markers.push({ id: this.next("step"), label, time: this.cursor });
    build();
  }

  wait(duration: number): void {
    if (!Number.isFinite(duration) || duration < 0) throw new Error("Wait duration must be a finite number >= 0.");
    this.cursor += duration;
  }

  delay(duration: number): void { this.wait(duration); }

  state(name: string, value: ScalarValue): void {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid state name '${name}'.`);
    this.stateValues[name] = value;
  }

  bind(target: NodeHandle, property: BindingProperty, expression: Expression): void {
    this.bindings.push({ id: this.next("binding"), target: { objectId: target.id, property }, expression });
  }

  interaction(event: InteractionTrigger, actions: readonly StateAction[], id = this.next("interaction")): string {
    if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(id)) throw new Error(`Invalid interaction id '${id}'.`);
    if (actions.length === 0) throw new Error("Interaction requires at least one state action.");
    this.interactions.push({ id, event: structuredClone(event), actions: structuredClone([...actions]) });
    return id;
  }

  on(eventName: string, ...actions: StateAction[]): string {
    if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(eventName)) throw new Error(`Invalid custom event name '${eventName}'.`);
    if (eventName === "click" || eventName === "focus" || eventName === "hover") {
      throw new Error(`Custom event name '${eventName}' is reserved.`);
    }
    return this.interaction({ type: "custom", name: eventName }, actions);
  }

  stateMachine(machine: StateMachine): void {
    if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(machine.id)) throw new Error(`Invalid state machine id '${machine.id}'.`);
    if (machine.states.length === 0) throw new Error("State machine requires at least one state.");
    this.stateMachines.push(structuredClone(machine));
  }

  pulse(target: NodeHandle, options: PulseOptions = {}): void {
    const duration = options.duration ?? 360;
    const scale = options.scale ?? 1.08;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("Pulse duration must be a finite number > 0.");
    if (!Number.isFinite(scale) || scale <= 0) throw new Error("Pulse scale must be a finite number > 0.");

    const object = this.evaluatedObject(target.id);
    const easing = options.easing ?? "easeInOut";
    const firstDuration = duration / 2;
    const secondDuration = duration - firstDuration;
    this.sequence(
      {
        type: "scale",
        target: target.id,
        to: {
          x: object.transform.scaleX * scale,
          y: object.transform.scaleY * scale,
        },
        duration: firstDuration,
        easing,
      },
      {
        type: "scale",
        target: target.id,
        to: {
          x: object.transform.scaleX,
          y: object.transform.scaleY,
        },
        duration: secondDuration,
        easing,
      },
    );
  }

  shake(target: NodeHandle, options: ShakeOptions = {}): void {
    const duration = options.duration ?? 360;
    const distance = options.distance ?? 8;
    const axis = options.axis ?? "x";
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("Shake duration must be a finite number > 0.");
    if (!Number.isFinite(distance) || distance <= 0) throw new Error("Shake distance must be a finite number > 0.");
    if (axis !== "x" && axis !== "y") throw new Error("Shake axis must be x or y.");

    const base = this.positionOf(target.id);
    const easing = options.easing ?? "easeInOut";
    const stepDuration = duration / 4;
    const offset = (amount: number): { x: number; y: number } =>
      axis === "x"
        ? { x: base.x + amount, y: base.y }
        : { x: base.x, y: base.y + amount };

    this.sequence(
      { type: "move", target: target.id, to: offset(distance), duration: stepDuration, easing },
      { type: "move", target: target.id, to: offset(-distance), duration: stepDuration, easing },
      { type: "move", target: target.id, to: offset(distance), duration: stepDuration, easing },
      { type: "move", target: target.id, to: { ...base }, duration: duration - stepDuration * 3, easing },
    );
  }

  swap(a: NodeHandle, b: NodeHandle, options: MotionOptions = {}): void {
    const ap = this.positionOf(a.id);
    const bp = this.positionOf(b.id);
    const duration = options.duration ?? 700;
    this.parallel(
      { type: "move", target: a.id, to: bp, duration, easing: options.easing ?? "easeInOut", path: options.path === "arc-down" ? "arc-down" : "arc-up", ...(options.arcHeight !== undefined ? { arcHeight: options.arcHeight } : {}) },
      { type: "move", target: b.id, to: ap, duration, easing: options.easing ?? "easeInOut", path: options.path === "arc-up" ? "arc-up" : "arc-down", ...(options.arcHeight !== undefined ? { arcHeight: options.arcHeight } : {}) },
    );
  }

  toJSON(): SceneDocument {
    return {
      version: "1.0",
      scene: {
        width: this.options.width ?? 800,
        height: this.options.height ?? 450,
        theme: this.options.theme ?? "clean",
        ...(this.options.background ? { background: this.options.background } : {}),
        ...(this.options.seed !== undefined ? { seed: this.options.seed } : {}),
        camera: this.baseCamera(),
      },
      objects: structuredClone(this.objects),
      timeline: structuredClone(this.timeline),
      ...(Object.keys(this.stateValues).length ? { state: structuredClone(this.stateValues) } : {}),
      ...(this.bindings.length ? { bindings: structuredClone(this.bindings) } : {}),
      ...(this.interactions.length ? { interactions: structuredClone(this.interactions) } : {}),
      ...(this.stateMachines.length ? { stateMachines: structuredClone(this.stateMachines) } : {}),
      ...(this.markers.length ? { markers: structuredClone(this.markers) } : {}),
    };
  }
}

export const stateAction = {
  set(key: string, value: ScalarValue): StateAction { return { type: "set", key, value }; },
  toggle(key: string): StateAction { return { type: "toggle", key }; },
  increment(key: string, by = 1): StateAction { return { type: "increment", key, by }; },
};

export const expr = {
  literal(value: ScalarValue): Expression { return { kind: "literal", value }; },
  get(path: string): Expression { return { kind: "get", path }; },
  op(op: Extract<Expression, { kind: "op" }>["op"], ...args: Expression[]): Expression { return { kind: "op", op, args }; },
};

export function scene(options: SceneOptions = {}): SceneBuilder { return new SceneBuilder(options); }
