import { connectorGeometry } from "./connector-geometry.js";
import { applyMatrix, objectBounds, worldMatrix, worldOpacity, worldVisible, type Bounds } from "./geometry.js";
import { DIAGRAM_TONES } from "./palette.js";
import { fitText, type TextMeasure } from "./text-layout.js";
import type { DrawableObject, EvaluatedScene } from "./types.js";

/**
 * Design lint: checks the things that make a diagram look accidental rather
 * than designed. It runs on an evaluated frame (lint the final frame, and any
 * frame you care about) and never changes the scene.
 */
export type DesignLintCode =
  | "SHAPES_OVERLAP"
  | "SHAPES_CROWDED"
  | "CONNECTOR_TOO_SHORT"
  | "OUTSIDE_CANVAS"
  | "LABEL_OVERFLOW"
  | "TONE_MISMATCH"
  | "TOO_MANY_TONES";

export interface DesignLintIssue {
  code: DesignLintCode;
  objects: string[];
  message: string;
}

export interface DesignLintOptions {
  /** Minimum clear space between shapes, in px. Default 24. */
  minGap?: number;
  /** Minimum visible connector length, in px. Default 28. */
  minConnectorLength?: number;
  /** Maximum distinct accent tones (non-neutral palette fills). Default 4. */
  maxTones?: number;
  /** Margin shapes and text must keep from the canvas edge, in px. Default 8. */
  margin?: number;
  /** Width measure for label fitting; skip label checks when omitted. */
  measure?: TextMeasure;
  /** Ids of shapes meant to overlap or touch others (Venn sets, badges, activation bars). */
  allowOverlap?: readonly string[];
}

const SHAPES = new Set(["rect", "circle", "ellipse", "polygon", "image"]);
const LABEL_PADDING = 12;

function worldBounds(object: DrawableObject, objects: ReadonlyMap<string, DrawableObject>): Bounds {
  const local = objectBounds(object);
  const matrix = worldMatrix(object, objects);
  const corners = [
    { x: local.minX, y: local.minY }, { x: local.maxX, y: local.minY },
    { x: local.maxX, y: local.maxY }, { x: local.minX, y: local.maxY },
  ].map(point => applyMatrix(matrix, point));
  return {
    minX: Math.min(...corners.map(p => p.x)), minY: Math.min(...corners.map(p => p.y)),
    maxX: Math.max(...corners.map(p => p.x)), maxY: Math.max(...corners.map(p => p.y)),
  };
}

function gapBetween(a: Bounds, b: Bounds): number {
  const dx = Math.max(a.minX - b.maxX, b.minX - a.maxX, 0);
  const dy = Math.max(a.minY - b.maxY, b.minY - a.maxY, 0);
  if (dx === 0 && dy === 0) {
    // Overlapping: report the negative penetration depth.
    return -Math.min(a.maxX - b.minX, b.maxX - a.minX, a.maxY - b.minY, b.maxY - a.minY);
  }
  return Math.hypot(dx, dy);
}

function contains(outer: Bounds, inner: Bounds): boolean {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;
}

const toneByFill = new Map(Object.entries(DIAGRAM_TONES).map(([name, tone]) => [tone.fill.toLowerCase(), { name, ...tone }]));

export function lintDesign(frame: EvaluatedScene, options: DesignLintOptions = {}): DesignLintIssue[] {
  const minGap = options.minGap ?? 24;
  const minConnector = options.minConnectorLength ?? 28;
  const maxTones = options.maxTones ?? 4;
  const margin = options.margin ?? 8;
  const allowOverlap = new Set(options.allowOverlap ?? []);
  const issues: DesignLintIssue[] = [];
  const objects = new Map(frame.objects.map(object => [object.id, object] as const));
  const shown = (object: DrawableObject) => worldVisible(object, objects) && worldOpacity(object, objects) > 0.05;
  const shapes = frame.objects
    .filter(object => SHAPES.has(object.type) && shown(object))
    .map(object => ({ object, bounds: worldBounds(object, objects) }));

  // Spacing. Shapes nested inside another (badges, bar labels in a frame) are intentional.
  for (let i = 0; i < shapes.length; i += 1) {
    for (let j = i + 1; j < shapes.length; j += 1) {
      const a = shapes[i]!;
      const b = shapes[j]!;
      if (contains(a.bounds, b.bounds) || contains(b.bounds, a.bounds)) continue;
      if (allowOverlap.has(a.object.id) || allowOverlap.has(b.object.id)) continue;
      const gap = gapBetween(a.bounds, b.bounds);
      if (gap < 0) {
        issues.push({ code: "SHAPES_OVERLAP", objects: [a.object.id, b.object.id], message: `'${a.object.id}' and '${b.object.id}' overlap by ${Math.round(-gap)}px.` });
      } else if (gap < minGap) {
        issues.push({ code: "SHAPES_CROWDED", objects: [a.object.id, b.object.id], message: `'${a.object.id}' and '${b.object.id}' are ${Math.round(gap)}px apart; leave at least ${minGap}px.` });
      }
    }
  }

  // Connectors must leave room for a readable line and arrowhead.
  for (const object of frame.objects) {
    if (object.type !== "connector" || !shown(object)) continue;
    const geometry = connectorGeometry(object, objects);
    if (!geometry) continue;
    const length = geometry.kind === "cubic"
      ? Math.hypot(geometry.to.x - geometry.from.x, geometry.to.y - geometry.from.y)
      : geometry.points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - geometry.points[index]!.x, point.y - geometry.points[index]!.y), 0);
    if (length < minConnector) {
      issues.push({ code: "CONNECTOR_TOO_SHORT", objects: [object.id], message: `Connector '${object.id}' is only ${Math.round(length)}px long between shapes; move them at least ${minConnector}px apart.` });
    }
  }

  // Canvas bounds (shapes only; text is checked through its estimated box when a measure exists).
  const canvas = { minX: margin, minY: margin, maxX: frame.scene.width - margin, maxY: frame.scene.height - margin };
  for (const { object, bounds } of shapes) {
    if (!contains(canvas, bounds)) {
      issues.push({ code: "OUTSIDE_CANVAS", objects: [object.id], message: `'${object.id}' extends past the canvas margin.` });
    }
  }

  if (options.measure) {
    for (const object of frame.objects) {
      if (!shown(object)) continue;
      const text = "text" in object ? object.text : undefined;
      if (!text) continue;
      const size = object.style.fontSize ?? 16;
      if (object.type === "text") {
        const width = Math.max(...text.split(/\r?\n/).map(line => options.measure!(line, size)));
        const x = object.transform.x;
        if (x - width / 2 < margin || x + width / 2 > frame.scene.width - margin) {
          issues.push({ code: "OUTSIDE_CANVAS", objects: [object.id], message: `Text '${object.id}' is wider than the canvas allows at ${size}px.` });
        }
        continue;
      }
      const box = object.type === "rect"
        ? { width: object.width, height: object.height }
        : object.type === "circle"
          ? { width: object.radius * Math.SQRT2 + LABEL_PADDING * 2, height: object.radius * Math.SQRT2 + LABEL_PADDING }
          : object.type === "ellipse"
            ? { width: object.rx * Math.SQRT2 + LABEL_PADDING * 2, height: object.ry * Math.SQRT2 + LABEL_PADDING }
            : undefined;
      if (!box) continue;
      const fit = fitText(text, { maxWidth: box.width - LABEL_PADDING * 2, maxHeight: box.height - LABEL_PADDING, fontSize: size, measure: options.measure });
      if (fit.overflow) {
        issues.push({ code: "LABEL_OVERFLOW", objects: [object.id], message: `Label of '${object.id}' does not fit; enlarge the shape or shorten the text.` });
      }
    }
  }

  // Colour discipline: palette fills must use their own tone's stroke, and few accents.
  const accents = new Set<string>();
  for (const { object } of shapes) {
    const fill = object.style.fill?.toLowerCase();
    const tone = fill ? toneByFill.get(fill) : undefined;
    if (!tone) continue;
    if (tone.name !== "neutral") accents.add(tone.name);
    const stroke = object.style.stroke?.toLowerCase();
    if (stroke && stroke !== "none" && stroke !== tone.stroke.toLowerCase()) {
      issues.push({ code: "TONE_MISMATCH", objects: [object.id], message: `'${object.id}' uses the ${tone.name} fill with a different stroke; use ${tone.stroke}.` });
    }
  }
  if (accents.size > maxTones) {
    issues.push({ code: "TOO_MANY_TONES", objects: [], message: `${accents.size} accent tones (${[...accents].join(", ")}); use at most ${maxTones} and let colour carry meaning.` });
  }

  return issues;
}
