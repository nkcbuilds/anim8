import type {
  NodeHandle,
  SceneBuilder,
  ShapeOptions,
  StrokeShapeOptions,
} from "@anim8/authoring";
import type { PointValue } from "@anim8/core";

export interface PresetHandle<TParts extends Record<string, unknown>> {
  /** Move/scale/fade this handle to transform the whole composed preset. */
  group: NodeHandle;
  /** Connect to this real generic shape with SceneBuilder.connect(). */
  anchor: NodeHandle;
  /** Named generic child handles for optional fine-grained animation. */
  parts: TParts;
}

export interface PresetOptions {
  id?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  color?: string;
}

export interface GridPresetOptions extends PresetOptions {
  cellWidth?: number;
  cellHeight?: number;
  gap?: number;
}

export interface PointerOptions extends Omit<PresetOptions, "x" | "y" | "width" | "height" | "fill"> {
  headLength?: number;
  headWidth?: number;
  drawProgress?: number;
}

export interface CodeBlockOptions extends PresetOptions {
  lineHeight?: number;
  padding?: number;
}

const DEFAULT_FILL = "#ffffff";
const DEFAULT_STROKE = "#1f2937";
const DEFAULT_TEXT = "#111827";

function partId(id: string | undefined, part: string): string | undefined {
  return id === undefined ? undefined : `${id}__${part}`;
}

function commonShapeOptions(
  options: PresetOptions,
  overrides: Partial<ShapeOptions> = {},
): ShapeOptions {
  return {
    ...(options.fill !== undefined ? { fill: options.fill } : {}),
    ...(options.stroke !== undefined ? { stroke: options.stroke } : {}),
    ...(options.strokeWidth !== undefined ? { strokeWidth: options.strokeWidth } : {}),
    ...(options.color !== undefined ? { color: options.color } : {}),
    ...overrides,
  };
}

function withId<T extends ShapeOptions>(options: T, id: string | undefined): T {
  return id === undefined ? options : { ...options, id };
}

function groupOptions(options: PresetOptions): { id?: string; x: number; y: number } {
  return {
    ...(options.id !== undefined ? { id: options.id } : {}),
    x: options.x ?? 0,
    y: options.y ?? 0,
  };
}

function textOptions(
  options: PresetOptions,
  id: string | undefined,
  x: number,
  y: number,
): ShapeOptions {
  return withId(
    commonShapeOptions(options, {
      x,
      y,
      fill: "none",
      stroke: "none",
      color: options.color ?? DEFAULT_TEXT,
    }),
    id,
  );
}

function finish<TParts extends Record<string, unknown>>(
  builder: SceneBuilder,
  options: PresetOptions,
  anchor: NodeHandle,
  children: NodeHandle[],
  parts: TParts,
): PresetHandle<TParts> {
  const group = builder.group(children, groupOptions(options));
  return { group, anchor, parts };
}

export function database(
  builder: SceneBuilder,
  label = "Database",
  options: PresetOptions = {},
): PresetHandle<{
  body: NodeHandle;
  top: NodeHandle;
  bottom: NodeHandle;
  label: NodeHandle;
}> {
  const x = options.x ?? 0;
  const y = options.y ?? 0;
  const width = options.width ?? 120;
  const height = options.height ?? 88;
  const rimHeight = Math.min(22, height * 0.28);
  const fill = options.fill ?? "#eef2ff";
  const stroke = options.stroke ?? DEFAULT_STROKE;

  const body = builder.box("", withId(commonShapeOptions(options, {
    x,
    y,
    width,
    height: Math.max(0, height - rimHeight),
    fill,
    stroke,
    radius: 0,
  }), partId(options.id, "body")));

  const top = builder.ellipse("", withId(commonShapeOptions(options, {
    x,
    y: y - (height - rimHeight) / 2,
    width,
    height: rimHeight,
    fill,
    stroke,
  }), partId(options.id, "top")));

  const bottom = builder.ellipse("", withId(commonShapeOptions(options, {
    x,
    y: y + (height - rimHeight) / 2,
    width,
    height: rimHeight,
    fill,
    stroke,
  }), partId(options.id, "bottom")));

  const labelHandle = builder.text(label, textOptions(
    options,
    partId(options.id, "label"),
    x,
    y,
  ));

  return finish(builder, options, body, [body, top, bottom, labelHandle], {
    body,
    top,
    bottom,
    label: labelHandle,
  });
}

export function server(
  builder: SceneBuilder,
  label = "Server",
  options: PresetOptions = {},
): PresetHandle<{
  body: NodeHandle;
  separator: NodeHandle;
  status: readonly NodeHandle[];
  label: NodeHandle;
}> {
  const x = options.x ?? 0;
  const y = options.y ?? 0;
  const width = options.width ?? 130;
  const height = options.height ?? 86;
  const fill = options.fill ?? "#f8fafc";
  const stroke = options.stroke ?? DEFAULT_STROKE;

  const body = builder.box("", withId(commonShapeOptions(options, {
    x,
    y,
    width,
    height,
    fill,
    stroke,
    radius: 10,
  }), partId(options.id, "body")));

  const separatorY = y + height * 0.18;
  const separator = builder.polyline(
    [{ x: -width * 0.38, y: 0 }, { x: width * 0.38, y: 0 }],
    withId({
      ...commonShapeOptions(options, {
        x,
        y: separatorY,
        fill: "none",
        stroke,
      }),
    } satisfies StrokeShapeOptions, partId(options.id, "separator")),
  );

  const status = [0, 1, 2].map(index =>
    builder.circle("", withId(commonShapeOptions(options, {
      x: x - width * 0.28 + index * 14,
      y: y + height * 0.31,
      width: 7,
      height: 7,
      fill: index === 0 ? "#22c55e" : "#94a3b8",
      stroke: "none",
    }), partId(options.id, `status_${index}`))),
  );

  const labelHandle = builder.text(label, textOptions(
    options,
    partId(options.id, "label"),
    x,
    y - height * 0.15,
  ));

  return finish(builder, options, body, [body, separator, ...status, labelHandle], {
    body,
    separator,
    status,
    label: labelHandle,
  });
}

export function document(
  builder: SceneBuilder,
  label = "Document",
  options: PresetOptions = {},
): PresetHandle<{
  body: NodeHandle;
  fold: NodeHandle;
  label: NodeHandle;
}> {
  const x = options.x ?? 0;
  const y = options.y ?? 0;
  const width = options.width ?? 100;
  const height = options.height ?? 124;
  const fold = Math.min(24, width * 0.28, height * 0.25);
  const fill = options.fill ?? "#ffffff";
  const stroke = options.stroke ?? DEFAULT_STROKE;

  const bodyPoints: PointValue[] = [
    { x: -width / 2, y: -height / 2 },
    { x: width / 2 - fold, y: -height / 2 },
    { x: width / 2, y: -height / 2 + fold },
    { x: width / 2, y: height / 2 },
    { x: -width / 2, y: height / 2 },
  ];

  const body = builder.polygon(bodyPoints, withId({
    ...commonShapeOptions(options, { x, y, fill, stroke }),
  } satisfies StrokeShapeOptions, partId(options.id, "body")));

  const foldHandle = builder.polyline(
    [
      { x: width / 2 - fold, y: -height / 2 },
      { x: width / 2 - fold, y: -height / 2 + fold },
      { x: width / 2, y: -height / 2 + fold },
    ],
    withId({
      ...commonShapeOptions(options, { x, y, fill: "none", stroke }),
    } satisfies StrokeShapeOptions, partId(options.id, "fold")),
  );

  const labelHandle = builder.text(label, textOptions(
    options,
    partId(options.id, "label"),
    x,
    y + 8,
  ));

  return finish(builder, options, body, [body, foldHandle, labelHandle], {
    body,
    fold: foldHandle,
    label: labelHandle,
  });
}

function grid(
  builder: SceneBuilder,
  cells: readonly (readonly string[])[],
  options: GridPresetOptions,
): PresetHandle<{
  frame: NodeHandle;
  dividers: readonly NodeHandle[];
  cells: readonly NodeHandle[];
}> {
  const rows = Math.max(1, cells.length);
  const columns = Math.max(1, ...cells.map(row => row.length));
  const cellWidth = options.cellWidth ?? (
    options.width !== undefined ? options.width / columns : 64
  );
  const cellHeight = options.cellHeight ?? (
    options.height !== undefined ? options.height / rows : 38
  );
  const width = cellWidth * columns;
  const height = cellHeight * rows;
  const x = options.x ?? 0;
  const y = options.y ?? 0;
  const fill = options.fill ?? DEFAULT_FILL;
  const stroke = options.stroke ?? DEFAULT_STROKE;

  const frame = builder.box("", withId(commonShapeOptions(options, {
    x,
    y,
    width,
    height,
    fill,
    stroke,
    radius: 0,
  }), partId(options.id, "frame")));

  const dividers: NodeHandle[] = [];
  for (let column = 1; column < columns; column += 1) {
    const dividerX = -width / 2 + cellWidth * column;
    dividers.push(builder.polyline(
      [{ x: dividerX, y: -height / 2 }, { x: dividerX, y: height / 2 }],
      withId({
        ...commonShapeOptions(options, { x, y, fill: "none", stroke }),
      } satisfies StrokeShapeOptions, partId(options.id, `column_${column}`)),
    ));
  }
  for (let row = 1; row < rows; row += 1) {
    const dividerY = -height / 2 + cellHeight * row;
    dividers.push(builder.polyline(
      [{ x: -width / 2, y: dividerY }, { x: width / 2, y: dividerY }],
      withId({
        ...commonShapeOptions(options, { x, y, fill: "none", stroke }),
      } satisfies StrokeShapeOptions, partId(options.id, `row_${row}`)),
    ));
  }

  const cellLabels: NodeHandle[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const value = cells[row]?.[column] ?? "";
      if (value === "") continue;
      cellLabels.push(builder.text(value, textOptions(
        options,
        partId(options.id, `cell_${row}_${column}`),
        x - width / 2 + cellWidth * (column + 0.5),
        y - height / 2 + cellHeight * (row + 0.5),
      )));
    }
  }

  return finish(builder, options, frame, [frame, ...dividers, ...cellLabels], {
    frame,
    dividers,
    cells: cellLabels,
  });
}

export function table(
  builder: SceneBuilder,
  cells: readonly (readonly string[])[],
  options: GridPresetOptions = {},
): PresetHandle<{
  frame: NodeHandle;
  dividers: readonly NodeHandle[];
  cells: readonly NodeHandle[];
}> {
  return grid(builder, cells, options);
}

export function array(
  builder: SceneBuilder,
  values: readonly string[],
  options: GridPresetOptions = {},
): PresetHandle<{
  frame: NodeHandle;
  dividers: readonly NodeHandle[];
  cells: readonly NodeHandle[];
}> {
  return grid(builder, [values], options);
}

export function stack(
  builder: SceneBuilder,
  values: readonly string[],
  options: GridPresetOptions = {},
): PresetHandle<{
  frame: NodeHandle;
  dividers: readonly NodeHandle[];
  cells: readonly NodeHandle[];
}> {
  return grid(builder, values.map(value => [value]), options);
}

export function queue(
  builder: SceneBuilder,
  values: readonly string[],
  options: GridPresetOptions = {},
): PresetHandle<{
  frame: NodeHandle;
  dividers: readonly NodeHandle[];
  cells: readonly NodeHandle[];
}> {
  return grid(builder, [values], options);
}

export function pointer(
  builder: SceneBuilder,
  from: PointValue,
  to: PointValue,
  options: PointerOptions = {},
): PresetHandle<{
  shaft: NodeHandle;
  head: NodeHandle;
}> {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length === 0) {
    throw new Error("Pointer endpoints must be finite and distinct.");
  }

  const headLength = options.headLength ?? Math.min(14, length * 0.28);
  const headWidth = options.headWidth ?? headLength * 0.72;
  if (!Number.isFinite(headLength) || headLength <= 0 || !Number.isFinite(headWidth) || headWidth <= 0) {
    throw new Error("Pointer headLength and headWidth must be finite numbers > 0.");
  }

  const center = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const localFrom = { x: from.x - center.x, y: from.y - center.y };
  const localTo = { x: to.x - center.x, y: to.y - center.y };
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const back = {
    x: localTo.x - ux * headLength,
    y: localTo.y - uy * headLength,
  };

  const strokeOptions: StrokeShapeOptions = {
    ...(options.stroke !== undefined ? { stroke: options.stroke } : {}),
    ...(options.strokeWidth !== undefined ? { strokeWidth: options.strokeWidth } : {}),
    fill: "none",
    x: center.x,
    y: center.y,
    ...(options.drawProgress !== undefined ? { drawProgress: options.drawProgress } : {}),
  };

  const shaft = builder.polyline(
    [localFrom, localTo],
    withId(strokeOptions, partId(options.id, "shaft")),
  );

  const head = builder.polygon(
    [
      localTo,
      { x: back.x + px * headWidth / 2, y: back.y + py * headWidth / 2 },
      { x: back.x - px * headWidth / 2, y: back.y - py * headWidth / 2 },
    ],
    withId({
      ...strokeOptions,
      fill: options.stroke ?? DEFAULT_STROKE,
      ...(options.drawProgress !== undefined ? { drawProgress: options.drawProgress } : {}),
    }, partId(options.id, "head")),
  );

  const presetOptions: PresetOptions = {
    ...(options.id !== undefined ? { id: options.id } : {}),
    x: center.x,
    y: center.y,
    ...(options.stroke !== undefined ? { stroke: options.stroke } : {}),
    ...(options.strokeWidth !== undefined ? { strokeWidth: options.strokeWidth } : {}),
    ...(options.color !== undefined ? { color: options.color } : {}),
  };

  return finish(builder, presetOptions, shaft, [shaft, head], { shaft, head });
}

export function treeNode(
  builder: SceneBuilder,
  label: string,
  options: PresetOptions = {},
): PresetHandle<{
  body: NodeHandle;
}> {
  const x = options.x ?? 0;
  const y = options.y ?? 0;
  const diameter = options.width ?? options.height ?? 58;
  const body = builder.circle(label, withId(commonShapeOptions(options, {
    x,
    y,
    width: diameter,
    height: diameter,
    fill: options.fill ?? "#ecfeff",
    stroke: options.stroke ?? DEFAULT_STROKE,
  }), partId(options.id, "body")));
  return finish(builder, options, body, [body], { body });
}

export function graphNode(
  builder: SceneBuilder,
  label: string,
  options: PresetOptions = {},
): PresetHandle<{
  body: NodeHandle;
}> {
  const x = options.x ?? 0;
  const y = options.y ?? 0;
  const width = options.width ?? 76;
  const height = options.height ?? 48;
  const body = builder.ellipse(label, withId(commonShapeOptions(options, {
    x,
    y,
    width,
    height,
    fill: options.fill ?? "#f0fdf4",
    stroke: options.stroke ?? DEFAULT_STROKE,
  }), partId(options.id, "body")));
  return finish(builder, options, body, [body], { body });
}

export function callout(
  builder: SceneBuilder,
  text: string,
  options: PresetOptions = {},
): PresetHandle<{
  body: NodeHandle;
  tail: NodeHandle;
  text: NodeHandle;
}> {
  const x = options.x ?? 0;
  const y = options.y ?? 0;
  const width = options.width ?? 170;
  const height = options.height ?? 74;
  const fill = options.fill ?? "#fffbeb";
  const stroke = options.stroke ?? DEFAULT_STROKE;
  const tailSize = Math.min(20, height * 0.3);

  const body = builder.box("", withId(commonShapeOptions(options, {
    x,
    y,
    width,
    height,
    fill,
    stroke,
    radius: 12,
  }), partId(options.id, "body")));

  const tail = builder.polygon(
    [
      { x: -tailSize * 0.45, y: 0 },
      { x: tailSize * 0.45, y: 0 },
      { x: 0, y: tailSize },
    ],
    withId({
      ...commonShapeOptions(options, {
        x: x + width * 0.23,
        y: y + height / 2 - 1,
        fill,
        stroke,
      }),
    } satisfies StrokeShapeOptions, partId(options.id, "tail")),
  );

  const textHandle = builder.text(text, textOptions(
    options,
    partId(options.id, "text"),
    x,
    y,
  ));

  return finish(builder, options, body, [body, tail, textHandle], {
    body,
    tail,
    text: textHandle,
  });
}

export function codeBlock(
  builder: SceneBuilder,
  code: string | readonly string[],
  options: CodeBlockOptions = {},
): PresetHandle<{
  body: NodeHandle;
  lines: readonly NodeHandle[];
}> {
  const lines = typeof code === "string" ? code.split(/\r?\n/) : [...code];
  const lineHeight = options.lineHeight ?? 22;
  const padding = options.padding ?? 18;
  const width = options.width ?? Math.max(180, Math.max(0, ...lines.map(line => line.length)) * 9 + padding * 2);
  const height = options.height ?? Math.max(56, lines.length * lineHeight + padding * 2);
  const x = options.x ?? 0;
  const y = options.y ?? 0;
  const fill = options.fill ?? "#0f172a";
  const stroke = options.stroke ?? "#334155";
  const color = options.color ?? "#e2e8f0";

  const body = builder.box("", withId(commonShapeOptions(options, {
    x,
    y,
    width,
    height,
    fill,
    stroke,
    color,
    radius: 10,
  }), partId(options.id, "body")));

  const lineHandles = lines.map((line, index) =>
    builder.text(line, withId(commonShapeOptions(options, {
      x,
      y: y - (lines.length - 1) * lineHeight / 2 + index * lineHeight,
      fill: "none",
      stroke: "none",
      color,
    }), partId(options.id, `line_${index}`))),
  );

  return finish(builder, options, body, [body, ...lineHandles], {
    body,
    lines: lineHandles,
  });
}
