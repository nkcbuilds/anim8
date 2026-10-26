const el=id=>document.getElementById(id);
const $=Object.fromEntries(["catalog","source","status","errors","preview","scrubber","play","restart","time-label","duration-label","dimensions","format","download-json","download-svg","open-file","file-input"].map(id=>[id,el(id)]));
let duration=3200,time=0,playing=false,lastTick=0,lastRender=0,renderSeq=0,debounce=0,latestSvg="";
function download(filename,contents,type){const url=URL.createObjectURL(new Blob([contents],{type}));const a=document.createElement("a");a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),500);}
function status(message,ok){$.status.textContent=message;$.status.className=ok?"good":"bad";}
async function render(){
 const seq=++renderSeq;
 const source=$.source.value;
 try{
  const res=await fetch("/api/render",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({source,timeMs:time})});
  const result=await res.json();
  if(seq!==renderSeq)return;
  if(!res.ok||result.error)throw Error(result.error??"Unexpected HTTP "+res.status);
  if(!result.ok){
   status(result.diagnostics.length+" issue(s)",false);
   $.errors.textContent=result.diagnostics.slice(0,8).map(d=>d.code+" · "+d.path+"\n"+d.message).join("\n\n");
   return;
  }
  status("Valid scene",true);$.errors.textContent="No validation errors.";
  latestSvg=result.svg;
  // SVG is emitted from the strict allowlisted Anim8 renderer; avoid HTML injection into controls.
  $.preview.innerHTML=result.svg;
  duration=result.durationMs;$.scrubber.max=String(Math.max(10,duration));time=Math.min(time,duration);
  $.scrubber.value=String(time);$["time-label"].textContent=(time/1000).toFixed(2)+"s";
  $["duration-label"].textContent=(duration/1000).toFixed(2)+"s";
  const svg=$.preview.querySelector("svg");
  $.dimensions.textContent=svg?.getAttribute("viewBox")??"Rendered SVG";
 }catch(e){if(seq===renderSeq){status("Render failed",false);$.errors.textContent=e.message;}}
}
function schedule(){clearTimeout(debounce);debounce=setTimeout(render,180);}
async function sample(id){playing=false;$.play.textContent="▶ Play";const res=await fetch("/api/example?id="+encodeURIComponent(id));const json=await res.json();$.source.value=json.source;time=0;await render();}
async function init(){
 const res=await fetch("/api/catalog"),catalog=await res.json();
 for(const item of catalog){const opt=document.createElement("option");opt.value=item.id;opt.textContent=item.category.toUpperCase()+" / "+item.title;$.catalog.append(opt);}
 await sample(catalog.find(x=>x.id==="binary-search")?.id??catalog[0].id);
}
$.catalog.addEventListener("change",()=>sample($.catalog.value));
$.source.addEventListener("input",schedule);
$.scrubber.addEventListener("input",()=>{time=Number($.scrubber.value);schedule();});
$.format.addEventListener("click",()=>{try{$.source.value=JSON.stringify(JSON.parse($.source.value),null,2);schedule();}catch(e){status("Invalid JSON",false);$.errors.textContent=e.message;}});
$["open-file"].addEventListener("click",()=>$["file-input"].click());
$["file-input"].addEventListener("change",async()=>{const file=$["file-input"].files?.[0];if(file){if(file.size>2_000_000){status("File exceeds 2 MB",false);return;}$.source.value=await file.text();time=0;schedule();}});
$["download-json"].addEventListener("click",()=>download("anim8-scene.json",$.source.value,"application/json"));
$["download-svg"].addEventListener("click",()=>{if(latestSvg)download("anim8-frame.svg",latestSvg,"image/svg+xml");});
$.restart.addEventListener("click",()=>{time=0;schedule();});
$.play.addEventListener("click",()=>{playing=!playing;$.play.textContent=playing?"❚❚ Pause":"▶ Play";lastTick=0;if(playing)requestAnimationFrame(tick);});
function tick(ts){if(!playing)return;if(lastTick)time+=Math.max(0,Math.min(100,ts-lastTick));lastTick=ts;if(time>duration)time=0;$.scrubber.value=String(time);$["time-label"].textContent=(time/1000).toFixed(2)+"s";if(ts-lastRender>=33){lastRender=ts;void render();}requestAnimationFrame(tick);}
document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();render();}});
init().catch(e=>{status("Could not start playground",false);$.errors.textContent=e.message;});
