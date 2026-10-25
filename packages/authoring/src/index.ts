import { applyMatrix, defaultCamera, defaultStyle, defaultTransform, evaluate, objectBounds, transformMatrix, type Action, type AnchorName, type Binding, type BindingProperty, type CameraState, type CameraTarget, type ConnectorObject, type DrawableObject, type EasingName, type Expression, type Marker, type PointValue, type ScalarValue, type SceneDocument, type ThemeName } from "@anim8/core";

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
  easing?: EasingName;
  path?: "linear" | "arc-up" | "arc-down";
  arcHeight?: number;
  /** Margin used when the destination is a semantic scene position. */
  margin?: number;
}

export interface FollowPathOptions {
  duration?: number;
  easing?: EasingName;
}

export interface CameraMotionOptions {
  duration?: number;
  easing?: EasingName;
}

export interface PulseOptions {
  /** Total pulse duration across expand + settle. Defaults to 360ms. */
  duration?: number;
  /** Multiplicative peak scale relative to the current scale. Defaults to 1.08. */
  scale?: number;
  easing?: EasingName;
}

export interface ShakeOptions {
  /** Total shake duration across four primitive moves. Defaults to 360ms. */
  duration?: number;
  /** Scene-coordinate offset from the current position. Defaults to 8. */
  distance?: number;
  axis?: "x" | "y";
  easing?: EasingName;
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
type Pending = WithoutSchedule<Action>;

export class NodeHandle {
  constructor(public readonly id: string, private readonly owner: SceneBuilder) {}
  moveTo(to: { x: number; y: number } | NodeHandle | SemanticPosition, options: MotionOptions = {}): Pending {
    const point = typeof to === "string"
      ? this.owner.semanticPositionOf(this.id, to, options.margin ?? 24)
      : to instanceof NodeHandle
        ? this.owner.positionOf(to.id)
        : to;
    return { type: "move", target: this.id, to: point, duration: options.duration ?? 600, easing: options.easing ?? "easeInOut", ...(options.path && options.path !== "linear" ? { path: options.path } : {}), ...(options.arcHeight !== undefined ? { arcHeight: options.arcHeight } : {}) };
  }
  followPath(points: readonly PointValue[], options: FollowPathOptions = {}): Pending {
    this.owner.assertFollowPath(points);
    return {
      type: "followPath",
      target: this.id,
      points: points.map(point => ({ ...point })),
      duration: options.duration ?? 800,
      easing: options.easing ?? "easeInOut",
    };
  }
  rotate(to: number, options: MotionOptions = {}): Pending {
    return { type: "rotate", target: this.id, to, duration: options.duration ?? 600, easing: options.easing ?? "easeInOut" };
  }
  scale(to: number | { x: number; y: number }, options: MotionOptions = {}): Pending {
    const value = typeof to === "number" ? { x: to, y: to } : to;
    return { type: "scale", target: this.id, to: value, duration: options.duration ?? 600, easing: options.easing ?? "easeInOut" };
  }
  resize(to: { width: number; height: number }, options: MotionOptions = {}): Pending {
    this.owner.assertResizable(this.id, to);
    return { type: "resize", target: this.id, to, duration: options.duration ?? 600, easing: options.easing ?? "easeInOut" };
  }
  draw(to = 1, options: MotionOptions = {}): Pending {
    this.owner.assertDrawableStroke(this.id, to);
    return { type: "draw", target: this.id, to, duration: options.duration ?? 600, easing: options.easing ?? "easeInOut" };
  }
  fadeTo(to: number, options: MotionOptions = {}): Pending {
    return { type: "opacity", target: this.id, to, duration: options.duration ?? 400, easing: options.easing ?? "easeInOut" };
  }
  highlight(color = "#fef08a", options: MotionOptions = {}): Pending {
    return { type: "fill", target: this.id, to: color, duration: options.duration ?? 300, easing: options.easing ?? "easeInOut" };
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
}

export class SceneBuilder {
  private objects: DrawableObject[] = [];
  private timeline: Action[] = [];
  private markers: Marker[] = [];
  private stateValues: Record<string, ScalarValue> = {};
  private bindings: Binding[] = [];
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

  connect(from: NodeHandle, to: NodeHandle, options: { from?: AnchorName; to?: AnchorName; kind?: ConnectorObject["kind"]; label?: string } = {}): NodeHandle {
    const id = this.next("connector");
    this.objects.push({
      id, type: "connector", from: { objectId: from.id, ...(options.from ? { anchor: options.from } : {}) }, to: { objectId: to.id, ...(options.to ? { anchor: options.to } : {}) },
      kind: options.kind ?? "straight", ...(options.label ? { label: options.label } : {}),
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

  sequence(...actions: Pending[]): void {
    for (const action of actions) {
      this.timeline.push({ ...action, id: this.next(action.type), start: this.cursor } as Action);
      this.cursor += action.duration;
    }
  }

  parallel(...actions: Pending[]): void {
    const start = this.cursor;
    let end = start;
    for (const action of actions) {
      this.timeline.push({ ...action, id: this.next(action.type), start } as Action);
      end = Math.max(end, start + action.duration);
    }
    this.cursor = end;
  }

  step(label: string, build: () => void): void {
    this.markers.push({ id: this.next("step"), label, time: this.cursor });
    build();
  }

  wait(duration: number): void { this.cursor += duration; }

  state(name: string, value: ScalarValue): void {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid state name '${name}'.`);
    this.stateValues[name] = value;
  }

  bind(target: NodeHandle, property: BindingProperty, expression: Expression): void {
    this.bindings.push({ id: this.next("binding"), target: { objectId: target.id, property }, expression });
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
      ...(this.markers.length ? { markers: structuredClone(this.markers) } : {}),
    };
  }
}

export const expr = {
  literal(value: ScalarValue): Expression { return { kind: "literal", value }; },
  get(path: string): Expression { return { kind: "get", path }; },
  op(op: Extract<Expression, { kind: "op" }>["op"], ...args: Expression[]): Expression { return { kind: "op", op, args }; },
};

export function scene(options: SceneOptions = {}): SceneBuilder { return new SceneBuilder(options); }
