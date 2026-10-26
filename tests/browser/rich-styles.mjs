/** Static/interactive parity, seek determinism and rich-style lifecycle in real engines. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { chromium, firefox, webkit } from "playwright";

const source = await readFile("examples/complex-styling/scene.json", "utf8");
const compiled = await build({ stdin: { contents: `
  import {compileJson} from "./packages/compiler/dist/index.js";
  import {evaluate} from "./packages/core/dist/index.js";
  import {renderSvg,mountSvg} from "./packages/renderer-svg/dist/index.js";
  import {renderSketchSvg} from "./packages/renderer-sketch/dist/index.js";
  const result=compileJson(${JSON.stringify(source)});
  if(!result.ok)throw Error(JSON.stringify(result.diagnostics));
  const scene=result.scene, host=document.querySelector("#host"); let mount;
  window.DEMO={
    static(time){mount?.destroy();mount=undefined;host.innerHTML=renderSvg(evaluate(scene,time));},
    hydrate(time){const svg=host.firstElementChild, shape=host.querySelector('[data-anim8-id="leader"]');mount=mountSvg(host,evaluate(scene,time));return svg===host.firstElementChild&&shape===host.querySelector('[data-anim8-id="leader"]');},
    seek(time){mount.update(evaluate(scene,time));},
    xml(time){return [renderSvg(evaluate(scene,time)),renderSketchSvg(evaluate(scene,time))];},
    curvedReveal(progress,cap="butt"){
      const doc={version:"1.0",scene:{width:240,height:160,background:"white"},timeline:[],objects:[{
        id:"curve",type:"path",d:"M 20 140 Q 120 -80 220 140",drawProgress:progress,
        transform:{x:0,y:0,rotation:0,scaleX:1,scaleY:1,opacity:1},
        style:{fill:"none",stroke:"#000000",strokeWidth:20,strokeDasharray:[12,6],strokeLinecap:cap},visible:true,z:0
      }]};
      return [renderSvg(evaluate(doc,0)),renderSketchSvg(evaluate(doc,0))];
    },
    clearStyles(){const frame=evaluate(scene,4200);for(const o of frame.objects){delete o.style.fillGradient;delete o.style.colorGradient;delete o.style.strokeGradient;delete o.style.strokeDasharray;delete o.style.strokeDashoffset;if('textRuns' in o)delete o.textRuns;} mount.update(frame);},
    destroy(){mount.destroy();}
  };`, resolveDir: process.cwd(), sourcefile: "rich-style-entry.js" }, bundle: true, platform: "browser", format: "iife", write: false });
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : "text/html");
  res.end(req.url === "/bundle.js" ? compiled.outputFiles[0].text : '<!doctype html><html><body style="margin:0"><div id="host" style="width:1200px;height:700px"></div><script src="/bundle.js"></script></body></html>');
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
await mkdir("artifacts/rich-styles", { recursive: true });
try {
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 700 }, deviceScaleFactor: 1 });
      const errors = []; page.on("pageerror", e => errors.push(e.message));
      await page.goto("http://127.0.0.1:" + server.address().port);
      await page.waitForFunction(() => Boolean(window.DEMO));
      for (const time of [0, 1200, 3000, 4200, 6000]) {
        assert.equal(await page.evaluate(time => DEMO.xml(time).every(svg => !new DOMParser().parseFromString(svg, "image/svg+xml").querySelector("parsererror")), time), true, name + " must parse both renderers as valid SVG");
        await page.evaluate(time => DEMO.static(time), time);
        await page.evaluate(() => document.fonts.ready);
        const before = await page.locator("#host").screenshot();
        assert.equal(await page.evaluate(time => DEMO.hydrate(time), time), true, "Hydration must preserve SVG/shape identity");
        assert.deepEqual(await page.locator("#host").screenshot(), before, name + " static and mounted pixels must agree at " + time);
        await page.evaluate(() => { DEMO.seek(6000); DEMO.seek(0); });
        await page.evaluate(time => DEMO.seek(time), time);
        assert.deepEqual(await page.locator("#host").screenshot(), before, name + " seek history must not affect pixels");
      }
      const revealPage=await browser.newPage({viewport:{width:240,height:160},deviceScaleFactor:1});
      await revealPage.setContent('<html><body style="margin:0;background:white"></body></html>');
      const clip={x:0,y:0,width:240,height:160};
      const blank=await revealPage.screenshot({clip});
      for(const cap of ["butt","round","square"]){
      const zero=await page.evaluate(cap=>DEMO.curvedReveal(0,cap),cap);
      const partial=await page.evaluate(cap=>DEMO.curvedReveal(0.5,cap),cap);
      for(let i=0;i<zero.length;i++){
        await revealPage.setContent('<html><body style="margin:0;background:white">'+zero[i]+'</body></html>');
        assert.ok((await revealPage.screenshot({clip})).equals(blank),name+' unrevealed curved outline must not leak stroke (renderer '+i+')');
        await revealPage.setContent('<html><body style="margin:0;background:white">'+partial[i]+'</body></html>');
        assert.ok(!(await revealPage.screenshot({clip})).equals(blank),name+' partial curved reveal must actually draw stroke (renderer '+i+')');
      }
      }
      await revealPage.close();
      await page.evaluate(() => DEMO.seek(3000));
      assert.equal(await page.locator('[data-anim8-id="leader"]').getAttribute("stroke-dasharray"), "8 5");
      assert.equal(await page.locator('[data-anim8-id="request"]').getAttribute("stroke-dashoffset"), "-90");
      assert.equal(await page.locator('[data-anim8-id="commit-progress"]').getAttribute("stroke-dasharray"), "12 6");
      assert.ok(await page.locator('[data-anim8-id="commit-progress"]').getAttribute("mask"));
      assert.equal(await page.locator('linearGradient[gradientUnits="userSpaceOnUse"]').count(), 1, "Horizontal gradient strokes must not disappear");
      assert.equal(await page.locator('[data-anim8-id="subtitle"] tspan').count(), 4);
      assert.equal(await page.locator('[data-anim8-connector-label="request"]').textContent(), "1. write");
      await page.locator("#host").screenshot({ path: "artifacts/rich-styles/" + name + "-processing.png" });
      await page.evaluate(() => DEMO.seek(6000));
      assert.equal(await page.locator('[data-anim8-id="leader"]').getAttribute("stroke-dasharray"), "none");
      assert.equal(await page.locator('[data-anim8-id="request"]').getAttribute("stroke"), "#16a34a");
      assert.equal(await page.locator('[data-anim8-id="commit-progress"]').getAttribute("mask"), null);
      await page.locator("#host").screenshot({ path: "artifacts/rich-styles/" + name + "-finished.png" });
      await page.evaluate(() => DEMO.clearStyles());
      assert.equal(await page.locator("linearGradient, mask, tspan").count(), 0, "Stale paint definitions and text spans must be removed");
      await page.evaluate(() => DEMO.destroy());
      assert.equal(await page.locator("#host *").count(), 0);
      assert.deepEqual(errors, []);
      console.log("PASS " + name + ": rich text/gradients/dash flow/reveal/finish, static hydration pixel parity, deterministic seeks and cleanup");
    } finally { await browser.close(); }
  }
} finally { await new Promise(done => server.close(done)); }
