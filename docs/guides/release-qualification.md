# Release quality and engineering evidence

**Verified versus unverified matters.** CI pass and a valid SVG establish technical correctness of the evaluator/rendered output under the tested conditions, not semantic truth or teaching effectiveness.

The integrated qualification scripts are:

| Script | Evidence |
|---|---|
| `pnpm check` | 19 package builds/typechecks/tests, packaging, consumers, 150 catalog examples, 500 seeded hostile scene mutations and provider adapter mocks |
| `pnpm browser` | Chromium, Firefox and WebKit player/wrapper correctness |
| `pnpm catalog:browser` | Real Chromium visuals and clipping guard on 150 scenes |
| `pnpm qualification:browser` | RAF cadence, 12 active players, 30 mount/unmount cycles, Chrome JS heap |
| `pnpm playground:browser` | Local JSON editor, compilation diagnostics, example switching, playback and CORS |
| `node tests/model-eval/run.mjs --models ...` | Explicitly paid live API generation success rates and repair metrics |
| `pnpm release:preflight` | Built package manifests/exports/README/license/bin and release version agreement |

For browser, replay under pinned OS/browser/hardware and increase stress thresholds on low-end machines. Current tests use permissive smoke limits to avoid flaky CI; no mobile soak or arbitrary adversarial security certification is claimed. For model evaluation, results must be audited manually for scientific and pedagogical content; the validator cannot check semantic quality. For release state, consult the [release checklist](../release/README.md).
