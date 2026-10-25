## Summary

<!-- What does this change and why? -->

## Validation

<!-- List the exact commands/tests you ran. -->

- [ ] `pnpm typecheck`
- [ ] relevant package tests
- [ ] relevant builds
- [ ] `pnpm release:check` for release/runtime/packaging changes

## Determinism and compatibility

- [ ] Random-access seek/reverse semantics remain deterministic.
- [ ] Scene/schema changes include validation and migration/versioning consideration.
- [ ] Renderer changes preserve SSR/headless behavior where applicable.
- [ ] Untrusted-scene/security implications were considered.

## Documentation

<!-- Note docs/examples updated, or explain why none are needed. -->
