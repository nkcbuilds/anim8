/** Require real encoders; inspect and decode every exported frame. No mocks/skips. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileJson } from "../../packages/compiler/dist/index.js";
import { exportVideo } from "../../packages/export/dist/index.js";

const source = await readFile("examples/catalog/computing/binary-search/scene.json", "utf8");
const compiled = compileJson(source);
assert.ok(compiled.ok, "Media fixture must compile");
const directory = await mkdtemp(join(tmpdir(), "anim8-media-"));
const digest = async path => createHash("sha256").update(await readFile(path)).digest("hex");
try {
  for (const format of ["mp4", "gif"]) {
    const output = join(directory, "animation." + format);
    const result = await exportVideo(compiled.scene, output, { fps: 10, durationMs: 500 });
    const metadata = JSON.parse(execFileSync("ffprobe", [
      "-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", output,
    ], { encoding: "utf8", timeout: 30_000 }));
    const stream = metadata.streams.find(s => s.codec_type === "video");
    assert.ok(stream, format + " must contain video");
    assert.equal(stream.codec_name, format === "mp4" ? "h264" : "gif");
    assert.equal(stream.width, compiled.scene.scene.width);
    assert.equal(stream.height, compiled.scene.scene.height);
    assert.equal(Number(stream.nb_read_frames), result.frames, format + " must retain every frame");
    const duration = Number(metadata.format.duration);
    assert.ok(duration >= 0.5 && duration <= 1, "Unexpected output duration: " + duration);
    execFileSync("ffmpeg", ["-v", "error", "-xerror", "-i", output, "-f", "null", "-"], { timeout: 30_000 });
    const original = await digest(output);
    await assert.rejects(exportVideo(compiled.scene, output, { fps: 10, durationMs: 0 }), { code: "EEXIST" });
    assert.equal(await digest(output), original, "Existing media must remain unchanged");
    assert.deepEqual((await readdir(directory)).filter(name => name.startsWith(".anim8-export-")), [], "Exporter must remove staging files");
    console.log(JSON.stringify({ ok: true, format, codec: stream.codec_name, frames: result.frames, width: stream.width, height: stream.height, durationSeconds: duration }));
  }
} finally { await rm(directory, { recursive: true, force: true }); }
