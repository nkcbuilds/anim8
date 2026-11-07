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

## Input boundaries

JSON and DSL share `@anim8/compiler` validation and resource limits. Custom-element
`src` loaders import that compiler lazily, bound streamed response bytes, and ignore
stale responses after replacement or disconnect. Programmatic authoring/player APIs
accept trusted application data; imported documents should be compiled first.

Scene font defaults resolve into evaluated object styles before timeline actions.
Renderers use the resulting styles; host applications supply custom font assets.
Expression reads access own scalar state/input properties, and nonfinite runtime
values are rejected before they can reach renderer geometry.
