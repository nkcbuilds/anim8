import { scene } from "../../packages/authoring/dist/index.js";
import { DIAGRAM_TONES, evaluate, sceneDuration } from "../../packages/core/dist/index.js";
import { renderSketchSvg } from "../../packages/renderer-sketch/dist/index.js";

export const INTRO_PREVIEW = Object.freeze({ width: 880, height: 430, fps: 10, durationMs: 14_000 });

/** A real Anim8 scene used throughout the product walkthrough, including random-access seeks. */
export function createIntroScene() {
  const s = scene({ width: 880, height: 360, theme: "sketch", seed: 11 });
  const client = s.box("Client", { id: "client", x: 140, y: 190, width: 144, height: 76, fontSize: 24, ...DIAGRAM_TONES.blue });
  const api = s.box("API", { id: "api", x: 440, y: 190, width: 144, height: 76, fontSize: 24, ...DIAGRAM_TONES.neutral });
  const store = s.box("Store", { id: "store", x: 740, y: 190, width: 144, height: 76, fontSize: 24, ...DIAGRAM_TONES.neutral });
  s.connect(client, api);
  s.connect(api, store);
  const packet = s.circle("", { id: "packet", x: 244, y: 190, width: 16, fill: "#1971c2", stroke: "#1971c2" });
  s.step("Send", () => s.sequence(packet.moveTo({ x: 336, y: 190 }, { duration: 1000, easing: "linear" })));
  s.step("Process", () => s.sequence(api.styleTo(DIAGRAM_TONES.green, { duration: 300 })));
  s.sequence(packet.moveTo({ x: 544, y: 190 }, { duration: 0 }));
  s.step("Store", () => s.sequence(packet.moveTo({ x: 636, y: 190 }, { duration: 1000, easing: "linear" })));
  s.step("Complete", () => s.sequence(store.styleTo(DIAGRAM_TONES.green, { duration: 300 })));
  return s.toJSON();
}

const xml = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Preview chapters illustrate authoring, playback, direct seeking, and delivery from one source document. */
export function introFrame(document, previewTime) {
  const phase = previewTime < 3000 ? 0 : previewTime < 7000 ? 1 : previewTime < 11_000 ? 2 : 3;
  const duration = sceneDuration(document);
  let time = phase === 0 ? 0 : phase === 1 ? (previewTime - 3000) / 4000 * duration : duration;
  if (phase === 2) {
    // Jump forward, reverse, seek to an earlier point, and move forward again.
    const points = [[7000, 0], [8000, duration], [9300, 800], [10_000, 800], [11_000, duration]];
    const index = points.findIndex((point, i) => i > 0 && previewTime < point[0]);
    const [start, from] = points[index - 1], [end, to] = points[index];
    time = from + (to - from) * (previewTime - start) / (end - start);
  }
  time = Math.max(0, Math.min(duration, time));
  const frame = evaluate(document, time);
  if (phase === 0 || phase === 3) frame.objects = frame.objects.filter(object => object.id !== "packet");
  const diagram = renderSketchSvg(frame)
    .replace('viewBox="0 0 880 360"', 'viewBox="0 90 880 200"')
    .replace('<svg xmlns=', '<svg x="24" y="106" width="832" height="190" xmlns=');
  const titles = ["Describe a system.", "Give the story a timeline.", "Jump to any moment.", "Embed it. Export it."];
  const captions = ["TypeScript or JSON. Objects, connections, and actions.", "Move data. Highlight a result. Explain what happens next.", "Play, pause, seek, and reverse the same scene.", "A web player for exploring. SVG, GIF, or MP4 for sharing."];
  const steps = ["AUTHOR", "ANIMATE", "EXPLORE", "SHARE"].map((label, i) =>
    `<text x="${110 + i * 220}" y="404" text-anchor="middle" font-size="14" font-weight="${phase === i ? 700 : 400}" fill="${phase === i ? "#243b35" : "#8c958e"}">${String(i + 1).padStart(2, "0")}  ${label}</text>`).join("");
  let control;
  if (phase === 0) {
    control = '<text x="440" y="333" text-anchor="middle" font-family="Consolas, monospace" font-size="21" fill="#365eaf">scene() → objects + timeline → JSON</text>';
  } else if (phase === 3) {
    control = ["Web player", "SVG", "GIF", "MP4"].map((label, i) => `<rect x="${144 + i * 154}" y="309" width="130" height="38" rx="19" fill="${i === 0 ? "#243b35" : "#e9eee6"}"/><text x="${209 + i * 154}" y="334" text-anchor="middle" font-size="17" fill="${i === 0 ? "#ffffff" : "#42634c"}">${label}</text>`).join("");
  } else {
    control = `<rect x="68" y="311" width="744" height="5" rx="2.5" fill="#e0e6dc"/><rect x="68" y="311" width="${744 * time / duration}" height="5" rx="2.5" fill="#588f67"/><circle cx="${68 + 744 * time / duration}" cy="313.5" r="7" fill="#243b35"/><text x="68" y="346" font-size="14" fill="#76837a">0 ms</text><text x="440" y="346" text-anchor="middle" font-size="18" font-family="Consolas, monospace" fill="#365eaf">${phase === 1 ? "play()" : `evaluate(scene, ${Math.round(time)})`}</text><text x="812" y="346" text-anchor="end" font-size="14" fill="#76837a">${duration} ms</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 430" role="img" aria-label="${xml(titles[phase])}"><rect width="880" height="430" rx="20" fill="#fcfbf7"/><g font-family="Arial, sans-serif" fill="#243b35"><text x="36" y="49" font-size="31" font-weight="700">${titles[phase]}</text><text x="36" y="80" font-size="19" fill="#6b7a70">${captions[phase]}</text>${diagram}${control}<path d="M 36 374 H 844" stroke="#e3e6df"/>${steps}</g></svg>`;
}
