import assert from "node:assert/strict";
import {
  Anim8PlayerElement,
  defineAnim8Player,
  mountPlayer,
} from "@anim8/player";

const playerResolution = new URL(import.meta.resolve("@anim8/player")).pathname;
assert.match(playerResolution, /\/tests\/consumers\/\.runtime\/node_modules\/@anim8\/player\/dist\/index\.js$/);

assert.equal(typeof globalThis.window, "undefined");
assert.equal(typeof globalThis.document, "undefined");
assert.equal(typeof globalThis.customElements, "undefined");

assert.equal(typeof mountPlayer, "function");
assert.equal(typeof defineAnim8Player, "function");
assert.equal(typeof Anim8PlayerElement, "function");

// This must remain a no-op rather than touching a missing CustomElementRegistry.
defineAnim8Player();

console.log("PASS ssr-node");
