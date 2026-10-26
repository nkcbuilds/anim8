/** Minimal, explicit real-provider transports. No shell, SDK, credential logs or arbitrary endpoints. */
const PROVIDERS = {
  openai: { key: "OPENAI_API_KEY", url: "https://api.openai.com/v1/chat/completions" },
  anthropic: { key: "ANTHROPIC_API_KEY", url: "https://api.anthropic.com/v1/messages" },
  gemini: { key: "GEMINI_API_KEY", url: "https://generativelanguage.googleapis.com/v1beta/models" },
};
export function parseModelSpec(spec) {
  const separator=spec.indexOf(":");
  if (separator<1) throw new Error("Model must be provider:model");
  const provider=spec.slice(0,separator), model=spec.slice(separator+1);
  if (!PROVIDERS[provider] || !/^[\w.\-]+$/.test(model) || model.length>100) throw new Error("Unsupported provider or unsafe model id");
  return {provider,model};
}
function providerText(response,provider) {
  if (provider==="openai") return {text:response.choices?.[0]?.message?.content, usage:{inputTokens:response.usage?.prompt_tokens,outputTokens:response.usage?.completion_tokens}};
  if (provider==="anthropic") return {text:response.content?.filter(c=>c.type==="text").map(c=>c.text).join(""),usage:{inputTokens:response.usage?.input_tokens,outputTokens:response.usage?.output_tokens}};
  return {text:response.candidates?.[0]?.content?.parts?.filter(c=>typeof c.text==="string").map(c=>c.text).join(""),usage:{inputTokens:response.usageMetadata?.promptTokenCount,outputTokens:response.usageMetadata?.candidatesTokenCount}};
}
export async function queryModel(spec, request, {env=process.env, fetchImpl=fetch, timeoutMs=45000, endpoint}={}) {
  const {provider,model}=typeof spec==="string"?parseModelSpec(spec):spec;
  const def=PROVIDERS[provider];
  if (!def) throw new Error("Unknown model provider");
  const key=env[def.key];
  if (!key) throw new Error("Missing provider API key environment variable: "+def.key);
  if (!Number.isInteger(timeoutMs) || timeoutMs<1000 || timeoutMs>120000) throw new Error("Invalid timeout");
  const messages = [{role:"user",content:request.prompt+(request.repair?"\n\n"+request.repair.instruction+"\nPrevious JSON:\n"+request.repair.previousOutput.slice(0,22000):"")}];
  let url, headers={"Content-Type":"application/json"}, body;
  if (provider==="openai") {
    url=def.url;headers.Authorization="Bearer "+key;
    body={model,temperature:0,max_completion_tokens:5000,messages:[{role:"system",content:request.systemPrompt},...messages]};
  } else if (provider==="anthropic") {
    url=def.url;headers["x-api-key"]=key;headers["anthropic-version"]="2023-06-01";
    body={model,temperature:0,max_tokens:5000,system:request.systemPrompt,messages};
  } else {
    url=def.url+"/"+encodeURIComponent(model)+":generateContent?key="+encodeURIComponent(key);
    body={systemInstruction:{parts:[{text:request.systemPrompt}]},contents:[{role:"user",parts:[{text:messages[0].content}]}],generationConfig:{temperature:0,maxOutputTokens:5000}};
  }
  // endpoint override is for injected offline test transport only; never taken from CLI input.
  if (endpoint) url=endpoint;
  const response=await fetchImpl(url,{method:"POST",headers,body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs)});
  if (!response.ok) throw new Error("Provider "+provider+" returned HTTP "+response.status+" (body omitted to protect data)");
  const raw=await response.text();
  if (raw.length>2_000_000) throw new Error("Provider response exceeded bounded size");
  const parsed=JSON.parse(raw);
  const output=providerText(parsed,provider);
  if (typeof output.text!=="string" || output.text.length===0) throw new Error("Provider "+provider+" did not return text");
  return {...output,model:provider+":"+model};
}
export const SUPPORTED_PROVIDERS=Object.keys(PROVIDERS);
