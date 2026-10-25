import {
  defaultStyle,
  defaultTransform,
  evaluate,
} from "@anim8/core";
import { mountSvg } from "@anim8/renderer-svg";
import { defineAnim8Player, mountPlayer } from "@anim8/player";

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

window.__anim8Browser = {
  svgIdentity,
  playerControls,
  dynamicConnector,
  multipleInstances,
  mountUnmount,
  reducedMotionCustomElement,
  setupScreenshotFixture,
};

window.__anim8BrowserReady = true;
