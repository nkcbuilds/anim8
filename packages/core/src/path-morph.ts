import { lerp } from "./easing.js";

export interface CanonicalCubicSegment {
  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;
  x: number;
  y: number;
}

export interface CanonicalPathSubpath {
  start: { x: number; y: number };
  segments: CanonicalCubicSegment[];
  closed: boolean;
}

export interface CanonicalMorphPath {
  subpaths: CanonicalPathSubpath[];
}

export type MorphPathParseErrorCode =
  | "MORPH_PATH_MALFORMED"
  | "MORPH_PATH_UNSUPPORTED_COMMAND";

export type MorphPathParseResult =
  | { ok: true; path: CanonicalMorphPath }
  | { ok: false; code: MorphPathParseErrorCode; message: string; offset?: number };

export type MorphPathCompatibilityCode =
  | "MORPH_SUBPATH_COUNT_MISMATCH"
  | "MORPH_SUBPATH_CLOSEDNESS_MISMATCH"
  | "MORPH_SEGMENT_STRUCTURE_MISMATCH";

export type MorphPathCompatibility =
  | { ok: true }
  | { ok: false; code: MorphPathCompatibilityCode; message: string; subpath?: number };

type Token =
  | { kind: "command"; value: string; offset: number }
  | { kind: "number"; value: number; offset: number };

const SUPPORTED_COMMANDS = new Set(["M", "m", "L", "l", "H", "h", "V", "v", "C", "c", "Q", "q", "Z", "z"]);
const TOKEN_RE = /[-+]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][-+]?\d+)?|[A-Za-z]/g;
const SEPARATOR_RE = /^[\s,]*$/;

/**
 * Parse the deterministic morph subset of SVG path data.
 *
 * Supported commands: M/m, L/l, H/h, V/v, C/c, Q/q, Z/z.
 * All coordinates are normalized to absolute cubic segments. Smooth commands
 * (S/T), arcs (A), and every other SVG path command are intentionally rejected
 * rather than inferred or resampled.
 */
export function parseMorphPathData(source: string): MorphPathParseResult {
  if (typeof source !== "string" || source.trim().length === 0) {
    return { ok: false, code: "MORPH_PATH_MALFORMED", message: "Path data must be a non-empty string." };
  }

  const tokens: Token[] = [];
  TOKEN_RE.lastIndex = 0;
  let previousEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(source)) !== null) {
    const gap = source.slice(previousEnd, match.index);
    if (!SEPARATOR_RE.test(gap)) {
      return {
        ok: false,
        code: "MORPH_PATH_MALFORMED",
        message: "Unexpected path data near offset " + previousEnd + ".",
        offset: previousEnd,
      };
    }

    const raw = match[0]!;
    if (/^[A-Za-z]$/.test(raw)) {
      if (!SUPPORTED_COMMANDS.has(raw)) {
        return {
          ok: false,
          code: "MORPH_PATH_UNSUPPORTED_COMMAND",
          message: "SVG path command '" + raw + "' is not supported for deterministic morphing.",
          offset: match.index,
        };
      }
      tokens.push({ kind: "command", value: raw, offset: match.index });
    } else {
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        return {
          ok: false,
          code: "MORPH_PATH_MALFORMED",
          message: "Path number '" + raw + "' is not finite.",
          offset: match.index,
        };
      }
      tokens.push({ kind: "number", value, offset: match.index });
    }
    previousEnd = TOKEN_RE.lastIndex;
  }

  if (!SEPARATOR_RE.test(source.slice(previousEnd))) {
    return {
      ok: false,
      code: "MORPH_PATH_MALFORMED",
      message: "Unexpected path data near offset " + previousEnd + ".",
      offset: previousEnd,
    };
  }
  if (tokens.length === 0) {
    return { ok: false, code: "MORPH_PATH_MALFORMED", message: "Path data must contain commands." };
  }

  let index = 0;
  let command: string | null = null;
  let current = { x: 0, y: 0 };
  let subpath: CanonicalPathSubpath | null = null;
  const subpaths: CanonicalPathSubpath[] = [];

  const malformed = (message: string, offset?: number): MorphPathParseResult => ({
    ok: false,
    code: "MORPH_PATH_MALFORMED",
    message,
    ...(offset !== undefined ? { offset } : {}),
  });

  const nextNumber = (): number | null => {
    const token = tokens[index];
    if (!token || token.kind !== "number") return null;
    index += 1;
    return token.value;
  };

  const hasNumber = (): boolean => tokens[index]?.kind === "number";

  const addLine = (to: { x: number; y: number }) => {
    if (!subpath) return;
    const from = current;
    subpath.segments.push({
      c1x: from.x + (to.x - from.x) / 3,
      c1y: from.y + (to.y - from.y) / 3,
      c2x: from.x + (to.x - from.x) * 2 / 3,
      c2y: from.y + (to.y - from.y) * 2 / 3,
      x: to.x,
      y: to.y,
    });
    current = to;
  };

  const addQuadratic = (control: { x: number; y: number }, to: { x: number; y: number }) => {
    if (!subpath) return;
    const from = current;
    subpath.segments.push({
      c1x: from.x + (control.x - from.x) * 2 / 3,
      c1y: from.y + (control.y - from.y) * 2 / 3,
      c2x: to.x + (control.x - to.x) * 2 / 3,
      c2y: to.y + (control.y - to.y) * 2 / 3,
      x: to.x,
      y: to.y,
    });
    current = to;
  };

  const requireSubpath = (): MorphPathParseResult | null =>
    subpath ? null : malformed("Path drawing commands require an initial moveto (M/m).");

  while (index < tokens.length) {
    const token = tokens[index]!;
    if (token.kind === "command") {
      command = token.value;
      index += 1;
    } else if (command === null) {
      return malformed("Path data must begin with a moveto command.", token.offset);
    }

    if (!command) continue;
    const activeCommand: string = command;
    const relative: boolean = activeCommand === activeCommand.toLowerCase();
    const upper = activeCommand.toUpperCase();

    if (upper === "Z") {
      if (!subpath) return malformed("Closepath requires an active subpath.", token.offset);
      if (hasNumber()) return malformed("Closepath does not accept numeric parameters.", tokens[index]?.offset);
      subpath.closed = true;
      current = { ...subpath.start };
      command = null;
      const nextToken = tokens[index];
      if (nextToken?.kind === "command" && nextToken.value.toUpperCase() !== "M") {
        return malformed("A closed subpath must be followed by a new moveto command.", nextToken.offset);
      }
      continue;
    }

    if (upper === "M") {
      const x = nextNumber();
      const y = nextNumber();
      if (x === null || y === null) return malformed("Moveto requires an x/y pair.", tokens[index]?.offset);
      const start = relative ? { x: current.x + x, y: current.y + y } : { x, y };
      subpath = { start, segments: [], closed: false };
      subpaths.push(subpath);
      current = { ...start };

      while (hasNumber()) {
        const lx = nextNumber();
        const ly = nextNumber();
        if (lx === null || ly === null) return malformed("Implicit lineto after moveto requires x/y pairs.", tokens[index]?.offset);
        addLine(relative ? { x: current.x + lx, y: current.y + ly } : { x: lx, y: ly });
      }
      command = relative ? "l" : "L";
      continue;
    }

    const missingSubpath = requireSubpath();
    if (missingSubpath) return missingSubpath;

    if (upper === "L") {
      if (!hasNumber()) return malformed("Lineto requires at least one x/y pair.", token.offset);
      while (hasNumber()) {
        const x = nextNumber();
        const y = nextNumber();
        if (x === null || y === null) return malformed("Lineto requires complete x/y pairs.", tokens[index]?.offset);
        addLine(relative ? { x: current.x + x, y: current.y + y } : { x, y });
      }
      continue;
    }

    if (upper === "H") {
      if (!hasNumber()) return malformed("Horizontal lineto requires at least one coordinate.", token.offset);
      while (hasNumber()) {
        const x = nextNumber();
        if (x === null) break;
        addLine({ x: relative ? current.x + x : x, y: current.y });
      }
      continue;
    }

    if (upper === "V") {
      if (!hasNumber()) return malformed("Vertical lineto requires at least one coordinate.", token.offset);
      while (hasNumber()) {
        const y = nextNumber();
        if (y === null) break;
        addLine({ x: current.x, y: relative ? current.y + y : y });
      }
      continue;
    }

    if (upper === "C") {
      if (!hasNumber()) return malformed("Cubic curveto requires at least one six-number segment.", token.offset);
      while (hasNumber()) {
        const x1 = nextNumber();
        const y1 = nextNumber();
        const x2 = nextNumber();
        const y2 = nextNumber();
        const x = nextNumber();
        const y = nextNumber();
        if ([x1, y1, x2, y2, x, y].some(value => value === null)) {
          return malformed("Cubic curveto requires complete groups of six numbers.", tokens[index]?.offset);
        }
        const c1 = relative ? { x: current.x + x1!, y: current.y + y1! } : { x: x1!, y: y1! };
        const c2 = relative ? { x: current.x + x2!, y: current.y + y2! } : { x: x2!, y: y2! };
        const to = relative ? { x: current.x + x!, y: current.y + y! } : { x: x!, y: y! };
        subpath!.segments.push({ c1x: c1.x, c1y: c1.y, c2x: c2.x, c2y: c2.y, x: to.x, y: to.y });
        current = to;
      }
      continue;
    }

    if (upper === "Q") {
      if (!hasNumber()) return malformed("Quadratic curveto requires at least one four-number segment.", token.offset);
      while (hasNumber()) {
        const qx = nextNumber();
        const qy = nextNumber();
        const x = nextNumber();
        const y = nextNumber();
        if ([qx, qy, x, y].some(value => value === null)) {
          return malformed("Quadratic curveto requires complete groups of four numbers.", tokens[index]?.offset);
        }
        const control = relative ? { x: current.x + qx!, y: current.y + qy! } : { x: qx!, y: qy! };
        const to = relative ? { x: current.x + x!, y: current.y + y! } : { x: x!, y: y! };
        addQuadratic(control, to);
      }
      continue;
    }

    return malformed("Unsupported morph command '" + command + "'.", token.offset);
  }

  if (subpaths.length === 0) {
    return { ok: false, code: "MORPH_PATH_MALFORMED", message: "Path data must contain at least one moveto subpath." };
  }

  return { ok: true, path: { subpaths } };
}

export function morphPathCompatibility(
  from: CanonicalMorphPath,
  to: CanonicalMorphPath,
): MorphPathCompatibility {
  if (from.subpaths.length !== to.subpaths.length) {
    return {
      ok: false,
      code: "MORPH_SUBPATH_COUNT_MISMATCH",
      message: "Morph paths have different subpath counts (" + from.subpaths.length + " vs " + to.subpaths.length + ").",
    };
  }

  for (let index = 0; index < from.subpaths.length; index += 1) {
    const a = from.subpaths[index]!;
    const b = to.subpaths[index]!;
    if (a.closed !== b.closed) {
      return {
        ok: false,
        code: "MORPH_SUBPATH_CLOSEDNESS_MISMATCH",
        message: "Morph subpath " + index + " has different closed/open state.",
        subpath: index,
      };
    }
    if (a.segments.length !== b.segments.length) {
      return {
        ok: false,
        code: "MORPH_SEGMENT_STRUCTURE_MISMATCH",
        message: "Morph subpath " + index + " has different cubic segment counts (" + a.segments.length + " vs " + b.segments.length + ").",
        subpath: index,
      };
    }
  }

  return { ok: true };
}

export function interpolateMorphPath(
  from: CanonicalMorphPath,
  to: CanonicalMorphPath,
  progress: number,
): CanonicalMorphPath | null {
  if (!morphPathCompatibility(from, to).ok || !Number.isFinite(progress)) return null;
  const t = progress;

  return {
    subpaths: from.subpaths.map((a, subpathIndex) => {
      const b = to.subpaths[subpathIndex]!;
      return {
        start: {
          x: lerp(a.start.x, b.start.x, t),
          y: lerp(a.start.y, b.start.y, t),
        },
        closed: a.closed,
        segments: a.segments.map((segment, segmentIndex) => {
          const target = b.segments[segmentIndex]!;
          return {
            c1x: lerp(segment.c1x, target.c1x, t),
            c1y: lerp(segment.c1y, target.c1y, t),
            c2x: lerp(segment.c2x, target.c2x, t),
            c2y: lerp(segment.c2y, target.c2y, t),
            x: lerp(segment.x, target.x, t),
            y: lerp(segment.y, target.y, t),
          };
        }),
      };
    }),
  };
}

const formatNumber = (value: number): string => {
  const normalized = Object.is(value, -0) || Math.abs(value) < 1e-12 ? 0 : value;
  return Number.isInteger(normalized) ? String(normalized) : String(Number(normalized.toPrecision(15)));
};

export function canonicalMorphPathToString(path: CanonicalMorphPath): string {
  return path.subpaths
    .map(subpath => {
      const parts = ["M", formatNumber(subpath.start.x), formatNumber(subpath.start.y)];
      for (const segment of subpath.segments) {
        parts.push(
          "C",
          formatNumber(segment.c1x),
          formatNumber(segment.c1y),
          formatNumber(segment.c2x),
          formatNumber(segment.c2y),
          formatNumber(segment.x),
          formatNumber(segment.y),
        );
      }
      if (subpath.closed) parts.push("Z");
      return parts.join(" ");
    })
    .join(" ");
}
