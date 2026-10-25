import { createElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { Anim8Player } from "../../packages/react/dist/index.js";
import { hydrationScene } from "./react-hydration-scene.mjs";

const root = document.querySelector("#react-hydration-root");
if (!(root instanceof HTMLElement)) throw new Error("Missing React hydration root.");

const beforeSvg = root.querySelector("svg");
const beforeObject = root.querySelector('[data-anim8-id="hydration-box"]');
const recoverableErrors = [];

const reactRoot = hydrateRoot(
  root,
  createElement(Anim8Player, {
    scene: hydrationScene,
    initialTime: 250,
  }),
  {
    onRecoverableError(error) {
      recoverableErrors.push(error instanceof Error ? error.message : String(error));
    },
  },
);

await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

const afterSvg = root.querySelector("svg");
const afterObject = root.querySelector('[data-anim8-id="hydration-box"]');
globalThis.__anim8HydrationResult = {
  sameSvg: beforeSvg === afterSvg,
  sameObject: beforeObject === afterObject,
  svgCount: root.querySelectorAll("svg").length,
  recoverableErrors,
  transform: afterObject?.getAttribute("transform") ?? null,
};
globalThis.__anim8HydrationReady = true;
globalThis.__anim8HydrationDestroy = () => reactRoot.unmount();
