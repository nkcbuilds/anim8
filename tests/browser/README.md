# Anim8 Chromium browser harness

This directory contains a browser-level regression harness for the real built
`@anim8/core`, `@anim8/renderer-svg`, and `@anim8/player` packages.

It intentionally does **not** add Playwright to the root/package manifests.
The runner dynamically loads `playwright`; when it is absent, it prints an
explicit `SKIP browser harness` message and executes zero browser cases.

## Run

From the repository root:

```sh
node tests/browser/run.mjs
```

With Playwright installed, the runner:

1. builds `@anim8/core`, `@anim8/renderer-svg`, and `@anim8/player`;
2. starts a loopback-only static server for this repository;
3. launches **Playwright Chromium only**;
4. loads `fixture.html` with an import map pointing at the real package
   `dist/index.js` outputs;
5. executes seven browser cases and fails on page/console errors.

Set `ANIM8_BROWSER_SKIP_BUILD=1` only when those three package outputs are
already current.

## Coverage

- keyed SVG mount/update DOM identity;
- player play, pause, seek, and reverse using real `requestAnimationFrame`;
- connector path updates as endpoints move;
- `prefers-reduced-motion: reduce` through the real custom element;
- multiple player instances with independent state/DOM;
- mount/destroy/remount cleanup;
- a fixed 480x270 screenshot fixture captured twice after a full remount and
  required to be byte-identical in the same Chromium build.

The screenshot case prints its SHA-256. It deliberately does not hard-code a
cross-version Chromium pixel hash yet: this harness is Chromium-first, and a
browser-engine/version bump should not be mislabeled as an Anim8 regression.
To write the captured PNG for inspection:

```sh
ANIM8_BROWSER_WRITE_SCREENSHOT=1 node tests/browser/run.mjs
```

That writes `tests/browser/artifacts/deterministic.chromium.png`.

## Installing Playwright locally

This harness expects the standard `playwright` package and its Chromium
binary to be available to Node resolution. If the package is installed but the
browser binary is missing, the runner emits a separate explicit skip with the
Chromium install command.

No fallback browser or fake DOM is used by this suite.
