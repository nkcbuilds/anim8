import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Anim8Player } from "@anim8/react";
import { scene } from "../shared/scene.mjs";

const adapterResolution = new URL(import.meta.resolve("@anim8/react")).pathname;
const reactResolution = new URL(import.meta.resolve("react")).pathname;
const reactDomResolution = new URL(import.meta.resolve("react-dom/server")).pathname;
assert.match(adapterResolution, /\/tests\/consumers\/\.runtime\/node_modules\/@anim8\/react\/dist\/index\.js$/);
assert.match(reactResolution, /\/tests\/consumers\/\.runtime\/node_modules\/react\//);
assert.match(reactDomResolution, /\/tests\/consumers\/\.runtime\/node_modules\/react-dom\//);

assert.equal(typeof globalThis.window, "undefined");
assert.equal(typeof globalThis.document, "undefined");

const html = renderToStaticMarkup(
  createElement(Anim8Player, {
    scene,
    initialTime: 1000,
    className: "consumer-react",
    "aria-label": "Consumer animation",
  }),
);

assert.match(html, /class="consumer-react"/);
assert.match(html, /aria-label="Consumer animation"/);
assert.match(html, /data-anim8-player=""/);
assert.match(html, /<svg\b/);
assert.match(html, /data-anim8-id="box"/);
assert.match(html, /matrix\(1 0 0 1 140 60\)/);

console.log("PASS react-ssr");
