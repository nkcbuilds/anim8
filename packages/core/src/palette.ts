/**
 * Curated diagram palette.
 *
 * Every tone is a matched pair: a saturated stroke and a light fill of the same
 * hue (values from Open Color, MIT). Using the pair together is what keeps a
 * diagram coherent; mixing a fill from one tone with a stroke from another is
 * the most common cause of "random-looking" diagrams.
 *
 * Tones are named by colour, and `DIAGRAM_ROLES` maps the meaning a node has in
 * an explanation to a tone. Prefer choosing a role; reach for a raw tone only
 * when a diagram needs a category the roles do not cover.
 */
export interface DiagramTone {
  /** Outline / emphasis colour. */
  stroke: string;
  /** Light background colour for shapes. */
  fill: string;
}

export const DIAGRAM_INK = "#1e1e1e";
export const DIAGRAM_MUTED = "#868e96";
export const DIAGRAM_SUBTLE = "#ced4da";
export const DIAGRAM_BACKGROUND = "#ffffff";

export const DIAGRAM_TONES = Object.freeze({
  neutral: Object.freeze({ stroke: DIAGRAM_INK, fill: "#f1f3f5" }),
  blue: Object.freeze({ stroke: "#1971c2", fill: "#a5d8ff" }),
  green: Object.freeze({ stroke: "#2f9e44", fill: "#b2f2bb" }),
  yellow: Object.freeze({ stroke: "#e8590c", fill: "#ffec99" }),
  red: Object.freeze({ stroke: "#e03131", fill: "#ffc9c9" }),
  violet: Object.freeze({ stroke: "#6741d9", fill: "#d0bfff" }),
  teal: Object.freeze({ stroke: "#0c8599", fill: "#99e9f2" }),
}) satisfies Readonly<Record<string, DiagramTone>>;

export type DiagramToneName = keyof typeof DIAGRAM_TONES;

/**
 * Semantic roles. A diagram should normally use two or three of these, so the
 * colour of a node tells the reader what kind of thing it is.
 */
export const DIAGRAM_ROLES = Object.freeze({
  /** Where a flow starts: users, requests, raw inputs. */
  input: "blue",
  /** Ordinary work in the middle of a flow. */
  process: "neutral",
  /** A branch point, gate, or check. */
  decision: "yellow",
  /** A result, success state, or final product. */
  output: "green",
  /** Errors, failures, risks. */
  risk: "red",
  /** Storage, state, shared resources. */
  store: "violet",
  /** External systems and third parties. */
  external: "teal",
} as const satisfies Record<string, DiagramToneName>);

export type DiagramRole = keyof typeof DIAGRAM_ROLES;

export function diagramTone(role: DiagramRole | DiagramToneName): DiagramTone {
  const tone = (role in DIAGRAM_ROLES ? DIAGRAM_ROLES[role as DiagramRole] : role) as DiagramToneName;
  return DIAGRAM_TONES[tone];
}
