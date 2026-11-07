import { mountPlayer } from "../../packages/player/dist/index.js";

const el = id => document.getElementById(id);
const $ = Object.fromEntries([
  "catalog", "source", "status", "errors", "preview", "scrubber", "play", "restart",
  "time-label", "duration-label", "dimensions", "format", "download-json", "download-svg",
  "open-file", "file-input", "speed", "markers", "previous-step", "next-step",
].map(id => [id, el(id)]));
let player, markers = [], markerIndex = -1, markerTime = null, debounce, compileSeq = 0, sampleSeq = 0, pendingCompile;

function download(filename, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
function status(message, ok) {
  $.status.textContent = message;
  $.status.className = ok ? "good" : "bad";
}
function sync() {
  const time = player?.getTime() ?? 0;
  $.scrubber.value = String(time);
  $["time-label"].textContent = (time / 1000).toFixed(2) + "s";
  const playing = player?.isPlaying() ?? false;
  $.play.textContent = playing ? "❚❚ Pause" : "▶ Play";
  $.play.setAttribute("aria-label", playing ? "Pause animation" : "Play animation");
  $.play.setAttribute("aria-pressed", String(playing));
  // Retain an explicitly selected marker when several annotations share a time.
  if (markerTime === null || Math.abs(markerTime - time) > 0.001) {
    markerIndex = markers.findLastIndex(marker => marker.time <= time + 0.001);
  }
  markerTime = time;
  $.markers.value = markerIndex < 0 ? "" : String(markerIndex);
}
function controls(enabled) {
  for (const id of ["play", "restart", "scrubber", "speed", "download-svg"]) $[id].disabled = !enabled;
  for (const id of ["markers", "previous-step", "next-step"]) $[id].disabled = !enabled || markers.length === 0;
}
function pause() { player?.pause(); sync(); }
function invalidate() {
  clearTimeout(debounce);
  pendingCompile?.abort();
  ++compileSeq;
  pause(); controls(false);
}
function clearPreview() {
  player?.destroy(); player = undefined; markers = []; markerIndex = -1; markerTime = null;
  $.preview.replaceChildren(Object.assign(document.createElement("div"), {
    className: "placeholder", textContent: "Fix the scene to resume preview",
  }));
  $.markers.replaceChildren(new Option("No steps", ""));
  $.scrubber.max = "10";
  $["duration-label"].textContent = "0.00s";
  $.dimensions.textContent = "—";
  sync(); controls(false);
}
async function compileScene(reset = false) {
  invalidate();
  const seq = compileSeq;
  const time = reset ? 0 : player?.getTime() ?? 0;
  pendingCompile = new AbortController();
  $.status.textContent = "Compiling…"; $.status.className = "";
  try {
    const res = await fetch("/api/compile", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: $.source.value }), signal: pendingCompile.signal,
    });
    const result = await res.json();
    if (seq !== compileSeq) return;
    if (!res.ok || result.error) throw Error(result.error ?? "Unexpected HTTP " + res.status);
    if (!result.ok) {
      clearPreview();
      status(result.diagnostics.length + " issue(s)", false);
      $.errors.textContent = result.diagnostics.slice(0, 8)
        .map(d => d.code + " · " + d.path + "\n" + d.message).join("\n\n");
      return;
    }
    player?.destroy();
    $.preview.replaceChildren();
    markers = [...(result.scene.markers ?? [])].sort((a, b) => a.time - b.time);
    markerIndex = -1; markerTime = null;
    $.markers.replaceChildren(new Option(markers.length ? "Before first step" : "No steps", ""));
    markers.forEach((marker, index) => $.markers.add(new Option(
      (marker.time / 1000).toFixed(2) + "s · " + marker.label, String(index),
    )));
    player = mountPlayer($.preview, result.scene, {
      speed: Number($.speed.value), onFrame: sync,
    });
    $.scrubber.max = String(Math.max(10, result.durationMs));
    $["duration-label"].textContent = (result.durationMs / 1000).toFixed(2) + "s";
    $.dimensions.textContent = $.preview.querySelector("svg")?.getAttribute("viewBox") ?? "Rendered SVG";
    player.seek(time);
    controls(true);
    // A still scene remains exportable and seekable, but has nothing to play.
    $.play.disabled = result.durationMs === 0;
    status("Valid scene", true); $.errors.textContent = "No validation errors.";
  } catch (error) {
    if (seq !== compileSeq || error.name === "AbortError") return;
    clearPreview(); status("Compile failed", false); $.errors.textContent = error.message;
  }
}
function schedule() {
  invalidate();
  $.status.textContent = "Waiting for edits…"; $.status.className = "";
  debounce = setTimeout(() => compileScene(), 180);
}
async function sample(id) {
  const seq = ++sampleSeq;
  invalidate();
  $.status.textContent = "Loading example…"; $.status.className = "";
  try {
    const res = await fetch("/api/example?id=" + encodeURIComponent(id));
    const json = await res.json();
    if (seq !== sampleSeq) return;
    if (!res.ok) throw Error(json.error ?? "Could not load example");
    $.source.value = json.source;
    await compileScene(true);
  } catch (error) {
    if (seq !== sampleSeq) return;
    clearPreview(); status("Load failed", false); $.errors.textContent = error.message;
  }
}
async function init() {
  controls(false);
  const res = await fetch("/api/catalog");
  if (!res.ok) throw Error("Could not load example list");
  const catalog = await res.json();
  for (const item of catalog) $.catalog.add(new Option(item.category.toUpperCase() + " / " + item.title, item.id));
  $.catalog.value = catalog.find(x => x.id === "merge-sort-motion")?.id ?? catalog[0].id;
  await sample($.catalog.value);
}
$.catalog.addEventListener("change", () => sample($.catalog.value));
$.source.addEventListener("input", () => { ++sampleSeq; schedule(); });
$.scrubber.addEventListener("input", () => { const time = Number($.scrubber.value); pause(); player?.seek(time); });
$.speed.addEventListener("change", () => player?.setSpeed(Number($.speed.value)));
$.markers.addEventListener("change", () => {
  const selected = $.markers.value === "" ? -1 : Number($.markers.value);
  pause(); markerIndex = selected; markerTime = selected < 0 ? 0 : markers[selected].time; player?.seek(markerTime);
});
$["previous-step"].addEventListener("click", () => {
  pause();
  const betweenSteps = markerIndex >= 0 && player.getTime() > markers[markerIndex].time + 0.001;
  markerIndex = betweenSteps ? markerIndex : Math.max(-1, markerIndex - 1);
  markerTime = markerIndex < 0 ? 0 : markers[markerIndex].time;
  player?.seek(markerTime);
});
$["next-step"].addEventListener("click", () => {
  pause();
  if (markerIndex + 1 < markers.length) { markerTime = markers[++markerIndex].time; player?.seek(markerTime); }
  else player?.seek(player.getDuration());
});
$.format.addEventListener("click", () => {
  try { ++sampleSeq; $.source.value = JSON.stringify(JSON.parse($.source.value), null, 2); schedule(); }
  catch (error) { invalidate(); clearPreview(); status("Invalid JSON", false); $.errors.textContent = error.message; }
});
$["open-file"].addEventListener("click", () => $["file-input"].click());
$["file-input"].addEventListener("change", async () => {
  const file = $["file-input"].files?.[0];
  if (!file) return;
  const seq = ++sampleSeq;
  invalidate();
  if (file.size > 2_000_000) { clearPreview(); status("File exceeds 2 MB", false); return; }
  try {
    const source = await file.text();
    if (seq !== sampleSeq) return;
    $.source.value = source;
    await compileScene(true);
  } catch (error) {
    if (seq !== sampleSeq) return;
    clearPreview(); status("Import failed", false); $.errors.textContent = error.message;
  } finally { $["file-input"].value = ""; }
});
$["download-json"].addEventListener("click", () => download("anim8-scene.json", $.source.value, "application/json"));
$["download-svg"].addEventListener("click", () => {
  const svg = $.preview.querySelector("svg");
  if (svg) download("anim8-frame.svg", new XMLSerializer().serializeToString(svg), "image/svg+xml");
});
$.restart.addEventListener("click", () => player?.restart());
$.play.addEventListener("click", () => {
  if (!player) return;
  if (player.isPlaying()) pause();
  else {
    if (player.getTime() >= player.getDuration()) player.restart();
    player.play(); sync();
  }
});
document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault(); void compileScene();
  }
});
window.addEventListener("pagehide", () => { invalidate(); player?.destroy(); });
window.addEventListener("pageshow", event => { if (event.persisted) void compileScene(); });
init().catch(error => { clearPreview(); status("Could not start playground", false); $.errors.textContent = error.message; });
