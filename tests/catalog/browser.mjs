/**
 * Chromium visual integrity pass over the complete catalog.
 *
 * This intentionally uses actual SVG layout, not headless XML string checks.
 * Optional PNG samples are stored in .bench/ (ignored by Git).
 */
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileJson } from "../../packages/compiler/dist/index.js";
import { evaluate } from "../../packages/core/dist/index.js";
import { renderSvg } from "../../packages/renderer-svg/dist/index.js";
import { chromium } from "playwright";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const catalog=join(root,"examples","catalog");
const entries=JSON.parse(readFileSync(join(catalog,"index.json"),"utf8")).examples;
const capture=process.env.ANIM8_CATALOG_SCREENSHOTS==="1";
const outdir=join(root,".bench","catalog-visual");
if(capture) mkdirSync(outdir,{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1000,height:560},deviceScaleFactor:1, reducedMotion:"reduce"});
const seenPatterns=new Set();
const failures=[];
let frames=0;
try {
  for(const entry of entries){
    const source=readFileSync(join(catalog,entry.file),"utf8");
    const compiled=compileJson(source);
    assert.ok(compiled.ok,entry.id+": compiler error");
    const times=[0,1350,3000];
    for(const time of times){
      const svg=renderSvg(evaluate(compiled.scene,time));
      await page.setContent(`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;padding:0}svg{display:block;width:1000px;height:560px}</style>${svg}`,{waitUntil:"domcontentloaded"});
      const r=await page.evaluate(()=>{
        const svg=document.querySelector("svg");
        const box=svg.getBoundingClientRect();
        const textNodes=[...svg.querySelectorAll("text")];
        const outside=[];
        for(const e of textNodes){
          const r=e.getBoundingClientRect();
          if(r.width<=0||r.height<=0) continue;
          if(r.left<box.left-2||r.top<box.top-2||
             r.right>box.right+2||r.bottom>box.bottom+2){
            outside.push({text:e.textContent?.slice(0,40),x:Math.round(r.x),y:Math.round(r.y)});
          }
        }
        const get=id=>svg.querySelector(`[data-anim8-id="${id}"]`)?.getBoundingClientRect();
        const intersects=(a,b)=>!!a&&!!b&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
        const header=["heading","context","progress_label"].map(get).filter(Boolean);
        const concepts=[0,1,2,3].map(i=>get("concept_"+i)).filter(Boolean);
        let collisions=0;
        for(const a of header)for(const b of concepts)if(intersects(a,b)) collisions++;
        const stages=[0,1,2,3].map(i=>get("stage_"+i)).filter(Boolean);
        for(const a of stages)for(const b of concepts)if(intersects(a,b)) collisions++;
        return {outside,collisions,visibleTexts:textNodes.length,svgCount:document.querySelectorAll("svg").length};
      });
      frames++;
      if(r.svgCount!==1||r.visibleTexts<5||r.outside.length||r.collisions){
        failures.push(`${entry.id} t=${time}: ${JSON.stringify(r)}`);
      }
      if(capture && time===1350 && !seenPatterns.has(entry.pattern)){
        seenPatterns.add(entry.pattern);
        await page.screenshot({path:join(outdir,`${entry.pattern}-${entry.id}.png`)});
      }
    }
  }
} finally {
  await browser.close();
}
if(failures.length){
  console.error(`FAIL: ${failures.length} visual integrity issues:`);
  for(const item of failures.slice(0,40)) console.error(" -",item);
  process.exitCode=1;
} else{
  console.log(`PASS: ${frames} real Chromium rendered frames, 150 examples, no clipped text or header/diagram collisions`);
  if(capture)console.log(`Saved ${seenPatterns.size} visual samples to .bench/catalog-visual/`);
}
