import {
  defaultStyle,
  defaultTransform,
  evaluate,
} from "@anim8/core";
import { mountSvg, renderSceneAt } from "@anim8/renderer-svg";
import { defineAnim8Player, mountPlayer, renderSceneMarkup } from "@anim8/player";
import { defineAnim8WebComponent } from "/packages/web-component/dist/index.js";

const root = document.querySelector("#fixture-root");

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitAnimationFrames(count = 3) {
  return new Promise(resolve => {
    let remaining = count;
    const step = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function host(id) {
  const element = document.createElement("div");
  element.id = id;
  element.className = "host";
  root.appendChild(element);
  return element;
}

function reset() {
  root.replaceChildren();
}

function rect(id, x, y, text = id, z = 1) {
  return {
    id,
    type: "rect",
    width: 80,
    height: 44,
    text,
    transform: { ...defaultTransform(), x, y },
    style: {
      ...defaultStyle(),
      fill: "#e2e8f0",
      stroke: "#0f172a",
      strokeWidth: 2,
      color: "#0f172a",
    },
    visible: true,
    z,
  };
}

function circle(id, x, y, z = 1) {
  return {
    id,
    type: "circle",
    radius: 22,
    transform: { ...defaultTransform(), x, y },
    style: {
      ...defaultStyle(),
      fill: "#c7d2fe",
      stroke: "#312e81",
      strokeWidth: 2,
    },
    visible: true,
    z,
  };
}

function motionScene() {
  return {
    version: "1.0",
    scene: { width: 480, height: 270, background: "#f8fafc" },
    objects: [
      rect("a", 90, 135, "A", 1),
      rect("b", 390, 135, "B", 2),
      {
        id: "edge",
        type: "connector",
        from: { objectId: "a", anchor: "right" },
        to: { objectId: "b", anchor: "left" },
        kind: "orthogonal",
        transform: defaultTransform(),
        style: { ...defaultStyle(), fill: "none", stroke: "#475569", strokeWidth: 3 },
        visible: true,
        z: 0,
      },
    ],
    timeline: [
      {
        id: "move-a",
        type: "move",
        target: "a",
        start: 0,
        duration: 1000,
        easing: "linear",
        to: { x: 250, y: 80 },
      },
    ],
  };
}

function screenshotScene() {
  return {
    version: "1.0",
    scene: { width: 480, height: 270, background: "#ffffff" },
    objects: [
      {
        id: "panel",
        type: "rect",
        width: 180,
        height: 90,
        transform: { ...defaultTransform(), x: 130, y: 135 },
        style: { ...defaultStyle(), fill: "#dbeafe", stroke: "#1e3a8a", strokeWidth: 4, radius: 14 },
        visible: true,
        z: 1,
      },
      circle("dot", 340, 135, 2),
      {
        id: "link",
        type: "connector",
        from: { objectId: "panel", anchor: "right" },
        to: { objectId: "dot", anchor: "left" },
        kind: "straight",
        transform: defaultTransform(),
        style: { ...defaultStyle(), fill: "none", stroke: "#334155", strokeWidth: 3 },
        visible: true,
        z: 0,
      },
      {
        id: "triangle",
        type: "polygon",
        points: [{ x: 0, y: -22 }, { x: 22, y: 18 }, { x: -22, y: 18 }],
        transform: { ...defaultTransform(), x: 340, y: 65 },
        style: { ...defaultStyle(), fill: "#fde68a", stroke: "#92400e", strokeWidth: 3 },
        visible: true,
        z: 3,
      },
    ],
    timeline: [],
  };
}

async function svgIdentity() {
  reset();
  const container = host("identity-host");
  const scene = motionScene();
  const mount = mountSvg(container, evaluate(scene, 0));
  const before = container.querySelector('[data-anim8-id="a"]');
  const beforeTransform = before?.getAttribute("transform");
  before?.setAttribute("data-browser-sentinel", "same-node");

  mount.update(evaluate(scene, 500));

  const after = container.querySelector('[data-anim8-id="a"]');
  const result = {
    sameNode: before === after,
    sentinel: after?.getAttribute("data-browser-sentinel"),
    beforeTransform,
    afterTransform: after?.getAttribute("transform"),
    svgCount: container.querySelectorAll("svg").length,
  };
  mount.destroy();
  return result;
}

async function playerControls() {
  reset();
  const container = host("player-host");
  const controller = mountPlayer(container, motionScene());

  controller.seek(500);
  const seekTime = controller.getTime();
  const seekTransform = container.querySelector('[data-anim8-id="a"]')?.getAttribute("transform");

  controller.play();
  await waitAnimationFrames(4);
  controller.pause();
  const afterPlay = controller.getTime();
  const playingAfterPause = controller.isPlaying();

  await sleep(60);
  const afterPauseWait = controller.getTime();

  controller.seek(900);
  controller.reverse();
  await waitAnimationFrames(4);
  controller.pause();
  const afterReverse = controller.getTime();

  controller.destroy();
  return {
    seekTime,
    seekTransform,
    afterPlay,
    playingAfterPause,
    afterPauseWait,
    afterReverse,
  };
}

async function dynamicConnector() {
  reset();
  const container = host("connector-host");
  const scene = motionScene();
  const mount = mountSvg(container, evaluate(scene, 0));
  const connector = container.querySelector('[data-anim8-id="edge"]');
  const before = connector?.getAttribute("d");

  mount.update(evaluate(scene, 1000));

  const afterElement = container.querySelector('[data-anim8-id="edge"]');
  const result = {
    sameNode: connector === afterElement,
    before,
    after: afterElement?.getAttribute("d"),
    movedTransform: container.querySelector('[data-anim8-id="a"]')?.getAttribute("transform"),
  };
  mount.destroy();
  return result;
}

function routedScene() {
  return {
    version: "1.0",
    scene: { width: 480, height: 270, background: "#ffffff" },
    objects: [
      rect("route-a", 70, 135, "A", 1),
      rect("route-block", 240, 135, "Obstacle", 1),
      rect("route-b", 410, 135, "B", 1),
      {
        id: "route-edge",
        type: "connector",
        from: { objectId: "route-a", anchor: "right" },
        to: { objectId: "route-b", anchor: "left" },
        kind: "routed",
        routing: { clearance: 12, bendPenalty: 8 },
        transform: defaultTransform(),
        style: { ...defaultStyle(), fill: "none", stroke: "#334155", strokeWidth: 3 },
        visible: true,
        z: 0,
      },
    ],
    timeline: [
      {
        id: "move-obstacle",
        type: "move",
        target: "route-block",
        start: 0,
        duration: 1000,
        easing: "linear",
        to: { x: 240, y: 235 },
      },
    ],
  };
}

async function routedConnector() {
  reset();
  const container = host("routed-connector-host");
  const scene = routedScene();
  const mount = mountSvg(container, evaluate(scene, 0));
  const edge = container.querySelector('[data-anim8-id="route-edge"]');
  const before = edge?.getAttribute("d");

  mount.update(evaluate(scene, 1000));

  const afterEdge = container.querySelector('[data-anim8-id="route-edge"]');
  const result = {
    sameNode: edge === afterEdge,
    before,
    after: afterEdge?.getAttribute("d"),
  };
  mount.destroy();
  return result;
}

async function responsiveSizing() {
  reset();
  const container = host("responsive-host");
  const mount = mountSvg(container, evaluate(motionScene(), 400));
  const svg = container.querySelector("svg");
  const before = svg?.getBoundingClientRect();
  const viewBoxBefore = svg?.getAttribute("viewBox");

  container.style.width = "320px";
  container.style.height = "180px";
  await waitAnimationFrames(2);

  const after = svg?.getBoundingClientRect();
  const viewBoxAfter = svg?.getAttribute("viewBox");
  const result = {
    beforeWidth: Math.round(before?.width ?? 0),
    beforeHeight: Math.round(before?.height ?? 0),
    afterWidth: Math.round(after?.width ?? 0),
    afterHeight: Math.round(after?.height ?? 0),
    viewBoxBefore,
    viewBoxAfter,
  };
  mount.destroy();
  return result;
}

async function staticFallback() {
  reset();
  const container = host("static-fallback-host");
  container.innerHTML = renderSceneAt(motionScene(), 500);
  const svg = container.querySelector("svg");
  const object = container.querySelector('[data-anim8-id="a"]');
  return {
    svgCount: container.querySelectorAll("svg").length,
    viewBox: svg?.getAttribute("viewBox"),
    transform: object?.getAttribute("transform"),
    scriptCount: container.querySelectorAll("script").length,
  };
}

async function hiddenTabPolicy() {
  reset();
  const container = host("hidden-tab-host");
  const controller = mountPlayer(container, motionScene(), { autoplay: false });

  let hidden = false;
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => hidden ? "hidden" : "visible",
  });

  try {
    controller.seek(250);
    controller.play();
    await new Promise(resolve => setTimeout(resolve, 80));
    const beforeHide = controller.getTime();

    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    const atHide = controller.getTime();
    await new Promise(resolve => setTimeout(resolve, 100));
    const whileHidden = controller.getTime();

    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise(resolve => setTimeout(resolve, 80));
    const afterResume = controller.getTime();

    return {
      beforeHide,
      atHide,
      whileHidden,
      afterResume,
      playing: controller.isPlaying(),
    };
  } finally {
    controller.destroy();
    delete document.hidden;
    delete document.visibilityState;
  }
}

async function multipleInstances() {
  reset();
  const firstHost = host("player-one");
  const secondHost = host("player-two");
  const first = mountPlayer(firstHost, motionScene());
  const second = mountPlayer(secondHost, motionScene());

  first.seek(250);
  second.seek(750);

  const firstObject = firstHost.querySelector('[data-anim8-id="a"]');
  const secondObject = secondHost.querySelector('[data-anim8-id="a"]');
  const result = {
    firstTime: first.getTime(),
    secondTime: second.getTime(),
    firstTransform: firstObject?.getAttribute("transform"),
    secondTransform: secondObject?.getAttribute("transform"),
    distinctSvg: firstHost.querySelector("svg") !== secondHost.querySelector("svg"),
    distinctObjectNode: firstObject !== secondObject,
  };

  first.destroy();
  second.destroy();
  return result;
}

async function mountUnmount() {
  reset();
  const container = host("lifecycle-host");
  const first = mountPlayer(container, motionScene());
  first.seek(400);
  const mountedChildren = container.childElementCount;
  first.destroy();
  const childrenAfterDestroy = container.childElementCount;

  const second = mountPlayer(container, motionScene());
  second.seek(600);
  const childrenAfterRemount = container.childElementCount;
  const remountTransform = container.querySelector('[data-anim8-id="a"]')?.getAttribute("transform");
  second.destroy();

  return {
    mountedChildren,
    childrenAfterDestroy,
    childrenAfterRemount,
    childrenAfterSecondDestroy: container.childElementCount,
    remountTransform,
  };
}

async function reducedMotionCustomElement() {
  reset();
  defineAnim8Player("anim8-browser-test-player");
  const player = document.createElement("anim8-browser-test-player");
  player.scene = motionScene();
  root.appendChild(player);

  await Promise.resolve();
  const object = player.querySelector('[data-anim8-id="a"]');
  const before = object?.getAttribute("transform");
  player.play();
  await sleep(100);
  const after = player.querySelector('[data-anim8-id="a"]')?.getAttribute("transform");

  player.remove();
  await Promise.resolve();

  return {
    mediaMatches: matchMedia("(prefers-reduced-motion: reduce)").matches,
    before,
    after,
    childrenAfterDisconnect: player.childElementCount,
  };
}

async function setupScreenshotFixture() {
  reset();
  const container = document.createElement("div");
  container.id = "snapshot-root";
  root.appendChild(container);
  const frame = evaluate(screenshotScene(), 0);
  const mount = mountSvg(container, frame);
  // Re-applying the exact same frame should not alter pixels or keyed nodes.
  mount.update(frame);
  return {
    width: container.getBoundingClientRect().width,
    height: container.getBoundingClientRect().height,
    objectCount: container.querySelectorAll("[data-anim8-id]").length,
  };
}

function sketchScene() {
  const scene = motionScene();
  return {
    ...scene,
    scene: { ...scene.scene, theme: "sketch", seed: 7 },
    objects: [
      ...scene.objects,
      { id: "trail", type: "path", d: "M 0 0 C 60 -40 120 40 180 0", drawProgress: 0,
        transform: { ...defaultTransform(), x: 140, y: 220 },
        style: { ...defaultStyle(), fill: "none", stroke: "#1971c2", strokeWidth: 2 }, visible: true, z: 2 },
    ],
    timeline: [
      ...scene.timeline,
      { id: "draw-trail", type: "draw", target: "trail", start: 0, duration: 1000, easing: "linear", to: 1 },
      { id: "tint-a", type: "fill", target: "a", start: 0, duration: 1000, easing: "linear", to: "#a5d8ff" },
    ],
  };
}

async function sketchPlayer() {
  reset();
  const scene = sketchScene();
  const container = host("sketch-player");
  const controller = mountPlayer(container, scene, { autoplay: false });
  controller.seek(0);
  const svgBefore = container.querySelector("svg");
  const node = container.querySelector('[data-anim8-id="a"]');
  const marksBefore = node?.querySelector('[data-sketch-part="outline"]')?.getAttribute("d");
  const transformBefore = node?.getAttribute("transform");
  const trailBefore = container.querySelector('[data-anim8-id="trail"] path')?.getAttribute("stroke-dashoffset");
  node?.setAttribute("tabindex", "0");
  node?.focus();

  controller.seek(500);
  await waitAnimationFrames(2);
  const nodeAfter = container.querySelector('[data-anim8-id="a"]');
  const result = {
    svgCount: container.querySelectorAll("svg").length,
    sameSvg: container.querySelector("svg") === svgBefore,
    sameNode: nodeAfter === node,
    focusKept: document.activeElement === node,
    transformBefore,
    transformAfter: nodeAfter?.getAttribute("transform"),
    marksStable: nodeAfter?.querySelector('[data-sketch-part="outline"]')?.getAttribute("d") === marksBefore,
    roughOutline: Boolean(marksBefore && marksBefore.includes("C")),
    trailBefore,
    trailAfter: container.querySelector('[data-anim8-id="trail"] path')?.getAttribute("stroke-dashoffset"),
    arrowheads: container.querySelectorAll('[data-sketch-part="arrowhead"]').length,
    fontStyles: document.head.querySelectorAll("style[data-anim8-sketch-font]").length,
  };
  await document.fonts.load('20px "Virgil"');
  result.fontReady = document.fonts.check('20px "Virgil"');

  // A second player shares the single document font rule.
  const other = mountPlayer(host("sketch-player-2"), scene, { autoplay: false });
  result.fontStylesAfterSecond = document.head.querySelectorAll("style[data-anim8-sketch-font]").length;

  // Server markup is adopted in place rather than replaced.
  const ssrHost = host("sketch-ssr");
  ssrHost.innerHTML = renderSceneMarkup(scene, 0);
  const ssrNode = ssrHost.querySelector('[data-anim8-id="b"]');
  const hydrated = mountPlayer(ssrHost, scene, { autoplay: false });
  result.ssrAdopted = ssrHost.querySelector('[data-anim8-id="b"]') === ssrNode;
  hydrated.seek(900);
  result.ssrUpdates = ssrHost.querySelector('[data-anim8-id="a"]')?.getAttribute("transform") !== transformBefore;

  controller.play();
  await sleep(250);
  result.playedTo = controller.getTime();
  controller.destroy();
  other.destroy();
  hydrated.destroy();
  result.childrenAfterDestroy = container.children.length;
  return result;
}

async function customFonts() {
  reset();
  // Use a real local WOFF2 under a host-defined name, rather than relying on an installed font.
  const face = new FontFace("Anim8TestFont", 'url("/packages/renderer-sketch/assets/Virgil.woff2")');
  await face.load();
  document.fonts.add(face);
  const results = [];
  try {
    for (const theme of ["clean", "sketch"]) {
      const scene = motionScene();
      scene.scene.theme = theme;
      scene.scene.fontFamily = '"Anim8TestFont", serif';
      scene.objects[0].textRuns = [{ text: "A", fontWeight: 400 }];
      scene.objects[1].style.fontFamily = "monospace";
      scene.objects[2].label = "Link";
      scene.objects.push(
        { ...circle("circle", 100, 210), text: "Circle" },
        { ...rect("ellipse", 300, 210), type: "ellipse", rx: 45, ry: 25, text: "Ellipse" },
        { ...rect("label", 220, 40), type: "text", text: "Wide label" },
      );
      scene.timeline.push({ id: "font", type: "style", target: "label", start: 0, duration: 1000, to: { fontFamily: "monospace" } });
      const container = host(`custom-font-${theme}`);
      container.innerHTML = renderSceneMarkup(scene, 0);
      const originalSvg = container.firstElementChild;
      const original = container.querySelector('[data-anim8-id="label"]');
      const controller = mountPlayer(container, scene);
      try {
        const label = () => {
          const node = container.querySelector('[data-anim8-id="label"]');
          return node.matches("text") ? node : node.querySelector("text");
        };
        await document.fonts.ready;
        const families = [...container.querySelectorAll("text")].map(node => node.getAttribute("font-family"));
        const computed = getComputedStyle(label()).fontFamily;
        const canvas = document.createElement("canvas").getContext("2d");
        canvas.font = `${label().getAttribute("font-size")}px "Anim8TestFont"`;
        const widthDifference = Math.abs(label().getComputedTextLength() - canvas.measureText("Wide label").width);
        controller.seek(1000);
        const endFamily = label().getAttribute("font-family");
        controller.seek(500);
        const reverseFamily = label().getAttribute("font-family");
        results.push({ theme, loaded: face.status, families, computed, widthDifference, endFamily, reverseFamily,
          hydrated: container.firstElementChild === originalSvg && container.querySelector('[data-anim8-id="label"]') === original,
          bundledStyles: document.head.querySelectorAll("style[data-anim8-sketch-font]").length });
      } finally {
        controller.destroy();
      }
    }
    return results;
  } finally {
    document.fonts.delete(face);
  }
}

async function remoteSceneLoads() {
  reset();
  defineAnim8Player("anim8-browser-test-player");
  defineAnim8WebComponent("anim8-controls");
  const valid = { version: "1.0", scene: { width: 320, height: 180, fontFamily: "serif" }, objects: [{ id: "remote", type: "rect", text: "Loaded" }], timeline: [] };
  const invalid = { ...valid, objects: [{ id: "remote", type: "rect", style: { strokeWidth: -6.4, strokeStyle: "dashed" }, drawProgress: 0.5 }] };
  const results = [];
  for (const tag of ["anim8-browser-test-player", "anim8-controls"]) {
    for (const [name, source] of [["valid", valid], ["invalid", invalid]]) {
      const url = URL.createObjectURL(new Blob([JSON.stringify(source)], { type: "application/json" }));
      const element = document.createElement(tag);
      let error;
      element.addEventListener("anim8-error", event => { error = String(event.detail); });
      element.setAttribute("src", url);
      root.appendChild(element);
      const stage = () => element.shadowRoot ?? element;
      try {
        for (let i = 0; i < 120 && !error && !stage().querySelector("svg"); i++) await waitAnimationFrames(1);
        const rendered = Boolean(stage().querySelector("svg"));
        const normalized = element.scene?.objects[0]?.transform?.scaleX;
        element.scene = undefined;
        results.push({ tag, name, rendered, error: error ?? null, normalized: normalized ?? null, cleared: !stage().querySelector("svg") });
      } finally {
        element.remove(); URL.revokeObjectURL(url);
      }
    }
  }
  return results;
}

async function focusAndSourceRaces() {
  reset();
  const focus = [];
  for (const theme of ["clean", "sketch"]) {
    const container = host(`focus-${theme}`), scene = motionScene(); scene.scene.theme = theme;
    let blurs = 0;
    const controller = mountPlayer(container, scene, { onObjectEvent: event => { if (event.type === "blur") blurs++; } });
    const node = container.querySelector('[data-anim8-id="a"]'); node.focus();
    controller.seek(500);
    controller.play(); await waitAnimationFrames(4); controller.pause();
    focus.push({ theme, focused: document.activeElement === node, blurs });
    controller.destroy();
  }
  const originalFetch = window.fetch;
  const races = [];
  const source = text => ({ version: "1.0", scene: { width: 320, height: 180, fontFamily: "serif" }, objects: [{ id: "remote", type: "rect", text }], timeline: [] });
  try {
    for (const tag of ["anim8-browser-test-player", "anim8-controls"]) {
      for (const action of ["remove", "replace"]) {
        let resolveOld, signal;
        window.fetch = (url, options) => {
          if (url === "https://anim8.invalid/slow.json") { signal = options.signal; return new Promise(resolve => { resolveOld = resolve; }); }
          if (url === "https://anim8.invalid/new.json") return Promise.resolve(new Response(JSON.stringify(source("new"))));
          return originalFetch(url, options);
        };
        const element = document.createElement(tag); element.setAttribute("src", "https://anim8.invalid/slow.json"); root.append(element);
        if (action === "remove") element.removeAttribute("src");
        else element.setAttribute("src", "https://anim8.invalid/new.json");
        resolveOld(new Response(JSON.stringify(source("old"))));
        for (let i = 0; i < 6; i++) await waitAnimationFrames(2);
        races.push({ tag, action, aborted: signal.aborted, label: element.scene?.objects[0]?.text ?? null });
        element.remove();
      }
    }
  } finally { window.fetch = originalFetch; }
  return { focus, races };
}

window.__anim8Browser = {
  focusAndSourceRaces,
  remoteSceneLoads,
  customFonts,
  sketchPlayer,
  svgIdentity,
  playerControls,
  dynamicConnector,
  routedConnector,
  responsiveSizing,
  staticFallback,
  hiddenTabPolicy,
  multipleInstances,
  mountUnmount,
  reducedMotionCustomElement,
  setupScreenshotFixture,
};

window.__anim8BrowserReady = true;
