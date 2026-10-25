import assert from "node:assert/strict";
import { scene } from "@anim8/authoring";
import { serviceBadge } from "./service-badge.mjs";

const builder = scene({ width: 480, height: 240 });
const badge = serviceBadge(builder, "Worker", { id: "worker", x: 200, y: 120 });
builder.sequence(badge.group.moveTo({ x: 260, y: 120 }, { duration: 300 }));
const document = builder.toJSON();

assert.equal(document.objects.filter(object => object.parentId === "worker").length, 2);
assert.equal(document.objects.find(object => object.id === "worker")?.type, "group");
assert.equal(document.timeline[0]?.target, "worker");
console.log("PASS custom-authoring-extension");
