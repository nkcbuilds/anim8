import assert from "node:assert/strict";
import { evaluate, sceneDuration } from "@anim8/core";
import { renderSceneAt } from "@anim8/renderer-svg";
import { scene } from "../shared/scene.mjs";

const coreResolution = new URL(import.meta.resolve("@anim8/core")).pathname;
const rendererResolution = new URL(import.meta.resolve("@anim8/renderer-svg")).pathname;
assert.match(coreResolution, /\/tests\/consumers\/\.runtime\/node_modules\/@anim8\/core\/dist\/index\.js$/);
assert.match(rendererResolution, /\/tests\/consumers\/\.runtime\/node_modules\/@anim8\/renderer-svg\/dist\/index\.js$/);

assert.equal(sceneDuration(scene), 1000);

const frame = evaluate(scene, 1000);
const box = frame.objects.find((object) => object.id === "box");
assert.ok(box);
assert.equal(box.transform.x, 140);

const svg = renderSceneAt(scene, 0);
assert.match(svg, /^<svg\b/);
assert.match(svg, /data-anim8-id="box"/);
assert.match(svg, /matrix\(1 0 0 1 40 60\)/);

console.log("PASS vanilla-esm");
