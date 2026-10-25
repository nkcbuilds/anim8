# Known Limitations

Anim8 is under active development. The current repository contains a coherent, tested deterministic library milestone, but it is **not yet the full Definition of Done** from the project brief.

Current limitations include:

- The generic shape vocabulary is still smaller than the final target.
- Arbitrary SVG path morphing is not implemented.
- Connector routing is stable and attached, but advanced obstacle-aware dynamic rerouting is not implemented.
- Native row/column/grid/stack/radial/tree layouts and an optional Dagre adapter exist; an ELK adapter is not yet included.
- Declarative state bindings and safe click/focus/hover/custom-event state transitions exist, but a richer serializable state-machine model is not yet complete.
- React, Vue, and web-component integrations are implemented and SSR-smoke-tested; real Next.js/Astro builds are present only as source/config fixtures and are skipped unless those optional frameworks are installed.
- A real Chromium Playwright suite exists; Firefox/WebKit visual and behavior matrices are not yet established.
- The model-generation benchmark harness is provider-neutral, but has not yet been run against multiple external model providers.
- Export to video/GIF is not included in the core runtime.
- Accessibility controls/reduced-motion behavior are implemented, but rich alternative summaries for complex diagrams need more work.
- A full interactive editor/playground is not included; the runtime examples are deliberately separate and lightweight.

Packaging qualification now operates on real tarballs and includes public export resolution, isolated imports, private deep-import blocking, publint, and Are the Types Wrong using Anim8's ESM-only contract. Static SVG/rendered numeric output uses deterministic bounded canonicalization.

Unsupported features should produce explicit diagnostics or remain absent from the public API rather than being simulated incorrectly.
