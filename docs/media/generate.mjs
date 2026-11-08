import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, open, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
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
const encodeFfmpeg = promisify(execFile);

/** Serialize the entire regeneration and stage all outputs until every render/encode succeeds.
 * Optional dependencies let regression tests inject failures without installing a browser/encoder.
 */
export async function generateMedia(selected = examples.map(([name]) => name), {
  directory = here,
  launchBrowser = () => chromium.launch(),
  encode = encodeFfmpeg,
} = {}) {
  for (const name of selected) assert.ok(examples.some(([candidate]) => candidate === name), `Unknown preview: ${name}`);
  const lockPath = join(directory, ".generate.lock");
  const lock = await open(lockPath, "wx").catch(error => {
    if (error.code === "EEXIST") throw new Error(`README media generation is already locked: ${lockPath}`);
    throw error;
  });
  let browser, stage;
  try {
    await lock.writeFile(String(process.pid));
    // Same filesystem as the destination: each published file can use rename.
    stage = await mkdtemp(join(directory, ".generate-"));
    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
    const publish = [];
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    for (const [name, source, width, fps] of examples) {
      if (!selected.includes(name)) continue;
      const generated = name === "intro" ? createIntroScene() : name === "authoring" ? readQuickstart() : undefined;
      const json = generated ? JSON.stringify(generated, null, 2) + "\n" : await readFile(new URL(source, root), "utf8");
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
        const final = evaluate(scene, durationMs);
        await capture(scene.scene.theme === "sketch" ? renderSketchSvg(final) : renderSvg(final), 0);
        for (let index = 1; index < fps; index++) await copyFile(join(framesDir, "frame-000000.png"), join(framesDir, `frame-${String(index).padStart(6, "0")}.png`));
        frameCount = fps;
        for (const frame of svgFrames(scene, { fps, durationMs })) await capture(frame.svg, frameCount++);
      }
      // Derive the palette from the frames to preserve diagram colours and small labels.
      await encode("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-n",
        "-framerate", String(fps), "-i", join(framesDir, "frame-%06d.png"),
        "-filter_complex", "[0:v]split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a",
        "-loop", "0", destination], { windowsHide: true });
      const bytes = await readFile(destination);
      publish.push([destination, join(directory, `${name}.gif`)]);
      if (generated) {
        const stagedSource = join(stage, basename(source));
        await writeFile(stagedSource, json);
        publish.push([stagedSource, join(directory, basename(source))]);
      }
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
    const stagedManifest = join(stage, "manifest.json");
    await writeFile(stagedManifest, JSON.stringify(manifest, null, 2) + "\n");
    publish.push([stagedManifest, join(directory, "manifest.json")]);
    for (const [from, to] of publish) await rename(from, to);
  } finally {
    try { await browser?.close(); }
    finally {
      try {
        if (stage) {
          assert.equal(dirname(resolve(stage)), resolve(directory), "Cleanup must stay inside the media directory");
          await rm(stage, { recursive: true, force: true });
        }
      } finally {
        try { await lock.close(); }
        finally { await unlink(lockPath); }
      }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--only"), "Usage: node docs/media/generate.mjs [--only name,name]");
  await generateMedia(args.length ? args[1].split(",") : undefined);
}
