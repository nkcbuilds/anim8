# Downstream consumer fixtures

These fixtures exercise Anim8 through built package boundaries rather than source aliases.

## Run

From the repository root:

```sh
pnpm build
node tests/consumers/run.mjs
```

The runner requires built `dist` output for its workspace packages, including the player's lazy `@anim8/compiler` dependency. It copies only each package's `package.json` and `dist` into an isolated temporary `tests/consumers/.runtime/node_modules`, then runs the fixtures from that runtime.

React and ReactDOM are copied separately from the repository's installed development dependencies so `@anim8/react` receives React as a downstream peer instead of resolving its own package-local development dependency.

Vue and React's type declarations are also copied as downstream peers. The TypeScript fixture checks the copied public declarations using both the native TypeScript 7 CLI and the TypeScript 6 compatibility CLI, with strict NodeNext resolution and library checking enabled. ELK layout route points are checked through Anim8's public types so upstream ELK declarations cannot leak into that boundary.

Executed fixtures:

- `fixtures/vanilla-esm` — imports `@anim8/core` and `@anim8/renderer-svg`, evaluates a scene, and renders SVG.
- `fixtures/ssr-node` — imports `@anim8/player` with no browser globals and verifies custom-element registration remains a safe no-op.
- `fixtures/react-ssr` — renders `@anim8/react` through `react-dom/server` and verifies static initial SVG.
- `fixtures/custom-extension` — exercises a reusable authoring helper through package exports.
- `fixtures/desktop-webview` — bundles a browser consumer with esbuild.
- `fixtures/typescript` — checks public authoring, compiler, rendering, playback, React, and Vue types with both compilers, including a negative type assertion.

Each fixture also checks that its Anim8 imports resolve from the isolated runtime's copied package output, preventing a false pass through workspace source aliases.

## Optional framework source fixtures

The runner builds `optional/next` and `optional/astro` when their framework dependencies are installed, then checks their generated HTML. It prints an explicit `SKIP` for missing dependencies.

They are intentionally outside the pnpm workspace and do not alter root or workspace package manifests.

Set `KEEP_CONSUMER_RUNTIME=1` when running the script if you want to inspect the generated isolated runtime after validation.
