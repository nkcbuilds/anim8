# @anim8/layout-elk

Optional directed-graph layout for Anim8 using [ELK / elkjs](https://github.com/kieler/elkjs).

This package is intentionally **outside Anim8's standard runtime**. `elkjs` is a comparatively large layout engine, so applications should install and import `@anim8/layout-elk` only when they need ELK's layered directed-graph placement and routed edges. Basic Anim8 layout helpers should remain the default for lightweight scenes.

## Install

```sh
pnpm add @anim8/layout-elk elkjs
```

`elkjs` is an explicit runtime dependency of this package. `@anim8/core` is the only Anim8 workspace dependency.

## API

```ts
import { layoutElk } from "@anim8/layout-elk";

const result = await layoutElk(scene, {
  direction: "left-right",
  nodeGap: 40,
  layerGap: 80,
  edgeGap: 18,
  padding: 20,
});

const api = result.positions.api;
// { x, y, width, height } -- x/y are node centers

const route = result.routes["api-db"];
// { id, from, to, sections: [{ id, points: [...] }] }
```

`layoutElk()` reads non-connector Anim8 objects as graph nodes and connector objects as directed edges. It returns plain node positions, routed edge sections, and graph bounds.

It **does not mutate** the input scene, transforms, object ordering, connector endpoints, timeline, or any other core semantics. Applying returned coordinates or routes is deliberately left to the caller/authoring layer.

## Determinism

Before invoking ELK, the adapter normalizes:

- nodes by code-unit object-id order;
- edges by `from`, then `to`, then connector id;
- ELK's random seed to a fixed non-zero value;
- layered model-order consideration to `NODES_AND_EDGES`.

Equivalent graphs therefore enter ELK in a stable order even when the original Anim8 object array is shuffled. Results are deterministic for the same package/ELK version and options.

As with any external layout engine, serialized coordinates should not be assumed bit-identical across different `elkjs` releases. Pin package versions when long-term coordinate snapshots matter.

## Geometry and routes

Node sizes come from `@anim8/core` geometry bounds with scale and rotation applied and translation removed. ELK returns top-left node boxes; this adapter converts them to center coordinates so callers can apply them naturally to Anim8 transforms.

Connector routes are returned as ELK edge sections containing start, bend, and end points. The adapter does not write those points back into Anim8 connector objects.

The adapter treats the supplied object list as a flat directed graph. It does not reinterpret group hierarchy or parent/child semantics.

## Bounds

To prevent an optional heavy layout request from consuming unbounded resources, the adapter rejects inputs beyond exported `ELK_LAYOUT_LIMITS` before invoking ELK:

- 2,000 nodes;
- 5,000 connectors;
- 128-character ids;
- 100,000-unit measured node dimensions;
- 10,000-unit gaps and padding.

Invalid or non-finite geometry/options and unknown connector endpoints are rejected with explicit errors.

## Why this package is optional

ELK provides substantially more graph-layout machinery than Anim8's built-in deterministic layout helpers. That is useful for architecture diagrams, dependency graphs, and dense directed flows, but it should not increase the install/runtime cost of every Anim8 consumer. Keeping the adapter isolated preserves a small standard runtime while making ELK available when its capabilities justify the weight.
