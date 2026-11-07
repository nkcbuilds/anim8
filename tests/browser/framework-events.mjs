import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createApp, defineComponent, h, nextTick, shallowRef } from "vue";
import { Anim8Player as ReactPlayer, useAnim8Player as useReactPlayer } from "../../packages/react/dist/index.js";
import { Anim8Player as VuePlayer, useAnim8Player as useVuePlayer } from "../../packages/vue/dist/index.js";
import { hydrationScene as scene } from "./react-hydration-scene.mjs";

const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const object = host => host.querySelector('[data-anim8-id="hydration-box"]');
const click = host => object(host).dispatchEvent(new MouseEvent("click", { bubbles: true }));
const activate = host => object(host).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

window.FRAMEWORK_EVENTS = async () => {
  const results = [];
  for (const framework of ["react", "vue"]) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const events = [];
    const handler = prefix => event => {
      if (event.type === "click" || event.type === "activate") events.push(`${prefix}:${event.type}:${event.objectId}`);
    };
    let render, destroy;
    if (framework === "react") {
      const root = createRoot(host);
      render = callback => flushSync(() => root.render(createElement(ReactPlayer, { scene, options: { onObjectEvent: callback } })));
      destroy = () => root.unmount();
    } else {
      const options = shallowRef({});
      const app = createApp(defineComponent({ setup: () => () => h(VuePlayer, { scene, options: options.value }) }));
      app.mount(host);
      render = callback => { options.value = { onObjectEvent: callback }; };
      destroy = () => app.unmount();
    }
    try {
      render(undefined); await nextTick(); await settle();
      render(handler("first")); await nextTick(); await settle();
      for (let i = 0; i < 120 && !object(host)?.hasAttribute("tabindex"); i++) await settle();
      if (!object(host)?.hasAttribute("tabindex")) throw new Error(`${framework}: object event listeners were not mounted`);
      click(host); activate(host);
      render(handler("latest")); await nextTick(); await settle();
      click(host);
      render(undefined); await nextTick(); await settle();
      click(host);
      results.push({ framework, events });
    } finally {
      destroy(); host.remove();
    }
  }
  return results;
};

window.FRAMEWORK_LIFECYCLE = async () => {
  const results = [];
  const document = { ...scene, state: { count: 0 }, interactions: [{ id: "advance", event: { type: "custom", name: "advance" }, actions: [{ type: "increment", key: "count", by: 1 }] }] };
  for (const framework of ["react", "vue"]) {
    const host = window.document.createElement("div");
    window.document.body.append(host);
    let controller, render, destroy;
    if (framework === "react") {
      const root = createRoot(host);
      function Probe({ options }) {
        const refs = useReactPlayer(document, options);
        controller = () => refs.controllerRef.current;
        return createElement("div", { ref: refs.containerRef });
      }
      render = callback => flushSync(() => root.render(createElement(Probe, { options: { onObjectEvent: callback } })));
      destroy = () => root.unmount();
      render(undefined);
    } else {
      const options = shallowRef({});
      const app = createApp(defineComponent({ setup() {
        const refs = useVuePlayer(document, options);
        controller = () => refs.controllerRef.value;
        return () => h("div", { ref: refs.containerRef });
      } }));
      app.mount(host);
      render = callback => { options.value = { onObjectEvent: callback }; };
      destroy = () => app.unmount();
    }
    try {
      for (let i = 0; i < 120 && !controller(); i++) await settle();
      const original = controller();
      original.seek(500); original.dispatch("advance");
      const stable = [];
      for (const callback of [() => {}, () => {}, undefined]) {
        render(callback); await nextTick(); await settle();
        stable.push(controller() === original && controller().getTime() === 500 && controller().getState().count === 1);
      }
      results.push({ framework, stable });
    } finally { destroy(); host.remove(); }
  }
  // Exercise the actual Vue component's innerHTML patching during scene replacement.
  for (const theme of ["clean", "sketch"]) {
    const host = window.document.createElement("div"); window.document.body.append(host);
    const current = shallowRef({ ...scene, scene: { ...scene.scene, theme } });
    let last;
    const options = { autoplay: true, loop: true, onFrame: frame => { last = frame; } };
    const app = createApp(defineComponent({ setup: () => () => h(VuePlayer, { scene: current.value, options }) }));
    app.mount(host);
    try {
      await nextTick(); await settle();
      current.value = { ...current.value, scene: { ...current.value.scene, background: "#eef2ff" }, objects: current.value.objects.map(o => ({ ...o, transform: { ...o.transform, x: 20 } })) };
      await nextTick();
      for (let i = 0; i < 6; i++) await settle();
      const visibleX = object(host).transform.baseVal.consolidate().matrix.e;
      results.push({ theme, frameTime: last.time, visibleX, frameX: last.objects[0].transform.x });
    } finally { app.unmount(); host.remove(); }
  }
  return results;
};
