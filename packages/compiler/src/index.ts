import {
  canonicalMorphPathToString,
  defaultCamera,
  defaultStyle,
  defaultTransform,
  STYLE_KEYS,
  styleIssues,
  styleProperties,
  textRunIssues,
  morphPathCompatibility,
  parseMorphPathData,
  validateScene,
  type Action,
  type AnchorName,
  type Binding,
  type BindingProperty,
  type CameraState,
  type CanonicalMorphPath,
  type Expression,
  type Interaction,
  type InteractionTrigger,
  type ScalarValue,
  type StateAction,
  type StateMachine,
  type StateMachineGuard,
  type StateMachineState,
  type StateMachineTransition,
  type Diagnostic,
  type DrawableObject,
  type Easing,
  type LinearGradient,
  type Marker,
  type PointValue,
  type SceneDocument,
  type Style,
  type Transform,
  type TextRun,
} from "@anim8/core";

export interface CompileResult {
  ok: boolean;
  scene?: SceneDocument;
  diagnostics: Diagnostic[];
}

/**
 * Hard safety/resource ceilings for untrusted compiler input.
 *
 * These are deliberately compiler-owned rather than scene-owned: an input
 * document cannot request larger limits.
 */
export const COMPILER_LIMITS = Object.freeze({
  sourceBytes: 2 * 1024 * 1024,
  objects: 5_000,
  timelineActions: 10_000,
  markers: 10_000,
  bindings: 10_000,
  interactions: 5_000,
  interactionActions: 100,
  stateMachines: 256,
  machineStates: 256,
  machineTransitions: 512,
  machineTransitionActions: 100,
  stateEntries: 1_000,
  expressionNodes: 256,
  expressionDepth: 32,
  expressionStringLength: 32 * 1024,
  idLength: 128,
  sceneDimension: 8_192,
  scenePixels: 33_554_432,
  groupChildren: 5_000,
  pointsPerObject: 10_000,
  followPathPoints: 10_000,
  connectorClearance: 512,
  connectorBendPenalty: 10_000,
  textLength: 32 * 1024,
  pathLength: 256 * 1024,
  imageUrlLength: 2_048,
  styleStringLength: 512,
  absoluteNumber: 1_000_000,
  cameraZoomMin: 0.01,
  cameraZoomMax: 100,
  actionTime: 3_600_000,
} as const);

const OBJECT_TYPES = ["rect", "circle", "ellipse", "polygon", "polyline", "text", "line", "path", "group", "connector", "image"] as const;
const ANCHORS = ["center", "top", "bottom", "left", "right"] as const;
const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const SCHEME_PATTERN = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const CONTROL_OR_SPACE = /[\u0000-\u0020\u007f]/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const boundedNumber = (value: unknown): value is number =>
  finite(value) && Math.abs(value) <= COMPILER_LIMITS.absoluteNumber;

function canonicalPathWithinBounds(path: CanonicalMorphPath): boolean {
  return path.subpaths.every(subpath =>
    boundedNumber(subpath.start.x) &&
    boundedNumber(subpath.start.y) &&
    subpath.segments.every(segment =>
      boundedNumber(segment.c1x) &&
      boundedNumber(segment.c1y) &&
      boundedNumber(segment.c2x) &&
      boundedNumber(segment.c2y) &&
      boundedNumber(segment.x) &&
      boundedNumber(segment.y)
    )
  );
}

function diagnostic(
  diagnostics: Diagnostic[],
  code: string,
  path: string,
  message: string,
  suggestion?: string,
): void {
  diagnostics.push({ code, path, message, ...(suggestion ? { suggestion } : {}) });
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics
    .map((value, index) => ({ value, index }))
    .sort((a, b) => compareText(a.value.path, b.value.path) || compareText(a.value.code, b.value.code) || a.index - b.index)
    .map(({ value }) => value);
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function parseId(value: unknown, path: string, diagnostics: Diagnostic[], code = "INVALID_ID"): string | null {
  if (typeof value !== "string" || value.length === 0) {
    diagnostic(diagnostics, code, path, "id must be a non-empty string.");
    return null;
  }
  if (value.length > COMPILER_LIMITS.idLength) {
    diagnostic(
      diagnostics,
      code,
      path,
      `id exceeds the ${COMPILER_LIMITS.idLength}-character limit.`,
      "Use a shorter stable identifier.",
    );
    return null;
  }
  if (!ID_PATTERN.test(value)) {
    diagnostic(
      diagnostics,
      code,
      path,
      "id must start with a letter or underscore and contain only letters, digits, _, ., :, or -.",
    );
    return null;
  }
  return value;
}

function parseReferenceId(value: unknown, path: string, diagnostics: Diagnostic[]): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > COMPILER_LIMITS.idLength || !ID_PATTERN.test(value)) {
    diagnostic(
      diagnostics,
      "INVALID_REFERENCE_ID",
      path,
      "Reference must be a valid non-empty object id.",
    );
    return null;
  }
  return value;
}

function parseTransform(value: unknown, path: string, diagnostics: Diagnostic[]): Transform {
  const transform = defaultTransform();
  if (value === undefined) return transform;
  if (!isRecord(value)) {
    diagnostic(diagnostics, "INVALID_TRANSFORM", path, "transform must be a JSON object.");
    return transform;
  }

  const keys = ["x", "y", "rotation", "scaleX", "scaleY", "opacity"] as const;
  for (const key of keys) {
    const candidate = value[key];
    if (candidate === undefined) continue;
    if (!boundedNumber(candidate)) {
      diagnostic(
        diagnostics,
        "INVALID_TRANSFORM_VALUE",
        `${path}.${key}`,
        `${key} must be a finite number with absolute value <= ${COMPILER_LIMITS.absoluteNumber}.`,
      );
      continue;
    }
    if (key === "opacity" && (candidate < 0 || candidate > 1)) {
      diagnostic(diagnostics, "INVALID_OPACITY", `${path}.opacity`, "opacity must be between 0 and 1.");
      continue;
    }
    transform[key] = candidate;
  }
  return transform;
}

function parseStyle(value: unknown, path: string, diagnostics: Diagnostic[], partial = false): Style {
  const style: Style = partial ? {} : defaultStyle();
  if (value === undefined) {
    if (partial) diagnostic(diagnostics, "INVALID_STYLE_TARGET", path, "style.to requires a style object.");
    return style;
  }
  if (!isRecord(value)) {
    diagnostic(diagnostics, "INVALID_STYLE", path, "style must be a JSON object.");
    return style;
  }

  const stringKeys = ["fill", "stroke", "color", "fontFamily"] as const;
  for (const key of stringKeys) {
    const candidate = value[key];
    if (candidate === undefined) continue;
    if (typeof candidate !== "string") {
      diagnostic(diagnostics, "INVALID_STYLE_VALUE", `${path}.${key}`, `${key} must be a string.`);
      continue;
    }
    if (candidate.length > COMPILER_LIMITS.styleStringLength) {
      diagnostic(
        diagnostics,
        "LIMIT_STYLE_STRING",
        `${path}.${key}`,
        `${key} exceeds the ${COMPILER_LIMITS.styleStringLength}-character limit.`,
      );
      continue;
    }
    style[key] = candidate;
  }

  const numberKeys = ["strokeWidth", "fontSize", "radius"] as const;
  for (const key of numberKeys) {
    const candidate = value[key];
    if (candidate === undefined) continue;
    if (!boundedNumber(candidate)) {
      diagnostic(
        diagnostics,
        "INVALID_STYLE_VALUE",
        `${path}.${key}`,
        `${key} must be a finite number with absolute value <= ${COMPILER_LIMITS.absoluteNumber}.`,
      );
      continue;
    }
    style[key] = candidate;
  }

  for (const key of STYLE_KEYS) {
    if (["fill", "stroke", "color", "fontFamily", "strokeWidth", "fontSize", "radius"].includes(key)) continue;
    if (value[key] !== undefined) (style as Record<string, unknown>)[key] = value[key];
  }
  const issues = styleIssues(style);
  for (const issue of issues) diagnostic(diagnostics, "INVALID_STYLE_VALUE", `${path}.${issue.property}`, issue.message);
  if (!issues.length) {
    if (style.strokeDasharray) style.strokeDasharray = [...style.strokeDasharray];
    for (const key of ["fillGradient", "strokeGradient", "colorGradient"] as const) {
      const g = style[key];
      if (g) style[key] = {
        type: "linear", ...(g.from ? { from: { x: g.from.x, y: g.from.y } } : {}), ...(g.to ? { to: { x: g.to.x, y: g.to.y } } : {}),
        stops: g.stops.map(stop => ({ offset: stop.offset, color: stop.color, ...(stop.opacity !== undefined ? { opacity: stop.opacity } : {}) })),
      } satisfies LinearGradient;
    }
  }
  if (partial) {
    if (Object.keys(style).length === 0) diagnostic(diagnostics, "INVALID_STYLE_TARGET", path, "style.to requires at least one supported style property.");
    for (const key of Object.keys(value)) if (!(STYLE_KEYS as readonly string[]).includes(key)) diagnostic(diagnostics, "INVALID_STYLE_TARGET", `${path}.${key}`, "Unsupported style property.");
  }
  return style;
}

function parsePositiveDimension(
  value: unknown,
  fallback: number,
  path: string,
  diagnostics: Diagnostic[],
): number {
  if (value === undefined) return fallback;
  if (!finite(value) || value <= 0 || value > COMPILER_LIMITS.absoluteNumber) {
    diagnostic(
      diagnostics,
      "INVALID_DIMENSION",
      path,
      `Dimension must be a finite number > 0 and <= ${COMPILER_LIMITS.absoluteNumber}.`,
    );
    return fallback;
  }
  return value;
}

function parseRequiredNonNegativeDimension(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): number | null {
  if (!finite(value) || value < 0 || value > COMPILER_LIMITS.absoluteNumber) {
    diagnostic(
      diagnostics,
      "INVALID_DIMENSION",
      path,
      `Dimension must be a finite number >= 0 and <= ${COMPILER_LIMITS.absoluteNumber}.`,
    );
    return null;
  }
  return value;
}

function parseCoordinate(value: unknown, fallback: number, path: string, diagnostics: Diagnostic[]): number {
  if (value === undefined) return fallback;
  if (!boundedNumber(value)) {
    diagnostic(
      diagnostics,
      "INVALID_COORDINATE",
      path,
      `Coordinate must be a finite number with absolute value <= ${COMPILER_LIMITS.absoluteNumber}.`,
    );
    return fallback;
  }
  return value;
}

function parseDrawProgress(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): number | undefined {
  if (value === undefined) return undefined;
  if (!finite(value) || value < 0 || value > 1) {
    diagnostic(
      diagnostics,
      "INVALID_DRAW_PROGRESS",
      path,
      "drawProgress must be a finite number between 0 and 1.",
    );
    return undefined;
  }
  return value;
}

function parsePoints(
  value: unknown,
  path: string,
  minimum: number,
  diagnostics: Diagnostic[],
): PointValue[] | null {
  if (!Array.isArray(value)) {
    diagnostic(diagnostics, "INVALID_POINTS", path, "points must be an array of {x, y} objects.");
    return null;
  }
  if (value.length > COMPILER_LIMITS.pointsPerObject) {
    diagnostic(
      diagnostics,
      "LIMIT_POINTS",
      path,
      `points exceeds the ${COMPILER_LIMITS.pointsPerObject}-entry limit.`,
    );
    return null;
  }
  if (value.length < minimum) {
    diagnostic(diagnostics, "INVALID_POINTS", path, `At least ${minimum} points are required.`);
    return null;
  }

  const points: PointValue[] = [];
  value.forEach((candidate, index) => {
    const pointPath = `${path}[${index}]`;
    if (!isRecord(candidate) || !boundedNumber(candidate.x) || !boundedNumber(candidate.y)) {
      diagnostic(
        diagnostics,
        "INVALID_POINT",
        pointPath,
        `Point coordinates must be finite numbers with absolute value <= ${COMPILER_LIMITS.absoluteNumber}.`,
      );
      return;
    }
    points.push({ x: candidate.x, y: candidate.y });
  });

  return points.length === value.length ? points : null;
}

function parseFollowPathPoints(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): PointValue[] | null {
  if (!Array.isArray(value)) {
    diagnostic(diagnostics, "INVALID_FOLLOW_PATH", path, "followPath.points must be an array of {x, y} objects.");
    return null;
  }
  if (value.length > COMPILER_LIMITS.followPathPoints) {
    diagnostic(
      diagnostics,
      "LIMIT_FOLLOW_PATH_POINTS",
      path,
      `followPath.points exceeds the ${COMPILER_LIMITS.followPathPoints}-entry limit.`,
    );
    return null;
  }
  if (value.length < 2) {
    diagnostic(diagnostics, "INVALID_FOLLOW_PATH", path, "followPath requires at least 2 explicit polyline points.");
    return null;
  }

  const points: PointValue[] = [];
  let totalLength = 0;
  value.forEach((candidate, index) => {
    const pointPath = `${path}[${index}]`;
    if (!isRecord(candidate) || !boundedNumber(candidate.x) || !boundedNumber(candidate.y)) {
      diagnostic(
        diagnostics,
        "INVALID_FOLLOW_PATH_POINT",
        pointPath,
        `followPath point coordinates must be finite numbers with absolute value <= ${COMPILER_LIMITS.absoluteNumber}.`,
      );
      return;
    }
    const point = { x: candidate.x, y: candidate.y };
    const previous = points.at(-1);
    if (previous) totalLength += Math.hypot(point.x - previous.x, point.y - previous.y);
    points.push(point);
  });

  if (points.length !== value.length) return null;
  if (totalLength === 0) {
    diagnostic(diagnostics, "INVALID_FOLLOW_PATH", path, "followPath must contain at least one non-zero-length segment.");
    return null;
  }
  return points;
}

function parseBoundedText(
  value: unknown,
  fallback: string,
  path: string,
  diagnostics: Diagnostic[],
  limit = COMPILER_LIMITS.textLength,
): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string") {
    diagnostic(diagnostics, "INVALID_TEXT", path, "Value must be a string.");
    return fallback;
  }
  if (value.length > limit) {
    diagnostic(diagnostics, "LIMIT_TEXT_LENGTH", path, `String exceeds the ${limit}-character limit.`);
    return fallback;
  }
  return value;
}

function parseOptionalText(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
  limit = COMPILER_LIMITS.textLength,
): string | undefined {
  if (value === undefined) return undefined;
  return parseBoundedText(value, "", path, diagnostics, limit);
}

function parseGroupChildren(value: unknown, index: number, diagnostics: Diagnostic[]): string[] {
  const path = `objects[${index}].children`;
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    diagnostic(diagnostics, "INVALID_GROUP_CHILDREN", path, "group.children must be an array of object ids.");
    return [];
  }
  if (value.length > COMPILER_LIMITS.groupChildren) {
    diagnostic(
      diagnostics,
      "LIMIT_GROUP_CHILDREN",
      path,
      `group.children exceeds the ${COMPILER_LIMITS.groupChildren}-entry limit.`,
    );
    return [];
  }

  const result: string[] = [];
  const seen = new Set<string>();
  value.forEach((candidate, childIndex) => {
    const childPath = `${path}[${childIndex}]`;
    const id = parseReferenceId(candidate, childPath, diagnostics);
    if (!id) return;
    if (seen.has(id)) {
      diagnostic(diagnostics, "DUPLICATE_GROUP_CHILD", childPath, `Group child '${id}' is listed more than once.`);
      return;
    }
    seen.add(id);
    result.push(id);
  });
  return result;
}

function parseAnchorRef(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): { objectId: string; anchor?: AnchorName } | null {
  if (!isRecord(value)) {
    diagnostic(diagnostics, "INVALID_CONNECTOR_ENDPOINT", path, "Connector endpoint must be an object.");
    return null;
  }

  const objectId = parseReferenceId(value.objectId, `${path}.objectId`, diagnostics);
  if (!objectId) return null;

  if (value.anchor === undefined) return { objectId };
  if (typeof value.anchor !== "string" || !ANCHORS.includes(value.anchor as AnchorName)) {
    diagnostic(
      diagnostics,
      "INVALID_CONNECTOR_ANCHOR",
      `${path}.anchor`,
      `Anchor must be one of: ${ANCHORS.join(", ")}.`,
    );
    return null;
  }
  return { objectId, anchor: value.anchor as AnchorName };
}

function normalizeHostname(hostname: string): string {
  const lower = hostname.toLowerCase().replace(/\.$/, "");
  return lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower;
}

function isUnsafeNetworkHost(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;

  // Be conservative with literal IPv6 in the compiler. A resource resolver may
  // implement a complete public-address policy later, including DNS rechecks.
  if (host.includes(":")) return true;

  const parts = host.split(".");
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some(value => value < 0 || value > 255)) return true;
  const [a, b] = octets as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/**
 * Default untrusted image URL policy:
 * - allow relative URL references (for host-resolved local assets)
 * - allow absolute HTTPS URLs only when they do not contain credentials and
 *   do not use obvious local/private/IP-literal destinations
 * - reject protocol-relative URLs and every non-HTTPS scheme (including
 *   javascript:, data:, blob:, file:, and http:)
 *
 * This is compiler-side defense in depth; any component that performs network
 * I/O must still revalidate DNS results and redirects before fetching.
 */
function parseImageHref(value: unknown, path: string, diagnostics: Diagnostic[]): string {
  if (typeof value !== "string" || value.length === 0) {
    diagnostic(diagnostics, "INVALID_IMAGE_URL", path, "image.href must be a non-empty URL string.");
    return "";
  }
  if (value.length > COMPILER_LIMITS.imageUrlLength) {
    diagnostic(
      diagnostics,
      "LIMIT_IMAGE_URL_LENGTH",
      path,
      `image.href exceeds the ${COMPILER_LIMITS.imageUrlLength}-character limit.`,
    );
    return "";
  }
  if (CONTROL_OR_SPACE.test(value) || value.includes("\\")) {
    diagnostic(diagnostics, "UNSAFE_IMAGE_URL", path, "image.href contains unsafe whitespace, control characters, or backslashes.");
    return "";
  }
  if (value.startsWith("//") || value.startsWith("#")) {
    diagnostic(diagnostics, "UNSAFE_IMAGE_URL", path, "Protocol-relative and fragment-only image URLs are not allowed.");
    return "";
  }

  const scheme = SCHEME_PATTERN.exec(value)?.[1]?.toLowerCase();
  if (!scheme) return value;
  if (scheme !== "https") {
    diagnostic(
      diagnostics,
      "UNSAFE_IMAGE_URL",
      path,
      `URL scheme '${scheme}:' is not allowed for images; use a relative URL or HTTPS.`,
    );
    return "";
  }

  try {
    const url = new URL(value);
    if (!url.hostname || url.username || url.password || isUnsafeNetworkHost(url.hostname)) {
      diagnostic(
        diagnostics,
        "UNSAFE_IMAGE_URL",
        path,
        "HTTPS image URL must use a public hostname and must not contain credentials.",
      );
      return "";
    }
  } catch {
    diagnostic(diagnostics, "INVALID_IMAGE_URL", path, "image.href is not a valid HTTPS URL.");
    return "";
  }

  return value;
}

function parseObject(value: unknown, index: number, diagnostics: Diagnostic[]): DrawableObject | null {
  const path = `objects[${index}]`;
  if (!isRecord(value)) {
    diagnostic(diagnostics, "INVALID_OBJECT", path, "Object must be a JSON object.");
    return null;
  }

  const id = parseId(value.id, `${path}.id`, diagnostics);
  if (!id) return null;

  const type = value.type;
  if (typeof type !== "string" || !OBJECT_TYPES.includes(type as typeof OBJECT_TYPES[number])) {
    diagnostic(
      diagnostics,
      "UNKNOWN_OBJECT_TYPE",
      `${path}.type`,
      `Unsupported object type '${String(type)}'.`,
      `Use one of: ${OBJECT_TYPES.join(", ")}`,
    );
    return null;
  }

  const transform = parseTransform(value.transform, `${path}.transform`, diagnostics);
  const style = parseStyle(value.style, `${path}.style`, diagnostics);
  const parentId = value.parentId === undefined
    ? undefined
    : parseReferenceId(value.parentId, `${path}.parentId`, diagnostics) ?? undefined;

  let z = index;
  if (value.z !== undefined) {
    if (boundedNumber(value.z)) z = value.z;
    else diagnostic(diagnostics, "INVALID_Z_INDEX", `${path}.z`, "z must be a bounded finite number.");
  }

  const base = {
    id,
    type,
    transform,
    style,
    visible: typeof value.visible === "boolean" ? value.visible : true,
    z,
    ...(parentId ? { parentId } : {}),
  };

  let textRuns: TextRun[] | undefined;
  if (value.textRuns !== undefined) {
    if (!["rect", "circle", "ellipse", "text"].includes(type)) diagnostic(diagnostics, "INVALID_TEXT_RUNS", `${path}.textRuns`, "Only text and labeled shapes expose textRuns.");
    const issues = textRunIssues(value.textRuns as TextRun[], typeof value.text === "string" ? value.text : "");
    for (const message of issues) diagnostic(diagnostics, "INVALID_TEXT_RUNS", `${path}.textRuns`, message);
    if (!issues.length) textRuns = (value.textRuns as TextRun[]).map(run => ({ text: run.text, ...(run.color !== undefined ? { color: run.color } : {}), ...(run.fontWeight !== undefined ? { fontWeight: run.fontWeight } : {}), ...(run.fontStyle !== undefined ? { fontStyle: run.fontStyle } : {}) }));
  }
  const labelRuns = textRuns ? { textRuns } : {};

  switch (type) {
    case "rect": {
      const text = parseOptionalText(value.text, `${path}.text`, diagnostics);
      return {
        ...base,
        type,
        ...labelRuns,
        width: parsePositiveDimension(value.width, 100, `${path}.width`, diagnostics),
        height: parsePositiveDimension(value.height, 60, `${path}.height`, diagnostics),
        ...(text !== undefined ? { text } : {}),
      };
    }
    case "circle": {
      const text = parseOptionalText(value.text, `${path}.text`, diagnostics);
      return {
        ...base,
        type,
        ...labelRuns,
        radius: parsePositiveDimension(value.radius, 30, `${path}.radius`, diagnostics),
        ...(text !== undefined ? { text } : {}),
      };
    }
    case "ellipse": {
      const rx = parseRequiredNonNegativeDimension(value.rx, `${path}.rx`, diagnostics);
      const ry = parseRequiredNonNegativeDimension(value.ry, `${path}.ry`, diagnostics);
      if (rx === null || ry === null) return null;
      const text = parseOptionalText(value.text, `${path}.text`, diagnostics);
      return {
        ...base,
        type,
        ...labelRuns,
        rx,
        ry,
        ...(text !== undefined ? { text } : {}),
      };
    }
    case "polygon":
    case "polyline": {
      const minimum = type === "polygon" ? 3 : 2;
      const points = parsePoints(value.points, `${path}.points`, minimum, diagnostics);
      if (!points) return null;
      const drawProgress = parseDrawProgress(value.drawProgress, `${path}.drawProgress`, diagnostics);
      return {
        ...base,
        type,
        points,
        ...(drawProgress !== undefined ? { drawProgress } : {}),
      };
    }
    case "text":
      return {
        ...base,
        type,
        ...labelRuns,
        text: parseBoundedText(value.text, "", `${path}.text`, diagnostics),
      };
    case "line":
      return {
        ...base,
        type,
        x2: parseCoordinate(value.x2, 100, `${path}.x2`, diagnostics),
        y2: parseCoordinate(value.y2, 0, `${path}.y2`, diagnostics),
      };
    case "path": {
      const d = parseBoundedText(value.d, "", `${path}.d`, diagnostics, COMPILER_LIMITS.pathLength);
      if (typeof value.d === "string" && value.d.length > COMPILER_LIMITS.pathLength) {
        const current = diagnostics.find(item => item.path === `${path}.d` && item.code === "LIMIT_TEXT_LENGTH");
        if (current) {
          current.code = "LIMIT_PATH_LENGTH";
          current.message = `Path data exceeds the ${COMPILER_LIMITS.pathLength}-character limit.`;
        }
      }
      const drawProgress = parseDrawProgress(value.drawProgress, `${path}.drawProgress`, diagnostics);
      return { ...base, type, d, ...(drawProgress !== undefined ? { drawProgress } : {}) };
    }
    case "group":
      return { ...base, type, children: parseGroupChildren(value.children, index, diagnostics) };
    case "connector": {
      const from = parseAnchorRef(value.from, `${path}.from`, diagnostics);
      const to = parseAnchorRef(value.to, `${path}.to`, diagnostics);
      if (!from || !to) return null;

      let kind: "straight" | "curve" | "orthogonal" | "routed" = "straight";
      if (value.kind !== undefined) {
        if (value.kind === "straight" || value.kind === "curve" || value.kind === "orthogonal" || value.kind === "routed") kind = value.kind;
        else {
          diagnostic(
            diagnostics,
            "INVALID_CONNECTOR_KIND",
            `${path}.kind`,
            "Connector kind must be straight, curve, orthogonal, or routed.",
          );
          return null;
        }
      }

      let routing: { clearance?: number; bendPenalty?: number } | undefined;
      if (value.routing !== undefined) {
        if (!isRecord(value.routing)) {
          diagnostic(diagnostics, "INVALID_CONNECTOR_ROUTING", `${path}.routing`, "connector.routing must be an object.");
          return null;
        }
        const clearance = value.routing.clearance;
        const bendPenalty = value.routing.bendPenalty;
        if (clearance !== undefined && (!finite(clearance) || clearance < 0 || clearance > COMPILER_LIMITS.connectorClearance)) {
          diagnostic(
            diagnostics,
            "INVALID_CONNECTOR_ROUTING",
            `${path}.routing.clearance`,
            `routing.clearance must be a finite number between 0 and ${COMPILER_LIMITS.connectorClearance}.`,
          );
          return null;
        }
        if (bendPenalty !== undefined && (!finite(bendPenalty) || bendPenalty < 0 || bendPenalty > COMPILER_LIMITS.connectorBendPenalty)) {
          diagnostic(
            diagnostics,
            "INVALID_CONNECTOR_ROUTING",
            `${path}.routing.bendPenalty`,
            `routing.bendPenalty must be a finite number between 0 and ${COMPILER_LIMITS.connectorBendPenalty}.`,
          );
          return null;
        }
        routing = {
          ...(clearance !== undefined ? { clearance } : {}),
          ...(bendPenalty !== undefined ? { bendPenalty } : {}),
        };
      }
      if (routing && kind !== "routed") {
        diagnostic(
          diagnostics,
          "INVALID_CONNECTOR_ROUTING",
          `${path}.routing`,
          "connector.routing is only valid when kind is routed.",
        );
        return null;
      }

      const label = parseOptionalText(value.label, `${path}.label`, diagnostics);
      return {
        ...base,
        type,
        from,
        to,
        kind,
        ...(routing ? { routing } : {}),
        ...(label !== undefined ? { label } : {}),
      };
    }
    case "image": {
      const alt = parseOptionalText(value.alt, `${path}.alt`, diagnostics);
      return {
        ...base,
        type,
        width: parsePositiveDimension(value.width, 100, `${path}.width`, diagnostics),
        height: parsePositiveDimension(value.height, 100, `${path}.height`, diagnostics),
        href: parseImageHref(value.href, `${path}.href`, diagnostics),
        ...(alt !== undefined ? { alt } : {}),
      };
    }
  }

  return null;
}


const BINDING_PROPERTIES = ["x","y","rotation","scaleX","scaleY","opacity","fill","stroke","color","strokeDashoffset","text"] as const;
const EXPRESSION_OPS = ["add","sub","mul","div","min","max","clamp","lerp","eq","lt","gt","and","or","not"] as const;

function parseScalar(value: unknown, path: string, diagnostics: Diagnostic[]): ScalarValue | null {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (Number.isFinite(value) && Math.abs(value) <= COMPILER_LIMITS.absoluteNumber) return value;
    diagnostic(diagnostics, "INVALID_STATE_VALUE", path, "State number must be finite and bounded.");
    return null;
  }
  if (typeof value === "string") {
    if (value.length <= COMPILER_LIMITS.expressionStringLength) return value;
    diagnostic(diagnostics, "LIMIT_STATE_STRING", path, `State string exceeds ${COMPILER_LIMITS.expressionStringLength} characters.`);
    return null;
  }
  diagnostic(diagnostics, "INVALID_STATE_VALUE", path, "State values must be string, number, boolean, or null.");
  return null;
}

function parseState(value: unknown, diagnostics: Diagnostic[]): Record<string, ScalarValue> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    diagnostic(diagnostics, "INVALID_STATE", "state", "state must be an object of scalar values.");
    return undefined;
  }
  const entries = Object.entries(value);
  if (entries.length > COMPILER_LIMITS.stateEntries) {
    diagnostic(diagnostics, "LIMIT_STATE_ENTRIES", "state", `state exceeds ${COMPILER_LIMITS.stateEntries} entries.`);
    return undefined;
  }
  const out: Record<string, ScalarValue> = {};
  for (const [key, candidate] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || key.length > COMPILER_LIMITS.idLength) {
      diagnostic(diagnostics, "INVALID_STATE_KEY", `state.${key}`, "State keys must start with a letter or underscore and contain only letters, digits, or underscores.");
      continue;
    }
    const parsed = parseScalar(candidate, `state.${key}`, diagnostics);
    if (parsed !== null || candidate === null) out[key] = parsed;
  }
  return out;
}

function parseStateAction(
  value: unknown,
  path: string,
  declaredState: Record<string, ScalarValue>,
  diagnostics: Diagnostic[],
): StateAction | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    diagnostic(diagnostics, "INVALID_STATE_ACTION", path, "State action must be an object with a type.");
    return null;
  }

  const key = value.key;
  if (typeof key !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || key.length > COMPILER_LIMITS.idLength) {
    diagnostic(diagnostics, "INVALID_STATE_KEY", `${path}.key`, "State action key must be a valid declared state identifier.");
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(declaredState, key)) {
    diagnostic(diagnostics, "UNKNOWN_STATE_KEY", `${path}.key`, `State key '${key}' is not declared in scene.state.`);
    return null;
  }

  if (value.type === "set") {
    const parsed = parseScalar(value.value, `${path}.value`, diagnostics);
    if (parsed === null && value.value !== null) return null;
    return { type: "set", key, value: parsed };
  }

  if (value.type === "toggle") {
    if (typeof declaredState[key] !== "boolean") {
      diagnostic(diagnostics, "INVALID_STATE_ACTION_TYPE", `${path}.key`, `toggle requires boolean state; '${key}' is not boolean.`);
      return null;
    }
    return { type: "toggle", key };
  }

  if (value.type === "increment") {
    if (typeof declaredState[key] !== "number") {
      diagnostic(diagnostics, "INVALID_STATE_ACTION_TYPE", `${path}.key`, `increment requires numeric state; '${key}' is not numeric.`);
      return null;
    }
    if (!boundedNumber(value.by)) {
      diagnostic(
        diagnostics,
        "INVALID_STATE_INCREMENT",
        `${path}.by`,
        `increment.by must be a finite number with absolute value <= ${COMPILER_LIMITS.absoluteNumber}.`,
      );
      return null;
    }
    return { type: "increment", key, by: value.by };
  }

  diagnostic(
    diagnostics,
    "INVALID_STATE_ACTION",
    `${path}.type`,
    `Unsupported state action '${String(value.type)}'; use set, toggle, or increment.`,
  );
  return null;
}

function parseInteraction(
  value: unknown,
  index: number,
  declaredState: Record<string, ScalarValue>,
  objects: ReadonlyMap<string, DrawableObject>,
  diagnostics: Diagnostic[],
): Interaction | null {
  const path = `interactions[${index}]`;
  if (!isRecord(value)) {
    diagnostic(diagnostics, "INVALID_INTERACTION", path, "Interaction must be a JSON object.");
    return null;
  }

  const id = parseId(value.id, `${path}.id`, diagnostics, "INVALID_INTERACTION_ID");
  if (!isRecord(value.event) || typeof value.event.type !== "string") {
    diagnostic(diagnostics, "INVALID_INTERACTION_EVENT", `${path}.event`, "Interaction event must be an object with a type.");
    return null;
  }

  let event: InteractionTrigger | null = null;
  if (value.event.type === "custom") {
    const name = parseId(value.event.name, `${path}.event.name`, diagnostics, "INVALID_INTERACTION_EVENT");
    if (name === "click" || name === "focus" || name === "hover") {
      diagnostic(
        diagnostics,
        "RESERVED_INTERACTION_EVENT",
        `${path}.event.name`,
        "Custom event names must not use the reserved click, focus, or hover names.",
      );
    } else if (name) {
      event = { type: "custom", name };
    }
  } else if (value.event.type === "click" || value.event.type === "focus" || value.event.type === "hover") {
    const target = parseReferenceId(value.event.target, `${path}.event.target`, diagnostics);
    if (target && !objects.has(target)) {
      diagnostic(diagnostics, "UNKNOWN_INTERACTION_TARGET", `${path}.event.target`, `Object '${target}' does not exist.`);
    } else if (target) {
      event = { type: value.event.type, target };
    }
  } else {
    diagnostic(
      diagnostics,
      "INVALID_INTERACTION_EVENT",
      `${path}.event.type`,
      "Interaction event type must be click, focus, hover, or custom.",
    );
  }

  if (!Array.isArray(value.actions)) {
    diagnostic(diagnostics, "INVALID_INTERACTION_ACTIONS", `${path}.actions`, "Interaction actions must be an array.");
    return null;
  }
  if (value.actions.length === 0) {
    diagnostic(diagnostics, "EMPTY_INTERACTION", `${path}.actions`, "Interaction must contain at least one state action.");
    return null;
  }
  if (value.actions.length > COMPILER_LIMITS.interactionActions) {
    diagnostic(
      diagnostics,
      "LIMIT_INTERACTION_ACTIONS",
      `${path}.actions`,
      `Interaction exceeds the ${COMPILER_LIMITS.interactionActions}-action limit.`,
    );
    return null;
  }

  const actions = value.actions
    .map((action, actionIndex) => parseStateAction(action, `${path}.actions[${actionIndex}]`, declaredState, diagnostics))
    .filter((action): action is StateAction => action !== null);

  if (!id || !event || actions.length !== value.actions.length) return null;
  return { id, event, actions };
}

function validateInteractionIds(interactions: Interaction[], diagnostics: Diagnostic[]): void {
  const ids = new Set<string>();
  interactions.forEach((interaction, index) => {
    if (ids.has(interaction.id)) {
      diagnostic(
        diagnostics,
        "DUPLICATE_INTERACTION_ID",
        `interactions[${index}].id`,
        `Interaction '${interaction.id}' is duplicated.`,
      );
    }
    ids.add(interaction.id);
  });
}

function parseStateMachineEvent(
  value: unknown,
  path: string,
  objects: ReadonlyMap<string, DrawableObject>,
  diagnostics: Diagnostic[],
): InteractionTrigger | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    diagnostic(diagnostics, "INVALID_STATE_MACHINE_EVENT", path, "State-machine event must be an object with a type.");
    return null;
  }

  if (value.type === "custom") {
    const name = parseId(value.name, `${path}.name`, diagnostics, "INVALID_STATE_MACHINE_EVENT");
    if (name === "click" || name === "focus" || name === "hover") {
      diagnostic(
        diagnostics,
        "RESERVED_STATE_MACHINE_EVENT",
        `${path}.name`,
        "Custom event names must not use the reserved click, focus, or hover names.",
      );
      return null;
    }
    return name ? { type: "custom", name } : null;
  }

  if (value.type === "click" || value.type === "focus" || value.type === "hover") {
    const target = parseReferenceId(value.target, `${path}.target`, diagnostics);
    if (target && !objects.has(target)) {
      diagnostic(diagnostics, "UNKNOWN_STATE_MACHINE_TARGET", `${path}.target`, `Object '${target}' does not exist.`);
      return null;
    }
    return target ? { type: value.type, target } : null;
  }

  diagnostic(
    diagnostics,
    "INVALID_STATE_MACHINE_EVENT",
    `${path}.type`,
    "State-machine event type must be click, focus, hover, or custom.",
  );
  return null;
}

function parseStateMachineGuard(
  value: unknown,
  path: string,
  declaredState: Record<string, ScalarValue>,
  diagnostics: Diagnostic[],
): StateMachineGuard | null {
  if (!isRecord(value)) {
    diagnostic(diagnostics, "INVALID_STATE_MACHINE_GUARD", path, "State-machine guard must be an object.");
    return null;
  }

  const key = value.key;
  if (typeof key !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || key.length > COMPILER_LIMITS.idLength) {
    diagnostic(diagnostics, "INVALID_STATE_KEY", `${path}.key`, "Guard key must be a valid declared state identifier.");
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(declaredState, key)) {
    diagnostic(diagnostics, "UNKNOWN_STATE_KEY", `${path}.key`, `State key '${key}' is not declared in scene.state.`);
    return null;
  }

  const equals = parseScalar(value.equals, `${path}.equals`, diagnostics);
  if (equals === null && value.equals !== null) return null;
  return { key, equals };
}

function parseStateMachineTransition(
  value: unknown,
  path: string,
  declaredState: Record<string, ScalarValue>,
  objects: ReadonlyMap<string, DrawableObject>,
  diagnostics: Diagnostic[],
): StateMachineTransition | null {
  if (!isRecord(value)) {
    diagnostic(diagnostics, "INVALID_STATE_MACHINE_TRANSITION", path, "State-machine transition must be an object.");
    return null;
  }

  const id = parseId(value.id, `${path}.id`, diagnostics, "INVALID_STATE_MACHINE_TRANSITION_ID");
  const event = parseStateMachineEvent(value.event, `${path}.event`, objects, diagnostics);
  const target = parseId(value.target, `${path}.target`, diagnostics, "INVALID_STATE_MACHINE_STATE_ID");

  let guard: StateMachineGuard | undefined;
  if (value.guard !== undefined) {
    const parsed = parseStateMachineGuard(value.guard, `${path}.guard`, declaredState, diagnostics);
    if (!parsed) return null;
    guard = parsed;
  }

  let actions: StateAction[] | undefined;
  if (value.actions !== undefined) {
    if (!Array.isArray(value.actions)) {
      diagnostic(diagnostics, "INVALID_STATE_MACHINE_ACTIONS", `${path}.actions`, "Transition actions must be an array.");
      return null;
    }
    if (value.actions.length > COMPILER_LIMITS.machineTransitionActions) {
      diagnostic(
        diagnostics,
        "LIMIT_STATE_MACHINE_ACTIONS",
        `${path}.actions`,
        `Transition exceeds the ${COMPILER_LIMITS.machineTransitionActions}-action limit.`,
      );
      return null;
    }
    const parsed = value.actions
      .map((action, index) => parseStateAction(action, `${path}.actions[${index}]`, declaredState, diagnostics))
      .filter((action): action is StateAction => action !== null);
    if (parsed.length !== value.actions.length) return null;
    actions = parsed;
  }

  if (!id || !event || !target) return null;
  return {
    id,
    event,
    target,
    ...(guard ? { guard } : {}),
    ...(actions ? { actions } : {}),
  };
}

function parseStateMachineState(
  value: unknown,
  path: string,
  declaredState: Record<string, ScalarValue>,
  objects: ReadonlyMap<string, DrawableObject>,
  diagnostics: Diagnostic[],
): StateMachineState | null {
  if (!isRecord(value)) {
    diagnostic(diagnostics, "INVALID_STATE_MACHINE_STATE", path, "State-machine state must be an object.");
    return null;
  }

  const id = parseId(value.id, `${path}.id`, diagnostics, "INVALID_STATE_MACHINE_STATE_ID");
  if (!Array.isArray(value.transitions)) {
    diagnostic(diagnostics, "INVALID_STATE_MACHINE_TRANSITIONS", `${path}.transitions`, "State transitions must be an array.");
    return null;
  }
  if (value.transitions.length > COMPILER_LIMITS.machineTransitions) {
    diagnostic(
      diagnostics,
      "LIMIT_STATE_MACHINE_TRANSITIONS",
      `${path}.transitions`,
      `State exceeds the ${COMPILER_LIMITS.machineTransitions}-transition limit.`,
    );
    return null;
  }

  const transitions = value.transitions
    .map((transition, index) =>
      parseStateMachineTransition(transition, `${path}.transitions[${index}]`, declaredState, objects, diagnostics)
    )
    .filter((transition): transition is StateMachineTransition => transition !== null);

  if (!id || transitions.length !== value.transitions.length) return null;
  return { id, transitions };
}

function parseStateMachine(
  value: unknown,
  index: number,
  declaredState: Record<string, ScalarValue>,
  objects: ReadonlyMap<string, DrawableObject>,
  diagnostics: Diagnostic[],
): StateMachine | null {
  const path = `stateMachines[${index}]`;
  if (!isRecord(value)) {
    diagnostic(diagnostics, "INVALID_STATE_MACHINE", path, "State machine must be an object.");
    return null;
  }

  const id = parseId(value.id, `${path}.id`, diagnostics, "INVALID_STATE_MACHINE_ID");
  const initial = parseId(value.initial, `${path}.initial`, diagnostics, "INVALID_STATE_MACHINE_STATE_ID");
  if (!Array.isArray(value.states) || value.states.length === 0) {
    diagnostic(diagnostics, "INVALID_STATE_MACHINE_STATES", `${path}.states`, "State machine must contain at least one state.");
    return null;
  }
  if (value.states.length > COMPILER_LIMITS.machineStates) {
    diagnostic(
      diagnostics,
      "LIMIT_STATE_MACHINE_STATES",
      `${path}.states`,
      `State machine exceeds the ${COMPILER_LIMITS.machineStates}-state limit.`,
    );
    return null;
  }

  const rawStateIds = new Set(
    value.states.flatMap(state =>
      isRecord(state) && typeof state.id === "string" && /^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(state.id)
        ? [state.id]
        : []
    ),
  );

  if (initial && !rawStateIds.has(initial)) {
    diagnostic(
      diagnostics,
      "UNKNOWN_STATE_MACHINE_INITIAL",
      `${path}.initial`,
      `Initial state '${initial}' does not exist in machine '${id ?? "<invalid>"}'.`,
    );
  }

  value.states.forEach((rawState, stateIndex) => {
    if (!isRecord(rawState) || !Array.isArray(rawState.transitions)) return;
    rawState.transitions.forEach((rawTransition, transitionIndex) => {
      if (!isRecord(rawTransition) || typeof rawTransition.target !== "string") return;
      if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(rawTransition.target)) return;
      if (rawStateIds.has(rawTransition.target)) return;
      diagnostic(
        diagnostics,
        "UNKNOWN_STATE_MACHINE_STATE",
        `${path}.states[${stateIndex}].transitions[${transitionIndex}].target`,
        `Target state '${rawTransition.target}' does not exist in machine '${id ?? "<invalid>"}'.`,
      );
    });
  });

  const states = value.states
    .map((state, stateIndex) =>
      parseStateMachineState(state, `${path}.states[${stateIndex}]`, declaredState, objects, diagnostics)
    )
    .filter((state): state is StateMachineState => state !== null);

  if (!id || !initial || states.length !== value.states.length) return null;

  const stateIds = new Set<string>();
  const transitionIds = new Set<string>();
  states.forEach((state, stateIndex) => {
    if (stateIds.has(state.id)) {
      diagnostic(
        diagnostics,
        "DUPLICATE_STATE_MACHINE_STATE_ID",
        `${path}.states[${stateIndex}].id`,
        `State '${state.id}' is duplicated in machine '${id}'.`,
      );
    }
    stateIds.add(state.id);

    state.transitions.forEach((transition, transitionIndex) => {
      if (transitionIds.has(transition.id)) {
        diagnostic(
          diagnostics,
          "DUPLICATE_STATE_MACHINE_TRANSITION_ID",
          `${path}.states[${stateIndex}].transitions[${transitionIndex}].id`,
          `Transition '${transition.id}' is duplicated in machine '${id}'.`,
        );
      }
      transitionIds.add(transition.id);
    });
  });

  return { id, initial, states };
}

function validateStateMachineIds(stateMachines: StateMachine[], diagnostics: Diagnostic[]): void {
  const ids = new Set<string>();
  stateMachines.forEach((machine, index) => {
    if (ids.has(machine.id)) {
      diagnostic(
        diagnostics,
        "DUPLICATE_STATE_MACHINE_ID",
        `stateMachines[${index}].id`,
        `State machine '${machine.id}' is duplicated.`,
      );
    }
    ids.add(machine.id);
  });
}

function parseExpression(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
  budget: { nodes: number },
  depth = 0,
): Expression | null {
  budget.nodes += 1;
  if (budget.nodes > COMPILER_LIMITS.expressionNodes) {
    diagnostic(diagnostics, "LIMIT_EXPRESSION_NODES", path, `Expression exceeds ${COMPILER_LIMITS.expressionNodes} nodes.`);
    return null;
  }
  if (depth > COMPILER_LIMITS.expressionDepth) {
    diagnostic(diagnostics, "LIMIT_EXPRESSION_DEPTH", path, `Expression exceeds depth ${COMPILER_LIMITS.expressionDepth}.`);
    return null;
  }
  if (!isRecord(value) || typeof value.kind !== "string") {
    diagnostic(diagnostics, "INVALID_EXPRESSION", path, "Expression must be an object with a kind discriminator.");
    return null;
  }

  if (value.kind === "literal") {
    const parsed = parseScalar(value.value, `${path}.value`, diagnostics);
    if (parsed === null && value.value !== null) return null;
    return { kind: "literal", value: parsed };
  }

  if (value.kind === "get") {
    if (typeof value.path !== "string" || !/^(time|progress|inputs\.[A-Za-z_][A-Za-z0-9_]*|state\.[A-Za-z_][A-Za-z0-9_]*)$/.test(value.path)) {
      diagnostic(diagnostics, "INVALID_EXPRESSION_PATH", `${path}.path`, "get.path must be time, progress, inputs.<id>, or state.<id>.");
      return null;
    }
    return { kind: "get", path: value.path };
  }

  if (value.kind === "op") {
    if (typeof value.op !== "string" || !EXPRESSION_OPS.includes(value.op as typeof EXPRESSION_OPS[number])) {
      diagnostic(diagnostics, "INVALID_EXPRESSION_OP", `${path}.op`, `Unsupported expression op '${String(value.op)}'.`);
      return null;
    }
    if (!Array.isArray(value.args)) {
      diagnostic(diagnostics, "INVALID_EXPRESSION_ARGS", `${path}.args`, "op.args must be an array.");
      return null;
    }
    const args: Expression[] = [];
    value.args.forEach((arg, index) => {
      const parsed = parseExpression(arg, `${path}.args[${index}]`, diagnostics, budget, depth + 1);
      if (parsed) args.push(parsed);
    });
    if (args.length !== value.args.length) return null;
    return { kind: "op", op: value.op as (typeof EXPRESSION_OPS)[number], args };
  }

  diagnostic(diagnostics, "INVALID_EXPRESSION_KIND", `${path}.kind`, "Expression kind must be literal, get, or op.");
  return null;
}

function parseBinding(value: unknown, index: number, diagnostics: Diagnostic[]): Binding | null {
  const path = `bindings[${index}]`;
  if (!isRecord(value)) {
    diagnostic(diagnostics, "INVALID_BINDING", path, "Binding must be an object.");
    return null;
  }
  const id = parseId(value.id, `${path}.id`, diagnostics, "INVALID_BINDING_ID");
  if (!isRecord(value.target)) {
    diagnostic(diagnostics, "INVALID_BINDING_TARGET", `${path}.target`, "Binding target must be an object.");
    return null;
  }
  const objectId = parseReferenceId(value.target.objectId, `${path}.target.objectId`, diagnostics);
  const property = value.target.property;
  if (typeof property !== "string" || !BINDING_PROPERTIES.includes(property as BindingProperty)) {
    diagnostic(diagnostics, "INVALID_BINDING_PROPERTY", `${path}.target.property`, `Binding property must be one of: ${BINDING_PROPERTIES.join(", ")}.`);
    return null;
  }
  const expression = parseExpression(value.expression, `${path}.expression`, diagnostics, { nodes: 0 });
  if (!id || !objectId || !expression) return null;
  return { id, target: { objectId, property: property as BindingProperty }, expression };
}

type ActionProperty = BindingProperty | "width" | "height" | "drawProgress" | "parentId" | "z";

function actionProperties(action: Action): readonly ActionProperty[] {
  switch (action.type) {
    case "move": return ["x", "y"];
    case "followPath": return ["x", "y"];
    case "rotate": return ["rotation"];
    case "scale": return ["scaleX", "scaleY"];
    case "opacity": return ["opacity"];
    case "fill": return ["fill"];
    case "stroke": return ["stroke"];
    case "style": return styleProperties(action.to) as ActionProperty[];
    case "text": return ["text"];
    case "resize": return ["width", "height"];
    case "draw": return ["drawProgress"];
    case "reparent": return ["parentId"];
    case "zOrder": return ["z"];
    case "morph":
    case "visibility":
    case "camera":
      return [];
  }
}

function validateBindings(
  bindings: Binding[],
  timeline: Action[],
  objects: ReadonlyMap<string, DrawableObject>,
  diagnostics: Diagnostic[],
): void {
  const ids = new Set<string>();
  bindings.forEach((binding, index) => {
    if (ids.has(binding.id)) diagnostic(diagnostics, "DUPLICATE_BINDING_ID", `bindings[${index}].id`, `Binding '${binding.id}' is duplicated.`);
    ids.add(binding.id);
    const target = objects.get(binding.target.objectId);
    if (!target) {
      diagnostic(diagnostics, "UNKNOWN_BINDING_OBJECT", `bindings[${index}].target.objectId`, `Object '${binding.target.objectId}' does not exist.`);
      return;
    }
    if (binding.target.property === "text" && target.type !== "text" && target.type !== "rect" && target.type !== "circle" && target.type !== "ellipse") {
      diagnostic(diagnostics, "INVALID_BINDING_PROPERTY", `bindings[${index}].target.property`, `Object type '${target.type}' does not expose text.`);
    }
    for (const action of timeline) {
      if (action.type !== "camera" && action.target === binding.target.objectId && actionProperties(action).includes(binding.target.property)) {
        diagnostic(
          diagnostics,
          "BINDING_ACTION_CONFLICT",
          `bindings[${index}].target.property`,
          `Binding '${binding.id}' and action '${action.id}' both write '${binding.target.property}' on '${binding.target.objectId}'.`,
          "Choose either the binding or the timeline action for this property.",
        );
      }
    }
  });
}

function parseAction(value: unknown, index: number, diagnostics: Diagnostic[]): Action | null {
  const path = `timeline[${index}]`;
  if (!isRecord(value)) {
    diagnostic(diagnostics, "INVALID_ACTION", path, "Action must be a JSON object.");
    return null;
  }

  const id = parseId(value.id, `${path}.id`, diagnostics, "INVALID_ACTION_ID");
  if (!id || typeof value.type !== "string") {
    if (typeof value.type !== "string") {
      diagnostic(diagnostics, "INVALID_ACTION", `${path}.type`, "Action type must be a string.");
    }
    return null;
  }

  if (!finite(value.start) || value.start < 0 || value.start > COMPILER_LIMITS.actionTime) {
    diagnostic(
      diagnostics,
      "INVALID_TIME",
      `${path}.start`,
      `start must be a finite number between 0 and ${COMPILER_LIMITS.actionTime}.`,
    );
    return null;
  }
  if (!finite(value.duration) || value.duration < 0 || value.duration > COMPILER_LIMITS.actionTime) {
    diagnostic(
      diagnostics,
      "INVALID_DURATION",
      `${path}.duration`,
      `duration must be a finite number between 0 and ${COMPILER_LIMITS.actionTime}.`,
    );
    return null;
  }

  let easing: Easing = "linear";
  if (value.easing !== undefined) {
    if (value.easing === "linear" || value.easing === "easeIn" || value.easing === "easeOut" || value.easing === "easeInOut" || value.easing === "spring") {
      easing = value.easing;
    } else if (isRecord(value.easing) && value.easing.type === "cubicBezier") {
      const { x1, y1, x2, y2 } = value.easing;
      if (
        !finite(x1) || x1 < 0 || x1 > 1 ||
        !finite(x2) || x2 < 0 || x2 > 1 ||
        !finite(y1) || Math.abs(y1) > 10 ||
        !finite(y2) || Math.abs(y2) > 10
      ) {
        diagnostic(
          diagnostics,
          "INVALID_EASING",
          `${path}.easing`,
          "cubicBezier requires finite x1/x2 in [0, 1] and finite y1/y2 with absolute value <= 10.",
        );
        return null;
      }
      easing = { type: "cubicBezier", x1, y1, x2, y2 };
    } else {
      diagnostic(
        diagnostics,
        "INVALID_EASING",
        `${path}.easing`,
        "Easing must be linear, easeIn, easeOut, easeInOut, spring, or a cubicBezier object.",
      );
      return null;
    }
  }

  if (value.interrupt !== undefined && typeof value.interrupt !== "boolean") {
    diagnostic(diagnostics, "INVALID_INTERRUPT", `${path}.interrupt`, "interrupt must be a boolean.");
    return null;
  }

  const base = {
    id,
    start: value.start,
    duration: value.duration,
    easing,
    ...(value.interrupt === true ? { interrupt: true } : {}),
  };

  if (value.type === "camera") {
    if (value.target !== undefined) {
      diagnostic(diagnostics, "INVALID_CAMERA_ACTION", `${path}.target`, "camera actions are scene-level and must not declare an object target.");
      return null;
    }
    if (!isRecord(value.to)) {
      diagnostic(diagnostics, "INVALID_CAMERA_TARGET", `${path}.to`, "camera.to must be an object containing x, y, and/or zoom.");
      return null;
    }

    const to: { x?: number; y?: number; zoom?: number } = {};
    if (value.to.x !== undefined) {
      if (!boundedNumber(value.to.x)) {
        diagnostic(
          diagnostics,
          "INVALID_CAMERA_TARGET",
          `${path}.to.x`,
          `camera.to.x must be a finite number with absolute value <= ${COMPILER_LIMITS.absoluteNumber}.`,
        );
        return null;
      }
      to.x = value.to.x;
    }
    if (value.to.y !== undefined) {
      if (!boundedNumber(value.to.y)) {
        diagnostic(
          diagnostics,
          "INVALID_CAMERA_TARGET",
          `${path}.to.y`,
          `camera.to.y must be a finite number with absolute value <= ${COMPILER_LIMITS.absoluteNumber}.`,
        );
        return null;
      }
      to.y = value.to.y;
    }
    if (value.to.zoom !== undefined) {
      if (!finite(value.to.zoom) || value.to.zoom < COMPILER_LIMITS.cameraZoomMin || value.to.zoom > COMPILER_LIMITS.cameraZoomMax) {
        diagnostic(
          diagnostics,
          "LIMIT_CAMERA_ZOOM",
          `${path}.to.zoom`,
          `camera.to.zoom must be between ${COMPILER_LIMITS.cameraZoomMin} and ${COMPILER_LIMITS.cameraZoomMax}.`,
        );
        return null;
      }
      to.zoom = value.to.zoom;
    }
    if (Object.keys(to).length === 0) {
      diagnostic(diagnostics, "INVALID_CAMERA_TARGET", `${path}.to`, "camera.to must set at least one of x, y, or zoom.");
      return null;
    }
    return { ...base, type: "camera", to };
  }

  const target = parseReferenceId(value.target, `${path}.target`, diagnostics);
  if (!target) return null;
  const objectBase = { ...base, target };

  switch (value.type) {
    case "text": {
      if (typeof value.to !== "string" || value.to.length > COMPILER_LIMITS.textLength) {
        diagnostic(diagnostics, "INVALID_TEXT_TARGET", `${path}.to`, "text.to requires a bounded string."); return null;
      }
      if (value.textRuns !== undefined) {
        const issues = textRunIssues(value.textRuns as TextRun[], value.to);
        for (const message of issues) diagnostic(diagnostics, "INVALID_TEXT_RUNS", `${path}.textRuns`, message);
        if (issues.length) return null;
      }
      return { ...objectBase, type: "text", to: value.to, ...(value.textRuns !== undefined ? { textRuns: (value.textRuns as TextRun[]).map(run => ({ text: run.text, ...(run.color !== undefined ? { color: run.color } : {}), ...(run.fontWeight !== undefined ? { fontWeight: run.fontWeight } : {}), ...(run.fontStyle !== undefined ? { fontStyle: run.fontStyle } : {}) })) } : {}) };
    }
    case "style":
      return { ...objectBase, type: "style", to: parseStyle(value.to, `${path}.to`, diagnostics, true) };
    case "move": {
      const to = isRecord(value.to) && boundedNumber(value.to.x) && boundedNumber(value.to.y)
        ? { x: value.to.x, y: value.to.y }
        : null;
      if (!to) {
        diagnostic(diagnostics, "INVALID_MOVE_TARGET", `${path}.to`, "move.to requires bounded finite x and y.");
        return null;
      }
      if (value.path !== undefined && value.path !== "linear" && value.path !== "arc-up" && value.path !== "arc-down") {
        diagnostic(diagnostics, "INVALID_MOVE_PATH", `${path}.path`, "move.path must be linear, arc-up, or arc-down.");
        return null;
      }
      if (value.arcHeight !== undefined && !boundedNumber(value.arcHeight)) {
        diagnostic(diagnostics, "INVALID_ARC_HEIGHT", `${path}.arcHeight`, "arcHeight must be a bounded finite number.");
        return null;
      }
      return {
        ...objectBase,
        type: "move",
        to,
        ...(value.path === "arc-up" || value.path === "arc-down" ? { path: value.path } : {}),
        ...(finite(value.arcHeight) ? { arcHeight: value.arcHeight } : {}),
      };
    }
    case "followPath": {
      const points = parseFollowPathPoints(value.points, `${path}.points`, diagnostics);
      return points ? { ...objectBase, type: "followPath", points } : null;
    }
    case "rotate":
      if (boundedNumber(value.to)) return { ...objectBase, type: "rotate", to: value.to };
      diagnostic(diagnostics, "INVALID_ROTATE_TARGET", `${path}.to`, "rotate.to must be a bounded finite number.");
      return null;
    case "scale": {
      const to = isRecord(value.to) && boundedNumber(value.to.x) && boundedNumber(value.to.y)
        ? { x: value.to.x, y: value.to.y }
        : null;
      if (to) return { ...objectBase, type: "scale", to };
      diagnostic(diagnostics, "INVALID_SCALE_TARGET", `${path}.to`, "scale.to requires bounded finite x and y.");
      return null;
    }
    case "opacity":
      if (finite(value.to) && value.to >= 0 && value.to <= 1) return { ...objectBase, type: "opacity", to: value.to };
      diagnostic(diagnostics, "INVALID_OPACITY_TARGET", `${path}.to`, "opacity.to must be between 0 and 1.");
      return null;
    case "fill":
      if (typeof value.to === "string" && value.to.length <= COMPILER_LIMITS.styleStringLength) {
        return { ...objectBase, type: "fill", to: value.to };
      }
      diagnostic(diagnostics, "INVALID_FILL_TARGET", `${path}.to`, "fill.to must be a bounded string.");
      return null;
    case "stroke":
      if (typeof value.to === "string" && value.to.length <= COMPILER_LIMITS.styleStringLength) {
        return { ...objectBase, type: "stroke", to: value.to };
      }
      diagnostic(diagnostics, "INVALID_STROKE_TARGET", `${path}.to`, "stroke.to must be a bounded string.");
      return null;
    case "resize": {
      const to = isRecord(value.to) &&
        finite(value.to.width) && value.to.width >= 0 && value.to.width <= COMPILER_LIMITS.absoluteNumber &&
        finite(value.to.height) && value.to.height >= 0 && value.to.height <= COMPILER_LIMITS.absoluteNumber
        ? { width: value.to.width, height: value.to.height }
        : null;
      if (to) return { ...objectBase, type: "resize", to };
      diagnostic(
        diagnostics,
        "INVALID_RESIZE_TARGET",
        `${path}.to`,
        `resize.to requires finite width and height between 0 and ${COMPILER_LIMITS.absoluteNumber}.`,
      );
      return null;
    }
    case "draw":
      if (finite(value.to) && value.to >= 0 && value.to <= 1) return { ...objectBase, type: "draw", to: value.to };
      diagnostic(diagnostics, "INVALID_DRAW_PROGRESS", `${path}.to`, "draw.to must be a finite number between 0 and 1.");
      return null;
    case "morph": {
      if (typeof value.to !== "string" || value.to.length === 0) {
        diagnostic(diagnostics, "INVALID_MORPH_PATH", `${path}.to`, "morph.to must be a non-empty SVG path string.");
        return null;
      }
      if (value.to.length > COMPILER_LIMITS.pathLength) {
        diagnostic(
          diagnostics,
          "LIMIT_PATH_LENGTH",
          `${path}.to`,
          `Morph path data exceeds the ${COMPILER_LIMITS.pathLength}-character limit.`,
        );
        return null;
      }
      const parsed = parseMorphPathData(value.to);
      if (!parsed.ok) {
        diagnostic(diagnostics, parsed.code, `${path}.to`, parsed.message);
        return null;
      }
      if (!canonicalPathWithinBounds(parsed.path)) {
        diagnostic(
          diagnostics,
          "MORPH_PATH_COORDINATE_LIMIT",
          `${path}.to`,
          `Morph path coordinates must have absolute value <= ${COMPILER_LIMITS.absoluteNumber}.`,
        );
        return null;
      }
      const canonical = canonicalMorphPathToString(parsed.path);
      if (canonical.length > COMPILER_LIMITS.pathLength) {
        diagnostic(
          diagnostics,
          "LIMIT_PATH_LENGTH",
          `${path}.to`,
          `Canonical morph path exceeds the ${COMPILER_LIMITS.pathLength}-character limit.`,
        );
        return null;
      }
      return { ...objectBase, type: "morph", to: canonical };
    }
    case "visibility":
      if (typeof value.visible === "boolean") return { ...objectBase, type: "visibility", visible: value.visible };
      diagnostic(diagnostics, "INVALID_VISIBILITY_TARGET", `${path}.visible`, "visibility.visible must be a boolean.");
      return null;
    case "reparent": {
      if (value.duration !== 0) {
        diagnostic(diagnostics, "INVALID_STRUCTURAL_DURATION", `${path}.duration`, "reparent actions must have duration 0.");
        return null;
      }
      if (value.parentId !== null && typeof value.parentId !== "string") {
        diagnostic(diagnostics, "INVALID_REPARENT_TARGET", `${path}.parentId`, "reparent.parentId must be an object id or null.");
        return null;
      }
      if (value.parentId === target) {
        diagnostic(diagnostics, "REPARENT_SELF", `${path}.parentId`, "An object cannot be parented to itself.");
        return null;
      }
      if (value.preserveWorld !== undefined && typeof value.preserveWorld !== "boolean") {
        diagnostic(diagnostics, "INVALID_REPARENT_POLICY", `${path}.preserveWorld`, "preserveWorld must be a boolean.");
        return null;
      }
      return {
        ...objectBase,
        type: "reparent",
        parentId: value.parentId,
        ...(value.preserveWorld === false ? { preserveWorld: false } : {}),
      };
    }
    case "zOrder":
      if (value.duration !== 0) {
        diagnostic(diagnostics, "INVALID_STRUCTURAL_DURATION", `${path}.duration`, "zOrder actions must have duration 0.");
        return null;
      }
      if (typeof value.to === "number" && Number.isInteger(value.to) && Math.abs(value.to) <= COMPILER_LIMITS.absoluteNumber) {
        return { ...objectBase, type: "zOrder", to: value.to };
      }
      diagnostic(diagnostics, "INVALID_Z_ORDER", `${path}.to`, "zOrder.to must be a bounded integer.");
      return null;
    default:
      diagnostic(
        diagnostics,
        "UNKNOWN_ACTION",
        `${path}.type`,
        `Unsupported action type '${value.type}'.`,
        "Use camera, move, followPath, rotate, scale, opacity, fill, stroke, style, text, resize, draw, morph, visibility, reparent, or zOrder.",
      );
      return null;
  }
}

function indexObjects(objects: DrawableObject[], diagnostics: Diagnostic[]): {
  byId: Map<string, DrawableObject>;
  indexById: Map<string, number>;
} {
  const byId = new Map<string, DrawableObject>();
  const indexById = new Map<string, number>();

  objects.forEach((object, index) => {
    if (byId.has(object.id)) {
      diagnostic(diagnostics, "DUPLICATE_ID", `objects[${index}].id`, `Object '${object.id}' is duplicated.`);
      return;
    }
    byId.set(object.id, object);
    indexById.set(object.id, index);
  });

  return { byId, indexById };
}

function validateParentCycles(
  objects: DrawableObject[],
  byId: ReadonlyMap<string, DrawableObject>,
  indexById: ReadonlyMap<string, number>,
  diagnostics: Diagnostic[],
): void {
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];

  const visit = (object: DrawableObject): void => {
    const current = state.get(object.id) ?? 0;
    if (current !== 0) return;

    state.set(object.id, 1);
    stack.push(object.id);

    if (object.parentId) {
      const parent = byId.get(object.parentId);
      if (parent) {
        const parentState = state.get(parent.id) ?? 0;
        if (parentState === 0) {
          visit(parent);
        } else if (parentState === 1) {
          const start = stack.indexOf(parent.id);
          const cycle = [...stack.slice(start), parent.id];
          const objectIndex = indexById.get(object.id);
          diagnostic(
            diagnostics,
            "PARENT_CYCLE",
            objectIndex === undefined ? "objects" : `objects[${objectIndex}].parentId`,
            `Parent cycle detected: ${cycle.join(" -> ")}.`,
            "Break the parentId cycle so every object has an acyclic path to the scene root.",
          );
        }
      }
    }

    stack.pop();
    state.set(object.id, 2);
  };

  for (const object of objects) visit(object);
}

function validateObjectGraph(objects: DrawableObject[], diagnostics: Diagnostic[]): Map<string, DrawableObject> {
  const { byId, indexById } = indexObjects(objects, diagnostics);

  objects.forEach((object, index) => {
    if (object.parentId) {
      const parent = byId.get(object.parentId);
      if (!parent) {
        diagnostic(
          diagnostics,
          "UNKNOWN_PARENT",
          `objects[${index}].parentId`,
          `Parent object '${object.parentId}' does not exist.`,
        );
      } else if (parent.type !== "group") {
        diagnostic(
          diagnostics,
          "INVALID_PARENT_TYPE",
          `objects[${index}].parentId`,
          `Parent '${object.parentId}' must be a group, not '${parent.type}'.`,
        );
      } else if (!parent.children.includes(object.id)) {
        diagnostic(
          diagnostics,
          "PARENT_GROUP_CHILD_MISMATCH",
          `objects[${index}].parentId`,
          `Object '${object.id}' names group '${parent.id}' as its parent, but the group does not list it in children.`,
          `Add '${object.id}' to group '${parent.id}'.children or remove parentId.`,
        );
      }
    }

    if (object.type === "group") {
      object.children.forEach((childId, childIndex) => {
        if (childId === object.id) {
          diagnostic(
            diagnostics,
            "GROUP_SELF_CHILD",
            `objects[${index}].children[${childIndex}]`,
            "A group cannot contain itself.",
          );
          return;
        }
        const child = byId.get(childId);
        if (!child) {
          diagnostic(
            diagnostics,
            "UNKNOWN_GROUP_CHILD",
            `objects[${index}].children[${childIndex}]`,
            `Group child '${childId}' does not exist.`,
          );
          return;
        }
        if (child.parentId !== object.id) {
          diagnostic(
            diagnostics,
            "GROUP_CHILD_PARENT_MISMATCH",
            `objects[${index}].children[${childIndex}]`,
            `Child '${childId}' must declare parentId '${object.id}'.`,
          );
        }
      });
    }

    if (object.type === "connector") {
      if (object.from.objectId === object.to.objectId) {
        diagnostic(
          diagnostics,
          "CONNECTOR_SAME_ENDPOINT",
          `objects[${index}].to.objectId`,
          "Connector endpoints must reference different objects.",
        );
      }

      const endpoints = [
        ["from", object.from.objectId],
        ["to", object.to.objectId],
      ] as const;
      for (const [endpoint, objectId] of endpoints) {
        const target = byId.get(objectId);
        if (!target) {
          diagnostic(
            diagnostics,
            "UNKNOWN_CONNECTOR_OBJECT",
            `objects[${index}].${endpoint}.objectId`,
            `Connector endpoint object '${objectId}' does not exist.`,
          );
        } else if (target.type === "connector") {
          diagnostic(
            diagnostics,
            "INVALID_CONNECTOR_TARGET",
            `objects[${index}].${endpoint}.objectId`,
            "Connectors cannot target another connector.",
          );
        }
      }
    }
  });

  validateParentCycles(objects, byId, indexById, diagnostics);
  return byId;
}

function validateTimelineReferences(
  timeline: Action[],
  objects: ReadonlyMap<string, DrawableObject>,
  diagnostics: Diagnostic[],
): void {
  const actionIds = new Set<string>();
  const objectIds = [...objects.keys()].sort();

  timeline.forEach((action, index) => {
    if (actionIds.has(action.id)) {
      diagnostic(
        diagnostics,
        "DUPLICATE_ACTION_ID",
        `timeline[${index}].id`,
        `Action '${action.id}' is duplicated.`,
      );
    }
    actionIds.add(action.id);

    if (action.type === "camera") return;

    const target = objects.get(action.target);
    if (!target) {
      diagnostic(
        diagnostics,
        "UNKNOWN_OBJECT",
        `timeline[${index}].target`,
        `Object '${action.target}' does not exist.`,
        objectIds.length ? `Use one of: ${objectIds.slice(0, 8).join(", ")}` : "Create the object before targeting it.",
      );
      return;
    }

    if (action.type === "reparent" && action.parentId !== null) {
      const parent = objects.get(action.parentId);
      if (!parent) {
        diagnostic(
          diagnostics,
          "UNKNOWN_REPARENT_TARGET",
          `timeline[${index}].parentId`,
          `Parent object '${action.parentId}' does not exist.`,
        );
      } else if (parent.type !== "group") {
        diagnostic(
          diagnostics,
          "INVALID_REPARENT_TARGET",
          `timeline[${index}].parentId`,
          `Parent '${action.parentId}' must be a group.`,
        );
      } else {
        let current: DrawableObject | undefined = parent;
        const seen = new Set<string>();
        while (current?.parentId && !seen.has(current.id)) {
          if (current.parentId === action.target) {
            diagnostic(
              diagnostics,
              "REPARENT_CYCLE",
              `timeline[${index}].parentId`,
              `Reparenting '${action.target}' under '${action.parentId}' would create a parent cycle in the base graph.`,
            );
            break;
          }
          seen.add(current.id);
          current = objects.get(current.parentId);
        }
      }
    }

    if (action.type === "text" && target.type !== "text" && target.type !== "rect" && target.type !== "circle" && target.type !== "ellipse") diagnostic(diagnostics, "UNSUPPORTED_TEXT_TARGET", `timeline[${index}].target`, "Only text and labeled shapes expose text.");
    if (action.type === "resize") {
      if (target.type !== "rect" && target.type !== "image" && target.type !== "ellipse" && target.type !== "circle") {
        diagnostic(
          diagnostics,
          "UNSUPPORTED_RESIZE_TARGET",
          `timeline[${index}].target`,
          `Object '${target.id}' of type '${target.type}' cannot be resized geometrically.`,
          "Use scale for drawable types without intrinsic width/height geometry.",
        );
      } else if (target.type === "circle" && action.to.width !== action.to.height) {
        diagnostic(
          diagnostics,
          "INVALID_CIRCLE_RESIZE",
          `timeline[${index}].to`,
          "Circle resize requires equal width and height.",
          "Use an ellipse when width and height need to differ.",
        );
      }
    }

    if (action.type === "draw" && target.type !== "path" && target.type !== "polygon" && target.type !== "polyline") {
      diagnostic(
        diagnostics,
        "UNSUPPORTED_DRAW_TARGET",
        `timeline[${index}].target`,
        `Object '${target.id}' of type '${target.type}' does not expose drawProgress.`,
        "Use draw on path, polygon, or polyline objects.",
      );
    }

    if (action.type === "morph") {
      if (target.type !== "path") {
        diagnostic(
          diagnostics,
          "UNSUPPORTED_MORPH_TARGET",
          `timeline[${index}].target`,
          `Object '${target.id}' of type '${target.type}' is not an SVG path.`,
          "Morph actions may target path objects only.",
        );
        return;
      }

      const priorMorph = timeline
        .filter((candidate): candidate is Extract<Action, { type: "morph" }> =>
          candidate.type === "morph" &&
          candidate.target === action.target &&
          candidate !== action &&
          candidate.start + candidate.duration <= action.start
        )
        .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
        .at(-1);
      const from = parseMorphPathData(priorMorph?.to ?? target.d);
      if (!from.ok) {
        diagnostic(
          diagnostics,
          from.code,
          `timeline[${index}].target`,
          `Morph source path is invalid: ${from.message}`,
        );
        return;
      }
      if (!canonicalPathWithinBounds(from.path)) {
        diagnostic(
          diagnostics,
          "MORPH_PATH_COORDINATE_LIMIT",
          `timeline[${index}].target`,
          `Morph source path coordinates must have absolute value <= ${COMPILER_LIMITS.absoluteNumber}.`,
        );
        return;
      }

      const to = parseMorphPathData(action.to);
      if (!to.ok) {
        diagnostic(diagnostics, to.code, `timeline[${index}].to`, to.message);
        return;
      }

      const compatibility = morphPathCompatibility(from.path, to.path);
      if (!compatibility.ok) {
        diagnostic(diagnostics, compatibility.code, `timeline[${index}].to`, compatibility.message);
      }
    }
  });
}

function parseCameraState(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): CameraState | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    diagnostic(diagnostics, "INVALID_CAMERA", path, "camera must be an object with x, y, and zoom.");
    return undefined;
  }

  const x = value.x;
  const y = value.y;
  const zoom = value.zoom;

  if (!boundedNumber(x) || !boundedNumber(y)) {
    diagnostic(
      diagnostics,
      "INVALID_CAMERA",
      path,
      `camera x/y must be finite numbers with absolute value <= ${COMPILER_LIMITS.absoluteNumber}.`,
    );
    return undefined;
  }
  if (!finite(zoom) || zoom < COMPILER_LIMITS.cameraZoomMin || zoom > COMPILER_LIMITS.cameraZoomMax) {
    diagnostic(
      diagnostics,
      "LIMIT_CAMERA_ZOOM",
      `${path}.zoom`,
      `camera zoom must be between ${COMPILER_LIMITS.cameraZoomMin} and ${COMPILER_LIMITS.cameraZoomMax}.`,
    );
    return undefined;
  }

  return { x, y, zoom };
}

function parseSceneMetadata(
  input: Record<string, unknown>,
  diagnostics: Diagnostic[],
): SceneDocument["scene"] | null {
  if (!isRecord(input.scene)) {
    diagnostic(diagnostics, "INVALID_SCENE_SIZE", "scene", "scene must be an object with finite positive width and height.");
    return null;
  }

  const width = input.scene.width;
  const height = input.scene.height;
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) {
    diagnostic(diagnostics, "INVALID_SCENE_SIZE", "scene", "scene.width and scene.height must be finite numbers > 0.");
    return null;
  }
  if (width > COMPILER_LIMITS.sceneDimension || height > COMPILER_LIMITS.sceneDimension) {
    diagnostic(
      diagnostics,
      "LIMIT_SCENE_DIMENSION",
      "scene",
      `Scene dimensions may not exceed ${COMPILER_LIMITS.sceneDimension}x${COMPILER_LIMITS.sceneDimension}.`,
    );
  }
  if (width * height > COMPILER_LIMITS.scenePixels) {
    diagnostic(
      diagnostics,
      "LIMIT_SCENE_PIXELS",
      "scene",
      `Scene area may not exceed ${COMPILER_LIMITS.scenePixels} pixels.`,
    );
  }

  let theme: "sketch" | "clean" | undefined;
  if (input.scene.theme !== undefined) {
    if (input.scene.theme === "sketch" || input.scene.theme === "clean") theme = input.scene.theme;
    else diagnostic(diagnostics, "INVALID_THEME", "scene.theme", "theme must be clean or sketch.");
  }

  let background: string | undefined;
  if (input.scene.background !== undefined) {
    if (typeof input.scene.background !== "string") {
      diagnostic(diagnostics, "INVALID_BACKGROUND", "scene.background", "background must be a string.");
    } else if (input.scene.background.length > COMPILER_LIMITS.styleStringLength) {
      diagnostic(
        diagnostics,
        "LIMIT_STYLE_STRING",
        "scene.background",
        `background exceeds the ${COMPILER_LIMITS.styleStringLength}-character limit.`,
      );
    } else {
      background = input.scene.background;
    }
  }

  let seed: number | undefined;
  if (input.scene.seed !== undefined) {
    if (typeof input.scene.seed === "number" && Number.isSafeInteger(input.scene.seed)) seed = input.scene.seed;
    else diagnostic(diagnostics, "INVALID_SEED", "scene.seed", "seed must be a safe integer.");
  }

  const camera = input.scene.camera === undefined
    ? defaultCamera()
    : parseCameraState(input.scene.camera, "scene.camera", diagnostics);

  return {
    width,
    height,
    ...(theme ? { theme } : {}),
    ...(background !== undefined ? { background } : {}),
    ...(seed !== undefined ? { seed } : {}),
    ...(camera ? { camera } : {}),
  };
}

function parseMarkers(value: unknown, diagnostics: Diagnostic[]): Marker[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    diagnostic(diagnostics, "INVALID_MARKERS", "markers", "markers must be an array.");
    return [];
  }
  const markers: Marker[] = [], ids = new Set<string>();
  value.forEach((item: unknown, index: number) => {
    const path = `markers[${index}]`;
    if (!isRecord(item)) {
      diagnostic(diagnostics, "INVALID_MARKER", path, "Marker must be an object.");
      return;
    }
    const id = parseId(item.id, `${path}.id`, diagnostics);
    if (id && ids.has(id)) diagnostic(diagnostics, "DUPLICATE_MARKER_ID", `${path}.id`, "Marker IDs must be unique.");
    if (id) ids.add(id);
    if (typeof item.label !== "string") diagnostic(diagnostics, "INVALID_TEXT", `${path}.label`, "Marker label must be a string.");
    const label = typeof item.label === "string" ? parseBoundedText(item.label, "", `${path}.label`, diagnostics) : "";
    if (!finite(item.time) || item.time < 0 || item.time > COMPILER_LIMITS.actionTime) {
      diagnostic(diagnostics, "INVALID_MARKER_TIME", `${path}.time`, `Marker time must be between 0 and ${COMPILER_LIMITS.actionTime} milliseconds.`);
      return;
    }
    if (id) markers.push({ id, label, time: item.time });
  });
  return markers;
}

export function compile(input: unknown): CompileResult {
  const diagnostics: Diagnostic[] = [];
  if (!isRecord(input)) {
    return {
      ok: false,
      diagnostics: [{ code: "INVALID_SCENE", path: "$", message: "Scene must be a JSON object." }],
    };
  }

  if (input.version !== "1.0") {
    diagnostic(diagnostics, "UNSUPPORTED_VERSION", "version", "Only scene version 1.0 is supported.");
  }

  const scene = parseSceneMetadata(input, diagnostics);

  if (!Array.isArray(input.objects)) {
    diagnostic(diagnostics, "INVALID_OBJECTS", "objects", "objects must be an array.");
  } else if (input.objects.length > COMPILER_LIMITS.objects) {
    diagnostic(
      diagnostics,
      "LIMIT_OBJECTS",
      "objects",
      `objects exceeds the ${COMPILER_LIMITS.objects}-entry limit.`,
    );
  }

  if (!Array.isArray(input.timeline)) {
    diagnostic(diagnostics, "INVALID_TIMELINE", "timeline", "timeline must be an array.");
  } else if (input.timeline.length > COMPILER_LIMITS.timelineActions) {
    diagnostic(
      diagnostics,
      "LIMIT_TIMELINE_ACTIONS",
      "timeline",
      `timeline exceeds the ${COMPILER_LIMITS.timelineActions}-entry limit.`,
    );
  }

  if (Array.isArray(input.markers) && input.markers.length > COMPILER_LIMITS.markers) {
    diagnostic(diagnostics, "LIMIT_MARKERS", "markers", `markers exceeds the ${COMPILER_LIMITS.markers}-entry limit.`);
  }

  if (input.bindings !== undefined && !Array.isArray(input.bindings)) {
    diagnostic(diagnostics, "INVALID_BINDINGS", "bindings", "bindings must be an array.");
  } else if (Array.isArray(input.bindings) && input.bindings.length > COMPILER_LIMITS.bindings) {
    diagnostic(diagnostics, "LIMIT_BINDINGS", "bindings", `bindings exceeds the ${COMPILER_LIMITS.bindings}-entry limit.`);
  }

  if (input.interactions !== undefined && !Array.isArray(input.interactions)) {
    diagnostic(diagnostics, "INVALID_INTERACTIONS", "interactions", "interactions must be an array.");
  } else if (Array.isArray(input.interactions) && input.interactions.length > COMPILER_LIMITS.interactions) {
    diagnostic(
      diagnostics,
      "LIMIT_INTERACTIONS",
      "interactions",
      `interactions exceeds the ${COMPILER_LIMITS.interactions}-entry limit.`,
    );
  }

  if (input.stateMachines !== undefined && !Array.isArray(input.stateMachines)) {
    diagnostic(diagnostics, "INVALID_STATE_MACHINES", "stateMachines", "stateMachines must be an array.");
  } else if (Array.isArray(input.stateMachines) && input.stateMachines.length > COMPILER_LIMITS.stateMachines) {
    diagnostic(
      diagnostics,
      "LIMIT_STATE_MACHINES",
      "stateMachines",
      `stateMachines exceeds the ${COMPILER_LIMITS.stateMachines}-entry limit.`,
    );
  }

  const preflightDiagnostics = sortedDiagnostics(diagnostics);
  if (
    !scene ||
    !Array.isArray(input.objects) ||
    !Array.isArray(input.timeline) ||
    input.objects.length > COMPILER_LIMITS.objects ||
    input.timeline.length > COMPILER_LIMITS.timelineActions ||
    (Array.isArray(input.markers) && input.markers.length > COMPILER_LIMITS.markers) ||
    (Array.isArray(input.bindings) && input.bindings.length > COMPILER_LIMITS.bindings) ||
    (Array.isArray(input.interactions) && input.interactions.length > COMPILER_LIMITS.interactions) ||
    (Array.isArray(input.stateMachines) && input.stateMachines.length > COMPILER_LIMITS.stateMachines)
  ) {
    return { ok: false, diagnostics: preflightDiagnostics };
  }

  const objects = input.objects
    .map((value, index) => parseObject(value, index, diagnostics))
    .filter((value): value is DrawableObject => value !== null);

  const timeline = input.timeline
    .map((value, index) => parseAction(value, index, diagnostics))
    .filter((value): value is Action => value !== null);

  const state = parseState(input.state, diagnostics);
  const markers = parseMarkers(input.markers, diagnostics);
  const bindings = Array.isArray(input.bindings)
    ? input.bindings.map((value, index) => parseBinding(value, index, diagnostics)).filter((value): value is Binding => value !== null)
    : [];

  const objectIndex = validateObjectGraph(objects, diagnostics);
  const interactions = Array.isArray(input.interactions)
    ? input.interactions
        .map((value, index) => parseInteraction(value, index, state ?? {}, objectIndex, diagnostics))
        .filter((value): value is Interaction => value !== null)
    : [];
  const stateMachines = Array.isArray(input.stateMachines)
    ? input.stateMachines
        .map((value, index) => parseStateMachine(value, index, state ?? {}, objectIndex, diagnostics))
        .filter((value): value is StateMachine => value !== null)
    : [];

  validateTimelineReferences(timeline, objectIndex, diagnostics);
  validateBindings(bindings, timeline, objectIndex, diagnostics);
  validateInteractionIds(interactions, diagnostics);
  validateStateMachineIds(stateMachines, diagnostics);

  const doc: SceneDocument = {
    version: "1.0",
    scene,
    objects,
    timeline,
    ...(markers.length ? { markers } : {}),
    ...(state ? { state } : {}),
    ...(bindings.length ? { bindings } : {}),
    ...(interactions.length ? { interactions } : {}),
    ...(stateMachines.length ? { stateMachines } : {}),
  };

  // Compiler owns the stable duplicate/reference/time diagnostics above.
  // Keep core's cross-action conflict analysis without duplicating those errors.
  diagnostics.push(...validateScene(doc).filter(item => item.code === "OVERLAPPING_PROPERTY_ACTIONS"));

  const resultDiagnostics = sortedDiagnostics(diagnostics);
  if (resultDiagnostics.length > 0) return { ok: false, diagnostics: resultDiagnostics };
  return { ok: true, scene: doc, diagnostics: [] };
}

export function compileJson(source: string): CompileResult {
  const bytes = utf8ByteLength(source);
  if (bytes > COMPILER_LIMITS.sourceBytes) {
    return {
      ok: false,
      diagnostics: [{
        code: "LIMIT_SOURCE_BYTES",
        path: "$",
        message: `JSON source is ${bytes} bytes; maximum is ${COMPILER_LIMITS.sourceBytes} bytes.`,
      }],
    };
  }

  try {
    return compile(JSON.parse(source));
  } catch (error) {
    return {
      ok: false,
      diagnostics: [{
        code: "INVALID_JSON",
        path: "$",
        message: error instanceof Error ? error.message : "Invalid JSON.",
      }],
    };
  }
}

export * from "./migrations.js";
