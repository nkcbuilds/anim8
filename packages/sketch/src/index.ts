export type SketchSeed = number | string;

export interface SketchPoint {
  x: number;
  y: number;
}

export interface SketchContext {
  /**
   * Scene/global sketch seed. Pair this with a stable object id so the same
   * object keeps the same marks across frames.
   */
  seed: SketchSeed;
  objectId: string;
  /** Pixel-scale displacement applied to the generated stroke. Defaults to 1. */
  roughness?: number;
  /** Perpendicular bend strength for line-like strokes. Defaults to 1. */
  bowing?: number;
  /** Number of overdraw passes. Defaults to 2. */
  passes?: number;
}

export type SketchPathCommand =
  | { type: "M"; to: SketchPoint }
  | { type: "L"; to: SketchPoint }
  | { type: "C"; cp1: SketchPoint; cp2: SketchPoint; to: SketchPoint };

export interface SketchPath {
  commands: readonly SketchPathCommand[];
}

const DEFAULT_ROUGHNESS = 1;
const DEFAULT_BOWING = 1;
const DEFAULT_PASSES = 2;
const MAX_PASSES = 8;
const TAU = Math.PI * 2;
const ELLIPSE_KAPPA = 0.5522847498307936;

function canonicalSeed(seed: SketchSeed): string {
  if (typeof seed === "number") {
    if (!Number.isFinite(seed)) {
      throw new TypeError("Sketch seed must be a finite number or string.");
    }
    return `n:${Object.is(seed, -0) ? 0 : seed}`;
  }
  return `s:${seed}`;
}

/**
 * Small deterministic 32-bit hash based only on JS integer operations.
 * It is not cryptographic; it exists to make sketch marks stable.
 */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mix32(value: number): number {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/**
 * Stable unsigned seed for an object. Renderer integrations should use the
 * scene seed plus the object's persistent id, never animated position/time.
 */
export function objectSketchSeed(seed: SketchSeed, objectId: string): number {
  return mix32(hashString(`${canonicalSeed(seed)}\u0000id:${objectId}`));
}

function keyedUnit(seed: SketchSeed, objectId: string, key: string): number {
  const base = objectSketchSeed(seed, objectId);
  const keyed = mix32(base ^ hashString(`key:${key}`));
  return keyed / 0x1_0000_0000;
}

/**
 * Deterministic signed jitter in [-amount, amount). The key makes calls
 * order-independent, so adding a new jitter site does not reshuffle old ones.
 */
export function sketchJitter(
  seed: SketchSeed,
  objectId: string,
  key: string,
  amount = 1,
): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError("Sketch jitter amount must be a finite non-negative number.");
  }
  return (keyedUnit(seed, objectId, key) * 2 - 1) * amount;
}

export function jitterPoint(
  point: SketchPoint,
  context: Pick<SketchContext, "seed" | "objectId">,
  key: string,
  amount = 1,
): SketchPoint {
  return {
    x: point.x + sketchJitter(context.seed, context.objectId, `${key}:x`, amount),
    y: point.y + sketchJitter(context.seed, context.objectId, `${key}:y`, amount),
  };
}

function normalizedContext(context: SketchContext): Required<SketchContext> {
  const roughness = context.roughness ?? DEFAULT_ROUGHNESS;
  const bowing = context.bowing ?? DEFAULT_BOWING;
  const passes = context.passes ?? DEFAULT_PASSES;

  if (!Number.isFinite(roughness) || roughness < 0) {
    throw new RangeError("Sketch roughness must be a finite non-negative number.");
  }
  if (!Number.isFinite(bowing) || bowing < 0) {
    throw new RangeError("Sketch bowing must be a finite non-negative number.");
  }
  if (!Number.isInteger(passes) || passes < 1 || passes > MAX_PASSES) {
    throw new RangeError(`Sketch passes must be an integer from 1 to ${MAX_PASSES}.`);
  }

  // Validate numeric seeds once even when roughness is zero.
  canonicalSeed(context.seed);

  return {
    seed: context.seed,
    objectId: context.objectId,
    roughness,
    bowing,
    passes,
  };
}

/** Maximum endpoint/control displacement for long strokes at roughness 1, in px. */
const MAX_RANDOMNESS_OFFSET = 2;

interface BowedSegment {
  start: SketchPoint;
  cp1: SketchPoint;
  cp2: SketchPoint;
  end: SketchPoint;
}

/**
 * Displacement budget for a stroke of the given length. Short strokes get a
 * proportionally smaller budget so tiny marks (arrowheads, ticks) stay legible.
 */
function strokeOffset(length: number, context: Required<SketchContext>, pass: number): number {
  let offset = MAX_RANDOMNESS_OFFSET;
  if (offset * offset * 100 > length * length) offset = length / 10;
  // The overdraw pass hugs the first stroke so the pair reads as one line.
  return (pass === 0 ? offset : offset / 2) * context.roughness;
}

/**
 * One hand-drawn cubic between two points. The curve diverges from the chord at
 * a random 20-40% point and bows perpendicular to it, which is what makes a
 * stroke read as drawn rather than plotted. Endpoints are supplied by the
 * caller so continuous outlines can share vertex jitter between segments.
 */
function bowedSegment(
  from: SketchPoint,
  to: SketchPoint,
  start: SketchPoint,
  end: SketchPoint,
  context: Required<SketchContext>,
  passKey: string,
  pass: number,
): BowedSegment {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { start, cp1: start, cp2: end, end };

  const amount = strokeOffset(length, context, pass);
  const diverge = 0.2 + (sketchJitter(context.seed, context.objectId, `${passKey}:diverge`, 0.5) + 0.5) * 0.2;
  const bowBase = (context.bowing * MAX_RANDOMNESS_OFFSET * length) / 200;
  const bow = bowBase + sketchJitter(context.seed, context.objectId, `${passKey}:bow`, bowBase * context.roughness);
  const nx = -dy / length;
  const ny = dx / length;

  const cp1 = jitterPoint(
    { x: from.x + dx * diverge + nx * bow, y: from.y + dy * diverge + ny * bow },
    context,
    `${passKey}:cp1`,
    amount,
  );
  const cp2 = jitterPoint(
    { x: from.x + dx * 2 * diverge + nx * bow, y: from.y + dy * 2 * diverge + ny * bow },
    context,
    `${passKey}:cp2`,
    amount,
  );
  return { start, cp1, cp2, end };
}

function linePass(
  from: SketchPoint,
  to: SketchPoint,
  context: Required<SketchContext>,
  key: string,
  pass: number,
): SketchPath {
  const passKey = `${key}:pass:${pass}`;
  const amount = strokeOffset(Math.hypot(to.x - from.x, to.y - from.y), context, pass);
  const start = jitterPoint(from, context, `${passKey}:start`, amount);
  const end = jitterPoint(to, context, `${passKey}:end`, amount);
  const segment = bowedSegment(from, to, start, end, context, passKey, pass);
  return {
    commands: [
      { type: "M", to: segment.start },
      { type: "C", cp1: segment.cp1, cp2: segment.cp2, to: segment.end },
    ],
  };
}

/**
 * Returns object-local rough line paths. Apply object transforms after this
 * step in a renderer to keep the stroke pattern stable while the object moves.
 */
export function sketchLine(
  from: SketchPoint,
  to: SketchPoint,
  context: SketchContext,
  key = "line",
): readonly SketchPath[] {
  const normalized = normalizedContext(context);
  return Array.from({ length: normalized.passes }, (_, pass) =>
    linePass(from, to, normalized, key, pass),
  );
}

export function sketchPolyline(
  points: readonly SketchPoint[],
  context: SketchContext,
  options: { closed?: boolean; key?: string } = {},
): readonly SketchPath[] {
  const normalized = normalizedContext(context);
  if (points.length < 2) return [];

  const key = options.key ?? "polyline";
  const segmentCount = points.length - 1 + (options.closed ? 1 : 0);
  const paths: SketchPath[] = [];

  for (let segment = 0; segment < segmentCount; segment += 1) {
    const from = points[segment % points.length]!;
    const to = points[(segment + 1) % points.length]!;
    for (let pass = 0; pass < normalized.passes; pass += 1) {
      paths.push(linePass(from, to, normalized, `${key}:segment:${segment}`, pass));
    }
  }

  return paths;
}

export function sketchRectangle(
  x: number,
  y: number,
  width: number,
  height: number,
  context: SketchContext,
  key = "rect",
): readonly SketchPath[] {
  const points: readonly SketchPoint[] = [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
  return sketchPolyline(points, context, { closed: true, key });
}

/**
 * Rounded rectangle as one continuous stroke per pass, so it can double as the
 * fill outline. Corners are cubic quarter-arcs; edges are bowed segments.
 * Vertex jitter is keyed per corner endpoint, keeping the outline closed.
 */
export function sketchRoundedRectangle(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  context: SketchContext,
  key = "rounded-rect",
): readonly SketchPath[] {
  const normalized = normalizedContext(context);
  if (![x, y, width, height, radius].every(Number.isFinite) || width < 0 || height < 0) {
    throw new RangeError("Sketch rectangle values must be finite and size non-negative.");
  }
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  if (r === 0) return sketchRectangle(x, y, width, height, context, key);

  const right = x + width;
  const bottom = y + height;
  // Edge endpoints clockwise from the top edge; corner k joins edge k to k+1.
  const edges: readonly [SketchPoint, SketchPoint][] = [
    [{ x: x + r, y }, { x: right - r, y }],
    [{ x: right, y: y + r }, { x: right, y: bottom - r }],
    [{ x: right - r, y: bottom }, { x: x + r, y: bottom }],
    [{ x, y: bottom - r }, { x, y: y + r }],
  ];
  const corners: readonly SketchPoint[] = [
    { x: right, y },
    { x: right, y: bottom },
    { x, y: bottom },
    { x, y },
  ];

  const paths: SketchPath[] = [];
  for (let pass = 0; pass < normalized.passes; pass += 1) {
    const passKey = `${key}:pass:${pass}`;
    const vertexAmount = strokeOffset(Math.min(width, height), normalized, pass) * 0.6;
    const vertex = (edge: number, end: 0 | 1) =>
      jitterPoint(edges[edge]![end], normalized, `${passKey}:v:${edge}:${end}`, vertexAmount);

    const first = vertex(0, 0);
    const commands: SketchPathCommand[] = [{ type: "M", to: first }];
    for (let edge = 0; edge < 4; edge += 1) {
      const [from, to] = edges[edge]!;
      const start = edge === 0 ? first : vertex(edge, 0);
      const end = vertex(edge, 1);
      const segment = bowedSegment(from, to, start, end, normalized, `${passKey}:edge:${edge}`, pass);
      commands.push({ type: "C", cp1: segment.cp1, cp2: segment.cp2, to: segment.end });

      const next = (edge + 1) % 4;
      const corner = corners[edge]!;
      const cornerEnd = next === 0 ? first : vertex(next, 0);
      const cornerAmount = vertexAmount * 0.5;
      commands.push({
        type: "C",
        cp1: jitterPoint(
          { x: end.x + (corner.x - end.x) * ELLIPSE_KAPPA, y: end.y + (corner.y - end.y) * ELLIPSE_KAPPA },
          normalized,
          `${passKey}:corner:${edge}:cp1`,
          cornerAmount,
        ),
        cp2: jitterPoint(
          { x: cornerEnd.x + (corner.x - cornerEnd.x) * ELLIPSE_KAPPA, y: cornerEnd.y + (corner.y - cornerEnd.y) * ELLIPSE_KAPPA },
          normalized,
          `${passKey}:corner:${edge}:cp2`,
          cornerAmount,
        ),
        to: cornerEnd,
      });
    }
    paths.push({ commands });
  }
  return paths;
}

/**
 * Two short strokes forming an open arrowhead at `tip`, pointing along the
 * direction from `tail` to `tip`.
 */
export function sketchArrowhead(
  tail: SketchPoint,
  tip: SketchPoint,
  context: SketchContext,
  options: { size?: number; spread?: number; key?: string } = {},
): readonly SketchPath[] {
  const size = options.size ?? 14;
  const spread = options.spread ?? Math.PI / 7.5;
  const key = options.key ?? "arrowhead";
  const angle = Math.atan2(tip.y - tail.y, tip.x - tail.x);
  const wing = (sign: number): SketchPoint => ({
    x: tip.x - size * Math.cos(angle + sign * spread),
    y: tip.y - size * Math.sin(angle + sign * spread),
  });
  return [
    ...sketchLine(tip, wing(-1), context, `${key}:left`),
    ...sketchLine(tip, wing(1), context, `${key}:right`),
  ];
}

/**
 * Hand-drawn ellipse: a Catmull-Rom loop through radially jittered points that
 * starts at a seeded angle and overshoots its own start, like a pen stroke.
 */
export function sketchEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  context: SketchContext,
  key = "ellipse",
): readonly SketchPath[] {
  const normalized = normalizedContext(context);
  if (![cx, cy, rx, ry].every(Number.isFinite) || rx < 0 || ry < 0) {
    throw new RangeError("Sketch ellipse values must be finite and radii non-negative.");
  }

  const perimeter = Math.PI * (rx + ry);
  const count = Math.max(8, Math.min(18, Math.ceil(perimeter / 40)));
  const paths: SketchPath[] = [];

  for (let pass = 0; pass < normalized.passes; pass += 1) {
    const passKey = `${key}:pass:${pass}`;
    const radial = Math.min(Math.min(rx, ry) * 0.06, normalized.roughness * (pass === 0 ? 1.6 : 0.9));
    const startAngle = (sketchJitter(normalized.seed, normalized.objectId, `${passKey}:start`, 0.5) + 0.5) * TAU;
    const overshoot = 0.18 + (sketchJitter(normalized.seed, normalized.objectId, `${passKey}:overshoot`, 0.5) + 0.5) * 0.22;
    const step = TAU / count;

    const points: SketchPoint[] = [];
    // One extra point on each side feeds the Catmull-Rom tangents.
    for (let index = -1; index <= count + 2; index += 1) {
      const angle = startAngle + index * step + (index > count ? (overshoot - step) * (index - count) : 0);
      const wobble = index >= 0 && index < count
        ? sketchJitter(normalized.seed, normalized.objectId, `${passKey}:r:${index}`, radial)
        : sketchJitter(normalized.seed, normalized.objectId, `${passKey}:r:${((index % count) + count) % count}`, radial);
      points.push({
        x: cx + Math.cos(angle) * (rx + wobble),
        y: cy + Math.sin(angle) * (ry + wobble),
      });
    }

    const commands: SketchPathCommand[] = [{ type: "M", to: points[1]! }];
    for (let index = 1; index < points.length - 2; index += 1) {
      const p0 = points[index - 1]!;
      const p1 = points[index]!;
      const p2 = points[index + 1]!;
      const p3 = points[index + 2]!;
      commands.push({
        type: "C",
        cp1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
        cp2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
        to: p2,
      });
    }
    paths.push({ commands });
  }

  return paths;
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** Convert a sketch path into SVG path data without importing renderer-svg. */
export function sketchPathToSvg(path: SketchPath): string {
  return path.commands
    .map(command => {
      if (command.type === "M" || command.type === "L") {
        return `${command.type} ${formatNumber(command.to.x)} ${formatNumber(command.to.y)}`;
      }
      return `C ${formatNumber(command.cp1.x)} ${formatNumber(command.cp1.y)} ${formatNumber(command.cp2.x)} ${formatNumber(command.cp2.y)} ${formatNumber(command.to.x)} ${formatNumber(command.to.y)}`;
    })
    .join(" ");
}
