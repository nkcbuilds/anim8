import {
  defaultCamera,
  defaultStyle,
  defaultTransform,
  validateScene,
  type Action,
  type AnchorName,
  type Binding,
  type BindingProperty,
  type CameraState,
  type Expression,
  type Interaction,
  type InteractionTrigger,
  type ScalarValue,
  type StateAction,
  type Diagnostic,
  type DrawableObject,
  type EasingName,
  type PointValue,
  type SceneDocument,
  type Style,
  type Transform,
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
  bindings: 10_000,
  interactions: 5_000,
  interactionActions: 100,
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

function parseStyle(value: unknown, path: string, diagnostics: Diagnostic[]): Style {
  const style = defaultStyle();
  if (value === undefined) return style;
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

  switch (type) {
    case "rect": {
      const text = parseOptionalText(value.text, `${path}.text`, diagnostics);
      return {
        ...base,
        type,
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

      let kind: "straight" | "curve" | "orthogonal" = "straight";
      if (value.kind !== undefined) {
        if (value.kind === "straight" || value.kind === "curve" || value.kind === "orthogonal") kind = value.kind;
        else {
          diagnostic(
            diagnostics,
            "INVALID_CONNECTOR_KIND",
            `${path}.kind`,
            "Connector kind must be straight, curve, or orthogonal.",
          );
          return null;
        }
      }
      const label = parseOptionalText(value.label, `${path}.label`, diagnostics);
      return { ...base, type, from, to, kind, ...(label !== undefined ? { label } : {}) };
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


const BINDING_PROPERTIES = ["x","y","rotation","scaleX","scaleY","opacity","fill","stroke","text"] as const;
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

type ActionProperty = BindingProperty | "width" | "height" | "drawProgress";

function actionProperties(action: Action): readonly ActionProperty[] {
  switch (action.type) {
    case "move": return ["x", "y"];
    case "followPath": return ["x", "y"];
    case "rotate": return ["rotation"];
    case "scale": return ["scaleX", "scaleY"];
    case "opacity": return ["opacity"];
    case "fill": return ["fill"];
    case "stroke": return ["stroke"];
    case "resize": return ["width", "height"];
    case "draw": return ["drawProgress"];
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

  let easing: EasingName = "linear";
  if (value.easing !== undefined) {
    if (value.easing === "linear" || value.easing === "easeIn" || value.easing === "easeOut" || value.easing === "easeInOut" || value.easing === "spring") {
      easing = value.easing;
    } else {
      diagnostic(diagnostics, "INVALID_EASING", `${path}.easing`, "Unsupported easing value.");
      return null;
    }
  }

  const base = { id, start: value.start, duration: value.duration, easing };

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
    case "visibility":
      if (typeof value.visible === "boolean") return { ...objectBase, type: "visibility", visible: value.visible };
      diagnostic(diagnostics, "INVALID_VISIBILITY_TARGET", `${path}.visible`, "visibility.visible must be a boolean.");
      return null;
    default:
      diagnostic(
        diagnostics,
        "UNKNOWN_ACTION",
        `${path}.type`,
        `Unsupported action type '${value.type}'.`,
        "Use camera, move, followPath, rotate, scale, opacity, fill, stroke, resize, draw, or visibility.",
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

  const preflightDiagnostics = sortedDiagnostics(diagnostics);
  if (
    !scene ||
    !Array.isArray(input.objects) ||
    !Array.isArray(input.timeline) ||
    input.objects.length > COMPILER_LIMITS.objects ||
    input.timeline.length > COMPILER_LIMITS.timelineActions ||
    (Array.isArray(input.bindings) && input.bindings.length > COMPILER_LIMITS.bindings) ||
    (Array.isArray(input.interactions) && input.interactions.length > COMPILER_LIMITS.interactions)
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
  const bindings = Array.isArray(input.bindings)
    ? input.bindings.map((value, index) => parseBinding(value, index, diagnostics)).filter((value): value is Binding => value !== null)
    : [];

  const objectIndex = validateObjectGraph(objects, diagnostics);
  const interactions = Array.isArray(input.interactions)
    ? input.interactions
        .map((value, index) => parseInteraction(value, index, state ?? {}, objectIndex, diagnostics))
        .filter((value): value is Interaction => value !== null)
    : [];

  validateTimelineReferences(timeline, objectIndex, diagnostics);
  validateBindings(bindings, timeline, objectIndex, diagnostics);
  validateInteractionIds(interactions, diagnostics);

  const doc: SceneDocument = {
    version: "1.0",
    scene,
    objects,
    timeline,
    ...(state ? { state } : {}),
    ...(bindings.length ? { bindings } : {}),
    ...(interactions.length ? { interactions } : {}),
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
