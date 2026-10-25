/**
 * Anim8 teaching catalog: deterministic generator for 150 curated explainers.
 *
 * Each data record includes a title, a meaningful diagram topology, four
 * subject-specific labeled entities, and four factual teaching steps. The
 * generator turns these into serializable, independently usable v1 scenes.
 * No random values, timestamps, remote assets, or platform-specific output.
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = here;
const checkMode = process.argv.includes("--check");
const categories = ["computing", "science", "workflows"];
const stepDuration = 900;
const bg = "#f8fafc";
const ink = "#0f172a";
const muted = "#475569";
const accent = ["#bfdbfe", "#a7f3d0", "#fde68a", "#fecdd3"];
const edgeColor = "#64748b";

const positions = {
  pipeline: [[170,275],[390,275],[610,275],[830,275]],
  queue: [[170,275],[390,275],[610,275],[830,275]],
  sequence: [[170,205],[390,255],[610,305],[830,355]],
  timeline: [[170,260],[390,260],[610,260],[830,260]],
  ladder: [[250,375],[415,310],[580,245],[745,180]],
  cycle: [[295,185],[705,185],[705,365],[295,365]],
  tree: [[500,182],[280,303],[720,303],[500,389]],
  branch: [[500,165],[500,260],[265,365],[735,365]],
  decision: [[500,165],[500,260],[265,365],[735,365]],
  hub: [[500,275],[270,190],[730,190],[500,385]],
  network: [[270,190],[730,190],[270,360],[730,360]],
  grid: [[270,190],[730,190],[270,360],[730,360]],
  compare: [[290,200],[710,200],[290,355],[710,355]],
  stack: [[500,160],[500,237],[500,314],[500,391]],
  layers: [[500,160],[500,237],[500,314],[500,391]],
  chart: [[185,275],[395,275],[605,275],[815,275]],
  funnel: [[205,185],[405,245],[605,305],[805,365]],
  equation: [[175,275],[390,275],[610,275],[825,275]],
  triangle: [[275,345],[730,345],[500,165],[500,285]],
  orbit: [[500,245],[285,190],[715,190],[500,369]],
  balance: [[290,205],[500,355],[710,205],[500,145]],
};
const edgeMaps = {
  cycle: [[0,1],[1,2],[2,3],[3,0]],
  tree: [[0,1],[0,2],[1,3],[2,3]],
  branch: [[0,1],[1,2],[1,3]],
  decision: [[0,1],[1,2],[1,3]],
  hub: [[1,0],[2,0],[0,3]],
  orbit: [[1,0],[2,0],[0,3]],
  network: [[0,1],[0,2],[1,3],[2,3]],
  grid: [[0,1],[0,2],[1,3],[2,3]],
  compare: [[0,2],[1,3]],
  triangle: [[0,1],[1,2],[2,0],[2,3]],
  balance: [[0,1],[2,1],[3,1]],
  equation: [],
  chart: [],
};
const transform = (x,y) => ({x,y,rotation:0,scaleX:1,scaleY:1,opacity:1});
const style = (fill, stroke, fontSize=16, color=ink) => ({
  fill, stroke, strokeWidth:2, color, fontSize, radius:12
});
function text(id, content, x, y, fontSize=16, color=ink, options={}) {
  return {id,type:"text",text:content,description:options.description,
    transform:transform(x,y),
    style:style("none","none",fontSize,color),visible: options.visible ?? true,z:10};
}
function node(id, label, x, y, pattern, index) {
  const base={id,transform:transform(x,y),
    style:style("#ffffff", "#334155", label.length>16?12:14),
    visible:true,z:3,description:label};
  if (pattern === "chart") {
    const h=[94,140,186,128][index];
    return { ...base,type:"rect",width:132,height:h,transform:transform(x,370-h/2)};
  }
  if (pattern === "orbit" && index>0) {
    return { ...base,type:"circle",radius:73,text:label };
  }
  if ((pattern === "cycle" || pattern === "tree" || pattern==="hub") && index===0) {
    return {...base,type:"circle",radius:78,text:label};
  }
  return {...base,type:"rect",width:174,height:62,text:label};
}
function readCategory(category) {
  const lines=readFileSync(join(here,"data",category+".txt"),"utf8")
    .split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  return lines.map((line,lineIndex) => {
    const parts=line.split("|");
    if(parts.length!==5) throw new Error(`${category} line ${lineIndex+1}: expected five pipe-delimited fields`);
    const [slug,title,pattern,entityText,stepText]=parts;
    const entities=entityText.split(";").map(s=>s.trim());
    const steps=stepText.split(";").map(s=>s.trim());
    if(!/^[a-z0-9-]+$/.test(slug)||!positions[pattern]||
      entities.length!==4||steps.length!==4||
      [...entities,...steps].some(s=>s.length<3)) {
      throw new Error(`${category} line ${lineIndex+1}: invalid slug, pattern, four entity names or four teaching steps`);
    }
    return {category,slug,title,pattern,entities,steps};
  });
}
function makeScene(topic, seed) {
  const {title,pattern,entities,steps,category,slug}=topic;
  const coords=positions[pattern];
  const objects=[
    text("heading",title,500,43,title.length>49?23:27),
    text("context",`${category.toUpperCase()}  /  ${pattern.toUpperCase()} EXPLANATION`,500,79,13,muted),
  ];
  for(let i=0;i<4;i++){
    const [x,y]=coords[i];
    const item=node("concept_"+i,entities[i],x,y,pattern,i);
    objects.push(item);
    if(pattern==="chart") objects.push(text("bar_label_"+i,entities[i],x,394,12));
    objects.push(text("stage_"+i,`STEP ${i+1}/4   ${steps[i]}`,500,467,16,ink,{visible:false,description:steps[i]}));
  }
  const edges=edgeMaps[pattern]??[[0,1],[1,2],[2,3]];
  for(const [k,[from,to]] of edges.entries()){
    objects.push({
      id:"link_"+k,type:"connector",
      from:{objectId:"concept_"+from,anchor:"center"},
      to:{objectId:"concept_"+to,anchor:"center"},
      kind:pattern==="cycle"||pattern==="network"?"curve":"straight",
      transform:transform(0,0),
      style:{fill:"none",stroke:edgeColor,strokeWidth:2,color:muted},
      visible:true,z:0,
    });
  }
  objects.push(text("footer","Seek to any time  •  Every frame is deterministic",500,526,12,muted));
  objects.push({id:"timeline_rule",type:"path",d:"M 0 0 L 710 0",drawProgress:0,
    transform:transform(145,496),
    style:{fill:"none",stroke:"#94a3b8",strokeWidth:4},visible:true,z:1,
    description:"Drawn progress through the four explanation stages"});
  // A small focus dot follows the teaching sequence, independent of each
  // concept's own property animation. It never writes the same property twice
  // at overlapping timestamps.
  if(pattern!=="chart"&&pattern!=="equation"){
    objects.push({id:"focus_dot",type:"circle",radius:9,transform:transform(coords[0][0],coords[0][1]-57),
      style:{fill:"#2563eb",stroke:"#eff6ff",strokeWidth:2},visible:true,z:9,
      description:"Current focus in the explanatory sequence"});
  }
  if(pattern==="equation") {
    for(let i=0;i<3;i++) objects.push(text("operator_"+i, i===2?"=":"→",(coords[i][0]+coords[i+1][0])/2,276,26,muted));
  }
  const timeline=[{id:"advance_progress",type:"draw",target:"timeline_rule",
    start:0,duration:3200,easing:"linear",to:1}];
  const markers=[];
  for(let i=0;i<4;i++){
    const start=i*stepDuration;
    markers.push({id:"marker_"+i,label:`Step ${i+1}: ${entities[i]}`,time:start});
    timeline.push({id:"highlight_"+i,type:"fill",target:"concept_"+i,start,duration:380,
      easing:"easeInOut",to:accent[i]});
    timeline.push({id:"expand_"+i,type:"scale",target:"concept_"+i,start:start+400,duration:230,
      easing:"easeOut",to:{x:1.07,y:1.07}});
    timeline.push({id:"border_"+i,type:"stroke",target:"concept_"+i,start:start+160,
      duration:330,easing:"easeInOut",to:"#2563eb"});
    if(pattern==="chart") timeline.push({id:"bar_growth_"+i,type:"resize",target:"concept_"+i,
      start:start+210,duration:290,easing:"easeOut",
      to:{width:132,height:[94,140,186,128][i]+28}});
    timeline.push({id:"show_stage_"+i,type:"visibility",target:"stage_"+i,start,duration:0,visible:true});
    if(i>0) {
      timeline.push({id:"hide_stage_"+(i-1),type:"visibility",target:"stage_"+(i-1),start,duration:0,visible:false});
      if(pattern!=="chart"&&pattern!=="equation"){
        const pathFocus=["cycle","network","triangle","orbit","hub"].includes(pattern);
        const from=coords[i-1], to=coords[i];
        if(pathFocus) timeline.push({id:"focus_follow_"+i,type:"followPath",target:"focus_dot",
          start:start+40,duration:360,easing:"easeInOut",points:[
            {x:from[0],y:from[1]-57},
            {x:(from[0]+to[0])/2,y:(from[1]+to[1])/2-88},
            {x:to[0],y:to[1]-57}
          ]});
        else timeline.push({id:"focus_move_"+i,type:"move",target:"focus_dot",
          start:start+40,duration:360,easing:"easeInOut",
          to:{x:to[0],y:to[1]-57}});
      }
    }
  }
  // Topology is a deliberate choice per explanation, not randomized visual noise.
  return {version:"1.0",scene:{width:1000,height:560,theme:"clean",background:bg,seed},
    objects,timeline,markers};
}
const topics=categories.flatMap(readCategory);
if(topics.length<100||topics.length>200) throw new Error(`Expected 100-200 examples, found ${topics.length}`);
if(new Set(topics.map(t=>t.slug)).size!==topics.length) throw new Error("Duplicate slugs in catalog");
const manifest=[];
for(let index=0;index<topics.length;index++){
  const topic=topics[index];
  const rel=join(topic.category,topic.slug,"scene.json");
  const out=join(here,rel);
  const scene=makeScene(topic,index+1);
  const expected=JSON.stringify(scene,null,2)+"\n";
  if(checkMode){
    if(!existsSync(out)||readFileSync(out,"utf8")!==expected) throw new Error(`Out-of-date generated scene: ${rel}. Run pnpm catalog:generate`);
  } else {
    mkdirSync(dirname(out),{recursive:true});
    writeFileSync(out,expected,"utf8");
  }
  manifest.push({id:topic.slug,category:topic.category,title:topic.title,pattern:topic.pattern,
    description:topic.steps.join(" "),entities:topic.entities,steps:topic.steps,
    durationMs:2700,file:relative(root,out).split("\\").join("/")});
}
const manifestFile=join(here,"index.json");
const manifestExpected=JSON.stringify({version:1,count:manifest.length,examples:manifest},null,2)+"\n";
if(checkMode){
  if(!existsSync(manifestFile)||readFileSync(manifestFile,"utf8")!==manifestExpected) throw new Error("Out-of-date catalog manifest. Run pnpm catalog:generate");
} else writeFileSync(manifestFile,manifestExpected,"utf8");
console.log(`${checkMode?"Verified":"Generated"} ${topics.length} independently usable animated explainers (${categories.map(x=>x+":"+topics.filter(t=>t.category===x).length).join(", ")})`);
