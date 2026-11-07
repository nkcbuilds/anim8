/**
 * Anim8 teaching catalog: deterministic generator for 150 curated explainers.
 *
 * Each data record includes a title, a meaningful diagram topology, four
 * subject-specific labeled entities, and four factual teaching steps. The
 * generator turns these into serializable, independently usable v1 scenes in
 * the hand-drawn ("sketch") theme.
 *
 * Visual rules (see docs/guides/visual-style.md):
 * - Colour encodes a node's role in the flow, never its index. A start node is
 *   blue, intermediate work is neutral, a gate is yellow, a result is green,
 *   and siblings share a tone. At most three accent tones per scene.
 * - Every stroke/fill pair comes from one palette tone.
 * - Nodes keep at least 48px of clear space so arrows are always readable.
 * - Nodes start dimmed and are revealed one teaching step at a time.
 *
 * Requires built packages (pnpm build): layout uses the real font metrics and
 * connector geometry. No random values, timestamps, or remote assets.
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DIAGRAM_BACKGROUND,
  DIAGRAM_INK,
  DIAGRAM_SUBTLE,
  DIAGRAM_TONES,
  connectorGeometry,
  defaultStyle,
  defaultTransform,
} from "../../packages/core/dist/index.js";
import { measureSketchText } from "../../packages/renderer-sketch/dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = here;
const checkMode = process.argv.includes("--check");
const categories = ["computing", "science", "workflows"];
const stepDuration = 900;
const caption = "#495057";
const highlighter = "#ffec99";

// Node footprints.
const RECT = { w: 168, h: 72 };
const WIDE = { w: 320, h: 60 };
const HUB = { r: 66 };

/** Tone sequences by flow position; see the header comment for the rules. */
const flowTones = ["blue", "neutral", "neutral", "green"];

/**
 * Per-topology layout. Coordinates are node centres on the 1000x560 canvas;
 * the diagram band is y 110-420, below the title and above the caption.
 */
const layouts = {
  pipeline: { nodes: row(265), edges: chain(), tones: flowTones },
  queue: { nodes: row(265), edges: chain(), tones: flowTones },
  timeline: { nodes: row(265), edges: chain(), tones: flowTones },
  equation: { nodes: row(265), edges: [[0, 1], [1, 2]], tones: flowTones, operator: "=" },
  sequence: {
    nodes: [[140, 170], [380, 230], [620, 300], [860, 360]].map(rect),
    edges: chain(), kind: "curve", tones: flowTones,
  },
  ladder: {
    nodes: [[170, 370], [390, 290], [610, 210], [830, 130]].map(rect),
    edges: chain(), kind: "curve", tones: flowTones,
  },
  cycle: {
    nodes: [[300, 165], [700, 165], [700, 365], [300, 365]].map(rect),
    edges: [[0, 1], [1, 2], [2, 3], [3, 0]], tones: ["blue", "neutral", "neutral", "neutral"],
  },
  tree: {
    nodes: [[500, 150], [290, 265], [710, 265], [500, 380]].map(rect),
    edges: [[0, 1], [0, 2], [1, 3], [2, 3]], tones: flowTones,
  },
  branch: {
    nodes: [[150, 265], [410, 265], [760, 165], [760, 365]].map(rect),
    edges: [[0, 1], [1, 2], [1, 3]], kind: "curve", tones: ["blue", "yellow", "green", "green"],
  },
  decision: {
    nodes: [[150, 265], [410, 265], [760, 165], [760, 365]].map(rect),
    edges: [[0, 1], [1, 2], [1, 3]], kind: "curve", tones: ["blue", "yellow", "green", "green"],
  },
  hub: {
    nodes: [hub(500, 265), rect([170, 165]), rect([170, 365]), rect([830, 265])],
    edges: [[1, 0], [2, 0], [0, 3]], kind: "curve", tones: ["yellow", "blue", "blue", "green"],
  },
  orbit: {
    nodes: [hub(500, 265), rect([170, 165]), rect([170, 365]), rect([830, 265])],
    edges: [[1, 0], [2, 0], [0, 3]], kind: "curve", tones: ["yellow", "blue", "blue", "green"],
  },
  network: {
    nodes: [[280, 165], [720, 165], [280, 365], [720, 365]].map(rect),
    edges: [[0, 1], [0, 2], [1, 3], [2, 3]], tones: flowTones,
  },
  grid: {
    nodes: [[280, 165], [720, 165], [280, 365], [720, 365]].map(rect),
    edges: [[0, 1], [0, 2], [1, 3], [2, 3]], tones: flowTones,
  },
  compare: {
    nodes: [[280, 165], [720, 165], [280, 365], [720, 365]].map(rect),
    edges: [[0, 2], [1, 3]], tones: ["blue", "violet", "blue", "violet"],
  },
  triangle: {
    nodes: [[220, 385], [780, 385], [500, 140], [500, 280]].map(rect),
    edges: [[0, 1], [1, 2], [2, 0], [2, 3]], tones: ["blue", "blue", "blue", "green"],
  },
  balance: {
    nodes: [[220, 200], [500, 370], [780, 200], [500, 150]].map(rect),
    edges: [[0, 1], [2, 1], [3, 1]], tones: ["blue", "green", "blue", "neutral"],
  },
  stack: {
    nodes: [150, 222, 294, 366].map(y => ({ shape: "rect", x: 500, y, ...WIDE })),
    edges: [], tones: flowTones,
  },
  layers: {
    nodes: [150, 222, 294, 366].map(y => ({ shape: "rect", x: 500, y, ...WIDE })),
    edges: [], tones: flowTones,
  },
  funnel: {
    nodes: [[440, 150], [350, 222], [260, 294], [180, 366]].map(([w, y]) => ({ shape: "rect", x: 500, y, w, h: 60 })),
    edges: [], tones: flowTones,
  },
  chart: {
    nodes: [94, 140, 186, 128].map((h, i) => ({ shape: "rect", x: 200 + i * 200, y: 380 - h / 2, w: 120, h, radius: 6 })),
    edges: [], tones: ["blue", "blue", "green", "blue"], bars: true,
  },
};

function rect([x, y]) { return { shape: "rect", x, y, ...RECT }; }
function hub(x, y) { return { shape: "circle", x, y, ...HUB }; }
function row(y) { return [140, 380, 620, 860].map(x => rect([x, y])); }
function chain() { return [[0, 1], [1, 2], [2, 3]]; }

const transform = (x, y, extra = {}) => ({ x, y, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, ...extra });
const textStyle = (fontSize, color = DIAGRAM_INK) => ({ fill: "none", stroke: "none", strokeWidth: 0, color, fontSize });

function text(id, content, x, y, fontSize, color, options = {}) {
  return {
    id, type: "text", text: content, description: options.description,
    transform: transform(x, y), style: textStyle(fontSize, color),
    visible: options.visible ?? true, z: options.z ?? 10,
  };
}

function headingSize(title) {
  for (const size of [32, 30, 28, 26, 24]) if (measureSketchText(title, size) <= 880) return size;
  return 22;
}

function nodeObject(id, label, spec, toneName) {
  const tone = DIAGRAM_TONES[toneName];
  const base = {
    id, description: label, visible: true, z: 3,
    // Dimmed until its teaching step reveals it.
    transform: transform(spec.x, spec.y, { opacity: 0.22 }),
    style: { fill: "#ffffff", stroke: DIAGRAM_SUBTLE, strokeWidth: 2, color: DIAGRAM_INK, fontSize: 20 },
    metadata: { tone: toneName },
  };
  if (spec.shape === "circle") return { ...base, type: "circle", radius: spec.r, text: label };
  const node = { ...base, type: "rect", width: spec.w, height: spec.h };
  if (spec.radius !== undefined) node.style.radius = spec.radius;
  return spec.bars ? node : { ...node, text: label };
}

/** Sample a connector's real (outline-clipped) geometry for the travelling token. */
function tokenPath(connector, objects, fromCenter, toCenter) {
  const geometry = connectorGeometry(connector, objects);
  const round = p => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
  let along;
  if (geometry.kind === "cubic") {
    const { from, cp1, cp2, to } = geometry;
    along = Array.from({ length: 9 }, (_, i) => {
      const t = i / 8, u = 1 - t;
      return {
        x: u * u * u * from.x + 3 * u * u * t * cp1.x + 3 * u * t * t * cp2.x + t * t * t * to.x,
        y: u * u * u * from.y + 3 * u * u * t * cp1.y + 3 * u * t * t * cp2.y + t * t * t * to.y,
      };
    });
  } else {
    along = geometry.points;
  }
  return [fromCenter, ...along, toCenter].map(round);
}

function makeScene(topic, seed) {
  const { title, pattern, entities, steps } = topic;
  const layout = layouts[pattern];
  const size = headingSize(title);
  const headingWidth = measureSketchText(title, size);
  const objects = [
    {
      id: "title_highlight", type: "path",
      d: `M 0 0 C ${f(headingWidth * 0.3)} -3 ${f(headingWidth * 0.7)} 3 ${f(headingWidth + 16)} -1`,
      drawProgress: 0, transform: transform(500 - headingWidth / 2 - 8, 48 + size * 0.42),
      style: { fill: "none", stroke: highlighter, strokeWidth: 10 }, visible: true, z: 9,
      description: "Highlighter stroke under the title",
    },
    text("heading", title, 500, 48, size, DIAGRAM_INK),
  ];

  const centers = layout.nodes.map(spec => ({ x: spec.x, y: spec.y }));
  for (let i = 0; i < 4; i++) {
    const spec = { ...layout.nodes[i], bars: layout.bars };
    objects.push(nodeObject(`concept_${i}`, entities[i], spec, layout.tones[i]));
    if (layout.bars) {
      const label = text(`bar_label_${i}`, entities[i], spec.x, 408, 17, caption);
      label.transform.opacity = 0.3;
      objects.push(label);
    }
    objects.push(text(`stage_${i}`, `Step ${i + 1} · ${steps[i]}`, 500, 482, 20, caption,
      { visible: false, description: steps[i] }));
  }
  if (layout.operator) {
    objects.push(text("operator", layout.operator, (centers[2].x + centers[3].x) / 2, centers[2].y, 32, DIAGRAM_INK, { z: 4 }));
  }

  const connectors = layout.edges.map(([from, to], k) => ({
    id: `link_${k}`, type: "connector",
    from: { objectId: `concept_${from}`, anchor: "center" },
    to: { objectId: `concept_${to}`, anchor: "center" },
    kind: layout.kind ?? "straight",
    transform: transform(0, 0, { opacity: 0.18 }),
    style: { fill: "none", stroke: DIAGRAM_INK, strokeWidth: 2, color: DIAGRAM_INK },
    visible: true, z: 1,
  }));
  objects.push(...connectors);

  const hasToken = connectors.length > 0;
  if (hasToken) {
    objects.push({
      id: "token", type: "circle", radius: 6,
      transform: transform(centers[0].x, centers[0].y, { opacity: 0 }),
      style: { fill: DIAGRAM_TONES.blue.stroke, stroke: DIAGRAM_TONES.blue.stroke, strokeWidth: 1.5 },
      visible: true, z: 2, description: "Token travelling along the active connection",
    });
  }

  // Geometry lookup with every object at its final size, for token paths.
  const lookup = new Map(objects.map(o => [o.id, { ...defaultStyleObject(o) }]));

  const timeline = [{ id: "draw_title_highlight", type: "draw", target: "title_highlight",
    start: 0, duration: 700, easing: "easeOut", to: 1 }];
  const markers = [];
  let tokenAt = 0;
  for (let i = 0; i < 4; i++) {
    const start = i * stepDuration;
    const tone = DIAGRAM_TONES[layout.tones[i]];
    const target = `concept_${i}`;
    markers.push({ id: `marker_${i}`, label: `Step ${i + 1}: ${entities[i]}`, time: start });
    // The first step is already in place at t=0, so the poster frame is never empty.
    const fade = i === 0 ? 0 : 320, tint = i === 0 ? 0 : 380;
    timeline.push(
      { id: `reveal_${i}`, type: "opacity", target, start, duration: fade, easing: "easeOut", to: 1 },
      { id: `fill_${i}`, type: "fill", target, start, duration: tint, easing: "easeInOut", to: tone.fill },
      { id: `stroke_${i}`, type: "stroke", target, start, duration: tint, easing: "easeInOut", to: tone.stroke },
      { id: `pop_${i}`, type: "scale", target, start: start + 120, duration: 200, easing: "easeOut", to: { x: 1.06, y: 1.06 } },
      { id: `settle_${i}`, type: "scale", target, start: start + 340, duration: 260, easing: "spring", to: { x: 1, y: 1 } },
    );
    if (layout.bars) {
      timeline.push({ id: `reveal_bar_label_${i}`, type: "opacity", target: `bar_label_${i}`, start, duration: i === 0 ? 0 : 320, easing: "easeOut", to: 1 });
      timeline.push({ id: `grow_${i}`, type: "resize", target, start: start + 120, duration: 420, easing: "easeOut",
        to: { width: layout.nodes[i].w, height: layout.nodes[i].h + 24 } });
    }
    timeline.push({ id: `show_stage_${i}`, type: "visibility", target: `stage_${i}`, start, duration: 0, visible: true });
    if (i > 0) timeline.push({ id: `hide_stage_${i - 1}`, type: "visibility", target: `stage_${i - 1}`, start, duration: 0, visible: false });

    // Reveal each connection once both of its ends are visible.
    connectors.forEach((connector, k) => {
      const [a, b] = layout.edges[k];
      if (Math.max(a, b) === i) {
        timeline.push({ id: `reveal_link_${k}`, type: "opacity", target: connector.id, start, duration: i === 0 ? 0 : 320, easing: "easeOut", to: 1 });
      }
    });

    // The token travels the connection that leads into this step's node.
    const incoming = layout.edges.findIndex(([a, b]) => b === i && a < i);
    if (hasToken && i > 0 && incoming >= 0) {
      const source = layout.edges[incoming][0];
      const connector = connectors[incoming];
      if (i === 1) {
        timeline.push({ id: "token_show", type: "opacity", target: "token", start, duration: 120, easing: "linear", to: 1 });
      }
      const straight = connector.kind === "straight" && source === tokenAt;
      if (straight) {
        timeline.push({ id: `token_move_${i}`, type: "move", target: "token", start: start + 40, duration: 420,
          easing: "easeInOut", to: centers[i] });
      } else {
        timeline.push({ id: `token_path_${i}`, type: "followPath", target: "token", start: start + 40, duration: 420,
          easing: "easeInOut", points: tokenPath(connector, lookup, centers[source], centers[i]) });
      }
      tokenAt = i;
    }
  }

  return {
    version: "1.0",
    scene: { width: 1000, height: 560, theme: "sketch", background: DIAGRAM_BACKGROUND, seed },
    objects, timeline, markers,
  };
}

/** Objects as the evaluator sees them once revealed (full opacity, default fields). */
function defaultStyleObject(object) {
  return {
    ...object,
    style: { ...defaultStyle(), ...object.style },
    transform: { ...defaultTransform(), ...object.transform, opacity: 1 },
  };
}

function f(value) { return Math.round(value * 10) / 10; }

function readCategory(category) {
  const lines = readFileSync(join(here, "data", category + ".txt"), "utf8")
    .split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return lines.map((line, lineIndex) => {
    const parts = line.split("|");
    if (parts.length !== 5) throw new Error(`${category} line ${lineIndex + 1}: expected five pipe-delimited fields`);
    const [slug, title, pattern, entityText, stepText] = parts;
    const entities = entityText.split(";").map(s => s.trim());
    const steps = stepText.split(";").map(s => s.trim());
    if (!/^[a-z0-9-]+$/.test(slug) || !layouts[pattern] ||
      entities.length !== 4 || steps.length !== 4 ||
      [...entities, ...steps].some(s => s.length < 3)) {
      throw new Error(`${category} line ${lineIndex + 1}: invalid slug, pattern, four entity names or four teaching steps`);
    }
    return { category, slug, title, pattern, entities, steps };
  });
}

const topics = categories.flatMap(readCategory);
if (topics.length < 100 || topics.length > 200) throw new Error(`Expected 100-200 examples, found ${topics.length}`);
if (new Set(topics.map(t => t.slug)).size !== topics.length) throw new Error("Duplicate slugs in catalog");
const manifest = [];
for (let index = 0; index < topics.length; index++) {
  const topic = topics[index];
  const rel = join(topic.category, topic.slug, "scene.json");
  const out = join(here, rel);
  const scene = makeScene(topic, index + 1);
  const expected = JSON.stringify(scene, null, 2) + "\n";
  if (checkMode) {
    if (!existsSync(out) || readFileSync(out, "utf8") !== expected) throw new Error(`Out-of-date generated scene: ${rel}. Run pnpm catalog:generate`);
  } else {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, expected, "utf8");
  }
  manifest.push({ id: topic.slug, category: topic.category, title: topic.title, pattern: topic.pattern,
    description: topic.steps.join(" "), entities: topic.entities, steps: topic.steps,
    durationMs: 3 * stepDuration + 600, file: relative(root, out).split("\\").join("/") });
}
const manifestFile = join(here, "index.json");
const manifestExpected = JSON.stringify({ version: 1, count: manifest.length, examples: manifest }, null, 2) + "\n";
if (checkMode) {
  if (!existsSync(manifestFile) || readFileSync(manifestFile, "utf8") !== manifestExpected) throw new Error("Out-of-date catalog manifest. Run pnpm catalog:generate");
} else writeFileSync(manifestFile, manifestExpected, "utf8");
console.log(`${checkMode ? "Verified" : "Generated"} ${topics.length} independently usable animated explainers (${categories.map(x => x + ":" + topics.filter(t => t.category === x).length).join(", ")})`);
