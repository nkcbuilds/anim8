# Anim8

Anim8 is a small, model-first 2D animation library for diagrams and technical explanations.

The core idea is simple: author a scene with stable objects and a deterministic timeline, then evaluate the scene at **any timestamp**. Rendering is a separate concern, so the same scene can be inspected headlessly, rendered to SVG, played in a browser, reversed, scrubbed, or exported without making DOM state authoritative.

> Status: active pre-1.0 development. The repository contains a coherent deterministic runtime, renderers, player, framework adapters, validation/tooling, layouts, presets, and release checks, but it is not yet a 1.0 release.

## Why Anim8?

Static diagram tools are great at describing *what exists*. Anim8 is designed to make it just as easy to describe *what moves*.

```ts
import { scene } from "@anim8/authoring";

const s = scene({ width: 800, height: 450, theme: "clean" });

const a = s.box("2", { id: "a", x: 140, y: 220 });
const b = s.box("7", { id: "b", x: 360, y: 220 });

s.connect(a, b, { from: "right", to: "left" });

s.step("Compare", () => {
  s.parallel(
    a.highlight("#fde68a"),
    b.highlight("#bbf7d0"),
  );
});

s.step("Swap", () => {
  s.swap(a, b, { duration: 700 });
});

const document = s.toJSON();
```

Every object keeps a stable identity. The boxes, their text, and attached connector all move as real scene objects.

## Design principles

- **Model-first:** small vocabulary, JSON-compatible IR, structured diagnostics.
- **Deterministic:** `evaluate(scene, timeMs)` is random-access and frame-history independent.
- **Renderer-independent:** the core never reads DOM animation state.
- **Lightweight:** the standard runtime targets a dependency-free core and SVG renderer.
- **Safe by construction:** declarative scenes do not execute arbitrary JavaScript.
- **Composable:** movement, transforms, styling, grouping, connectors, and layouts share the same scene model.

## Packages

| Package | Purpose |
| --- | --- |
| `@anim8/core` | Scene types, transforms, timeline evaluation, geometry, diagnostics |
| `@anim8/compiler` | JSON parsing, normalization, validation, resource/security policy |
| `@anim8/authoring` | Compact TypeScript scene builder |
| `@anim8/renderer-svg` | Static/headless SVG and browser SVG mounting |
| `@anim8/sketch` | Deterministic seeded hand-drawn geometry |
| `@anim8/renderer-sketch` | Static deterministic sketch SVG renderer |
| `@anim8/player` | Play/pause/seek/reverse transport and reactive inputs |
| `@anim8/web-component` | Accessible framework-independent player element |
| `@anim8/react` | SSR-safe React component and hook |
| `@anim8/vue` | SSR-safe Vue 3 component and composable |
| `@anim8/cli` | Validate and render scene files |
| `@anim8/layout` | Deterministic row/column/grid/stack/radial/tree layouts |
| `@anim8/layout-dagre` | Optional Dagre-backed directed graph layout adapter |
| `@anim8/layout-elk` | Optional ELK-backed directed graph layout and route adapter |
| `@anim8/a11y` | Deterministic headless accessibility summaries |
| `@anim8/presets` | Technical shapes composed from generic primitives |
| `@anim8/dsl` | Optional concise text authoring syntax |
| `@anim8/ai` | Provider-neutral model-generation benchmark harness |
| `@anim8/export` | Optional deterministic SVG frame sequence and GIF/MP4 encoder (Playwright + FFmpeg) |

Optional graph layout engines and heavyweight sketch dependencies are intentionally not part of the standard runtime.

## JSON scene format

The canonical format is versioned and serializable:

```json
{
  "version": "1.0",
  "scene": { "width": 800, "height": 450, "theme": "clean" },
  "objects": [
    {
      "id": "a",
      "type": "rect",
      "width": 100,
      "height": 60,
      "transform": {
        "x": 140, "y": 220,
        "rotation": 0,
        "scaleX": 1, "scaleY": 1,
        "opacity": 1
      },
      "style": { "fill": "#ffffff", "stroke": "#1f2937", "strokeWidth": 2 },
      "visible": true,
      "z": 0
    }
  ],
  "timeline": [
    {
      "id": "move-a",
      "type": "move",
      "target": "a",
      "start": 0,
      "duration": 700,
      "easing": "easeInOut",
      "to": { "x": 360, "y": 220 }
    }
  ]
}
```

The compiler returns machine-repairable diagnostics instead of vague exceptions.

## Deterministic evaluation

```ts
import { evaluate } from "@anim8/core";

const frame = evaluate(sceneDocument, 350);
```

Evaluating 350 ms after 2 seconds, after 10 ms, or as the first call must produce the same semantic frame.

## SVG rendering

```ts
import { renderSceneAt } from "@anim8/renderer-svg";

const svg = renderSceneAt(sceneDocument, 350);
```

The static renderer does not require a DOM and is suitable for Node.js/SSR.

## CLI

```bash
pnpm --filter @anim8/cli build

anim8 validate examples/two-sum/scene.json
anim8 render examples/two-sum/scene.json 700 frame.svg
```

## Development

```bash
pnpm install
pnpm check
pnpm exec playwright install chromium firefox webkit
ANIM8_BROWSER_REQUIRE_ALL=1 pnpm browser
pnpm benchmark
```

Research and architectural decisions live in `docs/research` and `docs/architecture/decisions`.

## 150 teaching examples

The [teaching scene catalog](examples/catalog/README.md) contains 150 portable and independently validated animations across computing, math/science, and real-world workflows. Each teaches a concept in four narrated, seekable stages. Browse and scrub the full collection with `pnpm catalog:serve` after building; then open `http://127.0.0.1:4178`. Catalog determinism checks run as part of `pnpm check`, and a dedicated Chromium layout pass runs in CI after browser installation.

## Interactive scene playground

After `pnpm build`, run `pnpm playground` and open `http://127.0.0.1:4179`. The local-only [Anim8 Studio](examples/playground/README.md) includes editable JSON, the 150 example selector, compiler diagnostics, real SVG preview, deterministic time scrubbing, play/pause, import and JSON/SVG downloads. `pnpm playground:browser` qualifies the real Chromium editing and playback flow.

## GIF/MP4 and SVG frame exports

Build `@anim8/export`, then run `node packages/export/dist/cli.js input.json frames/ --fps 24` to export static frame SVGs. Install Playwright Chromium and FFmpeg to export GIF/MP4: `node packages/export/dist/cli.js input.json output.mp4 --fps 24`. Optional external dependencies remain outside the normal animation runtime. See [export package](packages/export/README.md) for limits and reproducibility details.

## Real-model and adversarial qualification

`pnpm model:providers:smoke` runs **offline**, fake-provider transport tests; it does not measure model quality. For opt-in paid real-provider tests, configure `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `GEMINI_API_KEY`, then follow [model evaluation instructions](tests/model-eval/README.md). `pnpm security:adversarial` runs a seeded untrusted-scene check, and `pnpm qualification:browser` reports real Chromium RAF timing, lifecycle and JS heap for multiple player instances. See [release checklist](docs/release/README.md) for outstanding gates and publication credentials.

## Rich styling and complex explanations

Independent fill/outline/text colors, linear gradients, multicolor text spans, dashed/dotted outlines, animated dash flow, style keyframes and timed label replacements are supported. Connector labels render in SVG and arrowheads follow their connector color. Combine these with groups, routed connectors, graph layouts, camera moves and state machines for layered 2D explanations.

See the [visual styling guide](docs/guides/visual-styling.md) and the [animated quorum-write example](examples/complex-styling/README.md). `pnpm browser:styles` verifies static/mounted pixel parity, seeking and cleanup in Chromium, Firefox and WebKit. Subject-matter accuracy and large-graph readability still require review.

The [full merge-sort motion example](examples/merge-sort-motion/README.md) moves twelve persistent boxes and their original identity tags through recursive splits and stable merges. `pnpm sorting:check` checks the algorithm and movement; `pnpm sorting:browser` verifies real playback, reverse playback, DOM identity and static/player pixel parity in all three browsers.

## Security model

Remote/model-generated scene documents are untrusted data. Anim8 does not evaluate JavaScript from JSON, and the compiler enforces structural/resource policies before rendering. See [docs/security.md](docs/security.md).

## License

MIT.
