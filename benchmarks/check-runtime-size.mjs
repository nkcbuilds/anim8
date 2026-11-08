import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const entryPoint = resolve(root, "benchmarks/standard-runtime.ts");
const result = await build({
  absWorkingDir: root,
  entryPoints: [entryPoint],
  // Resolve each public entry through its own package exports. The workspace
  // root does not depend on these packages; pnpm's CLI shim otherwise supplies
  // extra resolution paths which are absent when calling esbuild's JS API.
  alias: Object.fromEntries(["core", "renderer-svg", "player"].map(directory => {
    const packageRoot = resolve(root, `packages/${directory}`);
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
    return [manifest.name, resolve(packageRoot, manifest.exports["."].import)];
  })),
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  splitting: true,
  outdir: resolve(root, ".bench/standard-runtime"),
  metafile: true,
  write: false,
});
const outputs = result.metafile.outputs;
const files = new Map(result.outputFiles.map(file => [file.path, file.contents]));
const entry = Object.keys(outputs).find(name => outputs[name].entryPoint && resolve(root, outputs[name].entryPoint) === entryPoint);
assert.ok(entry, "Missing standard runtime entry output");

// Count every statically imported chunk, once. Lazy font bytes are reported
// separately: they are requested when a sketch player first needs text.
const eager = new Set([entry]);
const queue = [entry];
for (let i = 0; i < queue.length; i++) {
  for (const dependency of outputs[queue[i]].imports) {
    if (dependency.kind === "dynamic-import") continue;
    assert.ok(!dependency.external, `Unmeasured external dependency: ${dependency.path}`);
    assert.ok(outputs[dependency.path], `Missing output: ${dependency.path}`);
    if (!eager.has(dependency.path)) { eager.add(dependency.path); queue.push(dependency.path); }
  }
}
const compressed = name => gzipSync(files.get(resolve(root, name)), { level: 9 }).length;
const sum = names => [...names].reduce((total, name) => total + compressed(name), 0);
const eagerGzipBytes = sum(eager);
const lazy = Object.keys(outputs).filter(name => !eager.has(name));
console.log(JSON.stringify({ eagerGzipBytes, lazyGzipBytes: sum(lazy), totalGzipBytes: sum(Object.keys(outputs)), limit: 35840 }, null, 2));
assert.ok(eagerGzipBytes <= 35840, `Standard runtime exceeds the 35 KiB startup budget: ${eagerGzipBytes} bytes`);
