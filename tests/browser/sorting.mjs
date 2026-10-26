/** Real player motion, persistent DOM identity and pixel parity for a full merge sort. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium, firefox, webkit } from "playwright";
import { compileJson } from "../../packages/compiler/dist/index.js";
import { evaluate, worldMatrix } from "../../packages/core/dist/index.js";

const source = await readFile("examples/merge-sort-motion/scene.json", "utf8");
const trace = JSON.parse(await readFile("examples/merge-sort-motion/trace.json", "utf8"));
const result = compileJson(source); assert.ok(result.ok, JSON.stringify(result.diagnostics));
const document = result.scene;
const compiled = await build({ stdin: { resolveDir: process.cwd(), sourcefile: "sorting-entry.js", contents: `
  import {compileJson} from "./packages/compiler/dist/index.js";
  import {evaluate} from "./packages/core/dist/index.js";
  import {renderSvg} from "./packages/renderer-svg/dist/index.js";
  import {mountPlayer} from "./packages/player/dist/index.js";
  const result=compileJson(${JSON.stringify(source)});if(!result.ok)throw Error(JSON.stringify(result.diagnostics));
  const scene=result.scene, host=document.querySelector('#host');
  const ids=scene.objects.filter(o=>o.id.startsWith('box-')||o.id.startsWith('identity-')).map(o=>o.id);
  let frames=0;const moved=new Set(), seen=new Map();
  const controller=mountPlayer(host,scene,{onFrame(frame){
    frames++;for(const id of ids){const node=host.querySelector('[data-anim8-id="'+id+'"]'), transform=node.getAttribute('transform');
      if(seen.has(id)&&seen.get(id)!==transform)moved.add(id);seen.set(id,transform);}
  }});
  const original=new Map(ids.map(id=>[id,host.querySelector('[data-anim8-id="'+id+'"]')]));
  window.SORT={
    seek(time){controller.pause();controller.seek(time);},
    play(speed=1){controller.restart();controller.setSpeed(speed);controller.play();},
    reverse(){controller.pause();controller.seek(controller.getDuration());controller.setSpeed(-4);controller.play();},
    pause(){controller.pause();},
    stats(){return {time:controller.getTime(),playing:controller.isPlaying(),frames,moved:[...moved],identity:ids.every(id=>original.get(id)===host.querySelector('[data-anim8-id="'+id+'"]'))};},
    snapshot(){return [...original].map(([id,node])=>{const m=node.transform.baseVal.consolidate().matrix;return {id,x:m.e,y:m.f,text:node.textContent};});},
    reference(time){return renderSvg(evaluate(scene,time));},
    destroy(){controller.destroy();}
  };
` }, bundle: true, platform: "browser", format: "iife", write: false });
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : "text/html");
  res.end(req.url === "/bundle.js" ? compiled.outputFiles[0].text : '<!doctype html><html><body style="margin:0"><div id="host" style="width:1280px;height:960px"></div><div id="reference" style="display:none;position:absolute;left:0;top:0;width:1280px;height:960px"></div><script src="/bundle.js"></script></body></html>');
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
await mkdir("artifacts/sorting", { recursive: true });
const report = { ok: false, durationMs: trace.durationMs, profiles: [] };
const longMove = trace.moves.filter(m => m.kind === "merge").sort((a, b) => Math.abs(b.to.x - b.from.x) - Math.abs(a.to.x - a.from.x))[0];
const snapshots = [
  { name: "input", time: 0 }, { name: "splitting", time: 200 },
  { name: "divided", time: trace.checkpoints.find(p => p.label === "split-depth-4").time },
  { name: "merging", time: longMove.start + 180 }, { name: "sorted", time: trace.durationMs },
];
function expectedSnapshot(time) {
  const frame = evaluate(document, time), map = new Map(frame.objects.map(o => [o.id, o]));
  return frame.objects.filter(o => o.id.startsWith("box-") || o.id.startsWith("identity-")).map(o => {
    const m = worldMatrix(o, map); return { id: o.id, x: m.e, y: m.f, text: o.text };
  });
}
function compareSnapshot(actual, expected, context) {
  const map = new Map(actual.map(p => [p.id, p]));
  assert.equal(map.size, 24, "All 12 boxes and tags must exist");
  for (const p of expected) {
    const rendered = map.get(p.id);
    assert.equal(rendered.text, p.text, context + " labels must stay with their original box");
    assert.ok(Math.abs(rendered.x - p.x) < 0.001 && Math.abs(rendered.y - p.y) < 0.001, context + " rendered position mismatch: " + p.id);
  }
}
try {
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await engine.launch({ headless: true });
    const profile = { name, ok: false, browserVersion: browser.version() }; report.profiles.push(profile);
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1 });
      const referencePage = await browser.newPage({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1 });
      await referencePage.setContent('<!doctype html><html><body style="margin:0"><div id="reference" style="width:1280px;height:960px"></div></body></html>');
      const errors = []; page.on("pageerror", error => errors.push(error.message));
      await page.goto("http://127.0.0.1:" + server.address().port); await page.waitForFunction(() => Boolean(window.SORT));
      await page.evaluate(() => document.fonts.ready);
      let initialPixels;
      for (const snapshot of snapshots) {
        await page.evaluate(time => SORT.seek(time), snapshot.time);
        compareSnapshot(await page.evaluate(() => SORT.snapshot()), expectedSnapshot(snapshot.time), name + " " + snapshot.name);
        const before = await page.locator("#host").screenshot({ path: `artifacts/sorting/${name}-${snapshot.name}.png` });
        if (snapshot.name === "input") initialPixels = before;
        const svg = await page.evaluate(time => SORT.reference(time), snapshot.time);
        await referencePage.evaluate(svg => document.querySelector("#reference").innerHTML = svg, svg);
        await referencePage.evaluate(() => document.fonts.ready);
        const referencePixels = await referencePage.locator("#reference").screenshot({ path: `artifacts/sorting/${name}-${snapshot.name}-static.png` });
        assert.ok(referencePixels.equals(before), name + " static and mounted pixels must match " + snapshot.name);
        await page.evaluate(duration => { SORT.seek(duration); SORT.seek(0); }, trace.durationMs);
        await page.evaluate(time => SORT.seek(time), snapshot.time);
        assert.ok((await page.locator("#host").screenshot()).equals(before), name + " arbitrary seek history must preserve pixels");
        assert.equal((await page.evaluate(() => SORT.stats())).identity, true, "Boxes/tags must retain actual DOM nodes");
      }
      await referencePage.close();
      await page.bringToFront();
      // Exercise native RAF playback. Chromium runs the full timeline at normal speed.
      const speed = name === "chromium" ? 1 : 4;
      const beforeFrames = (await page.evaluate(() => SORT.stats())).frames;
      await page.evaluate(speed => SORT.play(speed), speed);
      const started = Date.now();
      await page.waitForFunction(() => !SORT.stats().playing, { }, { timeout: trace.durationMs / speed + 20_000 });
      const state = await page.evaluate(() => SORT.stats());
      assert.equal(state.time, trace.durationMs);
      assert.equal(state.identity, true, "Playback cannot recreate boxes or identity tags");
      assert.equal(state.moved.length, 24, "Every box and identity tag must actually change transform");
      compareSnapshot(await page.evaluate(() => SORT.snapshot()), expectedSnapshot(trace.durationMs), name + " playback finish");
      assert.ok(state.frames - beforeFrames > 100, "Real RAF playback must render many frames");
      const paused = state.frames;
      await page.waitForTimeout(120);
      assert.equal((await page.evaluate(() => SORT.stats())).frames, paused, "Playback must stop after finishing");
      // Reverse playback must arrive at the exact original arrangement.
      await page.evaluate(() => SORT.reverse());
      await page.waitForFunction(() => !SORT.stats().playing, {}, { timeout: trace.durationMs / 4 + 20_000 });
      assert.equal((await page.evaluate(() => SORT.stats())).time, 0);
      compareSnapshot(await page.evaluate(() => SORT.snapshot()), expectedSnapshot(0), name + " reverse playback finish");
      assert.ok((await page.locator("#host").screenshot()).equals(initialPixels), "Reverse playback must restore initial pixels");
      await page.evaluate(() => SORT.destroy());
      assert.equal(await page.locator("#host *").count(), 0);
      assert.deepEqual(errors, []);
      Object.assign(profile, { ok: true, playbackSpeed: speed, reverseSpeed: -4, wallTimeMs: Date.now() - started, renderedFrames: state.frames - beforeFrames, movingObjects: state.moved.length, snapshots: snapshots.length });
      console.log(JSON.stringify(profile));
    } finally { await browser.close(); }
  }
  report.ok = report.profiles.every(p => p.ok);
} finally {
  await new Promise(done => server.close(done));
  await writeFile("artifacts/sorting/browser.json", JSON.stringify(report, null, 2) + "\n");
}
assert.ok(report.ok);
