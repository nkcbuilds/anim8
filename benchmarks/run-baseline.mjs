import os from "node:os";
import { performance } from "node:perf_hooks";
import { evaluate, defaultStyle, defaultTransform } from "../packages/core/dist/index.js";
import { renderSvg } from "../packages/renderer-svg/dist/index.js";
import { renderSketchSvg } from "../packages/renderer-sketch/dist/index.js";

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    p50Ms: Number(pick(0.5).toFixed(4)),
    p95Ms: Number(pick(0.95).toFixed(4)),
    maxMs: Number((sorted.at(-1) ?? 0).toFixed(4)),
  };
}

function rect(id, x, y, z = 1) {
  return {
    id,
    type: "rect",
    width: 60,
    height: 36,
    text: id,
    transform: { ...defaultTransform(), x, y },
    style: defaultStyle(),
    visible: true,
    z,
  };
}

function movingScene(count) {
  const objects = [];
  const timeline = [];
  for (let i = 0; i < count; i += 1) {
    objects.push(rect(`n${i}`, 40 + (i % 10) * 70, 40 + Math.floor(i / 10) * 55, i));
    timeline.push({
      id: `m${i}`,
      type: "move",
      target: `n${i}`,
      start: 0,
      duration: 2000,
      easing: "easeInOut",
      to: {
        x: 60 + (i % 10) * 70,
        y: 50 + Math.floor(i / 10) * 55,
      },
    });
  }
  return { version: "1.0", scene: { width: 800, height: 500 }, objects, timeline };
}

function connectedScene(count, kind = "straight") {
  const objects = [];
  for (let i = 0; i < count; i += 1) {
    objects.push(rect(`n${i}`, 40 + (i % 10) * 70, 40 + Math.floor(i / 10) * 45));
  }
  for (let i = 0; i < count - 1; i += 1) {
    objects.push({
      id: `e${i}`,
      type: "connector",
      from: { objectId: `n${i}`, anchor: "right" },
      to: { objectId: `n${i + 1}`, anchor: "left" },
      kind,
      ...(kind === "routed" ? { routing: { clearance: 6, bendPenalty: 4 } } : {}),
      transform: defaultTransform(),
      style: { ...defaultStyle(), fill: "none" },
      visible: true,
      z: 0,
    });
  }
  return { version: "1.0", scene: { width: 800, height: 500 }, objects, timeline: [] };
}

function nestedScene(depth = 12) {
  const objects = [];
  let parentId;
  for (let i = 0; i < depth; i += 1) {
    const id = `g${i}`;
    const childId = i === depth - 1 ? "leaf" : `g${i + 1}`;
    objects.push({
      id,
      type: "group",
      children: [childId],
      ...(parentId ? { parentId } : {}),
      transform: { ...defaultTransform(), x: 8, y: 5, rotation: i * 1.5, scaleX: 1.002, scaleY: 1.002 },
      style: defaultStyle(),
      visible: true,
      z: i,
    });
    parentId = id;
  }
  objects.push({
    ...rect("leaf", 0, 0, depth + 1),
    parentId: `g${depth - 1}`,
  });
  return { version: "1.0", scene: { width: 800, height: 500 }, objects, timeline: [] };
}

function longTimelineScene(actionCount = 1000) {
  const objects = [rect("runner", 40, 250)];
  const timeline = [];
  let x = 40;
  for (let i = 0; i < actionCount; i += 1) {
    x = i % 2 === 0 ? 760 : 40;
    timeline.push({
      id: `move${i}`,
      type: "move",
      target: "runner",
      start: i * 20,
      duration: 20,
      easing: "linear",
      to: { x, y: 250 },
    });
  }
  return { version: "1.0", scene: { width: 800, height: 500 }, objects, timeline };
}

function bench(fn, iterations = 200) {
  for (let i = 0; i < 30; i += 1) fn();
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  return stats(samples);
}

const moving1 = movingScene(1);
const moving50 = movingScene(50);
const connected100 = connectedScene(100);
const routed40 = connectedScene(40, "routed");
const nested12 = nestedScene(12);
const long1000 = longTimelineScene(1000);

const connectedFrame = evaluate(connected100, 0);
const routedFrame = evaluate(routed40, 0);
const sketchFrame = evaluate({ ...connected100, scene: { ...connected100.scene, seed: 42, theme: "sketch" } }, 0);

console.log(JSON.stringify({
  node: process.version,
  platform: `${process.platform} ${os.release()}`,
  cpu: os.cpus()[0]?.model,
  logicalCpus: os.cpus().length,
  moving1Evaluate: bench(() => evaluate(moving1, 1000), 500),
  moving50Evaluate: bench(() => evaluate(moving50, 1000)),
  nested12Evaluate: bench(() => evaluate(nested12, 0), 300),
  longTimeline1000Scrub: bench(() => {
    evaluate(long1000, 199);
    evaluate(long1000, 9873);
    evaluate(long1000, 3333);
    evaluate(long1000, 15000);
  }, 100),
  connected100RenderSvg: bench(() => renderSvg(connectedFrame), 100),
  routed40RenderSvg: bench(() => renderSvg(routedFrame), 100),
  connected100RenderSketchSvg: bench(() => renderSketchSvg(sketchFrame), 50),
  connected100SvgBytes: Buffer.byteLength(renderSvg(connectedFrame)),
  connected100SketchSvgBytes: Buffer.byteLength(renderSketchSvg(sketchFrame)),
}, null, 2));
