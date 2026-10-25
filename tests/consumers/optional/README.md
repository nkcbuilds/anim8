# Optional framework fixtures

These are source/config fixtures, not executed framework builds in the default consumer runner.

- `next/` shows `@anim8/react` from a Next App Router client boundary.
- `astro/` shows `@anim8/react` through Astro's React integration.

The repository intentionally does not install Next, Astro, or `@astrojs/react` just for these checks. `../run.mjs` reports a clear dependency-based `SKIP` and does not pretend these framework builds ran.
