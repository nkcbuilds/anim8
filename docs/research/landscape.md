# Animation and Diagram Ecosystem Research

Research date: 2026-10-25.

This document records the Stage A decision gate for Anim8. The goal is not to prove that existing libraries are bad; it is to determine what can be reused without inheriting a runtime or authoring model that conflicts with deterministic, model-first scene animation.

## Decision summary

Anim8 should **not** adopt a single existing animation/diagram engine as its core.

The best fit is a small custom authoritative scene/timeline evaluator with selective reuse around the edges:

- Browser SVG is the default renderer.
- Browser-native animation libraries may inspire playback optimizations, but they must not own authoritative state.
- Graph layout engines remain optional adapters.
- A sketch renderer may use Rough.js optionally, but sketch support must not make Rough.js mandatory.
- Framework integrations remain wrappers around a framework-independent core/player.

## Candidates

| Project | What it does well | Why it is not the Anim8 core | Reuse/inspiration |
| --- | --- | --- | --- |
| Motion Canvas | Strong code-first motion semantics, vector scenes, player/editor separation | Generator/editor workflow is oriented toward authored motion/video; not a compact untrusted JSON IR | Scene semantics, time-based animation design |
| Motion | Small browser animation runtime, excellent SVG/DOM support, sequences, springs | Browser/DOM animation state is not sufficient as an authoritative random-access scene evaluator | Playback optimization and easing ideas |
| GSAP | Mature timelines, seek/reverse, robust sequencing | General animation runtime is larger/more imperative than the desired scene IR and safety model | Timeline UX and labels |
| Anime.js | Compact timeline API, reverse/seek support | Still fundamentally target/runtime animation rather than scene-graph semantics | Timeline ergonomics |
| Mermaid | Extremely model-friendly static declarative authoring | Does not provide arbitrary object motion/state/timeline semantics | DSL simplicity and generation ergonomics |
| D2 | Strong declarative diagrams/layouts | Animation is not its semantic center | Text DSL/layout inspiration |
| Excalidraw | Excellent sketch visuals and stable diagram object model | Full collaborative/editor application has far more state/runtime than the target player | Sketch conventions, object identity |
| Rough.js | Tiny-ish hand-drawn SVG/Canvas generation | Optional visual layer only; randomness must be made stable across motion | Sketch strokes |
| tldraw | Extensible scene/editor architecture | Editor/runtime scope is much larger than an embeddable explanation player | Shape extensibility ideas |
| XYFlow/React Flow | Attached edges, handles/ports, incremental rendering | React/editor-oriented and graph-specific | Stable connector/port semantics |
| ELK.js | Sophisticated graph layout | Too large for a mandatory player dependency | Optional graph-layout adapter |
| Dagre | Simpler directed graph layout | Still unnecessary in the standard runtime | Optional directed graph layout |
| Manim | Excellent semantic transformations and math animation | Python/video-rendering workflow is not the target deployment environment | Transform semantics |
| Rive | Excellent interactive state machines | Binary/design-tool/runtime ecosystem is not the open JSON-first authoring contract desired here | State-machine concepts |
| Lottie/dotLottie | Portable serialized animation/playback | Representation is optimized for exported motion assets, not model-authored semantic diagrams | Portability/player patterns |

## Relevant observations

### Motion

Motion's current documentation exposes a small `animate()` surface, including a roughly 3.2 KB mini build and a larger hybrid build. It can animate SVG, paths, independent transforms, JavaScript objects, sequences, springs and motion along arcs. This validates that a small playback layer is feasible.

However, Anim8 requires `evaluate(scene, t)` to be authoritative in Node/browser/export environments. Browser animation state therefore cannot be the core source of truth.

Source: https://motion.dev/docs/animate

### Motion Canvas

Motion Canvas explicitly separates a TypeScript animation library from its preview/editor and is specialized for vector explanatory animation. This is close in spirit to Anim8, but its generator-based authoring and editor-oriented workflow are much heavier than a compact JSON scene IR intended for arbitrary LLMs and untrusted documents.

Source: https://github.com/motion-canvas/motion-canvas

### GSAP / Anime.js

Both provide timeline concepts including seek and reverse. Their playback models are useful references, but Anim8 needs scene identity, connector relationships, validation, serialization, SSR, and untrusted declarative input at a lower semantic layer.

Sources:
- https://gsap.com/docs/v3/GSAP/Timeline/
- https://animejs.com/documentation/timeline/

### XYFlow

XYFlow demonstrates the importance of stable node identity and explicit handles/edges. It also performs incremental updates rather than rebuilding all nodes. Anim8 adopts the connector lesson but not the React/editor dependency.

Source: https://github.com/xyflow/xyflow

## Architecture decision gate

**Selected strategy:** custom deterministic evaluator + focused optional libraries.

Reasons:

1. The scene IR and validation/security boundary are product-defining.
2. Deterministic random-access evaluation is easier to guarantee when it is explicit rather than reconstructed from renderer state.
3. The <35 KB standard-runtime target strongly discourages mandatory graph/editor frameworks.
4. A compact vocabulary is easier for models to generate consistently.
5. Optional heavy capabilities can still reuse mature libraries.

See ADRs in `docs/architecture/decisions`.
