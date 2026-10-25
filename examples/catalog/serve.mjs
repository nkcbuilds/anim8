/** Browse and export all Anim8 teaching scenes in a zero-dependency local gallery. */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileJson } from "../../packages/compiler/dist/index.js";
import { evaluate } from "../../packages/core/dist/index.js";
import { renderSvg } from "../../packages/renderer-svg/dist/index.js";

const here=dirname(fileURLToPath(import.meta.url));
const manifest=JSON.parse(readFileSync(join(here,"index.json"),"utf8"));
const records=new Map(manifest.examples.map(entry=>[entry.id,entry]));
const compiledCache=new Map();
const sourceCache=new Map();
function readScene(id){
  const entry=records.get(id);
  if(!entry) return null;
  if(compiledCache.has(id)) return compiledCache.get(id);
  const text=readFileSync(join(here,entry.file),"utf8");
  const result=compileJson(text);
  if(!result.ok) throw new Error(`Invalid checked-in catalog scene ${id}: ${JSON.stringify(result.diagnostics)}`);
  compiledCache.set(id,result.scene);
  sourceCache.set(id,text);
  return result.scene;
}
function respond(res,status,kind,content,headers={}){
  res.writeHead(status,{"Content-Type":kind,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff",...headers});
  res.end(content);
}
const server=createServer((req,res)=>{
  try{
    const u=new URL(req.url??"/","http://127.0.0.1");
    if(req.method!=="GET"){
      respond(res,405,"text/plain; charset=utf-8","Method not allowed");
      return;
    }
    if(u.pathname==="/"||u.pathname==="/index.html"){
      respond(res,200,"text/html; charset=utf-8",readFileSync(join(here,"viewer.html"),"utf8"));
      return;
    }
    if(u.pathname==="/api/catalog"){
      respond(res,200,"application/json; charset=utf-8",JSON.stringify(manifest));
      return;
    }
    if(u.pathname==="/api/render"||u.pathname==="/api/source"){
      const id=u.searchParams.get("id")??"";
      const scene=readScene(id);
      if(!scene){respond(res,404,"text/plain; charset=utf-8","Unknown example");return;}
      if(u.pathname==="/api/source"){
        respond(res,200,"application/json; charset=utf-8",sourceCache.get(id),
          {"Content-Disposition":`attachment; filename="${id}.json"`});
        return;
      }
      const t=Number(u.searchParams.get("t")??0);
      if(!Number.isFinite(t)||t<0||t>3200){
        respond(res,400,"text/plain; charset=utf-8","Invalid time (0-3200 ms)");
        return;
      }
      respond(res,200,"image/svg+xml; charset=utf-8",renderSvg(evaluate(scene,t)));
      return;
    }
    respond(res,404,"text/plain; charset=utf-8","Not found");
  }catch(error){
    console.error(error);
    respond(res,500,"text/plain; charset=utf-8","Internal gallery error");
  }
});
const port=Number(process.env.PORT??4178);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error("PORT must be 1-65535");
server.listen(port,"127.0.0.1",()=>{
  console.log(`Anim8 teaching gallery: http://127.0.0.1:${port} (${manifest.count} examples)`);
});
