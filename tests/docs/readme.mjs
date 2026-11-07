import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { scene } from "../../packages/authoring/dist/index.js";
import { DIAGRAM_TONES, evaluate, lintDesign, validateScene } from "../../packages/core/dist/index.js";

const root = new URL("../../", import.meta.url);
const readme = readFileSync(new URL("README.md", root), "utf8").replace(/\r/g, "");
for (const match of readme.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
  if (!match[1].includes(":")) assert.ok(existsSync(new URL(match[1], root)), `Broken README link: ${match[1]}`);
}
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(readFileSync(new URL("docs/media/manifest.json", root), "utf8"));
assert.equal(manifest.length, 5);
for (const entry of manifest) {
  const bytes = readFileSync(new URL(`docs/media/${entry.file}`, root));
  assert.equal(digest(bytes), entry.sha256, `${entry.file}: media checksum`);
  assert.equal(digest(readFileSync(new URL(entry.source, root))), entry.sourceSha256, `${entry.file}: scene changed; regenerate README media`);
  assert.match(bytes.toString("ascii", 0, 6), /^GIF8[79]a$/);
  assert.equal(bytes.readUInt16LE(6), entry.width);
  assert.equal(bytes.readUInt16LE(8), entry.height);
  let offset = 13, frames = 0;
  if (bytes[10] & 0x80) offset += 3 * 2 ** ((bytes[10] & 7) + 1);
  const blocks = () => { while (bytes[offset]) { offset += 1 + bytes[offset]; assert.ok(offset < bytes.length); } offset++; };
  while (bytes[offset] !== 0x3b) {
    const marker = bytes[offset++];
    if (marker === 0x21) { offset++; blocks(); }
    else if (marker === 0x2c) {
      const packed = bytes[offset + 8]; offset += 9;
      if (packed & 0x80) offset += 3 * 2 ** ((packed & 7) + 1);
      offset++; blocks(); frames++;
    } else assert.fail(`${entry.file}: unexpected GIF block at ${offset - 1}`);
  }
  assert.equal(frames, entry.frames);
  assert.ok(frames > 1, `${entry.file}: preview must animate`);
}
const snippet = readme.match(/```ts\n([\s\S]*?)\n```/)[1].replace(/^import .*;\n/gm, "").split("const player =")[0];
const document = new Function("scene", "DIAGRAM_TONES", snippet + "\nreturn s.toJSON();")(scene, DIAGRAM_TONES);
assert.deepEqual(validateScene(document), []);
assert.deepEqual(lintDesign(evaluate(document, 1300)), []);
assert.equal(document.markers.length, 2);
console.log(`PASS README: local links, ${manifest.length} animated GIFs with source checksums, and executable authoring example`);
