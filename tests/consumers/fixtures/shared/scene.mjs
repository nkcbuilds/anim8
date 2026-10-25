export const scene = {
  version: "1.0",
  scene: {
    width: 320,
    height: 180,
    theme: "clean",
    background: "#f8fafc",
  },
  objects: [
    {
      id: "box",
      type: "rect",
      width: 100,
      height: 60,
      text: "consumer",
      transform: {
        x: 40,
        y: 60,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
      },
      style: {
        fill: "#ffffff",
        stroke: "#111827",
        strokeWidth: 2,
        color: "#111827",
        fontSize: 16,
      },
      visible: true,
      z: 0,
    },
  ],
  timeline: [
    {
      id: "move_1",
      type: "move",
      target: "box",
      start: 0,
      duration: 1000,
      easing: "linear",
      to: { x: 140, y: 60 },
    },
  ],
};
