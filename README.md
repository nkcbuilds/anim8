# Anim8

**Animated diagrams, authored as data.**

Explain algorithms, systems, and processes with 2D scenes you can play, pause, scrub, reverse, embed, and export. Write TypeScript or portable JSON; Anim8 evaluates the same scene at any timestamp and renders it as SVG.

[Get started](#get-started) · [Examples](#see-it-move) · [How it compares](#where-anim8-fits) · [Documentation](#documentation)

![A hand-drawn CI pipeline progressively reveals parallel checks, builds, and a release.](docs/media/pipeline.gif)

[Edit this scene](examples/diagram-gallery/dag/scene.json) · [See how it is authored](examples/diagram-gallery/build.mjs)

> **Pre-1.0.** Anim8 is in active development. Start from this repository; the public npm release is still a [release gate](docs/release/README.md). APIs may change before 1.0.

## See it move

These GIFs are rendered from the scene files in this repository. The browser player adds timeline scrubbing, speed controls, reverse playback, and named steps.

| Follow the data | Explain a protocol |
| --- | --- |
| ![An array pointer moves between cells, then a linked list draws its next pointers.](docs/media/data-structures.gif) | ![A login sequence reveals lifelines, activation bars, requests, and dashed replies.](docs/media/sequence.gif) |
| [Array and linked list source](examples/diagram-gallery/data-structures/scene.json) | [Sequence diagram source](examples/diagram-gallery/sequence/scene.json) |

| Keep object identity through an algorithm | Give visual details meaning |
| --- | --- |
| ![The same numbered boxes split into runs and merge into a stable sorted order.](docs/media/merge-sort.gif) | ![A distributed write changes gradients, rich labels, dash flow, and completion styling.](docs/media/styling.gif) |
| [Full merge-sort example and checks](examples/merge-sort-motion/README.md) | [Styling example](examples/complex-styling/README.md) |

Explore the [17 diagram families](examples/diagram-gallery/README.md): DAGs, flowcharts, sequence diagrams, state machines, ER diagrams, architecture, mind maps, org charts, timelines, Venn diagrams, bar and line charts, geometry, data structures, swimlanes, cycles, and undirected networks. The separate [150-scene teaching catalog](examples/catalog/README.md) covers computing, math/science, and everyday workflows.

## What makes Anim8 useful

- **An explanation has a timeline.** Reveal a diagram in steps, move a token through a system, or keep the same numbered boxes attached to their values throughout a sorting algorithm.
- **Scenes travel as JSON.** Objects, relationships, actions, markers, and supported interactions live in a versioned document you can inspect, save, generate, and validate.
- **Any frame is addressable.** `evaluate(scene, 1250)` computes that frame directly. Seeking and reverse playback use the same evaluator as exports; scene state does not depend on which frame was rendered before it.
- **A consistent diagram vocabulary.** Clean and seeded sketch themes, outline-bound connectors, label fitting, role colours, gradients, rich text, and layout/design checks help keep explanations readable.
- **Embed the scene where people learn.** Use the browser player, React, Vue, or a web component. Static SVG rendering also works in Node.js without a DOM.
- **A small surface for agents.** The compiler returns diagnostics with codes and field paths. Agents can repair generated JSON without executing it as JavaScript. See the [authoring guide](docs/guides/ai-agents.md) and [skill](SKILL.md).

## Where Anim8 fits

These tools overlap. Choose based on what you want to author and deliver; Anim8's distinction is the combination of a portable diagram scene, explicit motion, headless evaluation, and an embeddable SVG player.

| Tool | A natural fit | Choose Anim8 when… |
| --- | --- | --- |
| [Mermaid](https://mermaid.js.org/intro/) | Text-defined diagrams in documentation. | The explanation needs objects to move through an explicit, seekable timeline. |
| [Excalidraw](https://plus.excalidraw.com/docs/sdk) | Sketching diagrams with a visual editor and integrating that editor into an app. | You want to author the diagram's motion as a scene and play it inside a page. |
| [GSAP](https://gsap.com/docs/v3/GSAP/) | General JavaScript animation, with tweens and timelines for web interfaces and graphics. | You want diagram objects, connector bindings, validation, and portable scene data as the starting point. |
| [Motion Canvas](https://motioncanvas.io/docs/) | TypeScript generator-based explanatory vector animation with an editor and voice-over workflow. | You want a declarative JSON interchange format and a framework-independent SVG player. |
| [Manim](https://docs.manim.community/en/stable/) | Programmatic mathematical animation and rendered explanatory videos. | Your delivery starts with an interactive web diagram and a JavaScript/TypeScript application. |
| [Remotion](https://www.remotion.dev/docs/player) | React video compositions, including videos embedded with its Player. | You want an SVG diagram scene that can be evaluated and inspected independently of React. |

Other animation tools also support timelines and seeking. Those features alone are not unique to Anim8. This comparison describes the projects' documented focuses, not a performance ranking or an exhaustive feature checklist.

## Get started

Use **Node.js 24** and **pnpm 10.28.0**, matching CI. From a fresh checkout:

```sh
git clone https://github.com/nkcbuilds/anim8.git
cd anim8
pnpm install --frozen-lockfile
pnpm build
pnpm playground
```

Open **http://127.0.0.1:4179** for Anim8 Studio. It starts with the merge-sort demonstration: play it, drag the timeline, change speed, jump between explanation steps, edit the JSON, or import a scene. Download the scene JSON or the current SVG.

To browse the teaching catalog, run `pnpm catalog:serve` and open **http://127.0.0.1:4178**. For the diagram gallery, install Chromium with `pnpm exec playwright install chromium`, run `pnpm gallery:browser`, and open `artifacts/gallery/index.html` directly. It works offline.

### Author a scene

Within a workspace consumer, use the TypeScript builder and mount the result into an existing element such as `<div id="diagram"></div>`:

```ts
import { scene } from "@anim8/authoring";
import { DIAGRAM_TONES } from "@anim8/core";
import { mountPlayer } from "@anim8/player";

const s = scene({ width: 800, height: 360, theme: "sketch", seed: 7 });
const input = s.box("Request", {
  id: "request", x: 160, y: 180, ...DIAGRAM_TONES.blue,
});
const service = s.box("Service", {
  id: "service", x: 540, y: 180, ...DIAGRAM_TONES.neutral,
});
s.connect(input, service);

s.step("Send request", () => {
  s.sequence(input.moveTo({ x: 340, y: 180 }, { duration: 900 }));
});
s.step("Complete", () => {
  s.sequence(service.styleTo(DIAGRAM_TONES.green, { duration: 400 }));
});

const player = mountPlayer(document.querySelector("#diagram")!, s.toJSON());
player.play();
// player.pause(); player.seek(450); player.reverse(); player.destroy();
```

JSON is the interchange format. Validate imported or generated documents before passing the compiled scene to a player or renderer:

```ts
import { compileJson } from "@anim8/compiler";
import { evaluate } from "@anim8/core";
import { renderSketchSvg } from "@anim8/renderer-sketch";

const result = compileJson(source); // source is a scene JSON string
if (!result.ok || !result.scene) throw new Error(JSON.stringify(result.diagnostics));

const svg = renderSketchSvg(evaluate(result.scene, 1250));
```

For application integration, see [React](packages/react/README.md), [Vue](packages/vue/README.md), [web component](packages/web-component/README.md), and the [player API](packages/player/README.md).

### Export an explanation

SVG frames need only the built packages. GIF/MP4 exports additionally need **Playwright Chromium and FFmpeg** installed on your machine.

```sh
node packages/cli/dist/cli.js validate examples/diagram-gallery/dag/scene.json
node packages/cli/dist/cli.js render examples/diagram-gallery/dag/scene.json 3000 frame.svg
node packages/export/dist/cli.js examples/diagram-gallery/dag/scene.json frames/ --fps 12
node packages/export/dist/cli.js examples/diagram-gallery/dag/scene.json pipeline.mp4 --fps 12
```

Exports are create-only; choose a new destination if one already exists. See [export options and limits](packages/export/README.md). The README GIFs have a [reproducible rendering recipe](docs/media/README.md).

## Capabilities and boundaries

Anim8 supports shapes, paths, text, groups, images, bound/routed connectors, camera motion, compatible path morphing, style animation, named markers, bindings, and bounded declarative interactions/state machines. Optional Dagre and ELK adapters help lay out larger directed graphs.

It focuses on 2D explanations. It does not currently provide a 3D engine, physics simulation, a full visual scene editor, a voice-over production system, or built-in mathematical typesetting. The playground is a JSON editor and player. Specialised figures still need domain-aware authoring and layout review.

The core evaluator does not depend on the DOM. Live playback uses SVG and `requestAnimationFrame`. Sketch playback can load its bundled font lazily with ESM code splitting; a single-file bundle includes that font up front. See the [bundle measurement](benchmarks/check-runtime-size.mjs).

Generated scene JSON is untrusted data. The compiler enforces structural and resource limits; it does not execute scene JavaScript. Default media export blocks external asset requests. See the [security model](docs/security.md).

## Documentation

| Start with | Reference |
| --- | --- |
| Authoring and visual design | [Agent guide](docs/guides/ai-agents.md) · [Sketch diagram guide](docs/guides/visual-style.md) · [Rich styling](docs/guides/visual-styling.md) |
| Scene data and timing | [Scene format](docs/reference/scene-format.md) · [Timeline](docs/reference/timeline.md) · [JSON schema](packages/compiler/scene.schema.json) |
| Building blocks | [Authoring](packages/authoring/README.md) · [Layouts](packages/layout/README.md) · [Presets](packages/presets/README.md) |
| Accessibility and embedding | [Accessibility](docs/guides/accessibility.md) · [Player](packages/player/README.md) · [Package directory](packages/) |
| Status and project decisions | [Changelog](CHANGELOG.md) · [Release checklist](docs/release/README.md) · [Architecture decisions](docs/architecture/decisions/) |

## Development and verification

```sh
pnpm check                 # types, unit tests, builds, tarballs, consumers, scenes
pnpm bundle:check          # startup bundle ceiling; lazy bytes reported separately
pnpm exec playwright install chromium firefox webkit
pnpm release:check         # browser, media, layout and playback qualification
```

Browser tests check playback, retained object identity, SSR hydration, rich styles, reveal pixels, and seek parity. Qualification includes mobile emulation and CPU throttling; that is not a substitute for physical-device testing. The [model-provider smoke tests](tests/model-eval/README.md) use offline mocks; live model quality and teaching accuracy require separate evaluation.

Issues and focused pull requests are welcome. Include a small scene, the expected behaviour, and a timestamp when reporting animation problems.

## License

[MIT](LICENSE). The bundled Virgil font is separately licensed under the [SIL Open Font License 1.1](packages/renderer-sketch/assets/Virgil-LICENSE.md).
