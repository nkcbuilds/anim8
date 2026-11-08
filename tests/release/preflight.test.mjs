import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const version = JSON.parse(readFileSync(new URL("../../packages/core/package.json", import.meta.url), "utf8")).version;

function run(script, args, tag) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
    env: { ...process.env, ANIM8_RELEASE_TAG: tag, NPM_TOKEN: "" },
  });
}

test("matching release metadata is accepted", () => {
  const result = run("tests/release/check-version.mjs", [], `v${version}`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("a tag that disagrees with package versions is rejected", () => {
  const result = run("tests/release/check-version.mjs", [], "v999.999.999");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match package version/);
});

test("built-package dry runs work without publishing credentials", () => {
  const result = run("tests/release/preflight.mjs", [], "");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Dry-run; no npm auth or publication attempted/);
});

test("publishing without npm credentials is rejected", () => {
  const result = run("tests/release/preflight.mjs", ["--publish"], `v${version}`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /NPM_TOKEN secret not configured/);
});

test("untagged publishing is rejected", () => {
  const result = run("tests/release/preflight.mjs", ["--publish"], "");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Publishing requires explicit version tag/);
});
