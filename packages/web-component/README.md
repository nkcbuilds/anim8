# @anim8/web-component

Accessible framework-independent web component for Anim8 playback.

This package is part of the [Anim8](https://github.com/nkcbuilds/anim8) monorepo. Anim8 is a deterministic, model-first 2D animation library for diagrams and technical explanations.

> Status: pre-1.0. Public APIs may still evolve while the scene format and package boundaries are hardened.

The `src` loader validates remote JSON through a lazy compiler import and enforces its source-size limit while reading. Failures dispatch `anim8-error`; stale loads are ignored after a scene replacement, source removal or disconnect. Setting `scene = undefined` clears playback and its summary/controls. Programmatic scene values should be trusted or compiled before assignment.

## Development

From the repository root:

```bash
pnpm --filter @anim8/web-component typecheck
pnpm --filter @anim8/web-component test
pnpm --filter @anim8/web-component build
```

See the root README and `docs/` for architecture, security, and authoring guidance.
