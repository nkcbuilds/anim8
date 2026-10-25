# Packaging / downstream validation

Run this after the workspace has been built:

```sh
pnpm build
node tests/packaging/check.mjs
```

The validator is intentionally outside package manifests and does not mutate them.

It:

- discovers every package under `packages/` that declares a build script;
- checks each package's `files`, `exports`, `types`/`typings`, and `bin` targets against built output;
- verifies export/bin/type targets are covered by the declared publish `files`;
- verifies declared `dist/` export files exist after the build;
- dynamically imports library root exports in plain Node as an SSR-safety smoke test;
- creates **real `pnpm pack` tarballs** for every buildable package in an OS temp directory;
- parses the generated `.tgz` archives directly in Node and validates the actual package contents rather than trusting the working tree or packer's file listing;
- rejects raw source/tests, workspace/config files, unsafe paths, and undeclared accidental tarball contents while allowing standard automatically included package docs such as LICENSE/README;
- verifies the packed `package.json` still has valid export/type/bin mappings and no unreplaced `workspace:` dependency protocols;
- checks directly shipped `dist` JS/declaration entrypoints are represented by `exports`/`types`/`bin`;
- checks CLI bins exist in the actual archive, have a shebang, and carry an executable mode bit in the tar header;
- unpacks the generated packages into an isolated temporary `node_modules` tree and smoke-imports every package with a usable root import export when its runtime dependency closure is fully represented by the packed workspace packages;
- checks a small public runtime surface for core, compiler, authoring, renderer-svg, player, layout, sketch, renderer-sketch, and dsl;
- checks the CLI as a published executable instead of importing its command entrypoint;
- applies the same focused import/export checks to react, web-component, and ai when those packages are present;
- always removes its temporary tarballs and unpacked installation tree.

Packages with external runtime/peer dependencies (for example React) are still checked from built output and have their tarballs inspected, but their isolated import smoke test is skipped with an explicit note unless those external dependencies are part of the isolated packed set.

A failure is a packaging report, not an auto-fix. In particular, this test must not rewrite package manifests when it finds a missing export, publish-file declaration, bin target, executable bit, leaked source file, unreplaced workspace protocol, or SSR-unsafe import.
