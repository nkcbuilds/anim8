/** Browser test for real playground controls and compile/diagnostics integration. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
const port=42179, origin="http://127.0.0.1:"+port;
const server=spawn(process.execPath,["examples/playground/server.mjs"],{cwd:process.cwd(),env:{...process.env,PORT:String(port)},stdio:"ignore",windowsHide:true});
let browser;
try{
 let ready=false;
 for(let attempt=0;attempt<100;attempt++){
   try{const response=await fetch(origin);if(response.ok){ready=true;break;}}catch{}
   await new Promise(done=>setTimeout(done,100));
 }
 assert.ok(ready,"Playground server did not become reachable");
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1360,height:900}});
 const pageErrors=[];page.on("pageerror",err=>pageErrors.push(err.message));
 await page.goto(origin,{waitUntil:"networkidle"});
 await page.locator("#status.good").waitFor({timeout:15000});
 assert.equal(await page.locator("#catalog option").count(),150,"All teaching examples should be selectable");
 assert.ok((await page.locator("#preview svg").count())===1,"Real SVG frame must render");
 const initial=await page.locator("#preview svg").evaluate(svg=>svg.outerHTML);
 await page.locator("#scrubber").fill("1400");
 await page.locator("#status.good").waitFor();
 await page.waitForTimeout(500);
 assert.notEqual(await page.locator("#preview svg").evaluate(svg=>svg.outerHTML),initial,"Seek changes SVG");
 await page.locator("#source").fill('{"invalid":true}');
 await page.locator("#status.bad").waitFor();
 assert.match(await page.locator("#errors").textContent(),/INVALID|SCENE|version/i);
 await page.locator("#catalog").selectOption("photosynthesis");
 await page.locator("#status.good").waitFor();
 assert.match(await page.locator("#source").inputValue(),/Photosynthesis/i);
 await page.locator("#download-json").click();
 await page.locator("#play").click();
 assert.match(await page.locator("#play").textContent(),/Pause/);
 await page.locator("#play").click();
 if(process.env.ANIM8_PLAYGROUND_SCREENSHOT)await page.screenshot({path:process.env.ANIM8_PLAYGROUND_SCREENSHOT,fullPage:true});
 const blocked=await fetch(origin+"/api/render",{method:"POST",headers:{"Origin":"https://attacker.example","Content-Type":"application/json"},body:JSON.stringify({source:"{}",timeMs:0})});
 assert.equal(blocked.status,403,"Cross-origin mutation must not be accepted");
 assert.deepEqual(pageErrors,[],"No JS runtime failures in browser");
 console.log("PASS: playground loads 150 examples, renders SVG, seeks, validates invalid JSON, switches example, downloads JSON, plays and rejects cross-origin edits");
}finally{await browser?.close();server.kill();}
