# Anim8 browser matrix harness

This directory contains browser-level regression tests against the real built
`@anim8/core`, `@anim8/renderer-svg`, and `@anim8/player` packages.

The runner dynamically loads Playwright. If Playwright itself is unavailable it
prints an explicit skip. Browser binaries are checked independently, so local
development can run whichever engines are installed while CI can require the
full matrix.

## Run

From the repository root:

```sh
pnpm browser
```

By default the harness attempts:

- Chromium
- Firefox
- WebKit

Filter locally with:

```sh
ANIM8_BROWSER_ENGINES=chromium,firefox pnpm browser
```

Set `ANIM8_BROWSER_REQUIRE_ALL=1` when every requested engine must be
installed; CI uses this mode.

With an engine available, the runner:

1. builds `@anim8/core`, `@anim8/renderer-svg`, and `@anim8/player`;
2. starts a loopback-only static server for this repository;
3. launches the requested Playwright browser;
4. loads `fixture.html` against real package `dist/index.js` outputs;
5. executes the portable behavior suite and fails on page/console errors.

Set `ANIM8_BROWSER_SKIP_BUILD=1` only when those package outputs are already
current.

## Portable behavior coverage

Each available engine verifies:

- keyed SVG mount/update DOM identity;
- player play, pause, seek, and reverse using real `requestAnimationFrame`;
- connector path updates as endpoints move;
- `prefers-reduced-motion: reduce` through the real custom element;
- multiple player instances with independent state/DOM;
- mount/destroy/remount cleanup.
- React/Vue object callback forwarding, callback replacement/removal, and keyboard activation.
- callback updates without playback/state resets, Vue scene replacement while playing,
  focus retention during seek/playback, and delayed source replacement/removal races.
- host-loaded WOFF2 fonts on text, rich/shape/connector labels in both themes,
  object overrides, font changes under seeking, SSR adoption and custom-font-only
  sketch mounts without the bundled font rule.

## Visual determinism

Chromium additionally captures a fixed 480x270 fixture twice after remount and
requires the PNG bytes to match within the same browser build.

Pixel output is deliberately **not** compared byte-for-byte across Chromium,
Firefox, and WebKit because font rasterization and antialiasing are
engine/platform-specific. Structural/behavioral assertions are the portable
cross-browser contract.

The Chromium screenshot case prints its SHA-256. To write the captured PNG:

```sh
ANIM8_BROWSER_ENGINES=chromium ANIM8_BROWSER_WRITE_SCREENSHOT=1 pnpm browser
```

## Installing browsers

```sh
pnpm exec playwright install chromium firefox webkit
```

Linux CI should install required system dependencies as well:

```sh
pnpm exec playwright install --with-deps chromium firefox webkit
```

No fake DOM or fallback browser is used by this suite.

## Renderer quality regressions

Run `pnpm browser:visual` after building the workspace. This requires all three browser engines and exercises synthetic library fixtures, independently of catalog/playground examples.

Each engine checks 18 outline combinations (path/polygon/polyline × butt/round/square caps × solid/dashed), zero/partial/full reveal and repeated seeks, exact static/mounted pixel parity, retained DOM identity, and independent fill visibility. Twenty additional paint-composition cases check filled dashed reveals, translucent/gradient fills, hydration, stable object identity and wrapper cleanup; pointer and keyboard activation are also verified. Sixteen hierarchy states cover nested ancestor opacity, group/child visibility, shapes, text and labeled connectors, animation endpoints and backwards seeks. An independent red-over-white pixel oracle checks actual opacity, so agreement between renderers alone cannot conceal the same defect in both.

Reports and failure screenshots are saved under `artifacts/rendering-quality/` and retained by CI/release workflows.
