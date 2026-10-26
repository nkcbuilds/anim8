import { describe,it,expect } from "vitest";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileJson } from "@anim8/compiler";
import { svgFrames, writeSvgFrames, exportVideo } from "../src/index.js";

const doc = {
 version:"1.0",scene:{width:640,height:360,theme:"clean"},
 objects:[{id:"block",type:"rect",width:90,height:48,text:"Hello",transform:{x:80,y:180,rotation:0,scaleX:1,scaleY:1,opacity:1},style:{fill:"#fff",stroke:"#111827",strokeWidth:2},visible:true,z:0}],
 timeline:[{id:"move",type:"move",target:"block",start:0,duration:100,easing:"linear",to:{x:160,y:180}}]
};
function scene(){
 const res=compileJson(JSON.stringify(doc));
 if(!res.ok||!res.scene)throw new Error(JSON.stringify(res.diagnostics));
 return res.scene;
}
describe("deterministic export",()=>{
 it("creates reproducible endpoints and does not depend on evaluation order",()=>{
  const a=[...svgFrames(scene(),{fps:20,durationMs:100})];
  const b=[...svgFrames(scene(),{fps:20,durationMs:100})];
  expect(a).toEqual(b);expect(a.map(f=>f.timeMs)).toEqual([0,50,100]);
  expect(a[0]!.svg).not.toEqual(a[2]!.svg);
 });
 it("rejects excessive frames or dimensions before writing files",()=>{
  expect(()=>[...svgFrames(scene(),{fps:60,durationMs:30_000})]).toThrow(/frame count/);
  expect(()=>[...svgFrames(scene(),{fps:0})]).toThrow(/fps/);
  expect(()=>[...svgFrames(scene(),{durationMs:31_000})]).toThrow(/durationMs/);
 });
 it("writes frame sequence without clobber and has correct index ordering",async()=>{
  const folder=await mkdtemp(join(tmpdir(),"anim8-test-"));
  try{
   expect(await writeSvgFrames(scene(),folder,{fps:20,durationMs:100})).toBe(3);
   expect(await readdir(folder)).toEqual(["frame-000000.svg","frame-000001.svg","frame-000002.svg"]);
   expect((await readFile(join(folder,"frame-000000.svg"),"utf8")).startsWith("<svg")).toBe(true);
   await expect(writeSvgFrames(scene(),folder,{fps:20,durationMs:100})).rejects.toThrow();
  }finally{await rm(folder,{recursive:true,force:true});}
 });
 it("rejects invalid output format without running ffmpeg",async()=>{
  await expect(exportVideo(scene(),"test.avi")).rejects.toThrow(/Only .gif and .mp4/);
 });
 it("does not leave a partial video or temporary frames on ffmpeg launch failure",async()=>{
  const folder=await mkdtemp(join(tmpdir(),"anim8-test-video-"));
  const rasterize=async()=>new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iDYcAAAAASUVORK5CYII=","base64"));
  try{
   await expect(exportVideo(scene(),join(folder,"render.mp4"),{fps:10,durationMs:0,rasterize,ffmpegPath:join(folder,"no-ffmpeg-executable")})).rejects.toThrow(/FFmpeg could not start/);
   expect(await readdir(folder)).toEqual([]);
  }finally{await rm(folder,{recursive:true,force:true});}
 });
});
