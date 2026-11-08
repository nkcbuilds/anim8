import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);

test("workspace tsc selects the native TypeScript 7 CLI", () => {
  const version = execSync("tsc --version", { cwd: root, encoding: "utf8" }).trim();
  const native = require("@typescript/native/package.json");
  assert.match(native.version, /^7\./);
  assert.equal(version, `Version ${native.version}`);
});

test("compiler API consumers retain the supported TypeScript 6 API", () => {
  assert.match(ts.version, /^6\./);
  assert.equal(typeof ts.createProgram, "function");
  assert.equal(typeof ts.createSourceFile, "function");
  const version = execSync("tsc6 --version", { cwd: root, encoding: "utf8" }).trim();
  assert.equal(version, `Version ${ts.version}`);

  // tsup's declaration bundler and Vue must resolve the API-compatible peer.
  for (const entry of [require.resolve("tsup"), require.resolve("vue", {
    paths: [fileURLToPath(new URL("../../packages/vue/", import.meta.url))],
  })]) {
    const peer = createRequire(entry)("typescript");
    assert.equal(peer.version, ts.version);
    assert.equal(typeof peer.createProgram, "function");
  }
});

test("every package script environment selects the native TypeScript compiler", () => {
  const packages = readdirSync(join(root, "packages")).filter(name => {
    const manifest = join(root, "packages", name, "package.json");
    return existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).scripts?.typecheck;
  });
  assert.ok(process.env.npm_execpath, "Run this guard through pnpm toolchain:check");
  const output = execFileSync(process.execPath, [process.env.npm_execpath, "-r", "exec", "tsc", "--version"], {
    cwd: root, encoding: "utf8", timeout: 30_000,
  });
  const versions = [...output.matchAll(/^Version ([^\r\n]+)\r?$/gm)].map(match => match[1]);
  assert.equal(versions.length, packages.length, output);
  for (const version of versions) assert.equal(version, require("@typescript/native/package.json").version, output);
});
