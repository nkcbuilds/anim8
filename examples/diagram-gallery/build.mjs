/**
 * Diagram gallery: one hand-drawn scene per common diagram type, each animated
 * with Excalidraw-style draw-on beats. The scenes follow
 * docs/guides/visual-style.md and must pass lintDesign; see tests/gallery.
 *
 *   pnpm build && node examples/diagram-gallery/build.mjs [--check]
 *
 * Deterministic: no random values, timestamps, or network access.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIAGRAM_INK, DIAGRAM_MUTED, DIAGRAM_SUBTLE, DIAGRAM_TONES as T } from "../../packages/core/dist/index.js";
import { layoutDagre } from "../../packages/layout-dagre/dist/index.js";
import { measureSketchText } from "../../packages/renderer-sketch/dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const check = process.argv.includes("--check");
const CAPTION = "#495057";
const HIGHLIGHT = "#ffec99";
const DRAWABLE = new Set(["rect", "circle", "ellipse", "polygon", "polyline", "path", "line", "connector"]);
const r1 = value => Math.round(value * 10) / 10;

class Diagram {
  constructor(slug, title, summary, { width = 1000, height = 600, seed = 1 } = {}) {
    Object.assign(this, { slug, title, summary, width, height, seed });
    this.objects = [];
    this.timeline = [];
    this.cursor = 0;
    this.allowOverlap = [];
    this.heading();
  }

  add(object) {
    this.objects.push({ transform: tf(0, 0), visible: true, ...object });
    return object;
  }

  heading() {
    const size = 30;
    const width = measureSketchText(this.title, size);
    const x = this.width / 2;
    this.add({ id: "title_highlight", type: "path", z: 9, drawProgress: 0,
      d: `M 0 0 C ${r1(width * 0.3)} -3 ${r1(width * 0.7)} 3 ${r1(width + 16)} -1`,
      transform: tf(x - width / 2 - 8, 46 + size * 0.42),
      style: { fill: "none", stroke: HIGHLIGHT, strokeWidth: 10 } });
    this.add({ id: "title", type: "text", text: this.title, z: 10, transform: tf(x, 46), style: textStyle(size, DIAGRAM_INK) });
    this.timeline.push({ id: "draw_title_highlight", type: "draw", target: "title_highlight", start: 0, duration: 600, easing: "easeOut", to: 1 });
    this.cursor = 350;
  }

  /** A labelled node. shape: rect | circle | ellipse | diamond. */
  node(id, label, x, y, { tone = "neutral", shape = "rect", w = 150, h = 60, r = 46, size = 18, radius, dashed, fill, stroke, z = 3 } = {}) {
    const t = T[tone];
    const style = { fill: fill ?? t.fill, stroke: stroke ?? t.stroke, strokeWidth: 2, color: DIAGRAM_INK, fontSize: size,
      ...(radius !== undefined ? { radius } : {}), ...(dashed ? { strokeStyle: dashed } : {}) };
    if (shape === "diamond") {
      this.add({ id, type: "polygon", z, transform: tf(x, y), style,
        points: [{ x: 0, y: -h / 2 }, { x: w / 2, y: 0 }, { x: 0, y: h / 2 }, { x: -w / 2, y: 0 }] });
      if (label) this.text(`${id}_label`, label, x, y, { size, z: z + 1, follow: id });
      return id;
    }
    const base = { id, z, transform: tf(x, y), style, ...(label ? { text: label } : {}) };
    if (shape === "circle") this.add({ ...base, type: "circle", radius: r });
    else if (shape === "ellipse") this.add({ ...base, type: "ellipse", rx: w / 2, ry: h / 2 });
    else this.add({ ...base, type: "rect", width: w, height: h });
    return id;
  }

  text(id, text, x, y, { size = 18, color = DIAGRAM_INK, z = 6, follow } = {}) {
    this.add({ id, type: "text", text, z, transform: tf(x, y), style: textStyle(size, color), ...(follow ? { follow } : {}) });
    return id;
  }

  edge(id, from, to, { kind = "straight", label, heads, dashed, color = DIAGRAM_INK, fromAnchor, toAnchor, width = 2, z = 1 } = {}) {
    this.add({ id, type: "connector", z, kind,
      from: { objectId: from, ...(fromAnchor ? { anchor: fromAnchor } : {}) },
      to: { objectId: to, ...(toAnchor ? { anchor: toAnchor } : {}) },
      ...(label ? { label } : {}), ...(heads ? { arrowheads: heads } : {}),
      style: { fill: "none", stroke: color, strokeWidth: width, color: DIAGRAM_INK, fontSize: 16, ...(dashed ? { strokeStyle: dashed } : {}) } });
    return id;
  }

  line(id, x1, y1, x2, y2, { color = DIAGRAM_SUBTLE, width = 2, dashed, z = 0 } = {}) {
    this.add({ id, type: "line", z, x2: x2 - x1, y2: y2 - y1, transform: tf(x1, y1),
      style: { fill: "none", stroke: color, strokeWidth: width, ...(dashed ? { strokeStyle: dashed } : {}) } });
    return id;
  }

  shape(object) {
    this.add({ z: 3, ...object });
    return object.id;
  }

  /** Invisible attachment point for connectors that start or end on a line. */
  anchor(id, x, y) {
    this.add({ id, type: "circle", radius: 1, z: 0, transform: { ...tf(x, y), opacity: 0 }, style: { fill: "none", stroke: "none", strokeWidth: 0 } });
    return id;
  }

  /** Reveal ids together: shapes and lines draw on; text fades in; connectors draw after the shapes they join. */
  beat(ids, { duration = 520, gap = 140 } = {}) {
    const start = this.cursor;
    for (const id of ids.flat()) {
      const object = this.objects.find(candidate => candidate.id === id);
      if (!object) throw new Error(`${this.slug}: unknown id ${id}`);
      const follower = this.objects.find(candidate => candidate.follow === id);
      if (DRAWABLE.has(object.type)) {
        object.drawProgress = 0;
        this.timeline.push({ id: `draw_${id}`, type: "draw", target: id, start, duration, easing: "easeInOut", to: 1 });
      } else {
        object.transform.opacity = 0;
        this.timeline.push({ id: `show_${id}`, type: "opacity", target: id, start: start + duration * 0.4, duration: duration * 0.6, easing: "easeOut", to: 1 });
      }
      if (follower) {
        follower.transform.opacity = 0;
        this.timeline.push({ id: `show_${follower.id}`, type: "opacity", target: follower.id, start: start + duration * 0.5, duration: duration * 0.5, easing: "easeOut", to: 1 });
      }
    }
    this.cursor = start + duration + gap;
    return this;
  }

  action(action) {
    this.timeline.push({ easing: "easeInOut", ...action });
    return this;
  }

  build() {
    const objects = this.objects.map(({ follow, ...object }) => object);
    return {
      version: "1.0",
      scene: { width: this.width, height: this.height, theme: "sketch", background: "#ffffff", seed: this.seed },
      objects,
      timeline: this.timeline,
    };
  }
}

function tf(x, y) { return { x: r1(x), y: r1(y), rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 }; }
function textStyle(fontSize, color) { return { fill: "none", stroke: "none", strokeWidth: 0, color, fontSize }; }

const diagrams = [];
const define = (slug, title, summary, options, build) => {
  const d = new Diagram(slug, title, summary, options);
  build(d);
  diagrams.push(d);
};

// 1. DAG laid out by Dagre ----------------------------------------------------
define("dag", "A CI pipeline is a directed acyclic graph", "Directed acyclic graph laid out with the Dagre adapter.", { width: 1100, height: 560, seed: 11 }, d => {
  const nodes = [
    ["commit", "Commit", "blue"], ["lint", "Lint", "yellow"], ["test", "Unit tests", "yellow"], ["types", "Type check", "yellow"],
    ["build", "Build", "neutral"], ["image", "Container image", "neutral"], ["docs", "Docs site", "neutral"], ["release", "Release", "green"],
  ];
  const edges = [["commit", "lint"], ["commit", "test"], ["commit", "types"], ["lint", "build"], ["test", "build"], ["types", "build"],
    ["build", "image"], ["build", "docs"], ["image", "release"], ["docs", "release"]];
  const W = 140, H = 58;
  const layout = layoutDagre([
    ...nodes.map(([id]) => ({ id, type: "rect", width: W, height: H, transform: tf(0, 0), style: {}, visible: true, z: 0 })),
    ...edges.map(([a, b], i) => ({ id: `e${i}`, type: "connector", from: { objectId: a }, to: { objectId: b }, kind: "straight", transform: tf(0, 0), style: {}, visible: true, z: 0 })),
  ], { direction: "left-right", nodeGap: 34, rankGap: 70 });
  const ox = (d.width - layout.width) / 2, oy = 100 + (440 - layout.height) / 2;
  for (const [id, label, tone] of nodes) {
    const p = layout.positions[id];
    d.node(id, label, ox + p.x, oy + p.y, { tone, w: W, h: H });
  }
  edges.forEach(([a, b], i) => d.edge(`e${i}`, a, b, { kind: "curve" }));
  d.beat(["commit"]).beat(["lint", "test", "types"]).beat(["e0", "e1", "e2"], { duration: 420 })
    .beat(["build"]).beat(["e3", "e4", "e5"], { duration: 420 }).beat(["image", "docs"])
    .beat(["e6", "e7"], { duration: 420 }).beat(["release"]).beat(["e8", "e9"], { duration: 420 });
});

// 2. Flowchart with a decision ------------------------------------------------
define("flowchart", "Orders ship only when stock is available", "Flowchart with terminators, a decision diamond and labelled branches.", { seed: 12 }, d => {
  // Leave room for the connector shaft and head between each stage.
  d.node("start", "New order", 380, 108, { shape: "ellipse", tone: "blue", w: 170, h: 54 });
  d.node("check", "Reserve items", 380, 209, { w: 170 });
  d.node("stock", "In stock?", 380, 329, { shape: "diamond", tone: "yellow", w: 180, h: 92 });
  d.node("ship", "Ship order", 380, 449, { w: 170 });
  d.node("done", "Done", 380, 546, { shape: "ellipse", tone: "green", w: 130, h: 46 });
  d.node("back", "Backorder", 690, 329, { tone: "red", w: 170 });
  d.node("notify", "Email customer", 690, 449, { w: 170 });
  d.node("waiting", "Await stock", 690, 546, { shape: "ellipse", tone: "yellow", w: 150, h: 46 });
  d.edge("e1", "start", "check");
  d.edge("e2", "check", "stock");
  d.edge("e3", "stock", "ship", { label: "yes" });
  d.edge("e4", "stock", "back", { label: "no" });
  d.edge("e5", "ship", "done");
  d.edge("e6", "back", "notify");
  // Backorders wait for stock; notifying the customer does not ship the order.
  d.edge("e7", "notify", "waiting");
  d.beat(["start"]).beat(["check", "e1"]).beat(["stock", "e2"]).beat(["ship", "e3"]).beat(["back", "e4"])
    .beat(["notify", "e6"]).beat(["done", "waiting", "e5", "e7"]);
});

// 3. Sequence diagram ---------------------------------------------------------
define("sequence", "Signing in exchanges a password for a token", "Sequence diagram with dashed lifelines, activation bars and dashed replies.", { seed: 13 }, d => {
  const actors = [["browser", "Browser", 150, "blue"], ["api", "API", 390, "neutral"], ["auth", "Auth service", 630, "neutral"], ["db", "Database", 860, "violet"]];
  for (const [id, label, x, tone] of actors) {
    d.node(id, label, x, 110, { tone, w: 150, h: 50 });
    d.line(`${id}_life`, x, 140, x, 560, { dashed: "dashed", color: DIAGRAM_MUTED });
  }
  const bar = (id, x, y1, y2) => { d.shape({ id, type: "rect", width: 14, height: y2 - y1, transform: tf(x, (y1 + y2) / 2), style: { fill: "#f1f3f5", stroke: DIAGRAM_INK, strokeWidth: 1.5, radius: 2 } }); d.allowOverlap.push(id); return id; };
  bar("api_act", 390, 178, 512);
  bar("auth_act", 630, 236, 452);
  bar("db_act", 860, 296, 392);
  const messages = [
    ["m1", 150, 390 - 7, 190, "POST /login", "solid"],
    ["m2", 390 + 7, 630 - 7, 250, "verify password", "solid"],
    ["m3", 630 + 7, 860 - 7, 310, "find user", "solid"],
    ["m4", 860 - 7, 630 + 7, 376, "user row", "dashed"],
    ["m5", 630 - 7, 390 + 7, 436, "signed token", "dashed"],
    ["m6", 390 - 7, 150, 496, "200 OK + cookie", "dashed"],
  ];
  for (const [id, x1, x2, y, label, style] of messages) {
    d.anchor(`${id}_a`, x1, y);
    d.anchor(`${id}_b`, x2, y);
    d.edge(id, `${id}_a`, `${id}_b`, { label, ...(style === "dashed" ? { dashed: "dashed" } : {}) });
  }
  d.beat(actors.map(([id]) => id)).beat(actors.map(([id]) => `${id}_life`), { duration: 700 })
    .beat(["api_act", "m1"]).beat(["auth_act", "m2"]).beat(["db_act", "m3"]).beat(["m4"]).beat(["m5"]).beat(["m6"]);
});

// 4. State machine ------------------------------------------------------------
define("state-machine", "A request moves through four states", "State machine with an initial state, labelled transitions and a routed loop back.", { seed: 14 }, d => {
  d.shape({ id: "initial", type: "circle", radius: 9, transform: tf(80, 300), style: { fill: DIAGRAM_INK, stroke: DIAGRAM_INK, strokeWidth: 2 } });
  d.node("idle", "Idle", 220, 300, { shape: "circle", tone: "blue", r: 52 });
  d.node("loading", "Loading", 480, 300, { shape: "circle", tone: "yellow", r: 52 });
  d.node("success", "Success", 800, 180, { shape: "circle", tone: "green", r: 52 });
  d.node("error", "Error", 800, 420, { shape: "circle", tone: "red", r: 52 });
  d.edge("t0", "initial", "idle");
  d.edge("t1", "idle", "loading", { label: "fetch" });
  d.edge("t2", "loading", "success", { kind: "curve", label: "200 OK" });
  d.edge("t3", "loading", "error", { kind: "curve", label: "timeout" });
  d.edge("t4", "error", "idle", { kind: "routed", fromAnchor: "bottom", toAnchor: "bottom", label: "retry" });
  d.beat(["initial", "idle", "t0"]).beat(["loading", "t1"]).beat(["success", "t2"]).beat(["error", "t3"]).beat(["t4"], { duration: 700 });
});

// 5. Entity relationship diagram ----------------------------------------------
define("er-diagram", "Orders link users to the products they buy", "Entity-relationship diagram with field lists and cardinality labels.", { seed: 15 }, d => {
  const entity = (id, name, fields, x, y, tone) => {
    d.shape({ id: `${id}_head`, type: "rect", width: 180, height: 42, text: name, transform: tf(x, y - 21), style: { fill: T[tone].fill, stroke: T[tone].stroke, strokeWidth: 2, color: DIAGRAM_INK, fontSize: 18, radius: 6 } });
    d.shape({ id, type: "rect", width: 180, height: 22 * fields.length + 20, text: fields.join("\n"), transform: tf(x, y + (22 * fields.length + 20) / 2), style: { fill: "#ffffff", stroke: T[tone].stroke, strokeWidth: 2, color: CAPTION, fontSize: 16, radius: 6 } });
    d.allowOverlap.push(`${id}_head`);
    return [`${id}_head`, id];
  };
  const user = entity("user", "User", ["id", "email", "name"], 180, 170, "blue");
  const order = entity("order", "Order", ["id", "user_id", "placed_at", "total"], 500, 170, "violet");
  const item = entity("item", "OrderItem", ["order_id", "product_id", "quantity"], 500, 410, "neutral");
  const product = entity("product", "Product", ["id", "title", "price"], 820, 410, "blue");
  d.edge("r1", "user", "order", { heads: "none", label: "1 : N" });
  d.edge("r2", "order", "item", { heads: "none", label: "1 : N" });
  d.edge("r3", "product", "item", { heads: "none", label: "1 : N" });
  d.beat(user).beat(order).beat(["r1"]).beat(item).beat(["r2"]).beat(product).beat(["r3"]);
});

// 6. Cloud architecture -------------------------------------------------------
define("architecture", "A web app scales behind a load balancer", "Architecture diagram with an external user, a dashed network boundary, services, a cache and a database cylinder.", { seed: 16 }, d => {
  d.node("vpc", "", 690, 340, { w: 560, h: 430, fill: "none", stroke: DIAGRAM_MUTED, dashed: "dashed", z: 0, radius: 18 });
  d.text("vpc_label", "Private network", 500, 145, { size: 16, color: DIAGRAM_MUTED });
  d.node("users", "Users", 110, 340, { shape: "circle", tone: "blue", r: 46 });
  d.node("cdn", "CDN", 280, 340, { tone: "teal", w: 120 });
  d.node("lb", "Load balancer", 520, 340, { tone: "yellow", w: 150 });
  d.node("api1", "API", 720, 230, { w: 120 });
  d.node("api2", "API", 720, 450, { w: 120 });
  d.node("cache", "Cache", 885, 230, { tone: "violet", w: 110 });
  // Database cylinder: body with top and bottom rims.
  const db = (x, y) => {
    const s = { fill: T.violet.fill, stroke: T.violet.stroke, strokeWidth: 2, color: DIAGRAM_INK, fontSize: 18 };
    d.shape({ id: "db", type: "rect", width: 110, height: 70, text: "Orders DB", transform: tf(x, y + 4), style: { ...s, radius: 0 } });
    d.shape({ id: "db_bottom", type: "ellipse", rx: 55, ry: 13, transform: tf(x, y + 39), style: s, z: 2 });
    d.shape({ id: "db_top", type: "ellipse", rx: 55, ry: 13, transform: tf(x, y - 31), style: s, z: 4 });
    d.allowOverlap.push("db_top", "db_bottom");
  };
  db(885, 450);
  d.edge("e1", "users", "cdn");
  d.edge("e2", "cdn", "lb");
  d.edge("e3", "lb", "api1", { kind: "curve" });
  d.edge("e4", "lb", "api2", { kind: "curve" });
  d.edge("e5", "api1", "cache", { heads: "both" });
  d.edge("e6", "api2", "db", { heads: "both" });
  d.edge("e7", "api1", "db", { dashed: "dashed", heads: "both" });
  d.beat(["users"]).beat(["cdn", "e1"]).beat(["vpc", "vpc_label"], { duration: 700 }).beat(["lb", "e2"])
    .beat(["api1", "api2", "e3", "e4"]).beat(["cache", "db_bottom", "db", "db_top", "e5", "e6"]).beat(["e7"]);
});

// 7. Mind map -----------------------------------------------------------------
define("mind-map", "Planning a product launch", "Mind map with a central idea, branches and leaves joined by curved, arrowless links.", { seed: 17 }, d => {
  d.node("center", "Launch plan", 500, 330, { shape: "ellipse", tone: "yellow", w: 190, h: 82, size: 20 });
  const branches = [["design", "Design", 300, 200], ["eng", "Engineering", 500, 168], ["mkt", "Marketing", 700, 200], ["sales", "Sales", 700, 470], ["support", "Support", 300, 470]];
  for (const [id, label, x, y] of branches) {
    d.node(id, label, x, y, { tone: "blue", w: 140, h: 50 });
    d.edge(`c_${id}`, "center", id, { kind: "curve", heads: "none" });
  }
  const leaves = [["wire", "Wireframes", 95, 160, "design"], ["proto", "Prototype", 95, 250, "design"], ["blog", "Blog post", 905, 160, "mkt"],
    ["press", "Press kit", 905, 250, "mkt"], ["faq", "FAQ", 95, 520, "support"], ["pricing", "Pricing", 905, 520, "sales"]];
  for (const [id, label, x, y, parent] of leaves) {
    d.node(id, label, x, y, { w: 130, h: 44, size: 16 });
    d.edge(`l_${id}`, parent, id, { kind: "curve", heads: "none", color: DIAGRAM_MUTED });
  }
  d.beat(["center"]).beat(branches.flatMap(([id]) => [id, `c_${id}`])).beat(leaves.flatMap(([id]) => [id, `l_${id}`]));
});

// 8. Org chart / tree ---------------------------------------------------------
define("org-chart", "A small company organised as a tree", "Tree with routed elbow connectors between levels.", { seed: 18 }, d => {
  d.node("ceo", "CEO", 500, 130, { tone: "blue" });
  const level2 = [["cto", "CTO", 230], ["cfo", "CFO", 500], ["coo", "COO", 770]];
  const level3 = [["eng", "Engineering", 130, "cto"], ["data", "Data", 330, "cto"], ["finance", "Finance", 500, "cfo"], ["ops", "Operations", 690, "coo"], ["people", "People", 870, "coo"]];
  for (const [id, label, x] of level2) { d.node(id, label, x, 280); d.edge(`e_${id}`, "ceo", id, { kind: "routed", fromAnchor: "bottom", toAnchor: "top", heads: "none" }); }
  for (const [id, label, x, parent] of level3) { d.node(id, label, x, 440, { tone: "green", w: 140 }); d.edge(`e_${id}`, parent, id, { kind: "routed", fromAnchor: "bottom", toAnchor: "top", heads: "none" }); }
  d.beat(["ceo"]).beat(level2.flatMap(([id]) => [id, `e_${id}`])).beat(level3.flatMap(([id]) => [id, `e_${id}`]));
});

// 9. Timeline -----------------------------------------------------------------
define("timeline", "From idea to a thousand customers", "Timeline with an arrowed axis, milestone dots and alternating cards.", { seed: 19 }, d => {
  d.anchor("axis_a", 60, 330);
  d.anchor("axis_b", 950, 330);
  d.edge("axis", "axis_a", "axis_b", { width: 3 });
  const events = [["2021", "Idea", 150], ["2022", "Prototype", 330], ["2023", "First sale", 510], ["2024", "Series A", 690], ["2025", "1k customers", 870]];
  events.forEach(([year, label, x], i) => {
    const above = i % 2 === 0;
    const tone = i === events.length - 1 ? "green" : i === 0 ? "blue" : "neutral";
    d.shape({ id: `dot${i}`, type: "circle", radius: 10, transform: tf(x, 330), style: { fill: T[tone].fill, stroke: T[tone].stroke, strokeWidth: 2 } });
    d.node(`card${i}`, `${year}\n${label}`, x, above ? 220 : 440, { tone, w: 150, h: 70 });
    d.edge(`tick${i}`, `card${i}`, `dot${i}`, { heads: "none", dashed: "dotted", color: DIAGRAM_MUTED });
  });
  d.beat(["axis"], { duration: 800 });
  events.forEach((_, i) => d.beat([`dot${i}`, `card${i}`, `tick${i}`], { duration: 420, gap: 80 }));
});

// 10. Venn diagram ------------------------------------------------------------
define("venn", "Great products sit where three skills meet", "Three-set Venn diagram with translucent fills.", { seed: 20 }, d => {
  const sets = [["design", "Design", 410, 270, "blue", 310, 170], ["eng", "Engineering", 590, 270, "green", 700, 170], ["biz", "Business", 500, 420, "yellow", 500, 560]];
  for (const [id, label, x, y, tone, lx, ly] of sets) {
    d.shape({ id, type: "circle", radius: 135, transform: tf(x, y), style: { fill: `${T[tone].fill}88`, stroke: T[tone].stroke, strokeWidth: 2 } });
    d.allowOverlap.push(id);
    d.text(`${id}_label`, label, lx, ly, { size: 20 });
  }
  d.text("core", "Great\nproduct", 500, 330, { size: 18 });
  d.beat(["design", "design_label"]).beat(["eng", "eng_label"]).beat(["biz", "biz_label"]).beat(["core"]);
});

// 11. Bar chart ---------------------------------------------------------------
define("bar-chart", "Quarterly revenue grew every quarter", "Bar chart whose bars grow from the axis, with gridlines and value labels.", { seed: 21 }, d => {
  const base = 500, left = 150, values = [["Q1", 120], ["Q2", 180], ["Q3", 230], ["Q4", 310]];
  for (const [i, v] of [100, 200, 300].entries()) {
    d.line(`grid${i}`, left, base - v, 900, base - v, { dashed: "dotted", color: DIAGRAM_SUBTLE });
    d.text(`tick${i}`, `$${v}k`, left - 40, base - v, { size: 15, color: DIAGRAM_MUTED });
  }
  d.line("x_axis", left, base, 900, base, { color: DIAGRAM_INK });
  d.line("y_axis", left, base, left, 140, { color: DIAGRAM_INK });
  d.beat(["x_axis", "y_axis"], { duration: 500 }).beat(["grid0", "grid1", "grid2", "tick0", "tick1", "tick2"], { duration: 400 });
  values.forEach(([label, value], i) => {
    const x = 260 + i * 180, tone = i === values.length - 1 ? "green" : "blue";
    d.shape({ id: `bar${i}`, type: "rect", width: 90, height: 1, transform: tf(x, base - 0.5), style: { fill: T[tone].fill, stroke: T[tone].stroke, strokeWidth: 2, radius: 4 } });
    d.text(`label${i}`, label, x, base + 28, { size: 18 });
    d.text(`value${i}`, `$${value}k`, x, base - value - 22, { size: 17, color: CAPTION });
    const start = d.cursor + i * 160;
    d.action({ id: `grow${i}`, type: "resize", target: `bar${i}`, start, duration: 650, easing: "easeOut", to: { width: 90, height: value } });
    d.action({ id: `rise${i}`, type: "move", target: `bar${i}`, start, duration: 650, easing: "easeOut", to: { x, y: base - value / 2 } });
    d.objects.find(o => o.id === `label${i}`).transform.opacity = 0;
    d.objects.find(o => o.id === `value${i}`).transform.opacity = 0;
    d.action({ id: `show_label${i}`, type: "opacity", target: `label${i}`, start, duration: 300, to: 1 });
    d.action({ id: `show_value${i}`, type: "opacity", target: `value${i}`, start: start + 450, duration: 300, to: 1 });
  });
  d.cursor += 3 * 160 + 800;
});

// 12. Line chart --------------------------------------------------------------
define("line-chart", "Weekly active users crossed the target", "Line chart traced on by a draw action, with points and a dashed target line.", { seed: 22 }, d => {
  const left = 140, base = 500, top = 150, values = [140, 180, 165, 230, 260, 300, 340];
  const px = i => left + 60 + i * 115, py = v => base - (v / 400) * (base - top);
  d.line("x_axis", left, base, 920, base, { color: DIAGRAM_INK });
  d.line("y_axis", left, base, left, top - 10, { color: DIAGRAM_INK });
  d.line("target", left, py(280), 920, py(280), { dashed: "dashed", color: T.red.stroke });
  d.text("target_label", "target", 870, py(280) - 18, { size: 16, color: T.red.stroke });
  d.shape({ id: "trend", type: "polyline", z: 2, points: values.map((v, i) => ({ x: r1(px(i)), y: r1(py(v)) })), style: { fill: "none", stroke: T.blue.stroke, strokeWidth: 3 } });
  values.forEach((v, i) => {
    d.shape({ id: `pt${i}`, type: "circle", radius: 7, transform: tf(px(i), py(v)), style: { fill: v >= 280 ? T.green.fill : T.blue.fill, stroke: v >= 280 ? T.green.stroke : T.blue.stroke, strokeWidth: 2 }, z: 4 });
    d.text(`wk${i}`, `W${i + 1}`, px(i), base + 26, { size: 16, color: DIAGRAM_MUTED });
  });
  d.beat(["x_axis", "y_axis", ...values.map((_, i) => `wk${i}`)]).beat(["target", "target_label"]).beat(["trend"], { duration: 1400 })
    .beat(values.map((_, i) => `pt${i}`), { duration: 300 });
});

// 13. Geometry ----------------------------------------------------------------
define("geometry", "Right triangles and circles", "Geometry figure: a right triangle with a right-angle mark and angle arc, and a circle with its radius.", { seed: 23 }, d => {
  const A = { x: 120, y: 470 }, B = { x: 470, y: 470 }, C = { x: 470, y: 190 };
  d.shape({ id: "tri", type: "polygon", points: [A, B, C], style: { fill: `${T.blue.fill}66`, stroke: T.blue.stroke, strokeWidth: 2 } });
  d.shape({ id: "right", type: "polyline", z: 4, points: [{ x: 444, y: 470 }, { x: 444, y: 444 }, { x: 470, y: 444 }], style: { fill: "none", stroke: DIAGRAM_INK, strokeWidth: 1.5 } });
  d.shape({ id: "arc", type: "path", z: 4, d: "M 190 470 A 70 70 0 0 0 175 426", style: { fill: "none", stroke: T.red.stroke, strokeWidth: 2 } });
  d.text("theta", "θ", 210, 446, { size: 20, color: T.red.stroke });
  d.text("a", "a", 500, 330, { size: 22 });
  d.text("b", "b", 295, 500, { size: 22 });
  d.text("c", "c", 270, 305, { size: 22 });
  d.shape({ id: "circ", type: "circle", radius: 130, transform: tf(760, 330), style: { fill: `${T.green.fill}66`, stroke: T.green.stroke, strokeWidth: 2 } });
  d.shape({ id: "center", type: "circle", radius: 4, z: 5, transform: tf(760, 330), style: { fill: DIAGRAM_INK, stroke: DIAGRAM_INK, strokeWidth: 1 } });
  d.allowOverlap.push("center");
  d.line("radius", 760, 330, 852, 238, { color: DIAGRAM_INK, z: 4 });
  d.text("r", "r", 818, 300, { size: 22 });
  d.text("triangle_formula", "a² + b² = c²", 295, 560, { size: 22, color: CAPTION });
  d.text("circle_formula", "C = 2πr", 760, 560, { size: 22, color: CAPTION });
  d.beat(["tri"], { duration: 900 }).beat(["right", "arc", "theta"]).beat(["a", "b", "c"]).beat(["circ"], { duration: 800 })
    .beat(["center", "radius", "r"]).beat(["triangle_formula", "circle_formula"]);
});

// 14. Data structures ---------------------------------------------------------
define("data-structures", "An array is contiguous; a linked list follows pointers", "Array with a moving index pointer, and a singly linked list with next pointers.", { seed: 24 }, d => {
  const cells = ["7", "3", "9", "1", "5", "8"];
  d.text("arr_label", "array", 110, 180, { size: 18, color: DIAGRAM_MUTED });
  cells.forEach((v, i) => {
    d.shape({ id: `cell${i}`, type: "rect", width: 70, height: 60, text: v, transform: tf(220 + i * 70, 180), style: { fill: i === 2 ? T.yellow.fill : "#ffffff", stroke: i === 2 ? T.yellow.stroke : DIAGRAM_INK, strokeWidth: 2, color: DIAGRAM_INK, fontSize: 22, radius: 0 } });
    d.allowOverlap.push(`cell${i}`);
    d.text(`idx${i}`, String(i), 220 + i * 70, 228, { size: 15, color: DIAGRAM_MUTED });
  });
  d.node("ptr", "i", 220, 92, { shape: "circle", r: 18, tone: "blue", size: 18 });
  d.anchor("ptr_tip", 220, 144);
  d.edge("ptr_edge", "ptr", "ptr_tip", { kind: "straight", toAnchor: "bottom" });
  d.text("ll_label", "linked list", 110, 400, { size: 18, color: DIAGRAM_MUTED });
  const values = ["12", "45", "7"];
  values.forEach((v, i) => {
    const x = 260 + i * 220;
    d.shape({ id: `val${i}`, type: "rect", width: 70, height: 60, text: v, transform: tf(x, 400), style: { fill: T.blue.fill, stroke: T.blue.stroke, strokeWidth: 2, color: DIAGRAM_INK, fontSize: 22, radius: 6 } });
    d.shape({ id: `next${i}`, type: "rect", width: 44, height: 60, text: "•", transform: tf(x + 57, 400), style: { fill: "#ffffff", stroke: T.blue.stroke, strokeWidth: 2, color: DIAGRAM_INK, fontSize: 22, radius: 6 } });
    d.allowOverlap.push(`val${i}`, `next${i}`);
  });
  d.text("null", "null", 920, 400, { size: 18, color: DIAGRAM_MUTED });
  d.anchor("null_tip", 885, 400);
  d.edge("p0", "next0", "val1");
  d.edge("p1", "next1", "val2");
  d.edge("p2", "next2", "null_tip");
  d.beat(["arr_label", ...cells.map((_, i) => `cell${i}`)]).beat(cells.map((_, i) => `idx${i}`), { duration: 300 }).beat(["ptr", "ptr_edge"]);
  const scan = d.cursor;
  for (let i = 1; i <= 2; i++) {
    const start = scan + (i - 1) * 520;
    d.action({ id: `scan${i}`, type: "move", target: "ptr", start, duration: 420, to: { x: 220 + i * 70, y: 92 } });
    d.action({ id: `scan_tip${i}`, type: "move", target: "ptr_tip", start, duration: 420, to: { x: 220 + i * 70, y: 144 } });
  }
  d.cursor = scan + 2 * 520 + 100;
  d.beat(["ll_label", "val0", "next0"]).beat(["p0", "val1", "next1"]).beat(["p1", "val2", "next2"]).beat(["p2", "null"]);
});

// 15. Swimlanes ---------------------------------------------------------------
define("swimlanes", "Who does what when an order is placed", "Cross-functional swimlane flow with lane headers and orthogonal hand-offs.", { seed: 25 }, d => {
  const lanes = [["customer", "Customer", 175], ["shop", "Shop", 330], ["warehouse", "Warehouse", 485]];
  for (const [id, label, y] of lanes) {
    d.shape({ id: `lane_${id}`, type: "rect", width: 930, height: 150, transform: tf(500, y), z: 0, style: { fill: "#f8f9fa", stroke: DIAGRAM_SUBTLE, strokeWidth: 1.5, radius: 10 } });
    d.allowOverlap.push(`lane_${id}`);
    d.text(`lane_${id}_label`, label, 105, y, { size: 18, color: CAPTION });
  }
  d.node("order", "Place order", 290, 175, { tone: "blue", w: 140 });
  d.node("pay", "Take payment", 450, 330, { w: 140 });
  d.node("pick", "Send pick list", 640, 330, { w: 140 });
  d.node("pack", "Pick & pack", 640, 485, { w: 140 });
  d.node("ship", "Ship", 830, 485, { w: 120 });
  d.node("receive", "Receive", 830, 175, { tone: "green", w: 120 });
  d.edge("h1", "order", "pay", { kind: "curve" });
  d.edge("h2", "pay", "pick");
  d.edge("h3", "pick", "pack");
  d.edge("h4", "pack", "ship");
  d.edge("h5", "ship", "receive");
  d.beat(lanes.flatMap(([id]) => [`lane_${id}`, `lane_${id}_label`]), { duration: 600 }).beat(["order"]).beat(["pay", "h1"]).beat(["pick", "h2"])
    .beat(["pack", "h3"]).beat(["ship", "h4"]).beat(["receive", "h5"]);
});

// 16. Cycle -------------------------------------------------------------------
define("cycle", "Build, measure, learn, repeat", "Circular process with five stages around a central idea.", { seed: 26 }, d => {
  const stages = ["Ideas", "Build", "Product", "Measure", "Learn"];
  const cx = 500, cy = 330, radius = 200;
  stages.forEach((label, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / stages.length;
    d.node(`s${i}`, label, cx + Math.cos(angle) * radius * 1.35, cy + Math.sin(angle) * radius * 0.95, { tone: i === 0 ? "blue" : "neutral", w: 140, h: 54 });
  });
  stages.forEach((_, i) => d.edge(`f${i}`, `s${i}`, `s${(i + 1) % stages.length}`));
  d.text("hub", "Validated\nlearning", cx, cy, { size: 20, color: CAPTION });
  d.beat(["s0", "hub"]);
  // Each beat draws the next arrow and the stage it reaches; the last arrow closes the loop.
  stages.forEach((_, i) => d.beat(i < stages.length - 1 ? [`f${i}`, `s${i + 1}`] : [`f${i}`], { duration: 420, gap: 80 }));
});

// 17. Undirected network ------------------------------------------------------
define("network", "Friends of friends form a small world", "Undirected graph: circular nodes joined by arrowless edges, with one highlighted path.", { seed: 27 }, d => {
  const nodes = [["ana", "Ana", 180, 200], ["ben", "Ben", 360, 140], ["cy", "Cy", 330, 330], ["dee", "Dee", 540, 250], ["eli", "Eli", 520, 450],
    ["fay", "Fay", 720, 160], ["gus", "Gus", 740, 380], ["hal", "Hal", 880, 270]];
  for (const [id, label, x, y] of nodes) d.node(id, label, x, y, { shape: "circle", r: 36, tone: ["ana", "hal"].includes(id) ? "blue" : "neutral", size: 18 });
  const links = [["ana", "ben"], ["ana", "cy"], ["ben", "dee"], ["cy", "dee"], ["cy", "eli"], ["dee", "fay"], ["dee", "gus"], ["eli", "gus"], ["fay", "hal"], ["gus", "hal"]];
  const path = new Set(["ana-cy", "cy-dee", "dee-fay", "fay-hal"]);
  links.forEach(([a, b], i) => d.edge(`k${i}`, a, b, { heads: "none", color: path.has(`${a}-${b}`) ? T.blue.stroke : DIAGRAM_MUTED, width: path.has(`${a}-${b}`) ? 3 : 2 }));
  d.beat(nodes.map(([id]) => id), { duration: 500 }).beat(links.map((_, i) => `k${i}`), { duration: 600 });
});

// ---------------------------------------------------------------------------
const manifest = [];
for (const diagram of diagrams) {
  const scene = diagram.build();
  const file = join(here, diagram.slug, "scene.json");
  const text = JSON.stringify(scene, null, 2) + "\n";
  if (check) {
    if (!existsSync(file) || readFileSync(file, "utf8") !== text) throw new Error(`Out-of-date gallery scene ${diagram.slug}; run node examples/diagram-gallery/build.mjs`);
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  manifest.push({ id: diagram.slug, title: diagram.title, summary: diagram.summary, durationMs: diagram.cursor + 200, allowOverlap: diagram.allowOverlap, file: `${diagram.slug}/scene.json` });
}
const index = JSON.stringify({ version: 1, count: manifest.length, diagrams: manifest }, null, 2) + "\n";
const indexFile = join(here, "index.json");
if (check) {
  if (!existsSync(indexFile) || readFileSync(indexFile, "utf8") !== index) throw new Error("Out-of-date gallery index");
} else writeFileSync(indexFile, index);
console.log(`${check ? "Verified" : "Generated"} ${manifest.length} gallery diagrams`);
