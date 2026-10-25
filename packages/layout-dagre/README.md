# @anim8/layout-dagre

Optional directed-graph layout for Anim8 using [Dagre](https://github.com/dagrejs/dagre).

This package is intentionally separate from `@anim8/layout` and `@anim8/core`. Dagre is a substantially heavier dependency than Anim8's built-in deterministic row/column/grid/tree helpers, so applications should install/import this package only when automatic directed-graph ranking and crossing reduction are worth that cost.

## API

```ts
import { layoutDagre } from "@anim8/layout-dagre";

const result = layoutDagre(scene, {
  direction: "left-right",
  rankGap: 72,
  nodeGap: 36,
});

const apiPosition = result.positions.api;
// { x, y, width, height }
```

`layoutDagre()` reads non-connector objects as graph nodes and Anim8 connector objects as directed edges (`from -> to`). It returns node-center positions and graph bounds.

It **does not mutate** the scene, object transforms, object order, connector endpoints, or any other core state. Applying the returned positions is intentionally left to the caller/authoring layer so this optional adapter cannot silently change Anim8 semantics.

## Determinism

Anim8 normalizes Dagre insertion order by object id and then by edge `from`, `to`, and id. This removes input-array ordering as a tie-breaker where Dagre allows it. Equivalent graphs therefore receive a stable input order even if the source arrays were rearranged.

Dagre remains responsible for ranking/crossing heuristics, so this package does not promise bit-identical coordinates across different Dagre versions. Pin the package version in applications that require long-term serialized coordinate stability.

## Geometry

Node sizes come from `@anim8/core` bounds with each object's scale/rotation applied and translation removed. The returned coordinates are Dagre graph coordinates; nested/group-local transform application is deliberately not guessed by this adapter.

Connectors are topology only and are never positioned or rewritten.
