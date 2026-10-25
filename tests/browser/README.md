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
