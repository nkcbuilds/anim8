# Colors, dashed outlines and animated states

Anim8 supports independent shape fill, outline and label colors; bounded linear gradients; inline multicolor text; dashed/dotted outlines; flowing dashes; and timed style/label changes. The same evaluated frame drives static SVG, browser playback and optional MP4/GIF export.

```ts
import { scene } from "@anim8/authoring";

const s = scene({ width: 800, height: 450 });
const worker = s.box([
  { text: "Replica ", color: "#1e40af" },
  { text: "A", color: "#7c3aed", fontWeight: 700 },
], {
  x: 200, y: 200,
  fill: "#eff6ff", stroke: "#2563eb", strokeWidth: 3,
  strokeDasharray: [8, 4], strokeLinecap: "round",
});
const leader = s.box("Leader", { x: 550, y: 200 });
const connection = s.connect(worker, leader, {
  from: "right", to: "left", label: "replicate",
  stroke: "#7c3aed", color: "#6d28d9", strokeWidth: 3,
  strokeDasharray: [10, 6],
});

s.parallel(connection.dashTo(-96, { duration: 1600, easing: "linear" }));
s.parallel(worker.styleTo({
  fill: "#dcfce7", stroke: "#16a34a", color: "#166534",
  strokeDasharray: [], // solid outline at completion
}, { duration: 400 }));
s.sequence(worker.textTo("Replica A · ACK"));
const document = s.toJSON();
```

Explicit run colors override the object's label color. A plain `textTo(...)` replacement removes old spans. Rich spans also work on standalone text, circles and ellipses. Each span has `text`, optional `color`, `fontWeight` and `fontStyle`; the object retains a plain `text` value equal to their concatenation for accessibility and inspection. Spans are inline; automatic paragraph wrapping, mathematical typesetting and per-span timeline actions are not implemented. Use separate text objects when words need independent motion.

## Style properties

| Property | Meaning |
| --- | --- |
| `fill`, `stroke`, `color` | Independent solid shape, outline and text colors |
| `fillGradient`, `strokeGradient`, `colorGradient` | Optional linear gradients for each channel; `null` clears a gradient |
| `strokeWidth`, `strokeOpacity`, `fillOpacity` | Outline thickness and independent paint opacity |
| `strokeDasharray` | Dash/gap lengths, e.g. `[8,4]`; `[1,5]` with round caps gives dots; `[]` restores solid |
| `strokeDashoffset` | Dash phase; animate for directional flow |
| `strokeLinecap`, `strokeLinejoin` | Butt/round/square caps and miter/round/bevel joins |
| `fontSize`, `fontFamily`, `fontWeight`, `fontStyle`, `textAnchor` | Typography and start/middle/end label alignment |
| `textStroke`, `textStrokeWidth` | Optional glyph outline, independent of a box outline |
| `radius` | Rectangle corner radius |

Dashed outlines apply to rectangles, circles, ellipses, polygons, polylines, lines, paths and connectors. Object groups organize their children; styles are per drawable and do not cascade through scene groups. Images retain their own pixel colors. Compose a rectangle behind an image when it needs a border.

```ts
const gradient = {
  type: "linear" as const,
  from: { x: 0, y: 0 }, to: { x: 1, y: 0 },
  stops: [
    { offset: 0, color: "#7c3aed" },
    { offset: 1, color: "#0ea5e9", opacity: 1 },
  ],
};
const title = s.text("Distributed consensus", { colorGradient: gradient });
```

Gradient coordinates are fractions of the painted bounding box. Horizontal/vertical stroke geometry receives a stroke-sized user-space extent so zero-size SVG bounding boxes do not hide gradients. Stops are sorted in `[0,1]`, with 2–16 stops; external paint URLs and executable markup are rejected. Radial gradients are not implemented.

## Timeline and state semantics

JSON uses `{ type: "style", target, start, duration, to: { ...stylePatch } }`. `styleTo`, `colorTo`, `strokeTo` and `dashTo` create pending actions for `sequence`/`parallel`; they do not schedule themselves. Keyframes accept a `style` patch. Numeric properties, equal-length dash arrays and supported solid colors interpolate. Matching gradient stop counts interpolate positions, colors and opacity. Different stop counts, gradient/solid switches, unequal-length dash arrays, fonts and other discrete properties switch at the endpoint. A solid color target replaces that channel's gradient at completion. Supported interpolated color forms include short/long hex with optional alpha, comma-separated RGB/RGBA, and common named colors; other CSS colors switch at the endpoint.

`textTo(value, { duration })` creates a `text` action that replaces the label at its endpoint (default duration `0`). Both plain strings and rich runs are supported. A `text` binding replaces the label and removes spans. Interactive state bindings also support `color` and `strokeDashoffset` alongside existing fill/stroke bindings.

Conflicting writes are rejected across legacy fill/stroke actions, style patches and bindings. A gradient and its solid channel count as the same property. An explicitly interrupted multi-property style action freezes its whole patch; split independent channels into separate actions if they should be interrupted independently. Seeking/reverse evaluates absolute time; styling has no CSS animation clock and finished states persist.

Styled dashes and `draw` reveal compose using SVG masks, including horizontal paths. The sketch renderer supports the deterministic M/L/H/V/C/Q/Z subset for dashed path reveal; unsupported sketch reveal commands raise an error. Clean SVG supports arbitrary compiler-accepted SVG path data. Connector labels are rendered, and arrowheads inherit the connector's stroke.

## Complex explanations and limits

Combine nested groups, camera moves, markers, reusable presets, graph layouts, routed connectors, state bindings and style changes to build layered explanations. The [quorum-write example](../../examples/complex-styling/README.md) demonstrates these visual states. The existing catalog contains 150 teaching scenes.

Complexity remains bounded: compiler limits protect against resource exhaustion, routed connectors consider at most 48 nearby obstacles, and large dense graphs need deliberate layout. This is a 2D scene engine; it does not automatically prove the scientific correctness of an explanation, typeset arbitrary LaTeX or render 3D simulations. Model-generated explanations still require validation and subject-matter review.

Run `pnpm browser:styles` after building and installing Chromium, Firefox and WebKit. It verifies valid SVG in both renderers, static/mounted pixel parity at five timestamps, forward/reverse seek consistency, dashed reveal/flow, finish-state cleanup and hydration identity. Previews are saved under `artifacts/rich-styles/`.
