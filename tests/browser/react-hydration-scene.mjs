export const hydrationScene = {
  version: "1.0",
  scene: { width: 480, height: 270, background: "#ffffff" },
  objects: [
    {
      id: "hydration-box",
      type: "rect",
      width: 120,
      height: 64,
      text: "Hydrate",
      transform: { x: 100, y: 135, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      style: {
        fill: "#ffffff",
        stroke: "#111827",
        strokeWidth: 2,
        color: "#111827",
        fontSize: 16,
        radius: 10
      },
      visible: true,
      z: 0
    }
  ],
  timeline: [
    {
      id: "move",
      type: "move",
      target: "hydration-box",
      start: 0,
      duration: 1000,
      easing: "linear",
      to: { x: 380, y: 135 }
    }
  ]
};
