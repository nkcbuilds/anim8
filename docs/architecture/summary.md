# Architecture Summary

Anim8 is organized around one hard boundary: renderer state is never authoritative animation state.

## Pipeline

```text
Authoring API / JSON / DSL
          |
          v
      compiler
  validation + normalization
          |
          v
   SceneDocument 1.0
          |
          v
 evaluate(scene, time)
          |
          v
   EvaluatedScene
          |
    +-----+------+
    |            |
    v            v
 static SVG   browser player
```

## Identity

Objects have stable IDs. Animation changes properties; it does not replace logical identity.

## Groups

Child transforms remain local. World matrices compose through the parent chain.

## Connectors

Connector endpoints are derived from the evaluated world-space anchors of referenced objects, so movement and group transforms automatically update the edge.

## Timeline

The current v1 policy rejects ambiguous overlapping writes to the same property. Actions on distinct properties can compose in parallel.

## Extensibility

Heavy functionality remains optional:

- graph layout engines,
- React adapters,
- advanced sketch rendering,
- editor/playground UI,
- exporters.

The core remains portable and headless.
