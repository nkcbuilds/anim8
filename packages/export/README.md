# @anim8/export

Optional Node export companion; the animation core remains browser/SSR-safe and deterministic.

`svgFrames(scene, {fps, durationMs})` creates bounded SVG frames without headless browsers or external tools. `writeSvgFrames(scene, directory)` saves exact SVG frames; each write is create-only.

`exportVideo(scene, destination, {fps, durationMs})` rasterizes using an optional Playwright Chromium installation, then invokes the user's `ffmpeg` executable with an argument vector (never a shell). Required for .gif/.mp4: install `playwright`, run `playwright install chromium`, and install FFmpeg. The built-in encoder uses h264/yuv420p for MP4 (even dimensions). The user can inject a trusted `rasterize` callback or `ffmpegPath` for host integrations.

Hard limits: 1–60 FPS, 30 seconds, at most 720 frames, <= 1920×1080 px, PNG size <= 20 MB/frame. GIF/MP4 encoding occurs in a temporary directory on the destination filesystem, then final output is published with an atomic create-only hard link. An existing destination is never overwritten, FFmpeg failures leave no partial destination, and staged files are cleaned on success/failure. SVG frame-directory export is create-only per frame; avoid targeting an existing directory if you need an all-or-nothing frame collection.

`anim8-export scene.json video.mp4 --fps 24`
`anim8-export scene.json frames/ --fps 24`

The headless browser explicitly blocks all external network requests while rasterizing. Remote SVG image assets are therefore not embedded by the default exporter; hosts must explicitly provide a trusted rasterization strategy for such scenes. The result is deterministic at the scene/SVG level. PNG and encoded video bytes may vary across browser builds, fonts, OS rasterizers, and FFmpeg versions; pin them for reproducible media. Untrusted scene JSON must be compiled with `@anim8/compiler` before calling these APIs.
