# ADR 0002: SVG as the default browser renderer

Status: Accepted

## Context

The target scenes are vector diagrams with text, connectors, paths, groups and accessibility requirements.

## Decision

Use SVG as the default renderer. Keep renderer boundaries independent so Canvas/WebGL can be explored only if benchmarks justify them.

Static SVG serialization is a first-class surface and does not require a DOM.

## Consequences

- SSR/static fallback is straightforward.
- Text/path/marker semantics map naturally.
- Thousands of objects may eventually motivate an optional Canvas renderer, but it is not required for the standard use case.
