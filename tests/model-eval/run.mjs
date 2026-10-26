#!/usr/bin/env node
/** Opt-in, paid real-provider benchmark. Never writes generated raw answers or keys. */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BENCHMARK_CASES, AGENT_SYSTEM_PROMPT, runBenchmarkCase, summarizeBenchmark } from "../../packages/ai/dist/index.js";
import { compileJson } from "../../packages/compiler/dist/index.js";
import { evaluate } from "../../packages/core/dist/index.js";
import { renderSvg } from "../../packages/renderer-svg/dist/index.js";
import { parseModelSpec, queryModel } from "./providers.mjs";
const usage = "Usage: node tests/model-eval/run.mjs --models openai:gpt-4.1-mini,anthropic:claude-sonnet-4-5,gemini:gemini-2.5-flash --cases 36 --attempts 2 [--out report.json]\nPaid provider credentials are required. Models run sequentially; no network requests without explicit --models.";
const options={cases:36,attempts:2,models:"",out:""};
for(let i=2;i<process.argv.length;i++){
  const name=process.argv[i], value=process.argv[++i];
  if(!name.startsWith("--")||!value) throw new Error(usage);
  const key=name.slice(2);
  if(!(key in options)) throw new Error(usage);
  options[key]=value;
}
if(!options.models){console.error(usage);process.exit(2);}
const models=options.models.split(",").map(s=>s.trim()).map(parseModelSpec);
if(models.length<1 || models.length>6) throw new Error("1-6 providers/models allowed per run");
const count=Number(options.cases), attempts=Number(options.attempts);
if(!Number.isInteger(count)||count<1||count>BENCHMARK_CASES.length||!Number.isInteger(attempts)||attempts<1||attempts>3) throw new Error("Invalid --cases or --attempts");
const sample={version:"1.0",scene:{width:640,height:360,theme:"clean"},objects:[{id:"card",type:"rect",width:120,height:60,text:"Sample",transform:{x:120,y:180,rotation:0,scaleX:1,scaleY:1,opacity:1},style:{fill:"#ffffff",stroke:"#111827",strokeWidth:2},visible:true,z:1}],timeline:[{id:"motion",type:"move",target:"card",start:0,duration:800,easing:"easeInOut",to:{x:480,y:180}}]};
const systemPrompt=AGENT_SYSTEM_PROMPT+"\nUse exact field shapes from this minimal valid example, adjusting to the task. JSON: "+JSON.stringify(sample)+".\nReturn complete valid JSON without Markdown.";
const validate=value=>{
  const result=compileJson(JSON.stringify(value));
  if(!result.ok) return {ok:false, diagnostics:result.diagnostics};
  try{
    for(const t of [0,250,750]){
      const svg=renderSvg(evaluate(result.scene,t));
      if(!svg.startsWith("<svg")||svg.length>3_000_000) throw new Error("Render invalid or oversized");
    }
    return {ok:true,value:result.scene,diagnostics:[]};
  }catch(e){return {ok:false,diagnostics:[{code:"RENDER_FAILURE",path:"$",message:String(e.message).slice(0,180)}]};}
};
const report={version:1,fixtureCount:count,attempts,startedAt:new Date().toISOString(),results:[]};
for(const spec of models){
  const name=spec.provider+":"+spec.model;
  console.log("Evaluating",name);
  const cases=[];
  for(const testCase of BENCHMARK_CASES.slice(0,count)){
    try{
      const r=await runBenchmarkCase(testCase,request=>queryModel(spec,request),validate,{maxAttempts:attempts,systemPrompt});
      cases.push({id:testCase.id,success:r.success,firstPass:r.attempts[0].score.schemaValid,attempts:r.attempts.length,diagnostics:r.finalAttempt.diagnostics.map(d=>d.code),usage:r.attempts.map(a=>a.metrics.providerUsage??null)});
      console.log(" ",testCase.id,r.success?"PASS":"FAIL");
    }catch(error){
      console.error(" ",testCase.id,"provider error:",error.message);
      cases.push({id:testCase.id,success:false,providerError:String(error.message).slice(0,180)});
    }
  }
  const passes=cases.filter(c=>c.success).length, firstPass=cases.filter(c=>c.firstPass).length;
  report.results.push({model:name,passed:passes,firstPass,failed:count-passes,passRate:passes/count,firstPassRate:firstPass/count,cases});
}
report.finishedAt=new Date().toISOString();
console.log(JSON.stringify({models:report.results.map(({model,passed,firstPass,failed})=>({model,passed,firstPass,failed})),cases:count},null,2));
if(options.out){await writeFile(resolve(options.out),JSON.stringify(report,null,2)+"\n",{flag:"wx"});console.log("Saved redacted report",options.out);}
if(report.results.some(r=>r.failed>0))process.exitCode=1;
