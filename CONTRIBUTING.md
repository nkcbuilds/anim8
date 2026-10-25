# Contributing to Anim8

## Setup

```bash
pnpm install
pnpm check
```

## Principles

- Keep core semantics deterministic and renderer-independent.
- Do not use DOM state as authoritative animation state.
- Prefer a few composable primitives over overlapping convenience APIs.
- Treat declarative scene documents as untrusted data.
- Preserve stable object identity.
- Measure runtime dependencies and bundle impact.
- Add tests at exact timestamps for animation behavior.
- Document unsupported behavior instead of silently approximating it.

## Pull requests

A change that modifies scene semantics should include:

1. type/schema implications,
2. deterministic evaluator tests,
3. renderer tests where relevant,
4. AI-generation ergonomics impact,
5. security/resource-limit impact,
6. migration/versioning notes if compatibility changes.

Run `pnpm check` before opening a pull request.
