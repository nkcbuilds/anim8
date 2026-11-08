import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { compileJson } from "../../packages/compiler/dist/index.js";
import { evaluate, sceneDuration } from "../../packages/core/dist/index.js";
import { renderSvg } from "../../packages/renderer-svg/dist/index.js";
import { renderSketchSvg } from "../../packages/renderer-sketch/dist/index.js";
import { svgFrames } from "../../packages/export/dist/index.js";
import { readQuickstart, quickstartFrame, QUICKSTART_PREVIEW } from "./quickstart.mjs";
import { createIntroScene, introFrame, INTRO_PREVIEW } from "./intro.mjs";

const root = new URL("../../", import.meta.url);
const here = fileURLToPath(new URL("./", import.meta.url));
const examples = [
  ["pipeline", "examples/diagram-gallery/dag/scene.json", 880, 10],
  ["data-structures", "examples/diagram-gallery/data-structures/scene.json", 600, 10],
  ["sequence", "examples/diagram-gallery/sequence/scene.json", 600, 10],
  ["merge-sort", "examples/merge-sort-motion/scene.json", 640, 8],
  ["styling", "examples/complex-styling/scene.json", 640, 10],
  ["authoring", "docs/media/quickstart.scene.json", QUICKSTART_PREVIEW.width, QUICKSTART_PREVIEW.fps],
  ["intro", "docs/media/intro.scene.json", INTRO_PREVIEW.width, INTRO_PREVIEW.fps],
];
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--only"), "Usage: node docs/media/generate.mjs [--only name,name]");
const selected = args.length ? args[1].split(",") : examples.map(([name]) => name);
for (const name of selected) assert.ok(examples.some(([candidate]) => candidate === name), `Unknown preview: ${name}`);
if (selected.includes("authoring")) {
  await writeFile(new URL("quickstart.scene.json", import.meta.url), JSON.stringify(readQuickstart(), null, 2) + "\n");
}
if (selected.includes("intro")) {
  await writeFile(new URL("intro.scene.json", import.meta.url), JSON.stringify(createIntroScene(), null, 2) + "\n");
}
const browser = await chromium.launch();
const stage = await mkdtemp(join(tmpdir(), "anim8-readme-media-"));
const manifest = JSON.parse(await readFile(new URL("manifest.json", import.meta.url), "utf8"));
const encode = promisify(execFile);
try {
  const page = await browser.newPage();
  await page.route("**/*", route => route.abort());
  for (const [name, source, width, fps] of examples) {
    if (!selected.includes(name)) continue;
    const json = await readFile(new URL(source, root), "utf8");
    const compiled = compileJson(json);
    assert.ok(compiled.ok && !compiled.diagnostics.length, `${name}: ${JSON.stringify(compiled.diagnostics)}`);
    const scene = compiled.scene;
    const preview = name === "authoring" ? QUICKSTART_PREVIEW : name === "intro" ? INTRO_PREVIEW : undefined;
    const walkthrough = preview !== undefined;
    const height = preview?.height ?? Math.round(width * scene.scene.height / scene.scene.width);
    await page.setViewportSize({ width, height });
    const destination = join(stage, `${name}.gif`);
    const durationMs = preview?.durationMs ?? sceneDuration(scene) + 700;
    const framesDir = join(stage, name);
    await mkdir(framesDir);
    const capture = async (svg, index) => {
      await page.setContent(`<!doctype html><style>html,body{margin:0;background:white}body>svg{display:block;width:${width}px;height:${height}px}</style>${svg}`);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ type: "png", path: join(framesDir, `frame-${String(index).padStart(6, "0")}.png`) });
    };
    let frameCount = 0;
    if (walkthrough) {
      for (let time = 0; time <= durationMs; time += 1000 / fps) {
        await capture(name === "intro" ? introFrame(scene, time) : quickstartFrame(scene, time), frameCount++);
      }
    } else {
      // A complete first frame remains useful in clients that show a still poster.
      const final = evaluate(scene, durationMs);
      await capture(scene.scene.theme === "sketch" ? renderSketchSvg(final) : renderSvg(final), 0);
      for (let index = 1; index < fps; index++) await copyFile(join(framesDir, "frame-000000.png"), join(framesDir, `frame-${String(index).padStart(6, "0")}.png`));
      frameCount = fps;
      for (const frame of svgFrames(scene, { fps, durationMs })) await capture(frame.svg, frameCount++);
    }
    // Derive a palette from these frames; FFmpeg's default fixed GIF palette
    // distorts the diagram colours and makes small labels difficult to read.
    await encode("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-n",
      "-framerate", String(fps), "-i", join(framesDir, "frame-%06d.png"),
      "-filter_complex", "[0:v]split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a",
      "-loop", "0", destination], { windowsHide: true });
    await copyFile(destination, join(here, `${name}.gif`));
    const bytes = await readFile(destination);
    const entry = { file: `${name}.gif`, source, sourceSha256: createHash("sha256").update(json).digest("hex"), width, height, fps, durationMs: durationMs + (walkthrough ? 0 : 1000), posterHoldMs: walkthrough ? 0 : 1000, frames: frameCount, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    if (walkthrough) {
      entry.recipe = name === "intro" ? "docs/media/intro.mjs" : "docs/media/quickstart.mjs";
      entry.recipeSha256 = createHash("sha256").update(await readFile(new URL(entry.recipe, root))).digest("hex");
    }
    const previous = manifest.findIndex(item => item.file === entry.file);
    if (previous === -1) manifest.push(entry);
    else manifest[previous] = entry;
    console.log(`Rendered ${name}: ${frameCount} frames, ${bytes.length} bytes`);
  }
  await writeFile(join(here, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
} finally {
  await browser.close();
  await rm(stage, { recursive: true, force: true });
}
