# @anim8/player

Framework-independent playback controller for deterministic Anim8 scenes.

This package is part of the [Anim8](https://github.com/nkcbuilds/anim8) monorepo. Anim8 is a deterministic, model-first 2D animation library for diagrams and technical explanations.

> Status: pre-1.0. Public APIs may still evolve while the scene format and package boundaries are hardened.

Custom-element `src` loads lazily import the compiler, validate/normalize remote JSON, and stop reading responses beyond the compiler's source-size limit. Load errors dispatch `anim8-error`. Programmatic `mountPlayer` accepts a trusted/previously compiled scene. Invalid seek values are ignored; direct core evaluation rejects nonfinite time. Destroyed controllers cannot restart playback.

`controller.setObjectEventHandler(callback)` replaces the imperative object-event callback without resetting timeline time or interaction state. Pass `undefined` to remove it. Declarative scene interactions remain active. The React/Vue adapters use this path when callback presence changes; callback replacement reads the latest handler without remounting. Custom-element `src` replacements/removals cancel pending loads.

## Development

From the repository root:

```bash
pnpm --filter @anim8/player typecheck
pnpm --filter @anim8/player test
pnpm --filter @anim8/player build
```

See the root README and `docs/` for architecture, security, and authoring guidance.
