# README animation previews

These GIFs are rendered from repository scenes with Anim8's compiler, evaluator
and exporter. They are committed so GitHub can display animations directly in
the root README, without a running server or third-party media host.

After building, install Playwright Chromium and FFmpeg, then run:

```sh
pnpm build
pnpm exec playwright install chromium
node docs/media/generate.mjs
```

The recipe records each source file's SHA-256, output dimensions, frame count,
frame rate and GIF checksum in `manifest.json`. It captures the complete
timeline, a complete first-frame poster and a short final hold. It waits for bundled fonts, blocks network
requests and scales the SVG viewport to the preview size. Regeneration replaces
only the named preview assets and their manifest.

Scene/SVG evaluation is deterministic. Raster and encoder bytes can vary with
Chromium, FFmpeg, fonts and platform versions. The source links in the README
are the editable examples; the GIFs are previews rather than interactive players.
