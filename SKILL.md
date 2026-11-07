---
name: anim8-authoring
description: Author, validate, and render deterministic Anim8 2D animation scenes using the public JSON scene format or TypeScript authoring API.
---

# Anim8 Authoring Skill

Use Anim8 for animated diagrams, technical explanations, algorithm visualizations, and general 2D scene motion.

## Workflow

1. Read `llms.txt` and `docs/guides/visual-style.md`.
2. Prefer JSON when generating untrusted/portable scenes.
3. Use stable unique IDs.
4. Keep timelines simple and explicit.
5. Validate before rendering.
6. Repair compiler diagnostics directly.
7. Run `lintDesign` on the final frame and fix every issue.
8. Render important timestamps and verify the intended motion.

## Canonical concepts

Scene -> Objects -> Relationships -> State -> Actions -> Timeline -> Evaluated frame -> Renderer.

## Look designed, not generated

- Use `"theme": "sketch"` with a fixed `seed` for explanations.
- Colour by role from `DIAGRAM_ROLES` (input blue, process neutral, decision yellow, output green); prefer two or three accent tones, with four as the maximum for distinct roles; siblings share a tone; always pair a tone's fill with its own stroke.
- 168x72 nodes, 20px labels, at least 48px between connected nodes, one flow direction.
- Connect with `anchor: "center"`; the arrow binds to the outline automatically.
- Reveal nodes step by step instead of showing everything at once.

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
