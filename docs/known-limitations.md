# Known Limitations

Anim8 is under active development. The current repository contains a coherent, tested deterministic library milestone, but it is **not yet the full Definition of Done** from the project brief.

Current limitations include:

- The generic shape vocabulary is still smaller than the final target.
- Deterministic compatible SVG path morphing is implemented, but arbitrary topology normalization/resampling is intentionally not; incompatible paths produce diagnostics.
- Connector routing is stable and attached, but advanced obstacle-aware dynamic rerouting is not implemented.
- Native row/column/grid/stack/radial/tree layouts plus optional Dagre and ELK adapters exist; advanced animated obstacle-aware routing across arbitrary layout changes still needs more work.
- Declarative state bindings and safe click/focus/hover/custom-event state transitions exist, but a richer serializable state-machine model is not yet complete.
- React, Vue, and web-component integrations are implemented and SSR-smoke-tested; real Next.js static-export and Astro static/client builds run in the consumer suite. Broader framework/version matrices are not yet established.
- Real Chromium, Firefox, and WebKit behavior suites exist. Byte-stable screenshot checks remain Chromium-only because cross-engine rasterization is not a valid byte-for-byte contract.
- The model-generation benchmark harness is provider-neutral, but has not yet been run against multiple external model providers.
- Export to video/GIF is not included in the core runtime.
- Reduced-motion behavior and deterministic headless accessibility summaries are implemented; framework/web-component exposure of richer live summaries is not yet fully integrated.
- A full interactive editor/playground is not included; the runtime examples are deliberately separate and lightweight.

Packaging qualification now operates on real tarballs and includes public export resolution, isolated imports, private deep-import blocking, publint, and Are the Types Wrong using Anim8's ESM-only contract. Static SVG/rendered numeric output uses deterministic bounded canonicalization.

Unsupported features should produce explicit diagnostics or remain absent from the public API rather than being simulated incorrectly.
