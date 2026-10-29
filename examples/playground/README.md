# Anim8 Studio · Playground

An editable scene playground backed by the Anim8 compiler and browser player. Run `pnpm build`, then `pnpm playground` and open [http://127.0.0.1:4179](http://127.0.0.1:4179).

The chooser includes all 150 catalog examples plus two advanced demonstrations:

- **Stable merge sort** (default): twelve persistent number boxes and original identity tags move through splits and merges. The explanation tracks comparisons, writes and stable duplicate ordering.
- **How a quorum commits a write**: gradient fills, multicolored labels, dashed boundaries and flowing connectors change into acknowledged/committed states. This illustrates majority replication; it is not a full consensus protocol specification.

Play/pause, restart, 0.25×–4× speed, absolute-time scrubbing, and explanation step selection/previous/next let you inspect each stage. Playback stops at the end; Play replays a finished scene. The player retains object DOM identity during playback and seeks. The local server compiles only when loading or changing source; frames render locally without network requests. Editing or importing pauses playback, and invalid source clears the preview and disables playback/SVG export until corrected.

The JSON editor also supports pretty-format, bounded compile diagnostics, import JSON, download JSON and download the current SVG frame. Ctrl/⌘ + Enter compiles immediately. The responsive layout fits desktop and narrow mobile viewports; dense diagrams still need a larger display for comfortable reading.

Compilation happens in a loopback-only Node server with a 2 MiB body limit, strict request origin, and fixed example paths. The server bundles the built browser player on startup; restart it after editing the playground code. External images may be referenced by a trusted scene; do not import untrusted content without host network policy.

`pnpm playground:browser` tests Chromium, Firefox, WebKit and a 390px Chromium viewport. Checks cover full merge-sort playback at 4×, persistent identity and numerical positions of all 24 box/tag nodes, seeking without compile/frame requests, explanation steps, rich styling, pause/error recovery, import, standalone SVG and JSON downloads, canvas bounds and cross-origin rejection. Reports and screenshots are retained under `artifacts/playground/` by CI/release workflows. This is browser/viewport evidence, not physical-device testing or expert review of teaching quality.

This is a local playground, not a deployed collaborative editor, SVG inspector, or keyframe timeline authoring tool. No arbitrary JavaScript execution or generated code compilation is offered.
