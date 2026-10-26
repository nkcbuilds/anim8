/** A real stable merge-sort trace, rendered with persistent grouped scene objects. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { scene } from "../../packages/authoring/dist/index.js";

export const INPUT = [7, 3, 9, 1, 5, 3, 8, 2, 6, 4, 1, 0];
export const GEOMETRY = { width: 1280, height: 960, spacing: 88, top: 170, row: 140, boxWidth: 58, boxHeight: 44, badgeOffset: 34 };
const pending = { fill: "#eff6ff", stroke: "#3b82f6", color: "#1e3a8a" };
const comparing = { fill: "#fef3c7", stroke: "#d97706", color: "#92400e" };
const placed = { fill: "#ccfbf1", stroke: "#0d9488", color: "#115e59" };
const sorted = { fill: "#dcfce7", stroke: "#16a34a", color: "#166534", strokeDasharray: [] };

export function buildMergeSort(input = INPUT) {
  if (!Array.isArray(input) || input.length > 12 || input.some(v => !Number.isInteger(v) || Math.abs(v) > 99)) throw Error("The demo accepts up to 12 integers in [-99,99].");
  const values = [...input], g = GEOMETRY, s = scene({ width: g.width, height: g.height, background: "#ffffff" });
  let time = 0, comparisons = 0, writes = 0;
  const trace = { input: values, geometry: g, splits: [], merges: [], moves: [], checkpoints: [] };
  const x = i => g.width / 2 + (i - (values.length - 1) / 2) * g.spacing;
  const y = depth => g.top + depth * g.row;
  const nodes = [];
  function tree(lo, hi, depth = 0) {
    const node = { lo, hi, depth, id: `run-${lo}-${hi}`, children: [] }; nodes.push(node);
    if (hi - lo > 1) { const mid = lo + Math.floor((hi - lo) / 2); node.children = [tree(lo, mid, depth + 1), tree(mid, hi, depth + 1)]; }
    return node;
  }
  const root = values.length ? tree(0, values.length) : null;
  // Background runs and tree edges are separate from the values that actually move.
  for (const node of nodes) {
    node.frame = s.box("", { id: node.id, x: (x(node.lo) + x(node.hi - 1)) / 2, y: y(node.depth) + 6, width: (node.hi - node.lo - 1) * g.spacing + 78, height: 92, fill: "#f8fafc", stroke: "#cbd5e1", strokeWidth: 1.5, strokeDasharray: [6, 5], radius: 14 });
    if (node !== root) s.atTime(0, node.frame.hide());
  }
  for (const node of nodes) for (const child of node.children) {
    child.edge = s.connect(node.frame, child.frame, { id: `branch-${child.id}`, from: "bottom", to: "top", stroke: "#cbd5e1", strokeWidth: 1, strokeDasharray: [4, 5] });
    s.atTime(0, child.edge.hide());
  }
  s.text("Merge sort · follow the same boxes", { id: "title", x: 640, y: 38, fontSize: 31, fontWeight: 750 });
  s.text([
    { text: "12 values · ", color: "#475569" }, { text: "duplicates keep their original order", color: "#7c3aed", fontWeight: 650 },
    { text: " · split, compare, move, merge", color: "#475569" },
  ], { id: "subtitle", x: 640, y: 77, fontSize: 18 });
  const narration = s.text("Split the array into smaller runs, down to individual values.", { id: "narration", x: 640, y: 112, fontSize: 18, color: "#334155" });
  const phase = s.text("DIVIDE", { id: "phase", x: 640, y: 818, fontSize: 23, color: "#2563eb", fontWeight: 750 });
  const stats = s.text("Comparisons: 0 · Merge writes: 0", { id: "stats", x: 640, y: 855, fontSize: 18, color: "#475569" });
  s.text("Blue: pending     Amber: compare heads     Teal: placed     Green: sorted run", { id: "legend", x: 640, y: 892, fontSize: 16, color: "#475569" });
  s.text("Each upward row is a merge output buffer. Boxes move instead of being copied to preserve identity visually.", { id: "note", x: 640, y: 932, fontSize: 14, color: "#64748b" });
  for (let depth = 0; depth <= 4; depth++) s.text(`depth ${depth}`, { id: `depth-${depth}`, x: 55, y: y(depth), fontSize: 13, color: "#94a3b8" });

  const handles = [], positions = [];
  values.forEach((value, i) => {
    const position = { x: x(i), y: y(0) };
    const box = s.box(String(value), { id: `box-${i}`, ...position, width: g.boxWidth, height: g.boxHeight, ...pending, radius: 9, strokeWidth: 2.5, fontSize: 25, fontWeight: 700 });
    const badge = s.text(`#${i + 1}`, { id: `identity-${i}`, x: position.x, y: position.y + g.badgeOffset, fontSize: 12, color: "#64748b" });
    const group = s.group([box, badge], { id: `item-${i}`, ...position });
    handles.push({ group, box, badge }); positions.push(position);
  });
  const leftCursor = s.text("▼ L", { id: "left-cursor", x: 0, y: 0, fontSize: 15, color: "#d97706", fontWeight: 700 });
  const rightCursor = s.text("▼ R", { id: "right-cursor", x: 0, y: 0, fontSize: 15, color: "#db2777", fontWeight: 700 });
  s.atTime(0, leftCursor.hide(), rightCursor.hide());
  const say = message => s.atTime(time, narration.textTo(message));
  const updateStats = () => s.atTime(time, stats.textTo(`Comparisons: ${comparisons} · Merge writes: ${writes} · O(n log n) time · O(n) auxiliary space`));
  const checkpoint = (label, detail = {}) => trace.checkpoints.push({ time, label, ...detail });
  checkpoint("input");
  for (let depth = 0; depth < 4; depth++) {
    const level = nodes.filter(n => n.depth === depth && n.children.length);
    if (!level.length) continue;
    say(`Divide depth ${depth}: the same boxes and their identity tags move into smaller runs.`);
    const start = time;
    for (const node of level) {
      for (const child of node.children) {
        s.atTime(time, child.frame.show(), child.edge.show());
        for (let i = child.lo; i < child.hi; i++) {
          const from = { ...positions[i] }, to = { x: x(i), y: y(child.depth) };
          s.atTime(time, handles[i].group.moveTo(to, { duration: 400, easing: "easeInOut" }));
          trace.moves.push({ kind: "split", item: i, start: time, end: time + 400, from, to }); positions[i] = to;
        }
      }
      trace.splits.push({ lo: node.lo, hi: node.hi, depth, start, end: time + 400 });
    }
    time += 600;
    checkpoint(`split-depth-${depth + 1}`);
  }

  function merge(node) {
    if (!node.children.length) return [node.lo];
    const left = merge(node.children[0]), right = merge(node.children[1]);
    const event = { lo: node.lo, hi: node.hi, depth: node.depth, start: time, left: [...left], right: [...right], placements: [] };
    s.atTime(time, phase.textTo(`MERGE [${node.lo}, ${node.hi})`));
    let l = 0, r = 0; const output = [];
    while (l < left.length || r < right.length) {
      const a = left[l], b = right[r], compared = a !== undefined && b !== undefined;
      if (compared) comparisons++;
      const chooseLeft = b === undefined || (a !== undefined && values[a] <= values[b]);
      const item = chooseLeft ? left[l++] : right[r++];
      const heads = [a, b].filter(i => i !== undefined);
      for (const [head, cursor] of [[a, leftCursor], [b, rightCursor]]) {
        if (head === undefined) s.atTime(time, cursor.hide());
        else s.atTime(time, cursor.show(), cursor.moveTo({ x: positions[head].x, y: positions[head].y - 35 }, { duration: 70, easing: "linear" }), handles[head].box.styleTo(comparing, { duration: 70, easing: "linear" }));
      }
      const equal = compared && values[a] === values[b];
      say(compared ? `Compare ${values[a]} (#${a + 1}) and ${values[b]} (#${b + 1}) → take ${chooseLeft ? "left" : "right"}${equal ? "; equal keys keep input order" : ""}.` : `One run is exhausted → take remaining ${values[item]} (#${item + 1}).`);
      updateStats(); time += 80;
      s.atTime(time, leftCursor.hide(), rightCursor.hide());
      const from = { ...positions[item] }, to = { x: x(node.lo + output.length), y: y(node.depth) };
      const laneY = (from.y + to.y) / 2;
      const path = [from, { x: from.x, y: laneY }, { x: to.x, y: laneY }, to];
      s.atTime(time, handles[item].group.followPath(path, { duration: 360, easing: "linear" }));
      trace.moves.push({ kind: "merge", item, start: time, end: time + 360, from, to, path });
      event.placements.push({ item, leftHead: a ?? null, rightHead: b ?? null, compared, equal, start: time - 80, moveStart: time, end: time + 360, outputSlot: node.lo + output.length, heads });
      positions[item] = to; output.push(item); time += 360; writes++;
      s.atTime(time, handles[item].box.styleTo(placed, { duration: 0 }));
    }
    for (const item of output) s.atTime(time, handles[item].box.styleTo(sorted, { duration: 120 }));
    s.atTime(time, node.frame.styleTo({ stroke: "#16a34a", strokeDasharray: [] }, { duration: 120 }));
    time += 160; event.end = time; event.output = output; trace.merges.push(event);
    updateStats(); checkpoint(`merged-${node.lo}-${node.hi}`, { lo: node.lo, hi: node.hi, items: output });
    return output;
  }
  trace.sortedIds = root ? merge(root) : [];
  s.atTime(time, leftCursor.hide(), rightCursor.hide(), phase.textTo("SORTED · stable order preserved"), phase.colorTo("#16a34a", { duration: 0 }));
  say(values.length ? "Read the top row: ascending values. Equal numbers retain the order of their original #tags." : "An empty array is already sorted.");
  updateStats(); time += 800;
  s.atTime(time, phase.fadeTo(1, { duration: 0 }));
  trace.durationMs = time; trace.comparisons = comparisons; trace.writes = writes;
  const document = s.toJSON();
  // These markers have exact scene timestamps, without depending on builder cursor state.
  document.markers = trace.checkpoints.map((p, i) => ({ id: `step-${i}`, label: p.label, time: p.time }));
  const subtitle = document.objects.find(o => o.id === "subtitle");
  subtitle.textRuns[0].text = `${values.length} values · `; subtitle.text = subtitle.textRuns.map(r => r.text).join("");
  return { document, trace };
}

async function main() {
  const { document, trace } = buildMergeSort();
  for (const [name, content] of [["scene.json", document], ["trace.json", trace]]) {
    const location = new URL(name, import.meta.url), serialized = JSON.stringify(content, null, 2) + "\n";
    if (process.argv.includes("--check")) assert.equal(await readFile(location, "utf8"), serialized, name + " is stale; regenerate the merge-sort example");
    else await writeFile(location, serialized);
  }
  console.log(`PASS merge-sort example: ${trace.input.length} persistent items, ${trace.comparisons} comparisons, ${trace.writes} merge writes, ${trace.durationMs}ms`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
