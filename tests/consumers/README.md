# Downstream consumer fixtures

These fixtures exercise Anim8 through built package boundaries rather than source aliases.

## Run

From the repository root:

```sh
pnpm build
node tests/consumers/run.mjs
```

The runner requires built `dist` output for `@anim8/core`, `@anim8/renderer-svg`, `@anim8/player`, and `@anim8/react`. It copies only each package's `package.json` and `dist` into an isolated temporary `tests/consumers/.runtime/node_modules`, then runs the fixtures from that runtime.

React and ReactDOM are copied separately from the repository's installed development dependencies so `@anim8/react` receives React as a downstream peer instead of resolving its own package-local development dependency.

Executed fixtures:

- `fixtures/vanilla-esm` — imports `@anim8/core` and `@anim8/renderer-svg`, evaluates a scene, and renders SVG.
- `fixtures/ssr-node` — imports `@anim8/player` with no browser globals and verifies custom-element registration remains a safe no-op.
- `fixtures/react-ssr` — renders `@anim8/react` through `react-dom/server` and verifies static initial SVG.

Each fixture also checks that its Anim8 imports resolve from the isolated runtime's copied package output, preventing a false pass through workspace source aliases.

## Optional framework source fixtures

`optional/next` and `optional/astro` are source/config examples only. The lightweight runner checks whether their large framework dependencies are installed and prints an explicit `SKIP` either way; it never claims a Next or Astro build ran.

They are intentionally outside the pnpm workspace and do not alter root or workspace package manifests.

Set `KEEP_CONSUMER_RUNTIME=1` when running the script if you want to inspect the generated isolated runtime after validation.
