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
| `@anim8/presets` | Technical shapes composed from generic primitives |
| `@anim8/dsl` | Optional concise text authoring syntax |
| `@anim8/ai` | Provider-neutral model-generation benchmark harness |

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
pnpm exec playwright install chromium
pnpm browser
pnpm benchmark
```

Research and architectural decisions live in `docs/research` and `docs/architecture/decisions`.

## Security model

Remote/model-generated scene documents are untrusted data. Anim8 does not evaluate JavaScript from JSON, and the compiler enforces structural/resource policies before rendering. See [docs/security.md](docs/security.md).

## License

MIT.
