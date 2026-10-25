import { mountPlayer } from "@anim8/player";

const scene = {
  version: "1.0",
  scene: { width: 640, height: 360, background: "#ffffff" },
  objects: [
    {
      id: "box",
      type: "rect",
      width: 120,
      height: 64,
      text: "Desktop WebView",
      transform: { x: 100, y: 180, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      style: {
        fill: "#ffffff",
        stroke: "#111827",
        strokeWidth: 2,
        color: "#111827",
        fontSize: 16
      },
      visible: true,
      z: 0
    }
  ],
  timeline: [
    {
      id: "move",
      type: "move",
      target: "box",
      start: 0,
      duration: 1200,
      easing: "easeInOut",
      to: { x: 540, y: 180 }
    }
  ],
  markers: [
    { id: "start", label: "Start", time: 0 },
    { id: "end", label: "End", time: 1200 }
  ]
};

const host = document.querySelector("#animation");
if (!(host instanceof HTMLElement)) throw new Error("Missing #animation host.");

const controller = mountPlayer(host, scene, { autoplay: true });
globalThis.anim8DesktopController = controller;
window.addEventListener("beforeunload", () => controller.destroy(), { once: true });
