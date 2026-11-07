# Qualification beyond unit tests

Run from repo root after `pnpm build`:

- `node tests/qualification/adversarial.mjs` exercises compiler limits, URL/scripting rejection, seeded 500-case mutation, escaping and seeking.
- `pnpm qualification:browser` runs the desktop Chromium profile with 12 players and 30 playing mount/unmount cycles.
- `pnpm qualification:matrix` also runs Pixel 7 Chromium emulation at 4× CPU throttling, iPhone 13 WebKit emulation, and a 200-object/200-action scene. Every profile checks actual per-player rendering, pause/destroy quiescence and DOM cleanup. Chromium profiles measure GC'd heap before/after lifecycle stress and after playback cleanup; WebKit reports heap as `null` because comparable CDP metrics are unavailable. Missing engines fail qualification.
- `pnpm qualification:media` requires Playwright Chromium, FFmpeg and ffprobe. It exports MP4/GIF, checks codec/dimensions/frame count/duration, decodes every frame, and verifies existing-file protection and staging cleanup.

Browser runs write `artifacts/qualification/browser.json`, including failed profiles, with commit/dirty state, OS/CPU/Node/browser versions, viewport, throttling, sample duration, limits and results. CI and release workflows retain this report as an artifact. To run a longer soak (up to five minutes per profile):

```sh
pnpm qualification:matrix --duration-ms 60000 --out artifacts/qualification/soak.json
```

Default samples last five seconds per profile. Smoke limits are p95 <100 ms and max <350 ms; throttled Chromium allows p95 <200 ms and max <1000 ms. Chromium lifecycle/post-cleanup heap growth must stay below 30 MiB. These are regression alarms, not a 60 FPS promise. RAF cadence measures page responsiveness, not GPU presentation time. Keep hardware/OS/browser versions fixed for comparisons.

Mobile emulation changes viewport, touch and user agent; CPU throttling approximates reduced compute capacity. Neither substitutes for physical iOS/Android or low-end PC testing, thermal throttling, battery/GPU measurements, or expert review of explanation quality. This does not cover every hostile asset or arbitrary library extension. Scene docs are still untrusted and must pass the compiler. No external URLs or secrets are used.
