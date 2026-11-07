/** Independent sort/order and motion oracles; no browser or provider mocks. */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { buildMergeSort, INPUT, GEOMETRY } from "../../examples/merge-sort-motion/generate.mjs";
import { compileJson } from "../../packages/compiler/dist/index.js";
import { evaluate, worldMatrix, sceneDuration } from "../../packages/core/dist/index.js";
import { renderSvg } from "../../packages/renderer-svg/dist/index.js";

const stable = (values, ids) => [...ids].sort((a, b) => values[a] - values[b] || a - b);
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} ≠ ${expected}`);
const slotX = (i, n) => GEOMETRY.width / 2 + (i - (n - 1) / 2) * GEOMETRY.spacing;
function pose(frame, id) { const map = new Map(frame.objects.map(o => [o.id, o])); const m = worldMatrix(map.get(id), map); return { x: m.e, y: m.f }; }
function expectedPose(move, fraction) {
  if (move.kind === "split") {
    const t = fraction < 0.5 ? 2 * fraction ** 2 : 1 - 2 * (1 - fraction) ** 2;
    return { x: move.from.x, y: move.from.y + (move.to.y - move.from.y) * t };
  }
  // Independently walk the authored polyline by distance.
  const lengths = move.path.slice(1).map((point, i) => Math.hypot(point.x - move.path[i].x, point.y - move.path[i].y));
  let remaining = lengths.reduce((a, b) => a + b, 0) * fraction;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] && lengths[i] > 0) {
      const ratio = remaining / lengths[i], a = move.path[i], b = move.path[i + 1];
      return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
    }
    remaining -= lengths[i];
  }
  return move.to;
}

let seed = 721;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
const cases = [INPUT, [], [4], [2, 1], Array.from({ length: 12 }, (_, i) => i), Array.from({ length: 12 }, (_, i) => 11 - i), Array(12).fill(3), [-4, 0, 3, -4, 1, 0], ...Array.from({ length: 5 }, () => Array.from({ length: 12 }, () => random() % 15 - 7))];
let motionSamples = 0, collisionSamples = 0, mergesChecked = 0;
for (const [caseIndex, input] of cases.entries()) {
  const original = [...input], { document, trace } = buildMergeSort(input);
  assert.deepEqual(input, original, "Authoring must not mutate source values");
  const source = JSON.stringify(document), compiled = compileJson(source);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  const scene = compiled.scene;
  assert.ok(sceneDuration(scene) < 30_000, "Sorting example must fit the real video exporter");
  const sortedIds = stable(input, input.map((_, i) => i));
  assert.deepEqual(trace.sortedIds, sortedIds, "Final ordering must match an independent stable numeric sort");
  let comparisons = 0, writes = 0;
  for (const merge of trace.merges) {
    const left = [...merge.left], right = [...merge.right], output = [];
    assert.deepEqual(left, stable(input, left), "Left run must already be sorted");
    assert.deepEqual(right, stable(input, right), "Right run must already be sorted");
    for (const placement of merge.placements) {
      assert.equal(placement.leftHead, left[0] ?? null);
      assert.equal(placement.rightHead, right[0] ?? null);
      assert.equal(placement.compared, left.length > 0 && right.length > 0);
      assert.equal(placement.equal, left.length > 0 && right.length > 0 && input[left[0]] === input[right[0]]);
      const chooseLeft = right.length === 0 || (left.length > 0 && input[left[0]] <= input[right[0]]);
      const expected = chooseLeft ? left.shift() : right.shift();
      assert.equal(placement.item, expected, "Only the smaller current head may be moved; equal keys take the left head");
      assert.equal(placement.outputSlot, merge.lo + output.length);
      output.push(expected); if (placement.compared) comparisons++; writes++;
    }
    assert.equal(left.length + right.length, 0);
    const ids = Array.from({ length: merge.hi - merge.lo }, (_, i) => merge.lo + i);
    assert.deepEqual(output, stable(input, ids), "Every merged run must contain exactly its original items, sorted stably");
    const frame = evaluate(scene, merge.end);
    output.forEach((id, i) => {
      const p = pose(frame, `box-${id}`);
      near(p.x, slotX(merge.lo + i, input.length), "Merged box x");
      near(p.y, GEOMETRY.top + merge.depth * GEOMETRY.row, "Merged box row");
    }); mergesChecked++;
  }
  assert.equal(trace.comparisons, comparisons); assert.equal(trace.writes, writes);
  const final = evaluate(scene, trace.durationMs);
  sortedIds.forEach((id, i) => { near(pose(final, `box-${id}`).x, slotX(i, input.length), "Final x"); near(pose(final, `box-${id}`).y, GEOMETRY.top, "Final row"); });
  for (const move of trace.moves) for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    const frame = evaluate(scene, move.start + (move.end - move.start) * fraction), p = pose(frame, `box-${move.item}`), expected = expectedPose(move, fraction);
    near(p.x, expected.x, "Motion must change actual box position, not its text"); near(p.y, expected.y, "Motion must follow the authored route");
    const badge = pose(frame, `identity-${move.item}`);
    near(badge.x, p.x, "Identity tag follows box x"); near(badge.y, p.y + GEOMETRY.badgeOffset, "Identity tag follows box y"); motionSamples++;
  }
  // Dense sampling on the teaching example, reverse input and a seeded case.
  if ([0, 5, 8].includes(caseIndex)) {
    const times = new Set([0, trace.durationMs, ...trace.checkpoints.map(p => p.time)]);
    for (const move of trace.moves) for (let part = 0; part <= 12; part++) times.add(move.start + (move.end - move.start) * part / 12);
    for (const time of times) {
      const frame = evaluate(scene, time), index = new Map(frame.objects.map(o => [o.id, o]));
      const positions = input.map((value, id) => {
        const box = index.get(`box-${id}`), badge = index.get(`identity-${id}`);
        assert.equal(box.text, String(value), "Moving boxes cannot exchange their labels");
        assert.equal(badge.text, `#${id + 1}`, "Original identity must stay attached");
        const m = worldMatrix(box, index), tag = worldMatrix(badge, index);
        near(tag.e, m.e, "Tag remains attached"); near(tag.f, m.f + GEOMETRY.badgeOffset, "Tag offset remains attached");
        assert.ok(m.e - 29 >= 0 && m.e + 29 <= GEOMETRY.width && m.f - 22 >= 125 && m.f + 40 <= 790, "Moving values must remain inside the diagram area");
        return { x: m.e, y: m.f };
      });
      for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i], b = positions[j];
        assert.ok(Math.abs(a.x - b.x) >= GEOMETRY.boxWidth - 1e-6 || Math.abs(a.y - b.y) >= 62 - 1e-6, `Values/tags overlap at ${time}ms: #${i + 1}, #${j + 1}`);
      }
      collisionSamples++;
    }
  }
  const firstMerge = trace.moves.find(m => m.kind === "merge");
  const timestamp = firstMerge ? firstMerge.start + 180 : 0;
  const svg = renderSvg(evaluate(scene, timestamp));
  evaluate(scene, trace.durationMs); evaluate(scene, 0);
  assert.equal(renderSvg(evaluate(scene, timestamp)), svg, "SVG seek history must not change a frame");
  assert.equal(JSON.stringify(document), source, "Evaluation/rendering must not mutate the scene");
}
// The committed scene/trace must be byte-identical to their reproducible generator.
const generated = buildMergeSort();
assert.equal(await readFile("examples/merge-sort-motion/scene.json", "utf8"), JSON.stringify(generated.document, null, 2) + "\n");
assert.equal(await readFile("examples/merge-sort-motion/trace.json", "utf8"), JSON.stringify(generated.trace, null, 2) + "\n");
await mkdir("artifacts/sorting", { recursive: true });
const report = { ok: true, cases: cases.length, mergesChecked, motionSamples, collisionSamples, comparisons: generated.trace.comparisons, writes: generated.trace.writes, durationMs: generated.trace.durationMs, sortedValues: generated.trace.sortedIds.map(i => INPUT[i]), sortedOriginalIds: generated.trace.sortedIds.map(i => `#${i + 1}`) };
await writeFile("artifacts/sorting/qualification.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
