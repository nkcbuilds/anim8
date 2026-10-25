# ADR 0001: Deterministic headless core

Status: Accepted

## Context

Anim8 must seek, reverse, export frames and run during SSR/headless use. Using DOM or Web Animations API state as authoritative would make the result depend on renderer history.

## Decision

The authoritative semantic operation is:

```ts
evaluate(scene, timeMs) -> EvaluatedScene
```

The result must not depend on previously evaluated frames.

The core does not read `window`, `document`, RAF state or DOM geometry.

## Consequences

- Seek/reverse/export use the same semantics.
- Tests can inspect exact timestamps.
- Renderers are adapters.
- Some optimized playback backends may duplicate interpolation work, but may never change the semantic result.
