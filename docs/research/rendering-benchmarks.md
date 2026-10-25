# Rendering Benchmark Plan and Baseline

Research/baseline date: 2026-10-25.

These numbers describe the **current implementation**, not the final feature-complete library. They exist to keep future work honest and catch regressions.

## Why SVG first

SVG maps directly to Anim8's required primitives, text, groups, connectors,
markers and accessibility semantics. It also provides a useful static
representation for SSR and documentation fallback.

The renderer is not authoritative. It consumes an `EvaluatedScene`.

## Measured Node/headless baseline

Machine:

- Windows `10.0.26200`
- Node `v24.21.0`
- Intel Core i7-13700HX
- 24 logical CPUs

Benchmark harness: `benchmarks/run-baseline.mjs`. The harness performs warmup
runs and records per-call samples using `performance.now()`.

Current baseline after deterministic path morphing, state interactions,
canonical SVG numbers, and the current scene-graph/timeline feature set:

| Case | p50 | p95 | max |
| --- | ---: | ---: | ---: |
| Evaluate 50 independently moving rectangles at t=1000ms | 0.161 ms | 0.240 ms | 0.345 ms |
| Serialize SVG for 100 nodes + 99 attached connectors | 0.327 ms | 0.473 ms | 0.720 ms |

The 100-node connected SVG is 31,843 bytes before compression.

These are Node/headless microbenchmarks; they do **not** replace browser
frame-time, layout, paint, memory, or long-task measurements.

## Standard runtime bundle measurement

Entry: `benchmarks/standard-runtime.ts`, importing the public core evaluator,
SVG renderer, and browser player.

Measured with esbuild production bundling/minification/tree-shaking:

- 43,112 bytes minified
- **10,253 bytes gzip** (level 9)
- hard release ceiling: 35,840 bytes gzip (35 KiB)

The standard runtime remains comfortably below the target. Optional sketch,
Dagre/ELK layout adapters, framework wrappers, presets, accessibility helpers,
DSL, and AI tooling are not included in this bundle.

## Real browser matrix

The Playwright harness executes real built package output, not source aliases or
a fake DOM.

Current locally verified engines:

- Chromium 156.0.8078.4
- Firefox 157.0
- WebKit 27.2

Portable behavior cases run in all three:

1. stable keyed SVG element identity across updates;
2. play/pause/seek/reverse using real `requestAnimationFrame`;
3. attached connector updates while endpoints move;
4. reduced-motion behavior;
5. independent multiple players;
6. mount/destroy/remount cleanup.

Chromium additionally captures a fixed deterministic fixture twice and requires
the PNG bytes to be identical within the same browser build. Current fixture
SHA-256:

`f325374a85805d1cf2e2b01698189db2e70860fe533c4041c12f846abbde34b3`

Cross-engine PNG bytes are intentionally not compared because rasterization and
font antialiasing are browser/platform-specific.

## Framework consumer validation

The consumer boundary suite now executes production builds when framework
dependencies are installed:

- vanilla ESM;
- Node SSR import/static SVG;
- React SSR;
- Next.js App Router static export using `@anim8/react`;
- Astro static build using `@anim8/renderer-svg` for the initial frame and
  `@anim8/player` for client activation.

This validates actual downstream package resolution rather than relying only on
workspace symlinks.

## Incremental renderer behavior

The browser SVG mount keeps one stable SVG root and keyed object records. Normal
frame updates mutate transforms, geometry, style, text, draw progress and
connector paths in place rather than replacing the entire SVG tree.

Tests verify:

- stable root/object DOM identity;
- connector endpoint updates;
- visibility detach/reattach without losing identity;
- safe additions/removals;
- text/geometry updates;
- deterministic canonical numeric serialization.

A static-serialization fallback remains available for minimal/nonstandard DOM
shims.

## Required benchmark scenes

1. Single moving object.
2. 50 independently moving objects.
3. 100 interconnected nodes.
4. Deep nested group transforms.
5. Multiple paused diagrams.
6. Multiple simultaneously playing diagrams.
7. Responsive resize.
8. Repeated mount/unmount.
9. Long-timeline scrubbing.
10. Sketch rendering.

## Metrics still to add

- sustained browser frame timing and dropped frames under larger moving scenes;
- memory usage and allocation profiles;
- idle CPU across many paused diagrams;
- time to first interactive frame;
- multi-diagram playback stress;
- sketch-mode browser cost;
- compile/validation scaling for hostile/near-limit documents.

## Determinism protocol

For every representative scene:

1. Evaluate timestamp T.
2. Evaluate several unrelated timestamps.
3. Evaluate T again.
4. Serialize and parse the scene.
5. Evaluate T again.

Semantic frames must match within documented numerical tolerance. Static SVG
serialization is canonicalized so identical semantic inputs produce stable
numeric output.

## Browser methodology

Browser visual/performance runs pin or record:

- browser versions;
- OS/CI image;
- viewport/DPR;
- fonts;
- reduced-motion setting;
- scene fixture;
- warmup period;
- sample count.

Pixel baselines remain browser/platform specific.

## Architectural performance choices

- No render loop while paused.
- No mandatory UI framework.
- No graph-layout package in the standard player.
- Scene evaluation is random-access instead of replaying historical side effects.
- Connectors derive endpoints from the evaluated scene.
- Layout changes are precomputed where possible.
- Browser SVG updates are keyed/incremental.
