# Visual Style Guide

How to make an Anim8 diagram look designed rather than generated. Read this
before authoring a scene, and run the design lint before you ship one. Agents:
treat every rule here as a hard constraint unless the user asks otherwise.

## 1. Pick the theme

```json
"scene": { "width": 1000, "height": 560, "theme": "sketch", "background": "#ffffff", "seed": 7 }
```

- `sketch`: hand-drawn strokes, rounded corners, the bundled Virgil font, and
  drawn arrowheads. Best for explanations, teaching, and architecture sketches.
- `clean`: crisp geometric shapes in a UI sans-serif. Best for product UI and
  dense technical figures.

`anim8 render`, `@anim8/export`, the catalog gallery and the playground all pick
the renderer from `scene.theme`. Always set `seed`: it fixes the hand-drawn
marks so every render of the scene is identical.

## 2. Colour carries meaning

Use the palette in `@anim8/core` (`DIAGRAM_TONES`, `DIAGRAM_ROLES`). Each tone is
a matched pair: **always use a tone's fill with that same tone's stroke**.

| Role | Tone | Stroke | Fill | Use for |
| --- | --- | --- | --- | --- |
| `input` | blue | `#1971c2` | `#a5d8ff` | Where a flow starts: users, requests, raw data |
| `process` | neutral | `#1e1e1e` | `#f1f3f5` | Ordinary steps in the middle |
| `decision` | yellow | `#e8590c` | `#ffec99` | Branch points, gates, checks |
| `output` | green | `#2f9e44` | `#b2f2bb` | Results, success states, final products |
| `risk` | red | `#e03131` | `#ffc9c9` | Errors, failures, risks |
| `store` | violet | `#6741d9` | `#d0bfff` | Storage, state, shared resources |
| `external` | teal | `#0c8599` | `#99e9f2` | Third-party and external systems |

Rules:

- Choose colour by **role**, never by position ("first box blue, second green").
  A rainbow of four unrelated pastels is the most common sign of a generated
  diagram.
- Use **two or three accent tones** per scene, and never more than four (for
  example start, decision, success and failure in a flowchart). Neutral does
  not count.
- **Siblings share a tone.** Two branches of a decision, or two parallel
  workers, get the same colour.
- Text is ink `#1e1e1e`. Captions and secondary text use `#495057`. Connectors
  are ink.
- Background is white `#ffffff`.

## 3. Sizes and type

| Element | Size |
| --- | --- |
| Title | 28-32px, centred at y ~48 |
| Node label | 20px (renderer auto-wraps and shrinks to 70% to fit) |
| Caption / step text | 18-20px, `#495057` |
| Standard node | 168 x 72 rect |
| Wide layer / stack row | 320 x 60 rect |
| Hub / central concept | circle, radius 60-70 |
| Stroke width | 2 (shapes and connectors) |

Labels: two to four words. If a label needs more than two lines, the node is
doing too much; split it or move the detail into the caption.

## 4. Layout and spacing

- Leave **at least 48px clear space** between connected nodes, so the arrow and
  its head are readable. Unconnected shapes need at least 24px.
- Put the title in the top 90px, the diagram in the band y 110-420, and the step
  caption near y 480. Nothing may touch the canvas edge (8px margin).
- Flow reads **left to right** (pipelines, branches) or **top to bottom** (trees,
  stacks). Do not mix directions in one diagram.
- Align nodes on a shared row or column. Use the same width for nodes of equal
  importance.
- Use `@anim8/layout` (`row`, `column`, `grid`, `tree`, `radial`) or
  `@anim8/layout-elk` instead of hand-placing large graphs.

## 5. Connectors

- Use `anchor: "center"` (or omit the anchor). The connector then binds to the
  shape's outline with a 6px gap, so the arrowhead is always visible. Use side
  anchors (`left`, `right`, `top`, `bottom`) only to force a particular port.
- `straight` for neighbours on a shared row or column; `curve` for diagonal hops
  (it leaves and enters horizontally); `routed` when something is in the way.
- One connector per relationship. Avoid crossing lines; if two must cross,
  rearrange the nodes.
- Label a connector only when the relationship is not obvious, in two or three
  words.

## 6. Motion tells the story

- **Reveal progressively.** Start nodes and connectors dimmed (opacity ~0.2)
  and bring each to full opacity, with its role colour, at the step that
  explains it.
- Give each step one focus: a short `scale` pop (1 to 1.06 and back) on the node
  being explained.
- Use a small token (`circle`, radius 6) travelling along the connector with
  `move` or `followPath` to show data or control flowing.
- Use `draw` for strokes that should appear drawn: underlines, paths, routes.
- Keep each step to about 900ms of motion, then let it rest. Show exactly one
  step caption at a time using `visibility`.

## 7. Check before you ship

Run the design lint on the final frame (and any key frame):

```ts
import { evaluate, lintDesign } from "@anim8/core";
import { measureSketchText } from "@anim8/renderer-sketch";

const issues = lintDesign(evaluate(scene, durationMs), { measure: measureSketchText });
```

It reports `SHAPES_OVERLAP`, `SHAPES_CROWDED`, `CONNECTOR_TOO_SHORT`,
`OUTSIDE_CANVAS`, `LABEL_OVERFLOW`, `TONE_MISMATCH` and `TOO_MANY_TONES`, each
with the object ids involved and a repair hint. Fix every issue, then render the
first, a middle and the last frame and look at them.

The 150 scenes in `examples/catalog` follow every rule above; the generator
(`examples/catalog/generate.mjs`) is a worked example of each.
