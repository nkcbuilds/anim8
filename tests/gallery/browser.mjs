import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { compileJson } from "../../packages/compiler/dist/index.js";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const source = new URL("../../examples/diagram-gallery/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("index.json", source), "utf8"));
const entries = await Promise.all(manifest.diagrams.map(async entry => {
  const compiled = compileJson(await readFile(new URL(entry.file, source), "utf8"));
  assert.ok(compiled.ok && !compiled.diagnostics.length, entry.id);
  return { ...entry, scene: compiled.scene };
}));
const out = resolve(repo, "artifacts/gallery");
await mkdir(out, { recursive: true });
const bundle = await build({
  stdin: { contents: `
    import { mountPlayer } from './packages/player/dist/index.js';
    const entries = ${JSON.stringify(entries)};
    window.gallery = entries.map(entry => {
      const figure = document.createElement('figure');
      figure.id = entry.id;
      const canvas = document.createElement('div');
      canvas.className = 'canvas';
      figure.append(canvas);
      const controls = document.createElement('figcaption');
      const label = document.createElement('span');
      label.textContent = entry.id;
      const button = document.createElement('button');
      button.textContent = 'Replay';
      const scrubber = document.createElement('input');
      scrubber.type = 'range'; scrubber.min = 0; scrubber.step = 1;
      scrubber.setAttribute('aria-label', entry.id + ' animation time');
      controls.append(label, button, scrubber); figure.append(controls);
      document.querySelector('main').append(figure);
      const player = mountPlayer(canvas, entry.scene, { autoplay: false,
        onFrame: frame => { scrubber.value = String(frame.time); } });
      scrubber.max = String(player.getDuration());
      player.seek(player.getDuration());
      button.onclick = () => { player.seek(0); player.play(); };
      scrubber.oninput = () => { player.pause(); player.seek(Number(scrubber.value)); };
      return { id: entry.id, canvas, player };
    });
    window.galleryReady = true;
  `, resolveDir: repo, sourcefile: "gallery-entry.js" },
  bundle: true, format: "iife", platform: "browser", write: false, minify: true,
});
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Anim8 diagram gallery</title>
<style>body{margin:0;background:#e9ecef;color:#1e1e1e;font:14px system-ui}header{padding:24px}h1{margin:0 0 8px;font-size:24px}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:12px}figure{margin:0;background:white;border-radius:8px;overflow:hidden}.canvas svg{display:block;width:100%;height:auto}figcaption{display:flex;align-items:center;gap:12px;padding:12px}figcaption span{flex:1}input{width:35%}button{cursor:pointer}@media(max-width:1000px){main{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:650px){main{grid-template-columns:1fr}}</style>
<header><h1>Drawn to explain</h1><p>17 animated diagram families. Replay a scene or drag its timeline.</p></header><main></main><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></html>`;
await writeFile(resolve(out, "index.html"), html);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(pathToFileURL(resolve(out, "index.html")).href);
  await page.waitForFunction(() => window.galleryReady);
  await page.evaluate(async () => { await document.fonts.load('20px "Virgil"'); await document.fonts.ready; });
  const result = await page.evaluate(async () => {
    const cases = window.gallery.map(({ canvas, player, id }) => {
      const svg = canvas.querySelector('svg');
      const nodes = [...canvas.querySelectorAll('[data-anim8-id]')];
      const final = svg.outerHTML;
      player.seek(0); const start = svg.outerHTML;
      player.seek(player.getDuration() / 2); const middle = svg.outerHTML;
      player.seek(player.getDuration());
      const bounds = svg.getBoundingClientRect();
      const outside = [...svg.querySelectorAll('text')].filter(text => {
        const rect = text.getBoundingClientRect();
        return rect.width > 0 && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 ||
          rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1);
      }).map(text => text.textContent);
      const stable = svg.outerHTML === final && canvas.querySelector('svg') === svg &&
        nodes.every(node => canvas.querySelector('[data-anim8-id="' + node.getAttribute('data-anim8-id') + '"]') === node);
      player.seek(0); player.play();
      return { id, stable, outside, changes: start !== middle && middle !== final };
    });
    await new Promise(resolve => setTimeout(resolve, 200));
    window.gallery.forEach(({ player }, i) => {
      player.pause(); cases[i].played = player.getTime() > 0;
      player.seek(player.getDuration());
    });
    return { cases, font: document.fonts.check('20px "Virgil"') };
  });
  assert.equal(result.font, true);
  for (const item of result.cases) {
    assert.ok(item.stable && item.changes && item.played, JSON.stringify(item));
    assert.deepEqual(item.outside, [], `${item.id}: text outside the SVG`);
    console.log(`PASS Chromium ${item.id}: play, seek, replay, DOM identity`);
  }
  await page.locator("#dag button").click();
  await page.waitForFunction(() => window.gallery[0].player.getTime() > 0);
  const scrubber = page.locator('#dag input[type="range"]');
  await scrubber.press("Home");
  assert.equal(await page.evaluate(() => window.gallery[0].player.getTime()), 0);
  assert.equal(await page.evaluate(() => window.gallery[0].player.isPlaying()), false);
  await scrubber.press("End");
  assert.equal(await page.evaluate(() => window.gallery[0].player.getTime() === window.gallery[0].player.getDuration()), true);
  console.log("PASS offline gallery: replay button and keyboard timeline scrubbing");
  for (const mode of ["final", "middle"]) {
    await page.evaluate(mode => window.gallery.forEach(({ player }) => player.seek(player.getDuration() * (mode === "final" ? 1 : 0.5))), mode);
    for (let batch = 0; batch < 3; batch++) {
      await page.evaluate(batch => window.gallery.forEach(({ canvas }, i) => { canvas.parentElement.hidden = Math.floor(i / 6) !== batch; }), batch);
      await page.screenshot({ path: resolve(out, `${mode}-${batch + 1}.png`), fullPage: true });
    }
  }
  await page.evaluate(() => window.gallery.forEach(({ canvas }) => { canvas.parentElement.hidden = false; }));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Gallery overflows on mobile");
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
console.log(`Interactive gallery and screenshots: ${out}`);
