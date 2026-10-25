# Optional framework consumer fixtures

These fixtures are real build targets, not documentation-only examples.

The consumer runner always reports missing framework dependencies explicitly.
When dependencies are installed, it executes the framework's production build
against the isolated Anim8 package boundary and inspects generated HTML.

- `next/`: Next.js App Router with a server page, a client
  `@anim8/react` component, static export, and SSR-generated SVG.
- `astro/`: Astro static build using `@anim8/renderer-svg` for the initial
  server-rendered frame and `@anim8/player` for framework-independent client
  activation.

Required root development dependencies for the full framework gate:

```sh
pnpm add -Dw next astro react react-dom
```

Without those optional dependencies the runner prints an exact `SKIP` and
continues to run the vanilla ESM, Node SSR, and React SSR boundary fixtures.
