# Dependency Assessment

Research date: 2026-10-25.

## Policy

The standard runtime should have essentially zero third-party runtime dependencies. Optional capabilities may use focused dependencies when they justify their cost.

Every dependency is evaluated against:

- transitive bundle cost,
- SSR safety,
- determinism,
- tree-shaking,
- maintenance/license,
- security surface,
- whether the capability can be precomputed at compile time.

## Current decisions

### Core / compiler / SVG / player

**Decision:** dependency-free runtime.

Reason: the first implementation can cover scene evaluation, interpolation, geometry, validation, SVG serialization and playback with platform APIs and small internal utilities. This preserves the bundle target and makes semantics explicit.

### Rough.js

Observed around 8.6 KB min+gzip for v4.6.6 in Bundlephobia research and not marked side-effect-free there.

**Decision:** optional only. First attempt a tiny deterministic native sketch layer. If visual quality is insufficient, publish a Rough.js adapter rather than loading it in the default player.

### ELK.js

Observed npm unpacked size around 8 MB for elkjs 0.12.x.

**Decision:** optional `layout-elk` adapter only; never a standard runtime dependency.

### Dagre

Observed npm unpacked size around 1.4 MB for @dagrejs/dagre 3.1.x.

**Decision:** optional adapter. Basic row/column/grid/stack layouts stay native.

### React

**Decision:** peer dependency of a future React wrapper. Never bundled in standard runtime.

## Build tooling

The current repository uses TypeScript, Vitest and tsup for the first implementation.

Research indicates current tsdown is attractive long-term because it is built around Rolldown/Oxc and supports declaration generation, package validation and modern output formats. Switching build tooling is not necessary before the architecture stabilizes; package behavior matters more than churn in build configuration.

## Bundle budgets

Measured budget contract should use a real minified consumer bundle including transitive dependencies.

Targets:

| Surface | Gzip target |
| --- | ---: |
| compiler/schema validation helpers | <= 4 KB incremental |
| core | <= 14 KB |
| core + static SVG | <= 22 KB |
| core + browser SVG + player | <= 32 KB target, 35 KB hard ceiling |
| React wrapper excluding peer | <= 2.5 KB incremental |
| web component wrapper | <= 3 KB incremental |

DSL, sketch adapters, and graph-layout adapters are reported separately.
