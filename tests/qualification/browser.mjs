/** Real Chromium runtime qualification: mount/unmount, RAF timing, DOM and JS heap trend. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
const root=process.cwd(), sample=JSON.parse(readFileSync(resolve(root,"examples/catalog/computing/binary-search/scene.json"),"utf8"));
const compiled=await build({stdin:{contents:`import {mountPlayer} from "./packages/player/dist/index.js"; import {compileJson} from "./packages/compiler/dist/index.js"; const controllers=[]; window.BENCH={create(source,n){const result=compileJson(JSON.stringify(source)); if(!result.ok)throw Error(JSON.stringify(result.diagnostics)); for(let i=0;i<n;i++){let container=document.createElement("div");container.style.width="300px";container.style.height="168px";document.querySelector("#mount").append(container); const controller=mountPlayer(container,result.scene,{loop:true});controllers.push(controller)}},start(){controllers.forEach(p=>p.play())},stop(){controllers.forEach(p=>p.pause())},clear(){controllers.forEach(p=>p.destroy());controllers.length=0;document.querySelector("#mount").replaceChildren()},count(){return controllers.length}};`,resolveDir:root,sourcefile:"bench-entry.js"},bundle:true,platform:"browser",format:"iife",write:false});
const js=compiled.outputFiles[0].text;
const server=createServer((req,res)=>{
 if(req.url==="/bundle.js"){res.writeHead(200,{"Content-Type":"text/javascript"});res.end(js);return;}
 res.writeHead(200,{"Content-Type":"text/html"});res.end('<!doctype html><html><body style="margin:0"><main id="mount"></main><script src="/bundle.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
let browser;
try{
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:720}});
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 const port=server.address().port;
 await page.goto("http://127.0.0.1:"+port);
 assert.equal(await page.evaluate(()=>typeof window.BENCH),"object","Browser compiled player must exist");
 const cdp=await page.context().newCDPSession(page);
 await cdp.send("Performance.enable");
 const heap=async()=>{await cdp.send("HeapProfiler.collectGarbage");const r=await cdp.send("Performance.getMetrics");return r.metrics.find(m=>m.name==="JSHeapUsedSize")?.value??0;};
 const before=await heap();
 for(let i=0;i<30;i++){
   await page.evaluate(({sample,n})=>{BENCH.create(sample,n);BENCH.clear();},{sample,n:8});
 }
 const after=await heap();
 await page.evaluate(sample=>{BENCH.create(sample,12);BENCH.start();},sample);
 const timings=await page.evaluate(async()=>{
   const gaps=[];let previous=performance.now();const end=previous+2000;
   await new Promise(done=>{
     function step(t){gaps.push(t-previous);previous=t;if(t<end)requestAnimationFrame(step);else done();}
     requestAnimationFrame(step);
   });
   return gaps.slice(2);
 });
 await page.evaluate(()=>BENCH.stop());
 assert.ok(timings.length>50,"Not enough RAF samples");
 const sorted=[...timings].sort((a,b)=>a-b);
 const p95=sorted[Math.min(sorted.length-1,Math.floor(sorted.length*0.95))];
 const max=sorted.at(-1);
 const activeHeap=await heap();
 await page.evaluate(()=>BENCH.clear());
 assert.equal(await page.locator("#mount").locator("*").count(),0,"All mounted SVG nodes must be removed");
 assert.deepEqual(errors,[],"Browser runtime errors");
 assert.ok(after-before<30*1024*1024,"Mount/unmount leaked over 30 MiB JS heap");
 assert.ok(p95<100,"RAF p95 greater than 100ms; investigate browser performance");
 assert.ok(max<350,"A dropped/blocked frame exceeded 350ms");
 console.log(JSON.stringify({ok:true,instances:12,mountUnmountCycles:30,rafFrames:timings.length,rafP95Ms:+p95.toFixed(2),rafMaxMs:+max.toFixed(2),heapGrowthBytes:after-before,activeHeapBytes:activeHeap},null,2));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
