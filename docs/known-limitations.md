# Known Limitations

Anim8 is under active development. The current repository contains a coherent, tested deterministic library milestone, but it is **not yet the full Definition of Done** from the project brief.

Current limitations include:

- The generic shape vocabulary is still smaller than the final target.
- Deterministic compatible SVG path morphing is implemented, but arbitrary topology normalization/resampling is intentionally not; incompatible paths produce diagnostics.
- Deterministic obstacle-aware `routed` connectors are implemented with bounded world-space Manhattan routing. The router intentionally considers at most 48 nearby obstacles per connector; specialized edge-routing features such as ports, bundled edges, and spline optimization remain outside the core.
- Native row/column/grid/stack/radial/tree layouts plus optional Dagre and ELK adapters exist. Routed connectors recompute from evaluated geometry during layout/motion, but large-graph domain-specific edge optimization remains adapter territory.
- Declarative bindings, interactions, and bounded serializable state machines are implemented. State-machine guards intentionally use declared-state scalar equality rather than an executable/general-purpose guard language.
- React, Vue, and web-component integrations are implemented and SSR-smoke-tested; real Next.js static-export and Astro static/client builds run in the consumer suite. Broader framework/version matrices are not yet established.
- Real Chromium, Firefox, and WebKit behavior suites exist. Byte-stable screenshot checks remain Chromium-only because cross-engine rasterization is not a valid byte-for-byte contract.
- Real-model OpenAI/Anthropic/Gemini transport adapters and a 36-case opt-in runner exist, but no multi-provider **live measured** results or expert-rated pedagogical outcomes are available (API credentials not configured).
- Video/GIF export exists in **optional Node** `@anim8/export`, outside the browser runtime, and requires Playwright Chromium plus FFmpeg; cross-platform encoding and arbitrary media reproducibility are not yet release-qualified.
- Reduced-motion behavior and deterministic headless accessibility summaries are implemented. React and Vue expose SSR-safe generated labels, while the web component exposes a live `aria-describedby` summary. Applications with specialized narration still need to author domain-specific descriptions.
- A local interactive JSON playground exists under `examples/playground`, but not a complete timeline/keyframe/graph editor or hosted collaborative workspace. The playground is loopback-only; its server is not designed for public exposure.

Compiler/resource adversarial mutations, multi-player Chromium frame/heap smoke tests, and a Chromium playground suite run in qualification, but not comprehensive mobile, low-end device, multi-hour memory-soak or penetration testing.

Packaging qualification now operates on real tarballs and includes public export resolution, isolated imports, private deep-import blocking, publint, and Are the Types Wrong using Anim8's ESM-only contract. Static SVG/rendered numeric output uses deterministic bounded canonicalization.

Unsupported features should produce explicit diagnostics or remain absent from the public API rather than being simulated incorrectly.
