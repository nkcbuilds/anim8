# Rendering Benchmark Plan and Baseline

Research/baseline date: 2026-10-25.

These numbers describe the **current implementation**, not the final feature-complete library. They exist to keep future work honest and catch regressions.

## Why SVG first

SVG maps directly to Anim8's required primitives, text, groups, connectors, markers and accessibility semantics. It also provides a useful static representation for SSR and documentation fallback.

The renderer is not authoritative. It consumes an `EvaluatedScene`.

## Measured baseline

Machine:

- Windows `10.0.26200`
- Node `v24.21.0`
- Intel Core i7-13700HX
- 24 logical CPUs

Benchmark harness: `benchmarks/run-baseline.mjs`. The harness performs warmup runs and records per-call samples using `performance.now()`.

Post-feature baseline after follow-path/spring support, richer shapes, reactive bindings, object events, and incremental SVG mounting:

| Case | p50 | p95 | max |
| --- | ---: | ---: | ---: |
| Evaluate 50 independently moving rectangles at t=1000ms | 0.546 ms | 0.905 ms | 1.424 ms |
| Serialize SVG for 100 nodes + 99 attached connectors | 0.469 ms | 1.058 ms | 1.560 ms |

The 100-node connected SVG was 31,778 bytes before compression.

These are Node/headless microbenchmarks; they do **not** replace browser frame-time, layout, paint, memory, or long-task measurements.

## Standard runtime bundle measurement

Entry: `benchmarks/standard-runtime.ts`, importing the public core evaluator, SVG renderer, and browser player.

Bundler command uses esbuild with production minification and tree-shaking.

Current consumer bundle:

- 27,969 bytes minified
- 6,981 bytes gzip (level 9)
- 6,184 bytes Brotli

The current standard runtime remains far below the 35 KB gzip ceiling. Optional sketch/layout/framework/preset/AI packages are not included in this number.

## Browser artifact validation

Built CLI renders were served to the MoonDesk Chromium browser and parsed as native SVG.

This check caught a duplicate `fill` attribute on standalone text that unit tests had missed. The serializer was fixed and a regression test was added.

The reactive browser example verified live input binding end-to-end:

- input index 0 -> pointer transform `matrix(1 0 0 1 150 95)`
- input index 3 -> pointer transform `matrix(1 0 0 1 450 95)`

The transition occurs through `PlayerController.setInput()` and deterministic scene re-evaluation.

Trusted browser object interaction was also verified: clicking the pointer emitted `click:pointer` through delegated player events.

The accessible web-component example was inspected in Chromium and exposed labelled Previous/Play/Restart/Next controls, a timeline slider, keyboard guidance, and the expected scene content.

## Incremental renderer behavior

The browser SVG mount now keeps one stable SVG root and keyed object records. Normal frame updates mutate transforms, geometry, style, text, draw progress and connector paths in place rather than replacing the entire SVG tree.

Tests verify:

- stable root/object DOM identity,
- connector endpoint updates,
- visibility detach/reattach without losing identity,
- safe additions/removals,
- text/geometry updates.

A static-serialization fallback remains available for minimal/nonstandard DOM shims.

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

- browser frame timing and dropped frames,
- memory usage,
- idle CPU,
- initial render time,
- time to first interactive frame,
- allocation behavior,
- repeated mount/unmount cleanup at browser scale,
- multi-diagram playback,
- sketch-mode browser cost,
- compile/validation scaling for hostile/near-limit documents.

## Determinism protocol

For every representative scene:

1. Evaluate timestamp T.
2. Evaluate several unrelated timestamps.
3. Evaluate T again.
4. Serialize and parse the scene.
5. Evaluate T again.

Semantic frames must match within documented numerical tolerance.

Static SVG generation should become byte-stable for identical inputs after canonical numeric formatting is finalized.

## Browser methodology

Browser visual/performance runs should pin:

- browser versions,
- OS/CI image,
- viewport/DPR,
- font files,
- reduced-motion setting,
- scene fixture,
- warmup period,
- sample count.

Pixel baselines must be browser/platform specific because antialiasing and font rendering vary.

## Initial architectural performance choices

- No render loop while paused.
- No mandatory UI framework.
- No graph-layout package in the standard player.
- Scene evaluation is random-access instead of replaying historical side effects.
- Connectors derive endpoints from the evaluated scene.
- Layout changes are precomputed where possible.
- Browser SVG updates are keyed/incremental.
