# Merge sort: follow the same boxes

A complete 24.32-second, stable merge-sort explanation for `[7,3,9,1,5,3,8,2,6,4,1,0]`. The same twelve numbered boxes and original `#1`–`#12` identity tags travel down the split tree and back up into sorted runs. Labels are never exchanged between stationary boxes.

The example performs 30 head comparisons and 44 merge writes, finishing with `[0,1,1,2,3,3,4,5,6,7,8,9]`. Equal keys take the left head first: `1 (#4)` precedes `1 (#11)`, and `3 (#2)` precedes `3 (#6)` in the finished array.

Each value is a scene group containing a box and identity tag. Group motion moves both children together. Merge moves use a vertical–horizontal–vertical route between rows, keeping the moving values clear of stationary boxes and tags. Head cursors move to the compared values; narration and counters track the real algorithm trace. Amber means compared, teal means placed, and green means a completed sorted run.

This represents the merge output buffer by moving each object instead of drawing a second copy. It is an explanation of ordinary stable merge sort with O(n log n) time and O(n) auxiliary storage, not a claim of an in-place sorting algorithm.

## Try it

From the repository root:

```sh
pnpm build
pnpm playground
```

Open `http://127.0.0.1:4179` and import `examples/merge-sort-motion/scene.json`. Play, scrub, change speed, or seek through the split/merge markers. This extra example is separate from the 150-scene catalog.

```sh
pnpm sorting:generate       # reproduce scene.json and trace.json
pnpm sorting:check          # independent sorting and motion oracles
pnpm sorting:browser        # Chromium + Firefox + WebKit playback
```

The generator exports `buildMergeSort(input)` for up to twelve integers in `[-99,99]`, including empty arrays. This limit keeps this demonstration readable; it is not the library's object limit. Build the workspace before invoking the generator.

## What the checks establish

- Independent stable numeric sorting agrees with every intermediate merge and final arrangement across thirteen inputs, including empty, singleton, reversed, all-equal, negative/duplicate and seeded random arrays.
- 4,140 sampled motions match independently computed routes. The box's original number and tag stay attached.
- 1,911 sampled layouts on the main, reversed and seeded examples keep value/tag bounds within the diagram and avoid overlaps between values. These are sampled checks, not a continuous geometric proof.
- In all three browsers, actual player transforms match the headless evaluator at five checkpoints, preserve the same DOM nodes, and render the same pixels as standalone SVG. Arbitrary seek history restores the same pixels.
- Chromium plays the entire timeline at normal speed; Firefox and WebKit play at 4×. All three also play backward at 4× and return to the exact initial image. Playback stops at the endpoints and destruction removes mounted DOM.

Reports and checkpoint PNGs are saved under `artifacts/sorting/` and retained by CI. The headless oracle runs in `pnpm check`; real playback runs in the CI/release workflows and `pnpm release:check`.

With optional Playwright Chromium and FFmpeg installed, export the whole scene:

```sh
node packages/export/dist/cli.js examples/merge-sort-motion/scene.json artifacts/sorting/merge-sort.mp4 --fps 12
```

At 12 fps this produces 293 frames, including the endpoint, at 1280×960. Export is create-only: choose a new filename if that destination already exists.
