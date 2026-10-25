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

function linePass(
  from: SketchPoint,
  to: SketchPoint,
  context: Required<SketchContext>,
  key: string,
  pass: number,
): SketchPath {
  const passKey = `${key}:pass:${pass}`;
  const endpointAmount = context.roughness * 0.35;
  const start = jitterPoint(from, context, `${passKey}:start`, endpointAmount);
  const end = jitterPoint(to, context, `${passKey}:end`, endpointAmount);

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return { commands: [{ type: "M", to: start }, { type: "L", to: end }] };
  }

  const nx = -dy / length;
  const ny = dx / length;
  const bendLimit = Math.min(length * 0.03, context.roughness * 4);
  const bend =
    sketchJitter(context.seed, context.objectId, `${passKey}:bend`, bendLimit) *
    context.bowing;

  const cpNoise = context.roughness * 0.6;
  const cp1Base = {
    x: from.x + dx / 3 + nx * bend,
    y: from.y + dy / 3 + ny * bend,
  };
  const cp2Base = {
    x: from.x + (dx * 2) / 3 + nx * bend,
    y: from.y + (dy * 2) / 3 + ny * bend,
  };
  const cp1 = jitterPoint(cp1Base, context, `${passKey}:cp1`, cpNoise);
  const cp2 = jitterPoint(cp2Base, context, `${passKey}:cp2`, cpNoise);

  return {
    commands: [
      { type: "M", to: start },
      { type: "C", cp1, cp2, to: end },
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

function ellipsePoint(cx: number, cy: number, rx: number, ry: number, angle: number): SketchPoint {
  return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
}

/**
 * Four cubic segments per pass, with deterministic local perturbation.
 * This is intentionally geometry-only; stroke color/width stay renderer-owned.
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

  const paths: SketchPath[] = [];
  const pointAmount = normalized.roughness * 0.35;
  const controlAmount = normalized.roughness * 0.55;

  for (let pass = 0; pass < normalized.passes; pass += 1) {
    const passKey = `${key}:pass:${pass}`;
    const anchors = Array.from({ length: 4 }, (_, index) =>
      jitterPoint(
        ellipsePoint(cx, cy, rx, ry, (index * TAU) / 4),
        normalized,
        `${passKey}:anchor:${index}`,
        pointAmount,
      ),
    );

    const commands: SketchPathCommand[] = [{ type: "M", to: anchors[0]! }];

    for (let segment = 0; segment < 4; segment += 1) {
      const angle = (segment * TAU) / 4;
      const nextAngle = ((segment + 1) * TAU) / 4;
      const start = anchors[segment]!;
      const end = anchors[(segment + 1) % 4]!;

      const cp1Base = {
        x: start.x - Math.sin(angle) * rx * ELLIPSE_KAPPA,
        y: start.y + Math.cos(angle) * ry * ELLIPSE_KAPPA,
      };
      const cp2Base = {
        x: end.x + Math.sin(nextAngle) * rx * ELLIPSE_KAPPA,
        y: end.y - Math.cos(nextAngle) * ry * ELLIPSE_KAPPA,
      };

      commands.push({
        type: "C",
        cp1: jitterPoint(cp1Base, normalized, `${passKey}:cp1:${segment}`, controlAmount),
        cp2: jitterPoint(cp2Base, normalized, `${passKey}:cp2:${segment}`, controlAmount),
        to: end,
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
