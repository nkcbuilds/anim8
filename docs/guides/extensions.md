# Extension Boundaries

Anim8 keeps extension points outside untrusted scene data.

## Safe extension categories

First-party or trusted developer packages can add:

- higher-level shapes that compile to generic objects,
- layout algorithms that return positions,
- renderers consuming `EvaluatedScene`,
- authoring helpers that compile to existing actions,
- themes and styling helpers,
- exporters and framework wrappers.

`@anim8/presets` is the reference pattern: technical objects such as databases, servers, arrays, queues, pointers, and code blocks are composed from normal generic scene objects and return ordinary handles.

## Declarative scenes

JSON scenes cannot load or execute plugins. A scene may only use object/action/expression vocabulary supported by the compiler version.

## New semantic operations

A genuinely new action should define:

1. a serializable IR type,
2. deterministic arbitrary-time evaluation,
3. property-conflict semantics,
4. compiler/schema validation,
5. resource limits,
6. renderer behavior only if the evaluated result needs new visual state,
7. migration/versioning impact.

Prefer authoring-only helpers when behavior can compile to existing primitives.
