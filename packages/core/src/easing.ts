import type { Easing } from "./types.js";

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

const SPRING_DECAY = 7;
const SPRING_ANGULAR_FREQUENCY = 12;

function springRaw(x: number): number {
  return 1 - Math.exp(-SPRING_DECAY * x) * (
    Math.cos(SPRING_ANGULAR_FREQUENCY * x) +
    (SPRING_DECAY / SPRING_ANGULAR_FREQUENCY) * Math.sin(SPRING_ANGULAR_FREQUENCY * x)
  );
}

const SPRING_END = springRaw(1);

function cubicCoordinate(t: number, a1: number, a2: number): number {
  const omt = 1 - t;
  return 3 * omt * omt * t * a1 + 3 * omt * t * t * a2 + t * t * t;
}

function cubicDerivative(t: number, a1: number, a2: number): number {
  const omt = 1 - t;
  return 3 * omt * omt * a1 + 6 * omt * t * (a2 - a1) + 3 * t * t * (1 - a2);
}

/**
 * CSS-compatible cubic-bezier easing evaluated with a fixed deterministic
 * Newton/bisection solve. No frame history or browser easing APIs are used.
 */
function cubicBezierEase(easing: Extract<Easing, { type: "cubicBezier" }>, x: number): number {
  if (x === 0 || x === 1) return x;
  let t = x;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const error = cubicCoordinate(t, easing.x1, easing.x2) - x;
    const derivative = cubicDerivative(t, easing.x1, easing.x2);
    if (Math.abs(error) <= 1e-8 || Math.abs(derivative) <= 1e-8) break;
    t = clamp01(t - error / derivative);
  }

  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const currentX = cubicCoordinate(t, easing.x1, easing.x2);
    if (Math.abs(currentX - x) <= 1e-9) break;
    if (currentX < x) low = t;
    else high = t;
    t = (low + high) / 2;
  }
  return cubicCoordinate(t, easing.y1, easing.y2);
}

export function ease(easing: Easing | undefined, t: number): number {
  const x = clamp01(t);
  if (typeof easing === "object") return cubicBezierEase(easing, x);
  switch (easing) {
    case "easeIn": return x * x;
    case "easeOut": return 1 - (1 - x) * (1 - x);
    case "easeInOut": return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    case "spring":
      if (x === 0 || x === 1) return x;
      return springRaw(x) / SPRING_END;
    default: return x;
  }
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function lerpColor(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const parse = (value: string): [number, number, number, number] | null => {
    const named: Record<string, string> = { black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00", orange: "#ffa500", purple: "#800080", transparent: "#00000000" };
    const source = named[value.toLowerCase()] ?? value;
    let hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(source)?.[1];
    if (hex) {
      if (hex.length < 5) hex = [...hex].map(c => c + c).join("");
      return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16), hex.length === 8 ? Number.parseInt(hex.slice(6), 16) / 255 : 1];
    }
    const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(source);
    if (!rgb) return null;
    const channels = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])] as [number, number, number, number];
    return channels.every(Number.isFinite) ? channels : null;
  };
  const ca = parse(a), cb = parse(b);
  if (!ca || !cb) return t < 1 ? a : b;
  const c = ca.slice(0, 3).map((v, i) => Math.round(Math.max(0, Math.min(255, lerp(v, cb[i]!, t)))));
  const alpha = clamp01(lerp(ca[3], cb[3], t));
  if (alpha < 1) return `rgba(${c.join(",")},${Number(alpha.toFixed(6))})`;
  return `#${c.map(v => v.toString(16).padStart(2, "0")).join("")}`;
}
