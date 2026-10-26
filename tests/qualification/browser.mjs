/** Browser regression qualification. Emulation is not physical-device evidence. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, platform, arch } from "node:os";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";
import { chromium, webkit, devices } from "playwright";

const args = process.argv.slice(2);
let matrix = false, durationMs = 5000, output = "artifacts/qualification/browser.json";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--matrix") matrix = true;
  else if (args[i] === "--duration-ms") durationMs = Number(args[++i]);
  else if (args[i] === "--out") { output = args[++i]; assert.ok(output, "--out requires a path"); }
  else throw new Error("Unknown option: " + args[i]);
}
assert.ok(Number.isInteger(durationMs) && durationMs >= 2000 && durationMs <= 300_000,
  "--duration-ms must be an integer between 2000 and 300000");

const root = process.cwd();
const sample = JSON.parse(readFileSync(resolve(root, "examples/catalog/computing/binary-search/scene.json"), "utf8"));
// A valid, larger scene exercises evaluation and SVG updates beyond catalog scale.
const dense = {
  version: "1.0", scene: { width: 800, height: 450 },
  objects: Array.from({ length: 200 }, (_, i) => ({
    id: "box-" + i, type: "rect", width: 20, height: 20,
    transform: { x: 25 + i % 25 * 30, y: 25 + Math.floor(i / 25) * 45, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
    style: { fill: "#bbf7d0", stroke: "#1f2937", strokeWidth: 1 }, visible: true, z: i,
  })),
  timeline: Array.from({ length: 200 }, (_, i) => ({
    id: "move-" + i, type: "move", target: "box-" + i, start: 0, duration: 3000,
    to: { x: 35 + i % 25 * 30, y: 40 + Math.floor(i / 25) * 45 },
  })),
};

const compiled = await build({
  stdin: { contents: `
    import { mountPlayer } from "./packages/player/dist/index.js";
    import { compileJson } from "./packages/compiler/dist/index.js";
    const controllers = [], frames = [];
    let rendered = 0;
    window.BENCH = {
      create(source, n) {
        const result = compileJson(JSON.stringify(source));
        if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
        for (let i = 0; i < n; i++) {
          const container = document.createElement("div");
          container.style.cssText = "width:300px;height:168px";
          document.querySelector("#mount").append(container);
          frames[i] = 0;
          controllers.push(mountPlayer(container, result.scene, {
            loop: true, onFrame() { frames[i]++; rendered++; }
          }));
        }
      },
      start() { controllers.forEach(p => p.play()); },
      stop() { controllers.forEach(p => p.pause()); },
      clear() {
        controllers.forEach(p => p.destroy()); controllers.length = 0;
        document.querySelector("#mount").replaceChildren(); frames.length = 0;
      },
      stats() { return { count: controllers.length, frames: [...frames], rendered }; }
    };`, resolveDir: root, sourcefile: "bench-entry.js" },
  bundle: true, platform: "browser", format: "iife", write: false,
});
const server = createServer((req, res) => {
  if (req.url === "/bundle.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(compiled.outputFiles[0].text);
  } else {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><main id="mount"></main><script src="/bundle.js"></script></body></html>');
  }
});
const profiles = [
  { name: "chromium-desktop", engine: chromium, context: { viewport: { width: 1280, height: 720 } }, cpuRate: 1, scene: sample, instances: 12, p95Limit: 100, maxLimit: 350 },
  ...(matrix ? [
    { name: "chromium-mobile-cpu4", engine: chromium, context: devices["Pixel 7"], cpuRate: 4, scene: sample, instances: 12, p95Limit: 200, maxLimit: 1000 },
    { name: "webkit-mobile", engine: webkit, context: devices["iPhone 13"], cpuRate: 1, scene: sample, instances: 12, p95Limit: 100, maxLimit: 350 },
    { name: "chromium-dense", engine: chromium, context: { viewport: { width: 1280, height: 720 } }, cpuRate: 1, scene: dense, instances: 1, p95Limit: 100, maxLimit: 350 },
  ] : []),
];
const report = {
  schemaVersion: 1, ok: false, startedAt: new Date().toISOString(),
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  dirty: Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()),
  environment: {
    platform: platform(), arch: arch(), node: process.version, cpu: cpus()[0]?.model, logicalCpus: cpus().length,
    hostDependencyValidationSkipped: process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS === "1",
  },
  durationMs, emulationOnly: true, profiles: [],
};

async function qualify(profile, result) {
  const browser = await profile.engine.launch({ headless: true });
  try {
    result.browserVersion = browser.version();
    const context = await browser.newContext(profile.context);
    const page = await context.newPage();
    page.setDefaultTimeout(durationMs + 30_000);
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.waitForFunction(() => typeof window.BENCH === "object");
    const cdp = profile.engine === chromium ? await context.newCDPSession(page) : null;
    if (cdp) {
      await cdp.send("Performance.enable");
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuRate });
    }
    const heap = async () => {
      if (!cdp) return null;
      await cdp.send("HeapProfiler.collectGarbage");
      const metrics = await cdp.send("Performance.getMetrics");
      const value = metrics.metrics.find(m => m.name === "JSHeapUsedSize")?.value;
      assert.ok(Number.isFinite(value), "Chromium heap metric missing");
      return value;
    };
    const waitFrames = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    const before = await heap();
    for (let i = 0; i < 30; i++) {
      await page.evaluate(scene => { BENCH.create(scene, 8); BENCH.start(); }, profile.scene);
      await waitFrames();
      await page.evaluate(() => BENCH.clear());
    }
    const after = await heap();
    await page.evaluate(({ scene, n }) => { BENCH.create(scene, n); BENCH.start(); }, { scene: profile.scene, n: profile.instances });
    const timings = await page.evaluate(async duration => {
      const gaps = []; let previous;
      await new Promise(done => {
        let start;
        function step(t) {
          start ??= t;
          if (previous !== undefined) gaps.push(t - previous);
          previous = t;
          if (t - start < duration) requestAnimationFrame(step); else done();
        }
        requestAnimationFrame(step);
      });
      return gaps;
    }, durationMs);
    await page.evaluate(() => BENCH.stop());
    const stats = await page.evaluate(() => BENCH.stats());
    await waitFrames();
    assert.deepEqual(await page.evaluate(() => BENCH.stats()), stats, "Paused players must stop rendering");
    const activeHeap = await heap();
    await page.evaluate(() => BENCH.clear());
    const cleared = await page.evaluate(() => BENCH.stats());
    await waitFrames();
    assert.deepEqual(await page.evaluate(() => BENCH.stats()), cleared, "Destroyed players must stop rendering");
    const finalHeap = await heap();
    const sorted = [...timings].sort((a, b) => a - b);
    Object.assign(result, {
      rafFrames: timings.length, rafP95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
      rafMaxMs: sorted.at(-1), perPlayerFrames: stats.frames,
      heapGrowthBytes: cdp ? after - before : null, activeHeapBytes: activeHeap,
      finalHeapGrowthBytes: cdp ? finalHeap - before : null, errors,
    });
    assert.equal(await page.locator("#mount *").count(), 0, "Mounted DOM must be removed");
    assert.equal(cleared.count, 0);
    assert.equal(stats.count, profile.instances);
    assert.ok(stats.frames.every(n => n > 20), "Every player must actually render frames");
    assert.ok(timings.length > 20, "Not enough RAF samples");
    assert.deepEqual(errors, [], "Browser runtime errors");
    if (cdp) {
      assert.ok(result.heapGrowthBytes < 30 * 1024 * 1024, "Lifecycle heap growth exceeds 30 MiB");
      assert.ok(result.finalHeapGrowthBytes < 30 * 1024 * 1024, "Post-playback heap growth exceeds 30 MiB");
    }
    assert.ok(result.rafP95Ms < profile.p95Limit, "RAF p95 exceeds profile smoke limit");
    assert.ok(result.rafMaxMs < profile.maxLimit, "Blocked frame exceeds profile smoke limit");
    result.ok = true;
  } finally { await browser.close(); }
}

try {
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  for (const profile of profiles) {
    const result = {
      name: profile.name, ok: false, viewport: profile.context.viewport,
      deviceScaleFactor: profile.context.deviceScaleFactor ?? 1,
      isMobile: profile.context.isMobile ?? false, hasTouch: profile.context.hasTouch ?? false,
      cpuThrottlingRate: profile.cpuRate, objects: profile.scene.objects.length,
      instances: profile.instances, mountUnmountCycles: 30,
      limits: { rafP95Ms: profile.p95Limit, rafMaxMs: profile.maxLimit, heapGrowthBytes: 30 * 1024 * 1024 },
    };
    report.profiles.push(result);
    try { await qualify(profile, result); }
    catch (error) { result.error = error.stack ?? String(error); }
    console.log(JSON.stringify(result));
  }
  report.ok = report.profiles.every(p => p.ok);
} finally {
  if (server.listening) await new Promise(done => server.close(done));
  report.finishedAt = new Date().toISOString();
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
}
assert.ok(report.ok, "Browser qualification failed; see " + output);
