# Changelog

All notable public changes to Anim8 are recorded here. Anim8 follows synchronized
package versions across the `@anim8/*` workspace.

## Unreleased

### Added

- Deterministic, serializable state machines with bounded scalar guards/actions.
- Obstacle-aware routed connectors using bounded world-space geometry.
- React, Vue, and web-component accessibility summaries.
- Explicit scene-schema migration API for future version evolution.
- Real Chromium, Firefox, and WebKit browser qualification.
- Next.js and Astro downstream consumer builds.
- Optional Dagre and ELK layouts, technical presets, sketch rendering, and
  deterministic compatible SVG path morphing.

### Release process

Release tags use the form `vX.Y.Z` and must exactly match every publishable
`@anim8/*` package version. The release workflow reruns package, consumer, and
browser qualification before publishing with npm provenance.
