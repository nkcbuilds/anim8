# Known Limitations

Anim8 is under active development. The current repository contains a coherent, tested deterministic library milestone, but it is **not yet the full Definition of Done** from the project brief.

Current limitations include:

- The generic shape vocabulary is still smaller than the final target.
- Arbitrary SVG path morphing is not implemented.
- Camera pan/zoom actions are not implemented.
- Connector routing is stable and attached, but advanced obstacle-aware dynamic rerouting is not implemented.
- Native row/column/grid/stack/radial/tree layouts exist; optional Dagre/ELK adapters are not yet included.
- Declarative state bindings exist, but a full serializable event/state-machine transition layer is not yet complete.
- Trusted browser consumers can observe click/hover/focus/keyboard activation, but declarative event-to-state bindings need a broader public contract.
- React, Vue, and web-component integrations are implemented and SSR-smoke-tested; real Next.js/Astro builds are present only as source/config fixtures and are skipped unless those optional frameworks are installed.
- Firefox/WebKit automated visual regression and browser performance matrices are not yet established.
- Custom packaging/consumer-boundary checks exist, but publint / Are the Types Wrong / full tarball release qualification is not yet wired in.
- The model-generation benchmark harness is provider-neutral, but has not yet been run against multiple external model providers.
- Static SVG numeric canonicalization/precision policy is not yet finalized.
- Export to video/GIF is not included in the core runtime.
- Accessibility controls/reduced-motion behavior are implemented, but rich alternative summaries for complex diagrams need more work.
- A full interactive editor/playground is not included; the runtime examples are deliberately separate and lightweight.

Unsupported features should produce explicit diagnostics or remain absent from the public API rather than being simulated incorrectly.
