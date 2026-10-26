# Qualification beyond unit tests

Run from repo root after `pnpm build`:

- `node tests/qualification/adversarial.mjs` exercises compiler limits, URL/scripting rejection, seeded 500-case mutation, escaping and seeking.
- `node tests/qualification/browser.mjs` uses real Chromium, built package code and real Playwright; measures RAF p95/max, 12 simultaneous playing diagrams, repeated 30 mount/unmount cycles and GC'd Chrome JS heap growth. Fail closed if Chromium is unavailable.

The Chromium test has generous absolute smoke thresholds, intentionally not claiming 60 FPS or mobile qualification. CI machine/browser versions vary; compare reported metrics over time on pinned runners before tightening thresholds. This does not cover every hostile asset, GPU memory profile, mobile browser, image URL policy, or arbitrary library extensions. Scene docs are still untrusted and must pass the compiler. No external URLs or secrets are used.
