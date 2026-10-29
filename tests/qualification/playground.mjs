/** Verify editor → compiler → persistent player → exported frame in real browsers. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium, firefox, webkit } from "playwright";
import { compileJson } from "../../packages/compiler/dist/index.js";
import { evaluate, worldMatrix } from "../../packages/core/dist/index.js";

const port = 42179, origin = "http://127.0.0.1:" + port;
const server = spawn(process.execPath, ["examples/playground/server.mjs"], {
  cwd: process.cwd(), env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
let serverOutput = "";
for (const stream of [server.stdout, server.stderr]) stream.on("data", chunk => { serverOutput = (serverOutput + chunk).slice(-8000); });
const sortingSource = await readFile("examples/merge-sort-motion/scene.json", "utf8");
const sorting = compileJson(sortingSource); assert.ok(sorting.ok);
const trace = JSON.parse(await readFile("examples/merge-sort-motion/trace.json", "utf8"));
const quorumSource = await readFile("examples/complex-styling/scene.json", "utf8");
const quorum = JSON.parse(quorumSource);
const report = { ok: false, profiles: [] };
await mkdir("artifacts/playground", { recursive: true });

async function validSource(page, pattern) {
  await page.waitForFunction(pattern => {
    const source = document.querySelector("#source").value;
    return new RegExp(pattern).test(source) && document.querySelector("#status").className === "good";
  }, pattern, { timeout: 15000 });
}
async function compareBoxes(page, time) {
  const frame = evaluate(sorting.scene, time), objects = new Map(frame.objects.map(object => [object.id, object]));
  const expected = frame.objects.filter(object => /^(box-|identity-)/.test(object.id)).map(object => {
    const matrix = worldMatrix(object, objects);
    return { id: object.id, x: matrix.e, y: matrix.f, text: object.text };
  });
  const actual = await page.locator('#preview [data-anim8-id]').evaluateAll(nodes => nodes
    .filter(node => /^(box-|identity-)/.test(node.getAttribute("data-anim8-id"))).map(node => {
      const matrix = node.transform.baseVal.consolidate().matrix;
      return { id: node.getAttribute("data-anim8-id"), x: matrix.e, y: matrix.f, text: node.textContent };
    }));
  assert.equal(actual.length, 24);
  for (const item of expected) {
    const value = actual.find(value => value.id === item.id);
    assert.equal(value.text, item.text, "Number and original tag stay attached");
    assert.ok(Math.abs(value.x - item.x) < .001 && Math.abs(value.y - item.y) < .001, item.id + " position at " + time);
  }
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch {}
    if (server.exitCode !== null) break;
    await new Promise(done => setTimeout(done, 100));
  }
  assert.ok(ready, "Playground failed to start: " + serverOutput);
  for (const [name, engine, viewport] of [
    ["chromium", chromium, { width: 1440, height: 1000 }],
    ["firefox", firefox, { width: 1440, height: 1000 }],
    ["webkit", webkit, { width: 1440, height: 1000 }],
    ["mobile-chromium", chromium, { width: 390, height: 844 }],
  ]) {
    const browser = await engine.launch({ headless: true });
    const profile = { name, ok: false, browserVersion: browser.version() }; report.profiles.push(profile);
    try {
      const page = await browser.newPage({ viewport });
      page.setDefaultTimeout(15000);
      const errors = [], failedRequests = [];
      let compiles = 0, renderRequests = 0;
      page.on("pageerror", error => errors.push(error.message));
      page.on("request", request => {
        if (request.url().endsWith("/api/compile")) compiles++;
        if (request.url().endsWith("/api/render")) renderRequests++;
      });
      page.on("response", response => { if (response.status() >= 400) failedRequests.push(response.status() + " " + response.url()); });
      console.log(name + " · opening");
      await page.goto(origin, { waitUntil: "networkidle" });
      await validSource(page, "box-0");
      assert.equal(await page.locator("#catalog option").count(), 152);
      assert.equal(await page.locator("#catalog").inputValue(), "merge-sort-motion");
      assert.equal(await page.locator("#preview svg").count(), 1);
      assert.equal(await page.locator("#duration-label").textContent(), "24.32s");
      await compareBoxes(page, 0);
      await page.locator("#preview").evaluate(host => {
        window.originalBoxes = [...host.querySelectorAll('[data-anim8-id]')].filter(node => /^(box-|identity-)/.test(node.getAttribute("data-anim8-id")));
      });
      const initialCompiles = compiles;
      for (const time of [200, trace.durationMs, 0, 200]) {
        await page.locator("#scrubber").fill(String(time));
        await compareBoxes(page, time);
      }
      console.log(name + " · playing sort");
      await page.locator("#speed").selectOption("4");
      await page.locator("#restart").click();
      await page.locator("#play").click();
      await page.waitForFunction(() => document.querySelector("#play").getAttribute("aria-pressed") === "false", {}, { timeout: 15000 });
      assert.equal(await page.locator("#scrubber").inputValue(), String(trace.durationMs));
      await compareBoxes(page, trace.durationMs);
      assert.equal(await page.evaluate(() => originalBoxes.length === 24 && originalBoxes.every(node =>
        node === document.querySelector('#preview [data-anim8-id="' + node.getAttribute("data-anim8-id") + '"]'))), true, "The same 24 number/tag nodes survive actual playground playback");
      assert.equal(compiles, initialCompiles, "Playback and seeking must not recompile over HTTP");
      assert.equal(renderRequests, 0, "Frames must be rendered locally");
      await page.screenshot({ path: `artifacts/playground/${name}-sorted.png`, fullPage: true });
      console.log(name + " · downloading");
      const svgDownload = page.waitForEvent("download");
      await page.locator("#download-svg").click();
      const svg = await readFile(await (await svgDownload).path(), "utf8");
      assert.match(svg, /<svg/); assert.match(svg, /box-0/);
      assert.equal(await page.evaluate(svg => new DOMParser().parseFromString(svg, "image/svg+xml").querySelector("parsererror") === null, svg), true, "Export is well-formed standalone SVG");
      await page.locator("#restart").click();
      await page.locator("#play").click(); // Replay from zero, then explicitly pause.
      await page.waitForFunction(() => Number(document.querySelector("#scrubber").value) > 100);
      await page.locator("#play").click();
      const paused = await page.locator("#preview svg").evaluate(svg => svg.outerHTML);
      await page.waitForTimeout(120);
      assert.equal(await page.locator("#preview svg").evaluate(svg => svg.outerHTML), paused);

      console.log(name + " · quorum");
      await page.locator("#catalog").selectOption("complex-styling");
      await validSource(page, "How a quorum commits");
      assert.equal(await page.locator("#markers option").count(), quorum.markers.length + 1);
      const marker = quorum.markers[2];
      await page.locator("#markers").selectOption("2");
      assert.equal(await page.locator("#scrubber").inputValue(), String(marker.time));
      await page.locator("#previous-step").click();
      assert.equal(await page.locator("#scrubber").inputValue(), String(quorum.markers[1].time));
      await page.locator("#next-step").click();
      assert.equal(await page.locator("#scrubber").inputValue(), String(marker.time));
      assert.ok(await page.locator("#preview linearGradient").count() > 0);
      assert.ok(await page.locator('#preview [stroke-dasharray]').count() > 0);
      await page.screenshot({ path: `artifacts/playground/${name}-quorum.png`, fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Controls must fit the viewport");
      const visible = await page.locator("#preview svg").boundingBox();
      const shell = await page.locator(".canvas-shell").boundingBox();
      assert.ok(visible.y >= shell.y && visible.y + visible.height <= shell.y + shell.height + 1, "Whole diagram must fit the canvas");

      console.log(name + " · invalid edit");
      // Compile a bad edit while playing: no stale export or animation may remain.
      await page.locator("#play").click();
      await page.locator("#source").fill('{"invalid":true}');
      await page.locator("#status.bad").waitFor();
      assert.match(await page.locator("#errors").textContent(), /INVALID|SCENE|version/i);
      assert.equal(await page.locator("#play").isDisabled(), true);
      assert.equal(await page.locator("#download-svg").isDisabled(), true);
      assert.equal(await page.locator("#preview svg").count(), 0);
      await page.locator("#catalog").selectOption("photosynthesis");
      await validSource(page, "Photosynthesis");
      const jsonDownload = page.waitForEvent("download");
      await page.locator("#download-json").click();
      assert.match(await readFile(await (await jsonDownload).path(), "utf8"), /Photosynthesis/);
      await page.locator("#file-input").setInputFiles({ name: "quorum.json", mimeType: "application/json", buffer: Buffer.from(quorumSource) });
      await validSource(page, "How a quorum commits");
      assert.equal(await page.locator("#scrubber").inputValue(), "0", "Import resets time");
      for (const stepTime of [0, 1000]) {
        const tied = { ...quorum, markers: [
          { id: "first", label: "First tied step " + stepTime, time: stepTime },
          { id: "second", label: "Second tied step", time: stepTime },
          { id: "third", label: "Later step", time: 2000 },
        ] };
        await page.locator("#file-input").setInputFiles({ name: "tied-steps.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(tied)) });
        await validSource(page, "First tied step " + stepTime);
        await page.locator("#markers").selectOption("0");
        assert.equal(await page.locator("#markers").inputValue(), "0", "Select the first same-time annotation");
        await page.locator("#next-step").click();
        assert.equal(await page.locator("#markers").inputValue(), "1", "Visit the second annotation at the same time");
        assert.equal(await page.locator("#scrubber").inputValue(), String(stepTime));
        await page.locator("#previous-step").click();
        assert.equal(await page.locator("#markers").inputValue(), "0", "Return to the first same-time annotation");
        await page.locator("#markers").selectOption("2");
        await page.locator("#previous-step").click();
        assert.equal(await page.locator("#markers").inputValue(), "1");
        await page.locator("#scrubber").fill(String(stepTime + 300));
        await page.locator("#previous-step").click();
        assert.equal(await page.locator("#scrubber").inputValue(), String(stepTime), "Previous from between steps reaches the current step start");
        await page.locator("#previous-step").click();
        assert.equal(await page.locator("#markers").inputValue(), "0");
        await page.locator("#previous-step").click();
        assert.equal(await page.locator("#markers").inputValue(), "", "Before-first state must not jump to the last zero-time marker");
        await page.locator("#next-step").click();
        assert.equal(await page.locator("#markers").inputValue(), "0");
      }
      // Source changes with no steps cannot retain the previous scene's markers.
      console.log(name + " · still scene");
      const still = { version: "1.0", scene: { width: 300, height: 200 }, objects: [], timeline: [] };
      await page.locator("#file-input").setInputFiles({ name: "still.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(still)) });
      await validSource(page, '"width":300');
      assert.equal(await page.locator("#play").isDisabled(), true);
      assert.equal(await page.locator("#markers").isDisabled(), true);
      assert.equal(await page.locator("#markers option").count(), 1);
      console.log(name + " · delayed response");
      if (name === "chromium") {
        // Hold a real API response after fetch resolves: even an already-complete
        // old request must not replace a newer edit when its callback runs late.
        await page.evaluate(() => {
          const nativeFetch = window.fetch;
          window.restoreFetch = () => { window.fetch = nativeFetch; };
          let first = true;
          window.fetch = async (...args) => {
            const hold = args[0] === "/api/compile" && first;
            if (hold) first = false;
            const response = await nativeFetch(...args);
            if (hold) {
              window.oldCompileReady = true;
              await new Promise(resolve => { window.releaseOldCompile = resolve; });
            }
            return response;
          };
        });
        try {
          await page.locator("#source").fill(quorumSource);
          await page.waitForFunction(() => window.oldCompileReady, {}, { timeout: 15000 });
          const latest = { ...still, scene: { width: 301, height: 200 } };
          await page.locator("#source").fill(JSON.stringify(latest));
          await validSource(page, '"width":301');
          await page.evaluate(() => window.releaseOldCompile());
          await page.waitForTimeout(100);
          assert.equal(await page.locator("#duration-label").textContent(), "0.00s");
          assert.equal(await page.locator("#markers option").count(), 1);
          assert.equal(await page.locator("#preview svg").getAttribute("viewBox"), "0 0 301 200");
        } finally { await page.evaluate(() => { window.releaseOldCompile?.(); window.restoreFetch(); }); }
      }
      assert.deepEqual(errors, []); assert.deepEqual(failedRequests, []);
      Object.assign(profile, { ok: true, compiles, playbackCompiles: 0, movingNodes: 24, markers: quorum.markers.length, downloads: ["json", "svg"] });
      console.log(JSON.stringify(profile));
    } finally { await browser.close(); }
  }
  for (const endpoint of ["compile", "render"]) {
    const blocked = await fetch(origin + "/api/" + endpoint, { method: "POST", headers: { Origin: "https://attacker.example", "Content-Type": "application/json" }, body: JSON.stringify({ source: "{}", timeMs: 0 }) });
    assert.equal(blocked.status, 403, "Cross-origin compilation must be rejected");
  }
  assert.equal((await fetch(origin + "/api/example?id=../../package.json")).status, 404);
  // Unicode labels must survive TCP chunks ending inside a multibyte character.
  const unicodeLabel = "Compare ≤ then merge 🚀";
  const unicodeScene = { version: "1.0", scene: { width: 300, height: 200 }, objects: [], timeline: [], markers: [{ id: "compare", label: unicodeLabel, time: 0 }] };
  const body = Buffer.from(JSON.stringify({ source: JSON.stringify(unicodeScene) }));
  for (const character of ["≤", "🚀"]) {
    const split = body.indexOf(Buffer.from(character)) + 1;
    const result = await new Promise((resolve, reject) => {
      const req = httpRequest(origin + "/api/compile", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" } }, res => {
        const chunks = [];
        res.on("data", chunk => chunks.push(chunk));
        res.on("error", reject);
        res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (error) { reject(error); } });
      });
      req.setTimeout(5000, () => req.destroy(Error("Unicode compile timed out")));
      req.on("error", reject);
      req.write(body.subarray(0, split));
      setTimeout(() => req.end(body.subarray(split)), 20);
    });
    assert.equal(result.ok, true);
    assert.equal(result.scene.markers[0].label, unicodeLabel, "Decode UTF-8 after collecting chunks");
  }
  report.ok = true;
} finally {
  server.kill();
  await writeFile("artifacts/playground/browser.json", JSON.stringify(report, null, 2) + "\n");
  if (!report.ok) console.error(serverOutput);
}
assert.ok(report.ok);
console.log("PASS: 152 examples, persistent merge-sort playback without frame requests, steps/speed, rich styles, error recovery, import and JSON/SVG downloads across desktop engines and mobile viewport");
