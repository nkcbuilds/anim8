# Release quality and engineering evidence

**Verified versus unverified matters.** CI pass and a valid SVG establish technical correctness of the evaluator/rendered output under the tested conditions, not semantic truth or teaching effectiveness.

The integrated qualification scripts are:

| Script | Evidence |
|---|---|
| `pnpm check` | 19 package builds/typechecks/tests, packaging, consumers, 150 catalog examples, 500 seeded hostile scene mutations and provider adapter mocks |
| `pnpm browser` | Chromium, Firefox and WebKit player/wrapper correctness |
| `pnpm catalog:browser` | Real Chromium visuals and clipping guard on 150 scenes |
| `pnpm qualification:browser` | RAF cadence, 12 active players, 30 mount/unmount cycles, Chrome JS heap |
| `pnpm qualification:matrix` | Desktop, CPU-throttled mobile Chromium, mobile WebKit, 200-object scene and retained JSON evidence |
| `pnpm qualification:media` | Real GIF/MP4 codec, size, frame count, duration, complete decode and file protection |
| `pnpm playground:browser` | 152 selectable scenes, local persistent-player playback, steps/speed, diagnostics, imports/downloads and CORS in three engines plus a narrow mobile viewport |
| `node tests/model-eval/run.mjs --models ...` | Explicitly paid live API generation success rates and repair metrics |
| `pnpm release:preflight` | Built package manifests/exports/README/license/bin and release version agreement |

For browser, replay under pinned OS/browser/hardware and run longer samples with `pnpm qualification:matrix --duration-ms 60000`. Current tests use permissive smoke limits; mobile emulation and CPU throttling do not establish physical-device performance. See [profile definitions and report details](../../tests/qualification/README.md). No arbitrary adversarial security certification is claimed. For model evaluation, results must be audited manually for scientific and pedagogical content; the validator cannot check semantic quality. For release state, consult the [release checklist](../release/README.md).
