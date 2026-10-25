import type { CameraState, Style, Transform } from "./types.js";

export const defaultCamera = (): CameraState => ({
  x: 0,
  y: 0,
  zoom: 1,
});

export const defaultTransform = (): Transform => ({
  x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1,
});

export const defaultStyle = (): Style => ({
  fill: "#ffffff", stroke: "#1f2937", strokeWidth: 2, color: "#111827", fontSize: 16,
});
