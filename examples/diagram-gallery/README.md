# Animated diagram gallery

17 worked examples share the sketch theme, bundled font, semantic palette and
draw-on animation: DAG, flowchart, sequence, state machine, entity relationship,
architecture, mind map, org chart, timeline, Venn, bar chart, line chart,
geometry, data structures, swimlanes, cycle and undirected network.

Each directory contains a portable `scene.json`. `build.mjs` is the deterministic
authoring source; edit it and regenerate rather than editing generated JSON.

```sh
pnpm build
pnpm gallery:generate
pnpm gallery:check
pnpm exec playwright install chromium
pnpm gallery:browser
```

The browser check creates `artifacts/gallery/index.html`: open it directly to
replay and scrub all examples offline. It also saves final and midpoint contact
sheets. No server is needed.

The runtime check compiles every scene, lints all action boundaries and
midpoints, renders both themes, verifies completed draw actions and deterministic
seeking, and checks the array pointer and bar-chart baseline. Chromium verifies
real playback, replay, persistent DOM nodes, the bundled font and mobile sizing.

These examples demonstrate supported diagram families. More specialised figures
can be composed from the same primitives; meaningful layout and domain accuracy
still require authoring and visual review.
