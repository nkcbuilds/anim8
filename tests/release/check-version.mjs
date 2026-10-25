import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const packagesRoot = resolve(root, "packages");
const entries = await readdir(packagesRoot, { withFileTypes: true });
const manifests = [];

for (const entry of entries.filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  const path = resolve(packagesRoot, entry.name, "package.json");
  const json = JSON.parse(await readFile(path, "utf8"));
  if (json.private) continue;
  assert.match(json.name ?? "", /^@anim8\/[a-z0-9-]+$/, `${entry.name}: invalid public package name`);
  assert.match(json.version ?? "", /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, `${json.name}: invalid semver`);
  assert.equal(json.license, "MIT", `${json.name}: license must be MIT`);
  assert.ok(json.exports?.["."], `${json.name}: missing root export`);
  manifests.push({ name: json.name, version: json.version });
}

assert.ok(manifests.length > 0, "No publishable Anim8 packages found.");
const versions = new Set(manifests.map(manifest => manifest.version));
assert.equal(
  versions.size,
  1,
  `All public packages must share one release version; found ${[...versions].join(", ")}`,
);

const version = manifests[0].version;
const tag = process.env.ANIM8_RELEASE_TAG || "";
if (tag) {
  assert.equal(tag, `v${version}`, `Release tag ${tag} does not match package version ${version}.`);
}

console.log(`PASS release metadata: ${manifests.length} public packages at v${version}`);
