/** Deterministic, bounded Node-only exporters; video tools are explicit optional dependencies. */
import { spawn } from "node:child_process";
import { link, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { evaluate, sceneDuration, type SceneDocument } from "@anim8/core";
import { renderSvg } from "@anim8/renderer-svg";

export interface FrameOptions { fps?: number; durationMs?: number; maxFrames?: number }
export interface VideoOptions extends FrameOptions {
  /** Video output format inferred from destination extension if omitted. */
  format?: "mp4" | "gif";
  ffmpegPath?: string;
  /** Injected screenshot function for testing/custom rasterizers. Defaults to Playwright Chromium. */
  rasterize?: (svg: string, width: number, height: number) => Promise<Uint8Array>;
}
export const DEFAULT_FPS=24;
export const MAX_FRAMES=720;
export const MAX_PIXELS=1920*1080;
export const MAX_DURATION_MS=30_000;
function bounds(scene: SceneDocument, options: FrameOptions = {}) {
  const fps=options.fps??DEFAULT_FPS;
  if(!Number.isInteger(fps)||fps<1||fps>60)throw new RangeError("fps must be between 1 and 60");
  const durationMs=options.durationMs??sceneDuration(scene);
  if(!Number.isFinite(durationMs)||durationMs<0||durationMs>MAX_DURATION_MS)throw new RangeError("durationMs exceeds the 30-second export limit");
  const totalFrames=Math.max(1,Math.ceil(durationMs*fps/1000)+1);
  const maxFrames=options.maxFrames??MAX_FRAMES;
  if(!Number.isInteger(maxFrames)||maxFrames<1||maxFrames>MAX_FRAMES||totalFrames>maxFrames)throw new RangeError("export frame count exceeds configured bound");
  if(!Number.isInteger(scene.scene.width)||!Number.isInteger(scene.scene.height)||scene.scene.width<1||scene.scene.height<1||scene.scene.width*scene.scene.height>MAX_PIXELS)throw new RangeError("Export viewport exceeds 1920x1080 pixels");
  return {fps,durationMs,totalFrames,width:scene.scene.width,height:scene.scene.height};
}
/** Exact random-access frame evaluation; final frame includes the end timestamp. */
export function* svgFrames(scene:SceneDocument, options:FrameOptions={}):Generator<{index:number,timeMs:number,svg:string}> {
  const {fps,durationMs,totalFrames}=bounds(scene,options);
  for(let index=0;index<totalFrames;index++){
    const timeMs=Math.min(durationMs,index*1000/fps);
    yield {index,timeMs,svg:renderSvg(evaluate(scene,timeMs))};
  }
}
export async function writeSvgFrames(scene:SceneDocument, directory:string, options:FrameOptions={}) {
  const settings=bounds(scene,options);
  await mkdir(directory,{recursive:true});
  for(const frame of svgFrames(scene,options)){
    await writeFile(join(directory,`frame-${String(frame.index).padStart(6,"0")}.svg`),frame.svg,{flag:"wx"});
  }
  return settings.totalFrames;
}
async function makePlaywrightRasterizer(width:number,height:number){
  let chromium;
  try {
    ({chromium}=await import("playwright"));
  } catch {
    throw new Error("Video export requires optional 'playwright' package and installed Chromium. Install playwright then run playwright install chromium.");
  }
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1,reducedMotion:"reduce"});
    // Untrusted or external image hrefs must not perform network requests during rendering.
    await page.route("**/*",route=>route.abort());
    return {
      rasterize:async(svg:string)=>{
        // No external document scripts: static SVG output comes from typed Anim8 IR.
        await page.setContent(`<!doctype html><html><body style="margin:0;background:white">${svg}</body></html>`);
        return new Uint8Array(await page.locator("svg").screenshot({type:"png",animations:"disabled"}));
      },
      close:()=>browser.close(),
    };
  }catch(error){await browser.close();throw error;}
}
function encodeFfmpeg(executable:string, args:string[]):Promise<void> {
  return new Promise((yes,no)=>{
    const child=spawn(executable,args,{windowsHide:true,stdio:["ignore","ignore","pipe"]});
    let stderr="";
    child.stderr.on("data",(chunk:Buffer)=>{stderr=(stderr+chunk.toString()).slice(-8000);});
    child.on("error",error=>no(new Error("FFmpeg could not start: "+error.message)));
    child.on("close",code=>code===0?yes():no(new Error("FFmpeg exited "+code+": "+stderr.slice(-500))));
  });
}
export async function exportVideo(scene:SceneDocument,destination:string,options:VideoOptions={}) {
  const settings=bounds(scene,options);
  const output=resolve(destination);
  const format=options.format??extname(output).slice(1);
  if(format!=="gif"&&format!=="mp4")throw new Error("Only .gif and .mp4 export are supported");
  if(format==="mp4"&&(settings.width%2||settings.height%2))throw new RangeError("MP4 dimensions must be even for yuv420p");
  if(options.format && extname(output).toLowerCase()!==`.${format}`)throw new Error("Output extension must match chosen format");
  await mkdir(dirname(output),{recursive:true});
  // Stage both frame PNGs and the final video on the destination filesystem.
  // Only publish the output after FFmpeg exits cleanly, never overwrite an existing file.
  const temp=await mkdtemp(join(dirname(output),".anim8-export-"));
  let browser:Awaited<ReturnType<typeof makePlaywrightRasterizer>>|undefined;
  try{
    if(!options.rasterize)browser=await makePlaywrightRasterizer(settings.width,settings.height);
    const rasterize=options.rasterize??browser!.rasterize;
    for(const frame of svgFrames(scene,options)){
      const bytes=await rasterize(frame.svg,settings.width,settings.height);
      if(bytes.length<8||bytes.length>20_000_000)throw new Error("Rasterizer returned empty or oversized PNG");
      // Check PNG signature before allowing external encoder to consume content.
      if(![137,80,78,71,13,10,26,10].every((byte,i)=>bytes[i]===byte))throw new Error("Rasterizer must return PNG bytes");
      await writeFile(join(temp,`frame-${String(frame.index).padStart(6,"0")}.png`),bytes);
    }
    const stagedOutput=join(temp,"encoded."+format);
    const args=["-hide_banner","-loglevel","error","-nostdin","-n","-framerate",String(settings.fps),"-i",join(temp,"frame-%06d.png")];
    if(format==="mp4")args.push("-c:v","libx264","-pix_fmt","yuv420p","-movflags","+faststart");
    else args.push("-loop","0");
    args.push(stagedOutput);
    await encodeFfmpeg(options.ffmpegPath??"ffmpeg",args);
    // hard-link is an atomic create-only publish operation on the same filesystem;
    // an existing destination remains byte-for-byte unchanged (EEXIST).
    await link(stagedOutput,output);
    return {format,output,frames:settings.totalFrames,fps:settings.fps};
  }finally{
    try{await browser?.close();}finally{await rm(temp,{recursive:true,force:true});}
  }
}
