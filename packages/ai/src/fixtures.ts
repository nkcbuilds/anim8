import type { BenchmarkPromptCase } from "./types.js";

/**
 * Shared instructions for provider-neutral benchmark runs.
 *
 * Keep provider-specific response-format/json-mode settings in the adapter, not
 * here, so every model receives the same textual contract.
 */
export const AGENT_SYSTEM_PROMPT = [
  "You generate Anim8 SceneDocument version 1.0 JSON.",
  "Return exactly one JSON object with no Markdown fences or commentary.",
  "Use top-level version, scene, objects, and timeline.",
  "Give every object and action a unique stable id.",
  "All action targets, group children/parents, and connector endpoints must reference existing object ids.",
  "For images use a relative URL or a public HTTPS URL; never use javascript:, data:, blob:, file:, or http: URLs.",
  "Prefer the smallest scene that fully satisfies the request and do not invent unsupported fields.",
].join(" ");

export const BENCHMARK_CASES: readonly BenchmarkPromptCase[] = [
  {
    id: "basic-labeled-box",
    prompt: "Create an 800 by 450 clean scene with one centered rectangular card labeled Hello. Give the card a light fill and dark stroke. No animation is needed.",
    capabilityTags: ["geometry", "text", "styling"],
  },
  {
    id: "circle-and-caption",
    prompt: "Create a clean 640 by 360 scene containing a circle near the left side and a separate text caption reading Start near the right side.",
    capabilityTags: ["geometry", "text", "multi-object"],
  },
  {
    id: "line-geometry",
    prompt: "Create a 640 by 360 scene with a single visible diagonal line that starts at its object origin and extends 180 pixels right and 90 pixels down.",
    capabilityTags: ["geometry"],
  },
  {
    id: "simple-path",
    prompt: "Create a 640 by 360 scene with one path object that draws a small closed triangle using SVG path data. Keep it stationary.",
    capabilityTags: ["geometry"],
  },
  {
    id: "move-card",
    prompt: "Create an 800 by 450 scene with one rectangular card that moves from the left side to the right side over 800 milliseconds using easeInOut.",
    capabilityTags: ["geometry", "motion", "timing"],
  },
  {
    id: "rotate-and-scale",
    prompt: "Create a square card in a 600 by 400 scene. Rotate it to 90 degrees over 500 milliseconds, then scale it to 1.5 times its original size over the next 500 milliseconds without overlapping those two actions.",
    capabilityTags: ["geometry", "motion", "timing"],
  },
  {
    id: "fade-and-highlight",
    prompt: "Create a card labeled Ready. First fade it to 40 percent opacity over 300 milliseconds, then change its fill to #fef08a over 300 milliseconds.",
    capabilityTags: ["geometry", "text", "styling", "motion", "timing"],
  },
  {
    id: "two-object-swap",
    prompt: "Create two labeled rectangular cards A and B at different horizontal positions. Animate both at the same time for 700 milliseconds so A ends at B's starting position and B ends at A's starting position.",
    capabilityTags: ["geometry", "text", "motion", "timing", "multi-object"],
  },
  {
    id: "straight-connector",
    prompt: "Create two rectangular nodes labeled Input and Output with a straight connector from the right anchor of Input to the left anchor of Output.",
    capabilityTags: ["geometry", "text", "connectors", "multi-object"],
  },
  {
    id: "orthogonal-connector-motion",
    prompt: "Create two rectangular nodes connected by an orthogonal connector. Animate the first node 150 pixels to the right over 600 milliseconds; the connector should reference the node ids so it stays attached as the renderer evaluates the scene.",
    capabilityTags: ["geometry", "connectors", "motion", "timing", "multi-object"],
  },
  {
    id: "group-parenting",
    prompt: "Create one group containing two rectangular child objects. Each child must declare the group as parentId, and the group's children list must contain exactly those two child ids.",
    capabilityTags: ["geometry", "groups", "multi-object"],
  },
  {
    id: "sketch-theme",
    prompt: "Create a 700 by 420 sketch-themed scene with a deterministic numeric seed and three simple labeled shapes. Do not animate them.",
    capabilityTags: ["geometry", "text", "sketch-theme", "multi-object"],
  },
  {
    id: "relative-image",
    prompt: "Create a scene with one 240 by 160 image object using the relative image href /assets/diagram.png and alt text Diagram. Keep the image stationary.",
    capabilityTags: ["images", "safety"],
  },
  {
    id: "https-image",
    prompt: "Create a scene with one image object using https://example.com/illustration.png. Give it finite positive width and height and an alt label.",
    capabilityTags: ["images", "safety"],
  },
  {
    id: "multi-stage-timeline",
    prompt: "Create a labeled card with three non-overlapping stages: move it for 400 milliseconds, rotate it for 300 milliseconds starting after the move ends, then hide it with a zero-duration visibility action after the rotation ends.",
    capabilityTags: ["geometry", "text", "motion", "timing", "visibility"],
  },
  {
    id: "connector-three-nodes",
    prompt: "Create three rectangular nodes A, B, and C in a row. Connect A to B and B to C with separate connectors using valid endpoint object ids and side anchors.",
    capabilityTags: ["geometry", "text", "connectors", "multi-object"],
  },
] as const;

export function getBenchmarkCase(id: string): BenchmarkPromptCase | undefined {
  return BENCHMARK_CASES.find(testCase => testCase.id === id);
}
