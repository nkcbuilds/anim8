/**
 * Deterministic release-qualification suite for the Anim8 teaching catalog.
 * Run after pnpm build: node tests/catalog/run.mjs
 *
 * Tests actual compiled runtime, not just valid JSON or generator output.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { compileJson } from "../../packages/compiler/dist/index.js";
import { evaluate } from "../../packages/core/dist/index.js";
import { renderSvg } from "../../packages/renderer-svg/dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const catalog = join(root, "examples", "catalog");
const manifest = JSON.parse(readFileSync(join(catalog, "index.json"), "utf8"));
const categories = ["computing","science","workflows"];
const files = [];
for (const category of categories) {
  const base = join(catalog, category);
  for (const dirent of readdirSync(base, {withFileTypes:true})) {
    if (!dirent.isDirectory()) continue;
    const filename = join(base, dirent.name, "scene.json");
    if (existsSync(filename)) files.push(filename);
  }
}
files.sort();
assert.equal(manifest.version, 1, "Catalog manifest version");
assert.equal(files.length, 150, "Exactly 150 independently loadable scene files required");
assert.equal(manifest.count, files.length, "Manifest count must match on-disk scenes");
assert.equal(manifest.examples.length, files.length, "Manifest examples must match scenes");

const seenFiles = new Set();
const seenTopics = new Set();
const seenTitles = new Set();
const seenNarratives = new Set();
const seenScenes = new Set();
const patterns = new Set();
const actions = new Set();
const objectKinds = new Set();
const totals = Object.fromEntries(categories.map(category => [category, {count:0,frames:0,bytes:0}]));
const issues = [];
let renderedFrames = 0;
let evaluatedFrames = 0;
const elapsedStart = performance.now();

function reject(message) {issues.push(message);}
function sha(value) {return createHash("sha256").update(value).digest("hex");}
function visit(entry) {
  const display = `${entry.category}/${entry.id}`;
  try {
    assert.ok(categories.includes(entry.category), "Unrecognized category");
    assert.match(entry.id, /^[a-z0-9-]+$/, "Invalid scene slug");
    assert.ok(!seenTopics.has(entry.id), "Duplicate slug");
    assert.ok(!seenTitles.has(entry.title), "Duplicate title");
    assert.ok(!seenNarratives.has(entry.description), "Duplicate teaching narrative");
    seenTopics.add(entry.id);
    seenTitles.add(entry.title);
    seenNarratives.add(entry.description);
    assert.ok(entry.steps.length === 4, "Must have four curated instructional steps");
    assert.ok(new Set(entry.steps).size === 4, "Instructional steps cannot repeat");
    assert.ok(entry.steps.every(step => step.length >= 15), "Each step must explain something substantive");
    assert.equal(entry.entities.length, 4, "Four explanatory entities required");
    patterns.add(entry.pattern);
    const filename = resolve(catalog, entry.file);
    assert.ok(filename.startsWith(catalog + (process.platform==="win32" ? "\\" : "/")), "Path must stay in catalog");
    assert.ok(!seenFiles.has(filename), "Duplicate manifest path");
    seenFiles.add(filename);
    assert.ok(existsSync(filename), "Manifest references missing scene");
    const source=readFileSync(filename,"utf8");
    assert.ok(!seenScenes.has(sha(source)), "Identical scene JSON found");
    seenScenes.add(sha(source));
    assert.ok(Buffer.byteLength(source) < 100_000, "Example unexpectedly large");
    const original=JSON.parse(source);
    assert.equal(original.version, "1.0");
    assert.equal(original.scene.width, 1000);
    assert.equal(original.scene.height, 560);
    assert.ok(original.timeline.length >= 12, "Animation must contain multiple actions");
    assert.equal(original.markers?.length, 4, "Must label each teaching stage");
    assert.equal(original.objects.filter(o => o.id.startsWith("stage_")).length,4);
    for(const o of original.objects) objectKinds.add(o.type);
    for(const action of original.timeline) actions.add(action.type);
    const compiled=compileJson(source);
    assert.ok(compiled.ok, `Compiler errors: ${JSON.stringify(compiled.diagnostics)}`);
    assert.ok(compiled.scene);
    assert.equal(compiled.diagnostics.length,0, "Warnings/diagnostics in valid scenes");
    const scene=compiled.scene;
    const expectedTextIds=entry.steps.map((_,i)=>`stage_${i}`);
    const times=[0,190,600,900,1260,1799,1800,2110,2700,2810,3200];
    const canonicalTimes = [0,900,1800,2700,3200];
    const baseline=new Map();
    for(const t of times){
      const frame=evaluate(scene,t);
      evaluatedFrames++;
      assert.equal(frame.time,t);
      assert.equal(frame.objects.length,scene.objects.length);
      assert.ok(frame.objects.every(o => o.transform && Object.values(o.transform).every(Number.isFinite)),
        "Non-finite object transform");
      const svg=renderSvg(frame);
      renderedFrames++;
      assert.match(svg, /^<svg\b[^>]*>/, "Output must begin with SVG element");
      assert.ok(svg.includes("</svg>"),"Output must close SVG");
      assert.doesNotMatch(svg, /(?<![A-Za-z])(?:NaN|Infinity|undefined)(?![A-Za-z])|<script\b|javascript:|onload=/i,
        "Unsafe or invalid SVG output");
      assert.ok(Buffer.byteLength(svg)<150_000,"Rendered output size runaway");
      if(canonicalTimes.includes(t)) baseline.set(t,{frame,svg});
    }
    for(let i=0;i<4;i++){
      const time=i*900;
      const frame=baseline.get(time).frame;
      const active=frame.objects.filter(o=>expectedTextIds.includes(o.id) && o.visible);
      assert.deepEqual(active.map(o=>o.id),[`stage_${i}`],
        `At ${time} ms the scene must explain exactly step ${i+1}`);
      const svg=baseline.get(time).svg;
      assert.ok(svg.includes(entry.steps[i].slice(0,8)), "Teaching caption missing in SVG");
      const focused=evaluate(scene,time+600).objects.find(o=>o.id===`concept_${i}`);
      assert.notEqual(focused.style.fill,"#ffffff","Animated focus should have a visible effect");
    }
    const last = baseline.get(3200).svg;
    const first=baseline.get(0).svg;
    assert.notEqual(first,last, "Scene never visually changes over time");
    // Compare random-access seeking after unrelated calls, and serialized IR.
    for(const t of [1800,0,2700,900,3200]){
      const actual=evaluate(scene,t);
      evaluatedFrames++;
      assert.deepEqual(actual, baseline.get(t).frame, `Seek nondeterministic at t=${t}`);
      assert.equal(renderSvg(actual),baseline.get(t).svg, `SVG unstable at t=${t}`);
      renderedFrames++;
    }
    const recompiled=compileJson(JSON.stringify(scene));
    assert.ok(recompiled.ok, "Canonical scene fails compiler round-trip");
    for(const t of [0,1260,3200]){
      const a=renderSvg(evaluate(recompiled.scene,t));
      const b=renderSvg(evaluate(scene,t));
      renderedFrames+=2;
      evaluatedFrames+=2;
      assert.equal(a,b, `Recompiled scene changed rendering at t=${t}`);
    }
    const stats=totals[entry.category];
    stats.count++;
    stats.frames+=times.length+5+6;
    stats.bytes+=Buffer.byteLength(source);
  } catch(error){
    reject(`${display}: ${error.message}`);
  }
}
for (const entry of manifest.examples) visit(entry);
if(issues.length) console.error("Sample catalog failures:", issues.slice(0,10));
assert.deepEqual([...seenFiles].sort(),files, "Manifest must enumerate every checked-in scene");
assert.ok(patterns.size>=12,"Catalog has insufficient topology variety");
assert.ok(actions.size>=8,"Catalog has insufficient animation vocabulary coverage");
assert.ok(objectKinds.size>=5,"Catalog has insufficient shape/connector vocabulary coverage");
for (const category of categories) assert.equal(totals[category].count,50, `${category} must have 50 qualified scenes`);

// Negative control: test machinery must reject fundamentally bad examples.
const badCases=[
  '{"version":"1.0","scene":{"width":0,"height":560},"objects":[],"timeline":[]}',
  '{"version":"1.0","scene":{"width":1000,"height":560},"objects":[{"id":"a","type":"rect","width":10,"height":10},{"id":"a","type":"rect","width":10,"height":10}],"timeline":[]}',
  '{"version":"1.0","scene":{"width":1000,"height":560},"objects":[],"timeline":[{"id":"missing","target":"fake","type":"move","start":0,"duration":100,"to":{"x":1,"y":2}}]}'
];
for(const [index,bad] of badCases.entries()){
  assert.ok(!compileJson(bad).ok,`Negative control ${index+1} was wrongly accepted`);
}

if(issues.length){
  console.error(`FAIL: ${issues.length} catalog qualification errors:`);
  for(const issue of issues.slice(0,45)) console.error("  -",issue);
  if(issues.length>45) console.error(`  ... ${issues.length-45} more`);
  process.exitCode=1;
} else {
  console.log(`PASS: ${files.length} curated scenes across ${categories.length} domains`);
  console.log(`PASS: ${evaluatedFrames} evaluations / ${renderedFrames} SVG renders and seek/IR determinism checks`);
  console.log(`PASS: ${patterns.size} diagram topology variants, ${actions.size} action types, ${objectKinds.size} object types`);
  console.log(`PASS: negative compiler cases and unique titles, narratives, slugs, and scene bytes`);
  console.log(`Breakdown: ${categories.map(c=>c+":"+totals[c].count).join(" | ")}`);
  console.log(`Elapsed: ${((performance.now()-elapsedStart)/1000).toFixed(2)}s`);
}
