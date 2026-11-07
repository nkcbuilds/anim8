import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compileJson } from "../../packages/compiler/dist/index.js";
import { connectorGeometry, evaluate, lintDesign, sceneDuration } from "../../packages/core/dist/index.js";
import { measureSketchText, renderSketchSvg } from "../../packages/renderer-sketch/dist/index.js";
import { renderSvg } from "../../packages/renderer-svg/dist/index.js";

const root = new URL("../../examples/diagram-gallery/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("index.json", root), "utf8"));
assert.equal(manifest.count, manifest.diagrams.length);
assert.equal(new Set(manifest.diagrams.map(entry => entry.id)).size, manifest.count);
let frames = 0;
for (const entry of manifest.diagrams) {
  const compiled = compileJson(readFileSync(new URL(entry.file, root), "utf8"));
  assert.ok(compiled.ok, `${entry.id}: ${JSON.stringify(compiled.diagnostics)}`);
  assert.deepEqual(compiled.diagnostics, [], entry.id);
  const scene = compiled.scene;
  assert.ok(sceneDuration(scene) <= entry.durationMs, `${entry.id}: manifest truncates animation`);
  const times = new Set([0, entry.durationMs]);
  for (const action of scene.timeline) {
    times.add(action.start);
    times.add(action.start + action.duration / 2);
    times.add(action.start + action.duration);
  }
  const original = JSON.stringify(scene);
  for (const time of times) {
    const frame = evaluate(scene, time);
    assert.deepEqual(lintDesign(frame, { measure: measureSketchText, allowOverlap: entry.allowOverlap }), [], `${entry.id}@${time}`);
    for (const render of [renderSketchSvg, renderSvg]) {
      const svg = render(frame, { font: "reference" });
      assert.ok(!/NaN|Infinity|undefined/.test(svg), `${entry.id}@${time}: invalid markup`);
      // Seek elsewhere and back: output must never depend on earlier frames.
      evaluate(scene, entry.durationMs - time);
      assert.equal(render(evaluate(scene, time), { font: "reference" }), svg, `${entry.id}: seek instability`);
    }
    frames++;
  }
  const final = evaluate(scene, entry.durationMs);
  for (const action of scene.timeline.filter(action => action.type === "draw")) {
    assert.equal(final.objects.find(object => object.id === action.target).drawProgress, 1, `${entry.id}: unfinished stroke`);
  }
  const markup = renderSketchSvg(final, { font: "reference" });
  if (scene.objects.filter(object => object.type === "connector").every(object => object.arrowheads === "none")) {
    assert.ok(!markup.includes('data-sketch-part="arrowhead"'), `${entry.id}: arrowless relationships acquired arrows`);
  }
  if (entry.id === "data-structures") {
    const scan = scene.timeline.filter(action => action.id.startsWith("scan") && action.target === "ptr");
    for (const action of scan) {
      for (const time of [action.start, action.start + action.duration / 2, action.start + action.duration]) {
        const objects = new Map(evaluate(scene, time).objects.map(object => [object.id, object]));
        const { points } = connectorGeometry(objects.get("ptr_edge"), objects);
        assert.equal(points[0].x, points[1].x, "Array pointer must remain vertical while scanning");
      }
    }
    assert.equal(final.objects.find(object => object.id === "ptr").transform.x, 360);
  }
  if (entry.id === "bar-chart") {
    for (const time of times) {
      for (const bar of evaluate(scene, time).objects.filter(object => /^bar\d$/.test(object.id))) {
        assert.ok(Math.abs(bar.transform.y + bar.height / 2 - 500) < 1e-6, "Growing bars must stay on the baseline");
      }
    }
  }
  assert.equal(JSON.stringify(scene), original, `${entry.id}: evaluation mutated the source`);
  console.log(`PASS ${entry.id}`);
}
console.log(`Gallery: ${manifest.count} diagrams, ${frames} action-boundary/midpoint frames, both renderers. Source: ${fileURLToPath(root)}`);
