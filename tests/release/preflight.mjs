#!/usr/bin/env node
/**
 * Dry-run release gate. Never creates tags or publishes packages.
 * Use --publish only in an authenticated publishing environment.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const root=resolve(import.meta.dirname,"../..");
const publish=process.argv.includes("--publish");
const manifests=[];
for(const folder of readdirSync(resolve(root,"packages"),{withFileTypes:true}).filter(x=>x.isDirectory())){
 const packageRoot=resolve(root,"packages",folder.name);
 const filename=resolve(packageRoot,"package.json");
 if(!existsSync(filename))continue;
 const info=JSON.parse(readFileSync(filename,"utf8"));
 if(info.private)continue;
 assert.match(info.name,/^@anim8\/[a-z0-9-]+$/);
 assert.match(info.version,/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/);
 assert.equal(info.license,"MIT");
 assert.ok(existsSync(resolve(packageRoot,"README.md")),info.name+" missing README");
 assert.ok(existsSync(resolve(packageRoot,"LICENSE")),info.name+" missing LICENSE");
 assert.ok(existsSync(resolve(packageRoot,"dist")),info.name+" not built; run pnpm build");
 assert.ok(info.exports?.["."]||info.bin?.anim8,info.name+" missing exports");
 if(info.exports?.["."]){
  for(const field of ["types","import"]){
   const relative=info.exports["."][field];
   assert.ok(typeof relative==="string"&&relative.startsWith("./dist/"),info.name+" invalid "+field);
   assert.ok(existsSync(resolve(packageRoot,relative)),info.name+" missing "+field+" build");
  }
 }
 for(const binary of Object.values(info.bin??{})){
  const location=resolve(packageRoot,binary);
  assert.ok(existsSync(location),info.name+" CLI missing "+binary);
  assert.ok(readFileSync(location,"utf8").startsWith("#!/usr/bin/env node"),info.name+" CLI lacks executable shebang");
 }
 manifests.push(info);
}
assert.equal(manifests.length,19,"Expected 19 distributable public packages");
assert.equal(new Set(manifests.map(x=>x.version)).size,1,"Version mismatch");
const version=manifests[0].version;
if(process.env.ANIM8_RELEASE_TAG)assert.equal(process.env.ANIM8_RELEASE_TAG,"v"+version,"Tag/version mismatch");
if(publish){
 assert.ok(process.env.ANIM8_RELEASE_TAG,"Publishing requires explicit version tag");
 assert.ok(process.env.NPM_TOKEN,"NPM_TOKEN secret not configured");
 const sha=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
 const tagSha=execFileSync("git",["rev-parse","refs/tags/"+process.env.ANIM8_RELEASE_TAG+"^{}"],{cwd:root,encoding:"utf8"}).trim();
 assert.equal(tagSha,sha,"Release tag must refer to checked-out commit");
}
console.log("PASS: release preflight v"+version+": "+manifests.length+" built packages with metadata/exports/license/README/bin. "+(publish?"Publishing environment OK":"Dry-run; no npm auth or publication attempted."));
