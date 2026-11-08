import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { evaluate, lintDesign, validateScene } from "../../packages/core/dist/index.js";
import { readQuickstart } from "../../docs/media/quickstart.mjs";
import { createIntroScene } from "../../docs/media/intro.mjs";

const root = new URL("../../", import.meta.url);
const readme = readFileSync(new URL("README.md", root), "utf8").replace(/\r/g, "");
const anchors = new Set([...readme.matchAll(/^#{1,6} (.+)$/gm)].map(match => match[1].toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-")));
for (const match of readme.matchAll(/<a id="([^"]+)"/g)) anchors.add(match[1]);
for (const match of readme.matchAll(/\]\(#([^)]+)\)/g)) assert.ok(anchors.has(match[1]), `Broken README section link: ${match[1]}`);
for (const match of readme.matchAll(/href="#([^"]+)"/g)) assert.ok(anchors.has(match[1]), `Broken README navigation: ${match[1]}`);
for (const match of readme.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
  if (!match[1].includes(":")) assert.ok(existsSync(new URL(match[1], root)), `Broken README link: ${match[1]}`);
}
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(readFileSync(new URL("docs/media/manifest.json", root), "utf8"));
assert.equal(manifest.length, 7);
for (const entry of manifest) {
  assert.ok(readme.includes(`(docs/media/${entry.file})`), `${entry.file}: preview must remain discoverable in the README`);
  const bytes = readFileSync(new URL(`docs/media/${entry.file}`, root));
  assert.equal(digest(bytes), entry.sha256, `${entry.file}: media checksum`);
  assert.equal(digest(readFileSync(new URL(entry.source, root))), entry.sourceSha256, `${entry.file}: scene changed; regenerate README media`);
  if (entry.recipe) assert.equal(digest(readFileSync(new URL(entry.recipe, root))), entry.recipeSha256, `${entry.file}: walkthrough changed; regenerate README media`);
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
const document = readQuickstart();
assert.deepEqual(JSON.parse(readFileSync(new URL("docs/media/quickstart.scene.json", root), "utf8")), document, "Authoring preview must use the exact README example");
assert.deepEqual(validateScene(document), []);
assert.deepEqual(lintDesign(evaluate(document, 1300)), []);
assert.equal(document.markers.length, 2);
const intro = createIntroScene();
assert.deepEqual(JSON.parse(readFileSync(new URL("docs/media/intro.scene.json", root), "utf8")), intro, "Opening animation must match its authoring source");
assert.deepEqual(validateScene(intro), []);
assert.deepEqual(lintDesign(evaluate(intro, 0)), []);
assert.deepEqual(lintDesign(evaluate(intro, 2600)), []);
console.log(`PASS README: local links, ${manifest.length} animated GIFs with source checksums, and executable authoring example`);
