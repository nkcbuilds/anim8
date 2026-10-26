import assert from "node:assert/strict";
import { parseModelSpec,queryModel } from "./providers.mjs";
assert.deepEqual(parseModelSpec("openai:gpt-4.1-mini"),{provider:"openai",model:"gpt-4.1-mini"});
assert.throws(()=>parseModelSpec("bogus:model"));
assert.throws(()=>parseModelSpec("openai:../../evil"));
const request={systemPrompt:"System",prompt:"Draw a card",attempt:1,caseId:"test"};
for(const [provider,body,expected] of [
 ["openai",{choices:[{message:{content:"{\"ok\":true}"}}],usage:{prompt_tokens:9,completion_tokens:5}},9],
 ["anthropic",{content:[{type:"text",text:"{\"ok\":true}"}],usage:{input_tokens:9,output_tokens:5}},9],
 ["gemini",{candidates:[{content:{parts:[{text:"{\"ok\":true}"}]}}],usageMetadata:{promptTokenCount:9,candidatesTokenCount:5}},9]
]){
 const result=await queryModel({provider,model:"test-model"},request,{env:{OPENAI_API_KEY:"local-only",ANTHROPIC_API_KEY:"local-only",GEMINI_API_KEY:"local-only"},endpoint:"http://127.0.0.1/mock",fetchImpl:async (url,opts)=>{assert.equal(opts.method,"POST");assert.ok(opts.signal);return new Response(JSON.stringify(body),{status:200});}});
 assert.equal(result.text,'{"ok":true}');assert.equal(result.usage.inputTokens,expected);
}
await assert.rejects(()=>queryModel("openai:gpt-4.1-mini",request,{env:{}}),/Missing provider API key/);
await assert.rejects(()=>queryModel("openai:gpt-4.1-mini",request,{env:{OPENAI_API_KEY:"x"},fetchImpl:async()=>new Response("secret error",{status:401})}),/HTTP 401/);
console.log("PASS: offline transport contracts for OpenAI, Anthropic and Gemini");
