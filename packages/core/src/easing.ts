import type { EasingName } from "./types.js";

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

export function ease(name: EasingName | undefined, t: number): number {
  const x = clamp01(t);
  switch (name) {
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
  const parse = (value: string): [number, number, number] | null => {
    const m = /^#([0-9a-f]{6})$/i.exec(value);
    if (!m?.[1]) return null;
    const n = Number.parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const ca = parse(a), cb = parse(b);
  if (!ca || !cb) return t < 1 ? a : b;
  const c = ca.map((v, i) => Math.round(lerp(v, cb[i]!, t)));
  return `#${c.map(v => v.toString(16).padStart(2, "0")).join("")}`;
}
