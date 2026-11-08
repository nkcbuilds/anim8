import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const version = JSON.parse(readFileSync(new URL("../../packages/core/package.json", import.meta.url), "utf8")).version;

/** Run the real gate with an explicit tag and controlled credentials. */
function run(script, args, tag, { cwd = root, token = "" } = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
    env: { ...process.env, ANIM8_RELEASE_TAG: tag, NPM_TOKEN: token },
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

test("publishing rejects a matching version tag on another commit", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "anim8-release-preflight-"));
  try {
    await mkdir(join(fixture, "tests", "release"), { recursive: true });
    await cp(join(root, "tests/release/preflight.mjs"), join(fixture, "tests/release/preflight.mjs"));
    for (const entry of await readdir(join(root, "packages"), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const source = join(root, "packages", entry.name);
      const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
      if (manifest.private) continue;
      const target = join(fixture, "packages", entry.name);
      await mkdir(target, { recursive: true });
      for (const file of ["package.json", "README.md", "LICENSE", "dist"]) {
        await cp(join(source, file), join(target, file), { recursive: true });
      }
    }
    const git = (...args) => {
      const result = spawnSync("git", ["-c", `core.hooksPath=${join(fixture, "no-hooks")}`,
        "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "user.name=Anim8 test",
        "-c", "user.email=anim8@example.invalid", ...args], {
        cwd: fixture, encoding: "utf8", timeout: 30_000, windowsHide: true,
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    };
    git("init", "--quiet");
    git("commit", "--allow-empty", "-m", "tagged commit");
    git("tag", `v${version}`);
    git("commit", "--allow-empty", "-m", "different HEAD");
    const options = { cwd: fixture, token: "dummy-preflight-test-token" };
    const rejected = run("tests/release/preflight.mjs", ["--publish"], `v${version}`, options);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /Release tag must refer to checked-out commit/);
    git("tag", "--force", `v${version}`);
    const accepted = run("tests/release/preflight.mjs", ["--publish"], `v${version}`, options);
    assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
    assert.match(accepted.stdout, /Publishing environment OK/);
    git("tag", "--force", "--annotate", `v${version}`, "--message", "Qualified release");
    const annotated = run("tests/release/preflight.mjs", ["--publish"], `v${version}`, options);
    assert.equal(annotated.status, 0, annotated.stdout + annotated.stderr);
    git("tag", "--delete", `v${version}`);
    const missing = run("tests/release/preflight.mjs", ["--publish"], `v${version}`, options);
    assert.notEqual(missing.status, 0, "A missing release tag must not pass publication preflight");
  } finally {
    const target = resolve(fixture);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith("anim8-release-preflight-"));
    await rm(target, { recursive: true, force: true });
  }
});
