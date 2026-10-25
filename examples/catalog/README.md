# Anim8 Teaching Scene Catalog

**150 independently usable animated explanations** covering three domains:

| Domain | Scenes | Examples |
| --- | ---: | --- |
| Computing | 50 | Binary search, BFS/DFS, caching, TLS, compilers, queues |
| Math and science | 50 | Calculus, probability, photosynthesis, water cycle, electric circuits |
| Workflows | 50 | Checkout, incident response, fulfillment, shipping, budgets, user onboarding |

Every example contains a **versioned, portable `SceneDocument`**, four subject-specific steps, explicit timeline markers, on-screen instructional text, and deterministic animations. The 150 scenes span **21 diagram topologies** and exercise move, followPath, draw, resize, scale, fill, stroke, and visibility actions.

These are **curriculum-oriented diagram explanations** rather than 150 bespoke hand-illustrated animations. Anim8's standalone showcase examples under `examples/` demonstrate additional behaviors (morph, camera, interactivity, sketch rendering, richer layouts, and so on).

## Browse the examples

From the repository root, after `pnpm install && pnpm build`:

```bash
pnpm catalog:serve
```

Open **http://127.0.0.1:4178**. The gallery supports category filtering, search, interactive timeline scrubbing and play/pause, instant stage navigation, and JSON download. SVGs are **evaluated on demand from the actual scene**, not prerecorded video or screenshots. It listens on localhost only.

## Use an individual scene

Each scene lives at `examples/catalog/<domain>/<slug>/scene.json`, for example:

```bash
node packages/cli/dist/cli.js validate examples/catalog/computing/binary-search/scene.json
node packages/cli/dist/cli.js render examples/catalog/science/water-cycle/scene.json 1800 water-cycle.svg
```

The `index.json` manifest lists all topics, topologies, authored explanations, marker steps, and scene paths.

## Rebuild or extend the curriculum

The human-readable source records are in `data/{computing,science,workflows}.txt`. Each record has five pipe-delimited fields:

```text
slug|Title|diagram-pattern|Entity A;Entity B;Entity C;Entity D|Step 1;Step 2;Step 3;Step 4
```

Regenerate deterministic, checked-in `scene.json` files and `index.json`:

```bash
pnpm catalog:generate
```

This is an explicit generation step; it is not part of normal builds/tests. CI runs `pnpm catalog:check` to compare every checked-in scene and the manifest byte-for-byte against the deterministic generator without rewriting files.

## Qualification

```bash
pnpm build
pnpm catalog          # all 150 compiled, thousands of evaluations and SVG renders
pnpm catalog:browser  # all 150 × 3 timestamps in actual Chromium, text bounds/collisions
pnpm browser          # existing Chromium, Firefox, and WebKit behavior matrix
```

To inspect one rendered representative of each diagram topology, run:

```bash
ANIM8_CATALOG_SCREENSHOTS=1 pnpm catalog:browser
```

(On PowerShell: `$env:ANIM8_CATALOG_SCREENSHOTS='1'; pnpm catalog:browser`.) These untracked images are written under `.bench/catalog-visual/`.

The catalog validator checks declared coverage, unique topics/narratives/scenes, round-trip compilation, expected step activation, finite scene geometry, bounded SVG serialization, seek/reverse independence, and negative compiler controls. Chromium qualification additionally checks that visible text fits inside the canvas and the teaching/header labels do not overlap the diagram.

**Scope:** These tests verify the authored library scenes and browser behavior. They do not prove that an external model can reliably generate scenes; that requires running the provider-neutral model benchmark with real external models. Nor do they replace human review of pedagogical accuracy or a full accessibility audit.
