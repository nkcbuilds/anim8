import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Built public compiler entrypoint. In an installed app this is:
//   import { compileJson } from "@anim8/compiler";
import { compileJson } from "../../packages/compiler/dist/index.js";

const source = await readFile(new URL("./scene.json", import.meta.url), "utf8");
const result = compileJson(source);

assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
assert.ok(result.scene);

// compileJson currently validates these authored fields but does not preserve
// markers in its normalized output, so semantic assertions intentionally use
// the source document. The compiler result above remains the validity gate.
const authored = JSON.parse(source);
const byId = new Map(authored.objects.map((object) => [object.id, object]));
const connectors = authored.objects.filter((object) => object.type === "connector");
const followPaths = authored.timeline.filter((action) => action.type === "followPath");
const apiMoves = authored.timeline.filter(
  (action) => action.type === "move" && action.target === "api",
);

assert.deepEqual(
  authored.markers?.map((marker) => marker.label),
  [
    "Request leaves client",
    "API rearranges for work",
    "Query travels to database",
    "Rows return to API",
    "API restores architecture",
    "Rows reach client",
    "Client receives result",
  ],
);

assert.equal(followPaths.length, 4);
assert.ok(followPaths.every((action) => action.easing === "spring"));
assert.ok(followPaths.some((action) => action.target === "request"));
assert.ok(followPaths.some((action) => action.target === "query"));
assert.equal(followPaths.filter((action) => action.target === "rows").length, 2);

assert.equal(connectors.length, 2);
assert.deepEqual(
  connectors.map((connector) => [
    connector.from.objectId,
    connector.to.objectId,
  ]),
  [
    ["client", "api__body"],
    ["api__body", "database__body"],
  ],
);

// The connector attaches to a real child shape of the API preset. That child
// remains parented to the moving group, so world-space connector geometry
// follows the server rearrangement.
assert.equal(byId.get("api__body")?.parentId, "api");

assert.equal(apiMoves.length, 2);
assert.ok(apiMoves.every((action) => action.easing === "spring"));
assert.deepEqual(apiMoves.map((action) => action.to), [
  { x: 460, y: 170 },
  { x: 460, y: 270 },
]);

console.log("PASS architecture-flow public API example");
