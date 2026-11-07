import assert from "node:assert/strict";
import { test } from "node:test";
import { runtimeCoverage } from "./runtime-coverage.mjs";

const entries = sources => new Map(Object.entries(sources).map(([name, text]) => [name, { data: Buffer.from(text) }]));
test("follows shared chunks, reexports, lazy font imports and cycles from public roots", () => {
  const files = entries({
    "dist/index.js": 'export { render } from "./shared.js";',
    "dist/live.js": 'import "./shared.js"; const font = () => import("./font.js");',
    "dist/shared.js": 'import "./live.js"; export const render = 1;',
    "dist/font.js": 'export default require("./font-data.cjs");',
    "dist/font-data.cjs": 'module.exports = "font";',
    "dist/orphan.js": 'export default 1;',
  });
  const result = runtimeCoverage(files, new Set(["dist/index.js", "dist/live.js"]));
  assert.deepEqual([...result.reachable].sort(), [...files.keys()].filter(name => !name.includes("orphan")).sort());
  assert.deepEqual(result.missing, []);
});
test("ignores comments and ordinary strings; reports missing and escaping dependencies", () => {
  const result = runtimeCoverage(entries({ "dist/index.js": `
    // import "./orphan.js";
    const example = 'import("./orphan.js")';
    import './missing.js';
    export { x } from '../../outside.js';
    import 'external-package';
  `, "dist/orphan.js": "" }), new Set(["dist/index.js"]));
  assert.deepEqual([...result.reachable], ["dist/index.js"]);
  assert.deepEqual(result.missing, [
    { from: "dist/index.js", target: "dist/missing.js" },
    { from: "dist/index.js", target: "../outside.js" },
  ]);
});
