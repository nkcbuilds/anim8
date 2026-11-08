import assert from "node:assert/strict";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { scene } from "@anim8/authoring";
import { layoutElk } from "@anim8/layout-elk";

const modules = join(process.cwd(), "node_modules") + sep;
for (const name of ["@anim8/authoring", "@anim8/layout-elk", "elkjs/lib/elk.bundled.js"]) {
  assert.ok(fileURLToPath(import.meta.resolve(name)).startsWith(modules), `${name} must resolve from the isolated installation`);
}
const builder = scene();
const first = builder.box("First", { id: "first", x: 100, y: 100 });
const second = builder.box("Second", { id: "second", x: 400, y: 100 });
const connection = builder.connect(first, second);
const document = builder.toJSON();
const before = structuredClone(document);
const result = await layoutElk(document, { direction: "left-right" });
assert.ok(result.positions.first.x < result.positions.second.x);
assert.ok(Number.isFinite(result.positions.first.y) && Number.isFinite(result.positions.second.y));
assert.ok(result.width > 0 && result.height > 0);
const route = result.routes[connection.id];
assert.equal(route.from, first.id);
assert.equal(route.to, second.id);
assert.ok(route.sections.length > 0);
for (const section of route.sections) {
  assert.ok(section.points.length >= 2);
  for (const point of section.points) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
}
assert.deepEqual(document, before);
console.log("PASS layout-elk-runtime-outside-workspace");
