# How a quorum commits a write

An illustrated, six-second explanation of a three-replica log accepting a write with a majority of two while one replica is offline. This is a conceptual majority-replication explanation, not a complete Raft/Paxos protocol specification.

The scene demonstrates multicolor text, a gradient fill, independently colored box outlines and labels, a dashed cluster boundary, a dotted unavailable connection, moving dash patterns, matching arrowhead colors, connector labels, a dashed gradient stroke reveal, and green/solid completion states with updated labels.

From the repository root:

```sh
pnpm build
node packages/cli/dist/cli.js validate examples/complex-styling/scene.json
pnpm playground
```

Open `http://127.0.0.1:4179` and choose **ADVANCED / How a quorum commits a write**. Use the explanation steps, scrubber or playback controls. The chooser includes this extra demonstration alongside the unchanged 150-scene catalog.

With optional Playwright Chromium and FFmpeg installed:

```sh
node packages/export/dist/cli.js examples/complex-styling/scene.json artifacts/quorum.mp4 --fps 12
```

The renderer's real browser checks generate processing/finished screenshots with `pnpm browser:styles`. See [visual styling](../../docs/guides/visual-styling.md) for authoring helpers, JSON semantics and supported limits.
