# Anim8 release checklist

Anim8 is **pre-1.0**. The release pipeline is guarded and does not publish on ordinary pushes or pull requests.

## Completed technical qualification

- Schema normalization, static SVG, deterministic seeking/reverse tests, compiler safety ceilings, accessible wrappers and 150 catalog examples.
- Chromium, Firefox, WebKit functional matrices, React SSR and other consumer builds.
- Real Chromium playground interactions, 12 simultaneous players, 30 repeated mount/unmount cycles, heap / RAF metrics.
- Offline OpenAI/Anthropic/Gemini API transport contracts; **NOT live model quality data**.
- GIF and MP4 local real end-to-end exports using optional Playwright and FFmpeg.
- npm tarball qualification, dependency boundary checks, publint and Are the Types Wrong.

## Incomplete release gates

1. Run real, paid model providers on all 36 cases (ideally expanded to a held-out 100); save anonymized reports, compare first-pass syntax, compiler, render failures and repair rates, and manually evaluate teaching usefulness/accuracy. Do not pretend offline mocks prove cross-model success. Run `node tests/model-eval/run.mjs --models ... --cases 36 --attempts 2 --out report.json` after `pnpm build`. No keys are configured in this checkout.
2. Validate p95 frame timing and memory on lower-end PCs and mobile platforms, larger/hostile scenes and long soak runs. CI smoke thresholds must not be marketed as comprehensive performance proof.
3. Review publicly exposed APIs with representative external package installs. Breaking scene IR changes require a new version or migration; do not reuse `1.0` scene schema silently for incompatible syntax.
4. Set up npm access for `@anim8/*` packages and `NPM_TOKEN` in GitHub Actions, or move to verified OIDC trusted publishing. No npm credentials were found in the development environment. Ownership and package names cannot be assumed.
5. Produce a signed-off release candidate, run `pnpm check`, `pnpm browser`, `pnpm catalog:browser`, `pnpm qualification:browser`, `pnpm playground:browser`, `pnpm release:preflight`; create matching `vX.Y.Z` tag only after approval.
6. Publish, verify `npm view @anim8/core version`, smoke-install from npm into a new consumer outside the monorepo, and draft a GitHub release with changelog.

No release tags or npm uploads are created by the preflight task. There is no automatic release triggered by feature branch pushes.

## Security boundaries

Scenes are untrusted *data* and always pass `@anim8/compiler` for JSON use. Scripts/HTML are not supported scene features. Video export launches explicitly installed FFmpeg via `spawn`, never the shell; Playwright media rendering is not a sandbox for arbitrary developer plugins. Never ingest unvalidated SVG, local files, or remote asset references as trusted editor content. The local playground is not designed as a publicly reachable service.

## API stability policy

- Published package versions remain synchronized across the workspace; changes that break a public TypeScript contract or a persisted SceneDocument require an explicit semver bump and migration notice.
- Runtime evaluation semantics are deterministic and must not become DOM-authoritative.
- Optional heavyweight dependencies (`playwright`, `ffmpeg`, ELK, Dagre) do not enter the standard lightweight runtime bundle.
- Avoid adding filler commits to fix CI; stabilize locally and open a single reviewable PR.

## Local runnable interfaces

- `pnpm playground`: visual JSON editor + live validated SVG scene preview.
- `pnpm catalog:serve`: 150 topic explanations.
- `node packages/export/dist/cli.js input.json output.mp4 --fps 24`: local MP4/GIF export.
- `node tests/model-eval/test.mjs`: provider HTTP fixtures without a network call.
