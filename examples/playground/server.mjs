/** Local-only Anim8 playground backed by the actual compiled engine. */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileJson } from "../../packages/compiler/dist/index.js";
import { evaluate, sceneDuration } from "../../packages/core/dist/index.js";
import { renderSvg } from "../../packages/renderer-svg/dist/index.js";
const here=dirname(fileURLToPath(import.meta.url)), catalog=resolve(here,"../catalog");
const manifest=JSON.parse(readFileSync(join(catalog,"index.json"),"utf8"));
const entries=new Map(manifest.examples.map(e=>[e.id,e]));
const port=Number(process.env.PORT??4179);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error("PORT must be 1-65535");
const origin="http://127.0.0.1:"+port;
function response(res,status,body,kind="application/json; charset=utf-8"){
 res.writeHead(status,{"Content-Type":kind,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Cross-Origin-Resource-Policy":"same-origin","Access-Control-Allow-Origin":"null"});
 res.end(kind.startsWith("application/json")?JSON.stringify(body):body);
}
const server=createServer(async(req,res)=>{
 try{
  if(req.headers.host!=="127.0.0.1:"+port) {response(res,403,{error:"Host not permitted"});return;}
  const url=new URL(req.url??"/",origin);
  if(req.method==="GET"){
   if(url.pathname==="/"){response(res,200,readFileSync(join(here,"index.html"),"utf8"),"text/html; charset=utf-8");return;}
   if(url.pathname==="/app.js"){response(res,200,readFileSync(join(here,"app.js"),"utf8"),"text/javascript; charset=utf-8");return;}
   if(url.pathname==="/style.css"){response(res,200,readFileSync(join(here,"style.css"),"utf8"),"text/css; charset=utf-8");return;}
   if(url.pathname==="/api/catalog"){response(res,200,manifest.examples.map(({id,title,category})=>({id,title,category})));return;}
   if(url.pathname==="/api/example"){
     const entry=entries.get(url.searchParams.get("id")??"");
     if(!entry){response(res,404,{error:"Unknown scene"});return;}
     response(res,200,{source:readFileSync(join(catalog,entry.file),"utf8")});return;
   }
   response(res,404,{error:"Not found"});return;
  }
  if(req.method==="POST"&&url.pathname==="/api/render"){
   if(req.headers.origin!==origin){response(res,403,{error:"Cross-origin request denied"});return;}
   if(!/application\/json/.test(req.headers["content-type"]??"")){response(res,415,{error:"Expected JSON"});return;}
   let bytes=0,raw="";
   for await(const part of req){
     bytes+=part.length;
     if(bytes>2*1024*1024+4096){response(res,413,{error:"Scene too large"});req.destroy();return;}
     raw+=part.toString();
   }
   const request=JSON.parse(raw);
   if(typeof request.source!=="string"){response(res,400,{error:"Scene source must be text"});return;}
   const time=Number(request.timeMs);
   if(!Number.isFinite(time)||time<0||time>3600000){response(res,400,{error:"timeMs out of bounds"});return;}
   const compiled=compileJson(request.source);
   if(!compiled.ok){response(res,200,{ok:false,diagnostics:compiled.diagnostics});return;}
   const svg=renderSvg(evaluate(compiled.scene,time));
   response(res,200,{ok:true,svg,durationMs:sceneDuration(compiled.scene),diagnostics:compiled.diagnostics});return;
  }
  response(res,405,{error:"Method not allowed"});
 }catch(error){response(res,400,{error:String(error?.message??error).slice(0,240)});}
});
server.listen(port,"127.0.0.1",()=>console.log("Anim8 playground "+origin));
