import os from "node:os";
import { performance } from "node:perf_hooks";
import { evaluate, defaultStyle, defaultTransform } from "../packages/core/dist/index.js";
import { renderSvg } from "../packages/renderer-svg/dist/index.js";

function stats(samples) {
  const sorted = [...samples].sort((a,b)=>a-b);
  const pick = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return { p50Ms: pick(0.5), p95Ms: pick(0.95), maxMs: sorted.at(-1) };
}

function movingScene(count) {
  const objects = [];
  const timeline = [];
  for (let i=0;i<count;i++) {
    objects.push({
      id:`n${i}`, type:"rect", width:60, height:36, text:String(i),
      transform:{...defaultTransform(),x:40+(i%10)*70,y:40+Math.floor(i/10)*55},
      style:defaultStyle(),visible:true,z:i
    });
    timeline.push({id:`m${i}`,type:"move",target:`n${i}`,start:0,duration:2000,easing:"easeInOut",to:{x:60+(i%10)*70,y:50+Math.floor(i/10)*55}});
  }
  return {version:"1.0",scene:{width:800,height:500},objects,timeline};
}

function connectedScene(count) {
  const objects = [];
  for (let i=0;i<count;i++) {
    objects.push({
      id:`n${i}`, type:"rect", width:50, height:30,
      transform:{...defaultTransform(),x:40+(i%10)*70,y:40+Math.floor(i/10)*45},
      style:defaultStyle(),visible:true,z:1
    });
  }
  for (let i=0;i<count-1;i++) {
    objects.push({
      id:`e${i}`,type:"connector",from:{objectId:`n${i}`,anchor:"right"},to:{objectId:`n${i+1}`,anchor:"left"},kind:"straight",
      transform:defaultTransform(),style:{...defaultStyle(),fill:"none"},visible:true,z:0
    });
  }
  return {version:"1.0",scene:{width:800,height:500},objects,timeline:[]};
}

function bench(fn, iterations=200) {
  for (let i=0;i<30;i++) fn();
  const samples=[];
  for (let i=0;i<iterations;i++) {
    const t=performance.now(); fn(); samples.push(performance.now()-t);
  }
  return stats(samples);
}

const moving50 = movingScene(50);
const connected100 = connectedScene(100);
const connectedFrame = evaluate(connected100,0);

console.log(JSON.stringify({
  node:process.version,
  platform:`${process.platform} ${os.release()}`,
  cpu:os.cpus()[0]?.model,
  logicalCpus:os.cpus().length,
  moving50Evaluate:bench(()=>evaluate(moving50,1000)),
  connected100RenderSvg:bench(()=>renderSvg(connectedFrame),100),
  connected100SvgBytes:Buffer.byteLength(renderSvg(connectedFrame))
}, null, 2));
