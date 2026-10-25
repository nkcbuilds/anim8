---
name: anim8-authoring
description: Author, validate, and render deterministic Anim8 2D animation scenes using the public JSON scene format or TypeScript authoring API.
---

# Anim8 Authoring Skill

Use Anim8 for animated diagrams, technical explanations, algorithm visualizations, and general 2D scene motion.

## Workflow

1. Read `llms.txt`.
2. Prefer JSON when generating untrusted/portable scenes.
3. Use stable unique IDs.
4. Keep timelines simple and explicit.
5. Validate before rendering.
6. Repair compiler diagnostics directly.
7. Render important timestamps and verify the intended motion.

## Canonical concepts

Scene -> Objects -> Relationships -> State -> Actions -> Timeline -> Evaluated frame -> Renderer.

## Do not

- invent object types,
- invent action types,
- write arbitrary JavaScript into JSON,
- depend on previous rendered frames,
- create overlapping actions that write the same property,
- use DOM properties as scene state,
- silently ignore diagnostics.

## Core actions

`move`, `followPath`, `rotate`, `scale`, `resize`, `opacity`, `fill`, `stroke`, `visibility`, `draw`.

Authoring helpers such as `swap`, `pulse`, and `shake` compile to these deterministic primitives.

## Common object types

`rect`, `circle`, `ellipse`, `polygon`, `polyline`, `text`, `line`, `path`, `group`, `connector`, `image`.

## Technical presets

Use `@anim8/presets` when database/server/document/table/array/stack/queue/pointer/tree/graph/callout/code-block primitives shorten authoring. Presets still compile to generic scene objects.

## Validation

Run:

```bash
anim8 validate scene.json
```

Then repair the exact diagnostic path/code.

## Static render

```bash
anim8 render scene.json 500 frame.svg
```

Use multiple timestamps for swaps, moving connectors, path travel, draw reveals, and multi-step scenes.
