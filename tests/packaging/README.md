# Packaging / downstream validation

Run this after the workspace has been built:

```sh
pnpm build
node tests/packaging/check.mjs
```

The validator lives outside package manifests and never rewrites them. A failure is a release-qualification report.

## What it checks

For every buildable package under `packages/`, the checker validates both the working package metadata and the **actual `pnpm pack` tarball**.

Manifest/build checks include:

- a non-empty `files` array whose entries exist after build;
- a public `exports` map for importable/library packages (bin-only packages are exempt);
- explicit `sideEffects` metadata for importable packages;
- a non-empty `license` field;
- declaration exposure through `exports.types` or `types`/`typings`;
- export/type/bin targets that exist and are covered by `files`;
- expected public runtime symbols for focused package fixtures;
- CLI bin existence and shebang.

Actual tarball checks include:

- `package.json`, a root README, and root LICENSE/LICENCE/COPYING text;
- every exported/type/bin target really being present in the archive;
- no raw source, tests, workspace configuration, lockfiles, or unsafe/link entries;
- no unreplaced `workspace:` dependency protocols;
- no shipped direct `dist` JS or declarations that are not represented by package exports/types/bin;
- executable mode + shebang for packaged CLI bins.

## Real package-boundary smoke tests

The checker extracts every generated tarball into an isolated temporary `node_modules` tree.

It then launches child Node processes **from that isolated tree** and resolves/imports packages using their public package specifiers such as:

```js
import("@anim8/core")
```

This intentionally does not import `dist/index.js` by absolute path, so broken or missing `exports` entries are caught.

For packages with an `exports` map, the checker also attempts private deep imports corresponding to exported runtime files (for example `@anim8/core/dist/index.js`) and requires Node to reject them with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Public subpath exports are resolved independently.

Packages whose runtime/peer dependency closure is not present in the isolated packed set are still checked for export resolution and private-boundary enforcement, but their runtime import is explicitly skipped with a note.

## Optional ecosystem validators

If installed in the repository's root `node_modules/.bin`, the checker automatically invokes:

- `publint` against each **extracted actual tarball package**;
- `@arethetypeswrong/cli` (`attw`) against each generated `.tgz` using its `esm-only` profile, matching Anim8's intentional ESM-only package contract.

These tools are optional. When absent, the checker prints explicit messages such as:

```text
[packaging] NOTE: SKIP publint: ...
[packaging] NOTE: SKIP @arethetypeswrong/cli: ...
```

It never silently pretends those checks ran.

## Cleanup

Tarballs, extraction trees, and generated boundary-smoke scripts are created in an OS temporary directory and removed at the end of the run.

If qualification finds missing exports, README/license content, types, side-effects metadata, publish-file declarations, bin metadata, accidental tarball files, or package-boundary failures, it reports them without modifying package or root manifests.
