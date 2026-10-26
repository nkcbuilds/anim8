#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { compileJson } from "@anim8/compiler";
import { exportVideo, writeSvgFrames } from "./index.js";
const [source,output,...rest]=process.argv.slice(2);
async function main(){
  if(!source||!output)throw new Error("Usage: anim8-export <scene.json> <output.mp4|output.gif|svg-directory> [--fps 24] [--duration-ms 2000]");
  const options:{fps?:number,durationMs?:number}={};
  for(let i=0;i<rest.length;i+=2){
    if(rest[i]==="--fps")options.fps=Number(rest[i+1]);
    else if(rest[i]==="--duration-ms")options.durationMs=Number(rest[i+1]);
    else throw new Error("Unknown flag: "+rest[i]);
  }
  const compiled=compileJson(await readFile(source,"utf8"));
  if(!compiled.ok||!compiled.scene)throw new Error("Scene compilation failed: "+JSON.stringify(compiled.diagnostics));
  if(/\.(mp4|gif)$/i.test(output))console.log(JSON.stringify(await exportVideo(compiled.scene,output,options)));
  else console.log(JSON.stringify({frames:await writeSvgFrames(compiled.scene,output,options)}));
}
main().catch(e=>{console.error("anim8-export:",e.message);process.exitCode=1;});
