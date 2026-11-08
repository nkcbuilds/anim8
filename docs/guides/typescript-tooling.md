# TypeScript tooling

Anim8 uses the stable TypeScript 7 native CLI for package typechecking and linting. Builds use tsup for JavaScript and bundled declarations.

## Two compiler roles

| Dependency | Role |
| --- | --- |
| `@typescript/native` → `typescript@^7.0.2` | Provides the native `tsc` command used by every package's `typecheck` and `lint` scripts. |
| `typescript` → `@typescript/typescript6@^6.0.2` | Provides the compiler API for tsup's declaration bundler, the packaging scanner, and framework tooling. Its separate CLI is `tsc6`. |

TypeScript 7.0 does not provide the legacy JavaScript compiler API. These aliases follow [Microsoft's supported side-by-side setup](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/). The Vue package also declares the compatibility alias as a development dependency so pnpm resolves Vue's optional TypeScript peer to the API-compatible compiler.

Both compiler dependencies are development tooling. Published Anim8 packages do not require users to install either compiler at runtime.

## Install and verify

Use Node.js 24 and pnpm 10.28.0:

```sh
pnpm install --frozen-lockfile
pnpm exec tsc --version       # 7.x native CLI
pnpm exec tsc6 --version      # 6.x compatibility CLI
pnpm typecheck               # verifies compiler selection, then checks packages
pnpm build                   # JavaScript and bundled .d.ts files
pnpm consumers               # built-package imports, TS7/TS6 declarations, Next and Astro
```

Package configs use explicit relative `paths` mappings without `baseUrl`, which TypeScript 7 removed. Strictness, target, module resolution, and declaration settings are preserved.

The downstream TypeScript fixture uses NodeNext resolution, strict checking, and `skipLibCheck: false` against copied package output. Both compilers must accept authoring, rendering, playback, React, and Vue APIs, including a negative type assertion. This complements the package source checks and declaration builds.

## Editor support

The CLI migration does not automatically select TypeScript 7 in editors. For VS Code, use Microsoft's [TypeScript 7 extension](https://marketplace.visualstudio.com/items?itemName=TypeScriptTeam.native-preview). Selecting `node_modules/typescript` as a classic workspace SDK selects the compatibility API. Other editors should follow their TypeScript 7 integration instructions.

## Updating the toolchain

Update the native alias and compatibility alias deliberately, including Vue's development dependency, and regenerate `pnpm-lock.yaml`. Dependabot groups these dependencies with the other development tooling.

Keep the compatibility API until the declaration bundler, packaging scanner, and framework tools support its replacement. A successful native typecheck alone does not qualify a compiler update: run `pnpm check`, `pnpm docs:check`, `pnpm bundle:check`, and the browser/media release qualification described in [release qualification](release-qualification.md).

Package test commands use package-local Vitest module caches. Each package runs in its own process under `pnpm -r test`; sharing a workspace cache lets those processes race when a lockfile change invalidates it.

Native typechecking can reduce development and CI time. It does not directly change animation playback speed; measure those separately with `pnpm benchmark`.
