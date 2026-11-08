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

To regenerate just the authoring walkthrough after editing the README example:

```sh
node docs/media/generate.mjs --only authoring
pnpm docs:check
```

The opening `intro.gif` explains Anim8 itself: author, animate, explore, and
share. It uses one scene from `intro.mjs`, saved as `intro.scene.json`, and
samples that scene at forward and backward timestamps to demonstrate direct
seeking. Regenerate it with `node docs/media/generate.mjs --only intro`.

`authoring.gif` is built from the marked TypeScript example in the root README.
Its generated `quickstart.scene.json` is checked against that exact example.
The walkthrough separates object creation and connection from playback, then
shows the 900 ms move and 400 ms style change at quarter speed, with the actual
scene time and matching API calls. Its overlay recipe is also checksummed.

The recipe records each source file's SHA-256, output dimensions, frame count,
frame rate and GIF checksum in `manifest.json`. It captures the complete
timeline, a complete first-frame poster and a short final hold for the gallery
previews. The authoring walkthrough uses separate build beats and a final hold.
Rendering waits for bundled fonts, blocks network
requests and scales the SVG viewport to the preview size. Regeneration replaces
only the named preview assets and their manifest.

Scene/SVG evaluation is deterministic. Raster and encoder bytes can vary with
Chromium, FFmpeg, fonts and platform versions. The source links in the README
are the editable examples; the GIFs are previews rather than interactive players.
