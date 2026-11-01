/** Renderer correctness fixtures: independent pixel expectations, not teaching demos. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium, firefox, webkit } from "playwright";
import { inflateSync } from "node:zlib";
import { createHash } from "node:crypto";

const bundle = await build({ stdin: { resolveDir: process.cwd(), sourcefile: "rendering-quality.js", contents: `
import {defaultTransform,defaultStyle,evaluate} from './packages/core/dist/index.js';
import {renderSvg,mountSvg} from './packages/renderer-svg/dist/index.js';
import {renderSketchSvg} from './packages/renderer-sketch/dist/index.js';
import {mountPlayer} from './packages/player/dist/index.js';
const host=document.querySelector('#host'); let mount,interactive;
const common=()=>({transform:defaultTransform(),style:{...defaultStyle(),fill:'none',stroke:'#000000',strokeWidth:20},visible:true,z:0});
function documentFor(objects,timeline=[]){return {version:'1.0',scene:{width:240,height:160,background:'white',seed:123},objects,timeline};}
function mountFrame(frame){if(mount)mount.update(frame);else mount=mountSvg(host,frame);return new XMLSerializer().serializeToString(host.firstElementChild);}
window.QUALITY={
  reveal(type,cap,dashed,progress,fill='none'){
    const geometry=type==='path'?{d:'M 20 140 Q 120 -80 220 140'}:{points:[{x:20,y:140},{x:120,y:20},{x:220,y:140}]};
    const object={...common(),...geometry,id:'shape',type,drawProgress:progress,style:{...common().style,fill,strokeLinecap:cap,strokeOpacity:0.6,...(dashed?{strokeDasharray:[12,6]}:{})}};
    const frame=evaluate(documentFor([object]),0),previous=host.querySelector('[data-anim8-id="shape"]');
    mountFrame(frame);
    return {staticSvg:renderSvg(frame),sketchSvg:renderSketchSvg(frame),identity:!previous||previous===host.querySelector('[data-anim8-id="shape"]')};
  },
  composed(progress,gradient,hydrate=false,hidden=false){
    const group={...common(),id:'parent',type:'group',children:['shape'],transform:{...defaultTransform(),opacity:0.5}};
    const object={...common(),id:'shape',type:'polygon',parentId:'parent',points:[{x:20,y:140},{x:120,y:20},{x:220,y:140}],drawProgress:progress,visible:!hidden,
      transform:{...defaultTransform(),opacity:0.8},style:{...common().style,fill:'#ff0000',fillOpacity:0.75,strokeOpacity:0.6,strokeDasharray:[12,6],...(gradient?{fillGradient:{type:'linear',stops:[{offset:0,color:'#ff0000'},{offset:1,color:'#0000ff'}]}}:{})}};
    const frame=evaluate(documentFor([group,object]),0),staticSvg=renderSvg(frame);
    let original=host.querySelector('[data-anim8-id="shape"]'),root=host.firstElementChild;
    if(hydrate){mount?.destroy();host.innerHTML=staticSvg;original=host.querySelector('[data-anim8-id="shape"]');root=host.firstElementChild;mount=mountSvg(host,frame);}
    else mountFrame(frame);
    return {staticSvg,sketchSvg:renderSketchSvg(frame),identity:!original||original===host.querySelector('[data-anim8-id="shape"]'),hydrated:!hydrate||root===host.firstElementChild,groups:host.querySelectorAll('[data-anim8-reveal-group]').length};
  },
  removeShape(){mountFrame(evaluate(documentFor([]),0));return host.querySelectorAll('[data-anim8-id],[data-anim8-reveal-group],linearGradient,mask').length;},
  interactive(){
    window.objectEvents=[];
    const shape={...common(),id:'shape',type:'polygon',points:[{x:20,y:140},{x:120,y:20},{x:220,y:140}],drawProgress:0.5,style:{...common().style,fill:'#0000ff',strokeDasharray:[12,6]}};
    interactive=mountPlayer(host,documentFor([shape]),{onObjectEvent:event=>{if(event.type==='click'||event.type==='activate')window.objectEvents.push({type:event.type,id:event.objectId});}});
  },
  hierarchy(time,hidden){
    const outer={...common(),id:'outer',type:'group',children:['inner'],transform:{...defaultTransform(),opacity:0.5},visible:hidden!=='outer'};
    const inner={...common(),id:'inner',type:'group',children:['box','label','edge'],parentId:'outer',transform:{...defaultTransform(),opacity:0.4},visible:hidden!=='inner'};
    const box={...common(),id:'box',type:'rect',parentId:'inner',width:100,height:80,transform:{...defaultTransform(),x:120,y:100,opacity:0.75},style:{fill:'#ff0000',stroke:'none'},visible:hidden!=='box'};
    const label={...common(),id:'label',type:'text',parentId:'inner',text:'Label',transform:{...defaultTransform(),x:120,y:25,opacity:0.75}};
    const edge={...common(),id:'edge',type:'connector',parentId:'inner',from:{objectId:'box',anchor:'left'},to:{objectId:'box',anchor:'top'},kind:'straight',label:'Link',transform:{...defaultTransform(),opacity:0.75}};
    const doc=documentFor([outer,inner,box,label,edge],[{id:'fade',type:'opacity',target:'outer',start:0,duration:1000,to:0}]);
    const frame=evaluate(doc,time),staticSvg=renderSvg(frame),sketchSvg=renderSketchSvg(frame),mounted=mountFrame(frame);
    const inspect=svg=>{const root=new DOMParser().parseFromString(svg,'image/svg+xml');return Object.fromEntries(['box','label','edge'].map(id=>{const node=root.querySelector('[data-anim8-id="'+id+'"]');return [id,node?Number(node.getAttribute('opacity')):null];}));};
    return {staticSvg,sketchSvg,attributes:[inspect(staticSvg),inspect(mounted),inspect(sketchSvg)]};
  },
  destroy(){mount?.destroy();mount=undefined;interactive?.destroy();interactive=undefined;}
};
` }, bundle: true, platform: "browser", format: "iife", write: false });
// Decode the actual browser screenshot (8-bit RGB/RGBA PNG), rather than SVG
// loaded into an Image: Firefox applies different pathLength behavior there.
function pixels(png) {
  let width, height, channels, offset = 8;
  const data = [];
  while (offset < png.length) {
    const size = png.readUInt32BE(offset), type = png.toString("ascii", offset + 4, offset + 8);
    const chunk = png.subarray(offset + 8, offset + 8 + size);
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4);
      assert.equal(chunk[8], 8); assert.ok(chunk[9] === 2 || chunk[9] === 6); assert.equal(chunk[12], 0);
      channels = chunk[9] === 6 ? 4 : 3;
    } else if (type === "IDAT") data.push(chunk);
    offset += size + 12;
  }
  const raw = inflateSync(Buffer.concat(data)), stride = width * channels;
  const decoded = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]; assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? decoded[y * stride + x - channels] : 0;
      const up = y ? decoded[(y - 1) * stride + x] : 0;
      const corner = y && x >= channels ? decoded[(y - 1) * stride + x - channels] : 0;
      const predictor = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, corner)][filter];
      decoded[y * stride + x] = (raw[y * (stride + 1) + x + 1] + predictor) & 255;
    }
  }
  let colored = 0;
  for (let i = 0; i < decoded.length; i += channels) if (decoded[i] !== 255 || decoded[i + 1] !== 255 || decoded[i + 2] !== 255) colored++;
  const at = (100 * width + 120) * channels;
  return { colored, width, height, channels, hash: createHash("sha256").update(decoded).digest("hex"), center: [...decoded.subarray(at, at + 3), channels === 4 ? decoded[at + 3] : 255] };
}
async function capture(page, referencePage, result) {
  const mountedPng = await page.locator("#host").screenshot();
  const mounted = pixels(mountedPng);
  const output = { ...result, mounted };
  for (const renderer of ["static", "sketch"]) {
    await referencePage.setContent('<!doctype html><html><body style="margin:16px">' + result[renderer + "Svg"] + '</body></html>');
    const png = await referencePage.screenshot({ clip: { x: 16, y: 16, width: 240, height: 160 } });
    output[renderer] = pixels(png);
    if (renderer === "static" && output.static.hash !== mounted.hash) {
      await writeFile("artifacts/rendering-quality/parity-static.png", png);
      await writeFile("artifacts/rendering-quality/parity-mounted.png", mountedPng);
      await writeFile("artifacts/rendering-quality/parity-static.svg", result.staticSvg);
      await writeFile("artifacts/rendering-quality/parity-mounted.svg", await page.locator("#host svg").evaluate(svg => svg.outerHTML));
    }
  }
  return output;
}
const engines = { chromium, firefox, webkit };
const requested = [...new Set((process.env.ANIM8_BROWSER_ENGINES ?? "chromium,firefox,webkit").split(",").map(name => name.trim()).filter(Boolean))];
assert.ok(requested.length && requested.every(name => Object.hasOwn(engines, name)), "Select chromium, firefox and/or webkit");
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : "text/html");
  res.end(req.url === "/bundle.js" ? bundle.outputFiles[0].text : '<!doctype html><html><body style="margin:16px"><div id="host" style="width:240px;height:160px"></div><script src="/bundle.js"></script></body></html>');
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
await mkdir("artifacts/rendering-quality", { recursive: true });
const report = { ok: false, profiles: [] };

try {
  for (const name of requested) {
    const engine = engines[name];
    const browser = await engine.launch({ headless: true });
    const profile = { name, ok: false, browserVersion: browser.version(), revealCases: 0, fillCases: 0, hierarchyCases: 0 };
    report.profiles.push(profile);
    const page = await browser.newPage({ viewport: { width: 272, height: 192 }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(15000);
    const referencePage = await browser.newPage({ viewport: { width: 272, height: 192 }, deviceScaleFactor: 1 });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto("http://127.0.0.1:" + server.address().port);
      await page.waitForFunction(() => Boolean(window.QUALITY));
      for (const type of ["path", "polygon", "polyline"]) for (const cap of ["butt", "round", "square"]) for (const dashed of [false, true]) {
        const context = `${name} ${type} ${cap} ${dashed ? "dashed" : "solid"}`;
        await page.evaluate(() => QUALITY.destroy());
        const states = [];
        for (const progress of [0, 0.5, 1, 0]) {
          const result = await page.evaluate(({ type, cap, dashed, progress }) => QUALITY.reveal(type, cap, dashed, progress), { type, cap, dashed, progress });
          states.push({ progress, ...await capture(page, referencePage, result) });
        }
        for (const state of states) {
          assert.ok(state.identity, context + " must retain the mounted object across seeks");
          assert.equal(state.static.hash, state.mounted.hash, context + " progress " + state.progress + " standalone and mounted pixels must agree " + JSON.stringify({ static: state.static, mounted: state.mounted }));
          for (const renderer of ["static", "mounted", "sketch"]) {
            if (state.progress === 0) assert.equal(state[renderer].colored, 0, context + " " + renderer + " must have no unrevealed stroke pixels");
            else assert.ok(state[renderer].colored > 10, context + " " + renderer + " must actually reveal the outline");
          }
        }
        for (const renderer of ["static", "mounted", "sketch"]) assert.ok(states[2][renderer].colored > states[1][renderer].colored, context + " full reveal must cover more than half reveal");
        profile.revealCases++;
      }
      // White fill on a white background must not change the revealed stroke.
      // This detects masks accidentally revealing an entire filled interior.
      for (const type of ["path", "polygon", "polyline"]) for (const progress of [0, 0.5, 1, 0]) {
        await page.evaluate(() => QUALITY.destroy());
        const empty = await capture(page, referencePage, await page.evaluate(({ type, progress }) => QUALITY.reveal(type, "round", true, progress, "none"), { type, progress }));
        const painted = await capture(page, referencePage, await page.evaluate(({ type, progress }) => QUALITY.reveal(type, "round", true, progress, "#ffffff"), { type, progress }));
        assert.ok(painted.identity, name + " fill changes preserve object identity");
        for (const renderer of ["static", "mounted", "sketch"]) {
          assert.equal(painted[renderer].hash, empty[renderer].hash, `${name} ${type} ${renderer} fill must not expose hidden stroke at ${progress}`);
        }
        profile.fillCases++;
      }
      // Fill and stroke are composited once under nested opacity, including hydration.
      for (const gradient of [false, true]) {
        await page.evaluate(() => QUALITY.destroy());
        for (const progress of [0, 0.5, 1, 0]) {
          const result = await page.evaluate(({ progress, gradient }) => QUALITY.composed(progress, gradient, progress === 0.5), { progress, gradient });
          assert.ok(result.identity && result.hydrated, name + " filled reveal retains hydrated SVG and path nodes");
          assert.equal(result.groups, progress < 1 ? 1 : 0, name + " reveal wrappers are cleaned up at completion");
          const state = await capture(page, referencePage, result);
          assert.equal(state.static.hash, state.mounted.hash, name + " translucent filled reveal static/mounted pixels agree");
          const expected = gradient ? [217, 179, 217, 255] : [255, 179, 179, 255];
          for (const renderer of ["static", "mounted", "sketch"]) for (let c = 0; c < 4; c++) {
            assert.ok(Math.abs(state[renderer].center[c] - expected[c]) <= 2, name + " " + renderer + " independent translucent fill pixel oracle");
          }
          profile.fillCases++;
        }
        const hidden = await capture(page, referencePage, await page.evaluate(gradient => QUALITY.composed(0.5, gradient, false, true), gradient));
        for (const renderer of ["static", "mounted", "sketch"]) assert.equal(hidden[renderer].colored, 0, name + " hide the composed fill and outline together");
        await page.evaluate(gradient => QUALITY.composed(0.5, gradient), gradient);
        assert.equal(await page.evaluate(() => QUALITY.removeShape()), 0, name + " remove stale reveal wrappers, shapes and paints");
      }
      await page.evaluate(() => { QUALITY.destroy(); QUALITY.interactive(); });
      await page.mouse.click(136, 116); // Filled interior, away from the revealed outline.
      await page.locator('[data-anim8-id="shape"]').focus();
      await page.keyboard.press("Enter");
      assert.deepEqual(await page.evaluate(() => window.objectEvents), [{ type: "click", id: "shape" }, { type: "activate", id: "shape" }], name + " composed shapes preserve pointer and keyboard events");
      // Hiding an outline must not hide the independent fill channel.
      await page.evaluate(() => QUALITY.destroy());
      const filled = await capture(page, referencePage, await page.evaluate(() => QUALITY.reveal("polygon", "round", false, 0, "#0000ff")));
      for (const renderer of ["static", "mounted", "sketch"]) assert.deepEqual(filled[renderer].center, [0, 0, 255, 255], name + " zero reveal preserves fill");
      await page.evaluate(() => QUALITY.destroy());
      for (const hidden of [null, "outer", "inner", "box"]) for (const time of [0, 500, 1000, 0]) {
        const state = await capture(page, referencePage, await page.evaluate(({ time, hidden }) => QUALITY.hierarchy(time, hidden), { time, hidden }));
        assert.equal(state.static.hash, state.mounted.hash, name + " mounted hierarchy matches static after arbitrary seeks");
        const ancestorHidden = hidden === "outer" || hidden === "inner";
        const opacity = 0.15 * (1 - time / 1000);
        for (const attributes of state.attributes) for (const id of ["box", "label", "edge"]) {
          const absent = ancestorHidden || hidden === id;
          if (absent) assert.equal(attributes[id], null, name + " hidden ancestors suppress " + id);
          else assert.ok(Math.abs(attributes[id] - opacity) < .000001, name + " ancestor opacity propagates to " + id);
        }
        for (const renderer of ["static", "mounted", "sketch"]) {
          const expected = ancestorHidden || hidden === "box" ? 255 : Math.round(255 * (1 - opacity));
          const pixel = state[renderer].center;
          assert.equal(pixel[0], 255);
          for (const channel of [pixel[1], pixel[2]]) assert.ok(Math.abs(channel - expected) <= 1, name + " " + renderer + " independent opacity pixel oracle");
        }
        profile.hierarchyCases++;
      }
      await page.locator("#host").screenshot({ path: `artifacts/rendering-quality/${name}-hierarchy.png` });
      await page.evaluate(() => QUALITY.destroy());
      assert.equal(await page.locator("#host *").count(), 0);
      assert.deepEqual(errors, []);
      profile.ok = true; console.log(JSON.stringify(profile));
    } catch (error) {
      await page.screenshot({ path: `artifacts/rendering-quality/${name}-failure.png` }).catch(() => {});
      throw error;
    } finally { await browser.close(); }
  }
  assert.ok(report.profiles.length > 0, "Select at least one installed browser engine");
  report.ok = true;
} finally {
  await new Promise(done => server.close(done));
  await writeFile("artifacts/rendering-quality/browser.json", JSON.stringify(report, null, 2) + "\n");
}
assert.ok(report.ok);
