import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scene } from "../../packages/authoring/dist/index.js";
import { DIAGRAM_TONES, evaluate } from "../../packages/core/dist/index.js";
import { renderSketchSvg } from "../../packages/renderer-sketch/dist/index.js";

/** Execute only the trusted repository's marked authoring example, before its DOM mount. */
export function readQuickstart() {
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8").replace(/\r/g, "");
  const snippet = readme.match(/<!-- quickstart:start -->\n```ts\n([\s\S]*?)\n```\n<!-- quickstart:end -->/);
  assert.ok(snippet, "README authoring example must have quickstart markers");
  const builder = snippet[1].replace(/^import .*;\n/gm, "").split("const player =")[0];
  const document = new Function("scene", "DIAGRAM_TONES", builder + "\nreturn s.toJSON();")(scene, DIAGRAM_TONES);
  assert.deepEqual(document.timeline.map(({ type, target, start, duration }) => ({ type, target, start, duration })), [
    { type: "move", target: "request", start: 0, duration: 900 },
    { type: "style", target: "service", start: 900, duration: 400 },
  ], "Update the walkthrough's timing and captions when changing the README actions");
  assert.equal(document.scene.width, 800, "Update the walkthrough viewport when resizing the example");
  assert.equal(document.scene.height, 360, "Update the walkthrough viewport when resizing the example");
  return document;
}

export const QUICKSTART_PREVIEW = Object.freeze({ width: 880, height: 410, fps: 10, durationMs: 10_000 });

const xml = text => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The build beats are explanatory overlays; playback samples the unmodified example at quarter speed. */
export function quickstartFrame(document, previewTime) {
  const phase = previewTime < 1600 ? 0 : previewTime < 3000 ? 1 : previewTime < 6600 ? 2 : 3;
  const sceneTime = Math.max(0, Math.min(1300, (previewTime - 3000) / 4));
  const frame = evaluate(document, sceneTime);
  if (phase === 0) frame.objects = frame.objects.filter(object => object.type !== "connector");
  const diagram = renderSketchSvg(frame)
    .replace('viewBox="0 0 800 360"', 'viewBox="80 100 560 160"')
    .replace('<svg xmlns=', '<svg x="40" y="76" width="800" height="230" xmlns=');
  const titles = ["Create two objects", "Connect them", "Move the request", "Mark it complete"];
  const code = [
    's.box("Request"); s.box("Service");',
    's.connect(input, service)',
    'input.moveTo({ x: 340, y: 180 }, …)',
    'service.styleTo(DIAGRAM_TONES.green, …)',
  ];
  const trackX = 64, trackWidth = 752, splitX = trackX + trackWidth * 900 / 1300;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 410" role="img" aria-label="${xml(titles[phase])}">
    <rect width="880" height="410" rx="20" fill="#fcfbf7"/>
    <g font-family="Arial, sans-serif" fill="#243b35">
      <text x="40" y="53" font-size="30" font-weight="700">${titles[phase]}</text>
      <text x="840" y="51" text-anchor="end" font-size="17" fill="#7c8981">${phase + 1} / 4</text>
      ${diagram}
      <text x="440" y="321" text-anchor="middle" font-family="Consolas, monospace" font-size="23" fill="#365eaf">${xml(code[phase])}</text>
      <rect x="64" y="355" width="752" height="5" rx="2.5" fill="#e3e7df"/>
      <rect x="64" y="355" width="${trackWidth * sceneTime / 1300}" height="5" rx="2.5" fill="#588f67"/>
      <circle cx="${trackX + trackWidth * sceneTime / 1300}" cy="357.5" r="5" fill="#243b35"/>
      <text x="64" y="386" font-size="14" fill="#7c8981">0 ms</text>
      <text x="${splitX}" y="386" text-anchor="middle" font-size="14" fill="#7c8981">900 ms</text>
      <text x="816" y="386" text-anchor="end" font-size="14" fill="#7c8981">1300 ms</text>
    </g>
  </svg>`;
}
