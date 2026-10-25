export const scene = {
  version: "1.0",
  scene: { width: 320, height: 180, theme: "clean" },
  objects: [
    {
      id: "box",
      type: "rect",
      width: 100,
      height: 56,
      text: "Astro",
      transform: { x: 160, y: 90, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      style: { fill: "#ffffff", stroke: "#111827", strokeWidth: 2 },
      visible: true,
      z: 0,
    },
  ],
  timeline: [],
};
