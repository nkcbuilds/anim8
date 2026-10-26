/** Hostile-scene validation plus seeded mutation; no live network access. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileJson, COMPILER_LIMITS } from "../../packages/compiler/dist/index.js";
import { evaluate } from "../../packages/core/dist/index.js";
import { renderSvg } from "../../packages/renderer-svg/dist/index.js";
const source=readFileSync(resolve("examples/catalog/computing/binary-search/scene.json"),"utf8");
const base=JSON.parse(source);
let rejected=0,positive=0;
const clone=()=>structuredClone(base);
function invalid(name,modify){
 const scene=clone();modify(scene);
 const result=compileJson(JSON.stringify(scene));
 assert.equal(result.ok,false,name+" must be rejected");
 assert.ok(result.diagnostics.length>0,name+" must report diagnostics");
 rejected++;
}
invalid("NaN object coordinate",s=>s.objects[0].transform.x=1e99);
invalid("duplicate ids",s=>s.objects[1].id=s.objects[0].id);
invalid("object count",s=>s.objects=Array.from({length:COMPILER_LIMITS.objects+1},(_,i)=>({...s.objects[0],id:"x"+i})));
invalid("unknown action",s=>s.timeline.push({id:"script",type:"eval",target:"heading",start:1,duration:2}));
invalid("illegal time",s=>s.timeline[0].duration=-5);
invalid("unsafe javascript image",s=>s.objects.push({id:"evil",type:"image",href:"javascript:alert(1)",width:10,height:10,transform:s.objects[0].transform,style:{},visible:true,z:1}));
invalid("unsafe data image",s=>s.objects.push({id:"evil",type:"image",href:"data:image/svg+xml,<svg/>",width:10,height:10,transform:s.objects[0].transform,style:{},visible:true,z:1}));
invalid("unknown object reference",s=>s.timeline[0].target="nonexistent");
invalid("source bytes",s=>s.objects[0].text="X".repeat(COMPILER_LIMITS.sourceBytes+1));
invalid("infinite dimensions",s=>s.scene.width=1e50);
let seed=721;
function rnd(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
for(let i=0;i<500;i++){
 const scene=clone(), idx=Math.floor(rnd()*scene.objects.length),o=scene.objects[idx];
 switch(i%6){
 case 0:o.transform.x=(rnd()-.5)*10000000;break;
 case 1:o.id="duplicated?"+i;break;
 case 2:scene.timeline[0].target="__absent_"+i;break;
 case 3:scene.scene.width=Math.floor(rnd()*10000000);break;
 case 4:o.style.fill='</style><script>alert(1)</script>';break;
 case 5:o.text='<script>alert(1)</script>&"';break;
 }
 const a=compileJson(JSON.stringify(scene)), b=compileJson(JSON.stringify(scene));
 assert.deepEqual(a.diagnostics,b.diagnostics,"mutations must yield deterministic diagnostics");
 if(a.ok){
   const svg=renderSvg(evaluate(a.scene,0));
   assert.ok(!svg.includes("<script>"),"Hostile text cannot inject SVG scripts");
   assert.ok(!svg.includes("</style>"),"Hostile style cannot inject markup");
   positive++;
 }else rejected++;
}
const valid=compileJson(source);assert.equal(valid.ok,true);
for(const t of [0,350,1350,2700,3200]){
 const a=renderSvg(evaluate(valid.scene,t)),b=renderSvg(evaluate(valid.scene,t));
 assert.equal(a,b,"Seek and rerender must remain byte-stable");
}
console.log("PASS: "+rejected+" invalid/rejected samples, "+positive+" sanitized/valid mutations, 5 deterministic seeks");
